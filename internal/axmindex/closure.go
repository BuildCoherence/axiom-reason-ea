package axmindex

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// parseWorkspaceImports returns each <X> in `import Workspace.<X>` lines
// of source, trimmed and deduplicated, preserving first-seen order. Lines
// that import `A.<base50>` are ignored — those resolve server-side, not
// in the workspace graph.
func parseWorkspaceImports(source []byte) []string {
	var out []string
	seen := map[string]struct{}{}
	sc := bufio.NewScanner(bytes.NewReader(source))
	// Allow long lines — spec doesn't bound them.
	sc.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "import ") {
			continue
		}
		rest := strings.TrimSpace(strings.TrimPrefix(line, "import "))
		// Drop any trailing line comment.
		if idx := strings.Index(rest, "--"); idx >= 0 {
			rest = strings.TrimSpace(rest[:idx])
		}
		if !strings.HasPrefix(rest, "Workspace.") {
			continue
		}
		name := strings.TrimPrefix(rest, "Workspace.")
		// Strip any trailing whitespace-delimited junk just in case.
		if sp := strings.IndexAny(name, " \t"); sp >= 0 {
			name = name[:sp]
		}
		if name == "" {
			continue
		}
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	return out
}

// importToPath resolves "Foo.Bar" -> "Workspace/Foo/Bar.lean".
func importToPath(name string) string {
	return "Workspace/" + strings.ReplaceAll(name, ".", "/") + ".lean"
}

// readSource reads the workspace file at path (path is relative to the
// workspace root). A missing file returns (nil, nil) so that imports
// pointing outside the workspace are simply ignored.
func (i *Index) readSource(path string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(i.root, path))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return data, nil
}

// TransitiveClosure expands seed paths to include every *modified* file
// reachable via `import Workspace.<X>` edges. "Modified" = current
// NormalizedHash differs from published.json's ContentHash, or no entry
// exists. Unmodified files are traversed through but not added. Output
// is sorted ascending by path. Imports that do not resolve inside the
// workspace are ignored: missing files (`os.IsNotExist`) are silently
// skipped, while other `os.Stat` errors (permissions, I/O, EMFILE, …)
// propagate so they surface loudly rather than masquerading as
// `unknown_workspace_import` downstream.
//
// Path-agnostic seed contract (spec-axioms-seed-expansion §3.1):
// seeds may be ANY workspace-relative path, including `Axioms.lean`.
// The walker parses each seed's source for `import Workspace.<X>` lines
// uniformly — there is NO `workspaceDir/`-prefix filter on seeds. This
// is what lets `axm check Axioms.lean` enroll modified workspace
// siblings reachable from `Axioms.lean`'s imports into the same batch.
// A future refactor that introduces a prefix filter on seeds would
// silently drop those siblings from the batch; the
// TestTransitiveClosure_AxiomsSeed* unit tests pin this invariant.
func (i *Index) TransitiveClosure(seeds []string) ([]string, error) {
	published, err := i.Published()
	if err != nil {
		return nil, err
	}

	// BFS. visited prevents re-traversal; modified accumulates the result.
	visited := map[string]struct{}{}
	modified := map[string]struct{}{}

	// Seed the queue and mark as visited so we don't loop.
	queue := make([]string, 0, len(seeds))
	for _, s := range seeds {
		if _, ok := visited[s]; ok {
			continue
		}
		visited[s] = struct{}{}
		queue = append(queue, s)
	}

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]

		src, err := i.readSource(cur)
		if err != nil {
			return nil, err
		}
		// A missing source file can still be "modified" if published.json has
		// a stale entry, but practically there is nothing to hash. Skip.
		if src != nil {
			isModified := true
			if entry, ok := published[cur]; ok {
				if NormalizedHash(src) == entry.ContentHash {
					isModified = false
				}
			}
			if isModified {
				modified[cur] = struct{}{}
			}

			// Traverse imports regardless of whether cur is modified (an
			// unmodified file may still transitively lead to modified ones).
			for _, name := range parseWorkspaceImports(src) {
				depPath := importToPath(name)
				// Only follow imports that resolve to a workspace file.
				// Discriminate non-existence (drop cleanly) from unexpected
				// I/O errors (propagate). Swallowing every error here would
				// silently surface as `unknown_workspace_import` downstream
				// (see spec-axioms-seed-expansion §4).
				absPath := filepath.Join(i.root, depPath)
				if _, err := os.Stat(absPath); err != nil {
					if os.IsNotExist(err) {
						continue
					}
					return nil, fmt.Errorf("stat %s: %w", absPath, err)
				}
				if _, already := visited[depPath]; already {
					continue
				}
				visited[depPath] = struct{}{}
				queue = append(queue, depPath)
			}
		}
	}

	out := make([]string, 0, len(modified))
	for p := range modified {
		out = append(out, p)
	}
	sort.Strings(out)
	return out, nil
}

