package cmd

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/agentskills"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus/corpustest"
)

// runStatusCmd drives `axm status` end-to-end with cobra wired up so
// cmd.OutOrStdout() lands in a captured buffer. The --all-fetched flag binds
// to the package-level statusAllFetched var; the harness resets it after each
// run so tests don't bleed into one another. AXM_NO_SPINNER=1 keeps any
// stderr spinner off so stdout assertions stay byte-stable.
func runStatusCmd(t *testing.T, root string, args ...string) (string, string, error) {
	t.Helper()
	t.Chdir(root)
	t.Setenv("AXM_NO_SPINNER", "1")

	prevAll, prevRemote := statusAllFetched, statusRemote
	statusAllFetched, statusRemote = false, false
	t.Cleanup(func() { statusAllFetched, statusRemote = prevAll, prevRemote })

	cmd := &cobra.Command{
		Use:          "status",
		SilenceUsage: true,
		RunE:         runStatus,
	}
	cmd.Flags().AddFlagSet(statusCmd.Flags())
	var stdout, stderr bytes.Buffer
	cmd.SetOut(&stdout)
	cmd.SetErr(&stderr)
	cmd.SetArgs(args)
	runErr := cmd.ExecuteContext(context.Background())
	return stdout.String(), stderr.String(), runErr
}

// initStatusWorkspace creates the minimal workspace skeleton `axm status`
// needs to open the index, under an empty user home.
func initStatusWorkspace(t *testing.T) string {
	t.Helper()
	setTestHome(t)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".axiomdata"), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

// seedFetched writes a fetched.json entry directly via the index. ago is how
// long before now the file was fetched; indirect marks closure members.
func seedFetched(t *testing.T, root, fileID string, ago time.Duration, indirect bool) {
	t.Helper()
	idx, err := axmindex.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := idx.SetFetched(fileID+".lean", axmindex.Fetched{
		FileID:    fileID,
		FetchedAt: time.Now().Add(-ago),
		Indirect:  indirect,
	}); err != nil {
		t.Fatal(err)
	}
}

// TestStatus_RecentlyFetched_WindowFiltersOldDirect: a direct entry within 48h
// shows under "Recently fetched"; an older direct entry is hidden and counted
// in the footer.
func TestStatus_RecentlyFetched_WindowFiltersOldDirect(t *testing.T) {
	root := initStatusWorkspace(t)
	seedFetched(t, root, "recentDirect", 15*time.Minute, false)
	seedFetched(t, root, "oldDirect", 72*time.Hour, false)

	stdout, _, err := runStatusCmd(t, root)
	if err != nil {
		t.Fatalf("runStatus err = %v\nstdout=%s", err, stdout)
	}

	if !strings.Contains(stdout, "Recently fetched (1):") {
		t.Errorf("want heading count 1; got:\n%s", stdout)
	}
	if !strings.Contains(stdout, "recentDirect") || !strings.Contains(stdout, "15 minutes ago") {
		t.Errorf("recent direct entry missing; got:\n%s", stdout)
	}
	if strings.Contains(stdout, "oldDirect") {
		t.Errorf("old direct entry should be hidden from default view; got:\n%s", stdout)
	}
	// Footer fires because the old direct entry is hidden. M=2 direct, K=0.
	if !strings.Contains(stdout, "2 fetched directly, 0 pulled as dependencies — run `axm status --all-fetched` for the full list.") {
		t.Errorf("missing/incorrect footer; got:\n%s", stdout)
	}
}

// TestStatus_NoFooterWhenNothingHidden: all direct entries recent, zero
// indirect → no footer.
func TestStatus_NoFooterWhenNothingHidden(t *testing.T) {
	root := initStatusWorkspace(t)
	seedFetched(t, root, "alpha", 1*time.Hour, false)
	seedFetched(t, root, "beta", 2*time.Hour, false)

	stdout, _, err := runStatusCmd(t, root)
	if err != nil {
		t.Fatalf("runStatus err = %v\nstdout=%s", err, stdout)
	}

	if !strings.Contains(stdout, "Recently fetched (2):") {
		t.Errorf("want heading count 2; got:\n%s", stdout)
	}
	if strings.Contains(stdout, "for the full list") {
		t.Errorf("footer should be absent when nothing is hidden; got:\n%s", stdout)
	}
}

