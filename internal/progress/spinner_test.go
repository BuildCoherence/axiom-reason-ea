package progress

import (
	"bytes"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// A non-*os.File writer (the shape cobra hands tests and the shape a pipe
// reduces to) must yield a fully inert spinner: no animation goroutine, no
// bytes written. This is the contract that keeps piped output and CI logs free
// of carriage-return churn and escape codes.
func TestNew_DisabledOnNonTTY(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)
	if s.inner != nil {
		t.Fatalf("expected disabled spinner (nil inner) for non-*os.File writer")
	}
	s.Start("working")
	s.setDetail("5/10 jobs")
	s.Done("done")
	s.Stop()
	if buf.Len() != 0 {
		t.Errorf("disabled spinner wrote %q; want no output", buf.String())
	}
}

// enabled must opt out for any non-*os.File destination and for each of the
// documented environment escape hatches, even when (hypothetically) writing
// to a terminal. AXM_NO_SPINNER must disable for any non-empty value, not just
// "1" (matching NO_COLOR/CI).
func TestEnabled_OptOuts(t *testing.T) {
	if enabled(&bytes.Buffer{}) {
		t.Errorf("enabled returned true for a *bytes.Buffer")
	}
	for _, tc := range []struct{ env, val string }{
		{"AXM_NO_SPINNER", "1"},
		{"AXM_NO_SPINNER", "true"}, // any non-empty value disables, like NO_COLOR/CI
		{"NO_COLOR", "1"},
		{"CI", "1"},
	} {
		t.Run(tc.env+"="+tc.val, func(t *testing.T) {
			t.Setenv(tc.env, tc.val)
			if enabled(&bytes.Buffer{}) {
				t.Errorf("enabled true with %s=%s set", tc.env, tc.val)
			}
		})
	}
}

// Successf must degrade to a plain ASCII check mark with no escape codes when
// the destination is not an enabled terminal, while still emitting the
// formatted message and a trailing newline.
func TestSuccessf_PlainOnNonTTY(t *testing.T) {
	var buf bytes.Buffer
	Successf(&buf, "Done — %d file(s) published.", 3)
	got := buf.String()
	if strings.Contains(got, "\x1b") {
		t.Errorf("Successf emitted escape codes on non-TTY: %q", got)
	}
	if got != "✓ Done — 3 file(s) published.\n" {
		t.Errorf("Successf = %q; want plain check + message + newline", got)
	}
}

