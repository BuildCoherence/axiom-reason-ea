package upgrade

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Prompt-parsing tests live with the cliprompt package — see
// internal/cliprompt/cliprompt_test.go. promptBuildConfig's own coverage
// (the build-config-conflict prompt flow) lives in the workspace integration
// tests below, which exercise the path end-to-end via WorkspaceOptions.

// TestNewTagRe covers the bare-StdVer acceptance set and the
// rejection set for the `lean_client.current_tag` shape guard. Both
// lanes' values must pass; the prior component-prefixed form, anything
// with a `:` (cat-file ref-or-blob injection), a leading `-`, a `/`,
// or path-traversal must be rejected.
func TestNewTagRe(t *testing.T) {
	accept := []string{
		"0.3.2",                 // production
		"1.0.0",                 // production
		"0.0.0-staging-abc1234", // staging
		"0.0.0-staging-0000000", // staging, all-zero short-sha (stays alphanumeric)
		"1.2.3-rc1",             // production prerelease
	}
	for _, v := range accept {
		if !newTagRe.MatchString(v) {
			t.Errorf("newTagRe rejected %q, want accept", v)
		}
	}
	reject := []string{
		"",
		"axiom-lean-client/v0.3.2", // old prefixed form — must no longer pass
		"v0.3.2",                   // leading v is the mirror-ref form, not the API form
		"0.3.2:evil",               // cat-file ref-or-blob injection
		"0.3",                      // partial
		"-0.3.2",                   // leading dash
		"../../etc/passwd",         // traversal
		"0.3.2 ",                   // trailing space
		"1.2.3+build.5",            // build metadata — ReadVersion's canonical gate rejects it, so this must too
		"main",
	}
	for _, v := range reject {
		if newTagRe.MatchString(v) {
			t.Errorf("newTagRe accepted %q, want reject", v)
		}
	}
}

// fakeConflicts builds a slice of build-config FileChanges for the
// given paths. Outcome is fixed to OutcomeBuildConfigConflict because
// promptBuildConfig only ever sees build-config conflicts (the
// orchestrator pre-filters).
func fakeConflicts(paths ...string) []FileChange {
	out := make([]FileChange, len(paths))
	for i, p := range paths {
		out[i] = FileChange{Path: p, Outcome: OutcomeBuildConfigConflict}
	}
	return out
}

