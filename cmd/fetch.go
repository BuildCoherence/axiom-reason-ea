package cmd

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/idcodec"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"github.com/spf13/cobra"
)

// nowUTC stamps fetched.json provenance; tests pin it.
var nowUTC = func() time.Time { return time.Now().UTC() }

// closureResult is the bookkeeping the completion lines need: how many
// members were copied this invocation (the "N dependencies" figure, post-diff),
// the total closure size, and whether the root was already cached at command
// start (selects the Backfilled verb).
type closureResult struct {
	copied     int
	missing    int
	total      int
	rootCached bool
}

// closureProgress is the set of progress hooks ensureClosureCached drives.
type closureProgress interface {
	fetchingStart(rootEncoded string, missing int, rootCached bool)
	fetchedOne(done, missing int)
	stop()
}

var fetchCmd = &cobra.Command{
	Use:          "fetch <file_id> [<file_id>...]",
	Short:        "Fetch files and their dependency closure by file_id",
	Long:         "Copies files by file_id (the unified 8-char id) from the installed Published Corpus, with each file's full dependency closure, writing every member under .axiomdata/files/A/<file_id>.lean.",
	Args:         cobra.MinimumNArgs(1),
	SilenceUsage: true,
	RunE:         runFetch,
}

func init() {
	rootCmd.AddCommand(fetchCmd)
}

func runFetch(cmd *cobra.Command, args []string) error {
	for _, arg := range args {
		if !idcodec.Valid(arg) {
			return fmt.Errorf("invalid file_id %q", arg)
		}
	}

	idx, err := axmindex.Open(".")
	if err != nil {
		return fmt.Errorf("opening workspace index: %w", err)
	}
	permit, err := preflightMaterialization(cmd.Context(), idx)
	if err != nil {
		return err
	}
	pc, err := corpus.OpenInstalled()
	if err != nil {
		return err
	}
	if err := requireInCorpus(pc, args...); err != nil {
		return err
	}

	// Serialize against concurrent axm commands that mutate .axiomdata/.
	// ensureClosureCached does not take the lock itself. See cmd/lock.go.
	lock, err := acquireWorkspaceLock(idx)
	if err != nil {
		return err
	}
	defer func() { _ = lock.Unlock() }()

	stdout := cmd.OutOrStdout()
	errW := cmd.ErrOrStderr()
	// Roots run sequentially so a member copied for one root satisfies the
	// diff for the next.
	for _, id := range args {
		start := time.Now()
		prog := newSpinnerProgress(errW)
		_, result, err := ensureClosureCached(idx, pc, id, true, permit, prog, errW)
		prog.stop()
		if err != nil {
			return fmt.Errorf("fetch %s: %w", id, err)
		}
		printFetchSuccess(stdout, id, result, time.Since(start))
	}
	return nil
}

// requireInCorpus fails naming every id the corpus does not hold.
func requireInCorpus(pc *corpus.Corpus, ids ...string) error {
	var unknown []string
	for _, id := range ids {
		if !pc.Has(id) {
			unknown = append(unknown, id)
		}
	}
	if len(unknown) == 0 {
		return nil
	}
	return fmt.Errorf("%s not in the published corpus (frozen %s)", strings.Join(unknown, ", "), pc.FrozenDate())
}

// printFetchSuccess renders the per-root completion line on stdout. Three
// verbs distinguish genuinely different states: Up to date (nothing missing),
// Backfilled (repaired a previously-partial cache), Fetched (a fresh closure).
// The file_id is whitespace-flanked (never `·`-adjacent) so a double-click
// selects the whole token. N is what was copied THIS invocation, not the
// closure size.
func printFetchSuccess(stdout io.Writer, encoded string, result closureResult, elapsed time.Duration) {
	el := progress.FmtElapsed(elapsed)
	switch {
	case result.copied == 0:
		progress.Successf(stdout, "Up to date   %s   closure complete · %s", encoded, el)
	case result.rootCached:
		progress.Successf(stdout, "Backfilled   %s   %d dependencies · %s", encoded, result.copied, el)
	default:
		progress.Successf(stdout, "Fetched      %s   %d dependencies · %s", encoded, result.copied, el)
	}
}

