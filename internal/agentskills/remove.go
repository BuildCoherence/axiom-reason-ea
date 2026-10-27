package agentskills

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// This file mirrors the plan* emitters in reverse: each agent has a remove*
// that deletes exactly the artifacts that agent materializes. Both derive their
// per-skill layout from the same registry field (Agent.skillRoot) and
// single-file constants, so "add" and "remove" cannot drift.
//
// Two safety rules run through every remover:
//
//   - Per-skill files are keyed by the canonical skill *name* (the directory or
//     filename the emitter derives from it), so removal touches only the skills
//     axm generated and never a sibling skill/rule the user hand-added.
//   - AGENTS.md-derived single files (CLAUDE.md, GEMINI.md,
//     copilot-instructions.md) are deleted only while they still look generated
//     (an unmodified symlink/copy, or carrying generatedMarker). A file the user
//     has edited or authored is kept and surfaced in RemoveResult.Kept.
//
// Every remover honors dryRun: when true it records what it *would* delete or
// keep in the RemoveResult but touches nothing on disk.

// removeClaude deletes the native SKILL.md skill directories and the CLAUDE.md
// AGENTS.md mirror, then prunes the now-empty .claude tree.
func removeClaude(a Agent, ws string, skills []Skill, dryRun bool) (RemoveResult, error) {
	var res RemoveResult
	if err := removeSkillDirs(a, ws, skills, dryRun, &res); err != nil {
		return res, err
	}
	if err := removeAgentsMirror(ws, claudeMirrorFile, dryRun, &res); err != nil {
		return res, err
	}
	pruneEmptyDirs(ws, dryRun, &res, a.pruneDirRels()...)
	return res, nil
}

// removeCodex deletes the native SKILL.md skill directories and prunes the
// now-empty .agents tree. Codex reads AGENTS.md natively — no instruction file.
func removeCodex(a Agent, ws string, skills []Skill, dryRun bool) (RemoveResult, error) {
	var res RemoveResult
	if err := removeSkillDirs(a, ws, skills, dryRun, &res); err != nil {
		return res, err
	}
	pruneEmptyDirs(ws, dryRun, &res, a.pruneDirRels()...)
	return res, nil
}

// removeCursor deletes the per-skill .cursor/skills/<name>/ directories and
// prunes the now-empty .cursor tree. Cursor uses the native SKILL.md layout, so
// removal is directory-style like claude/codex.
func removeCursor(a Agent, ws string, skills []Skill, dryRun bool) (RemoveResult, error) {
	var res RemoveResult
	if err := removeSkillDirs(a, ws, skills, dryRun, &res); err != nil {
		return res, err
	}
	pruneEmptyDirs(ws, dryRun, &res, a.pruneDirRels()...)
	return res, nil
}

// removeCopilot deletes the per-skill .github/skills/<name>/ directories and the
// generated copilot-instructions.md (only if unmodified), then prunes
// .github/skills if empty. .github itself is left alone — it commonly holds
// unrelated files (sharedParent), so it is never pruned.
func removeCopilot(a Agent, ws string, skills []Skill, dryRun bool) (RemoveResult, error) {
	var res RemoveResult
	if err := removeSkillDirs(a, ws, skills, dryRun, &res); err != nil {
		return res, err
	}
	if err := removeGeneratedMarked(ws, copilotRootFile, dryRun, &res); err != nil {
		return res, err
	}
	pruneEmptyDirs(ws, dryRun, &res, a.pruneDirRels()...)
	return res, nil
}

// removeGemini deletes the generated GEMINI.md (only if it still carries the
// generated marker). It is a single flattened file — no per-skill artifacts.
func removeGemini(_ Agent, ws string, _ []Skill, dryRun bool) (RemoveResult, error) {
	var res RemoveResult
	if err := removeGeneratedMarked(ws, geminiFile, dryRun, &res); err != nil {
		return res, err
	}
	return res, nil
}

// --- helpers --------------------------------------------------------------

