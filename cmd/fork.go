// Package cmd / fork.go implements `axm fork <file_id> [<dest>]` per
// the internal content-submission-pipeline doc §"axm fork".
//
// The five-step flow:
//  1. Copy <file_id>'s dependency closure from the installed Published
//     Corpus into .axiomdata/files/A/ (the root itself is not cached).
//  2. Derive the dest path: Workspace/<dest>.lean (warn-and-default if
//     dest omitted).
//  3. Reverse-transform the fetched content to workspace form by shelling
//     to `lake exe axm_transform` with `mode: "reverse"`. The exe walks
//     the parsed Syntax tree and applies byte-range edits to strip the
//     outer `namespace <file_id> ... end <file_id>` wrapper, rewrite each
//     `import A.<x>` back to `import Workspace.<path-stem>` when <x> is
//     the latest-published unified file_id of one of the user's own
//     workspace files, and drop the auto-open markers the forward
//     transform emitted alongside those imports.
//  4. Write Workspace/<dest>.lean (refuses to clobber).
//  5. Record the fork intent in fork_intents.json. Consumed on the next
//     successful publish of that path.
package cmd

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/idcodec"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/transform"
	"github.com/spf13/cobra"
)

var forkCmd = &cobra.Command{
	Use:   "fork <file_id> [<dest>]",
	Short: "Scaffold a new workspace file from a corpus file's content",
	Long: "Reads the file by file_id (the unified 8-char id) from the installed Published\n" +
		"Corpus, caches its dependency closure, reverse-transforms it into workspace\n" +
		"form, writes it as\n" +
		"Workspace/<dest>.lean, and records a fork intent naming its parent.",
	Args:         cobra.RangeArgs(1, 2),
	SilenceUsage: true,
	RunE:         runFork,
}

func init() {
	rootCmd.AddCommand(forkCmd)
}

