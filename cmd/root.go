package cmd

import (
	"os"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
	"github.com/spf13/cobra"
)

// init stamps the ldflag-injected version on the release-download User-Agent before any subcommand runs.
func init() {
	version = resolveVersion(version)
	rootCmd.Version = version
	upgrade.UserAgentVersion = version
}

// binaryName supplies command-name hints in user-facing messages.
var binaryName = "axm"

var rootCmd = &cobra.Command{
	Use:     "axm",
	Short:   "Axiom CLI",
	Long:    "axm is the command-line interface for working with Axiom.",
	Version: version,
	// PersistentPreRunE runs the one-shot state-file rename
	// (`.axiomdata/index/uploaded.json` -> `.../published.json`) before
	// any subcommand opens the index. PR #488 renamed the file as part
	// of the upload->publish vocabulary cleanup; without this hook a
	// CLI built after the rename would silently create an empty
	// published.json next to a stale uploaded.json and lose every prior
	// entry. Migration is idempotent (no-op once published.json
	// exists), self-healing (fresh workspaces never had the old file),
	// and fail-loud (any read / rename / JSON error aborts the
	// invocation with a non-zero exit so the user sees the failure
	// rather than working against un-migrated state).
	//
	// The hook calls MigrateWorkspaceRoot(".") which walks upward from
	// the CLI's working directory looking for an .axiomdata/ ancestor
	// — the same walk axmindex.Open uses. When no workspace ancestor
	// exists, the migration is a no-op. Commands listed in
	// migrationExemptCommands skip the hook so a corrupt-state migration
	// error cannot block them.
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		if migrationExemptCommands[cmd.Name()] {
			return nil
		}
		if materializationCommands[cmd.Name()] {
			idx, err := axmindex.Open(".")
			if err != nil {
				return err
			}
			permit, err := preflightMaterialization(cmd.Context(), idx)
			if err != nil {
				return err
			}
			cmd.SetContext(contextWithMaterializationPermit(cmd.Context(), permit))
		}
		if cmd.Name() == "pull" && pullCheck {
			return nil
		}
		return axmindex.MigrateWorkspaceRoot(".")
	},
}

var materializationCommands = map[string]bool{
	"pull":  true,
	"fetch": true,
	"fork":  true,
}

// migrationExemptCommands lists subcommands that must NOT have the
// state-file migration as a precondition: informational commands and the
// retired hosted commands, which touch no workspace state.
var migrationExemptCommands = map[string]bool{
	"version": true,
	"help":    true,
	"auth":    true,
	"whoami":  true,
	"publish": true,
}

func Execute() {
	// Cobra already prints the error when one is returned from a RunE; we
	// just need a non-zero exit so shells pick up the failure.
	if err := rootCmd.Execute(); err != nil {
		if coded, ok := err.(interface{ ExitCode() int }); ok {
			os.Exit(coded.ExitCode())
		}
		os.Exit(1)
	}
}