// TransitiveOpenPaths computes, for each file in batch, the sorted set of
// ADDITIONAL same-user workspace files reachable transitively via
// `import Workspace.<X>` edges that are NOT among that file's direct workspace
// imports and are not the file itself. This is the path-level half of the
// junction/bundle transitive auto-open: a chain `Use → Bundle → Struct` makes
// `Struct` reachable from `Use` only through the bundle, so `Use` needs to
// open `Struct`'s namespace even though it never imports it directly.
//
// The walk reads sources from disk (via readSource), so it traverses THROUGH
// bundles that are unmodified / already-published and therefore not enrolled
// in the batch — those bundles still appear on the transitive path even though
// TransitiveClosure did not add them to the publish set. Only `Workspace.<X>`
// edges are followed; foreign `import A.<base50>` lines are ignored by
// parseWorkspaceImports, so a cross-user reference inside a bundle never leaks
// into the consumer's open set (strategy/namespaces.md: consensual cross-user
// activation).
//
// Output per file is sorted ascending by workspace path so the downstream
// `transitive_open_ids` byte emission is deterministic. Diamond paths
// (`Use → A → leaf` and `Use → B → leaf`) yield `leaf` exactly once.
// Missing/out-of-workspace imports are silently skipped; non-ENOENT stat
// errors propagate (same loudness contract as TransitiveClosure).
func (i *Index) TransitiveOpenPaths(batch []string) (map[string][]string, error) {
	out := make(map[string][]string, len(batch))
	for _, seed := range batch {
		reachable, directImports, err := i.reachableWorkspaceFiles(seed)
		if err != nil {
			return nil, err
		}

		// Subtract the seed's own DIRECT workspace imports and itself: the
		// transform already emits a direct `open` for each rewritten import,
		// and a file never opens its own namespace.
		direct := map[string]struct{}{seed: {}}
		for _, p := range directImports {
			direct[p] = struct{}{}
		}

		var extra []string
		for p := range reachable {
			if _, isDirect := direct[p]; isDirect {
				continue
			}
			extra = append(extra, p)
		}
		sort.Strings(extra)
		out[seed] = extra
	}
	return out, nil
}

// reachableWorkspaceFiles returns the set of workspace files reachable from
// seed by following `import Workspace.<X>` edges (transitively, excluding the
// seed itself), plus the seed's own direct workspace imports (every
// `import Workspace.<X>` in the seed, whether or not it resolves on disk — the
// caller subtracts these, so non-existent direct imports must still be
// reported). It reads every node's source from disk so it walks through
// unenrolled/published bundles. Only edges that resolve to an existing
// workspace file are followed; ENOENT is dropped, other stat errors propagate.
func (i *Index) reachableWorkspaceFiles(seed string) (map[string]struct{}, []string, error) {
	reachable := map[string]struct{}{}
	visited := map[string]struct{}{seed: {}}
	var directImports []string
	queue := []string{seed}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]

		src, err := i.readSource(cur)
		if err != nil {
			return nil, nil, err
		}
		if src == nil {
			continue
		}
		for _, name := range parseWorkspaceImports(src) {
			depPath := importToPath(name)
			if cur == seed {
				directImports = append(directImports, depPath)
			}
			absPath := filepath.Join(i.root, depPath)
			if _, err := os.Stat(absPath); err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return nil, nil, fmt.Errorf("stat %s: %w", absPath, err)
			}
			if _, seen := visited[depPath]; seen {
				continue
			}
			visited[depPath] = struct{}{}
			reachable[depPath] = struct{}{}
			queue = append(queue, depPath)
		}
	}
	return reachable, directImports, nil
}

