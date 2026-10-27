package cmd

import (
	"context"
	"fmt"
	"os"
	"runtime"

	"github.com/spf13/cobra"
	"golang.org/x/mod/semver"
	"golang.org/x/term"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
)

const resumeWorkspaceUpgradeFlag = "resume-workspace-upgrade"

var upgradeYes bool
var upgradeAllowDirty bool
var resumeWorkspaceUpgrade bool

var upgradeCmd = &cobra.Command{
	Use:   "upgrade",
	Short: "Upgrade axm and the Workspace's lean-client tag",
	Long: `Reads the GitHub Version Feed and replaces axm from Release assets.
Inside an Axiom Workspace, the replacement binary then updates the
Workspace to its compiled-in lean-client tag and refreshes every
configured agent's skill copies. Every run then installs the Published
Corpus and the Axiom Site Archive under ~/.axiom if they are missing or
outdated, and removes the hosted sign-in token while keeping your
username. Rerunning is always safe.

Use --yes / -y to accept build-config (lakefile.lean / lean-toolchain
/ lake-manifest.json) replacements non-interactively. Without --yes,
a non-interactive invocation rejects the prompt.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := cmd.Context()
		if resumeWorkspaceUpgrade {
			if err := runWorkspacePhase(ctx, cmd, ""); err != nil {
				return err
			}
			feed, feedErr := upgrade.ReadVersionFeed(ctx, nil, releaseRepo)
			return runUserLevelSteps(ctx, cmd, "axm upgrade", feed, feedErr)
		}
		feed, feedErr := upgrade.ReadVersionFeed(ctx, nil, releaseRepo)
		if feedErr != nil {
			return runUserLevelSteps(ctx, cmd, "axm upgrade", nil, feedErr)
		}
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("axm upgrade: %w", err)
		}
		idx, wsErr := axmindex.Open(cwd)
		if wsErr != nil {
			res, err := runBinaryPhase(ctx, cmd, feed.CLI.Current, true)
			if err != nil {
				return err
			}
			printBinaryResult(cmd, res)
			return runUserLevelSteps(ctx, cmd, "axm upgrade", feed, nil)
		}
		if needsBinaryUpgrade(version, feed.CLI.Current) {
			_, err := runBinaryPhase(ctx, cmd, feed.CLI.Current, false)
			return err
		}
		if err := runWorkspacePhase(ctx, cmd, idx.Root()); err != nil {
			return err
		}
		return runUserLevelSteps(ctx, cmd, "axm upgrade", feed, nil)
	},
}

func needsBinaryUpgrade(running, current string) bool {
	if running == "dev" || running == "" || current == "" {
		return false
	}
	r, c := "v"+running, "v"+current
	return semver.IsValid(r) && semver.IsValid(c) && semver.Compare(r, c) < 0
}

func runBinaryPhase(ctx context.Context, cmd *cobra.Command, currentVersion string, skipReExec bool) (*upgrade.Result, error) {
	return upgrade.RunBinaryUpgrade(ctx, upgrade.Options{
		RunningVersion: version,
		TargetVersion:  currentVersion,
		ReleaseRepo:    releaseRepo,
		GOOS:           runtime.GOOS,
		GOARCH:         runtime.GOARCH,
		Stdout:         cmd.OutOrStdout(),
		Stderr:         cmd.ErrOrStderr(),
		SkipReExec:     skipReExec,
	})
}

func runWorkspacePhase(ctx context.Context, cmd *cobra.Command, repoDir string) error {
	if repoDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("axm upgrade: %w", err)
		}
		idx, err := axmindex.Open(cwd)
		if err != nil {
			return fmt.Errorf("axm upgrade: cannot resume workspace upgrade: %w", err)
		}
		repoDir = idx.Root()
	}
	if _, err := upgrade.RunWorkspaceUpgrade(ctx, upgrade.WorkspaceOptions{
		RepoDir:    repoDir,
		NewTag:     leanClientTag,
		Yes:        upgradeYes,
		AllowDirty: upgradeAllowDirty,
		NonTTY:     !term.IsTerminal(int(os.Stdin.Fd())),
		Stdin:      cmd.InOrStdin(),
		Stdout:     cmd.OutOrStdout(),
		Stderr:     cmd.ErrOrStderr(),
	}); err != nil {
		return err
	}
	if err := syncConfiguredAgents(cmd.ErrOrStderr(), repoDir); err != nil {
		return fmt.Errorf("axm upgrade: refreshing agent skill copies: %w", err)
	}
	return nil
}

func printBinaryResult(cmd *cobra.Command, res *upgrade.Result) {
	out := cmd.OutOrStdout()
	if res.AlreadyCurrent {
		fmt.Fprintln(out, "axm is already up to date.")
		return
	}
	fmt.Fprintf(out, "axm upgraded from %s to %s.\n", res.OldVersion, res.NewVersion)
}

func init() {
	upgradeCmd.Flags().BoolVarP(&upgradeYes, "yes", "y", false,
		"accept build-config (lakefile/lean-toolchain/lake-manifest) replacements without prompting")
	upgradeCmd.Flags().BoolVar(&upgradeAllowDirty, "allow-dirty", false,
		"proceed even if the Workspace has uncommitted changes (may overwrite unstaged edits)")
	upgradeCmd.Flags().BoolVar(&resumeWorkspaceUpgrade, resumeWorkspaceUpgradeFlag, false,
		"internal: continue the workspace phase after a binary self-replace")
	_ = upgradeCmd.Flags().MarkHidden(resumeWorkspaceUpgradeFlag)
	rootCmd.AddCommand(upgradeCmd)
}