func TestPromptBuildConfig_YesFlagBypasses(t *testing.T) {
	var stdout bytes.Buffer
	opts := WorkspaceOptions{
		Yes:    true,
		Stdin:  strings.NewReader(""),
		Stdout: &stdout,
		Stderr: io.Discard,
	}
	accepted, err := promptBuildConfig(opts, fakeConflicts("lakefile.lean"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !accepted {
		t.Errorf("accepted = false, want true (Yes bypasses prompt)")
	}
	if stdout.Len() != 0 {
		t.Errorf("stdout not empty when --yes bypasses prompt: %q", stdout.String())
	}
}

func TestPromptBuildConfig_NonTTYWithoutYesRejects(t *testing.T) {
	var stdout bytes.Buffer
	opts := WorkspaceOptions{
		NonTTY: true,
		Yes:    false,
		Stdin:  strings.NewReader(""),
		Stdout: &stdout,
		Stderr: io.Discard,
	}
	accepted, err := promptBuildConfig(opts, fakeConflicts("lakefile.lean"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if accepted {
		t.Errorf("accepted = true, want false (NonTTY w/o --yes is cautious reject)")
	}
	if stdout.Len() != 0 {
		t.Errorf("stdout not empty in NonTTY-no-prompt path: %q", stdout.String())
	}
}

func TestPromptBuildConfig_InteractiveAcceptance(t *testing.T) {
	var stdout bytes.Buffer
	opts := WorkspaceOptions{
		NewTag: "0.3.2",
		Stdin:  strings.NewReader("y\n"),
		Stdout: &stdout,
		Stderr: io.Discard,
	}
	accepted, err := promptBuildConfig(opts, fakeConflicts("lakefile.lean"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !accepted {
		t.Errorf("accepted = false, want true")
	}
	out := stdout.String()
	if !strings.Contains(out, "1 build-config file(s) at this Workspace differ from the new version at 0.3.2:") {
		t.Errorf("stdout missing prompt header line. Got:\n%s", out)
	}
	if !strings.Contains(out, "  - lakefile.lean\n") {
		t.Errorf("stdout missing path bullet. Got:\n%s", out)
	}
	if !strings.Contains(out, "Replace these 1 file(s) with the new versions from this upgrade? [y/N]:") {
		t.Errorf("stdout missing y/N prompt. Got:\n%s", out)
	}
}

func TestPromptBuildConfig_InteractiveRejection(t *testing.T) {
	var stdout bytes.Buffer
	opts := WorkspaceOptions{
		NewTag: "0.3.2",
		Stdin:  strings.NewReader("\n"), // Enter alone
		Stdout: &stdout,
		Stderr: io.Discard,
	}
	accepted, err := promptBuildConfig(opts, fakeConflicts("lakefile.lean"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if accepted {
		t.Errorf("accepted = true, want false (Enter alone rejects)")
	}
}

// TestPromptBuildConfig_RendersFileListSorted verifies that the
// rendered prompt sorts paths lexically — input order should NOT leak
// into the user-facing list.
func TestPromptBuildConfig_RendersFileListSorted(t *testing.T) {
	var stdout bytes.Buffer
	opts := WorkspaceOptions{
		NewTag: "0.3.2",
		Stdin:  strings.NewReader("y\n"),
		Stdout: &stdout,
		Stderr: io.Discard,
	}
	// Out-of-order input: lean-toolchain before lakefile.lean.
	if _, err := promptBuildConfig(opts, fakeConflicts("lean-toolchain", "lakefile.lean")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := stdout.String()
	lakefileIdx := strings.Index(out, "  - lakefile.lean")
	leanToolchainIdx := strings.Index(out, "  - lean-toolchain")
	if lakefileIdx < 0 || leanToolchainIdx < 0 {
		t.Fatalf("missing one or both paths in output:\n%s", out)
	}
	if lakefileIdx > leanToolchainIdx {
		t.Errorf("paths not sorted: lakefile.lean (%d) appears after lean-toolchain (%d) in:\n%s",
			lakefileIdx, leanToolchainIdx, out)
	}
}

// buildUpgradeFixture creates a fake lean-client mirror with two tagged
// snapshots (v<oldVer> and v<newVer>, the leading-`v` mirror-tag form
// per the bare-StdVer model) and a Workspace clone reset to the older
// tag with its `origin` renamed to `axiom-client`. It returns the
// Workspace path. The Workspace's local `commit.gpgsign=false` so the
// upgrade's own commit succeeds regardless of ambient signing config.
func buildUpgradeFixture(t *testing.T, oldVer, newVer string) string {
	t.Helper()
	base := t.TempDir()
	mirror := filepath.Join(base, "mirror")
	if err := os.MkdirAll(mirror, 0o755); err != nil {
		t.Fatalf("mkdir mirror: %v", err)
	}
	gitRun(t, mirror, "init", "-q", "-b", "main")

	writeFixtureFile(t, mirror, "lakefile.lean", "package axiomClient where\n  version := v!\""+oldVer+"\"\n")
	writeFixtureFile(t, mirror, "Workspace/Notes.lean", "def a := 1\n")
	gitRun(t, mirror, "add", "-A")
	gitRun(t, mirror, "commit", "-q", "-m", "snapshot "+oldVer)
	gitRun(t, mirror, "tag", "v"+oldVer)

	writeFixtureFile(t, mirror, "lakefile.lean", "package axiomClient where\n  version := v!\""+newVer+"\"\n")
	writeFixtureFile(t, mirror, "Workspace/Notes.lean", "def a := 2\n")
	gitRun(t, mirror, "add", "-A")
	gitRun(t, mirror, "commit", "-q", "-m", "snapshot "+newVer)
	gitRun(t, mirror, "tag", "v"+newVer)

	ws := filepath.Join(base, "ws")
	gitRun(t, base, "clone", "-q", mirror, ws)
	gitRun(t, ws, "remote", "rename", "origin", "axiom-client")
	gitRun(t, ws, "reset", "-q", "--hard", "v"+oldVer)
	gitRun(t, ws, "config", "commit.gpgsign", "false")
	gitRun(t, ws, "config", "user.email", "ws@axiom.local")
	gitRun(t, ws, "config", "user.name", "ws")
	return ws
}

func writeFixtureFile(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(p), err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", p, err)
	}
}

// TestRunWorkspaceUpgrade_HappyPath exercises the full workspace phase
// end-to-end against a git-faked mirror: the `v`-prefixed mirror tag,
// the remote-tracking fetch refspec, the bare-StdVer equality compare,
// the clean-merge apply, and the upgrade commit + summary. A clean
// fast-forward (the Workspace has no local edits) means no build-config
// prompt fires.
func TestRunWorkspaceUpgrade_HappyPath(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}
	ws := buildUpgradeFixture(t, "0.3.1", "0.3.2")

	var stdout bytes.Buffer
	res, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir: ws,
		NewTag:  "0.3.2",
		Yes:     true,
		NonTTY:  true,
		Stdout:  &stdout,
		Stderr:  io.Discard,
	})
	if err != nil {
		t.Fatalf("RunWorkspaceUpgrade: %v\nstdout:\n%s", err, stdout.String())
	}
	if res.AlreadyCurrent {
		t.Errorf("AlreadyCurrent = true, want false")
	}
	if res.OldTag != "0.3.1" || res.NewTag != "0.3.2" {
		t.Errorf("OldTag/NewTag = %q/%q, want 0.3.1/0.3.2", res.OldTag, res.NewTag)
	}
	if len(res.AxmNewWritten) != 0 {
		t.Errorf("AxmNewWritten = %v, want none (clean merge)", res.AxmNewWritten)
	}
	if !res.BuildConfigDiff {
		t.Errorf("BuildConfigDiff = false, want true (lakefile.lean changed)")
	}
	// The lakefile must now carry the new tag.
	got, err := os.ReadFile(filepath.Join(ws, "lakefile.lean"))
	if err != nil {
		t.Fatalf("read lakefile: %v", err)
	}
	if !strings.Contains(string(got), `v!"0.3.2"`) {
		t.Errorf("lakefile not upgraded; got:\n%s", got)
	}
	// No canonical .axiom/skills/** path changed, so the headline carries no skills note.
	if !strings.Contains(stdout.String(), "✓ workspace updated to template v0.3.2\n") {
		t.Errorf("missing upgrade summary without a skills note; got:\n%s", stdout.String())
	}
	if res.SkillsChanged {
		t.Errorf("SkillsChanged = true though no .axiom/skills/** file changed")
	}
}

// TestRunWorkspaceUpgrade_AlreadyCurrent verifies the step-6
// short-circuit: a bare-StdVer equality of lakefile tag and
// /api/version tag prints the up-to-date copy and makes no commit
// (and never reaches the fetch).
func TestRunWorkspaceUpgrade_AlreadyCurrent(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}
	ws := buildUpgradeFixture(t, "0.3.1", "0.3.2")

	var stdout bytes.Buffer
	res, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir: ws,
		NewTag:  "0.3.1", // equals the Workspace's lakefile tag
		Yes:     true,
		NonTTY:  true,
		Stdout:  &stdout,
		Stderr:  io.Discard,
	})
	if err != nil {
		t.Fatalf("RunWorkspaceUpgrade: %v", err)
	}
	if !res.AlreadyCurrent {
		t.Errorf("AlreadyCurrent = false, want true")
	}
	if !strings.Contains(stdout.String(), "already up to date at 0.3.1.") {
		t.Errorf("missing up-to-date copy; got:\n%s", stdout.String())
	}
}

// TestRunWorkspaceUpgrade_CleanDeletion is the end-to-end regression for
// the reported `axm upgrade` crash after lean-client PR #1070: the new
// snapshot deletes a skill file the Workspace hasn't edited, and the old
// classifier aborted with "resolving blob SHA for
// .axiom/skills/bfo-upper-ontology/SKILL.md: ... exists on disk, but not
// in <tree>". This drives the whole phase — classify, apply, stage,
// commit — and asserts the removed file is gone from disk AND from the
// index (staged as a deletion), the now-empty skill directory is pruned,
// and the replacement file the same snapshot added is present.
func TestRunWorkspaceUpgrade_CleanDeletion(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}

	base := t.TempDir()
	mirror := filepath.Join(base, "mirror")
	if err := os.MkdirAll(mirror, 0o755); err != nil {
		t.Fatalf("mkdir mirror: %v", err)
	}
	gitRun(t, mirror, "init", "-q", "-b", "main")

	// Old snapshot (v0.3.1): lakefile + a skill file that the upgrade
	// removes, plus an unrelated file the upgrade leaves alone.
	skillRel := ".axiom/skills/bfo-upper-ontology/SKILL.md"
	writeFixtureFile(t, mirror, "lakefile.lean", "package axiomClient where\n  version := v!\"0.3.1\"\n")
	writeFixtureFile(t, mirror, skillRel, "old skill\n")
	writeFixtureFile(t, mirror, "Workspace/Notes.lean", "def a := 1\n")
	gitRun(t, mirror, "add", "-A")
	gitRun(t, mirror, "commit", "-q", "-m", "snapshot 0.3.1")
	gitRun(t, mirror, "tag", "v0.3.1")

	// New snapshot (v0.3.2): bump the lakefile, delete the skill, add a
	// replacement skill.
	writeFixtureFile(t, mirror, "lakefile.lean", "package axiomClient where\n  version := v!\"0.3.2\"\n")
	gitRun(t, mirror, "rm", "-q", skillRel)
	writeFixtureFile(t, mirror, ".axiom/skills/new-skill/SKILL.md", "new skill\n")
	gitRun(t, mirror, "add", "-A")
	gitRun(t, mirror, "commit", "-q", "-m", "snapshot 0.3.2")
	gitRun(t, mirror, "tag", "v0.3.2")

	ws := filepath.Join(base, "ws")
	gitRun(t, base, "clone", "-q", mirror, ws)
	gitRun(t, ws, "remote", "rename", "origin", "axiom-client")
	gitRun(t, ws, "reset", "-q", "--hard", "v0.3.1")
	gitRun(t, ws, "config", "commit.gpgsign", "false")
	gitRun(t, ws, "config", "user.email", "ws@axiom.local")
	gitRun(t, ws, "config", "user.name", "ws")

	// Precondition: the skill file is present before the upgrade.
	skillAbs := filepath.Join(ws, filepath.FromSlash(skillRel))
	if _, err := os.Stat(skillAbs); err != nil {
		t.Fatalf("precondition: skill file should exist before upgrade: %v", err)
	}

	var stdout bytes.Buffer
	res, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir: ws,
		NewTag:  "0.3.2",
		Yes:     true,
		NonTTY:  true,
		Stdout:  &stdout,
		Stderr:  io.Discard,
	})
	if err != nil {
		t.Fatalf("RunWorkspaceUpgrade: %v\nstdout:\n%s", err, stdout.String())
	}
	if res.OldTag != "0.3.1" || res.NewTag != "0.3.2" {
		t.Errorf("OldTag/NewTag = %q/%q, want 0.3.1/0.3.2", res.OldTag, res.NewTag)
	}

	// The removed skill file is gone from the working tree...
	if _, err := os.Stat(skillAbs); !os.IsNotExist(err) {
		t.Errorf("skill file still present after upgrade (stat err=%v), want removed", err)
	}
	// ...its now-empty directory is pruned (git-rm-style cleanup)...
	if _, err := os.Stat(filepath.Dir(skillAbs)); !os.IsNotExist(err) {
		t.Errorf("emptied skill dir still present after upgrade (stat err=%v), want pruned", err)
	}
	// ...the replacement the same snapshot added is present...
	if _, err := os.Stat(filepath.Join(ws, ".axiom", "skills", "new-skill", "SKILL.md")); err != nil {
		t.Errorf("new skill file missing after upgrade: %v", err)
	}
	// ...and the deletion was staged+committed, so the path is no longer
	// tracked in HEAD's tree.
	out, err := exec.Command("git", "-C", ws, "ls-files", "--", skillRel).Output()
	if err != nil {
		t.Fatalf("git ls-files: %v", err)
	}
	if strings.TrimSpace(string(out)) != "" {
		t.Errorf("deleted skill still tracked after upgrade: %q", out)
	}
	// The removal is reported (result + summary line) rather than silent.
	if len(res.Removed) != 1 || res.Removed[0] != skillRel {
		t.Errorf("Removed = %v, want [%q]", res.Removed, skillRel)
	}
	if !strings.Contains(stdout.String(), "1 file(s) removed to match the new version.") {
		t.Errorf("missing clean-deletion summary line; got:\n%s", stdout.String())
	}
	// A canonical skill was added and another cleanly deleted, so the headline
	// reports rewritten skills for the caller's agent sync.
	if !res.SkillsChanged || !strings.Contains(stdout.String(), "✓ workspace updated to template v0.3.2 (agent skills rewritten for local use)\n") {
		t.Errorf("SkillsChanged = %v; missing skills note after a canonical skill changed; got:\n%s", res.SkillsChanged, stdout.String())
	}
	// The lakefile carries the new tag.
	got, err := os.ReadFile(filepath.Join(ws, "lakefile.lean"))
	if err != nil {
		t.Fatalf("read lakefile: %v", err)
	}
	if !strings.Contains(string(got), `v!"0.3.2"`) {
		t.Errorf("lakefile not upgraded; got:\n%s", got)
	}
	// AC5: the nudge is advisory only — the upgrade must NOT auto-sync, i.e. it
	// emits/modifies no per-agent artifact even though a canonical skill changed
	// here. The fixture never creates these, so their continued absence after
	// the run locks the no-auto-sync guarantee.
	for _, rel := range []string{".claude/skills", ".cursor/skills", ".agents/skills", ".github/skills", "GEMINI.md"} {
		if _, err := os.Stat(filepath.Join(ws, filepath.FromSlash(rel))); !os.IsNotExist(err) {
			t.Errorf("upgrade produced per-agent artifact %q (stat err=%v); upgrade must not auto-sync", rel, err)
		}
	}
}

