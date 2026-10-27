package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/idcodec"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/spf13/cobra"
)

// TestNormalizeForkDest covers the four prefix/suffix combinations the
// design calls out: bare stem, .lean suffix, Workspace/ prefix, both.
func TestNormalizeForkDest(t *testing.T) {
	cases := map[string]string{
		"Foo":                "Workspace/Foo.lean",
		"Foo.lean":           "Workspace/Foo.lean",
		"Workspace/Foo":      "Workspace/Foo.lean",
		"Workspace/Foo.lean": "Workspace/Foo.lean",
		"Workspace/Sub/Bar":  "Workspace/Sub/Bar.lean",
		"Sub/Bar.lean":       "Workspace/Sub/Bar.lean",
	}
	for in, want := range cases {
		if got := normalizeForkDest(in); got != want {
			t.Errorf("normalizeForkDest(%q) = %q, want %q", in, got, want)
		}
	}
}

// installCapturingTransform stands in for `lake exe axm_transform`: it captures
// the request on stdin and answers with one success response for path. It
// returns the capture path.
func installCapturingTransform(t *testing.T, path, fileID, content string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake binary uses /bin/sh; not portable to windows")
	}
	resp, err := json.Marshal(map[string]any{"path": path, "file_id": fileID, "content": content, "depends_on": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	capturePath := filepath.Join(t.TempDir(), "captured-stdin.json")
	respPath := filepath.Join(t.TempDir(), "response.json")
	if err := os.WriteFile(respPath, append(resp, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	fakeBin := filepath.Join(t.TempDir(), "fake-axm-transform")
	script := "#!/bin/sh\ncat > \"$AXM_FAKE_CAPTURE\"\ncat \"$AXM_FAKE_RESPONSE\"\n"
	if err := os.WriteFile(fakeBin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AXM_TRANSFORM_BIN", fakeBin)
	t.Setenv("AXM_FAKE_CAPTURE", capturePath)
	t.Setenv("AXM_FAKE_RESPONSE", respPath)
	stubLakeOnPATH(t)
	t.Setenv("AXM_NO_SPINNER", "1")
	return capturePath
}

type capturedTransformRequest struct {
	Mode  string `json:"mode"`
	Files []struct {
		Path             string            `json:"path"`
		Source           string            `json:"source"`
		FileID           string            `json:"file_id"`
		ReverseImportMap map[string]string `json:"reverse_import_map"`
	} `json:"files"`
}

func readCapturedTransform(t *testing.T, capturePath string) capturedTransformRequest {
	t.Helper()
	captured, err := os.ReadFile(capturePath)
	if err != nil {
		t.Fatalf("reading captured stdin: %v", err)
	}
	var req capturedTransformRequest
	if err := json.Unmarshal(captured, &req); err != nil {
		t.Fatalf("decoding captured request: %v\nbody: %s", err, captured)
	}
	if req.Mode != "reverse" || len(req.Files) != 1 {
		t.Fatalf("transform request = %+v, want one reverse file", req)
	}
	return req
}

func runForkCmd(t *testing.T, root string, args ...string) (string, string, error) {
	t.Helper()
	t.Chdir(root)
	cmd := &cobra.Command{Use: "fork", Args: cobra.RangeArgs(1, 2), SilenceUsage: true, RunE: runFork}
	var outBuf, errBuf bytes.Buffer
	cmd.SetOut(&outBuf)
	cmd.SetErr(&errBuf)
	cmd.SetArgs(args)
	err := cmd.ExecuteContext(context.Background())
	return outBuf.String(), errBuf.String(), err
}

// TestRunForkBuildsReverseRequest covers the Go side of the reverse-transform
// contract (the transform itself is covered by the golden fixtures under
// axiom/lean-lib/test/axm_transform/reverse_*/): `axm fork` sends the corpus
// root bytes with a reverse_import_map built from published.json, caches only
// the root's dependency closure, and records the fork intent.
func TestRunForkBuildsReverseRequest(t *testing.T) {
	installFixtureCorpus(t)
	pinClock(t)
	root := initFetchWorkspace(t)
	idx, err := axmindex.Open(root)
	if err != nil {
		t.Fatalf("axmindex.Open: %v", err)
	}
	siblingFileID := idcodec.Mint()
	if err := idx.SetPublished("Workspace/Foo/Bar.lean", axmindex.Published{
		FileID:      siblingFileID,
		ContentHash: "deadbeef",
		PublishedAt: time.Now().UTC().Truncate(time.Second),
	}); err != nil {
		t.Fatalf("SetPublished: %v", err)
	}
	capturePath := installCapturingTransform(t, "Workspace/Dest.lean", fxRoot, "def Q : Nat := 0\n")

	stdout, stderr, err := runForkCmd(t, root, fxRoot, "Dest")
	if err != nil {
		t.Fatalf("runFork: %v\nstderr: %s", err, stderr)
	}

	f := readCapturedTransform(t, capturePath).Files[0]
	if f.Path != "Workspace/Dest.lean" || f.FileID != fxRoot {
		t.Errorf("transform file = %q/%q, want Workspace/Dest.lean/%s", f.Path, f.FileID, fxRoot)
	}
	if got := f.ReverseImportMap[siblingFileID]; got != "Workspace.Foo.Bar" {
		t.Errorf("reverse_import_map[%q] = %q, want Workspace.Foo.Bar", siblingFileID, got)
	}
	if f.Source != "root\n" {
		t.Errorf("transform source = %q, want the corpus root bytes", f.Source)
	}

	dest, err := os.ReadFile(filepath.Join(root, "Workspace", "Dest.lean"))
	if err != nil || string(dest) != "def Q : Nat := 0\n" {
		t.Errorf("Workspace/Dest.lean = %q, %v", dest, err)
	}
	if _, err := os.Stat(filepath.Join(root, ".axiomdata", "files", "A", fxRoot+".lean")); !os.IsNotExist(err) {
		t.Errorf("fork cached the root under A/: %v", err)
	}
	assertCachedContent(t, root, fxB, fxC, fxD, fxE)
	golden, err := os.ReadFile(filepath.Join(testdataDir, "fetched-golden-fork.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := readFetchedJSON(t, root); !bytes.Equal(got, golden) {
		t.Errorf("fetched.json differs from golden\n got: %s\nwant: %s", got, golden)
	}
	intents, err := idx.ForkIntents()
	if err != nil {
		t.Fatal(err)
	}
	if got := intents["Workspace/Dest.lean"]; got != fxRoot {
		t.Errorf("fork intent for Workspace/Dest.lean = %q, want %s", got, fxRoot)
	}
	if !strings.Contains(stdout, "Forked → Workspace/Dest.lean") || !strings.Contains(stdout, "from "+fxRoot+" — 4 dependencies cached") {
		t.Errorf("fork completion = %q", stdout)
	}
}

func TestRunFork_UnknownIDAborts(t *testing.T) {
	installFixtureCorpus(t)
	root := initFetchWorkspace(t)
	installCapturingTransform(t, "Workspace/Dest.lean", fxAbsent, "x\n")

	_, _, err := runForkCmd(t, root, fxAbsent, "Dest")
	want := fxAbsent + " not in the published corpus (frozen 2026-11-01)"
	if err == nil || err.Error() != want {
		t.Fatalf("runFork error = %v, want %q", err, want)
	}
	if _, statErr := os.Stat(filepath.Join(root, "Workspace", "Dest.lean")); !os.IsNotExist(statErr) {
		t.Errorf("fork wrote Workspace/Dest.lean for an unknown id")
	}
}
