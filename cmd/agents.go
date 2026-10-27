package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/agentskills"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"github.com/spf13/cobra"
)

var agentsCmd = &cobra.Command{
	Use:   "agents",
	Short: "Set up AI agent skills for this workspace",
	Long: `Materialize the workspace's canonical skills (under ` + agentskills.CanonicalDir + `)
into the native format of the AI coding agents you use.

` + "`axm init`" + ` already prompts for this; use these subcommands to add, remove,
or re-sync an agent later, or to see what is configured. Skills are authored once in
` + agentskills.CanonicalDir + ` and emitted per agent — Claude Code, Codex,
Cursor, and GitHub Copilot get native SKILL.md files (Copilot also gets a
repo-wide copilot-instructions.md from AGENTS.md), and Gemini gets a flattened
GEMINI.md.`,
}

var agentsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List supported agents and whether they are detected / configured / stale",
	Long: `List every supported agent and three independent signals:

  DETECTED    the agent appears installed on THIS MACHINE (~/.<id>/ exists or
              its CLI is on PATH). Machine-level only — it does not mean this
              workspace uses the agent; it just pre-selects the ` + "`axm init`" + ` prompt.
  CONFIGURED  THIS WORKSPACE has generated skill files for the agent.
  STALE       the workspace's generated files differ from the canonical source
              (` + agentskills.CanonicalDir + `); run ` + "`axm agents sync`" + ` to refresh. "-" when not configured.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ws := "."
		detected := map[string]bool{}
		for _, id := range agentskills.Detect() {
			detected[id] = true
		}
		// Staleness needs the canonical source; if it is absent we simply omit the
		// signal (every configured agent shows "-") rather than failing the list.
		skills, _ := agentskills.LoadCanonical(ws)
		yesNo := func(b bool) string {
			if b {
				return "yes"
			}
			return "no"
		}
		out := cmd.OutOrStdout()
		fmt.Fprintf(out, "%-10s %-16s %-9s %-11s %s\n", "ID", "NAME", "DETECTED", "CONFIGURED", "STALE")
		for _, a := range agentskills.All() {
			configured := agentConfigured(ws, a.ID)
			stale := "-"
			if configured && skills != nil {
				if s, err := agentskills.Stale(ws, a.ID, skills); err == nil {
					stale = yesNo(s)
				}
			}
			fmt.Fprintf(out, "%-10s %-16s %-9s %-11s %s\n", a.ID, a.Name, yesNo(detected[a.ID]), yesNo(configured), stale)
		}
		// Legend: DETECTED is machine-level (a pre-selection hint), distinct from
		// CONFIGURED, which is this workspace's state. Dimmed so it reads as a
		// footnote and degrades to plain text when piped / NO_COLOR.
		fmt.Fprintln(out, progress.Dim(out,
			"\ndetected = installed on this machine (pre-selects `axm init`) · "+
				"configured = this workspace has its files · stale = files differ from "+agentskills.CanonicalDir))
		return nil
	},
}

var agentsSyncCmd = &cobra.Command{
	Use:   "sync [agent...]",
	Short: "Regenerate configured agents from the canonical source (and prune orphans)",
	Long: `Re-emit each agent's artifacts from ` + agentskills.CanonicalDir + ` so edits to a
SKILL.md or AGENTS.md propagate, and delete per-skill artifacts whose source
skill was renamed or removed. Full-overwrite idempotent: a second run with an
unchanged source is a no-op.

With no arguments, syncs every currently-configured agent. Name agents (or use
--agents) to sync a specific set.