// TestRunWorkspaceUpgrade_ModifyDeleteConflict is the end-to-end
// regression for a modify/delete conflict: the new snapshot deletes a
// file the Workspace has locally edited. There is no new version to
// write, so the fix keeps the user's file untouched and warns rather
// than crashing at `git cat-file axiom-client/<tag>:<path>` (exit 128,
// the path is gone from the incoming version). A clean lakefile bump
// rides along so the upgrade still commits.
func TestRunWorkspaceUpgrade_ModifyDeleteConflict(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}

	base := t.TempDir()
	mirror := filepath.Join(base, "mirror")
	if err := os.MkdirAll(mirror, 0o755); err != nil {
		t.Fatalf("mkdir mirror: %v", err)
	}
	gitRun(t, mirror, "init", "-q", "-b", "main")

	// Old snapshot (v0.3.1): lakefile + a skill file.
	skillRel := ".axiom/skills/retired/SKILL.md"
	writeFixtureFile(t, mirror, "lakefile.lean", "package axiomClient where\n  version := v!\"0.3.1\"\n")
	writeFixtureFile(t, mirror, skillRel, "upstream v1\n")
	gitRun(t, mirror, "add", "-A")
	gitRun(t, mirror, "commit", "-q", "-m", "snapshot 0.3.1")
	gitRun(t, mirror, "tag", "v0.3.1")

	// New snapshot (v0.3.2): bump the lakefile and DELETE the skill.
	writeFixtureFile(t, mirror, "lakefile.lean", "package axiomClient where\n  version := v!\"0.3.2\"\n")
	gitRun(t, mirror, "rm", "-q", skillRel)
	gitRun(t, mirror, "add", "-A")
	gitRun(t, mirror, "commit", "-q", "-m", "snapshot 0.3.2")
	gitRun(t, mirror, "tag", "v0.3.2")

	ws := filepath.Join(base, "ws")
	gitRun(t, base, "clone", "-q", mirror, ws)
	gitRun(t, ws, "remote", "rename", "origin", "axiom-client")
	gitRun(t, ws, "reset", "-q", "--hard", "v0.3.1")
	gitRun(t, ws, "config", "commit.gpgsign", "false")
	gitRun(t, ws, "config", "user.email", "ws@axiom.local")
	gitRun(t, ws, "config", "user.name", "ws")

	// The user edits (and commits) the file the new version will delete —
	// creating a modify/delete conflict on upgrade.
	skillAbs := filepath.Join(ws, filepath.FromSlash(skillRel))
	userContent := "my local edits\n"
	if err := os.WriteFile(skillAbs, []byte(userContent), 0o644); err != nil {
		t.Fatalf("write user edit: %v", err)
	}
	gitRun(t, ws, "add", "-A")
	gitRun(t, ws, "commit", "-q", "-m", "user edits the skill")

	var stdout bytes.Buffer
	res, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir: ws,
		NewTag:  "0.3.2",
		Yes:     true,
		NonTTY:  true,
		Stdout:  &stdout,
		Stderr:  io.Discard,
	})
	if err != nil {
		t.Fatalf("RunWorkspaceUpgrade: %v\nstdout:\n%s", err, stdout.String())
	}

	// The conflict is reported...
	if got := res.ModifyDeletedKept; len(got) != 1 || got[0] != skillRel {
		t.Errorf("ModifyDeletedKept = %v, want [%q]", got, skillRel)
	}
	// ...the user's file is kept with their exact content...
	kept, err := os.ReadFile(skillAbs)
	if err != nil {
		t.Fatalf("skill file missing after upgrade (should be kept): %v", err)
	}
	if string(kept) != userContent {
		t.Errorf("skill content = %q, want the user's %q (kept unchanged)", kept, userContent)
	}
	// ...no .axmnew companion is written (there is no new version)...
	if _, err := os.Stat(skillAbs + ".axmnew"); !os.IsNotExist(err) {
		t.Errorf(".axmnew companion exists for modify/delete (stat err=%v), want none", err)
	}
	// ...the warning names the file...
	out := stdout.String()
	if !strings.Contains(out, "were deleted in the new version") || !strings.Contains(out, skillRel) {
		t.Errorf("missing modify/delete warning naming %s; got:\n%s", skillRel, out)
	}
	// The only skill hit a modify/delete conflict, so the canonical file was
	// not changed on disk.
	if res.SkillsChanged || strings.Contains(out, "agent skills rewritten") {
		t.Errorf("skills note for a modify/delete conflict (skill not in touchedPaths); got:\n%s", out)
	}
	// ...the file stays tracked (no deletion staged for it)...
	tracked, err := exec.Command("git", "-C", ws, "ls-files", "--", skillRel).Output()
	if err != nil {
		t.Fatalf("git ls-files: %v", err)
	}
	if strings.TrimSpace(string(tracked)) != skillRel {
		t.Errorf("kept file no longer tracked after upgrade: ls-files=%q", tracked)
	}
	// ...and the clean lakefile bump alongside it still committed.
	lake, err := os.ReadFile(filepath.Join(ws, "lakefile.lean"))
	if err != nil {
		t.Fatalf("read lakefile: %v", err)
	}
	if !strings.Contains(string(lake), `v!"0.3.2"`) {
		t.Errorf("lakefile not upgraded; got:\n%s", lake)
	}
}

