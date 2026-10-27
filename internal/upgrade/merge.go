// Package upgrade implements the workspace and binary phases of
// `axm upgrade`. This file (merge.go) covers the workspace phase's
// git-merge-tree integration: invoke `git merge-tree --write-tree -z`,
// parse the NUL-separated output, enumerate clean changes, and bucket
// each touched path into one of three Outcome values for the
// orchestrator in workspace.go.
//
// See the internal spec-axm-upgrade-workspace doc § "merge.go — git
// merge-tree integration" for the design rationale.
package upgrade

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// Outcome buckets a single path's merge result, mirroring user-flow
// step 8's clean merge / build-config conflict / non-build-config
// conflict — with the clean-merge bucket split into OutcomeClean (write
// merged content) and OutcomeCleanDelete (remove the file), and a
// dedicated OutcomeModifyDeleteConflict for the modify/delete case (the
// incoming version deleted a file the Workspace edited). The classifier
// in this package is the only place that decides between the conflict
// outcomes; the orchestrator in workspace.go consumes the typed value.
type Outcome int

const (
	// OutcomeClean — the merge produced new content for this path with
	// no conflict markers; MergedBlobSHA on the FileChange points at
	// the resulting blob inside the unreferenced merge tree.
	OutcomeClean Outcome = iota

	// OutcomeCleanDelete — the merge cleanly *removed* this path: it was
	// present at HEAD, the incoming version deleted it, and the user
	// hadn't edited it (so there is no conflict). There is no blob to
	// resolve — the path is absent from the merge tree — so MergedBlobSHA
	// is empty and the apply step deletes the file from the working tree.
	// Splitting this out from OutcomeClean is what keeps
	// annotateCleanChanges from running `git rev-parse <tree>:<path>` on a
	// path the merge tree doesn't contain: that call fails with exit 128
	// ("path ... exists on disk, but not in <tree>") and previously
	// crashed the whole upgrade whenever the incoming version removed a
	// file (e.g. a retired AI-skill directory).
	OutcomeCleanDelete

	// OutcomeBuildConfigConflict — merge-tree reported a conflict and
	// the path is one of the hardcoded build-config filenames
	// (lakefile.lean, lean-toolchain, lake-manifest.json). Surfaced
	// through the user-flow step 9 prompt.
	OutcomeBuildConfigConflict

	// OutcomeNonBuildConfigConflict — merge-tree reported a conflict
	// and the path is not a build-config file. The orchestrator writes
	// the new version alongside the user's edits as `<path>.axmnew`.
	OutcomeNonBuildConfigConflict

	// OutcomeModifyDeleteConflict — a modify/delete conflict: the incoming
	// version deleted this path while the Workspace modified it, so
	// merge-tree reports a conflict whose records carry no stage 3 (theirs
	// is gone). There is no new version to write as `<path>.axmnew` (it
	// was deleted), and the merge tree already holds the user's edited
	// version — so the apply step keeps the file exactly as-is on disk,
	// stages nothing for it, and warns the user to decide whether to keep
	// their edits or remove the file. MergedBlobSHA is empty. Detecting
	// this is what stops the apply step from `git cat-file`-ing the
	// nonexistent new blob (`axiom-client/<tag>:<path>`), which fails with
	// exit 128 and would otherwise abort the upgrade.
	OutcomeModifyDeleteConflict
)

// FileChange describes one path the merge would touch.
type FileChange struct {
	Path    string
	Outcome Outcome

	// MergedBlobSHA is set only when Outcome == OutcomeClean — the SHA of
	// the resulting blob inside the merge-tree object. Empty for
	// OutcomeCleanDelete (the path is absent from the merge tree — the
	// apply step removes the file) and for conflicts (their resolution
	// comes from the new version, not the merge — build-config conflicts
	// copy from axiom-client/<tag>:<path>; non-build-config conflicts
	// write that to <path>.axmnew).
	MergedBlobSHA string
}

// MergeResult is the parsed output of `git merge-tree --write-tree -z`.
// TreeSHA is always populated (merge-tree writes the merged tree object
// even when there were conflicts — the conflicts are reported as a
// separate stream after the SHA). Changes is the per-path classification
// — conflicts first (populated by parseMergeTreeOutput), then clean
// changes — adds/modifies and deletes (populated by annotateCleanChanges).
type MergeResult struct {
	TreeSHA string
	Changes []FileChange
}

// buildConfigPaths is the hardcoded list of paths whose conflicts are
// surfaced through the user-flow step 9 all-or-nothing prompt. Per the
// design's "Workspace upgrade phase → `git merge-tree --write-tree`
// classification" section: lakefile.lean, lean-toolchain,
// lake-manifest.json. Hardcoded (not config-driven) by the design —
// the policy IS the policy.
var buildConfigPaths = map[string]struct{}{
	"lakefile.lean":      {},
	"lean-toolchain":     {},
	"lake-manifest.json": {},
}