Flags:
  --check          report drift and exit non-zero if anything is out of date
                   (does not write); useful in CI
  --prune          also delete orphaned artifacts whose source skill was
                   renamed or removed (opt-in: a non-canonical file in an
                   agent's directory may be your own)
  --dry-run        show what would change without writing

Examples:
  axm agents sync                 # refresh everything configured
  axm agents sync cursor          # refresh one agent
  axm agents sync --prune         # refresh and drop renamed/removed skills
  axm agents sync --check         # CI: fail if generated files are stale`,
	Args: cobra.ArbitraryArgs,
	// --check exits non-zero by design; a drift failure is not a usage error, so
	// don't bury the per-agent drift report under a usage dump.
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		absDir, err := filepath.Abs(".")
		if err != nil {
			return fmt.Errorf("axm agents sync: resolve workspace: %w", err)
		}
		ids, err := syncTargets(absDir, args, agentsSyncFlag)
		if err != nil {
			return fmt.Errorf("axm agents sync: %w", err)
		}
		out, errW := cmd.OutOrStdout(), cmd.ErrOrStderr()
		if agentsSyncCheck {
			return checkAgents(out, errW, absDir, ids)
		}
		return syncAgents(out, errW, absDir, ids, agentsSyncDryRun, agentsSyncPrune)
	},
}

// syncTargets resolves which agents `sync`/`check` should act on: an explicit
// spec (args or --agents) when given, otherwise every currently-configured
// agent (the "refresh what I have" default).
func syncTargets(ws string, args []string, flag string) ([]string, error) {
	spec := strings.Join(args, ",")
	if spec == "" {
		spec = flag
	}
	if spec != "" {
		return agentskills.ParseSpec(spec, agentskills.Detect())
	}
	var ids []string
	for _, a := range agentskills.All() {
		if agentConfigured(ws, a.ID) {
			ids = append(ids, a.ID)
		}
	}
	return ids, nil
}

var agentsAddCmd = &cobra.Command{
	Use:   "add [agent...]",
	Short: "Add (or refresh) skills for one or more agents",
	Long: `Emit per-agent skill files from the canonical source for the named agents.
With no arguments, prompts interactively (or uses --agents / AXIOM_AGENTS).
Re-running is safe: existing artifacts are overwritten in place.

Examples:
  axm agents add cursor
  axm agents add claude cursor gemini
  axm agents add --agents all`,
	Args: cobra.ArbitraryArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		absDir, err := filepath.Abs(".")
		if err != nil {
			return fmt.Errorf("axm agents add: resolve workspace: %w", err)
		}
		errW := cmd.ErrOrStderr()

		var ids []string
		switch {
		case len(args) > 0:
			if ids, err = agentskills.ParseSpec(strings.Join(args, ","), agentskills.Detect()); err != nil {
				return fmt.Errorf("axm agents add: %w", err)
			}
		default:
			if ids, err = resolveAgentSelection(cmd.InOrStdin(), cmd.OutOrStdout(), agentsAddFlag); err != nil {
				return fmt.Errorf("axm agents add: select agents: %w", err)
			}
		}
		if len(ids) == 0 {
			return fmt.Errorf("axm agents add: no agents given (supported: %s)", strings.Join(agentskills.IDs(), ", "))
		}
		return materializeAgents(cmd.OutOrStdout(), errW, absDir, ids, agentsAddDryRun)
	},
}