// TestRunWorkspaceUpgrade_ModifyDeleteOnly covers the degenerate branch
// where the merge's ONLY effect is a modify/delete conflict: nothing is
// staged or committed, so the summary must NOT claim "workspace updated
// to template vY" (a transition that didn't happen). Both snapshots carry an
// identical lakefile so the sole diff between the two tags is the deleted
// skill — making touchedPaths == 0 while the tags still differ (step 6
// doesn't short-circuit).
func TestRunWorkspaceUpgrade_ModifyDeleteOnly(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}

	base := t.TempDir()
	mirror := filepath.Join(base, "mirror")
	if err := os.MkdirAll(mirror, 0o755); err != nil {
		t.Fatalf("mkdir mirror: %v", err)
	}
	gitRun(t, mirror, "init", "-q", "-b", "main")

	skillRel := ".axiom/skills/retired/SKILL.md"
	lake := "package axiomClient where\n  version := v!\"0.3.1\"\n" // identical in both snapshots
	writeFixtureFile(t, mirror, "lakefile.lean", lake)
	writeFixtureFile(t, mirror, skillRel, "upstream v1\n")
	gitRun(t, mirror, "add", "-A")
	gitRun(t, mirror, "commit", "-q", "-m", "snapshot 0.3.1")
	gitRun(t, mirror, "tag", "v0.3.1")

	gitRun(t, mirror, "rm", "-q", skillRel) // the ONLY change between tags
	gitRun(t, mirror, "commit", "-q", "-m", "snapshot 0.3.2 (delete skill only)")
	gitRun(t, mirror, "tag", "v0.3.2")

	ws := filepath.Join(base, "ws")
	gitRun(t, base, "clone", "-q", mirror, ws)
	gitRun(t, ws, "remote", "rename", "origin", "axiom-client")
	gitRun(t, ws, "reset", "-q", "--hard", "v0.3.1")
	gitRun(t, ws, "config", "commit.gpgsign", "false")
	gitRun(t, ws, "config", "user.email", "ws@axiom.local")
	gitRun(t, ws, "config", "user.name", "ws")

	// User edits (and commits) the skill the new tag deletes.
	skillAbs := filepath.Join(ws, filepath.FromSlash(skillRel))
	userContent := "my local edits\n"
	if err := os.WriteFile(skillAbs, []byte(userContent), 0o644); err != nil {
		t.Fatalf("write user edit: %v", err)
	}
	gitRun(t, ws, "add", "-A")
	gitRun(t, ws, "commit", "-q", "-m", "user edits the skill")
	headBefore := gitOut(t, ws, "rev-parse", "HEAD")

	var stdout bytes.Buffer
	res, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir: ws, NewTag: "0.3.2", Yes: true, NonTTY: true,
		Stdout: &stdout, Stderr: io.Discard,
	})
	if err != nil {
		t.Fatalf("RunWorkspaceUpgrade: %v\nstdout:\n%s", err, stdout.String())
	}

	out := stdout.String()
	if strings.Contains(out, "workspace updated to template") {
		t.Errorf("summary falsely claims an upgrade when nothing was committed; got:\n%s", out)
	}
	if !strings.Contains(out, "Workspace left at 0.3.1") {
		t.Errorf("missing the truthful no-transition headline; got:\n%s", out)
	}
	if after := gitOut(t, ws, "rev-parse", "HEAD"); after != headBefore {
		t.Errorf("a commit was made (%s -> %s) though nothing should have been staged", headBefore, after)
	}
	if len(res.ModifyDeletedKept) != 1 || res.ModifyDeletedKept[0] != skillRel {
		t.Errorf("ModifyDeletedKept = %v, want [%q]", res.ModifyDeletedKept, skillRel)
	}
	if len(res.Removed) != 0 {
		t.Errorf("Removed = %v, want none", res.Removed)
	}
	if got, _ := os.ReadFile(skillAbs); string(got) != userContent {
		t.Errorf("user's file not preserved: %q", got)
	}
}