// isBuildConfig reports whether path is one of the hardcoded build-config
// filenames. Path is the repo-relative path emitted by git (forward
// slashes on all platforms; git normalizes).
func isBuildConfig(path string) bool {
	_, ok := buildConfigPaths[path]
	return ok
}

// ClassifyMerge runs `git merge-tree --write-tree -z HEAD <targetRef>`
// inside repoDir, parses the NUL-separated output, and returns the
// per-path classification plus the merge-tree SHA (used by the apply
// step to extract clean-merged blobs via `git cat-file -p`).
//
// The function does NOT touch the working tree. The merge-tree object
// is written to git's object database but is unreferenced — `git gc`
// will collect it.
//
// Exit codes: 0 if clean, 1 if conflicts. Any other exit code is an
// unexpected git failure (target ref unknown, repo corruption, etc.)
// and is returned as an error. stderr is captured and included in the
// error message for diagnostics.
//
// After the merge-tree call, ClassifyMerge runs
//
//	`git diff-tree -r --name-status HEAD <tree_sha>`
//
// to enumerate the union of (clean-changed paths + conflicted paths)
// together with each path's change status, then subtracts the conflict
// set (already known from merge-tree's own output) to yield the clean
// set. A clean deletion (status "D") is recorded as OutcomeCleanDelete
// with no blob; for every other clean change it resolves the blob SHA
// via `git rev-parse <tree_sha>:<path>`.
func ClassifyMerge(ctx context.Context, repoDir, targetRef string) (*MergeResult, error) {
	cmd := exec.CommandContext(ctx, "git",
		"-C", repoDir,
		"merge-tree", "--write-tree", "-z",
		"HEAD", targetRef,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	// Exit 0 = clean; exit 1 = conflicts (still a valid result we want
	// to parse). Anything else is a real failure.
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			if exitErr.ExitCode() != 1 {
				return nil, fmt.Errorf(
					"git merge-tree: exit %d: %s",
					exitErr.ExitCode(), strings.TrimSpace(stderr.String()),
				)
			}
			// Exit 1 = conflicts; parse the output.
		} else {
			return nil, fmt.Errorf("git merge-tree: %w (stderr: %s)",
				err, strings.TrimSpace(stderr.String()))
		}
	}

	result, err := parseMergeTreeOutput(stdout.Bytes())
	if err != nil {
		return nil, fmt.Errorf("git merge-tree: parsing output: %w", err)
	}

	if err := annotateCleanChanges(ctx, repoDir, result); err != nil {
		return nil, fmt.Errorf("git merge-tree: annotating clean changes: %w", err)
	}

	return result, nil
}