// removeSkillDirs deletes the per-skill directory the verbatim SKILL.md emitters
// (Claude, Codex) write for each canonical skill. The directory comes from the
// same registry layout the emitter uses (a.skillDirRel), so the two stay in
// lockstep. The directory name is the authoritative skill identity, so this
// removes only axm-generated skills and leaves any hand-added sibling.
func removeSkillDirs(a Agent, ws string, skills []Skill, dryRun bool, res *RemoveResult) error {
	for _, s := range skills {
		rel := a.skillDirRel(s.Name)
		if rel == "" {
			continue
		}
		info, err := os.Lstat(filepath.Join(ws, rel))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return fmt.Errorf("stat %s: %w", rel, err)
		}
		if !info.IsDir() {
			continue
		}
		if !dryRun {
			if err := os.RemoveAll(filepath.Join(ws, rel)); err != nil {
				return fmt.Errorf("remove %s: %w", rel, err)
			}
		}
		res.Removed = append(res.Removed, rel)
	}
	return nil
}

// removeAgentsMirror deletes a CLAUDE.md-style AGENTS.md mirror only while it is
// still the artifact axm produced (see isGeneratedMirror). A CLAUDE.md the user
// hand-authored or edited is kept and reported, never clobbered. The symlink
// I/O-error case is reported distinctly so it is not misattributed to a user
// edit.
func removeAgentsMirror(ws, rel string, dryRun bool, res *RemoveResult) error {
	p := filepath.Join(ws, rel)
	info, err := os.Lstat(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("stat %s: %w", rel, err)
	}
	// Distinguish a genuine symlink read failure (keep, but don't blame the
	// user) from a file that simply is not our mirror.
	if info.Mode()&os.ModeSymlink != 0 {
		if _, lerr := os.Readlink(p); lerr != nil {
			res.Kept = append(res.Kept, rel)
			res.Warnings = append(res.Warnings,
				fmt.Sprintf("%s: cannot read symlink (%v); left in place", rel, lerr))
			return nil
		}
	}
	if !isGeneratedMirror(ws, rel) {
		res.Kept = append(res.Kept, rel)
		res.Warnings = append(res.Warnings,
			fmt.Sprintf("%s is not an unmodified AGENTS.md mirror (edited or hand-authored); left in place", rel))
		return nil
	}
	if !dryRun {
		if err := os.Remove(p); err != nil {
			return fmt.Errorf("remove %s: %w", rel, err)
		}
	}
	res.Removed = append(res.Removed, rel)
	return nil
}

// removeGeneratedMarked deletes a single AGENTS.md-derived file (GEMINI.md,
// copilot-instructions.md) only while it still carries generatedMarker. A file
// without the marker is assumed hand-authored and kept.
func removeGeneratedMarked(ws, rel string, dryRun bool, res *RemoveResult) error {
	p := filepath.Join(ws, rel)
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read %s: %w", rel, err)
	}
	if !strings.Contains(string(data), generatedMarker) {
		res.Kept = append(res.Kept, rel)
		res.Warnings = append(res.Warnings,
			fmt.Sprintf("%s has no generated marker (looks hand-authored); left in place", rel))
		return nil
	}
	if !dryRun {
		if err := os.Remove(p); err != nil {
			return fmt.Errorf("remove %s: %w", rel, err)
		}
	}
	res.Removed = append(res.Removed, rel)
	return nil
}

// pruneEmptyDirs removes each given workspace-relative dir if (and only if) it
// is empty, in the order given (deepest first). A dir that still holds files —
// a .github with workflows, a .claude with a user's own subdir — is left
// untouched, so pruning never deletes anything axm did not own. A dir that is
// already gone is a clean no-op; any other read/remove error is surfaced as a
// warning rather than swallowed. Under dryRun this is a no-op: with nothing
// actually deleted there is no reliable empty-dir state to predict.
func pruneEmptyDirs(ws string, dryRun bool, res *RemoveResult, rels ...string) {
	if dryRun {
		return
	}
	for _, rel := range rels {
		p := filepath.Join(ws, rel)
		entries, err := os.ReadDir(p)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				res.Warnings = append(res.Warnings, fmt.Sprintf("could not check %s for pruning: %v", rel, err))
			}
			continue
		}
		if len(entries) > 0 {
			continue
		}
		if err := os.Remove(p); err != nil {
			res.Warnings = append(res.Warnings, fmt.Sprintf("could not prune empty %s: %v", rel, err))
		}
	}
}
