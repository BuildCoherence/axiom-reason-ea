package cmd

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus/corpustest"
)

// Fixture corpus: a1111111 → {b2222222, c3333333}; b2222222 → d4444444;
// c3333333 → d4444444; d4444444 → e5555555. The root's closure is three
// dependency levels deep with a shared member.
const (
	fxRoot   = "a1111111"
	fxB      = "b2222222"
	fxC      = "c3333333"
	fxD      = "d4444444"
	fxE      = "e5555555"
	fxAbsent = "f6666666"
)

var fxFrozenAt = time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)

// testdataDir is absolute because the command tests chdir into workspaces.
var testdataDir, _ = filepath.Abs("testdata")

func fixtureCorpus() corpustest.Fixture {
	return corpustest.Fixture{
		FrozenAt: fxFrozenAt,
		Files: []corpustest.File{
			{ID: fxRoot, Content: "root\n", Deps: []string{fxB, fxC}},
			{ID: fxB, Content: "b\n", Deps: []string{fxD}},
			{ID: fxC, Content: "c\n", Deps: []string{fxD}},
			{ID: fxD, Content: "d\n", Deps: []string{fxE}},
			{ID: fxE, Content: "e\n"},
		},
		Heads: map[string]corpus.Head{
			"alice": {SnapshotFileID: fxRoot, SnapshotDefID: "x", PublishedAt: fxFrozenAt},
		},
	}
}

// failingTransport fails the test on any HTTP request.
type failingTransport struct {
	t *testing.T
}

func (f failingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	f.t.Errorf("unexpected HTTP request: %s %s", req.Method, req.URL)
	return nil, errors.New("HTTP is forbidden in this test")
}

// forbidHTTP fails the test if any code path performs an HTTP request.
func forbidHTTP(t *testing.T) {
	t.Helper()
	oldDefault := http.DefaultTransport
	http.DefaultTransport = failingTransport{t}
	t.Cleanup(func() { http.DefaultTransport = oldDefault })
}

// setTestHome points the user home at a fresh directory and returns it.
func setTestHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

// installFixtureCorpus installs the fixture corpus as the active install in a
// fresh home and forbids HTTP; it returns the install directory.
func installFixtureCorpus(t *testing.T) string {
	t.Helper()
	forbidHTTP(t)
	return corpustest.Install(t, setTestHome(t), fixtureCorpus())
}

func pinClock(t *testing.T) {
	t.Helper()
	old := nowUTC
	nowUTC = func() time.Time { return time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { nowUTC = old })
}

// runFetchCmd drives `axm fetch` with cobra wired so cmd.Context() is non-nil
// and stdout/stderr land in captured buffers. AXM_NO_SPINNER=1 keeps stderr
// spinner phases off so stdout assertions are byte-stable.
func runFetchCmd(t *testing.T, root string, args ...string) (string, string, error) {
	t.Helper()
	t.Chdir(root)
	t.Setenv("AXM_NO_SPINNER", "1")

	cmd := &cobra.Command{
		Use:          "fetch <file_id> [<file_id>...]",
		Args:         cobra.MinimumNArgs(1),
		SilenceUsage: true,
		RunE:         runFetch,
	}
	var stdout, stderr bytes.Buffer
	cmd.SetOut(&stdout)
	cmd.SetErr(&stderr)
	cmd.SetArgs(args)
	runErr := cmd.ExecuteContext(context.Background())
	return stdout.String(), stderr.String(), runErr
}

// elapsedSuffix strips the non-deterministic "· <elapsed>" tail from
// completion lines so assertions don't depend on wall time.
var elapsedSuffix = regexp.MustCompile(`· (<1s|\d+s|\d+m\d+s)`)

func stripElapsed(s string) string {
	return elapsedSuffix.ReplaceAllString(s, "·")
}

// initFetchWorkspace creates a workspace skeleton sufficient for `axm fetch`
// to open the index.
func initFetchWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".axiomdata"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeAxiomLibPin(t, root, minimumMaterializationAxiomLibTag)
	return root
}

func writeAxiomLibPin(t *testing.T, root, tag string) {
	t.Helper()
	writeAxiomLibRequire(t, root, "https://github.com/BuildCoherence/axiom-lib", tag)
}

