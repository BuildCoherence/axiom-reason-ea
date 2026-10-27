package cmd

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/spf13/cobra"
)

func TestLocalAxiomsInSyncUsesRemoteIdentityAndLocalHash(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".axiomdata"), 0o755); err != nil {
		t.Fatal(err)
	}
	idx, err := axmindex.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	content := []byte("user_axioms {\n}\n")
	if err := os.WriteFile(filepath.Join(root, axiomsLeanPath), content, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetPublished(axiomsLeanPath, axmindex.Published{
		FileID: "abcdefgh", ContentHash: axmindex.NormalizedHash(content), PublishedAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}

	inSync, err := localAxiomsInSync(idx, "abcdefgh")
	if err != nil {
		t.Fatal(err)
	}
	if !inSync {
		t.Fatal("expected matching file to be in sync")
	}
	inSync, err = localAxiomsInSync(idx, "bcdefghi")
	if err != nil {
		t.Fatal(err)
	}
	if inSync {
		t.Fatal("expected remote identity mismatch")
	}
	if err := os.WriteFile(filepath.Join(root, axiomsLeanPath), []byte("changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	inSync, err = localAxiomsInSync(idx, "abcdefgh")
	if err != nil {
		t.Fatal(err)
	}
	if inSync {
		t.Fatal("expected local hash mismatch")
	}
}

func TestLocalMatchesSyncProtectsFirstPull(t *testing.T) {
	if localMatchesSync(nil, []byte("published\n")) {
		t.Fatal("every existing Axioms.lean must be protected when no sync record exists")
	}
	if localMatchesSync(map[string]axmindex.Published{}, []byte("authored\n")) {
		t.Fatal("an empty sync index must protect existing authored content")
	}

	current := []byte("previously synced\n")
	published := map[string]axmindex.Published{
		axiomsLeanPath: {ContentHash: axmindex.NormalizedHash(current)},
	}
	if !localMatchesSync(published, current) {
		t.Fatal("a recorded matching hash should be in sync")
	}
	if localMatchesSync(published, []byte("changed\n")) {
		t.Fatal("a recorded hash mismatch should be protected")
	}
}

func TestRenderAxiomsDiffIsDeterministic(t *testing.T) {
	got := renderAxiomsDiff([]byte("old\n"), []byte("new\n"))
	want := "--- Axioms.lean (local)\n+++ Axioms.lean (published)\n-old\n+new\n"
	if got != want {
		t.Fatalf("diff = %q, want %q", got, want)
	}
}

func writeSavedUsername(t *testing.T, username string) {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".axiom"), 0o700); err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"username":"` + username + `"}`)
	if err := os.WriteFile(filepath.Join(home, ".axiom", "config.json"), body, 0o600); err != nil {
		t.Fatal(err)
	}
}

func runPullCmd(t *testing.T, root string, args ...string) (string, string, error) {
	t.Helper()
	oldForce, oldCheck := pullForce, pullCheck
	pullForce, pullCheck = false, false
	t.Cleanup(func() { pullForce, pullCheck = oldForce, oldCheck })
	t.Chdir(root)
	cmd := &cobra.Command{Use: "pull", Args: cobra.MaximumNArgs(1), SilenceUsage: true, RunE: runPull}
	var outBuf, errBuf bytes.Buffer
	cmd.SetOut(&outBuf)
	cmd.SetErr(&errBuf)
	cmd.SetArgs(args)
	err := cmd.ExecuteContext(context.Background())
	return outBuf.String(), errBuf.String(), err
}

func assertPulledAlice(t *testing.T, root, capturePath string) {
	t.Helper()
	f := readCapturedTransform(t, capturePath).Files[0]
	if f.Path != axiomsLeanPath || f.FileID != fxRoot || f.Source != "root\n" {
		t.Errorf("transform file = %+v, want Axioms.lean from corpus root %s", f, fxRoot)
	}
	got, err := os.ReadFile(filepath.Join(root, axiomsLeanPath))
	if err != nil {
		t.Fatal(err)
	}
	want := "-- axm: synced with snapshot " + fxRoot + " at 2026-11-01T12:00:00Z. Run 'axm pull alice' before editing.\nuser_axioms {\n}\n"
	if string(got) != want {
		t.Errorf("Axioms.lean = %q, want %q", got, want)
	}
	golden, err := os.ReadFile(filepath.Join(testdataDir, "fetched-golden-fork.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := readFetchedJSON(t, root); !bytes.Equal(got, golden) {
		t.Errorf("fetched.json differs from golden\n got: %s\nwant: %s", got, golden)
	}
	idx, err := axmindex.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	published, err := idx.Published()
	if err != nil {
		t.Fatal(err)
	}
	if e := published[axiomsLeanPath]; e.FileID != fxRoot || !e.PublishedAt.Equal(fxFrozenAt) {
		t.Errorf("published[Axioms.lean] = %+v, want snapshot %s at %s", e, fxRoot, fxFrozenAt)
	}
}

func TestRunPull_SavedUsername(t *testing.T) {
	installFixtureCorpus(t)
	pinClock(t)
	writeSavedUsername(t, "alice")
	root := initFetchWorkspace(t)
	capturePath := installCapturingTransform(t, axiomsLeanPath, fxRoot, "user_axioms {\n}\n")

	stdout, stderr, err := runPullCmd(t, root)
	if err != nil {
		t.Fatalf("runPull: %v\nstderr: %s", err, stderr)
	}
	assertPulledAlice(t, root, capturePath)
	if !strings.Contains(stdout, "Pulled "+fxRoot+" → Axioms.lean (4 dependencies cached)") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestRunPull_ExplicitMixedCaseUsernameOverridesSaved(t *testing.T) {
	installFixtureCorpus(t)
	pinClock(t)
	writeSavedUsername(t, "bob")
	root := initFetchWorkspace(t)
	capturePath := installCapturingTransform(t, axiomsLeanPath, fxRoot, "user_axioms {\n}\n")

	if _, stderr, err := runPullCmd(t, root, "ALiCe"); err != nil {
		t.Fatalf("runPull: %v\nstderr: %s", err, stderr)
	}
	assertPulledAlice(t, root, capturePath)
}

func TestRunPull_UnknownOrMissingUsername(t *testing.T) {
	cases := []struct {
		name  string
		saved string
		args  []string
		want  string
	}{
		{"unknown explicit", "", []string{"bob"}, "no published Axiom for bob in the corpus (frozen 2026-11-01)"},
		{"unknown saved", "Carol", nil, "no published Axiom for Carol in the corpus (frozen 2026-11-01)"},
		{"none given or saved", "", nil, "no username given or saved; usage: axm pull <username>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			installFixtureCorpus(t)
			if tc.saved != "" {
				writeSavedUsername(t, tc.saved)
			}
			root := initFetchWorkspace(t)
			_, _, err := runPullCmd(t, root, tc.args...)
			if err == nil || err.Error() != tc.want {
				t.Fatalf("runPull error = %v, want %q", err, tc.want)
			}
			if _, statErr := os.Stat(filepath.Join(root, axiomsLeanPath)); !os.IsNotExist(statErr) {
				t.Errorf("pull wrote Axioms.lean: %v", statErr)
			}
		})
	}
}
