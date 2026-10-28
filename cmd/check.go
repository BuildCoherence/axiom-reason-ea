// Package cmd: `axm check` — local validation.
//
// `axm check` elaborates the given workspace files (or all modified ones)
// and their transitive workspace closure with `lake exe axm_transform` in
// dry-run mode, one file per short-lived subprocess so Lean import regions
// stay bounded. Nothing leaves the machine.
package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/idcodec"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/transform"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/userconfig"
	"github.com/spf13/cobra"
)

var checkAllFlag bool

var checkCmd = &cobra.Command{
	Use:   "check [<file>...]",
	Short: "Elaborate workspace files locally with Lean",
	Long: `Elaborates the given workspace files (or all modified ones with --all)
and their transitive workspace imports locally with lake exe axm_transform.
Nothing is sent over the network.

The hosted service's admission rules (the server-side lean_validator checks
that ran before publishing) no longer run: a file that elaborates cleanly
here has passed Lean, not those rules.

--basic and --offline are accepted for compatibility and change nothing.
Exit 0 on success, 1 on any elaboration failure.`,
	SilenceUsage: true,
	RunE:         runCheck,
}

func init() {
	checkCmd.Flags().BoolVar(&checkAllFlag, "all",
		false,
		"check all modified workspace files (and Axioms.lean if modified)")
	for _, alias := range []string{"basic", "offline"} {
		checkCmd.Flags().Bool(alias, false, "accepted for compatibility; check is always local")
		_ = checkCmd.Flags().MarkHidden(alias)
	}
	rootCmd.AddCommand(checkCmd)
}

// runCheck resolves the seed files, expands and topo-sorts their closure,
// and elaborates each file locally.
func runCheck(cmd *cobra.Command, args []string) error {
	// 1. Pre-flight: lake must be on PATH AND usable. The probe is
	//    output-less and can stall on a cold elan, so cover it with a branded
	//    spinner on stderr (a no-op on non-TTY / NO_COLOR / CI).
	if lakeErr := progress.Spin(cmd.ErrOrStderr(), msgCheckingToolchain, func() error {
		return transform.CheckLakeInstalled(cmd.Context())
	}); lakeErr != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "axm check: %v\n", lakeErr)
		fmt.Fprintln(cmd.ErrOrStderr(), "Install elan (the Lean toolchain manager) from https://lean-lang.org/install/")
		fmt.Fprintln(cmd.ErrOrStderr(), "and re-run `axm check`.")
		return lakeErr
	}

	// 2. Open the workspace.
	idx, err := axmindex.Open(".")
	if err != nil {
		if errors.Is(err, axmindex.ErrNoWorkspace) {
			return fmt.Errorf("not in an Axiom workspace — run `axm init` first or cd into an Axiom workspace")
		}
		return fmt.Errorf("opening workspace: %w", err)
	}

	// 3. Seed set.
	seeds, err := resolveCheckSeeds(idx, args, checkAllFlag)
	if err != nil {
		return err
	}
	if len(seeds) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "axm check: nothing to check (no modified workspace files).")
		return nil
	}

	// 4. Expand transitive closure. An `Axioms.lean` seed walks
	//    `import Workspace.<X>` edges on the same rules as a
	//    `Workspace/<X>.lean` seed.
	closure, err := idx.TransitiveClosure(seeds)
	if err != nil {
		return fmt.Errorf("expanding transitive closure: %w", err)
	}
	if len(closure) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "axm check: nothing to check (seed files are unmodified).")
		return nil
	}

	// 5. Topo sort.
	ordered, err := idx.TopoSort(closure)
	if err != nil {
		var cycle *axmindex.ErrCycle
		if errors.As(err, &cycle) {
			return fmt.Errorf("circular dependency among workspace files: %v", cycle.Paths)
		}
		return fmt.Errorf("topo-sorting closure: %w", err)
	}

	// 6. Mint a throwaway unified id per file. The transform exe needs a
	//    file_id per file to populate `workspace_import_map` and emit
	//    `import A.<file_id>` lines during elaboration; the ids are never
	//    persisted or shown.
	pathToFileID := make(map[string]string, len(ordered))
	for _, p := range ordered {
		pathToFileID[p] = idcodec.Mint()
	}

	// 7. Build transform.File entries. Closure edges that resolve to an
	//    unmodified, previously published sibling fall back to its
	//    published.json id.
	published, err := idx.Published()
	if err != nil {
		return fmt.Errorf("loading published.json: %w", err)
	}
	importMap := workspaceImportMap(pathToFileID, published)
	// Per-file additional same-user opens for junction/bundle re-export chains.
	openPaths, err := idx.TransitiveOpenPaths(ordered)
	if err != nil {
		return fmt.Errorf("computing transitive open set: %w", err)
	}
	files := make([]transform.File, 0, len(ordered))
	for _, p := range ordered {
		src, err := os.ReadFile(filepath.Join(idx.Root(), p))
		if err != nil {
			return fmt.Errorf("reading %s: %w", p, err)
		}
		files = append(files, transform.File{
			Path:               p,
			Source:             string(src),
			FileID:             pathToFileID[p],
			WorkspaceImportMap: importMap,
			TransitiveOpenIDs:  transitiveOpenIDs(openPaths[p], pathToFileID, published),
		})
	}

	return elaborateCheckFiles(cmd, idx, ordered, files)
}

