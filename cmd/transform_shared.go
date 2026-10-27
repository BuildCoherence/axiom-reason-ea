package cmd

import (
	"fmt"
	"io"
	"strings"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/transform"
)

// axiomsLeanPath is the canonical location of the user's personal-axioms file
// at the workspace root. Hard-coded because the lean-client repo's lakefile
// pins this path (it's not configurable per design).
const axiomsLeanPath = "Axioms.lean"

// workspaceDir is the workspace-root-relative directory holding user files.
// Files inside are identified as "Workspace/<name>.lean" and may import each
// other via `import Workspace.<X>`. Pinned by the lean-client lakefile.
const workspaceDir = "Workspace"

// msgCheckingToolchain is the single canonical spinner label for the
// `lake --version` / CheckLakeInstalled probe, shared by check, fork, pull
// and init so the wording (also quoted in the user-flow docs) lives in one place.
const msgCheckingToolchain = "Checking Lean toolchain"

// workspaceImportMap builds the dotted-module-name → base50 file_id map the
// transform exe consumes. It merges two sources by precedence:
//
//	(a) pathToFileID — every file in this check batch
//	                   (freshly-minted file_ids).
//	(b) published    — prior-published siblings the transitive closure walked
//	                   through but did not enroll (last-known file_id from
//	                   .axiomdata/index/published.json).
//
// (a) wins on overlap; entries from (b) with an empty FileID are skipped so
// a malformed published.json record can't surface as a `some ""` mapping that
// silently bypasses the transform exe's defensive `unknown_workspace_import`
// rule (the exe distinguishes `none` from `some ""` only structurally).
//
// The same map is sent to every file in the batch — the exe only consults
// names that appear as imports in each file's source, so extra entries are
// inert. This single closure-wide table is what makes the basic incremental
// story work: editing one file in a multi-file workspace does not require
// re-publishing every sibling it imports. See
// the internal incremental-publish-prior-state-fallback doc.
//
// Why the (b) fallback is safe to trust without re-stat'ing the dep on
// disk: an entry survives in `published` only because TransitiveClosure
// computed NormalizedHash on the on-disk content and matched it against the
// recorded ContentHash; a mismatch (or a missing file) would have enrolled
// the dep in the batch (so it would live in pathToFileID instead). The
// (file_id, content_hash) pair recorded together is what makes the
// fallback hermetic — see the best-practice doc above.
func workspaceImportMap(pathToFileID map[string]string, published map[string]axmindex.Published) map[string]string {
	out := make(map[string]string, len(pathToFileID)+len(published))
	for p, fileID := range pathToFileID {
		if name, ok := workspacePathToImportName(p); ok {
			out[name] = fileID
		}
	}
	for p, entry := range published {
		if entry.FileID == "" {
			// Defensive: a malformed published.json record (FileID="") would
			// surface as `mapLookup -> some ""` to the transform exe and slip
			// past the `unknown_workspace_import` `none` guard, emitting a
			// broken `import A.` line. Cannot occur in normal operation; the
			// guard pins the loudness contract regardless.
			continue
		}
		if _, inBatch := pathToFileID[p]; inBatch {
			continue // (a) wins over (b)
		}
		if name, ok := workspacePathToImportName(p); ok {
			out[name] = entry.FileID
		}
	}
	return out
}

// transitiveOpenIDs resolves the per-file transitive-open path lists from
// idx.TransitiveOpenPaths into per-file base50 file_id lists for the transform
// exe's `transitive_open_ids` field. Each workspace path is mapped to its
// file_id by the SAME two-source precedence as workspaceImportMap: in-batch
// pathToFileID first (freshly-minted ids), then published.json (prior-
// published siblings the closure walked through but did not enroll). Records
// with an empty FileID are skipped so a malformed published.json entry can't
// surface as an `open ` of an empty id; paths that resolve to nothing are
// dropped (the transform's `unknown_workspace_import` guard still covers the
// direct-import case). Order is preserved from the (already path-sorted) input
// so the emitted opens are deterministic.
func transitiveOpenIDs(paths []string, pathToFileID map[string]string,
	published map[string]axmindex.Published) []string {
	if len(paths) == 0 {
		return nil
	}
	var ids []string
	for _, p := range paths {
		if id, ok := pathToFileID[p]; ok {
			if id != "" {
				ids = append(ids, id)
			}
			continue
		}
		if entry, ok := published[p]; ok && entry.FileID != "" {
			ids = append(ids, entry.FileID)
		}
	}
	return ids
}

// workspacePathToImportName maps a workspace-relative path
// "Workspace/Foo/Bar.lean" to the dotted import name "Workspace.Foo.Bar".
// Returns (_, false) for paths outside Workspace/ (e.g. Axioms.lean), which
// are never the target of an `import Workspace.<X>` line.
func workspacePathToImportName(p string) (string, bool) {
	const suffix = ".lean"
	prefix := workspaceDir + "/"
	if !strings.HasPrefix(p, prefix) || !strings.HasSuffix(p, suffix) {
		return "", false
	}
	stem := strings.TrimSuffix(strings.TrimPrefix(p, prefix), suffix)
	return "Workspace." + strings.ReplaceAll(stem, "/", "."), true
}

// printTransformErrors prints any per-file errors carried on resps to the
// supplied writer and returns true if at least one was found. Prints all
// errors (not just the first) so the user can fix them in one pass.
func printTransformErrors(w io.Writer, resps []transform.Response) bool {
	any := false
	for _, r := range resps {
		if r.Error == "" {
			continue
		}
		any = true
		message := ""
		if r.Details != nil {
			message = r.Details.Message
		}
		fmt.Fprintf(w, "  [transform error] %s (%s): %s\n",
			r.Path, r.Error, message)
		if r.Details != nil {
			if r.Details.Rule != "" {
				fmt.Fprintf(w, "    rule: %s\n", r.Details.Rule)
			}
			if r.Details.Pos != nil {
				fmt.Fprintf(w, "    at line %d, col %d\n",
					r.Details.Pos.Line, r.Details.Pos.Col)
			}
		}
	}
	return any
}