// TestRunWorkspaceUpgrade_EmptyNewTag_SkipsCleanly pins the empty-tag
// contract. Empty NewTag is the server-side default when no lean-client
// target is published; RunWorkspaceUpgrade must skip cleanly, write the
// skip line to stderr, and return (nil, nil) — no git IO, no lakefile
// read. The regex still rejects genuinely malformed non-empty values
// (TestNewTagRe) and TestRunWorkspaceUpgrade_MalformedNewTag_Errors locks
// the sentinel-vs-shape boundary.
func TestRunWorkspaceUpgrade_EmptyNewTag_SkipsCleanly(t *testing.T) {
	// No git activity is expected: a bare t.TempDir() satisfies the
	// WorkspaceOptions shape without any pre-seeded lean-client fixture.
	ws := t.TempDir()

	var stdout, stderr bytes.Buffer
	res, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir: ws,
		NewTag:  "", // ServerConfig.LeanClientCurrentTag default
		Yes:     true,
		NonTTY:  true,
		Stdout:  &stdout,
		Stderr:  &stderr,
	})
	if err != nil {
		t.Fatalf("RunWorkspaceUpgrade returned error for empty NewTag, want nil (clean skip): %v\nstdout:\n%s\nstderr:\n%s",
			err, stdout.String(), stderr.String())
	}
	if res != nil {
		t.Errorf("result = %+v, want nil (no-op sentinel branch returns nil)", res)
	}
	if stdout.Len() != 0 {
		t.Errorf("stdout not empty on skip; got:\n%s", stdout.String())
	}
	errOut := stderr.String()
	if !strings.Contains(errOut, "Workspace upgrade skipped") {
		t.Errorf("stderr missing skip headline; got:\n%s", errOut)
	}
	if !strings.Contains(errOut, "ask your Axiom admin to publish a lean-client target") {
		t.Errorf("stderr missing operator-directed next step; got:\n%s", errOut)
	}
}