// On a disabled spinner, LakeWriter must return the spinner's own writer
// unchanged (the raw subprocess stream passes straight through to the stream
// the caller chose) so piped / CI output is byte-for-byte identical to a
// spinner-free build — and it can't be split onto a different stream.
func TestLakeWriter_PassthroughWhenDisabled(t *testing.T) {
	var dst bytes.Buffer
	s := New(&dst) // disabled (bytes.Buffer is not a TTY)
	w := s.LakeWriter()
	const lake = "✔ [4/10] Built CommandLib (798ms)\ninfo: AxiomLib: cloning\n"
	if _, err := w.Write([]byte(lake)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if dst.String() != lake {
		t.Errorf("passthrough = %q; want %q", dst.String(), lake)
	}
}

// Spin runs the function under a (disabled, here) spinner and returns its error
// verbatim.
func TestSpin_ReturnsFnError(t *testing.T) {
	sentinel := fmt.Errorf("boom")
	var buf bytes.Buffer
	if err := Spin(&buf, "Checking", func() error { return sentinel }); err != sentinel {
		t.Errorf("Spin error = %v; want %v", err, sentinel)
	}
	if buf.Len() != 0 {
		t.Errorf("disabled Spin wrote %q; want nothing", buf.String())
	}
}

// jobMarker / handleLine — the only nontrivial parsing in the package. Every
// line must be echoed verbatim; only lines bearing a [n/m] marker update the
// detail.
func TestLakeWriter_ParsesJobMarkerAndEchoesEveryLine(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	lw := s.LakeWriter()

	in := "info: AxiomLib: cloning\n" + // no marker — echoed, no detail
		"✔ [3/10] Built CommandLib (798ms)\n" + // marker → detail 3/10
		"✔ [10/10] Built Axiom (4s)\n" // marker → detail 10/10
	if _, err := lw.Write([]byte(in)); err != nil {
		t.Fatalf("write: %v", err)
	}
	s.Stop()

	out := buf.String()
	for _, want := range []string{"AxiomLib: cloning", "Built CommandLib", "Built Axiom"} {
		if !strings.Contains(out, want) {
			t.Errorf("echoed output missing %q\nfull: %q", want, out)
		}
	}
	// Last marker wins for the detail.
	s.mu.Lock()
	gotDetail := s.detail
	s.mu.Unlock()
	if gotDetail != "10/10 jobs" {
		t.Errorf("detail = %q; want %q", gotDetail, "10/10 jobs")
	}
}

// A trailing line with no '\n' must NOT be dropped: flush (driven by Stop)
// emits it — a Lean panic that doesn't end in a newline used to vanish.
func TestLakeWriter_FlushesTrailingPartialLine(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Elaborating 1 file(s)")
	lw := s.LakeWriter()

	const panicLine = "PANIC: unexpected token" // no trailing newline
	if _, err := lw.Write([]byte(panicLine)); err != nil {
		t.Fatalf("write: %v", err)
	}
	s.Stop() // must flush the buffered partial line

	if !strings.Contains(buf.String(), panicLine) {
		t.Errorf("trailing partial line dropped; output = %q", buf.String())
	}
}

// Done composes a persistent "✓ <msg> · <elapsed>" completion line. We
// assert the constructed FinalMSG rather than rendered output: briandowns only
// emits FinalMSG when it actually animated, which requires a real terminal, so
// a buffer-backed test can't observe the print — but the string we hand it is
// the part this package owns.
func TestDone_ComposesCheckAndElapsed(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Checking Lean toolchain")
	s.Done("Lean toolchain ready")
	final := s.inner.FinalMSG
	if !strings.Contains(final, "✓") || !strings.Contains(final, "Lean toolchain ready") {
		t.Errorf("Done FinalMSG missing check/message: %q", final)
	}
	if !strings.Contains(final, "· <1s") {
		t.Errorf("Done FinalMSG missing sub-second elapsed: %q", final)
	}
}

// Drive an enabled spinner's concurrent machinery — the tick goroutine, two
// goroutines writing the SAME lakeWriter (the shape transform.Invoke produces:
// the exec stderr copier + the scanner's non-JSON fallback), and detail
// updates — so `go test -race` proves the buffer mutex and inner.Lock discipline hold.
func TestConcurrentDrive_NoRace(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	lw := s.LakeWriter()

	var wg sync.WaitGroup
	wg.Add(3)
	// Two writers share one lakeWriter — the exact shape transform.Invoke
	// produces and the shape the previous race test failed to exercise.
	for g := 0; g < 2; g++ {
		go func(g int) {
			defer wg.Done()
			for i := 1; i <= 40; i++ {
				fmt.Fprintf(lw, "✔ [%d/40] Built Module%d-%d (1s)\n", i, g, i)
			}
		}(g)
	}
	go func() {
		defer wg.Done()
		for i := 0; i < 40; i++ {
			s.setDetail(fmt.Sprintf("%d/40 jobs", i))
		}
	}()
	wg.Wait()
	s.Done("Lean workspace built")

	if !strings.Contains(buf.String(), "Built Module") {
		t.Errorf("echoed lake output missing; got %q", buf.String())
	}
}

// A subprocess that emits a carriage-return progress bar (e.g. an elan
// toolchain download during `lake build`) must take over the line: our
// spinner suspends, the bytes pass through verbatim, and stays deferred
// while only '\r'-updates arrive. Regression for #759 bug 1 ("our spinner
// conflicts with lean's"); resume on a closing newline is asserted in
// TestLakeWriter_ResumesAfterProgressCloses below.
func TestLakeWriter_DefersOnCarriageReturn(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	lw := s.LakeWriter()

	// First a clean line — echoed normally.
	if _, err := lw.Write([]byte("info: AxiomLib: cloning\n")); err != nil {
		t.Fatalf("write line: %v", err)
	}
	// Then a carriage-return progress update — must trigger defer.
	const progressBar = "Downloading toolchain... 12%\r"
	if _, err := lw.Write([]byte(progressBar)); err != nil {
		t.Fatalf("write \\r: %v", err)
	}
	if !s.isDeferred() {
		t.Fatalf("spinner did not enter deferred mode after '\\r'")
	}
	// A further '\r'-only update keeps us deferred — no closing newline yet.
	if _, err := lw.Write([]byte("Downloading toolchain... 50%\r")); err != nil {
		t.Fatalf("write second \\r: %v", err)
	}
	if !s.isDeferred() {
		t.Fatalf("spinner left deferred mode without seeing a closing newline")
	}
	s.Stop()

	got := buf.String()
	if !strings.Contains(got, progressBar) {
		t.Errorf("progress bar bytes missing from output: %q", got)
	}
}

// After the subprocess closes its '\r'-progress with a newline (the canonical
// shape: '\rfinal%\n' followed by a no-'\r' line, e.g. "info: installing X"),
// our spinner must resume so the next silent phase (elan extraction, Lake's
// olean load) has a ticking elapsed timer instead of a blank terminal. This
// is the Option-B follow-on to the original defer fix.
func TestLakeWriter_ResumesAfterProgressCloses(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	lw := s.LakeWriter()

	// Enter defer with a fresh in-place update, no newline yet.
	if _, err := lw.Write([]byte("Downloading 50%\r")); err != nil {
		t.Fatalf("write \\r: %v", err)
	}
	if !s.isDeferred() {
		t.Fatalf("not deferred after '\\r'")
	}
	// Bar finalizer — last '\n' sits at position > last '\r'. Must trigger
	// resume.
	if _, err := lw.Write([]byte("Downloading 100%\ninfo: installing X\n")); err != nil {
		t.Fatalf("write finalizer: %v", err)
	}
	if s.isDeferred() {
		t.Fatalf("spinner stayed deferred after the bar was closed by '\\n'")
	}
	// After resume, a clean Lake `[n/m]` line should echo above the spinner
	// AND update the detail counter, just like before the defer happened.
	if _, err := lw.Write([]byte("✔ [3/10] Built CommandLib\n")); err != nil {
		t.Fatalf("write post-resume: %v", err)
	}
	s.mu.Lock()
	gotDetail := s.detail
	s.mu.Unlock()
	if gotDetail != "3/10 jobs" {
		t.Errorf("detail = %q after post-resume \"[n/m]\" line; want %q", gotDetail, "3/10 jobs")
	}
	s.Stop()

	got := buf.String()
	if !strings.Contains(got, "Downloading 100%") || !strings.Contains(got, "info: installing X") {
		t.Errorf("finalizer bytes missing from output: %q", got)
	}
	if !strings.Contains(got, "Built CommandLib") {
		t.Errorf("post-resume Lake line missing from output: %q", got)
	}
}

// Once resumed, a new '\r' update must defer again. This is the
// download → extract → download cycle (a Lake build that fetches multiple
// deps): each progress bar gets its own defer; the silence between gets
// the ticking spinner back.
func TestLakeWriter_DefersResumesDefersAgain(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	lw := s.LakeWriter()

	if _, err := lw.Write([]byte("dep A 50%\r")); err != nil {
		t.Fatal(err)
	}
	if !s.isDeferred() {
		t.Fatalf("not deferred after first '\\r'")
	}
	if _, err := lw.Write([]byte("dep A 100%\ndone fetching A\n")); err != nil {
		t.Fatal(err)
	}
	if s.isDeferred() {
		t.Fatalf("did not resume after first bar closed")
	}
	if _, err := lw.Write([]byte("dep B 25%\r")); err != nil {
		t.Fatal(err)
	}
	if !s.isDeferred() {
		t.Fatalf("did not re-defer on second '\\r'")
	}
	s.Stop()
}

// fakeAfterFunc swaps the package's afterFunc seam for a recorder that captures
// the scheduled callback and delay WITHOUT ever firing on its own — the test
// fires it by hand via the returned trigger, so the show-delay is driven through
// the seam rather than slept on the wall clock. It returns the trigger and a
// restore func to defer. The real *time.Timer it hands back is created stopped,
// so production's showTimer.Stop() (the cancel path) has a valid object to act
// on and the timer never fires independently.
func fakeAfterFunc(t *testing.T, gotDelay *time.Duration) (trigger func(), restore func()) {
	t.Helper()
	var captured func()
	prev := afterFunc
	afterFunc = func(d time.Duration, fn func()) *time.Timer {
		*gotDelay = d
		captured = fn
		timer := time.NewTimer(time.Hour)
		timer.Stop()
		return timer
	}
	return func() {
			if captured == nil {
				t.Fatalf("afterFunc was never called; no callback captured")
			}
			captured()
		}, func() {
			afterFunc = prev
		}
}

// Start must schedule the first visible frame through afterFunc at exactly
// spinnerShowDelay rather than starting briandowns inline; before the timer
// fires nothing is drawn, and the spinner is not yet in the stopped state. When
// the captured callback fires (the delay "elapsing"), showFirstFrame runs its
// draw path (it passes the stopped-guard and reaches inner.Start) — observed via
// the package-owned stopped flag, since briandowns' Active() is unobservable on
// a non-TTY buffer (its Start no-ops off a terminal check).
func TestShowDelay_SchedulesFirstFrameViaSeam(t *testing.T) {
	var gotDelay time.Duration
	trigger, restore := fakeAfterFunc(t, &gotDelay)
	defer restore()

	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")

	if gotDelay != spinnerShowDelay {
		t.Errorf("afterFunc scheduled with %s; want %s", gotDelay, spinnerShowDelay)
	}
	// Before the timer fires: no frame bytes, timer still pending, not stopped.
	if buf.Len() != 0 {
		t.Errorf("frame drawn before show-delay elapsed: %q", buf.String())
	}
	s.mu.Lock()
	stopped, pending := s.stopped, s.showTimer != nil
	s.mu.Unlock()
	if stopped {
		t.Errorf("spinner marked stopped before any Stop/Done")
	}
	if !pending {
		t.Errorf("showTimer not pending after Start")
	}

	// Fire the captured callback: showFirstFrame passes the guard (stopped stays
	// false) and reaches inner.Start without panicking — the draw path ran.
	trigger()
	s.mu.Lock()
	stopped = s.stopped
	s.mu.Unlock()
	if stopped {
		t.Errorf("stopped flipped by showFirstFrame on a live spinner")
	}
	s.Stop()
}

// The elan pattern: a single Write that contains both the bar finalizer
// '\r…%\n' and the next "info:" line in one buffer. progressEnded must
// catch the last-'\n' is after the last-'\r' and resume after this one
// Write — the next Write may not arrive for tens of seconds (silent
// extraction), and the user would see "frozen" terminal otherwise.
func TestLakeWriter_ResumesOnMixedBarAndInfoLineInOneWrite(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	lw := s.LakeWriter()

	if _, err := lw.Write([]byte("downloading 10%\r")); err != nil {
		t.Fatal(err)
	}
	if !s.isDeferred() {
		t.Fatalf("not deferred")
	}
	// Bar's own \n at position > last \r — counts as a clean close.
	if _, err := lw.Write([]byte("downloading 100%\ninfo: installing\n")); err != nil {
		t.Fatal(err)
	}
	if s.isDeferred() {
		t.Fatalf("did not resume on bar-+-info-line same-Write")
	}
	s.Stop()
}

// progressEnded is the heuristic that drives resume; cover its decision
// boundaries directly so a future tweak shows up here rather than as a
// hard-to-localize behavioural regression.
func TestProgressEnded(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"", false},                            // empty
		{"Downloading 50%\r", false},           // \r only
		{"\rA\rB\rC", false},                   // multiple \r, no \n
		{"info: installing\n", true},           // \n only, no \r
		{"line A\nline B\n", true},             // multiple \n, no \r
		{"\rfinal 100%\n", true},               // \r then \n — bar closed
		{"\rA%\rB%\nC\n", true},                // many \r, then \n later — closed
		{"line\n\rA%", false},                  // \n before \r — bar still active
		{"line\n\rA%\rB%", false},              // \r tail, no closing \n
		{"\rfinal\ninfo\n\rnew bar 5%", false}, // closes then re-opens — still active
	}
	for _, tc := range cases {
		if got := progressEnded([]byte(tc.in)); got != tc.want {
			t.Errorf("progressEnded(%q) = %v; want %v", tc.in, got, tc.want)
		}
	}
}