func runFork(cmd *cobra.Command, args []string) error {
	ctx := cmd.Context()

	// Validate the unified file_id before any I/O. The id IS the wire/URL/
	// cache-key/namespace form, so it is used verbatim throughout.
	encoded := args[0]
	if !idcodec.Valid(encoded) {
		return fmt.Errorf("invalid file_id %q", args[0])
	}

	idx, err := axmindex.Open(".")
	if err != nil {
		if errors.Is(err, axmindex.ErrNoWorkspace) {
			return fmt.Errorf("not in an axiom workspace: run `axm init` first")
		}
		return err
	}
	permit, err := preflightMaterialization(ctx, idx)
	if err != nil {
		return err
	}
	pc, err := corpus.OpenInstalled()
	if err != nil {
		return err
	}
	if err := requireInCorpus(pc, encoded); err != nil {
		return err
	}

	// Reverse mode shells to `lake exe axm_transform`; require lake on PATH
	// only after the workspace floor has been checked.
	if err := probeLake(cmd, idx.Root()); err != nil {
		return err
	}

	// Serialize against concurrent axm commands that mutate .axiomdata/:
	// `axm fork` writes fork_intents.json, fetched.json and
	// .axiomdata/files/A/<id>.lean; `axm fetch` writes the same cache.
	// See cmd/lock.go.
	// Hold the returned *flock.Flock via defer Unlock so it stays live for
	// the full critical section (gofrs/flock releases on GC otherwise).
	lock, err := acquireWorkspaceLock(idx)
	if err != nil {
		return err
	}
	defer func() { _ = lock.Unlock() }()

	// ── Step 1: ensure the dependency closure ────────────────────────────
	// The root becomes a Workspace/ file, so ensureClosureCached returns its
	// bytes without caching or recording it; only its foreign-dependency
	// closure is recorded, every member indirect:true.
	forkStart := time.Now()
	prog := newSpinnerProgress(cmd.ErrOrStderr())
	fetchedContent, result, err := ensureClosureCached(idx, pc, encoded, false, permit, prog, cmd.ErrOrStderr())
	prog.stop()
	if err != nil {
		return fmt.Errorf("fork aborted: %w", err)
	}

	// ── Step 2: derive dest path ─────────────────────────────────────────
	destStem := encoded
	if len(args) == 2 {
		destStem = args[1]
	} else {
		fmt.Fprintf(cmd.ErrOrStderr(),
			"warning: no <dest> given; using Workspace/%s.lean — rename when you save a revision\n",
			encoded)
	}
	destRel := normalizeForkDest(destStem)
	destAbs := filepath.Join(idx.Root(), destRel)

	if _, err := os.Stat(destAbs); err == nil {
		return fmt.Errorf("refusing to clobber existing file %s", destRel)
	} else if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("checking destination %s: %w", destRel, err)
	}

	// ── Step 3: reverse-transform ────────────────────────────────────────
	published, err := idx.Published()
	if err != nil {
		return err
	}
	// Build the reverse import map the exe consumes: latest-published
	// base50 file_id -> dotted "Workspace.<stem>". Only Workspace/* entries
	// are eligible (Axioms.lean cannot be imported via `import Workspace.<X>`).
	reverseImportMap := reverseWorkspaceImportMap(published)

	// Shell to `lake exe axm_transform` with mode: "reverse". The exe walks
	// the parsed Syntax tree and applies byte-range edits — see
	// the internal ast-driven-source-rewriting doc and
	// the internal axm-transform doc §5.4.
	errW := cmd.ErrOrStderr()
	req := transform.Request{
		Mode: "reverse",
		Files: []transform.File{{
			Path:             destRel,
			Source:           string(fetchedContent),
			FileID:           encoded,
			ReverseImportMap: reverseImportMap,
		}},
	}
	xfSpin := progress.New(errW)
	xfSpin.Start("Converting to workspace form")
	if err := buildForTransform(cmd, idx.Root(), xfSpin.LakeWriter()); err != nil {
		xfSpin.Stop()
		return err
	}
	resps, err := transform.Invoke(ctx, idx.Root(), req, xfSpin.LakeWriter())
	if err != nil || len(collectFailedResponses(resps)) > 0 {
		xfSpin.Stop()
	} else {
		xfSpin.Done("Converted to workspace form")
	}
	if err != nil {
		printTransformErrors(errW, resps)
		return err
	}
	if hadErr := printTransformErrors(errW, resps); hadErr {
		return fmt.Errorf("fork aborted: transform reported errors")
	}
	if len(resps) != 1 {
		return fmt.Errorf("fork aborted: transform returned %d responses, expected 1", len(resps))
	}
	reversed := []byte(resps[0].Content)

	// ── Step 4: write the file ───────────────────────────────────────────
	if err := os.MkdirAll(filepath.Dir(destAbs), 0o755); err != nil {
		return fmt.Errorf("creating directory for %s: %w", destRel, err)
	}
	if err := os.WriteFile(destAbs, reversed, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", destRel, err)
	}

	// ── Step 5: record fork intent ───────────────────────────────────────
	if err := idx.SetForkIntent(destRel, encoded); err != nil {
		return fmt.Errorf("recording fork intent: %w", err)
	}

	// Two-line completion (the only multi-line completion in axm): the
	// workspace PATH is foremost and whitespace-flanked (it is the artifact
	// the user reaches for next), the originating file_id demoted to line 2.
	// stdout, byte-stable under AXM_NO_SPINNER / CI. N is the dependency count
	// copied this invocation (after the diff), per the fetch convention.
	progress.Successf(cmd.OutOrStdout(), "Forked → %s    (%s)", destRel, progress.FmtElapsed(time.Since(forkStart)))
	fmt.Fprintf(cmd.OutOrStdout(), "  from %s — %d dependencies cached\n", encoded, result.copied)
	return nil
}

// normalizeForkDest returns the workspace-relative dest path for a user
// argument: ensures the "Workspace/" prefix and the ".lean" suffix without
// double-prefixing or double-suffixing. Always uses forward slashes
// (matching the keys the index packages persist).
func normalizeForkDest(arg string) string {
	p := filepath.ToSlash(arg)
	if !strings.HasSuffix(p, ".lean") {
		p += ".lean"
	}
	if !strings.HasPrefix(p, "Workspace/") {
		p = "Workspace/" + p
	}
	return p
}

func reverseWorkspaceImportMap(published map[string]axmindex.Published) map[string]string {
	reverseImportMap := map[string]string{}
	for path, entry := range published {
		const prefix = "Workspace/"
		const suffix = ".lean"
		if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
			continue
		}
		stem := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
		reverseImportMap[entry.FileID] = "Workspace." + strings.ReplaceAll(stem, "/", ".")
	}
	return reverseImportMap
}