// TestRunWorkspaceUpgrade_MalformedNewTag_Errors locks the sentinel-vs-shape
// boundary. Only the literal empty string is the pre-publish sentinel; any
// other malformed value must fail the shape guard with the "unexpected
// shape" refusal so a compromised /api/version can't smuggle an arbitrary
// value past validation.
func TestRunWorkspaceUpgrade_MalformedNewTag_Errors(t *testing.T) {
	cases := []string{" ", "0.0.0-", "null"}
	for _, tag := range cases {
		t.Run(tag, func(t *testing.T) {
			ws := t.TempDir()
			var stdout, stderr bytes.Buffer
			res, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
				RepoDir: ws,
				NewTag:  tag,
				Yes:     true,
				NonTTY:  true,
				Stdout:  &stdout,
				Stderr:  &stderr,
			})
			if err == nil {
				t.Fatalf("want error for malformed NewTag %q, got nil (res=%+v)", tag, res)
			}
			if !strings.Contains(err.Error(), "unexpected shape") {
				t.Errorf("error %q missing \"unexpected shape\"; want the shape-guard refusal verbatim", err)
			}
		})
	}
}

// gitRun is a small helper that runs git in dir with the given args
// and fails the test on a non-zero exit. We always pass a local
// identity so the commit succeeds even on machines without a global
// git config (CI runners, fresh dev environments).
func gitRun(t *testing.T, dir string, args ...string) {
	t.Helper()
	full := append([]string{
		"-C", dir,
		"-c", "user.email=test@axiom.local",
		"-c", "user.name=test",
		"-c", "init.defaultBranch=main",
		"-c", "commit.gpgsign=false",
	}, args...)
	cmd := exec.Command("git", full...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("git %v failed: %v\nstderr: %s", args, err, stderr.String())
	}
}