// elaborateCheckFiles runs the dry-run elaboration and reports per-file failures.
func elaborateCheckFiles(cmd *cobra.Command, idx *axmindex.Index,
	ordered []string, files []transform.File) error {

	username := readUsernameBestEffort()

	sp := progress.New(cmd.ErrOrStderr())
	sp.Start(fmt.Sprintf("Checking %d file(s)", len(ordered)))
	if err := transform.Build(cmd.Context(), idx.Root(), true, sp.LakeWriter()); err != nil {
		sp.Stop()
		fmt.Fprintf(cmd.ErrOrStderr(), "axm check: building the Lean workspace failed; run `lake build %s` in %s for the full log.\n",
			strings.Join(transform.BuildTargets, " "), idx.Root())
		return fmt.Errorf("axm check: %w", err)
	}
	resps, invokeErr := invokeCheckTransforms(cmd.Context(), idx.Root(), transform.Request{
		ServerTime: time.Now().UTC().Unix(),
		Username:   username,
		DryRun:     true,
		Files:      files,
	}, sp.LakeWriter())

	failed := collectFailedResponses(resps)
	if invokeErr != nil || len(failed) > 0 {
		sp.Stop()
	} else {
		sp.Done(fmt.Sprintf("Checked %d file(s)", len(ordered)))
	}
	if len(failed) > 0 {
		printCheckErrors(cmd.ErrOrStderr(), failed)
	}
	if invokeErr != nil {
		if len(failed) == 0 {
			return invokeErr
		}
		// Surface the underlying invokeErr (e.g. "lake build failed")
		// alongside the per-file failure count — losing it would hide the
		// real reason the transform died.
		fmt.Fprintf(cmd.ErrOrStderr(), "axm check: %v\n", invokeErr)
		return fmt.Errorf("axm check: %d file(s) failed validation", len(failed))
	}
	if len(failed) > 0 {
		return fmt.Errorf("axm check: %d file(s) failed validation", len(failed))
	}
	progress.Successf(cmd.OutOrStdout(), "axm check: OK (%d file(s) elaborated cleanly)", len(ordered))
	return nil
}

func invokeCheckTransforms(ctx context.Context, workspaceRoot string, req transform.Request, stderrW io.Writer) ([]transform.Response, error) {
	resps := make([]transform.Response, 0, len(req.Files))
	var firstErr error
	for _, file := range req.Files {
		perFileReq := req
		perFileReq.Files = []transform.File{file}
		fileResps, err := transform.Invoke(ctx, workspaceRoot, perFileReq, stderrW)
		resps = append(resps, fileResps...)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		if err != nil && len(fileResps) == 0 {
			break
		}
	}
	return resps, firstErr
}

