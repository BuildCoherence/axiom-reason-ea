package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

// retiredHostedCommands are the hosted-service commands kept only to fail loudly for old scripts and agents.
var retiredHostedCommands = []string{"publish", "auth", "whoami"}

// retirementError renders the single retirement line for a hosted command or flag.
func retirementError(what string) error {
	return fmt.Errorf("%s is retired: publishing has closed and the Axiom toolkit is local", what)
}

func newRetiredCommand(name string) *cobra.Command {
	return &cobra.Command{
		Use:    name,
		Hidden: true,
		// Old invocations carry flags this binary no longer defines; the retirement line must still win.
		DisableFlagParsing: true,
		SilenceUsage:       true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return retirementError(binaryName + " " + name)
		},
	}
}

func init() {
	for _, name := range retiredHostedCommands {
		rootCmd.AddCommand(newRetiredCommand(name))
	}
}
