package agentskills

import (
	"fmt"
	"os"
	"path/filepath"
)

// This file builds on the plan model (emit.go) to add the "keep generated files
// current" operations: detecting drift (Stale / PlanChanges), regenerating
// (Sync), and removing artifacts whose source skill is gone (Orphans). All three
// reuse the same plan* output, so they never disagree with what `add` writes.

// ChangeOp classifies one pending change to an agent's generated files.
type ChangeOp string

const (
	OpCreate ChangeOp = "create" // an expected artifact is missing
	OpUpdate ChangeOp = "update" // an artifact exists but its bytes differ from the source
)

// Change is one pending difference between the canonical source and an agent's
// generated files on disk. It covers content drift (create/update) of the
// current skills' artifacts — not orphan cleanup, which is a separate opt-in
// concern (see Orphans and Sync's prune parameter), because a file in an
// agent's owned directory that no current skill maps to may be the user's own.
type Change struct {
	Rel string
	Op  ChangeOp
}

// SyncResult records what a sync did (or, under dryRun, would do) for one agent.
type SyncResult struct {
	Created  []string // artifacts written that were absent
	Updated  []string // artifacts rewritten because their bytes had drifted
	Pruned   []string // orphaned artifacts removed (only when prune was requested)
	Warnings []string // lossy-conversion notes (same as add)
}

// artifactCurrent reports whether the on-disk file at art.Rel already matches
// what the emitter would write — the core of drift detection. For the AGENTS.md
// mirror it defers to isGeneratedMirror (an unmodified symlink/copy is current);
// otherwise it compares bytes.
func artifactCurrent(ws string, art Artifact) bool {
	if art.Mirror {
		return isGeneratedMirror(ws, art.Rel)
	}
	data, err := os.ReadFile(filepath.Join(ws, art.Rel))
	return err == nil && string(data) == art.Content
}

// Orphans returns the workspace-relative paths of an agent's per-skill artifacts
// whose source skill is no longer in the canonical set — files left behind when
// a skill is renamed or deleted. It scans the agent's owned per-skill directory
// (so it can only ever flag axm-shaped artifacts) and never touches single
// shared files (CLAUDE.md/GEMINI.md/copilot-instructions.md), which removal
// handles via the generated-marker guard. Agents with no per-skill directory
// (gemini) have no orphans.
func Orphans(ws, id string, skills []Skill) []string {
	a, ok := ByID(id)
	if !ok || a.skillRoot == "" {
		return nil
	}
	canon := map[string]bool{}
	for _, s := range skills {
		canon[s.Name] = true
	}
	rootRel := filepath.FromSlash(a.skillRoot)
	entries, err := os.ReadDir(filepath.Join(ws, rootRel))
	if err != nil {
		// A missing root (agent not configured) or any other read error yields no
		// orphans: pruning is best-effort and opt-in, and a genuine problem on the
		// root surfaces at the apply step (Sync writes into it before pruning).
		return nil
	}
	var orphans []string
	for _, e := range entries {
		name, ok := a.skillNameOf(e)
		if !ok || canon[name] {
			continue
		}
		orphans = append(orphans, filepath.Join(rootRel, e.Name()))
	}
	return orphans
}

// skillNameOf reports the skill name a directory entry under skillRoot encodes,
// and whether the entry is an axm-shaped per-skill artifact at all. Every
// per-skill agent uses the native folder-per-skill SKILL.md layout, so a
// per-skill artifact is a subdirectory named for the skill; anything else (a
// stray file in the root) is not ours.
func (a Agent) skillNameOf(e os.DirEntry) (string, bool) {
	if !e.IsDir() {
		return "", false
	}
	return e.Name(), true
}

// PlanChanges computes the pending content changes for one agent without
// touching disk: artifacts to create (missing) or update (bytes differ from the
// source). It does not include orphan pruning — that is the opt-in concern. An
// empty result means the agent's current-skill artifacts are up to date.
func PlanChanges(ws, id string, skills []Skill) ([]Change, error) {
	a, ok := ByID(id)
	if !ok {
		return nil, fmt.Errorf("unknown agent %q", id)
	}
	arts, _ := a.plan(a, ws, skills)
	var changes []Change
	for _, art := range arts {
		if artifactCurrent(ws, art) {
			continue
		}
		op := OpUpdate
		if !pathExists(ws, art.Rel) {
			op = OpCreate
		}
		changes = append(changes, Change{Rel: art.Rel, Op: op})
	}
	return changes, nil
}

// Stale reports whether an agent's generated files have drifted from the
// canonical source — i.e. whether a plain `sync` would rewrite anything. It is
// the regenerate-and-compare check (no hash/mtime/lockfile to drift). Orphans
// are not counted as staleness (they are the opt-in `--prune` concern).
func Stale(ws, id string, skills []Skill) (bool, error) {
	changes, err := PlanChanges(ws, id, skills)
	return len(changes) > 0, err
}

// Sync regenerates each named agent's artifacts from the canonical source,
// returning what changed per agent. It is full-overwrite idempotent: a second
// run with an unchanged source is a no-op. When prune is true it also deletes
// orphaned per-skill artifacts (those whose source skill was renamed/removed);
// pruning is opt-in because a file in an agent's owned directory that maps to no
// current skill may be the user's own. Under dryRun it computes and returns the
// would-be changes without writing or deleting.
func Sync(ws string, ids []string, skills []Skill, dryRun, prune bool) (map[string]SyncResult, error) {
	results := map[string]SyncResult{}
	for _, id := range ids {
		a, ok := ByID(id)
		if !ok {
			return results, fmt.Errorf("unknown agent %q", id)
		}
		arts, warns := a.plan(a, ws, skills)
		sr := SyncResult{Warnings: warns}
		for _, art := range arts {
			if artifactCurrent(ws, art) {
				continue
			}
			if pathExists(ws, art.Rel) {
				sr.Updated = append(sr.Updated, art.Rel)
			} else {
				sr.Created = append(sr.Created, art.Rel)
			}
		}
		if prune {
			sr.Pruned = Orphans(ws, id, skills)
		}

		if !dryRun {
			if _, err := applyArtifacts(ws, arts); err != nil {
				return results, fmt.Errorf("sync %s: %w", id, err)
			}
			for _, o := range sr.Pruned {
				if err := os.RemoveAll(filepath.Join(ws, o)); err != nil {
					return results, fmt.Errorf("sync %s: prune %s: %w", id, o, err)
				}
			}
		}
		results[id] = sr
	}
	return results, nil
}

// pathExists reports whether <ws>/<rel> exists (following nothing — a present
// symlink, even a dangling one, counts).
func pathExists(ws, rel string) bool {
	_, err := os.Lstat(filepath.Join(ws, rel))
	return err == nil
}