// A '\r' split across two writes still triggers the defer — the suspension
// has to come from the byte itself, not from happening to land within a
// single Write boundary.
func TestLakeWriter_DefersOnCarriageReturnAcrossWrites(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	lw := s.LakeWriter()

	if _, err := lw.Write([]byte("partial-line-without-newline-yet")); err != nil {
		t.Fatalf("write partial: %v", err)
	}
	if s.isDeferred() {
		t.Fatalf("spinner deferred without seeing '\\r'")
	}
	// Now a carriage-return update lands. The buffered partial-line must
	// flush through verbatim alongside the \r-carrying bytes, so nothing
	// the subprocess emitted is dropped.
	if _, err := lw.Write([]byte("progress... 50%\r")); err != nil {
		t.Fatalf("write \\r: %v", err)
	}
	if !s.isDeferred() {
		t.Fatalf("spinner did not defer after '\\r'")
	}
	s.Stop()

	got := buf.String()
	if !strings.Contains(got, "partial-line-without-newline-yet") {
		t.Errorf("buffered partial line was dropped; got %q", got)
	}
	if !strings.Contains(got, "progress... 50%") {
		t.Errorf("\\r-carrying line missing; got %q", got)
	}
}

// Done after a deferred-takeover must still emit the completion line —
// briandowns is no longer animating, so Done has to write directly. The
// "Lean workspace built" line is the only signal the build finished; if it
// went silent, callers couldn't tell warm-build success from a hang.
func TestDone_PrintsAfterDeferred(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	lw := s.LakeWriter()
	if _, err := lw.Write([]byte("download bar 50%\r")); err != nil {
		t.Fatalf("write: %v", err)
	}
	s.Done("Lean workspace built")
	got := buf.String()
	if !strings.Contains(got, "✓") || !strings.Contains(got, "Lean workspace built") {
		t.Errorf("Done line missing post-defer: %q", got)
	}
}