// gitOut runs git in dir and returns trimmed stdout, failing on error.
func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(out))
}

// TestRemoveFromWorkingTree unit-tests the clean-deletion apply helper
// directly (the symmetric sibling of TestWriteFromGitObject_CreatesParentDirs).
// It pins the load-bearing prune-STOP safety invariant that the E2E test
// only covers coincidentally, plus symlink containment and idempotency.
func TestRemoveFromWorkingTree(t *testing.T) {
	mustWrite := func(t *testing.T, p string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("prunes the empty parent chain up to but not including root", func(t *testing.T) {
		root := t.TempDir()
		f := filepath.Join(root, "a", "b", "c", "only.txt")
		mustWrite(t, f)
		if err := removeFromWorkingTree(root, f); err != nil {
			t.Fatalf("removeFromWorkingTree: %v", err)
		}
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Errorf("file still present: %v", err)
		}
		if _, err := os.Stat(filepath.Join(root, "a")); !os.IsNotExist(err) {
			t.Errorf("empty parent chain not pruned: %v", err)
		}
		if _, err := os.Stat(root); err != nil {
			t.Errorf("root must never be pruned: %v", err)
		}
	})

	t.Run("stops at a non-empty parent so a sibling survives", func(t *testing.T) {
		root := t.TempDir()
		target := filepath.Join(root, "dir", "gone.txt")
		sibling := filepath.Join(root, "dir", "keep.txt")
		mustWrite(t, target)
		mustWrite(t, sibling)
		if err := removeFromWorkingTree(root, target); err != nil {
			t.Fatalf("removeFromWorkingTree: %v", err)
		}
		if _, err := os.Stat(sibling); err != nil {
			t.Errorf("sibling wrongly removed (over-pruned): %v", err)
		}
		if _, err := os.Stat(filepath.Join(root, "dir")); err != nil {
			t.Errorf("non-empty dir wrongly pruned: %v", err)
		}
	})

	t.Run("multiple deletions in one dir prune it only after the last", func(t *testing.T) {
		root := t.TempDir()
		a := filepath.Join(root, "d", "a.txt")
		b := filepath.Join(root, "d", "b.txt")
		mustWrite(t, a)
		mustWrite(t, b)
		if err := removeFromWorkingTree(root, a); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(root, "d")); err != nil {
			t.Errorf("dir pruned too early while b.txt remained: %v", err)
		}
		if err := removeFromWorkingTree(root, b); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(root, "d")); !os.IsNotExist(err) {
			t.Errorf("dir not pruned after last file removed: %v", err)
		}
	})

	t.Run("idempotent on an already-absent target", func(t *testing.T) {
		root := t.TempDir()
		f := filepath.Join(root, "x", "one.txt")
		mustWrite(t, f)
		if err := removeFromWorkingTree(root, f); err != nil {
			t.Fatal(err)
		}
		if err := removeFromWorkingTree(root, f); err != nil {
			t.Errorf("re-run on an already-removed target was not a no-op: %v", err)
		}
	})

	t.Run("refuses a target that resolves outside root via a symlinked dir", func(t *testing.T) {
		root := t.TempDir()
		outside := t.TempDir()
		secret := filepath.Join(outside, "secret.txt")
		mustWrite(t, secret)
		link := filepath.Join(root, "escape") // a symlink standing in for a dir
		if err := os.Symlink(outside, link); err != nil {
			t.Skipf("symlinks unsupported here: %v", err)
		}
		dst := filepath.Join(link, "secret.txt") // root/escape/secret.txt -> outside/secret.txt
		err := removeFromWorkingTree(root, dst)
		if err == nil {
			t.Fatal("expected refusal for a target resolving outside the root")
		}
		if !strings.Contains(err.Error(), "outside the Workspace root") {
			t.Errorf("error %q lacks the containment message", err)
		}
		if _, statErr := os.Stat(secret); statErr != nil {
			t.Errorf("outside file was deleted despite the refusal: %v", statErr)
		}
	})
}

// TestWriteFromGitObject_CreatesParentDirs sets up a minimal git repo
// with one committed file, then writes that file's blob to a
// destination path whose parent directories don't exist yet. Asserts
// the file exists, has the expected content, and has 0644 permissions.
//
// This is the only test in this file that requires a real git
// binary; if git is missing, it skips rather than fails (so the rest
// of the package's tests still run in a minimal toolchain image).
func TestWriteFromGitObject_CreatesParentDirs(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}

	repoDir := t.TempDir()
	gitRun(t, repoDir, "init", "-q", "-b", "main")

	// Stage and commit a file at subdir/nested/file.txt with known
	// content so we have a blob SHA to feed cat-file.
	content := []byte("hello world\nthis is the source\n")
	srcRel := filepath.Join("subdir", "nested", "file.txt")
	srcAbs := filepath.Join(repoDir, srcRel)
	if err := os.MkdirAll(filepath.Dir(srcAbs), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(srcAbs, content, 0o644); err != nil {
		t.Fatalf("write src file: %v", err)
	}
	gitRun(t, repoDir, "add", "-A")
	gitRun(t, repoDir, "commit", "-q", "-m", "seed")

	// Target a deeply nested path that does not yet exist on disk.
	dst := filepath.Join(repoDir, "deep", "new", "dir", "out.txt")

	ctx := context.Background()
	// src is the git object reference HEAD:<path> — cat-file -p
	// resolves it to the blob bytes.
	src := "HEAD:" + filepath.ToSlash(srcRel)
	if err := writeFromGitObject(ctx, repoDir, src, dst); err != nil {
		t.Fatalf("writeFromGitObject: %v", err)
	}

	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("read dst: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Errorf("dst content = %q, want %q", got, content)
	}
	info, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat dst: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o644 {
		t.Errorf("dst mode = %o, want 0644", perm)
	}
}

