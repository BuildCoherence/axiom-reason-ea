package agentskills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStale_FreshEmitIsCurrent(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	ids := []string{"claude", "cursor", "codex", "copilot", "gemini"}
	if _, err := Emit(ws, ids, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	for _, id := range ids {
		stale, err := Stale(ws, id, skills)
		if err != nil {
			t.Fatalf("Stale %s: %v", id, err)
		}
		if stale {
			t.Errorf("%s should be current right after emit", id)
		}
	}
}

func TestStale_EditedSourceThenSync(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"cursor"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Edit the canonical skill body — the emitted rule is now out of date.
	edited := strings.Replace(sampleSkill, "The body goes here.", "Edited body.", 1)
	if err := os.WriteFile(filepath.Join(ws, ".axiom", "skills", "formalize", "SKILL.md"), []byte(edited), 0o644); err != nil {
		t.Fatal(err)
	}
	skills2, _ := LoadCanonical(ws)

	if stale, _ := Stale(ws, "cursor", skills2); !stale {
		t.Fatal("cursor should be stale after editing the source")
	}
	if _, err := Sync(ws, []string{"cursor"}, skills2, false, false); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if stale, _ := Stale(ws, "cursor", skills2); stale {
		t.Error("cursor should be current after sync")
	}
	if got := readFile(t, ws, ".cursor/skills/formalize/SKILL.md"); !strings.Contains(got, "Edited body.") {
		t.Errorf("synced SKILL.md missing the edit:\n%s", got)
	}
}

func TestSync_Idempotent(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	res, err := Sync(ws, []string{"claude"}, skills, false, false)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	r := res["claude"]
	if n := len(r.Created) + len(r.Updated) + len(r.Pruned); n != 0 {
		t.Errorf("sync right after emit should be a no-op, got %+v", r)
	}
}

func TestSync_DryRunWritesNothing(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	res, err := Sync(ws, []string{"cursor"}, skills, true, false)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if len(res["cursor"].Created) == 0 {
		t.Error("dry-run should report pending creates")
	}
	if statExists(ws, ".cursor/skills/formalize/SKILL.md") {
		t.Error("dry-run must not write anything")
	}
}

func TestOrphans_PruneIsOptIn(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude", "cursor"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Simulate a renamed/removed skill leaving stale generated artifacts.
	mkSkillDir(t, ws, ".claude", "skills", "ghost")
	mkSkillDir(t, ws, ".cursor", "skills", "ghost")

	if o := Orphans(ws, "claude", skills); len(o) != 1 || o[0] != filepath.Join(".claude", "skills", "ghost") {
		t.Errorf("claude orphans = %v", o)
	}
	if o := Orphans(ws, "cursor", skills); len(o) != 1 || o[0] != filepath.Join(".cursor", "skills", "ghost") {
		t.Errorf("cursor orphans = %v", o)
	}
	// Plain sync (no prune) must NOT delete orphans.
	if _, err := Sync(ws, []string{"claude"}, skills, false, false); err != nil {
		t.Fatal(err)
	}
	if !statExists(ws, ".claude/skills/ghost") {
		t.Error("plain sync must not prune orphans")
	}
	// sync --prune removes them, but keeps the real skill.
	res, err := Sync(ws, []string{"claude", "cursor"}, skills, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if statExists(ws, ".claude/skills/ghost") || statExists(ws, ".cursor/skills/ghost") {
		t.Error("prune should remove both orphans")
	}
	if len(res["claude"].Pruned) != 1 {
		t.Errorf("claude pruned = %v", res["claude"].Pruned)
	}
	if !statExists(ws, ".claude/skills/formalize/SKILL.md") {
		t.Error("the real skill must survive prune")
	}
}

func TestStale_MirrorReplacedByUserFile(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if stale, _ := Stale(ws, "claude", skills); stale {
		t.Fatal("claude should be current right after emit")
	}
	// Replace the generated CLAUDE.md mirror with a hand-authored file — the
	// Mirror artifact is no longer current, so the agent is stale.
	claudeMd := filepath.Join(ws, "CLAUDE.md")
	if err := os.Remove(claudeMd); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(claudeMd, []byte("# my own\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stale, err := Stale(ws, "claude", skills)
	if err != nil {
		t.Fatal(err)
	}
	if !stale {
		t.Error("claude should be stale once its CLAUDE.md mirror is replaced by a user file")
	}
}

func TestSync_DryRunUpdateAndPruneReportWithoutWriting(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"cursor"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Edit the source so a real sync would UPDATE, and add an orphan to prune.
	edited := strings.Replace(sampleSkill, "The body goes here.", "Changed.", 1)
	if err := os.WriteFile(filepath.Join(ws, ".axiom", "skills", "formalize", "SKILL.md"), []byte(edited), 0o644); err != nil {
		t.Fatal(err)
	}
	skills2, _ := LoadCanonical(ws)
	mkSkillDir(t, ws, ".cursor", "skills", "ghost")
	before := readFile(t, ws, ".cursor/skills/formalize/SKILL.md")

	res, err := Sync(ws, []string{"cursor"}, skills2, true, true) // dryRun + prune
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	r := res["cursor"]
	if len(r.Updated) != 1 {
		t.Errorf("dry-run should report 1 update, got %+v", r.Updated)
	}
	if len(r.Pruned) != 1 {
		t.Errorf("dry-run --prune should report 1 prune, got %+v", r.Pruned)
	}
	// Nothing actually changed on disk.
	if got := readFile(t, ws, ".cursor/skills/formalize/SKILL.md"); got != before {
		t.Error("dry-run must not rewrite the updated file")
	}
	if !statExists(ws, ".cursor/skills/ghost") {
		t.Error("dry-run --prune must not delete the orphan")
	}
}

func TestSkillArtifactRel_Layout(t *testing.T) {
	cases := map[string]string{
		"claude":  filepath.Join(".claude", "skills", "x", "SKILL.md"),
		"codex":   filepath.Join(".agents", "skills", "x", "SKILL.md"),
		"cursor":  filepath.Join(".cursor", "skills", "x", "SKILL.md"),
		"copilot": filepath.Join(".github", "skills", "x", "SKILL.md"),
	}
	for id, want := range cases {
		a, _ := ByID(id)
		if got := a.skillArtifactRel("x"); got != want {
			t.Errorf("%s skillArtifactRel = %q, want %q", id, got, want)
		}
	}
	if g, _ := ByID("gemini"); g.skillArtifactRel("x") != "" {
		t.Error("gemini has no per-skill artifact")
	}
}

func TestRemove_DryRun(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	res, err := Remove(ws, []string{"claude"}, skills, true) // dryRun
	if err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if len(res["claude"].Removed) == 0 {
		t.Error("dry-run remove should report the paths it would delete")
	}
	if !statExists(ws, ".claude/skills/formalize/SKILL.md") || !statExists(ws, "CLAUDE.md") {
		t.Error("dry-run must not delete anything")
	}
}

func mkSkillDir(t *testing.T, ws string, parts ...string) {
	t.Helper()
	dir := filepath.Join(append([]string{ws}, parts...)...)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("stale\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}