func writeAxiomLibRequire(t *testing.T, root, url, rev string) {
	t.Helper()
	content := "import Lake\nopen Lake DSL\npackage axiomClient where\n" +
		"require AxiomLib from git \"" + url + "\" @ \"" + rev + "\"\n"
	if err := os.WriteFile(filepath.Join(root, "lakefile.lean"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// seedCachedFileIndirect writes the file under .axiomdata/files/A/ and its
// fetched.json entry.
func seedCachedFileIndirect(t *testing.T, root, encoded, content string, indirect bool) {
	t.Helper()
	dir := filepath.Join(root, ".axiomdata", "files", "A")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, encoded+".lean"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	idx, err := axmindex.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := idx.SetFetched(encoded+".lean", axmindex.Fetched{
		FileID:    encoded,
		FetchedAt: time.Now().UTC().Truncate(time.Second),
		Indirect:  indirect,
	}); err != nil {
		t.Fatal(err)
	}
}

func readFetchedJSON(t *testing.T, root string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(root, ".axiomdata", "index", "fetched.json"))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func assertCachedContent(t *testing.T, root string, ids ...string) {
	t.Helper()
	want := map[string]string{}
	for _, f := range fixtureCorpus().Files {
		want[f.ID] = f.Content
	}
	for _, id := range ids {
		got, err := os.ReadFile(filepath.Join(root, ".axiomdata", "files", "A", id+".lean"))
		if err != nil {
			t.Errorf("member %s not cached: %v", id, err)
			continue
		}
		if string(got) != want[id] {
			t.Errorf("A/%s.lean = %q, want corpus bytes %q", id, got, want[id])
		}
	}
}

func assertFetchedEntries(t *testing.T, root string, want map[string]bool) {
	t.Helper()
	idx, err := axmindex.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	fetched, err := idx.Fetched()
	if err != nil {
		t.Fatal(err)
	}
	if len(fetched) != len(want) {
		t.Errorf("fetched.json has %d entries, want %d: %v", len(fetched), len(want), fetched)
	}
	for id, indirect := range want {
		if e, ok := fetched[id+".lean"]; !ok || e.Indirect != indirect || e.FileID != id {
			t.Errorf("fetched[%s] = %+v (present %v), want indirect=%v", id, e, ok, indirect)
		}
	}
}

// The golden was captured from the API-backed fetch for the same closure and
// a pinned clock, so the local source must keep the fetched.json contract.
func TestRunFetch_ThreeLevelClosureMatchesGolden(t *testing.T) {
	installFixtureCorpus(t)
	pinClock(t)
	golden, err := os.ReadFile(filepath.Join(testdataDir, "fetched-golden-fetch.json"))
	if err != nil {
		t.Fatal(err)
	}
	root := initFetchWorkspace(t)

	stdout, stderr, err := runFetchCmd(t, root, fxRoot)
	if err != nil {
		t.Fatalf("runFetch: %v\nstderr=%s", err, stderr)
	}
	assertCachedContent(t, root, fxRoot, fxB, fxC, fxD, fxE)
	if got := readFetchedJSON(t, root); !bytes.Equal(got, golden) {
		t.Errorf("fetched.json differs from golden\n got: %s\nwant: %s", got, golden)
	}
	if got := stripElapsed(stdout); !strings.Contains(got, "✓ Fetched      "+fxRoot+"   4 dependencies ·") {
		t.Errorf("stdout = %q, want Fetched line with 4 dependencies", got)
	}
}

func TestRunFetch_RerunIsUpToDate(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	if _, _, err := runFetchCmd(t, root, fxRoot); err != nil {
		t.Fatalf("first fetch: %v", err)
	}

	stdout, _, err := runFetchCmd(t, root, fxRoot)
	if err != nil {
		t.Fatalf("re-fetch: %v", err)
	}
	if got := stripElapsed(stdout); !strings.Contains(got, "✓ Up to date   "+fxRoot+"   closure complete ·") {
		t.Errorf("stdout = %q, want Up to date line", got)
	}
	assertFetchedEntries(t, root, map[string]bool{fxRoot: false, fxB: true, fxC: true, fxD: true, fxE: true})
}

func TestRunFetch_PartialCacheBackfillsOnlyMissing(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	seedCachedFileIndirect(t, root, fxRoot, "root\n", false)
	seedCachedFileIndirect(t, root, fxB, "b\n", true)
	seedCachedFileIndirect(t, root, fxC, "c\n", true)

	stdout, stderr, err := runFetchCmd(t, root, fxRoot)
	if err != nil {
		t.Fatalf("backfill: %v\nstderr=%s", err, stderr)
	}
	if got := stripElapsed(stdout); !strings.Contains(got, "✓ Backfilled   "+fxRoot+"   2 dependencies ·") {
		t.Errorf("stdout = %q, want Backfilled line with 2 dependencies", got)
	}
	assertCachedContent(t, root, fxD, fxE)
	assertFetchedEntries(t, root, map[string]bool{fxRoot: false, fxB: true, fxC: true, fxD: true, fxE: true})
}

func TestRunFetch_MultiRootSharesCachedMembers(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)

	stdout, stderr, err := runFetchCmd(t, root, fxB, fxC)
	if err != nil {
		t.Fatalf("multi-root fetch: %v\nstderr=%s", err, stderr)
	}
	if got := stripElapsed(stdout); !strings.Contains(got, "✓ Fetched      "+fxB+"   2 dependencies ·") {
		t.Errorf("stdout = %q, want %s to copy its 2 dependencies", got, fxB)
	}
	assertCachedContent(t, root, fxB, fxC, fxD, fxE)
	assertFetchedEntries(t, root, map[string]bool{fxB: false, fxC: false, fxD: true, fxE: true})
}

func TestRunFetch_UnknownIDFailsWithoutWriting(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)

	_, _, err := runFetchCmd(t, root, fxRoot, fxAbsent)
	want := fxAbsent + " not in the published corpus (frozen 2026-11-01)"
	if err == nil || err.Error() != want {
		t.Fatalf("runFetch error = %v, want %q", err, want)
	}
	if _, err := os.Stat(filepath.Join(root, ".axiomdata", "files")); !os.IsNotExist(err) {
		t.Errorf("fetch wrote files despite an unknown id: %v", err)
	}
}

func TestRunFetch_NoCorpusNamesUpgrade(t *testing.T) {
	cases := map[string]func(t *testing.T){
		"not installed": func(t *testing.T) {
			forbidHTTP(t)
			setTestHome(t)
		},
		"unmarked install dir": func(t *testing.T) {
			install := installFixtureCorpus(t)
			if err := os.Remove(filepath.Join(install, corpus.MarkerFile)); err != nil {
				t.Fatal(err)
			}
		},
	}
	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			setup(t)
			root := initFetchWorkspace(t)
			_, _, err := runFetchCmd(t, root, fxRoot)
			if err == nil || !strings.Contains(err.Error(), "run `axm upgrade`") {
				t.Fatalf("runFetch error = %v, want run `axm upgrade`", err)
			}
			if _, err := os.Stat(filepath.Join(root, ".axiomdata", "files")); !os.IsNotExist(err) {
				t.Errorf("fetch wrote files without a corpus: %v", err)
			}
		})
	}
}