// parseMergeTreeOutput parses the NUL-separated output of
// `git merge-tree --write-tree -z HEAD <ref>`. It returns the merged
// tree SHA and the conflicted paths bucketed into BuildConfigConflict,
// NonBuildConfigConflict, or ModifyDeleteConflict (a conflict whose
// records carry no stage-3 record — the incoming version deleted a path
// the Workspace modified); clean changes are NOT populated by this
// function — annotateCleanChanges is called separately to enumerate
// them (the merge-tree output alone doesn't list cleanly-merged paths).
//
// Pure function: no git invocation, no filesystem access. Tested
// directly in merge_test.go against captured-output fixtures.
//
// Output format (verified against git 2.43.0 — `git merge-tree
// --write-tree -z HEAD <ref>`):
//
//	<tree-OID>\0                                       (section 1)
//	<mode> <object> <stage>\t<path>\0   (repeated)     (section 2: conflicts)
//	\0                                                 (section separator)
//	<informational messages…>\0  (repeated)            (section 3, ignored)
//
// The crucial subtlety the original parser got wrong: `-z` only swaps
// each record's *line terminator* (newline → NUL). Within a
// conflicted-file record the mode/object/stage stay SPACE-separated and
// a single TAB precedes the path — the fields are NOT each NUL-separated.
// So a conflicted path is ONE NUL-terminated record, not four. A clean
// merge (exit 0) emits only section 1; sections 2–3 are absent.
//
// Defensive errors on malformed output (record without a TAB, non-hex
// tree SHA, etc.) include the raw stdout in the error message so users
// can file a clear bug report against a surprising git build.
func parseMergeTreeOutput(stdout []byte) (*MergeResult, error) {
	if len(stdout) == 0 {
		return nil, errors.New("empty output (expected tree SHA)")
	}

	// Records are NUL-separated. bytes.Split with `\0` yields the
	// segments; a well-formed output ends with a trailing NUL, so the
	// last segment is empty and we drop it. If the trailing NUL is
	// missing (older git, truncated read), tolerate by keeping the
	// last segment.
	parts := bytes.Split(stdout, []byte{0})
	if len(parts) > 0 && len(parts[len(parts)-1]) == 0 {
		parts = parts[:len(parts)-1]
	}

	if len(parts) < 1 {
		return nil, errors.New("no tree SHA in output")
	}
	treeSHA := string(parts[0])
	if !looksLikeSHA(treeSHA) {
		return nil, fmt.Errorf("first field %q is not a 40-char hex SHA", treeSHA)
	}
	result := &MergeResult{TreeSHA: treeSHA}

	// Conflicted file info section: each record is one NUL-terminated
	// "<mode> <object> <stage>\t<path>" line. Iterate until the empty
	// record that separates this section from the human-readable
	// informational-messages section (or until the end of output, for a
	// clean merge that emitted no conflict records at all).
	//
	// A single conflicted path emits up to three records (stage 1 = base,
	// 2 = ours/HEAD, 3 = theirs/incoming). We aggregate them into one
	// FileChange per path, tracking whether a stage-3 record appears: its
	// absence means the incoming version deleted the path (a modify/delete
	// conflict), which the classifier below buckets as
	// OutcomeModifyDeleteConflict rather than a normal conflict — there is
	// no incoming version to offer, so the apply step must not try to read
	// one. `order` preserves first-seen order for a deterministic result.
	order := []string{}
	hasTheirs := map[string]bool{}
	for _, rec := range parts[1:] {
		if len(rec) == 0 {
			// Section separator: everything after is informational
			// messages, which we do not parse.
			break
		}
		// Record shape: "<mode> <object> <stage>\t<path>". The path is
		// everything after the TAB; the stage is the last space-separated
		// field of the prefix before it (we read it to detect the missing
		// stage 3 of a modify/delete conflict).
		tab := bytes.IndexByte(rec, '\t')
		if tab < 0 {
			return nil, fmt.Errorf(
				"conflict record %q has no TAB before the path: %q",
				string(rec), string(stdout),
			)
		}
		prefix := rec[:tab]
		sp := bytes.LastIndexByte(prefix, ' ')
		if sp < 0 {
			return nil, fmt.Errorf(
				"conflict record %q has a malformed mode/object/stage prefix: %q",
				string(rec), string(stdout),
			)
		}
		stage := string(prefix[sp+1:])
		path := string(rec[tab+1:])
		if path == "" {
			return nil, fmt.Errorf("empty path in conflict record: %q", string(stdout))
		}
		if _, ok := hasTheirs[path]; !ok {
			order = append(order, path)
			hasTheirs[path] = false
		}
		if stage == "3" {
			hasTheirs[path] = true
		}
	}

	for _, path := range order {
		var outcome Outcome
		switch {
		case !hasTheirs[path]:
			// No stage-3 (theirs) record: the incoming version deleted a
			// path the Workspace modified. Keep-local-and-warn at apply.
			outcome = OutcomeModifyDeleteConflict
		case isBuildConfig(path):
			outcome = OutcomeBuildConfigConflict
		default:
			outcome = OutcomeNonBuildConfigConflict
		}
		result.Changes = append(result.Changes, FileChange{
			Path:    path,
			Outcome: outcome,
			// MergedBlobSHA left empty — conflict resolution comes from
			// axiom-client/<tag> (or, for modify/delete, from keeping the
			// user's file), not the merge tree.
		})
	}

	return result, nil
}

