// Package agentskills materializes the workspace's canonical AI skills into
// the native instruction/rule/skill format of whichever AI coding agent a
// user runs.
//
// The canonical source is a set of SKILL.md files under `.axiom/skills/` —
// the de-facto cross-agent "Agent Skills" format (YAML frontmatter with a
// `description`, plus a markdown body). `axm init` and `axm agents add` read
// that source and emit per-agent artifacts:
//
//   - claude  → .claude/skills/<name>/SKILL.md   (verbatim — native SKILL.md)
//   - codex   → .agents/skills/<name>/SKILL.md   (verbatim — native SKILL.md)
//   - cursor  → .cursor/skills/<name>/SKILL.md   (verbatim — native SKILL.md)
//   - copilot → .github/skills/<name>/SKILL.md   (verbatim — native SKILL.md) (+ copilot-instructions.md)
//   - gemini  → GEMINI.md                        (flattened — no skill mechanism)
//
// The agent set is data-driven: adding an agent is one entry in `registry`.
// This matters because the agent landscape churns fast (formats rebrand and
// retire), so the mapping is kept in one editable table rather than scattered
// through the CLI.
package agentskills

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// CanonicalDir is the workspace-relative directory holding the canonical
// SKILL.md sources that every per-agent emitter reads from.
const CanonicalDir = ".axiom/skills"

// ErrNoCanonical is returned by LoadCanonical when the canonical skills
// directory is absent — e.g. `axm agents add` run outside an Axiom workspace,
// or a workspace predating the multi-agent skill layout.
var ErrNoCanonical = errors.New("no canonical skills found")

// Skill is one canonical skill parsed from .axiom/skills/<name>/SKILL.md.
type Skill struct {
	// Name is the skill's directory name — the authoritative skill identity
	// (Claude Code and Codex both key off the directory, not frontmatter).
	Name string
	// Description is the frontmatter `description` (the "use when …" line that
	// drives discovery in skill- and rule-aware agents).
	Description string
	// Body is the markdown after the frontmatter block, leading blank lines
	// trimmed.
	Body string
	// Raw is the full original file content, byte-for-byte, used for the
	// verbatim (native SKILL.md) emitters.
	Raw string
	// SourcePath is the absolute path to the canonical SKILL.md.
	SourcePath string
}

// EmitResult records what an emitter wrote and any lossy-conversion warnings
// the user should know about for that agent.
type EmitResult struct {
	Files    []string // workspace-relative paths written
	Warnings []string // human-readable lossy-conversion notes (may be empty)
}

// Artifact is one file an emitter intends to materialize. Exactly one shape
// applies: a regular file (Content holds the bytes) or the AGENTS.md mirror
// (Mirror true — the applier writes a relative symlink to AGENTS.md with a copy
// fallback, and staleness treats an unmodified symlink/copy as current). Making
// emitters return artifacts rather than write directly lets add, sync, dry-run,
// and staleness all share one deterministic source of truth.
type Artifact struct {
	Rel     string // workspace-relative path
	Content string // file body (for Mirror, the AGENTS.md content used for the copy fallback / comparison)
	Mirror  bool   // true => materialize as the AGENTS.md mirror (symlink, copy fallback)
}

// RemoveResult records what a remover deleted, what it deliberately left in
// place (a file that no longer looks axm-generated), and any notes the user
// should see. Removal is deliberately conservative: only artifacts that still
// look generated are deleted, so a hand-edited CLAUDE.md/GEMINI.md is reported
// in Kept rather than clobbered.
type RemoveResult struct {
	Removed  []string // workspace-relative paths deleted
	Kept     []string // workspace-relative paths left in place (not axm-generated)
	Warnings []string // human-readable notes (e.g. why a file was kept)
}

// Agent describes one supported AI coding agent: its identity, how to guess
// whether the user runs it, and how to emit its native artifacts.
type Agent struct {
	ID     string // stable lowercase identifier used on the CLI
	Name   string // human display name
	detect func() bool
	plan   func(a Agent, ws string, skills []Skill) ([]Artifact, []string) // artifacts to write + lossy warnings
	remove func(a Agent, ws string, skills []Skill, dryRun bool) (RemoveResult, error)
	// skillRoot is the workspace-relative directory holding this agent's per-skill
	// artifacts, one native <root>/<name>/SKILL.md per skill ("" for an agent with
	// no per-skill files, e.g. gemini). It is the single source of truth for
	// per-skill layout: the emitter, remover, and orphan scan all derive paths
	// from it, so they cannot drift. Every per-skill agent now uses the Anthropic
	// Agent Skills standard (folder-per-skill SKILL.md), so there is no per-agent
	// filename variation to encode.
	skillRoot string
	// sharedParent marks an agent whose skillRoot parent directory is shared with
	// non-axm files (copilot's .github holds workflows). Removal prunes only the
	// skillRoot itself for such agents, never the parent.
	sharedParent bool
}

