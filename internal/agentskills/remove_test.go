package agentskills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// statExists reports whether <ws>/<rel> exists (following nothing — an existing
// dangling symlink still counts as "present", which is what removal cares about).
func statExists(ws, rel string) bool {
	_, err := os.Lstat(filepath.Join(ws, filepath.FromSlash(rel)))
	return err == nil
}

func TestRemove_RoundTrip(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	all := IDs()
	if _, err := Emit(ws, all, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Every agent's probe artifact should exist after emit.
	for _, rel := range []string{
		".claude/skills/formalize/SKILL.md", "CLAUDE.md",
		".agents/skills/formalize/SKILL.md",
		".cursor/skills/formalize/SKILL.md",
		".github/skills/formalize/SKILL.md", ".github/copilot-instructions.md",
		"GEMINI.md",
	} {
		if !statExists(ws, rel) {
			t.Fatalf("precondition: %s should exist after emit", rel)
		}
	}

	if _, err := Remove(ws, all, skills, false); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	// All emitted artifacts — and the empty dirs that held them — are gone.
	for _, rel := range []string{
		".claude/skills/formalize/SKILL.md", ".claude/skills", ".claude", "CLAUDE.md",
		".agents/skills", ".agents",
		".cursor/skills", ".cursor",
		".github/skills/formalize/SKILL.md", ".github/skills", ".github/copilot-instructions.md",
		"GEMINI.md",
	} {
		if statExists(ws, rel) {
			t.Errorf("%s should be gone after remove", rel)
		}
	}
	// The canonical source is never touched.
	if !statExists(ws, ".axiom/skills/formalize/SKILL.md") {
		t.Error("canonical skill must survive remove")
	}
	if !statExists(ws, "AGENTS.md") {
		t.Error("AGENTS.md must survive remove")
	}
}

func TestRemove_Idempotent(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if _, err := Remove(ws, []string{"claude"}, skills, false); err != nil {
		t.Fatalf("first remove: %v", err)
	}
	// Removing again, with nothing on disk, is a clean no-op.
	res, err := Remove(ws, []string{"claude"}, skills, false)
	if err != nil {
		t.Fatalf("second remove: %v", err)
	}
	if len(res["claude"].Removed) != 0 {
		t.Errorf("second remove should delete nothing, got %v", res["claude"].Removed)
	}
}

func TestRemove_KeepsEditedClaudeMd(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Simulate the user replacing the generated CLAUDE.md (symlink or copy) with
	// their own hand-authored file.
	claudeMd := filepath.Join(ws, "CLAUDE.md")
	if err := os.Remove(claudeMd); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(claudeMd, []byte("# My own CLAUDE.md\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := Remove(ws, []string{"claude"}, skills, false)
	if err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if statExists(ws, "CLAUDE.md") == false {
		t.Error("a hand-authored CLAUDE.md must be kept, not deleted")
	}
	if len(res["claude"].Kept) != 1 || res["claude"].Kept[0] != "CLAUDE.md" {
		t.Errorf("CLAUDE.md should be reported as Kept, got %+v", res["claude"])
	}
	if len(res["claude"].Warnings) == 0 {
		t.Error("keeping a hand-authored file should warn")
	}
	// The skill files (unambiguously generated) are still removed.
	if statExists(ws, ".claude/skills/formalize/SKILL.md") {
		t.Error("generated skill file should still be removed")
	}
}

func TestRemove_KeepsHandAuthoredGemini(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	// A GEMINI.md without the generated marker is treated as the user's own.
	if err := os.WriteFile(filepath.Join(ws, "GEMINI.md"), []byte("# hand written, no marker\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := Remove(ws, []string{"gemini"}, skills, false)
	if err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if !statExists(ws, "GEMINI.md") {
		t.Error("a marker-less GEMINI.md must be kept")
	}
	if len(res["gemini"].Kept) != 1 {
		t.Errorf("GEMINI.md should be reported as Kept, got %+v", res["gemini"])
	}
}

func TestRemove_PerSkillGranularity(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// A skill directory the user added by hand (not in the canonical source)
	// must survive removal — removal is keyed by canonical skill name.
	userSkill := filepath.Join(ws, ".claude", "skills", "my-own-skill")
	if err := os.MkdirAll(userSkill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(userSkill, "SKILL.md"), []byte("mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := Remove(ws, []string{"claude"}, skills, false); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if statExists(ws, ".claude/skills/formalize") {
		t.Error("canonical skill dir should be removed")
	}
	if !statExists(ws, ".claude/skills/my-own-skill/SKILL.md") {
		t.Error("a user-added skill dir must be kept")
	}
	// Because a user dir remains, .claude/skills is not empty and is not pruned.
	if !statExists(ws, ".claude/skills") {
		t.Error(".claude/skills should remain while it still holds a user skill")
	}
}

func TestRemove_CopyFallbackRemoved(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Simulate the symlink-less platform fallback: replace the generated
	// CLAUDE.md symlink with a regular file that is a byte-identical copy of
	// AGENTS.md (what mirrorAgentsMD writes when os.Symlink is unavailable).
	claudeMd := filepath.Join(ws, "CLAUDE.md")
	agents, err := os.ReadFile(filepath.Join(ws, "AGENTS.md"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(claudeMd); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(claudeMd, agents, 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := Remove(ws, []string{"claude"}, skills, false)
	if err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if statExists(ws, "CLAUDE.md") {
		t.Error("an unmodified CLAUDE.md copy (symlink-less fallback) must be removed")
	}
	var removedClaudeMd bool
	for _, r := range res["claude"].Removed {
		if r == "CLAUDE.md" {
			removedClaudeMd = true
		}
	}
	if !removedClaudeMd {
		t.Errorf("CLAUDE.md should be reported Removed, got %+v", res["claude"].Removed)
	}
}

func TestRemove_CopilotPerSkillGranularity(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"copilot"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// A user's own skill folder and a workflows dir under .github must survive —
	// removal touches only the canonical-named skill directories.
	mkSkillDir(t, ws, ".github", "skills", "my-own")
	if err := os.MkdirAll(filepath.Join(ws, ".github", "workflows"), 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := Remove(ws, []string{"copilot"}, skills, false); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if statExists(ws, ".github/skills/formalize/SKILL.md") {
		t.Error("canonical skill directory should be removed")
	}
	if statExists(ws, ".github/copilot-instructions.md") {
		t.Error("generated copilot-instructions.md should be removed")
	}
	if !statExists(ws, ".github/skills/my-own/SKILL.md") {
		t.Error("a user's own skill folder must be kept")
	}
	if !statExists(ws, ".github/skills") {
		t.Error(".github/skills should remain while it still holds a user skill")
	}
	if !statExists(ws, ".github/workflows") {
		t.Error(".github must never be pruned — it holds unrelated files")
	}
}

// TestGeneratedMarker guards the invariant the remover relies on: the note
// stamped into generated files actually contains the marker the remover greps
// for. If the note is reworded without the marker, removal would stop
// recognizing its own output.
func TestGeneratedMarker(t *testing.T) {
	note := strings.Replace(generatedNote, "%s", "gemini", 1)
	if !strings.Contains(note, generatedMarker) {
		t.Errorf("generatedNote must contain generatedMarker %q; note = %q", generatedMarker, note)
	}
}
