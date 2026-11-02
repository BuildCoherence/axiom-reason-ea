package cmd

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/transform"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/userconfig"
	"github.com/spf13/cobra"
)

var pullForce bool
var pullCheck bool

type pullCheckError struct{}

func (pullCheckError) Error() string { return "Axioms.lean is out of sync" }
func (pullCheckError) ExitCode() int { return 3 }

var pullCmd = &cobra.Command{
	Use:   "pull [username]",
	Short: "Sync Axioms.lean with a published Axiom Snapshot from the corpus",
	Long: "Replaces Axioms.lean with <username>'s published Axiom Snapshot from the installed\n" +
		"Published Corpus. Without <username>, uses the username saved in ~/.axiom/config.json.",
	SilenceUsage: true,
	Args:         cobra.MaximumNArgs(1),
	RunE:         runPull,
}

func init() {
	pullCmd.Flags().BoolVar(&pullForce, "force", false,
		"replace a modified Axioms.lean after saving it as Axioms.lean.orig")
	pullCmd.Flags().BoolVar(&pullCheck, "check", false,
		"check remote sync without writing; exit 3 when out of sync")
	rootCmd.AddCommand(pullCmd)
}

func runPull(cmd *cobra.Command, args []string) error {
	ctx := cmd.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	username, err := pullUsername(args)
	if err != nil {
		return err
	}
	idx, err := axmindex.Open(".")
	if err != nil {
		return err
	}
	pc, err := corpus.OpenInstalled()
	if err != nil {
		return err
	}
	head, ok, err := pc.Head(username)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("no published Axiom for %s in the corpus (frozen %s)", username, pc.FrozenDate())
	}
	if pullCheck {
		inSync, err := localAxiomsInSync(idx, head.SnapshotFileID)
		if err != nil {
			return err
		}
		if !inSync {
			fmt.Fprintf(cmd.OutOrStdout(), "Axioms.lean is out of sync with snapshot %s.\n", head.SnapshotFileID)
			return pullCheckError{}
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Axioms.lean is in sync with snapshot %s.\n", head.SnapshotFileID)
		return nil
	}

	permit, err := preflightMaterialization(ctx, idx)
	if err != nil {
		return err
	}
	if err := probeLake(cmd, idx.Root()); err != nil {
		return err
	}
	lock, err := acquireWorkspaceLock(idx)
	if err != nil {
		return err
	}
	defer func() { _ = lock.Unlock() }()

	target := filepath.Join(idx.Root(), axiomsLeanPath)
	current, readErr := os.ReadFile(target)
	localExists := readErr == nil
	if readErr != nil && !errors.Is(readErr, fs.ErrNotExist) {
		return fmt.Errorf("reading %s: %w", axiomsLeanPath, readErr)
	}
	backup := target + ".orig"
	if pullForce && localExists {
		if _, err := os.Stat(backup); err == nil {
			return fmt.Errorf("%s already exists — move or delete it first", axiomsLeanPath+".orig")
		} else if !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("checking %s: %w", axiomsLeanPath+".orig", err)
		}
	}

	prog := newSpinnerProgress(cmd.ErrOrStderr())
	content, result, err := ensureClosureCached(idx, pc, head.SnapshotFileID, false, permit, prog, cmd.ErrOrStderr())
	prog.stop()
	if err != nil {
		return err
	}
	published, err := idx.Published()
	if err != nil {
		return err
	}
	req := transform.Request{Mode: "reverse", Files: []transform.File{{
		Path:             axiomsLeanPath,
		Source:           string(content),
		FileID:           head.SnapshotFileID,
		ReverseImportMap: reverseWorkspaceImportMap(published),
	}}}
	xfSpin := progress.New(cmd.ErrOrStderr())
	xfSpin.Start("Converting to workspace form")
	if err := buildForTransform(cmd, idx.Root(), xfSpin.LakeWriter()); err != nil {
		xfSpin.Stop()
		return err
	}
	responses, err := transform.Invoke(ctx, idx.Root(), req, xfSpin.LakeWriter())
	xfSpin.Stop()
	if err != nil {
		return err
	}
	if hadErr := printTransformErrors(cmd.ErrOrStderr(), responses); hadErr || len(responses) != 1 {
		return errors.New("pull aborted: reverse transform failed")
	}
	header := fmt.Sprintf("-- axm: synced with snapshot %s at %s. Run 'axm pull %s' before editing.\n",
		head.SnapshotFileID, head.PublishedAt.UTC().Format(time.RFC3339), strings.ToLower(username))
	next := []byte(header + responses[0].Content)

	modified := localExists && !localMatchesSync(published, current) && !matchesTemplate(ctx, idx.Root(), current)
	if modified && !pullForce {
		fmt.Fprint(cmd.ErrOrStderr(), renderAxiomsDiff(current, next))
		return errors.New("Axioms.lean has local changes; re-run with --force to save it as Axioms.lean.orig and replace it")
	}
	if modified {
		if err := axmindex.WriteFileAtomic(backup, current); err != nil {
			return fmt.Errorf("saving %s: %w", axiomsLeanPath+".orig", err)
		}
	}
	if err := axmindex.WriteFileAtomic(target, next); err != nil {
		return fmt.Errorf("writing %s: %w", axiomsLeanPath, err)
	}
	if err := idx.SetPublished(axiomsLeanPath, axmindex.Published{
		FileID: head.SnapshotFileID, ContentHash: axmindex.NormalizedHash(next), PublishedAt: head.PublishedAt,
	}); err != nil {
		return fmt.Errorf("recording Axiom sync: %w", err)
	}
	progress.Successf(cmd.OutOrStdout(), "Pulled %s → %s (%d dependencies cached)", head.SnapshotFileID, axiomsLeanPath, result.copied)
	return nil
}

