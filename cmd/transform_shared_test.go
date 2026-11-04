package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
)

// Test_workspaceImportMap_PrecedenceFallback covers the two-source merge
// the centralized workspaceImportMap performs: in-batch pathToFileID first,
// then published.json's prior FileID for paths walked-through but not
// enrolled. Regression guard for #415, where the prior single-source map
// dropped out-of-batch unmodified deps and the transform exe hard-errored
// with `unknown_workspace_import`.
//
// The precedence and fallback semantics are documented in
// the internal incremental-publish-prior-state-fallback doc.
func Test_workspaceImportMap_PrecedenceFallback(t *testing.T) {
	pathToFileID := map[string]string{
		"Workspace/InBatch.lean": "FRESH_inbatch",
		"Workspace/Both.lean":    "FRESH_both", // wins over published
		"Axioms.lean":            "FRESH_axioms",
	}
	published := map[string]axmindex.Published{
		"Workspace/Prior.lean": {FileID: "PRIOR_prior"},
		"Workspace/Both.lean":  {FileID: "PRIOR_both_should_lose"},
		"Axioms.lean":          {FileID: "PRIOR_axioms_should_be_excluded"},
	}

	got := workspaceImportMap(pathToFileID, published)
	want := map[string]string{
		"Workspace.InBatch": "FRESH_inbatch",
		"Workspace.Prior":   "PRIOR_prior", // published.json fallback (the bug-fix)
		"Workspace.Both":    "FRESH_both",  // in-batch wins
		// Axioms.lean is filtered: it is never the target of an
		// `import Workspace.<X>` line, so neither source should surface it.
	}

	if len(got) != len(want) {
		t.Fatalf("import map size: got %d entries, want %d\n  got=%v\n  want=%v", len(got), len(want), got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("import map[%q] = %q, want %q", k, got[k], v)
		}
	}
}

// Test_transitiveOpenIDs_PrecedenceGuardOrder pins the path→file_id mapping
// for the junction transitive-open list (#800). It mirrors workspaceImportMap's
// two-source precedence (in-batch first, then published.json), skips empty-id
// records, drops paths that resolve to nothing, and preserves input order.
func Test_transitiveOpenIDs_PrecedenceGuardOrder(t *testing.T) {
	pathToFileID := map[string]string{
		"Workspace/InBatch.lean": "FRESH_inbatch",
		"Workspace/Empty.lean":   "", // in-batch but empty: must be skipped
	}
	published := map[string]axmindex.Published{
		"Workspace/Prior.lean":      {FileID: "PRIOR_prior"},
		"Workspace/PriorEmpty.lean": {FileID: ""}, // malformed: must be skipped
	}
	// Input is the already-path-sorted output of TransitiveOpenPaths; order
	// must be preserved on the way out.
	paths := []string{
		"Workspace/Empty.lean",      // skipped (empty in-batch id)
		"Workspace/InBatch.lean",    // FRESH_inbatch
		"Workspace/Missing.lean",    // resolves to nothing → dropped
		"Workspace/Prior.lean",      // PRIOR_prior (published fallback)
		"Workspace/PriorEmpty.lean", // skipped (empty published id)
	}
	got := transitiveOpenIDs(paths, pathToFileID, published)
	want := []string{"FRESH_inbatch", "PRIOR_prior"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}

	// Empty input → nil (so the omitempty field stays off the wire).
	if got := transitiveOpenIDs(nil, pathToFileID, published); got != nil {
		t.Fatalf("empty input: got %v, want nil", got)
	}
}

// Test_workspaceImportMap_NestedNamespaceFromPublishedFallback pins the
// nested-namespace path → import-name mapping specifically through the
// published.json fallback branch. A regression in path-derivation on the
// fallback side would silently drop nested-namespace imports for exactly
// the scenario the #415 fix targets (out-of-batch unmodified sibling).
func Test_workspaceImportMap_NestedNamespaceFromPublishedFallback(t *testing.T) {
	pathToFileID := map[string]string{} // deliberately empty: force the fallback branch
	published := map[string]axmindex.Published{
		"Workspace/Foo/Bar.lean": {FileID: "PRIOR_nested"},
	}
	got := workspaceImportMap(pathToFileID, published)
	if got["Workspace.Foo.Bar"] != "PRIOR_nested" {
		t.Errorf("nested namespace via published.json fallback: got %q, want %q",
			got["Workspace.Foo.Bar"], "PRIOR_nested")
	}
}

// Test_workspaceImportMap_EmptyFileIDIsSkipped pins the loudness-contract
// guard: a malformed published.json record with FileID="" must NOT surface
// as a `some ""` mapping to the transform exe. The exe's
// `unknown_workspace_import` rule distinguishes `none` from `some ""`
// structurally, so an empty-string entry would slip past it and produce a
// broken `import A.` line. See workspaceImportMap's defensive guard.
func Test_workspaceImportMap_EmptyFileIDIsSkipped(t *testing.T) {
	pathToFileID := map[string]string{}
	published := map[string]axmindex.Published{
		"Workspace/Malformed.lean": {FileID: ""},
		"Workspace/OK.lean":        {FileID: "PRIOR_ok"},
	}
	got := workspaceImportMap(pathToFileID, published)
	if _, present := got["Workspace.Malformed"]; present {
		t.Errorf("empty-FileID entry must be skipped; got %q", got["Workspace.Malformed"])
	}
	if got["Workspace.OK"] != "PRIOR_ok" {
		t.Errorf("non-empty entry must pass through; got %q", got["Workspace.OK"])
	}
}

