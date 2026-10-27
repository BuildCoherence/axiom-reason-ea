package cmd

import (
	"fmt"
	"io"
	"sync"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
)

// spinnerProgress is the closureProgress implementation backed by the
// internal/progress spinner. It drives one stderr phase, gated by the
// package-wide 250ms show-delay so fast paths print nothing:
// "Fetching closure of <file_id> · m/n files" (or "Backfilling closure of
// <file_id> · m/n missing files" when the root was already cached at command
// start), advanced by each copied member.
//
// The m/n ticker reuses the spinner's Detail seam (the same middle-suffix
// segment Lake's job ticker uses): fetchingStart seeds "0/n files", and each
// fetchedOne updates "<done>/n files". The completion verb (Fetching vs
// Backfilling) is picked off the rootCached bit, no extra state.
type spinnerProgress struct {
	w    io.Writer
	mu   sync.Mutex
	sp   *progress.Spinner
	noun string // "files" or "missing files", set in fetchingStart
}

func newSpinnerProgress(w io.Writer) *spinnerProgress {
	return &spinnerProgress{w: w}
}

func (p *spinnerProgress) fetchingStart(rootEncoded string, missing int, rootCached bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	verb := "Fetching"
	p.noun = "files"
	if rootCached {
		verb = "Backfilling"
		p.noun = "missing files"
	}
	p.sp = progress.New(p.w)
	p.sp.Start(fmt.Sprintf("%s closure of %s", verb, rootEncoded))
	p.sp.Detail(fmt.Sprintf("0/%d %s", missing, p.noun))
}

func (p *spinnerProgress) fetchedOne(done, missing int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.sp != nil {
		p.sp.Detail(fmt.Sprintf("%d/%d %s", done, missing, p.noun))
	}
}

func (p *spinnerProgress) stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.sp != nil {
		p.sp.Stop()
		p.sp = nil
	}
}