// TestRunWorkspaceUpgrade_RefusesDirtyWorktree is the regression for
// coherence-f6cn.3.3: an unstaged edit to a tracked, template-managed
// path must abort the upgrade (default), and the edit must survive
// untouched — the upgrade must not overwrite it.
func TestRunWorkspaceUpgrade_RefusesDirtyWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}
	ws := buildUpgradeFixture(t, "0.3.1", "0.3.2")

	// Unstaged local edit to a tracked file the upgrade would overwrite.
	dirty := "def a := 1 -- my WIP edit\n"
	writeFixtureFile(t, ws, "Workspace/Notes.lean", dirty)

	var stderr bytes.Buffer
	_, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir: ws,
		NewTag:  "0.3.2",
		Yes:     true,
		NonTTY:  true,
		Stdout:  io.Discard,
		Stderr:  &stderr,
	})
	if !errors.Is(err, ErrDirtyWorktree) {
		t.Fatalf("want ErrDirtyWorktree, got %v", err)
	}
	// The unstaged edit must be exactly as the user left it.
	got, rerr := os.ReadFile(filepath.Join(ws, "Workspace/Notes.lean"))
	if rerr != nil {
		t.Fatalf("read Notes.lean: %v", rerr)
	}
	if string(got) != dirty {
		t.Fatalf("unstaged edit was clobbered:\n got=%q\n want=%q", got, dirty)
	}
	// No upgrade commit should exist: HEAD is still the old tag.
	if head := gitOut(t, ws, "log", "-1", "--pretty=%s"); strings.Contains(head, "axm upgrade") {
		t.Fatalf("an upgrade commit was made despite the dirty tree: %q", head)
	}
}

// TestRunWorkspaceUpgrade_AllowDirtyProceeds verifies the escape hatch:
// --allow-dirty lets the upgrade run on a dirty tree.
func TestRunWorkspaceUpgrade_AllowDirtyProceeds(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}
	ws := buildUpgradeFixture(t, "0.3.1", "0.3.2")
	writeFixtureFile(t, ws, "Workspace/Notes.lean", "def a := 1 -- WIP\n")

	res, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir:    ws,
		NewTag:     "0.3.2",
		Yes:        true,
		AllowDirty: true,
		NonTTY:     true,
		Stdout:     io.Discard,
		Stderr:     io.Discard,
	})
	if err != nil {
		t.Fatalf("AllowDirty upgrade should proceed, got %v", err)
	}
	if res == nil || res.NewTag != "0.3.2" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

// TestRunWorkspaceUpgrade_PreStagedChangesStayOutOfCommit is the
// regression for the .3.4 half folded into coherence-f6cn.3.3: work the
// user had staged before the upgrade must NOT be swept into the upgrade
// commit, and must remain staged afterward.
func TestRunWorkspaceUpgrade_PreStagedChangesStayOutOfCommit(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available on PATH; skipping integration test")
	}
	ws := buildUpgradeFixture(t, "0.3.1", "0.3.2")

	// Pre-stage an unrelated new file, then run with --allow-dirty so the
	// clean-tree guard doesn't block (we're testing commit scope here).
	writeFixtureFile(t, ws, "Workspace/Extra.lean", "def extra := 42\n")
	gitRun(t, ws, "add", "--", "Workspace/Extra.lean")

	if _, err := RunWorkspaceUpgrade(context.Background(), WorkspaceOptions{
		RepoDir:    ws,
		NewTag:     "0.3.2",
		Yes:        true,
		AllowDirty: true,
		NonTTY:     true,
		Stdout:     io.Discard,
		Stderr:     io.Discard,
	}); err != nil {
		t.Fatalf("RunWorkspaceUpgrade: %v", err)
	}

	// The upgrade commit must NOT contain the pre-staged file.
	committed := gitOut(t, ws, "show", "--name-only", "--pretty=format:", "HEAD")
	if strings.Contains(committed, "Workspace/Extra.lean") {
		t.Fatalf("pre-staged file was swept into the upgrade commit:\n%s", committed)
	}
	if !strings.Contains(committed, "lakefile.lean") {
		t.Fatalf("upgrade commit missing its own paths:\n%s", committed)
	}
	// And it must still be staged (the user's WIP is preserved).
	if staged := gitOut(t, ws, "diff", "--cached", "--name-only"); !strings.Contains(staged, "Workspace/Extra.lean") {
		t.Fatalf("pre-staged file no longer staged after upgrade; staged=%q", staged)
	}
}