// installWorkspaceLake puts a fake `lake` on PATH that behaves like elan with
// no default toolchain: `lake --version` succeeds only in a directory holding
// lean-toolchain. `lake build` touches marker and exits buildExit.
func installWorkspaceLake(t *testing.T, marker, buildExit string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("lake shim uses /bin/sh; not portable to windows")
	}
	dir := t.TempDir()
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = build ]; then touch '" + marker + "'; exit " + buildExit + "; fi\n" +
		"[ -f lean-toolchain ] || { echo 'error: no default toolchain configured' >&2; exit 1; }\n"
	if err := os.WriteFile(filepath.Join(dir, "lake"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// installNeedsBuildTransform stands in for `lake exe axm_transform` in a
// Workspace whose Axiom library is unbuilt: it fails as the real exe does
// until marker exists, then answers one success response for path.
func installNeedsBuildTransform(t *testing.T, marker, path, fileID, content string) {
	t.Helper()
	resp, err := json.Marshal(map[string]any{"path": path, "file_id": fileID, "content": content, "depends_on": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	respPath := filepath.Join(t.TempDir(), "response.json")
	if err := os.WriteFile(respPath, append(resp, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(t.TempDir(), "needs-build-axm-transform")
	script := "#!/bin/sh\ncat > /dev/null\n" +
		"[ -f '" + marker + "' ] || { echo \"unknown module prefix 'Axiom'\" >&2; exit 1; }\n" +
		"cat '" + respPath + "'\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AXM_TRANSFORM_BIN", bin)
}

// reverseTransformCommands are the commands that reverse-transform a corpus
// file into the Workspace, with the file each one writes.
var reverseTransformCommands = []struct {
	name   string
	run    func(t *testing.T, dir string) (string, string, error)
	output string
}{
	{"fork", func(t *testing.T, dir string) (string, string, error) {
		return runForkCmd(t, dir, fxRoot, "Dest")
	}, "Workspace/Dest.lean"},
	{"pull", func(t *testing.T, dir string) (string, string, error) {
		return runPullCmd(t, dir, "alice")
	}, axiomsLeanPath},
}

// TestReverseTransform_BuildsAxiomInWorkspaceRoot covers a Workspace whose
// init warm-up never ran, entered from a subdirectory with no elan default:
// the lake probe must run from the Workspace root and the Axiom library must
// be built before the reverse transform.
func TestReverseTransform_BuildsAxiomInWorkspaceRoot(t *testing.T) {
	for _, tc := range reverseTransformCommands {
		t.Run(tc.name, func(t *testing.T) {
			installFixtureCorpus(t)
			pinClock(t)
			t.Setenv("AXM_NO_SPINNER", "1")
			root := initFetchWorkspace(t)
			if err := os.WriteFile(filepath.Join(root, "lean-toolchain"), []byte("leanprover/lean4:v4.34.0\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			sub := filepath.Join(root, workspaceDir)
			if err := os.MkdirAll(sub, 0o755); err != nil {
				t.Fatal(err)
			}
			marker := filepath.Join(t.TempDir(), "built")
			installWorkspaceLake(t, marker, "0")
			installNeedsBuildTransform(t, marker, tc.output, fxRoot, "def Q : Nat := 0\n")

			if _, stderr, err := tc.run(t, sub); err != nil {
				t.Fatalf("%s: %v\nstderr: %s", tc.name, err, stderr)
			}
			got, err := os.ReadFile(filepath.Join(root, tc.output))
			if err != nil || !strings.HasSuffix(string(got), "def Q : Nat := 0\n") {
				t.Errorf("%s = %q (%v), want the reverse-transformed content", tc.output, got, err)
			}
		})
	}
}

func TestReverseTransform_BuildFailureStopsBeforeTransform(t *testing.T) {
	for _, tc := range reverseTransformCommands {
		t.Run(tc.name, func(t *testing.T) {
			installFixtureCorpus(t)
			root := initFetchWorkspace(t)
			if err := os.WriteFile(filepath.Join(root, "lean-toolchain"), []byte("leanprover/lean4:v4.34.0\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			capture := installCapturingTransform(t, tc.output, fxRoot, "x\n")
			installWorkspaceLake(t, filepath.Join(t.TempDir(), "built"), "1")

			_, stderr, err := tc.run(t, root)
			if err == nil {
				t.Fatalf("%s succeeded with a failing lake build; want an error", tc.name)
			}
			if !strings.Contains(stderr, "lake build axm_transform Axiom Env") {
				t.Errorf("stderr = %q, want the lake build remedy", stderr)
			}
			if _, statErr := os.Stat(capture); !os.IsNotExist(statErr) {
				t.Errorf("transform ran after a failed build (capture stat err = %v)", statErr)
			}
			if _, statErr := os.Stat(filepath.Join(root, tc.output)); !os.IsNotExist(statErr) {
				t.Errorf("%s wrote %s after a failed build", tc.name, tc.output)
			}
		})
	}
}