// looksLikeSHA reports whether s is a 40-character lowercase hex SHA.
// (git defaults to SHA-1 today; if a Workspace ever ships SHA-256,
// this becomes a 64-char check. We keep it at 40 to match the current
// git default; a SHA-256 repo would surface a clear error here rather
// than silently miscount.)
func looksLikeSHA(s string) bool {
	if len(s) != 40 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// annotateCleanChanges runs `git diff-tree -r --name-status -z HEAD
// <tree_sha>` to enumerate all paths the merge would change together
// with each change's status, subtracts the already-known conflict set,
// and appends one FileChange per remaining path:
//
//   - a deletion (status "D") becomes FileChange{Outcome:
//     OutcomeCleanDelete} — no blob; the apply step removes the file.
//   - every other status (add / modify / type-change) becomes
//     FileChange{Outcome: OutcomeClean, MergedBlobSHA: <blob>}, the
//     blob resolved from the merge tree.
//
// Reading the status (rather than the old `--name-only`) is what lets a
// clean deletion skip the `git rev-parse <tree>:<path>` call: the
// deleted path is absent from the merge tree, so that call fails with
// exit 128 and aborts the upgrade — the pre-fix behaviour whenever the
// incoming version removed a file.
//
// Mutates result in place. Returns a wrapped error on any git failure.
func annotateCleanChanges(ctx context.Context, repoDir string, result *MergeResult) error {
	conflictSet := map[string]struct{}{}
	for _, c := range result.Changes {
		conflictSet[c.Path] = struct{}{}
	}

	cmd := exec.CommandContext(ctx, "git",
		"-C", repoDir,
		"diff-tree", "-r", "--name-status", "-z",
		"HEAD", result.TreeSHA,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git diff-tree: %w (stderr: %s)",
			err, strings.TrimSpace(stderr.String()))
	}

	changes, err := parseNameStatusZ(stdout.Bytes())
	if err != nil {
		return fmt.Errorf("git diff-tree: %w", err)
	}
	for _, ch := range changes {
		if _, isConflict := conflictSet[ch.path]; isConflict {
			continue
		}
		if ch.deleted {
			result.Changes = append(result.Changes, FileChange{
				Path:    ch.path,
				Outcome: OutcomeCleanDelete,
				// MergedBlobSHA left empty — the path is gone from the
				// merge tree; the apply step removes it from disk.
			})
			continue
		}
		blobSHA, err := revParseBlob(ctx, repoDir, result.TreeSHA, ch.path)
		if err != nil {
			return fmt.Errorf("resolving blob SHA for %s: %w", ch.path, err)
		}
		result.Changes = append(result.Changes, FileChange{
			Path:          ch.path,
			Outcome:       OutcomeClean,
			MergedBlobSHA: blobSHA,
		})
	}
	return nil
}

// nameStatusChange is one entry parsed from `git diff-tree
// --name-status -z`: the path that changed and whether the change was a
// deletion (status "D") — the one status with no blob in the merge tree
// to resolve.
type nameStatusChange struct {
	path    string
	deleted bool
}

// parseNameStatusZ parses the NUL-separated output of
// `git diff-tree -r --name-status -z <a> <b>`. Each change is emitted as
// a status token followed by its path field(s): one path for the
// ordinary A / M / D / T statuses, two (old then new) for the
// rename / copy R / C statuses. ClassifyMerge never passes -M / -C, so
// R / C never appear in practice — but consuming the second path for
// them keeps status/path alignment correct if that ever changes, rather
// than mis-reading a path as the next status token.
//
// Pure function: no git invocation, no filesystem access. Tested
// directly in merge_test.go against hand-built and captured fixtures.
func parseNameStatusZ(stdout []byte) ([]nameStatusChange, error) {
	fields := bytes.Split(stdout, []byte{0})
	// A well-formed stream ends with a trailing NUL, so the final segment
	// is empty — drop it. (Empty or absent output splits to a single
	// empty segment, i.e. zero changes.)
	if n := len(fields); n > 0 && len(fields[n-1]) == 0 {
		fields = fields[:n-1]
	}

	var out []nameStatusChange
	for i := 0; i < len(fields); {
		status := string(fields[i])
		i++
		if status == "" {
			return nil, fmt.Errorf("empty status token in diff-tree output: %q", string(stdout))
		}
		// R (rename) and C (copy) carry a similarity score (e.g. "R100")
		// and TWO path fields (old, new); the new path is what lands in
		// the merge tree. Every other status carries exactly one path.
		nPaths := 1
		if status[0] == 'R' || status[0] == 'C' {
			nPaths = 2
		}
		if i+nPaths > len(fields) {
			return nil, fmt.Errorf("status %q missing path field(s) in diff-tree output: %q", status, string(stdout))
		}
		path := string(fields[i+nPaths-1]) // new-side path
		i += nPaths
		if path == "" {
			return nil, fmt.Errorf("empty path for status %q in diff-tree output: %q", status, string(stdout))
		}
		out = append(out, nameStatusChange{
			path:    path,
			deleted: status[0] == 'D',
		})
	}
	return out, nil
}

// revParseBlob runs `git -C <repoDir> rev-parse <treeSHA>:<path>` and
// returns the resulting blob SHA. Used to resolve clean-merged blob
// content for the apply step.
func revParseBlob(ctx context.Context, repoDir, treeSHA, path string) (string, error) {
	cmd := exec.CommandContext(ctx, "git",
		"-C", repoDir,
		"rev-parse", treeSHA+":"+path,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git rev-parse: %w (stderr: %s)",
			err, strings.TrimSpace(stderr.String()))
	}
	sha := strings.TrimSpace(stdout.String())
	if !looksLikeSHA(sha) {
		return "", fmt.Errorf("expected blob SHA, got %q", sha)
	}
	return sha, nil
}