// pruneDirRels returns the directories removal should try to prune (deepest
// first) once an agent's per-skill artifacts are gone: the skill root, plus its
// parent unless that parent is shared (copilot's .github). Both are derived from
// skillRoot, so they cannot drift from the emitter's layout. pruneEmptyDirs only
// removes a dir that is actually empty, so listing the parent is always safe.
func (a Agent) pruneDirRels() []string {
	if a.skillRoot == "" {
		return nil
	}
	root := filepath.FromSlash(a.skillRoot)
	dirs := []string{root}
	if parent := filepath.Dir(root); !a.sharedParent && parent != "." && parent != string(filepath.Separator) {
		dirs = append(dirs, parent)
	}
	return dirs
}

// skillArtifactRel returns the workspace-relative path of agent a's emitted
// artifact for skill name — a native SKILL.md inside a per-skill directory. It
// returns "" for an agent with no per-skill artifacts (gemini).
func (a Agent) skillArtifactRel(name string) string {
	if a.skillRoot == "" {
		return ""
	}
	return filepath.Join(filepath.FromSlash(a.skillRoot), name, "SKILL.md")
}

// skillDirRel returns the per-skill directory removal should delete — the parent
// of skillArtifactRel — or "" for an agent with no per-skill files (gemini).
func (a Agent) skillDirRel(name string) string {
	if a.skillRoot == "" {
		return ""
	}
	return filepath.Join(filepath.FromSlash(a.skillRoot), name)
}

// registry is the ordered set of supported agents. Order is the display order
// in `axm agents list` and the interactive selector. To add an agent, append
// one entry here and implement its emitter in emit.go.
var registry = []Agent{
	{ID: "claude", Name: "Claude Code", detect: detectClaude, plan: planClaude, remove: removeClaude,
		skillRoot: ".claude/skills"},
	{ID: "cursor", Name: "Cursor", detect: detectCursor, plan: planCursor, remove: removeCursor,
		skillRoot: ".cursor/skills"},
	{ID: "codex", Name: "OpenAI Codex", detect: detectCodex, plan: planCodex, remove: removeCodex,
		skillRoot: ".agents/skills"},
	{ID: "copilot", Name: "GitHub Copilot", detect: detectCopilot, plan: planCopilot, remove: removeCopilot,
		skillRoot: ".github/skills", sharedParent: true},
	{ID: "gemini", Name: "Gemini", detect: detectGemini, plan: planGemini, remove: removeGemini},
}

// All returns the supported agents in display order.
func All() []Agent { return registry }

// ByID returns the agent with the given id, or (zero, false).
func ByID(id string) (Agent, bool) {
	for _, a := range registry {
		if a.ID == id {
			return a, true
		}
	}
	return Agent{}, false
}

// IDs returns every supported agent id in display order.
func IDs() []string {
	ids := make([]string, len(registry))
	for i, a := range registry {
		ids[i] = a.ID
	}
	return ids
}

// LoadCanonical reads every <ws>/.axiom/skills/<name>/SKILL.md, parses it, and
// returns the skills sorted by name. A missing canonical directory yields
// ErrNoCanonical so callers can print a workspace-aware remediation.
func LoadCanonical(ws string) ([]Skill, error) {
	root := filepath.Join(ws, filepath.FromSlash(CanonicalDir))
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w at %s", ErrNoCanonical, root)
		}
		return nil, fmt.Errorf("read canonical skills dir %s: %w", root, err)
	}
	var skills []Skill
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		path := filepath.Join(root, e.Name(), "SKILL.md")
		raw, err := os.ReadFile(path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue // a non-skill subdir; skip rather than fail the batch
			}
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		s := parseSkill(e.Name(), string(raw), path)
		skills = append(skills, s)
	}
	sort.Slice(skills, func(i, j int) bool { return skills[i].Name < skills[j].Name })
	return skills, nil
}

// parseSkill extracts the `description` frontmatter field and the markdown body
// from a SKILL.md. It is deliberately lenient: a file without a leading `---`
// frontmatter block is treated as an all-body skill with an empty description,
// so a malformed skill still emits (just without discovery metadata) rather
// than aborting the whole materialization.
func parseSkill(name, raw, path string) Skill {
	s := Skill{Name: name, Raw: raw, SourcePath: path, Body: strings.TrimLeft(raw, "\n")}
	rest, ok := strings.CutPrefix(raw, "---\n")
	if !ok {
		return s
	}
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return s
	}
	front := rest[:end]
	body := rest[end+len("\n---"):]
	// Drop the remainder of the closing fence line and any leading blank lines.
	if nl := strings.IndexByte(body, '\n'); nl >= 0 {
		body = body[nl+1:]
	} else {
		body = ""
	}
	s.Body = strings.TrimLeft(body, "\n")
	for _, line := range strings.Split(front, "\n") {
		key, val, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		if strings.TrimSpace(key) == "description" {
			s.Description = strings.TrimSpace(val)
		}
	}
	return s
}