// pullUsername returns the explicit argument, else the saved username.
func pullUsername(args []string) (string, error) {
	if len(args) == 1 {
		return args[0], nil
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return "", err
	}
	if cfg.Username == "" {
		return "", errors.New("no username given or saved; usage: axm pull <username>")
	}
	return cfg.Username, nil
}

func renderAxiomsDiff(current, published []byte) string {
	var out strings.Builder
	out.WriteString("--- Axioms.lean (local)\n+++ Axioms.lean (published)\n")
	for _, line := range strings.Split(strings.TrimSuffix(string(current), "\n"), "\n") {
		fmt.Fprintf(&out, "-%s\n", line)
	}
	for _, line := range strings.Split(strings.TrimSuffix(string(published), "\n"), "\n") {
		fmt.Fprintf(&out, "+%s\n", line)
	}
	return out.String()
}

func localAxiomsInSync(idx *axmindex.Index, remoteFileID string) (bool, error) {
	published, err := idx.Published()
	if err != nil {
		return false, err
	}
	entry, ok := published[axiomsLeanPath]
	if !ok || entry.FileID != remoteFileID {
		return false, nil
	}
	content, err := os.ReadFile(filepath.Join(idx.Root(), axiomsLeanPath))
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return entry.ContentHash == axmindex.NormalizedHash(content), nil
}

// matchesTemplate reports whether current is the Axioms.lean the Workspace's
// lean-client template shipped, which holds no user edits to protect.
func matchesTemplate(ctx context.Context, root string, current []byte) bool {
	shipped, ok := upgrade.TemplateFile(ctx, root, axiomsLeanPath)
	return ok && axmindex.NormalizedHash(shipped) == axmindex.NormalizedHash(current)
}

func localMatchesSync(published map[string]axmindex.Published, current []byte) bool {
	if entry, ok := published[axiomsLeanPath]; ok {
		return entry.ContentHash == axmindex.NormalizedHash(current)
	}
	return false
}