// TopoSort orders files by workspace-import edges via Kahn's algorithm,
// tie-breaking on ascending path. Returns *ErrCycle on failure. Imports
// that resolve outside files are ignored.
//
// Edge direction: if A imports B, B must precede A in the result.
//
// Path-agnostic input contract (spec-axioms-seed-expansion §3.1):
// the same path-agnostic parsing applies as in TransitiveClosure — an
// `Axioms.lean` entry in `files` is sorted by the same rules. Note that
// `Axioms.lean` cannot be the TARGET of an `import Workspace.<X>` edge
// (its dotted name `Axioms` is not under the `Workspace.` namespace),
// so it never appears as a dep of another file; it lands wherever its
// outgoing import edges put it (typically last, after every
// `Workspace/<X>.lean` it imports). Cycles via Axioms are therefore
// not constructible — Axioms has no incoming edges in the workspace-
// import graph.
func (i *Index) TopoSort(files []string) ([]string, error) {
	// Membership for quick filtering of out-of-set imports.
	set := make(map[string]struct{}, len(files))
	for _, f := range files {
		set[f] = struct{}{}
	}

	// Build adjacency: deps[f] = set of in-set files that f imports.
	deps := make(map[string]map[string]struct{}, len(files))
	// reverse[d] = set of files that import d (used to decrement in-degrees).
	reverse := make(map[string]map[string]struct{}, len(files))
	for _, f := range files {
		deps[f] = map[string]struct{}{}
		reverse[f] = map[string]struct{}{}
	}

	for _, f := range files {
		src, err := i.readSource(f)
		if err != nil {
			return nil, err
		}
		if src == nil {
			continue
		}
		for _, name := range parseWorkspaceImports(src) {
			depPath := importToPath(name)
			if _, ok := set[depPath]; !ok {
				continue
			}
			if depPath == f {
				continue
			}
			if _, dup := deps[f][depPath]; dup {
				continue
			}
			deps[f][depPath] = struct{}{}
			reverse[depPath][f] = struct{}{}
		}
	}

	// Kahn's with ascending-path tiebreak: use a sorted "ready" list.
	ready := make([]string, 0, len(files))
	for _, f := range files {
		if len(deps[f]) == 0 {
			ready = append(ready, f)
		}
	}
	sort.Strings(ready)

	out := make([]string, 0, len(files))
	for len(ready) > 0 {
		cur := ready[0]
		ready = ready[1:]
		out = append(out, cur)

		// Any file that imported cur loses a dependency; if its deps set
		// empties, it becomes ready.
		var newlyReady []string
		for dependent := range reverse[cur] {
			delete(deps[dependent], cur)
			if len(deps[dependent]) == 0 {
				newlyReady = append(newlyReady, dependent)
			}
		}
		if len(newlyReady) > 0 {
			sort.Strings(newlyReady)
			ready = mergeSorted(ready, newlyReady)
		}
	}

	if len(out) != len(files) {
		// Cycle: gather the remaining nodes sorted by path.
		var remaining []string
		for _, f := range files {
			if len(deps[f]) > 0 {
				remaining = append(remaining, f)
			}
		}
		sort.Strings(remaining)
		return nil, &ErrCycle{Paths: remaining}
	}
	return out, nil
}

// mergeSorted merges two ascending slices into a new ascending slice.
func mergeSorted(a, b []string) []string {
	out := make([]string, 0, len(a)+len(b))
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		if a[i] <= b[j] {
			out = append(out, a[i])
			i++
		} else {
			out = append(out, b[j])
			j++
		}
	}
	out = append(out, a[i:]...)
	out = append(out, b[j:]...)
	return out
}
