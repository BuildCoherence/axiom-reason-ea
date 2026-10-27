package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/agentskills"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"golang.org/x/term"
)

// agentsEnv lets CI / headless callers pick the agent set without the
// interactive prompt (mirrors the AXIOM_* override convention used elsewhere
// in `axm init`). It is read only when the --agents flag is unset.
const agentsEnv = "AXIOM_AGENTS"

// resolveAgentSelection decides which agent ids to materialize for. Precedence:
//
//  1. explicit spec — the --agents flag, else $AXIOM_AGENTS — parsed by
//     agentskills.ParseSpec ("all" / "none" / "detect" / an id list).
//  2. interactive multiselect, when stdin is a TTY.
//  3. headless default: the detected agents, or {claude} if none are detected
//     (the historical single-agent behavior), so a non-interactive `axm init`
//     still yields a usable workspace.
func resolveAgentSelection(in io.Reader, out io.Writer, flagVal string) ([]string, error) {
	detected := agentskills.Detect()

	spec := flagVal
	if spec == "" {
		spec = os.Getenv(agentsEnv)
	}
	if spec != "" {
		return agentskills.ParseSpec(spec, detected)
	}

	if isTerminal(in) {
		return promptAgentSelection(in, out, detected)
	}

	if len(detected) > 0 {
		return detected, nil
	}
	return []string{"claude"}, nil
}