// TestStatus_FooterWhenIndirectExists: indirect entries present (all direct
// recent) → footer with correct M/K counts.
func TestStatus_FooterWhenIndirectExists(t *testing.T) {
	root := initStatusWorkspace(t)
	seedFetched(t, root, "directA", 30*time.Minute, false)
	seedFetched(t, root, "depA", 1*time.Hour, true)
	seedFetched(t, root, "depB", 2*time.Hour, true)
	seedFetched(t, root, "depC", 3*time.Hour, true)

	stdout, _, err := runStatusCmd(t, root)
	if err != nil {
		t.Fatalf("runStatus err = %v\nstdout=%s", err, stdout)
	}

	if !strings.Contains(stdout, "Recently fetched (1):") {
		t.Errorf("want heading count 1 (only direct in window); got:\n%s", stdout)
	}
	if !strings.Contains(stdout, "1 fetched directly, 3 pulled as dependencies — run `axm status --all-fetched` for the full list.") {
		t.Errorf("missing/incorrect footer; got:\n%s", stdout)
	}
	// Dependencies are not listed inline in the default view.
	if strings.Contains(stdout, "depA") {
		t.Errorf("indirect entries should not appear in default view; got:\n%s", stdout)
	}
}

// TestStatus_AllFetched_TwoGroupsNewestFirst: --all-fetched prints Direct (M):
// then Dependencies (K): groups, each newest-first, with no footer.
func TestStatus_AllFetched_TwoGroupsNewestFirst(t *testing.T) {
	root := initStatusWorkspace(t)
	// Two direct (one old, one recent) and two indirect.
	seedFetched(t, root, "directNew", 10*time.Minute, false)
	seedFetched(t, root, "directOld", 100*time.Hour, false)
	seedFetched(t, root, "depNew", 1*time.Hour, true)
	seedFetched(t, root, "depOld", 5*time.Hour, true)

	stdout, _, err := runStatusCmd(t, root, "--all-fetched")
	if err != nil {
		t.Fatalf("runStatus err = %v\nstdout=%s", err, stdout)
	}

	if !strings.Contains(stdout, "Direct (2):") {
		t.Errorf("missing Direct (2): group; got:\n%s", stdout)
	}
	if !strings.Contains(stdout, "Dependencies (2):") {
		t.Errorf("missing Dependencies (2): group; got:\n%s", stdout)
	}
	if strings.Contains(stdout, "for the full list") {
		t.Errorf("footer must not appear under --all-fetched; got:\n%s", stdout)
	}
	// All four entries are listed (window does not apply under --all-fetched).
	for _, id := range []string{"directNew", "directOld", "depNew", "depOld"} {
		if !strings.Contains(stdout, id) {
			t.Errorf("entry %s missing under --all-fetched; got:\n%s", id, stdout)
		}
	}

	// Newest-first within each group: directNew before directOld; depNew
	// before depOld.
	if idx := strings.Index(stdout, "directNew"); idx < 0 || idx > strings.Index(stdout, "directOld") {
		t.Errorf("Direct group not newest-first; got:\n%s", stdout)
	}
	if idx := strings.Index(stdout, "depNew"); idx < 0 || idx > strings.Index(stdout, "depOld") {
		t.Errorf("Dependencies group not newest-first; got:\n%s", stdout)
	}
	// Direct group precedes Dependencies group.
	if strings.Index(stdout, "Direct (2):") > strings.Index(stdout, "Dependencies (2):") {
		t.Errorf("Direct group should precede Dependencies; got:\n%s", stdout)
	}
}

// TestStatus_AllFetched_NewestFirstAcrossWindow confirms recency-window
// filtering is bypassed: an old direct entry still lists, newest first.
func TestStatus_RecentlyFetched_NewestFirst(t *testing.T) {
	root := initStatusWorkspace(t)
	seedFetched(t, root, "older", 10*time.Hour, false)
	seedFetched(t, root, "newer", 1*time.Hour, false)

	stdout, _, err := runStatusCmd(t, root)
	if err != nil {
		t.Fatalf("runStatus err = %v\nstdout=%s", err, stdout)
	}
	// Search only the section: the header lines echo the workspace path,
	// which can contain either id as a substring (macOS /var/folders).
	_, section, ok := strings.Cut(stdout, "Recently fetched (2):")
	if !ok {
		t.Fatalf("missing Recently fetched (2): section; got:\n%s", stdout)
	}
	if i := strings.Index(section, "newer"); i < 0 || i > strings.Index(section, "older") {
		t.Errorf("recently-fetched not newest-first; got:\n%s", stdout)
	}
}