// ensureClosureCached copies rootID's dependency closure from the corpus into
// the workspace cache. It is the single shared routine for `axm fetch`
// (recordRoot=true), `axm fork` and `axm pull` (recordRoot=false), and must
// run inside the caller's acquireWorkspaceLock.
//
// Members already cached (fetched.json entry AND on-disk file) are skipped;
// file_id is immutable so presence is sufficient. Provenance is recorded in a
// single SetFetchedBulk write: root indirect:false when recordRoot, members
// indirect:true. With recordRoot=false the root's bytes are returned for the
// caller's reverse-transform and the root is neither written under A/ nor
// recorded.
func ensureClosureCached(idx *axmindex.Index, pc *corpus.Corpus, rootID string, recordRoot bool, permit materializationPermit, prog closureProgress, errW io.Writer) ([]byte, closureResult, error) {
	var result closureResult
	if !permit.validFor(idx) {
		return nil, result, fmt.Errorf("content materialization requires the workspace compatibility preflight")
	}
	if err := requireInCorpus(pc, rootID); err != nil {
		return nil, result, err
	}
	closureIDs, err := pc.Closure(rootID)
	if err != nil {
		return nil, result, err
	}
	result.total = len(closureIDs)

	fetchedIdx, err := idx.Fetched()
	if err != nil {
		return nil, result, fmt.Errorf("reading fetched.json: %w", err)
	}
	result.rootCached = isCached(idx, fetchedIdx, rootID)
	var missing []string
	for _, id := range closureIDs[1:] {
		if !isCached(idx, fetchedIdx, id) {
			missing = append(missing, id)
		}
	}
	result.missing = len(missing)
	if prog != nil {
		prog.fetchingStart(rootID, len(missing), result.rootCached)
	}

	recorded := make(map[string]axmindex.Fetched, len(missing)+1)
	rootBytes, err := resolveRoot(idx, pc, rootID, recordRoot, result.rootCached)
	if err != nil {
		return nil, result, err
	}
	if recordRoot {
		recorded[rootID+".lean"] = axmindex.Fetched{FileID: rootID, FetchedAt: nowUTC()}
	}

	for _, id := range missing {
		if err := copyFromCorpus(idx, pc, id); err != nil {
			// Members that landed stay valid; record them so a rerun does not
			// copy them again. The copy error remains the returned cause.
			if bulkErr := idx.SetFetchedBulk(recorded); bulkErr != nil && errW != nil {
				fmt.Fprintf(errW, "warning: recording copied members for %s failed: %v\n", rootID, bulkErr)
			}
			return nil, result, err
		}
		recorded[id+".lean"] = axmindex.Fetched{FileID: id, FetchedAt: nowUTC(), Indirect: true}
		result.copied++
		if prog != nil {
			prog.fetchedOne(result.copied, len(missing))
		}
	}

	if len(recorded) > 0 {
		if err := idx.SetFetchedBulk(recorded); err != nil {
			return nil, result, fmt.Errorf("recording fetched closure for %s: %w", rootID, err)
		}
	}
	return rootBytes, result, nil
}

// resolveRoot returns the root's content bytes. For recordRoot (fetch) a
// cached root is read from disk and an uncached one is copied under A/. For
// recordRoot=false (fork, pull) the bytes come from the corpus and nothing is
// written; a prior direct fetch of the root is left untouched.
func resolveRoot(idx *axmindex.Index, pc *corpus.Corpus, rootID string, recordRoot, rootCached bool) ([]byte, error) {
	if recordRoot && rootCached {
		return os.ReadFile(cachedPath(idx, rootID))
	}
	content, err := pc.Content(rootID)
	if err != nil {
		return nil, fmt.Errorf("reading %s from the corpus: %w", rootID, err)
	}
	if recordRoot {
		if _, err := cacheFetched(idx, rootID, content); err != nil {
			return nil, err
		}
	}
	return content, nil
}

func copyFromCorpus(idx *axmindex.Index, pc *corpus.Corpus, id string) error {
	content, err := pc.Content(id)
	if err != nil {
		return fmt.Errorf("reading %s from the corpus: %w", id, err)
	}
	_, err = cacheFetched(idx, id, content)
	return err
}

func cachedPath(idx *axmindex.Index, id string) string {
	return filepath.Join(idx.Root(), ".axiomdata", "files", "A", id+".lean")
}

// isCached returns true iff both .axiomdata/files/A/<encoded>.lean exists
// on disk AND fetched.json has an entry keyed at "<encoded>.lean". Either
// alone means re-copy: a missing file means there's nothing to import;
// a missing index entry means the cache state is unknown.
func isCached(idx *axmindex.Index, fetchedIdx map[string]axmindex.Fetched, encoded string) bool {
	if _, ok := fetchedIdx[encoded+".lean"]; !ok {
		return false
	}
	_, err := os.Stat(cachedPath(idx, encoded))
	return err == nil
}

// cacheFetched writes content to .axiomdata/files/A/<file_id>.lean and returns
// the workspace-relative path written. WriteFileAtomic lands the file before
// its fetched.json entry exists, so the presence check never trusts a
// half-written file. Provenance is recorded by the caller.
func cacheFetched(idx *axmindex.Index, id string, content []byte) (string, error) {
	relPath := filepath.Join(".axiomdata", "files", "A", id+".lean")
	absPath := filepath.Join(idx.Root(), relPath)
	if err := axmindex.WriteFileAtomic(absPath, content); err != nil {
		return relPath, fmt.Errorf("writing %s: %w", absPath, err)
	}
	return relPath, nil
}
