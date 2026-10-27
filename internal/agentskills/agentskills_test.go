package agentskills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sampleSkill = `---
name: formalize
description: Use when the user has crisp intent — a User Axiom or Statement.
---

# Formalize

The body goes here.
`

func TestParseSkill(t *testing.T) {
	s := parseSkill("formalize", sampleSkill, "/x/SKILL.md")
	if s.Name != "formalize" {
		t.Errorf("Name = %q, want formalize", s.Name)
	}
	if want := "Use when the user has crisp intent — a User Axiom or Statement."; s.Description != want {
		t.Errorf("Description = %q, want %q", s.Description, want)
	}
	if !strings.HasPrefix(s.Body, "# Formalize") {
		t.Errorf("Body should start with the heading, got %q", s.Body)
	}
	if s.Raw != sampleSkill {
		t.Errorf("Raw must be byte-for-byte the input")
	}
}

func TestParseSkill_NoFrontmatter(t *testing.T) {
	raw := "# Just a body\n\nno frontmatter here\n"
	s := parseSkill("loose", raw, "/x/SKILL.md")
	if s.Description != "" {
		t.Errorf("Description = %q, want empty", s.Description)
	}
	if s.Body != raw {
		t.Errorf("Body = %q, want whole file", s.Body)
	}
}

func TestParseSpec(t *testing.T) {
	detected := []string{"cursor", "claude"}
	cases := []struct {
		spec string
		want []string
		err  bool
	}{
		{"", nil, false},
		{"none", nil, false},
		{"all", []string{"claude", "cursor", "codex", "copilot", "gemini"}, false},
		{"detect", []string{"claude", "cursor"}, false}, // re-ordered to registry order
		{"cursor,claude", []string{"claude", "cursor"}, false},
		{"gemini gemini", []string{"gemini"}, false}, // dedup
		{"nope", nil, true},
	}
	for _, c := range cases {
		got, err := ParseSpec(c.spec, detected)
		if c.err {
			if err == nil {
				t.Errorf("ParseSpec(%q): expected error", c.spec)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseSpec(%q): unexpected error %v", c.spec, err)
			continue
		}
		if strings.Join(got, ",") != strings.Join(c.want, ",") {
			t.Errorf("ParseSpec(%q) = %v, want %v", c.spec, got, c.want)
		}
	}
}

// writeCanonical seeds a workspace with a canonical skill and an AGENTS.md.
func writeCanonical(t *testing.T) string {
	t.Helper()
	ws := t.TempDir()
	dir := filepath.Join(ws, filepath.FromSlash(CanonicalDir), "formalize")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(sampleSkill), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ws, "AGENTS.md"), []byte("# Baseline\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return ws
}

func TestLoadCanonical(t *testing.T) {
	ws := writeCanonical(t)
	skills, err := LoadCanonical(ws)
	if err != nil {
		t.Fatalf("LoadCanonical: %v", err)
	}
	if len(skills) != 1 || skills[0].Name != "formalize" {
		t.Fatalf("skills = %+v, want one named formalize", skills)
	}
}

func TestLoadCanonical_Missing(t *testing.T) {
	_, err := LoadCanonical(t.TempDir())
	if err == nil {
		t.Fatal("expected ErrNoCanonical")
	}
	if !strings.Contains(err.Error(), "no canonical skills") {
		t.Errorf("err = %v, want ErrNoCanonical", err)
	}
}

func TestEmit_Claude(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	res, err := Emit(ws, []string{"claude"}, skills)
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Native SKILL.md is byte-for-byte the canonical file.
	got := readFile(t, ws, ".claude/skills/formalize/SKILL.md")
	if got != sampleSkill {
		t.Errorf("claude SKILL.md not verbatim:\n%s", got)
	}
	// CLAUDE.md mirrors AGENTS.md (symlink or copy).
	if _, err := os.Stat(filepath.Join(ws, "CLAUDE.md")); err != nil {
		t.Errorf("CLAUDE.md missing: %v", err)
	}
	if len(res["claude"].Warnings) != 0 {
		t.Errorf("claude is lossless; want no warnings, got %v", res["claude"].Warnings)
	}
}

func TestEmit_Cursor(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	res, err := Emit(ws, []string{"cursor"}, skills)
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Cursor uses the native Agent Skills standard, so the canonical SKILL.md is
	// emitted verbatim at .cursor/skills/<name>/SKILL.md (same as claude/codex).
	got := readFile(t, ws, ".cursor/skills/formalize/SKILL.md")
	if got != sampleSkill {
		t.Errorf("cursor SKILL.md not verbatim:\n%s", got)
	}
	if len(res["cursor"].Warnings) != 0 {
		t.Errorf("cursor is now lossless; want no warnings, got %v", res["cursor"].Warnings)
	}
}

func TestEmit_Codex(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"codex"}, skills); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	got := readFile(t, ws, ".agents/skills/formalize/SKILL.md")
	if got != sampleSkill {
		t.Errorf("codex SKILL.md not verbatim:\n%s", got)
	}
}

func TestEmit_Copilot(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	res, err := Emit(ws, []string{"copilot"}, skills)
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// Repo-wide always-on instructions stay (from AGENTS.md).
	base := readFile(t, ws, ".github/copilot-instructions.md")
	if !strings.Contains(base, "# Baseline") {
		t.Errorf("copilot-instructions.md should carry AGENTS.md content:\n%s", base)
	}
	// Per-skill capabilities are now native Agent Skills at .github/skills/<name>/
	// SKILL.md, emitted verbatim — Copilot adopted the standard, so it is lossless.
	got := readFile(t, ws, ".github/skills/formalize/SKILL.md")
	if got != sampleSkill {
		t.Errorf("copilot SKILL.md not verbatim:\n%s", got)
	}
	if len(res["copilot"].Warnings) != 0 {
		t.Errorf("copilot is now lossless; want no warnings, got %v", res["copilot"].Warnings)
	}
}

func TestEmit_Gemini(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	res, err := Emit(ws, []string{"gemini"}, skills)
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	got := readFile(t, ws, "GEMINI.md")
	for _, want := range []string{"@AGENTS.md", "## Skills", "### formalize", "_Use when:_"} {
		if !strings.Contains(got, want) {
			t.Errorf("GEMINI.md missing %q:\n%s", want, got)
		}
	}
	// The leading "# Formalize" h1 should be stripped to avoid nesting under ###.
	if strings.Contains(got, "\n# Formalize") {
		t.Errorf("GEMINI.md should strip the skill's leading h1:\n%s", got)
	}
	if len(res["gemini"].Warnings) == 0 {
		t.Errorf("gemini is lossy; want a warning")
	}
}

func TestEmit_Idempotent(t *testing.T) {
	ws := writeCanonical(t)
	skills, _ := LoadCanonical(ws)
	if _, err := Emit(ws, []string{"claude", "cursor"}, skills); err != nil {
		t.Fatalf("first emit: %v", err)
	}
	if _, err := Emit(ws, []string{"claude", "cursor"}, skills); err != nil {
		t.Fatalf("second emit (idempotency): %v", err)
	}
	got := readFile(t, ws, ".claude/skills/formalize/SKILL.md")
	if got != sampleSkill {
		t.Errorf("re-emit changed content")
	}
}

func readFile(t *testing.T, ws, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(ws, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(data)
}