// TestStatus_EmptyFetched_NoSection: an empty fetched map with no modified
// files prints the clean message and no Fetched section.
func TestStatus_EmptyFetched_NoSection(t *testing.T) {
	root := initStatusWorkspace(t)

	stdout, _, err := runStatusCmd(t, root)
	if err != nil {
		t.Fatalf("runStatus err = %v\nstdout=%s", err, stdout)
	}
	if strings.Contains(stdout, "Recently fetched") || strings.Contains(stdout, "Direct (") {
		t.Errorf("no Fetched section expected when fetched map is empty; got:\n%s", stdout)
	}
	if strings.Contains(stdout, "Modified:") {
		t.Errorf("no Modified section expected for an empty workspace; got:\n%s", stdout)
	}
}

// TestStatus_EmptyFetched_OtherSectionsUnaffected: with a modified workspace
// file but an empty fetched map, the Modified section renders and no Fetched
// section appears.
func TestStatus_EmptyFetched_OtherSectionsUnaffected(t *testing.T) {
	root := initStatusWorkspace(t)
	wsDir := filepath.Join(root, "Workspace")
	if err := os.MkdirAll(wsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wsDir, "Draft.lean"), []byte("theorem t : True := trivial\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, _, err := runStatusCmd(t, root)
	if err != nil {
		t.Fatalf("runStatus err = %v\nstdout=%s", err, stdout)
	}
	if !strings.Contains(stdout, "Modified:") {
		t.Errorf("Modified section missing; got:\n%s", stdout)
	}
	if !strings.Contains(stdout, "Workspace/Draft.lean") {
		t.Errorf("modified file missing; got:\n%s", stdout)
	}
	if strings.Contains(stdout, "Recently fetched") || strings.Contains(stdout, "Direct (") {
		t.Errorf("no Fetched section expected; got:\n%s", stdout)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestStatus_ReportsEveryLocalField(t *testing.T) {
	forbidHTTP(t)
	root := seedWorkspace(t)
	for name, body := range map[string]string{
		"lakefile.lean":    "package axiomClient where\n  version := v!\"2.0.0\"\n\nrequire AxiomLib from git \"https://github.com/BuildCoherence/axiom-lib\" @ \"v1.0.6-beta\"\n",
		"lean-toolchain":   "leanprover/lean4:v4.31.0\n",
		"Workspace/A.lean": "def a : Nat := 1\n",
	} {
		writeTestFile(t, filepath.Join(root, name), body)
	}
	if err := os.MkdirAll(filepath.Join(root, ".axiomdata"), 0o755); err != nil {
		t.Fatal(err)
	}
	skills, err := agentskills.LoadCanonical(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agentskills.Emit(root, []string{"claude", "cursor"}, skills); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, ".cursor", "skills", "formalize", "SKILL.md"), "hand edit\n")
	seedFetched(t, root, fxRoot, time.Hour, false)
	runGit(t, root, "init", "-q")
	runGit(t, root, "add", "-A")
	runGit(t, root, "commit", "-q", "-m", "fixture")
	writeTestFile(t, filepath.Join(root, "Workspace", "A.lean"), "def a : Nat := 2\n")

	home := setTestHome(t)
	fixture := fixtureCorpus()
	corpustest.Install(t, home, fixture)

	stdout, stderr, err := runStatusCmd(t, root)
	if err != nil {
		t.Fatalf("runStatus err = %v\nstderr=%s", err, stderr)
	}
	for _, want := range []string{
		"Template:      2.0.0\n",
		"Toolchain:     v4.31.0\n",
		"AxiomLib:      v1.0.6-beta\n",
		"Corpus:        " + fixture.FrozenAt.UTC().Format("20060102T150405Z") + " (5 files)\n",
		"Local files:   1 (1 modified)\n",
		"Fetched files: 1\n",
		"Git:           dirty (1 uncommitted change(s))\n",
		"Agent skills:  claude in sync, cursor stale; run `axm agents sync`\n",
		"Modified:\n  Workspace/A.lean\n",
		"Recently fetched (1):",
	} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout missing %q; got:\n%s", want, stdout)
		}
	}
}

func TestStatus_UnreadableFactsDegradeWithoutFailing(t *testing.T) {
	root := initStatusWorkspace(t)

	stdout, stderr, err := runStatusCmd(t, root)
	if err != nil {
		t.Fatalf("runStatus err = %v\nstderr=%s", err, stderr)
	}
	for _, want := range []string{
		"Template:      unknown (",
		"Toolchain:     unknown (",
		"Corpus:        not installed; run `axm upgrade`\n",
		"Local files:   0 (0 modified)\n",
		"Git:           not a git repository\n",
		"Agent skills:  no agents configured\n",
	} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout missing %q; got:\n%s", want, stdout)
		}
	}
}
