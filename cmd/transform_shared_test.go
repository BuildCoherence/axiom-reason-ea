package cmd

import (
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