func TestClosureCompletionLinesKeepIDSelectable(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	stdout, _, err := runFetchCmd(t, root, fxRoot)
	if err != nil {
		t.Fatal(err)
	}
	again, _, err := runFetchCmd(t, root, fxRoot)
	if err != nil {
		t.Fatal(err)
	}
	for _, out := range []string{stripElapsed(stdout), stripElapsed(again)} {
		for _, frag := range []string{"·" + fxRoot, fxRoot + "·"} {
			if strings.Contains(out, frag) {
				t.Errorf("`·` is adjacent to %s in %q", fxRoot, out)
			}
		}
	}
}

// TestHelperProcessAxm runs the real command tree under Execute so exit codes
// are observed from a child process; it is inert unless AXM_HELPER_ARGS is set.
func TestHelperProcessAxm(t *testing.T) {
	args := os.Getenv("AXM_HELPER_ARGS")
	if args == "" {
		t.Skip("helper process only")
	}
	rootCmd.SetArgs(strings.Fields(args))
	Execute()
	os.Exit(0)
}

func runAxmProcess(t *testing.T, dir, home string, args ...string) (int, string) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestHelperProcessAxm$")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"AXM_HELPER_ARGS="+strings.Join(args, " "),
		"HOME="+home, "USERPROFILE="+home,
		"AXM_NO_SPINNER=1")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	var exitErr *exec.ExitError
	if err != nil && !errors.As(err, &exitErr) {
		t.Fatalf("running helper: %v", err)
	}
	return cmd.ProcessState.ExitCode(), stderr.String()
}

func TestCorpusCommandsExitOne(t *testing.T) {
	emptyHome := t.TempDir()
	home := t.TempDir()
	corpustest.Install(t, home, fixtureCorpus())
	root := initFetchWorkspace(t)

	cases := []struct {
		name string
		home string
		args []string
		want string
	}{
		{"fetch unknown id", home, []string{"fetch", fxAbsent}, fxAbsent + " not in the published corpus (frozen 2026-11-01)"},
		{"fork unknown id", home, []string{"fork", fxAbsent, "Dest"}, fxAbsent + " not in the published corpus (frozen 2026-11-01)"},
		{"fetch without corpus", emptyHome, []string{"fetch", fxRoot}, "run `axm upgrade`"},
		{"pull without corpus", emptyHome, []string{"pull", "alice"}, "run `axm upgrade`"},
		{"pull unknown user", home, []string{"pull", "bob"}, "no published Axiom for bob in the corpus (frozen 2026-11-01)"},
		{"pull without username", home, []string{"pull"}, "usage: axm pull <username>"},
		{"search types without corpus", emptyHome, []string{"search", "types", "Nat"}, "run `axm upgrade`"},
		{"search source without corpus", emptyHome, []string{"search", "source", "def"}, "run `axm upgrade`"},
		{"query without corpus", emptyHome, []string{"query", "Nat"}, "run `axm upgrade`"},
		{"modeling-refs without corpus", emptyHome, []string{"modeling-refs"}, "run `axm upgrade`"},
		{"search users --active-contributors", home, []string{"search", "users", "--active-contributors"}, "--active-contributors is not available in the local edition"},
		{"query -p", home, []string{"query", "Nat", "-p", "n=1"}, "-p/--param is not available in the local edition"},
		{"query --order-by", home, []string{"query", "Nat", "--order-by", "created_at:asc"}, "--order-by is not available in the local edition"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, stderr := runAxmProcess(t, root, tc.home, tc.args...)
			if code != 1 || !strings.Contains(stderr, tc.want) {
				t.Fatalf("exit %d, stderr %q; want exit 1 naming %q", code, stderr, tc.want)
			}
		})
	}
}