// Two LakeWriters off the same spinner — the shape `axm init` produces when
// it routes both Lake's stdout and Lake's stderr through the spinner.
// A '\r' on either writer must defer the spinner globally so the other
// writer also stops trying to echo-above an already-halted spinner.
func TestLakeWriter_DeferIsSpinnerWide(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	out := s.LakeWriter()
	errLW := s.LakeWriter()

	if _, err := out.Write([]byte("download bar 50%\r")); err != nil {
		t.Fatalf("out write: %v", err)
	}
	if !s.isDeferred() {
		t.Fatalf("spinner did not defer after '\\r' on first writer")
	}
	// The other writer must now pass bytes through verbatim too.
	if _, err := errLW.Write([]byte("✔ [3/10] Built CommandLib\n")); err != nil {
		t.Fatalf("err write: %v", err)
	}
	s.Stop()
	got := buf.String()
	if !strings.Contains(got, "Built CommandLib") {
		t.Errorf("output from sibling writer missing post-defer: %q", got)
	}
}

// TestConcurrentSuspendResume_NoRace drives two LakeWriters through a long
// sequence of mixed traffic: '\r'-only bars, '\rfinal%\n' closers that
// trigger resume, clean '[n/m] Built X\n' lines that go through echoAbove
// — all in parallel from two goroutines, so a sibling can be mid-writeRaw
// on the suspended path while another sibling fires a resume that restarts
// briandowns' frame goroutine. TestConcurrentDrive_NoRace covers the
// clean-line shape but never emits a '\r'; this test exercises the
// deferred branch's lock discipline under `go test -race`.
func TestConcurrentSuspendResume_NoRace(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Building Lean workspace")
	a := s.LakeWriter()
	b := s.LakeWriter()

	const cycles = 30
	writer := func(w io.Writer, salt int) {
		for i := 0; i < cycles; i++ {
			// Open a bar (writer enters deferred mode).
			fmt.Fprintf(w, "dep-%d-%d 0%%\r", salt, i)
			fmt.Fprintf(w, "dep-%d-%d 50%%\r", salt, i)
			// Close the bar — resume can fire here.
			fmt.Fprintf(w, "dep-%d-%d 100%%\ninfo: installed dep-%d-%d\n", salt, i, salt, i)
			// A clean Lake line that should go through echoAbove and update
			// the [n/m] detail.
			fmt.Fprintf(w, "✔ [%d/%d] Built Pkg%d-%d\n", i+1, cycles, salt, i)
		}
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); writer(a, 0) }()
	go func() { defer wg.Done(); writer(b, 1) }()
	wg.Wait()
	s.Done("Lean workspace built")

	// Every clean line must have made it through verbatim.
	out := buf.String()
	for _, want := range []string{"installed dep-0-", "installed dep-1-", "Built Pkg0-", "Built Pkg1-"} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q after concurrent suspend/resume run", want)
		}
	}
}

