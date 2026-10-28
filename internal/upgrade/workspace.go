package upgrade

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/agentskills"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/cliprompt"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/lakefile"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
)

// Build metadata is excluded to match lakefile.ReadVersion's canonical gate.
var newTagRe = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`)

const unsetLeanClientTagSentinel = ""

// Sentinel errors for the workspace upgrade phase. All wrapped with %w
// at their respective failure sites so callers can errors.Is to
// dispatch on the specific failure mode and (where relevant) surface
// different exit codes or messages.
var (
	// ErrNoAxiomClientRemote — step 4 refusal. The Workspace lacks
	// the axiom-client remote (Workspace was created before the
	// axm init rename, or the user removed the remote).
	ErrNoAxiomClientRemote = errors.New("no axiom-client remote")

	// ErrUnreadableLakefile — step 5 refusal. Covers every failure
	// mode from lakefile.ReadVersion (missing package block, multiple
	// blocks, missing version field, unparseable value) AS WELL AS
	// I/O errors opening the file. The user-flow specifies the same
	// refusal copy for all of them.
	ErrUnreadableLakefile = errors.New("lakefile version unreadable")

	// ErrTagNotOnRemote — step 7b refusal. The lakefile parsed
	// cleanly but the named tag doesn't exist on the axiom-client
	// remote. Surfaces the same refusal copy as ErrUnreadableLakefile
	// per the design's single-refusal-copy rule.
	ErrTagNotOnRemote = errors.New("parsed lakefile version is not a published lean-client tag")

	// ErrUserAborted — step 9 rejection. User said N to the build-
	// config conflict prompt, or NonTTY && !Yes. Callers exit
	// non-zero but distinguish from genuine failures (no stack
	// trace, no "Error:" prefix — just the abort copy this package
	// already printed).
	ErrUserAborted = errors.New("upgrade aborted by user")

	// ErrDirtyWorktree — pre-apply refusal. The Workspace has staged or
	// unstaged changes to tracked files. The upgrade overwrites and
	// commits template-managed paths, so a dirty tree risks losing
	// unstaged edits and sweeping pre-staged work into the upgrade
	// commit (coherence-f6cn.3.3). The user commits/stashes, or passes
	// --allow-dirty to proceed anyway.
	ErrDirtyWorktree = errors.New("workspace has uncommitted changes")
)

// WorkspaceOptions carries the compiled target and workspace application policy.
type WorkspaceOptions struct {
	RepoDir    string // absolute path to Workspace root
	NewTag     string // lean_client.current_tag, bare StdVer e.g. "0.3.2" or "0.0.0-staging-<sha>"
	Yes        bool   // --yes / -y
	AllowDirty bool   // --allow-dirty: skip the clean-worktree precondition
	NonTTY     bool   // true when stdin is not a terminal
	Stdin      io.Reader
	Stdout     io.Writer
	Stderr     io.Writer
}

// WorkspaceResult is what RunWorkspaceUpgrade returns on success (or
// on ErrUserAborted, where it's nil — see RunWorkspaceUpgrade's
// godoc). Named `WorkspaceResult` (not `Result`) for the same reason
// WorkspaceOptions is renamed.
//
// RunWorkspaceUpgrade returns a non-nil `*WorkspaceResult` only when it
// acted — a successful upgrade or an "already up to date" short-circuit.
// A nil result signals a no-op sentinel branch (see the function's
// godoc for the cases).
type WorkspaceResult struct {
	OldTag            string   // bare StdVer from lakefile, e.g. "0.3.1" or "0.0.0-staging-<sha>"
	NewTag            string   // bare StdVer compiled into the caller
	AlreadyCurrent    bool     // true when step 6 short-circuits
	AxmNewWritten     []string // paths of .axmnew files written, sorted
	ModifyDeletedKept []string // paths kept from a modify/delete conflict (incoming deleted, user modified), sorted
	Removed           []string // paths removed by a clean deletion (incoming deleted, user hadn't edited), sorted
	BuildConfigDiff   bool     // lakefile.lean or lean-toolchain changed
	SkillsChanged     bool     // a canonical skill file was added, changed or removed
}

// RunWorkspaceUpgrade implements steps 4–13 of
// the internal upgrade-axiom-workspace doc. See the inline
// comments per step for the mapping from this function to the
// user-flow document.
//
// Returns:
//   - (*WorkspaceResult, nil) on success or already-current.
//   - (nil, nil) when the server has not published a lean_client target
//     yet (`lean_client.current_tag == ""`) — nothing to do; the skip
//     line goes to stderr.
//   - (nil, ErrUserAborted-wrapped) when the user rejects the
//     build-config conflict prompt (step 9). The caller prints the
//     abort message and exits non-zero — this function has already
//     printed nothing-changed copy to stdout.
//   - (nil, error) on any other failure: missing remote, lakefile
//     parse failure, git failure, etc. Each typed error wraps a
//     sentinel from this package so the caller can errors.Is to
//     dispatch.
func RunWorkspaceUpgrade(ctx context.Context, opts WorkspaceOptions) (*WorkspaceResult, error) {
	if opts.Stdout == nil {
		opts.Stdout = io.Discard
	}
	if opts.Stderr == nil {
		opts.Stderr = io.Discard
	}
	if opts.Stdin == nil {
		opts.Stdin = strings.NewReader("")
	}

	if opts.NewTag == unsetLeanClientTagSentinel {
		fmt.Fprintln(opts.Stderr, "Workspace upgrade skipped: server has no published lean-client tag yet. If this persists, ask your Axiom admin to publish a lean-client target.")
		return nil, nil
	}

	if !newTagRe.MatchString(opts.NewTag) {
		return nil, fmt.Errorf("axm upgrade: lean_client.current_tag %q has an unexpected shape (want a bare StdVer like 0.3.2 or 0.0.0-staging-<sha>)", opts.NewTag)
	}

	// The mirror carries the tag with a leading `v`; both lanes use this
	// form (production v0.3.2, staging v0.0.0-staging-<sha>). The bare
	// StdVer (opts.NewTag / the lakefile value) is the canonical
	// identifier; the `v`-prefixed form is the git ref. See
	// the internal mirror-repo-publishing doc § "Snapshot tags".
	newMirrorTag := "v" + opts.NewTag

	// Step 4: refuse if the Workspace was not initialized from the
	// lean-client mirror.
	if err := checkAxiomClientRemote(ctx, opts.RepoDir); err != nil {
		return nil, err
	}

	// Step 4b: refuse on a dirty working tree. The apply loop overwrites
	// template-managed paths with merged blobs and commits them, so an
	// unstaged edit to such a path would be lost with no reflog to recover
	// it, and a plain commit would sweep any pre-staged work into the
	// upgrade commit. Requiring a clean tree closes both (coherence-f6cn.3.3);
	// --allow-dirty is the escape hatch for a user who knows the risk.
	if !opts.AllowDirty {
		dirty, err := worktreeDirty(ctx, opts.RepoDir)
		if err != nil {
			return nil, err
		}
		if dirty {
			fmt.Fprintln(opts.Stderr, "axm upgrade: the Workspace has uncommitted changes.")
			fmt.Fprintln(opts.Stderr, "  Commit or stash them first so the upgrade cannot overwrite unstaged edits")
			fmt.Fprintln(opts.Stderr, "  or fold pre-staged work into its commit. Re-run with --allow-dirty to override.")
			return nil, fmt.Errorf("axm upgrade: %w", ErrDirtyWorktree)
		}
	}

	// Step 5: read the Workspace's current tag from lakefile.lean.
	oldTag, err := lakefile.ReadVersion(filepath.Join(opts.RepoDir, "lakefile.lean"))
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %w",
			ErrUnreadableLakefile,
			"Cannot determine this Workspace's lean-client version from lakefile.lean. Re-initialize with axm init.",
			err,
		)
	}

	if oldTag == opts.NewTag {
		fmt.Fprintf(opts.Stdout, "Workspace is already up to date at %s.\n", opts.NewTag)
		return &WorkspaceResult{
			OldTag:         oldTag,
			NewTag:         opts.NewTag,
			AlreadyCurrent: true,
		}, nil
	}

	// Step 7: fetch the target tag from axiom-client. Match the
	// existing pattern in cmd/init.go::preflightGitSource — set
	// GIT_TERMINAL_PROMPT=0 so a private-mirror credential prompt
	// returns a structured error rather than stalling on /dev/tty, and
	// capture stderr alongside streaming to opts.Stderr so the wrapped
	// error carries an actionable signal.
	// Fetch the mirror tag into a remote-tracking ref
	// (refs/remotes/axiom-client/<mirrorTag>) rather than the local
	// tag namespace, so the merge target `axiom-client/<mirrorTag>`
	// resolves and the user's own tags are never touched.
	newTrackingRef := "refs/remotes/axiom-client/" + newMirrorTag
	fetchCmd := exec.CommandContext(ctx, "git",
		"-C", opts.RepoDir,
		"fetch", "axiom-client",
		"+refs/tags/"+newMirrorTag+":"+newTrackingRef,
	)
	fetchCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var fetchErrBuf bytes.Buffer
	fetchCmd.Stdout = opts.Stdout
	fetchCmd.Stderr = io.MultiWriter(opts.Stderr, &fetchErrBuf)
	if err := fetchCmd.Run(); err != nil {
		return nil, fmt.Errorf("git fetch axiom-client %s: %w (stderr: %s)",
			newMirrorTag, err, strings.TrimSpace(fetchErrBuf.String()))
	}

	// Step 7b: validate the OLD tag exists on the remote. (Step 7
	// implicitly validates the NEW tag — if the fetch succeeded the
	// new tag exists. The old tag is the user-edited-lakefile drift
	// case.)
	oldTagFullRef := "refs/tags/v" + oldTag
	lsRemoteCmd := exec.CommandContext(ctx, "git",
		"-C", opts.RepoDir,
		"ls-remote", "--tags", "axiom-client", oldTagFullRef,
	)
	lsRemoteCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var lsOut, lsErrBuf bytes.Buffer
	lsRemoteCmd.Stdout = &lsOut
	lsRemoteCmd.Stderr = io.MultiWriter(opts.Stderr, &lsErrBuf)
	if err := lsRemoteCmd.Run(); err != nil {
		return nil, fmt.Errorf("git ls-remote axiom-client: %w (stderr: %s)",
			err, strings.TrimSpace(lsErrBuf.String()))
	}
	if strings.TrimSpace(lsOut.String()) == "" {
		return nil, fmt.Errorf("%w: %s: lakefile says %s, not on axiom-client",
			ErrTagNotOnRemote,
			"Cannot determine this Workspace's lean-client version from lakefile.lean. Re-initialize with axm init.",
			oldTag,
		)
	}

	// Step 8: classify what the merge would do. The target ref is
	// the local tracking ref produced by step 7's fetch
	// (`axiom-client/<tag>`).
	mergeResult, err := ClassifyMerge(ctx, opts.RepoDir, "axiom-client/"+newMirrorTag)
	if err != nil {
		return nil, fmt.Errorf("classifying merge: %w", err)
	}

	// Step 9: bucket the changes and prompt if needed.
	var buildConflicts []FileChange
	for _, c := range mergeResult.Changes {
		if c.Outcome == OutcomeBuildConfigConflict {
			buildConflicts = append(buildConflicts, c)
		}
	}

	if len(buildConflicts) > 0 {
		accepted, promptErr := promptBuildConfig(opts, buildConflicts)
		if promptErr != nil {
			return nil, promptErr
		}
		if !accepted {
			fmt.Fprintln(opts.Stdout, "Upgrade aborted. Your Workspace files are unchanged.")
			return nil, fmt.Errorf("%w", ErrUserAborted)
		}
	}

	// Step 10: apply the merge.
	//
	// For each change, source the file content per its outcome:
	//   - Clean         : git cat-file -p <MergedBlobSHA>
	//                     -> <repoDir>/<path>
	//   - BuildConfig   : git cat-file -p axiom-client/<tag>:<path>
	//                     -> <repoDir>/<path>            (accepted)
	//   - NonBuildConfig: git cat-file -p axiom-client/<tag>:<path>
	//                     -> <repoDir>/<path>.axmnew
	//
	// File writes are sequential. If any single write fails (disk
	// full, permission denied), we return the wrapped error and exit
	// with whatever partial state the OS produced — per user-flow
	// step 10.
	var axmNewWritten []string
	// modifyDeleted collects paths hit by a modify/delete conflict — the
	// incoming version deleted a file the Workspace edited. We keep the
	// user's file untouched (there is no new version to write) and warn
	// about them in the step-12 summary; none are staged or committed.
	var modifyDeleted []string
	// cleanDeleted collects paths removed by a clean deletion (the
	// incoming version deleted a file the Workspace hadn't edited). Unlike
	// modify/delete these ARE staged and committed; we surface the count
	// in the step-12 summary so a silent data removal doesn't go unnoticed.
	var cleanDeleted []string
	// touchedPaths is the set of paths to stage in step 11; staging
	// only these (rather than `git add -A`) keeps unrelated WIP user
	// edits out of the upgrade commit. Paths are stored as
	// repo-relative (the same shape git diff-tree / merge-tree emit)
	// and ordered by classification iteration so the final stage step
	// is deterministic.
	touchedPaths := make([]string, 0, len(mergeResult.Changes))
	buildConfigDiff := false
	for _, c := range mergeResult.Changes {
		if err := validateMergeTreePath(c.Path); err != nil {
			return nil, err
		}
		treePath := c.Path
		target := filepath.Join(opts.RepoDir, treePath)
		// Defence-in-depth: the resolved target must remain under
		// opts.RepoDir. filepath.Join already collapses `..`; recheck
		// explicitly to refuse a target whose canonical form escaped.
		absRepo, err := filepath.Abs(opts.RepoDir)
		if err != nil {
			return nil, fmt.Errorf("axm upgrade: resolve repo dir: %w", err)
		}
		absTarget, err := filepath.Abs(target)
		if err != nil {
			return nil, fmt.Errorf("axm upgrade: resolve target dir: %w", err)
		}
		if !strings.HasPrefix(absTarget+string(filepath.Separator), absRepo+string(filepath.Separator)) && absTarget != absRepo {
			return nil, fmt.Errorf("axm upgrade: refusing target outside repo root: %s", target)
		}

		var src string   // git object spec to cat-file (empty when removing)
		var dst string   // absolute path on disk
		var stage string // path to `git add` after the write/remove
		remove := false  // true for a clean deletion — remove dst instead of writing it

		switch c.Outcome {
		case OutcomeClean:
			src = c.MergedBlobSHA
			dst = target
			stage = treePath
		case OutcomeCleanDelete:
			// The incoming version removed this path and the user hadn't
			// edited it, so the merge deletes it cleanly. Remove it from
			// the working tree; `git add -- <path>` in step 11 stages the
			// removal (git records a deletion for a tracked path that is
			// gone from disk).
			remove = true
			dst = target
			stage = treePath
			cleanDeleted = append(cleanDeleted, treePath)
		case OutcomeModifyDeleteConflict:
			// The incoming version deleted this path, but the Workspace
			// modified it — a modify/delete conflict. There is no new
			// version to write (it was deleted), and the user's edits are
			// worth preserving, so keep the file exactly as-is on disk,
			// stage nothing, and warn in the summary. `continue` skips the
			// write/remove/stage tail below entirely.
			modifyDeleted = append(modifyDeleted, treePath)
			continue
		case OutcomeBuildConfigConflict:
			// accepted by the time we get here; otherwise we
			// returned ErrUserAborted above.
			src = "axiom-client/" + newMirrorTag + ":" + treePath
			dst = target
			stage = treePath
		case OutcomeNonBuildConfigConflict:
			src = "axiom-client/" + newMirrorTag + ":" + treePath
			dst = target + ".axmnew"
			stage = treePath + ".axmnew"
			// Refuse to silently overwrite a pre-existing .axmnew
			// companion the user may be mid-merging into the real
			// file. Surfacing this gives the user a clean remediation;
			// the alternative (silent overwrite) loses their
			// in-progress merge with no signal.
			if _, statErr := os.Stat(dst); statErr == nil {
				return nil, fmt.Errorf(
					"axm upgrade: %s already exists; resolve and delete it before re-running `axm upgrade`",
					dst,
				)
			}
			axmNewWritten = append(axmNewWritten, treePath+".axmnew")
		}

		if treePath == "lakefile.lean" || treePath == "lean-toolchain" {
			buildConfigDiff = true
		}

		if remove {
			if err := removeFromWorkingTree(opts.RepoDir, dst); err != nil {
				return nil, fmt.Errorf("applying deletion of %s: %w", treePath, err)
			}
		} else if err := writeFromGitObject(ctx, opts.RepoDir, src, dst); err != nil {
			return nil, fmt.Errorf("applying %s: %w", treePath, err)
		}
		touchedPaths = append(touchedPaths, stage)
	}
	sort.Strings(axmNewWritten)
	sort.Strings(modifyDeleted)
	sort.Strings(cleanDeleted)

	// Step 11: stage and commit. Stage only the paths the upgrade
	// touched (enumerated above) rather than `git add -A`, and commit
	// with the same pathspec (below) rather than a bare `git commit`, so
	// that any changes the user had staged before the upgrade are neither
	// staged again here nor swept into the upgrade commit. The clean-tree
	// precondition (step 4b) already refuses a dirty tree by default; the
	// pathspec is the belt-and-suspenders that keeps --allow-dirty runs
	// honest too (coherence-f6cn.3.3). An empty touchedPaths slice means
	// the merge produced no on-disk changes — skip the stage step.
	if len(touchedPaths) > 0 {
		addArgs := append([]string{"-C", opts.RepoDir, "add", "--"}, touchedPaths...)
		addCmd := exec.CommandContext(ctx, "git", addArgs...)
		addCmd.Stdout = opts.Stdout
		addCmd.Stderr = opts.Stderr
		if err := addCmd.Run(); err != nil {
			return nil, fmt.Errorf("git add: %w", err)
		}
	}

	// Local identity per the cmd/init.go::gitInitAndCommit pattern —
	// so the commit succeeds even on dev machines / CI runners
	// without a global git config set. The `-c` overrides take effect
	// only for this single git invocation; the user's global config
	// is untouched.
	//
	// Empty-change-set case: e.g., a tag-only re-publish where the
	// tree is byte-identical to HEAD. git commit otherwise exits
	// non-zero with an opaque `nothing to commit` message; treat it
	// as a successful no-op (the upgrade is logically complete;
	// there's just nothing to record).
	if len(touchedPaths) == 0 {
		// Nothing was staged. Only claim "already matches" when there is
		// genuinely nothing to report; if the merge surfaced modify/delete
		// conflicts (kept files, staged nothing) the step-12 warning below
		// explains the state instead — the Workspace does NOT match yet.
		if len(modifyDeleted) == 0 {
			fmt.Fprintf(opts.Stdout, "Workspace already matches %s; no commit needed.\n", opts.NewTag)
		}
	} else {
		commitMsg := "axm upgrade to lean-client " + opts.NewTag
		commitArgs := []string{
			"-C", opts.RepoDir,
			"-c", "user.email=axm-upgrade@axiom.local",
			"-c", "user.name=axm upgrade",
			"commit", "-q", "-m", commitMsg,
			// Pathspec-scoped: commit ONLY the upgrade-touched paths, so a
			// commit records the upgrade even when the index also carries
			// pre-existing staged work, and that work stays out of it.
			"--",
		}
		commitArgs = append(commitArgs, touchedPaths...)
		commitCmd := exec.CommandContext(ctx, "git", commitArgs...)
		var commitErrBuf bytes.Buffer
		commitCmd.Stdout = opts.Stdout
		commitCmd.Stderr = io.MultiWriter(opts.Stderr, &commitErrBuf)
		if err := commitCmd.Run(); err != nil {
			return nil, fmt.Errorf("git commit: %w (stderr: %s)",
				err, strings.TrimSpace(commitErrBuf.String()))
		}
	}

	// Step 12: summary. The "upgraded" headline only fires when the
	// upgrade actually committed something (touchedPaths > 0). When the
	// merge's only effect was modify/delete conflicts (kept on disk,
	// nothing staged) no version transition happened — say so truthfully
	// rather than claim an upgrade that didn't occur. The all-zero case
	// already printed "already matches" above and adds nothing here.
	// A .axmnew sidecar leaves the canonical skill unchanged, and modify/delete
	// conflicts never reach touchedPaths.
	skillsChanged := false
	for _, p := range touchedPaths {
		if !strings.HasSuffix(p, ".axmnew") && strings.HasPrefix(filepath.ToSlash(p), agentskills.CanonicalDir+"/") {
			skillsChanged = true
			break
		}
	}
	if len(touchedPaths) > 0 {
		note := ""
		if skillsChanged {
			note = " (agent skills rewritten for local use)"
		}
		progress.Successf(opts.Stdout, "workspace updated to template v%s%s", opts.NewTag, note)
	} else if len(modifyDeleted) > 0 {
		fmt.Fprintf(opts.Stdout,
			"Workspace left at %s: the new version at %s only removed files you had modified (kept below); nothing else changed.\n",
			oldTag, opts.NewTag)
	}
	if len(cleanDeleted) > 0 {
		fmt.Fprintf(opts.Stdout,
			"%d file(s) removed to match the new version.\n", len(cleanDeleted))
	}
	if len(axmNewWritten) > 0 {
		fmt.Fprintf(opts.Stdout,
			"%d file(s) have updates that conflict with your local edits. New versions written alongside as <file>.axmnew companions. Review and merge by hand, then delete the .axmnew file.\n",
			len(axmNewWritten),
		)
	}
	if len(modifyDeleted) > 0 {
		fmt.Fprintf(opts.Stdout,
			"Warning: %d file(s) you have modified were deleted in the new version at %s. Your local copies were kept unchanged — review each and delete it if it is no longer needed:\n",
			len(modifyDeleted), opts.NewTag,
		)
		for _, p := range modifyDeleted {
			fmt.Fprintf(opts.Stdout, "  - %s\n", p)
		}
	}
	if buildConfigDiff {
		fmt.Fprintln(opts.Stdout, "Run lake build to rebuild against the new pins.")
	}

	// Step 13: success.
	return &WorkspaceResult{
		OldTag:            oldTag,
		NewTag:            opts.NewTag,
		AxmNewWritten:     axmNewWritten,
		ModifyDeletedKept: modifyDeleted,
		Removed:           cleanDeleted,
		BuildConfigDiff:   buildConfigDiff,
		SkillsChanged:     skillsChanged,
	}, nil
}

// checkAxiomClientRemote runs `git -C <repoDir> remote` and verifies
// that "axiom-client" appears in the output. Refuses with the
// user-flow step 4 copy verbatim, wrapping ErrNoAxiomClientRemote
// so callers can errors.Is to dispatch.
func checkAxiomClientRemote(ctx context.Context, repoDir string) error {
	cmd := exec.CommandContext(ctx, "git", "-C", repoDir, "remote")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%w: git remote: %w (stderr: %s)",
			ErrNoAxiomClientRemote, err, strings.TrimSpace(stderr.String()))
	}
	for _, line := range strings.Split(stdout.String(), "\n") {
		if strings.TrimSpace(line) == "axiom-client" {
			return nil
		}
	}
	return fmt.Errorf("%w: %s",
		ErrNoAxiomClientRemote,
		"axm upgrade requires a Workspace initialized from the lean-client mirror. This Workspace doesn't have the expected axiom-client git remote. Re-initialize with axm init in a fresh directory.",
	)
}

// worktreeDirty reports whether the Workspace has staged or unstaged
// changes to tracked files. It uses `git status --porcelain`, which
// lists both index and worktree modifications; untracked files (`??`)
// are ignored because the upgrade never overwrites paths git isn't
// tracking, so a stray scratch file must not block an upgrade. Any
// non-`??` porcelain line means the tree is dirty for our purposes.
func worktreeDirty(ctx context.Context, repoDir string) (bool, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", repoDir, "status", "--porcelain")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return false, fmt.Errorf("axm upgrade: git status: %w (stderr: %s)",
			err, strings.TrimSpace(stderr.String()))
	}
	for _, line := range strings.Split(stdout.String(), "\n") {
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "??") {
			continue // untracked — never touched by the upgrade
		}
		return true, nil
	}
	return false, nil
}

// promptBuildConfig renders the file list and reads the y/N answer.
// Returns (accepted, err). err is non-nil only on read errors; the
// user-rejection case is (false, nil).
//
// Format (verbatim from user-flow step 9):
//
//	<N> build-config file(s) at this Workspace differ from the new version at <tag>:
//	  - lakefile.lean
//	  - lean-toolchain
//	Replace these <N> file(s) with the new versions from this upgrade? [y/N]:
//
// The prompt is on its own line, NOT appended to the last "  - <path>"
// line — matching the user-flow's code-block layout.
func promptBuildConfig(opts WorkspaceOptions, conflicts []FileChange) (bool, error) {
	// --yes / -y: skip prompt, accept.
	if opts.Yes {
		return true, nil
	}
	// Non-TTY without --yes: skip prompt, reject (cautious default).
	if opts.NonTTY {
		return false, nil
	}

	// Sort paths for stable rendering.
	paths := make([]string, len(conflicts))
	for i, c := range conflicts {
		paths[i] = c.Path
	}
	sort.Strings(paths)

	fmt.Fprintf(opts.Stdout,
		"%d build-config file(s) at this Workspace differ from the new version at %s:\n",
		len(paths), opts.NewTag,
	)
	for _, p := range paths {
		fmt.Fprintf(opts.Stdout, "  - %s\n", p)
	}
	fmt.Fprintf(opts.Stdout,
		"Replace these %d file(s) with the new versions from this upgrade? [y/N]: ",
		len(paths),
	)

	answer, err := cliprompt.ReadAnswer(opts.Stdin)
	if err != nil {
		return false, fmt.Errorf("reading prompt answer: %w", err)
	}
	return cliprompt.ParseYes(answer), nil
}

// validateMergeTreePath refuses a git tree path (slash-separated on every
// OS) that is not already clean, would leave the Workspace root, or would
// not map to the same local file on every OS: backslashes and colons are
// separators or drive/stream markers on Windows.
func validateMergeTreePath(p string) error {
	if p == "" || p == "." || path.Clean(p) != p || path.IsAbs(p) || p == ".." || strings.HasPrefix(p, "../") ||
		strings.ContainsAny(p, `\:`) || !filepath.IsLocal(filepath.FromSlash(p)) {
		return fmt.Errorf("axm upgrade: refusing suspicious merge-tree path %q", p)
	}
	return nil
}

// writeFromGitObject runs `git -C <repoDir> cat-file -p <src>` and
// writes the resulting bytes to dst, creating dst's parent
// directories (0755) if needed. dst gets 0644 — regular file mode;
// lake build artifacts and .axiomdata/ are gitignored from the
// lean-client subtree and never appear in merge output, so executable-
// bit preservation is not a concern at this layer.
//
// `git cat-file -p` (rather than `git checkout-index`) is deliberate:
// checkout-index reads from the *current* index, but our merge tree
// is unreferenced (only the SHA is alive). cat-file works against any
// object SHA, which is exactly what we have.
func writeFromGitObject(ctx context.Context, repoDir, src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", filepath.Dir(dst), err)
	}
	out, err := readGitObject(ctx, repoDir, src)
	if err != nil {
		return err
	}
	// 0o644: regular file. We do not preserve executable bits — see
	// function doc.
	if err := os.WriteFile(dst, out, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", dst, err)
	}
	return nil
}

func readGitObject(ctx context.Context, repoDir, src string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", repoDir, "cat-file", "-p", src)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git cat-file -p %s: %w (stderr: %s)",
			src, err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

// TemplateFile returns the lean-client template's content of treePath at
// the version repoDir's lakefile.lean pins, read from the template ref the
// Workspace's git holds for that version: the axiom-client tracking ref
// `axm upgrade` fetches, else the tag `axm init` cloned. ok is false when
// the version is unreadable or neither ref carries treePath.
func TemplateFile(ctx context.Context, repoDir, treePath string) (content []byte, ok bool) {
	version, err := lakefile.ReadVersion(filepath.Join(repoDir, "lakefile.lean"))
	if err != nil {
		return nil, false
	}
	mirrorTag := "v" + version
	for _, ref := range []string{"refs/remotes/axiom-client/" + mirrorTag, "refs/tags/" + mirrorTag} {
		if out, err := readGitObject(ctx, repoDir, ref+":"+treePath); err == nil {
			return out, true
		}
	}
	return nil, false
}

// removeFromWorkingTree deletes dst from the working tree for a clean
// merge deletion (Outcome OutcomeCleanDelete), then prunes any parent
// directories the removal leaves empty, up to — but never including —
// the Workspace root. Pruning mirrors `git rm`'s own cleanup so an
// upgrade that drops the last file in a directory doesn't leave a stale
// empty directory behind; it is the symmetric opposite of
// writeFromGitObject's os.MkdirAll on the write side.
//
// The apply loop's own path guard is purely lexical (path.Clean /
// filepath.Abs don't resolve symlinks), so before touching disk this re-checks
// containment against the SYMLINK-RESOLVED paths: a working tree where a
// symlinked directory stands in for a real one must not let a delete
// escape the Workspace. A clean deletion only ever targets a git-tracked
// path, so the parent directory exists and EvalSymlinks resolves.
//
// An already-absent dst is not an error: a partial prior run, or the
// user having deleted the file themselves, both leave nothing to do, so
// the step stays idempotent on re-run.
//
// This is the tree's second empty-parent prune, after
// agentskills.pruneEmptyDirs; the two differ enough (dynamic upward climb
// vs. a fixed deepest-first list, no RemoveResult to thread) that sharing
// costs more than it saves today. Extract a common internal/fsutil helper
// if a third caller appears.
func removeFromWorkingTree(repoRoot, dst string) error {
	root, err := filepath.EvalSymlinks(repoRoot)
	if err != nil {
		return fmt.Errorf("resolve Workspace root %s: %w", repoRoot, err)
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(dst))
	if err != nil {
		if os.IsNotExist(err) {
			return nil // parent already gone — nothing to remove
		}
		return fmt.Errorf("resolve %s: %w", filepath.Dir(dst), err)
	}
	sep := string(filepath.Separator)
	if parent != root && !strings.HasPrefix(parent, root+sep) {
		return fmt.Errorf("refusing to delete %s: it resolves outside the Workspace root %s", dst, root)
	}

	// Remove the file (in resolved space), tolerating an already-absent
	// target so re-runs stay idempotent.
	if err := os.Remove(filepath.Join(parent, filepath.Base(dst))); err != nil && !os.IsNotExist(err) {
		return err
	}
	// Climb from the file's directory toward root, removing each directory
	// that is now empty. Emptiness is checked with os.ReadDir (portable —
	// no reliance on a platform-specific ENOTEMPTY): a non-empty directory
	// stops the climb, an already-gone one stops it, and any OTHER error
	// (permission, I/O) is surfaced rather than silently swallowed.
	for dir := parent; dir != root && strings.HasPrefix(dir, root+sep); dir = filepath.Dir(dir) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				break
			}
			return fmt.Errorf("checking %s for pruning: %w", dir, err)
		}
		if len(entries) > 0 {
			break // directory still holds other entries — stop climbing
		}
		if err := os.Remove(dir); err != nil {
			if os.IsNotExist(err) {
				break
			}
			return fmt.Errorf("pruning emptied directory %s: %w", dir, err)
		}
	}
	return nil
}