// resolveCheckSeeds returns the workspace-relative seed paths for the
// check run. With explicit args, paths are normalized to workspace-relative
// form. With --all (or no args), the seed set is `Axioms.lean` plus every
// `Workspace/**/*.lean` whose normalized hash differs from published.json
// (the same "modified" rule centralized in axmindex).
func resolveCheckSeeds(idx *axmindex.Index, args []string, all bool) ([]string, error) {
	if len(args) > 0 && all {
		return nil, fmt.Errorf("pass either explicit file paths or --all, not both")
	}

	if len(args) > 0 {
		out := make([]string, 0, len(args))
		for _, a := range args {
			rel, err := workspaceRelative(idx.Root(), a)
			if err != nil {
				return nil, err
			}
			if _, err := os.Stat(filepath.Join(idx.Root(), rel)); err != nil {
				if errors.Is(err, fs.ErrNotExist) {
					return nil, fmt.Errorf("no such file: %s", a)
				}
				return nil, fmt.Errorf("checking %s: %w", a, err)
			}
			out = append(out, rel)
		}
		sort.Strings(out)
		return out, nil
	}

	// --all or no args: scan the workspace for modified files.
	candidates, err := listWorkspaceLeanFiles(idx.Root())
	if err != nil {
		return nil, err
	}
	published, err := idx.Published()
	if err != nil {
		return nil, err
	}
	var seeds []string
	for _, p := range candidates {
		src, err := os.ReadFile(filepath.Join(idx.Root(), p))
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", p, err)
		}
		hash := axmindex.NormalizedHash(src)
		entry, ok := published[p]
		if !ok || entry.ContentHash != hash {
			seeds = append(seeds, p)
		}
	}
	sort.Strings(seeds)
	return seeds, nil
}

// listWorkspaceLeanFiles returns every workspace-relative `.lean` source
// file that the seed-set logic considers a candidate: `Axioms.lean` (if
// present) plus everything under `Workspace/`.
func listWorkspaceLeanFiles(root string) ([]string, error) {
	var out []string

	if _, err := os.Stat(filepath.Join(root, "Axioms.lean")); err == nil {
		out = append(out, "Axioms.lean")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}

	wsDir := filepath.Join(root, "Workspace")
	walkErr := filepath.WalkDir(wsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			return nil
		}
		if filepath.Ext(d.Name()) != ".lean" {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}
	sort.Strings(out)
	return out, nil
}

// workspaceRelative resolves arg to a path relative to root, using
// forward slashes. arg may already be workspace-relative or it may be
// an absolute / cwd-relative path.
func workspaceRelative(root, arg string) (string, error) {
	abs, err := filepath.Abs(arg)
	if err != nil {
		return "", fmt.Errorf("resolving %s: %w", arg, err)
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return "", fmt.Errorf("relativizing %s to workspace root %s: %w", arg, root, err)
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "../") || rel == ".." {
		return "", fmt.Errorf("%s is outside the workspace root %s", arg, root)
	}
	return rel, nil
}

// readUsernameBestEffort returns the username saved in ~/.axiom/config.json,
// or "anonymous" when none is saved or the file is unreadable.
func readUsernameBestEffort() string {
	cfg, err := userconfig.Load()
	if err != nil || cfg.Username == "" {
		return "anonymous"
	}
	return cfg.Username
}

// collectFailedResponses returns the subset of resps with a non-empty
// Error string, sorted by path for deterministic output.
func collectFailedResponses(resps []transform.Response) []transform.Response {
	var failed []transform.Response
	for _, r := range resps {
		if r.Error != "" {
			failed = append(failed, r)
		}
	}
	sort.Slice(failed, func(a, b int) bool { return failed[a].Path < failed[b].Path })
	return failed
}

// printCheckErrors writes each failed response as a human-readable block
// to the supplied writer: path, kind, message, and (if Pos is set) a
// position. Threaded through an io.Writer (rather than hard-coding
// os.Stderr) so tests can capture the output via cobra's ErrOrStderr seam.
func printCheckErrors(w io.Writer, failed []transform.Response) {
	for _, r := range failed {
		fmt.Fprintf(w, "\n%s [%s]\n", r.Path, r.Error)
		if r.Details != nil {
			fmt.Fprintf(w, "  %s\n", r.Details.Message)
			if pos := formatErrorPos(r.Details.Pos); pos != "" {
				fmt.Fprintf(w, "  at %s\n", pos)
			}
		}
	}
}

// formatErrorPos renders the typed Pos as "line N, col M" (or "line N"
// when col is 0). Returns "" for a nil Pos.
func formatErrorPos(p *transform.Pos) string {
	if p == nil {
		return ""
	}
	if p.Col == 0 {
		return fmt.Sprintf("line %d", p.Line)
	}
	return fmt.Sprintf("line %d, col %d", p.Line, p.Col)
}