// TestStopBeforeDirectWrite_ClearsTheRow pins the call-site rule for any
// code path that writes directly to the spinner's stream BEFORE returning
// from the function that drives the spinner: a `defer postSpin.Stop()`
// alone is not enough — the in-flight frame would append to the row the
// direct write lands on, producing garbled output like
//
//	⠦ Publishing 2 file(s) to Axiom · 4m44spublish of X failed: 422 ...
//
// After Stop(), everything written must appear verbatim at the buffer tail
// with no spinner braille interleaved.
func TestStopBeforeDirectWrite_ClearsTheRow(t *testing.T) {
	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Publishing 2 file(s) to Axiom")
	// Give the spinner a tick or two so frames actually land in buf.
	time.Sleep(2 * frameInterval)
	s.Stop()
	const errMsg = "publish of Axioms.lean failed: 422 validation failed\n"
	if _, err := buf.WriteString(errMsg); err != nil {
		t.Fatalf("write: %v", err)
	}
	got := buf.String()
	if !strings.HasSuffix(got, errMsg) {
		t.Errorf("Stop did not clear the spinner row before the direct write;\nexpected tail = %q\nfull buffer = %q",
			errMsg, got)
	}
}

// A spinner stopped before the delay elapses must cancel the timer and never
// draw a frame — even if the captured callback is invoked afterwards (the
// stopped-guard in showFirstFrame holds, modelling a callback that fired but lost
// the race to mu). This is the sub-threshold operation: just the final line
// (here, nothing), no spinner output.
func TestShowDelay_StopBeforeFireCancelsAndGuardsLateCallback(t *testing.T) {
	var gotDelay time.Duration
	trigger, restore := fakeAfterFunc(t, &gotDelay)
	defer restore()

	var buf bytes.Buffer
	s := newEnabled(&buf)
	s.Start("Checking Lean toolchain")
	s.Stop() // stops before the (never-fired) show-delay timer

	// Stop must cancel: stopped set, showTimer cleared.
	s.mu.Lock()
	stopped, cleared := s.stopped, s.showTimer == nil
	s.mu.Unlock()
	if !stopped {
		t.Errorf("Stop did not mark spinner stopped")
	}
	if !cleared {
		t.Errorf("Stop did not cancel/clear the pending showTimer")
	}

	// Invoke the callback after Stop: the stopped-guard must keep showFirstFrame
	// from starting the animation, and nothing may be written.
	trigger()
	s.mu.Lock()
	stillStopped := s.stopped
	s.mu.Unlock()
	if !stillStopped {
		t.Errorf("late timer callback cleared stopped guard")
	}
	if buf.Len() != 0 {
		t.Errorf("sub-threshold operation wrote spinner output: %q", buf.String())
	}
}

func TestFmtElapsed(t *testing.T) {
	cases := map[time.Duration]string{
		0:                         "<1s", // sub-second renders "<1s", not "0s"
		400 * time.Millisecond:    "<1s",
		time.Second:               "1s",
		5 * time.Second:           "5s",
		59 * time.Second:          "59s",
		60 * time.Second:          "1m00s",
		83 * time.Second:          "1m23s",
		(10*60 + 4) * time.Second: "10m04s",
	}
	for d, want := range cases {
		if got := fmtElapsed(d); got != want {
			t.Errorf("fmtElapsed(%s) = %q; want %q", d, got, want)
		}
	}
}