// isTerminal reports whether in is an interactive terminal. A non-*os.File
// reader (e.g. a test buffer or a pipe) is never interactive.
func isTerminal(in io.Reader) bool {
	f, ok := in.(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}

// promptAgentSelection renders a numbered checklist (detected agents
// pre-marked) and reads one line of input. It is a line-based selector rather
// than a raw-mode arrow-key TUI so it has no new dependency, works on every
// terminal, and degrades cleanly when piped.
func promptAgentSelection(in io.Reader, out io.Writer, detected []string) ([]string, error) {
	agents := agentskills.All()
	detSet := map[string]bool{}
	for _, id := range detected {
		detSet[id] = true
	}

	// The default applied on a bare Enter: the detected agents, or claude when
	// nothing is detected. Typing an explicit selection replaces it entirely.
	def := agentskills.Order(detected)
	if len(def) == 0 {
		def = []string{"claude"}
	}

	fmt.Fprintln(out, "\nSet up AI agent skills for this workspace.")
	fmt.Fprintln(out, "Select the agents you use (others can be added later with `axm agents add`):")
	fmt.Fprintln(out)
	// Items carry no selection glyph: a leading [x]/→ reads as "already chosen".
	// The only per-item annotation is a dimmed "(detected)" — a status word, not
	// a selection marker — noting the agent looks installed on this machine. The
	// default (what a bare Enter accepts) lives on the prompt line below.
	for i, a := range agents {
		line := fmt.Sprintf("  %d. %s", i+1, a.Name)
		if detSet[a.ID] {
			line += "  " + progress.Dim(out, "(detected)")
		}
		fmt.Fprintln(out, line)
	}
	fmt.Fprintln(out)

	fmt.Fprintf(out, "Enter numbers (comma-separated), 'all', 'none', or press Enter to accept the default %s: ",
		progress.Dim(out, "["+strings.Join(def, ", ")+"]"))

	line, err := bufio.NewReader(in).ReadString('\n')
	if err != nil && line == "" {
		return nil, fmt.Errorf("read agent selection: %w", err)
	}
	return parseSelectionInput(strings.TrimSpace(line), agents, def)
}

// parseSelectionInput turns one line of selector input into a normalized id
// list. Tokens may be 1-based menu indices or agent ids; "all"/"none"/"" map to
// every agent / no agents / the default. It is pure for straightforward tests.
func parseSelectionInput(line string, agents []agentskills.Agent, def []string) ([]string, error) {
	switch strings.ToLower(line) {
	case "":
		return agentskills.Order(def), nil
	case "all":
		return agentskills.IDs(), nil
	case "none":
		return nil, nil
	}
	var ids []string
	for _, tok := range strings.FieldsFunc(line, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' }) {
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		if n, err := strconv.Atoi(tok); err == nil {
			if n < 1 || n > len(agents) {
				return nil, fmt.Errorf("selection %d out of range (1-%d)", n, len(agents))
			}
			ids = append(ids, agents[n-1].ID)
			continue
		}
		if _, ok := agentskills.ByID(strings.ToLower(tok)); ok {
			ids = append(ids, strings.ToLower(tok))
			continue
		}
		return nil, fmt.Errorf("unknown selection %q (numbers 1-%d or: %s)",
			tok, len(agents), strings.Join(agentskills.IDs(), ", "))
	}
	return agentskills.Order(ids), nil
}

// materializeAgents loads the canonical skills and emits per-agent artifacts
// for the selected ids, printing one success line per agent plus any
// lossy-conversion warnings. A workspace with no canonical skills is a soft
// skip (warn, continue) so `axm init` over an older template never hard-fails
// on the new materialization step. With dryRun it previews what would be written
// without touching disk. Generated artifacts are left tracked: they are meant to
// be committed alongside the canonical source, so nothing touches .gitignore.
func materializeAgents(out, errW io.Writer, ws string, ids []string, dryRun bool) error {
	if len(ids) == 0 {
		progress.Successf(out, "No agents selected — canonical skills remain under %s", agentskills.CanonicalDir)
		return nil
	}
	skills, err := agentskills.LoadCanonical(ws)
	if errors.Is(err, agentskills.ErrNoCanonical) {
		progress.Warnf(errW, "No canonical skills under %s; skipping agent setup", agentskills.CanonicalDir)
		return nil
	}
	if err != nil {
		return err
	}
	if dryRun {
		return previewChanges(out, ws, ids, skills)
	}
	results, err := agentskills.Emit(ws, ids, skills)
	if err != nil {
		return err
	}
	for _, id := range ids {
		a, _ := agentskills.ByID(id)
		res := results[id]
		progress.Successf(out, "%s: %d file(s) written", a.Name, len(res.Files))
		for _, w := range res.Warnings {
			progress.Warnf(errW, "%s: %s", a.Name, w)
		}
	}
	return nil
}

// previewChanges prints, per agent, the artifacts a real add/sync would create,
// update, or prune — the shared dry-run renderer for add and sync.
func previewChanges(out io.Writer, ws string, ids []string, skills []agentskills.Skill) error {
	for _, id := range ids {
		a, _ := agentskills.ByID(id)
		changes, err := agentskills.PlanChanges(ws, id, skills)
		if err != nil {
			return err
		}
		if len(changes) == 0 {
			progress.Successf(out, "%s: up to date", a.Name)
			continue
		}
		progress.Successf(out, "%s: %d change(s) pending", a.Name, len(changes))
		for _, c := range changes {
			fmt.Fprintf(out, "    %-6s %s\n", c.Op, c.Rel)
		}
	}
	return nil
}

// unmaterializeAgents removes the per-agent artifacts for the selected ids,
// printing what was deleted and noting any file left in place because it no
// longer looked axm-generated. It is the reverse of materializeAgents and shares
// its conservative posture: a workspace whose canonical skills are gone is a
// soft skip for per-skill files (warn, continue), but AGENTS.md-derived single
// files (CLAUDE.md, GEMINI.md, copilot-instructions.md) are still cleaned up.
func unmaterializeAgents(out, errW io.Writer, ws string, ids []string, dryRun bool) error {
	if len(ids) == 0 {
		return nil
	}
	skills, err := agentskills.LoadCanonical(ws)
	switch {
	case errors.Is(err, agentskills.ErrNoCanonical):
		progress.Warnf(errW, "No canonical skills under %s; removing only AGENTS.md-derived files (per-skill files, if any, are left)", agentskills.CanonicalDir)
		skills = nil
	case err != nil:
		return err
	}
	results, err := agentskills.Remove(ws, ids, skills, dryRun)
	if err != nil {
		return err
	}
	verb, verbed := "remove", "removed"
	if dryRun {
		verb, verbed = "would remove", "would remove"
	}
	for _, id := range ids {
		a, _ := agentskills.ByID(id)
		res := results[id]
		switch {
		case len(res.Removed) == 0 && len(res.Kept) == 0:
			progress.Successf(out, "%s: nothing to %s", a.Name, verb)
		case len(res.Removed) == 0:
			progress.Successf(out, "%s: nothing to %s (%d file(s) left in place)", a.Name, verb, len(res.Kept))
		case len(res.Kept) > 0:
			progress.Successf(out, "%s: %s %d file(s), %d left in place", a.Name, verbed, len(res.Removed), len(res.Kept))
		default:
			progress.Successf(out, "%s: %s %d file(s)", a.Name, verbed, len(res.Removed))
		}
		for _, w := range res.Warnings {
			progress.Warnf(errW, "%s: %s", a.Name, w)
		}
	}
	return nil
}

// syncAgents regenerates the configured agents' artifacts from the canonical
// source and prunes orphans, printing what changed. With dryRun it previews
// without writing.
func syncAgents(out, errW io.Writer, ws string, ids []string, dryRun, prune bool) error {
	if len(ids) == 0 {
		progress.Successf(out, "No configured agents to sync")
		return nil
	}
	skills, err := agentskills.LoadCanonical(ws)
	if errors.Is(err, agentskills.ErrNoCanonical) {
		progress.Warnf(errW, "No canonical skills under %s; nothing to sync", agentskills.CanonicalDir)
		return nil
	}
	if err != nil {
		return err
	}
	results, err := agentskills.Sync(ws, ids, skills, dryRun, prune)
	if err != nil {
		return err
	}
	for _, id := range ids {
		a, _ := agentskills.ByID(id)
		r := results[id]
		n := len(r.Created) + len(r.Updated) + len(r.Pruned)
		if n == 0 {
			progress.Successf(out, "%s: up to date", a.Name)
		} else if dryRun {
			progress.Successf(out, "%s: %d change(s) pending (+%d new, ~%d updated, -%d pruned)",
				a.Name, n, len(r.Created), len(r.Updated), len(r.Pruned))
		} else {
			progress.Successf(out, "%s: synced (+%d new, ~%d updated, -%d pruned)",
				a.Name, len(r.Created), len(r.Updated), len(r.Pruned))
		}
		for _, w := range r.Warnings {
			progress.Warnf(errW, "%s: %s", a.Name, w)
		}
	}
	return nil
}

// checkAgents reports whether any configured agent's generated files have
// drifted from the canonical source, returning an error (non-zero exit) when
// they have — the CI-friendly form of `axm agents sync`.
func checkAgents(out, errW io.Writer, ws string, ids []string) error {
	if len(ids) == 0 {
		progress.Successf(out, "No configured agents to check")
		return nil
	}
	skills, err := agentskills.LoadCanonical(ws)
	if errors.Is(err, agentskills.ErrNoCanonical) {
		progress.Warnf(errW, "No canonical skills under %s; nothing to check", agentskills.CanonicalDir)
		return nil
	}
	if err != nil {
		return err
	}
	var stale []string
	for _, id := range ids {
		a, _ := agentskills.ByID(id)
		changes, err := agentskills.PlanChanges(ws, id, skills)
		if err != nil {
			return err
		}
		if len(changes) == 0 {
			progress.Successf(out, "%s: up to date", a.Name)
			continue
		}
		stale = append(stale, a.ID)
		progress.Warnf(errW, "%s: %d change(s) pending — run `axm agents sync`", a.Name, len(changes))
		for _, c := range changes {
			fmt.Fprintf(out, "    %-6s %s\n", c.Op, c.Rel)
		}
	}
	if len(stale) > 0 {
		return fmt.Errorf("agents out of date: %s", strings.Join(stale, ", "))
	}
	return nil
}
