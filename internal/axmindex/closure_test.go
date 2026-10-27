package axmindex

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"testing"
	"time"
)

// makeWorkspace writes the given map of workspace-relative paths to
// sources inside a fresh workspace root and returns an opened Index.
func makeWorkspace(t *testing.T, files map[string]string) *Index {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, axiomDataDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	for rel, content := range files {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	idx, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	return idx
}

func markPublished(t *testing.T, idx *Index, path, source string) {
	t.Helper()
	if err := idx.SetPublished(path, Published{
		FileID:      "fid-" + path,
		ContentHash: NormalizedHash([]byte(source)),
		PublishedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
}

func TestParseWorkspaceImports(t *testing.T) {
	src := []byte(`import Workspace.Foo
import Workspace.Foo.Bar -- trailing comment
import Mathlib.Tactic
import A.abcdef
import   Workspace.Dup
import Workspace.Dup
`)
	got := parseWorkspaceImports(src)
	want := []string{"Foo", "Foo.Bar", "Dup"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestImportToPath(t *testing.T) {
	if got := importToPath("Foo"); got != "Workspace/Foo.lean" {
		t.Fatalf("Foo -> %q", got)
	}
	if got := importToPath("Foo.Bar.Baz"); got != "Workspace/Foo/Bar/Baz.lean" {
		t.Fatalf("Foo.Bar.Baz -> %q", got)
	}
}

func TestTransitiveClosureSeedPlusModifiedDep(t *testing.T) {
	rootSrc := "import Workspace.Dep\ntheorem r : True := trivial\n"
	depSrc := "theorem d : True := trivial\n"
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Root.lean": rootSrc,
		"Workspace/Dep.lean":  depSrc,
	})
	// Neither is published: both "modified."
	got, err := idx.TransitiveClosure([]string{"Workspace/Root.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Workspace/Dep.lean", "Workspace/Root.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTransitiveClosureUnmodifiedDepSkipped(t *testing.T) {
	rootSrc := "import Workspace.Dep\ntheorem r : True := trivial\n"
	depSrc := "theorem d : True := trivial\n"
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Root.lean": rootSrc,
		"Workspace/Dep.lean":  depSrc,
	})
	// Mark Dep as published with matching hash.
	markPublished(t, idx, "Workspace/Dep.lean", depSrc)

	got, err := idx.TransitiveClosure([]string{"Workspace/Root.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Workspace/Root.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTransitiveOpenPaths_BundleChain(t *testing.T) {
	// Use -> Bundle -> Struct. Use's transitive opens must include Struct
	// (reachable only through the bundle) but not Bundle (a direct import)
	// nor Use itself.
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Use.lean":    "import Workspace.Bundle\n",
		"Workspace/Bundle.lean": "import Workspace.Struct\n",
		"Workspace/Struct.lean": "structure S where\n",
	})
	got, err := idx.TransitiveOpenPaths([]string{
		"Workspace/Use.lean", "Workspace/Bundle.lean", "Workspace/Struct.lean",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][]string{
		"Workspace/Use.lean":    {"Workspace/Struct.lean"},
		"Workspace/Bundle.lean": nil,
		"Workspace/Struct.lean": nil,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTransitiveOpenPaths_PublishedBundleTraversed(t *testing.T) {
	// The core hole: the bundle is UNMODIFIED/published, so TransitiveClosure
	// would walk through it without enrolling it. TransitiveOpenPaths reads
	// sources from disk regardless, so Use must still reach Struct through the
	// (unenrolled) bundle.
	bundleSrc := "import Workspace.Struct\n"
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Use.lean":    "import Workspace.Bundle\n",
		"Workspace/Bundle.lean": bundleSrc,
		"Workspace/Struct.lean": "structure S where\n",
	})
	markPublished(t, idx, "Workspace/Bundle.lean", bundleSrc)

	// Batch holds only the consumer and the leaf; the bundle is NOT enrolled.
	got, err := idx.TransitiveOpenPaths([]string{
		"Workspace/Use.lean", "Workspace/Struct.lean",
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"Workspace/Struct.lean"}; !reflect.DeepEqual(got["Workspace/Use.lean"], want) {
		t.Fatalf("Use opens = %v, want %v", got["Workspace/Use.lean"], want)
	}
}

func TestTransitiveOpenPaths_DiamondDedup(t *testing.T) {
	// Use -> A -> Leaf and Use -> B -> Leaf. Leaf must appear exactly once.
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Use.lean":  "import Workspace.A\nimport Workspace.B\n",
		"Workspace/A.lean":    "import Workspace.Leaf\n",
		"Workspace/B.lean":    "import Workspace.Leaf\n",
		"Workspace/Leaf.lean": "structure L where\n",
	})
	got, err := idx.TransitiveOpenPaths([]string{
		"Workspace/Use.lean", "Workspace/A.lean", "Workspace/B.lean", "Workspace/Leaf.lean",
	})
	if err != nil {
		t.Fatal(err)
	}
	// A and B are direct imports of Use; only Leaf is additional, once.
	if want := []string{"Workspace/Leaf.lean"}; !reflect.DeepEqual(got["Workspace/Use.lean"], want) {
		t.Fatalf("Use opens = %v, want %v", got["Workspace/Use.lean"], want)
	}
}

func TestTransitiveOpenPaths_ForeignEdgeExcluded(t *testing.T) {
	// The bundle imports a foreign `A.<base50>` plus a same-user leaf. The
	// foreign edge must NOT appear in Use's transitive opens (parseWorkspaceImports
	// ignores `A.<...>` lines), only the same-user Leaf.
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Use.lean":    "import Workspace.Bundle\n",
		"Workspace/Bundle.lean": "import Workspace.Leaf\nimport A.eANLcSAMNDTxsUJnRgSEbk\n",
		"Workspace/Leaf.lean":   "structure L where\n",
	})
	got, err := idx.TransitiveOpenPaths([]string{
		"Workspace/Use.lean", "Workspace/Bundle.lean", "Workspace/Leaf.lean",
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"Workspace/Leaf.lean"}; !reflect.DeepEqual(got["Workspace/Use.lean"], want) {
		t.Fatalf("Use opens = %v, want %v (foreign A.<id> must not appear)", got["Workspace/Use.lean"], want)
	}
}

func TestTransitiveOpenPaths_DeterministicOrdering(t *testing.T) {
	// Use reaches three leaves through three bundles. The returned set must be
	// sorted ascending by path regardless of import / map iteration order.
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Use.lean":   "import Workspace.MidC\nimport Workspace.MidA\nimport Workspace.MidB\n",
		"Workspace/MidA.lean":  "import Workspace.LeafZ\n",
		"Workspace/MidB.lean":  "import Workspace.LeafM\n",
		"Workspace/MidC.lean":  "import Workspace.LeafA\n",
		"Workspace/LeafA.lean": "structure A where\n",
		"Workspace/LeafM.lean": "structure M where\n",
		"Workspace/LeafZ.lean": "structure Z where\n",
	})
	got, err := idx.TransitiveOpenPaths([]string{"Workspace/Use.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Workspace/LeafA.lean", "Workspace/LeafM.lean", "Workspace/LeafZ.lean"}
	if !reflect.DeepEqual(got["Workspace/Use.lean"], want) {
		t.Fatalf("Use opens = %v, want %v", got["Workspace/Use.lean"], want)
	}
}

func TestTransitiveOpenPaths_DirectAndSelfExcluded(t *testing.T) {
	// Use directly imports both Bundle and Struct. Even though Struct is also
	// transitively reachable through Bundle, it is a DIRECT import, so it must
	// not be re-emitted; Use never opens itself either.
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Use.lean":    "import Workspace.Bundle\nimport Workspace.Struct\n",
		"Workspace/Bundle.lean": "import Workspace.Struct\n",
		"Workspace/Struct.lean": "structure S where\n",
	})
	got, err := idx.TransitiveOpenPaths([]string{
		"Workspace/Use.lean", "Workspace/Bundle.lean", "Workspace/Struct.lean",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got["Workspace/Use.lean"] != nil {
		t.Fatalf("Use opens = %v, want nil (direct imports + self excluded)", got["Workspace/Use.lean"])
	}
}

func TestTransitiveClosureDiamond(t *testing.T) {
	// Root -> Left, Right; Left -> Leaf; Right -> Leaf.
	files := map[string]string{
		"Workspace/Root.lean":  "import Workspace.Left\nimport Workspace.Right\n",
		"Workspace/Left.lean":  "import Workspace.Leaf\n",
		"Workspace/Right.lean": "import Workspace.Leaf\n",
		"Workspace/Leaf.lean":  "theorem l : True := trivial\n",
	}
	idx := makeWorkspace(t, files)

	got, err := idx.TransitiveClosure([]string{"Workspace/Root.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"Workspace/Leaf.lean",
		"Workspace/Left.lean",
		"Workspace/Right.lean",
		"Workspace/Root.lean",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	// Verify output is sorted.
	if !sort.StringsAreSorted(got) {
		t.Fatal("output is not sorted")
	}
}

func TestTransitiveClosureIgnoresOutOfWorkspaceImports(t *testing.T) {
	files := map[string]string{
		// Mathlib/A imports are not resolvable in the workspace graph.
		"Workspace/Root.lean": "import Mathlib.Tactic\nimport A.zzzz\n",
	}
	idx := makeWorkspace(t, files)
	got, err := idx.TransitiveClosure([]string{"Workspace/Root.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Workspace/Root.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTopoSortSimple(t *testing.T) {
	// A imports B imports C. Expected order: C, B, A.
	files := map[string]string{
		"Workspace/A.lean": "import Workspace.B\n",
		"Workspace/B.lean": "import Workspace.C\n",
		"Workspace/C.lean": "theorem c : True := trivial\n",
	}
	idx := makeWorkspace(t, files)
	got, err := idx.TopoSort([]string{
		"Workspace/A.lean", "Workspace/B.lean", "Workspace/C.lean",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Workspace/C.lean", "Workspace/B.lean", "Workspace/A.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTopoSortTiebreakAscending(t *testing.T) {
	// Independent files A, B, C — no imports among them. Ascending tiebreak.
	files := map[string]string{
		"Workspace/B.lean": "theorem b : True := trivial\n",
		"Workspace/A.lean": "theorem a : True := trivial\n",
		"Workspace/C.lean": "theorem c : True := trivial\n",
	}
	idx := makeWorkspace(t, files)
	got, err := idx.TopoSort([]string{"Workspace/B.lean", "Workspace/A.lean", "Workspace/C.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Workspace/A.lean", "Workspace/B.lean", "Workspace/C.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTopoSortTwoNodeCycle(t *testing.T) {
	files := map[string]string{
		"Workspace/A.lean": "import Workspace.B\n",
		"Workspace/B.lean": "import Workspace.A\n",
	}
	idx := makeWorkspace(t, files)
	_, err := idx.TopoSort([]string{"Workspace/A.lean", "Workspace/B.lean"})
	var cyc *ErrCycle
	if !errors.As(err, &cyc) {
		t.Fatalf("err = %v, want *ErrCycle", err)
	}
	wantPaths := map[string]bool{"Workspace/A.lean": true, "Workspace/B.lean": true}
	if len(cyc.Paths) != 2 {
		t.Fatalf("Paths len = %d, want 2: %v", len(cyc.Paths), cyc.Paths)
	}
	for _, p := range cyc.Paths {
		if !wantPaths[p] {
			t.Errorf("unexpected path in cycle: %q", p)
		}
	}
}

// TestTransitiveClosure_AxiomsSeedWalksWorkspaceEdges pins the path-
// agnostic-seed contract documented on TransitiveClosure (see
// the internal spec-axioms-seed-expansion doc §3.1). An `Axioms.lean` seed
// must traverse `import Workspace.<X>` edges into the closure on the
// same rules as a `Workspace/<X>.lean` seed. A future refactor that
// added a `Workspace/`-prefix filter on seeds would silently regress
// the publish-axioms user-flow contract; this test is the canary.
func TestTransitiveClosure_AxiomsSeedWalksWorkspaceEdges(t *testing.T) {
	axiomsSrc := "import Workspace.Helper\nuser_axioms { axiom foo : True }\n"
	helperSrc := "def helperX : Nat := 42\n"
	idx := makeWorkspace(t, map[string]string{
		"Axioms.lean":           axiomsSrc,
		"Workspace/Helper.lean": helperSrc,
	})
	// Neither published: both "modified" and both must appear in the closure.
	got, err := idx.TransitiveClosure([]string{"Axioms.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Axioms.lean", "Workspace/Helper.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// TestTransitiveClosure_AxiomsSeedSkipsUnmodifiedHelper pins the
// "walked-through-but-not-enrolled" half of the contract: when a
// workspace sibling reachable from `Axioms.lean` is unmodified
// (published.json hash matches), it must NOT be added to the closure
// even though the walker traverses through it. This is what makes the
// #420 prior-state import-map fallback compose cleanly with the
// Axioms-seeded closure (spec §4 row 2).
func TestTransitiveClosure_AxiomsSeedSkipsUnmodifiedHelper(t *testing.T) {
	axiomsSrc := "import Workspace.Helper\nuser_axioms { axiom foo : True }\n"
	helperSrc := "def helperX : Nat := 42\n"
	idx := makeWorkspace(t, map[string]string{
		"Axioms.lean":           axiomsSrc,
		"Workspace/Helper.lean": helperSrc,
	})
	// Mark Helper as published with matching hash so it is "unmodified".
	markPublished(t, idx, "Workspace/Helper.lean", helperSrc)

	got, err := idx.TransitiveClosure([]string{"Axioms.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Axioms.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// TestTopoSort_AxiomsLastAfterImportedHelper pins the topo-sort half
// of the path-agnostic contract: when `Axioms.lean` and a workspace
// helper it imports both appear in the input, Helper must precede
// Axioms in the output (because Axioms imports Helper). Axioms has no
// incoming workspace-import edges (its dotted name is not under
// `Workspace.`), so it lands at the end of the topo. See spec §3.1.
func TestTopoSort_AxiomsLastAfterImportedHelper(t *testing.T) {
	axiomsSrc := "import Workspace.Helper\nuser_axioms { axiom foo : True }\n"
	helperSrc := "def helperX : Nat := 42\n"
	idx := makeWorkspace(t, map[string]string{
		"Axioms.lean":           axiomsSrc,
		"Workspace/Helper.lean": helperSrc,
	})
	got, err := idx.TopoSort([]string{"Axioms.lean", "Workspace/Helper.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Workspace/Helper.lean", "Axioms.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// TestTransitiveClosure_PropagatesNonExistErrors pins the `os.Stat`
// discrimination contract: non-existence (`os.IsNotExist`) is silently
// skipped, but other stat errors (permissions, I/O) must propagate
// rather than masquerading as `unknown_workspace_import` downstream.
// See spec-axioms-seed-expansion §4 row 4 and the doc-comment on
// TransitiveClosure.
//
// We engineer a permission-denied stat by chmod'ing the parent directory
// of an imported workspace file to 0o000 so that os.Stat on the file
// inside it returns EACCES rather than ENOENT. The test self-skips when
// running as root (root bypasses permission checks) and on Windows
// (POSIX mode bits don't translate cleanly).
func TestTransitiveClosure_PropagatesNonExistErrors(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode 0o000 permission semantics don't apply on Windows")
	}
	if os.Geteuid() == 0 {
		t.Skip("root bypasses POSIX permission checks; cannot engineer EACCES")
	}
	rootSrc := "import Workspace.Locked\ntheorem r : True := trivial\n"
	depSrc := "theorem d : True := trivial\n"
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Root.lean":          rootSrc,
		"Workspace/LockedDir/foo.lean": depSrc, // ensure dir exists
	})
	// We import `Workspace.Locked` (-> Workspace/Locked.lean). Place that
	// file inside a directory we'll then chmod to 0o000 so os.Stat on the
	// file returns EACCES rather than ENOENT.
	lockedDir := filepath.Join(idx.root, "Workspace", "Sealed")
	if err := os.MkdirAll(lockedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	lockedFile := filepath.Join(lockedDir, "Inner.lean")
	if err := os.WriteFile(lockedFile, []byte(depSrc), 0o644); err != nil {
		t.Fatal(err)
	}
	// Rewrite Root to import Workspace.Sealed.Inner so the resolved path
	// is Workspace/Sealed/Inner.lean, whose parent we'll seal.
	rootSrc2 := "import Workspace.Sealed.Inner\ntheorem r : True := trivial\n"
	if err := os.WriteFile(filepath.Join(idx.root, "Workspace/Root.lean"), []byte(rootSrc2), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(lockedDir, 0o000); err != nil {
		t.Fatal(err)
	}
	// Restore perms in cleanup so t.TempDir's RemoveAll succeeds.
	t.Cleanup(func() { _ = os.Chmod(lockedDir, 0o755) })

	_, err := idx.TransitiveClosure([]string{"Workspace/Root.lean"})
	if err == nil {
		t.Fatal("expected stat error to propagate, got nil")
	}
	if os.IsNotExist(err) {
		t.Fatalf("expected non-IsNotExist error to propagate, got IsNotExist: %v", err)
	}
}

// TestTransitiveClosure_SkipsMissingWorkspaceFile pins the silent-skip
// half of the `os.Stat` discrimination contract (closure.go:142-147):
// when an `import Workspace.<X>` line resolves to a workspace path that
// does not exist on disk, the dep is silently skipped (`os.IsNotExist`
// branch). This complements TestTransitiveClosure_PropagatesNonExistErrors
// which pins the propagate half. A future refactor that flipped the
// discrimination order — e.g. propagating IsNotExist instead of
// continuing — would regress this branch undetected without this test.
//
// Note: TestTransitiveClosureIgnoresOutOfWorkspaceImports uses
// `import Mathlib.Tactic` / `import A.zzzz`, which are dropped by
// parseWorkspaceImports BEFORE os.Stat is reached. Here we use
// `import Workspace.Missing`, which survives parsing, resolves to
// `Workspace/Missing.lean`, and only gets dropped at the os.Stat
// IsNotExist check — exercising the exact branch in question.
func TestTransitiveClosure_SkipsMissingWorkspaceFile(t *testing.T) {
	rootSrc := "import Workspace.Missing\ntheorem r : True := trivial\n"
	idx := makeWorkspace(t, map[string]string{
		"Workspace/Root.lean": rootSrc,
		// Workspace/Missing.lean is intentionally absent on disk so that
		// os.Stat returns IsNotExist for the resolved import path.
	})
	got, err := idx.TransitiveClosure([]string{"Workspace/Root.lean"})
	if err != nil {
		t.Fatalf("expected IsNotExist dep to be silently skipped, got error: %v", err)
	}
	want := []string{"Workspace/Root.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTopoSortIgnoresOutOfSetImports(t *testing.T) {
	files := map[string]string{
		"Workspace/A.lean": "import Workspace.B\nimport Workspace.Outside\n",
		"Workspace/B.lean": "theorem b : True := trivial\n",
		// Outside file exists but is not passed to TopoSort.
		"Workspace/Outside.lean": "theorem o : True := trivial\n",
	}
	idx := makeWorkspace(t, files)
	got, err := idx.TopoSort([]string{"Workspace/A.lean", "Workspace/B.lean"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Workspace/B.lean", "Workspace/A.lean"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