var agentsRemoveCmd = &cobra.Command{
	Use:   "remove [agent...]",
	Short: "Remove the generated skill files for one or more agents",
	Long: `Delete the artifacts ` + "`axm agents add`" + ` generated for the named agents.

Only axm-generated files are removed: the per-skill skill/rule/instruction
files, and the AGENTS.md-derived files (CLAUDE.md, GEMINI.md,
copilot-instructions.md) — but the latter only while they are still unmodified.
A CLAUDE.md/GEMINI.md you have edited or hand-authored is left in place and
reported. The canonical source under ` + agentskills.CanonicalDir + ` is never touched, so a
removed agent can always be re-added with ` + "`axm agents add`" + `.

Name the agents explicitly (or use --agents / 'all'); removal never prompts, so
it can't mass-delete by accident.

Examples:
  axm agents remove cursor
  axm agents remove claude cursor gemini
  axm agents remove --agents all`,
	Args: cobra.ArbitraryArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		absDir, err := filepath.Abs(".")
		if err != nil {
			return fmt.Errorf("axm agents remove: resolve workspace: %w", err)
		}

		spec := strings.Join(args, ",")
		if spec == "" {
			spec = agentsRemoveFlag
		}
		if spec == "" {
			return fmt.Errorf("axm agents remove: name at least one agent (configured: %s; or --agents all)",
				configuredList(absDir))
		}
		ids, err := agentskills.ParseSpec(spec, agentskills.Detect())
		if err != nil {
			return fmt.Errorf("axm agents remove: %w", err)
		}
		if len(ids) == 0 {
			return fmt.Errorf("axm agents remove: no agents given (supported: %s)", strings.Join(agentskills.IDs(), ", "))
		}
		return unmaterializeAgents(cmd.OutOrStdout(), cmd.ErrOrStderr(), absDir, ids, agentsRemoveDryRun)
	},
}

var (
	agentsAddFlag      string
	agentsAddDryRun    bool
	agentsRemoveFlag   string
	agentsRemoveDryRun bool
	agentsSyncFlag     string
	agentsSyncDryRun   bool
	agentsSyncCheck    bool
	agentsSyncPrune    bool
)

// configuredList returns a comma-separated list of agents that currently have
// artifacts on disk in ws, or "none". It powers the hint in the `agents remove`
// no-args error so the user can see what is actually removable.
func configuredList(ws string) string {
	var ids []string
	for _, a := range agentskills.All() {
		if agentConfigured(ws, a.ID) {
			ids = append(ids, a.ID)
		}
	}
	if len(ids) == 0 {
		return "none"
	}
	return strings.Join(ids, ", ")
}

// agentConfigured reports whether any artifact for the agent already exists in
// the workspace — a cheap presence check for `agents list`.
func agentConfigured(ws, id string) bool {
	var probe string
	switch id {
	case "claude":
		probe = ".claude/skills"
	case "cursor":
		probe = ".cursor/skills"
	case "codex":
		probe = ".agents/skills"
	case "copilot":
		probe = ".github/skills"
	case "gemini":
		probe = "GEMINI.md"
	default:
		return false
	}
	_, err := os.Stat(filepath.Join(ws, filepath.FromSlash(probe)))
	return err == nil
}

func init() {
	agentsAddCmd.Flags().StringVar(&agentsAddFlag, "agents", "",
		"agents to set up when no positional args are given (same syntax as `axm init --agents`)")
	agentsAddCmd.Flags().BoolVar(&agentsAddDryRun, "dry-run", false, "show what would be written without writing")
	agentsRemoveCmd.Flags().StringVar(&agentsRemoveFlag, "agents", "",
		"agents to remove when no positional args are given (same syntax as `axm init --agents`)")
	agentsRemoveCmd.Flags().BoolVar(&agentsRemoveDryRun, "dry-run", false, "show what would be removed without deleting")
	agentsSyncCmd.Flags().StringVar(&agentsSyncFlag, "agents", "",
		"agents to sync when no positional args are given (default: every configured agent)")
	agentsSyncCmd.Flags().BoolVar(&agentsSyncDryRun, "dry-run", false, "show what would change without writing")
	agentsSyncCmd.Flags().BoolVar(&agentsSyncCheck, "check", false, "report drift and exit non-zero if out of date (no writes)")
	agentsSyncCmd.Flags().BoolVar(&agentsSyncPrune, "prune", false, "also delete orphaned artifacts whose source skill was renamed/removed")
	agentsCmd.AddCommand(agentsListCmd)
	agentsCmd.AddCommand(agentsAddCmd)
	agentsCmd.AddCommand(agentsRemoveCmd)
	agentsCmd.AddCommand(agentsSyncCmd)
	rootCmd.AddCommand(agentsCmd)
}
