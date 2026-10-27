package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/agentskills"
)

// seedWorkspace writes a canonical skill + AGENTS.md so the cmd-layer
// materialize/unmaterialize orchestrators have something to act on.
func seedWorkspace(t *testing.T) string {
	t.Helper()
	ws := t.TempDir()
	dir := filepath.Join(ws, ".axiom", "skills", "formalize")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	skill := "---\nname: formalize\ndescription: Use when formalizing.\n---\n\n# Formalize\n\nBody.\n"
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(skill), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ws, "AGENTS.md"), []byte("# Baseline\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return ws
}

func TestParseSelectionInput(t *testing.T) {
	agents := agentskills.All()
	def := []string{"claude"}
	cases := []struct {
		in   string
		want string // comma-joined ids
		err  bool
	}{
		{"", "claude", false},
		{"all", "claude,cursor,codex,copilot,gemini", false},
		{"none", "", false},
		{"1,3", "claude,codex", false},             // by index
		{"cursor, gemini", "cursor,gemini", false}, // by id, normalized order
		{"3 1", "claude,codex", false},             // space separated, reordered
		{"cursor,cursor", "cursor", false},         // dedup
		{"9", "", true},                            // out of range
		{"bogus", "", true},                        // unknown id
	}
	for _, c := range cases {
		got, err := parseSelectionInput(c.in, agents, def)
		if c.err {
			if err == nil {
				t.Errorf("parseSelectionInput(%q): want error", c.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseSelectionInput(%q): %v", c.in, err)
			continue
		}
		if strings.Join(got, ",") != c.want {
			t.Errorf("parseSelectionInput(%q) = %v, want %q", c.in, got, c.want)
		}
	}
}

func TestResolveAgentSelection_FlagWins(t *testing.T) {
	// Non-TTY reader + explicit flag → flag is parsed, no prompt.
	in := strings.NewReader("")
	var out bytes.Buffer
	got, err := resolveAgentSelection(in, &out, "cursor,codex")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if strings.Join(got, ",") != "cursor,codex" {
		t.Errorf("got %v, want cursor,codex", got)
	}
	if out.Len() != 0 {
		t.Errorf("flag path must not prompt; stdout = %q", out.String())
	}
}

func TestResolveAgentSelection_HeadlessDefault(t *testing.T) {
	// Non-TTY reader, no flag, AXIOM_AGENTS unset → headless default.
	t.Setenv(agentsEnv, "")
	in := strings.NewReader("")
	var out bytes.Buffer
	got, err := resolveAgentSelection(in, &out, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	// Detection may add agents in some environments; the contract is only that
	// the result is non-empty and a subset of the supported set.
	if len(got) == 0 {
		t.Fatal("headless default must select at least one agent")
	}
	for _, id := range got {
		if _, ok := agentskills.ByID(id); !ok {
			t.Errorf("resolved unknown agent %q", id)
		}
	}
}

func TestResolveAgentSelection_EnvSpec(t *testing.T) {
	t.Setenv(agentsEnv, "gemini")
	in := strings.NewReader("")
	var out bytes.Buffer
	got, err := resolveAgentSelection(in, &out, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if strings.Join(got, ",") != "gemini" {
		t.Errorf("env spec ignored: got %v", got)
	}
}

func TestMaterializeThenUnmaterialize(t *testing.T) {
	ws := seedWorkspace(t)
	var out, errW bytes.Buffer

	if err := materializeAgents(&out, &errW, ws, []string{"cursor", "gemini"}, false); err != nil {
		t.Fatalf("materialize: %v", err)
	}
	if _, err := os.Stat(filepath.Join(ws, ".cursor", "skills", "formalize", "SKILL.md")); err != nil {
		t.Fatalf("cursor rule should exist after materialize: %v", err)
	}

	out.Reset()
	errW.Reset()
	if err := unmaterializeAgents(&out, &errW, ws, []string{"cursor", "gemini"}, false); err != nil {
		t.Fatalf("unmaterialize: %v", err)
	}
	if _, err := os.Stat(filepath.Join(ws, ".cursor")); !os.IsNotExist(err) {
		t.Errorf(".cursor should be pruned after unmaterialize, stat err = %v", err)
	}
	if _, err := os.Stat(filepath.Join(ws, "GEMINI.md")); !os.IsNotExist(err) {
		t.Errorf("GEMINI.md should be removed after unmaterialize, stat err = %v", err)
	}
	if !strings.Contains(out.String(), "removed") {
		t.Errorf("expected a removal summary, got %q", out.String())
	}
}

func TestUnmaterialize_NoCanonical(t *testing.T) {
	ws := seedWorkspace(t)
	var out, errW bytes.Buffer
	// Materialize agents that have both per-skill files and an AGENTS.md-derived
	// single file, then delete the canonical source out from under them.
	if err := materializeAgents(&out, &errW, ws, []string{"claude", "gemini"}, false); err != nil {
		t.Fatalf("materialize: %v", err)
	}
	if err := os.RemoveAll(filepath.Join(ws, ".axiom")); err != nil {
		t.Fatal(err)
	}

	out.Reset()
	errW.Reset()
	if err := unmaterializeAgents(&out, &errW, ws, []string{"claude", "gemini"}, false); err != nil {
		t.Fatalf("unmaterialize without canonical: %v", err)
	}
	// AGENTS.md-derived single files are still cleaned up...
	if _, err := os.Lstat(filepath.Join(ws, "CLAUDE.md")); !os.IsNotExist(err) {
		t.Errorf("CLAUDE.md should still be removed without canonical, stat err = %v", err)
	}
	if _, err := os.Stat(filepath.Join(ws, "GEMINI.md")); !os.IsNotExist(err) {
		t.Errorf("GEMINI.md should still be removed without canonical, stat err = %v", err)
	}
	// ...but per-skill files can't be enumerated, so they're left in place.
	if _, err := os.Stat(filepath.Join(ws, ".claude", "skills", "formalize", "SKILL.md")); err != nil {
		t.Errorf("per-skill file should be left when canonical is gone, stat err = %v", err)
	}
	if !strings.Contains(errW.String(), "No canonical skills") {
		t.Errorf("expected a no-canonical warning, got %q", errW.String())
	}
}

func TestAgentsRemoveCmd_Errors(t *testing.T) {
	// RunE resolves the workspace from cwd; point it at an empty temp dir.
	t.Chdir(t.TempDir())
	agentsRemoveFlag = ""
	t.Cleanup(func() { agentsRemoveFlag = "" })

	cases := []struct {
		name string
		args []string
		want string
	}{
		{"no args (mass-delete guard)", nil, "name at least one agent"},
		{"explicit none", []string{"none"}, "no agents given"},
		{"unknown id", []string{"bogus"}, "unknown agent"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := agentsRemoveCmd.RunE(agentsRemoveCmd, c.args)
			if err == nil {
				t.Fatalf("expected an error for args %v", c.args)
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("error = %q, want substring %q", err.Error(), c.want)
			}
		})
	}
}

func TestSyncAndCheck(t *testing.T) {
	ws := seedWorkspace(t)
	var out, errW bytes.Buffer
	if err := materializeAgents(&out, &errW, ws, []string{"cursor"}, false); err != nil {
		t.Fatalf("materialize: %v", err)
	}
	// Freshly materialized → check passes (no drift).
	if err := checkAgents(&out, &errW, ws, []string{"cursor"}); err != nil {
		t.Errorf("fresh check should pass: %v", err)
	}
	// Edit the canonical source → check must now fail (non-zero exit).
	sp := filepath.Join(ws, ".axiom", "skills", "formalize", "SKILL.md")
	data, _ := os.ReadFile(sp)
	if err := os.WriteFile(sp, append(data, []byte("\nnew line\n")...), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := checkAgents(&out, &errW, ws, []string{"cursor"}); err == nil {
		t.Error("check should fail when the source was edited but not synced")
	}
	// sync resolves the drift; check passes again.
	if err := syncAgents(&out, &errW, ws, []string{"cursor"}, false, false); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if err := checkAgents(&out, &errW, ws, []string{"cursor"}); err != nil {
		t.Errorf("check should pass after sync: %v", err)
	}
}

// Generated artifacts are meant to be committed, so materialize must not create
// or modify a .gitignore (the old managed-block behavior was removed).
func TestMaterializeDoesNotTouchGitignore(t *testing.T) {
	ws := seedWorkspace(t)
	var out, errW bytes.Buffer
	if err := materializeAgents(&out, &errW, ws, []string{"cursor"}, false); err != nil {
		t.Fatalf("materialize: %v", err)
	}
	if _, err := os.Stat(filepath.Join(ws, ".gitignore")); !os.IsNotExist(err) {
		t.Errorf("materialize should not create a .gitignore; stat err = %v", err)
	}
}

func TestConfiguredList(t *testing.T) {
	ws := seedWorkspace(t)
	if got := configuredList(ws); got != "none" {
		t.Errorf("fresh workspace: configuredList = %q, want none", got)
	}
	var out, errW bytes.Buffer
	if err := materializeAgents(&out, &errW, ws, []string{"cursor"}, false); err != nil {
		t.Fatalf("materialize: %v", err)
	}
	if got := configuredList(ws); got != "cursor" {
		t.Errorf("after adding cursor: configuredList = %q, want cursor", got)
	}
}