// ParseSpec resolves a non-interactive `--agents` / AXIOM_AGENTS value into a
// concrete, deduplicated, registry-ordered list of agent ids. Accepted forms:
//
//   - "all"                 → every supported agent
//   - "none" / ""           → empty selection (skip materialization)
//   - "detect" / "detected" → the detected set (pass it in)
//   - "claude,cursor,…"     → an explicit comma/space-separated id list
//
// Unknown ids are a hard error naming the offender and the valid set.
func ParseSpec(spec string, detected []string) ([]string, error) {
	switch strings.ToLower(strings.TrimSpace(spec)) {
	case "", "none":
		return nil, nil
	case "all":
		return IDs(), nil
	case "detect", "detected":
		return orderIDs(detected), nil
	}
	want := map[string]bool{}
	for _, tok := range strings.FieldsFunc(spec, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' }) {
		id := strings.ToLower(strings.TrimSpace(tok))
		if id == "" {
			continue
		}
		if _, ok := ByID(id); !ok {
			return nil, fmt.Errorf("unknown agent %q (supported: %s)", id, strings.Join(IDs(), ", "))
		}
		want[id] = true
	}
	keys := make([]string, 0, len(want))
	for id := range want {
		keys = append(keys, id)
	}
	return orderIDs(keys), nil
}

// Order returns the given ids in registry (display) order, deduplicated and
// with any unknown ids dropped. Use it to normalize a user-entered selection.
func Order(ids []string) []string { return orderIDs(ids) }

// orderIDs returns the given ids in registry (display) order, deduplicated and
// with any unknown ids dropped.
func orderIDs(ids []string) []string {
	set := map[string]bool{}
	for _, id := range ids {
		set[id] = true
	}
	var out []string
	for _, a := range registry {
		if set[a.ID] {
			out = append(out, a.ID)
		}
	}
	return out
}

// Detect returns the ids of agents that appear to be installed, in display
// order. Detection is a best-effort heuristic (presence of a config dir or a
// binary on PATH) used only to pre-select the interactive prompt — never to
// silently materialize without the user's say-so.
func Detect() []string {
	var ids []string
	for _, a := range registry {
		if a.detect != nil && a.detect() {
			ids = append(ids, a.ID)
		}
	}
	return ids
}

// Emit materializes the given skills for each requested agent id. It returns a
// per-agent result keyed by id. An unknown id is a hard error; an emitter
// failure aborts and is returned wrapped (partial writes for earlier agents
// remain on disk — materialization is additive and idempotent, so re-running
// is safe).
func Emit(ws string, ids []string, skills []Skill) (map[string]EmitResult, error) {
	results := map[string]EmitResult{}
	for _, id := range ids {
		a, ok := ByID(id)
		if !ok {
			return results, fmt.Errorf("unknown agent %q", id)
		}
		arts, warns := a.plan(a, ws, skills)
		files, err := applyArtifacts(ws, arts)
		if err != nil {
			return results, fmt.Errorf("emit %s: %w", id, err)
		}
		results[id] = EmitResult{Files: files, Warnings: warns}
	}
	return results, nil
}

// Remove deletes the per-agent artifacts each named agent would have emitted —
// the reverse of Emit. It is data-driven over the same registry, so an agent's
// emitter and remover stay in lockstep. An unknown id is a hard error; a remover
// failure aborts and is returned wrapped (artifacts removed for earlier agents
// stay removed — removal is idempotent, so re-running is safe). Removal is
// conservative: it deletes only files that still look generated and reports any
// it kept (see RemoveResult). When dryRun is true nothing is deleted, but the
// RemoveResult is populated exactly as a real run would, so callers can preview.
func Remove(ws string, ids []string, skills []Skill, dryRun bool) (map[string]RemoveResult, error) {
	results := map[string]RemoveResult{}
	for _, id := range ids {
		a, ok := ByID(id)
		if !ok {
			return results, fmt.Errorf("unknown agent %q", id)
		}
		if a.remove == nil {
			return results, fmt.Errorf("agent %q does not support removal", id)
		}
		res, err := a.remove(a, ws, skills, dryRun)
		if err != nil {
			return results, fmt.Errorf("remove %s: %w", id, err)
		}
		results[id] = res
	}
	return results, nil
}

// --- detection heuristics -------------------------------------------------

func detectClaude() bool  { return homeDirExists(".claude") || onPath("claude") }
func detectCursor() bool  { return homeDirExists(".cursor") || onPath("cursor") }
func detectCodex() bool   { return homeDirExists(".codex") || onPath("codex") }
func detectGemini() bool  { return homeDirExists(".gemini") || onPath("gemini") }
func detectCopilot() bool { return homeDirExists(".config/github-copilot") || onPath("copilot") }

// homeDirExists reports whether <home>/<rel> exists.
func homeDirExists(rel string) bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(home, filepath.FromSlash(rel)))
	return err == nil
}

func onPath(bin string) bool {
	_, err := exec.LookPath(bin)
	return err == nil
}
