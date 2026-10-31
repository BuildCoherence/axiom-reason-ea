package cmd

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/agentskills"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/lakefile"
	"github.com/spf13/cobra"
)

// recentFetchWindow bounds the "Recently fetched" section of `axm status`:
// only direct fetches whose FetchedAt is within this window of now are shown
// by default. Older direct fetches and any closure-member (indirect) entries
// are summarised in the footer and surfaced in full via `--all-fetched`.
const recentFetchWindow = 48 * time.Hour

// statusAllFetched is the --all-fetched / -a flag: when set, `axm status`
// prints every fetched entry grouped into Direct / Dependencies (newest
// first) and suppresses the recency window and summary footer.
var statusAllFetched bool
var statusRemote bool

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show workspace status",
	Long: `Local, no-network status of the workspace.

Reports the template tag, Lean toolchain, AxiomLib pin, installed Published
Corpus, local and fetched file counts, git state, and agent skill sync state,
then lists modified workspace files and recent fetches. Use --all-fetched to
list every fetched entry (direct and dependency-pulled).`,
	// Runtime errors (e.g. not-in-workspace) shouldn't dump usage.
	SilenceUsage: true,
	RunE:         runStatus,
}

func init() {
	statusCmd.Flags().BoolVarP(&statusAllFetched, "all-fetched", "a", false,
		"list every fetched entry (direct and dependency-pulled), grouped, newest first")
	statusCmd.Flags().BoolVar(&statusRemote, "remote", false, "retired")
	_ = statusCmd.Flags().MarkHidden("remote")
	rootCmd.AddCommand(statusCmd)
}

func runStatus(cmd *cobra.Command, args []string) error {
	if statusRemote {
		return retirementError(binaryName + " status --remote")
	}
	out := cmd.OutOrStdout()

	idx, err := axmindex.Open(".")
	if err != nil {
		if errors.Is(err, axmindex.ErrNoWorkspace) {
			return fmt.Errorf("not in an axm workspace (no .axiomdata/ found in this directory or any parent); run 'axm init' first")
		}
		return err
	}

	published, err := idx.Published()
	if err != nil {
		return fmt.Errorf("reading published.json: %w", err)
	}
	fetched, err := idx.Fetched()
	if err != nil {
		return fmt.Errorf("reading fetched.json: %w", err)
	}

	candidates, err := enumerateWorkspaceFiles(idx.Root())
	if err != nil {
		return fmt.Errorf("enumerating workspace files: %w", err)
	}
	modified := make([]string, 0, len(candidates))
	for _, path := range candidates {
		src, err := os.ReadFile(filepath.Join(idx.Root(), path))
		if err != nil {
			return fmt.Errorf("reading %s: %w", path, err)
		}
		entry, ok := published[path]
		if ok && entry.ContentHash == axmindex.NormalizedHash(src) {
			continue
		}
		if !matchesTemplate(cmd.Context(), idx.Root(), path, src) {
			modified = append(modified, path)
		}
	}
	sort.Strings(modified)

	writeStatusSummary(cmd.Context(), out, idx, len(candidates), len(modified), len(fetched))

	wroteSection := true
	if len(modified) > 0 {
		fmt.Fprintln(out)
		fmt.Fprintln(out, "Modified:")
		for _, p := range modified {
			fmt.Fprintf(out, "  %s\n", p)
		}
	}
	writeFetchedSection(out, fetched, time.Now(), &wroteSection)
	return nil
}

// writeStatusSummary prints one "Label: value" line per workspace and install fact.
// A fact that cannot be read prints as "unknown (<reason>)" rather than failing the command.
func writeStatusSummary(ctx context.Context, out io.Writer, idx *axmindex.Index, local, modified, fetched int) {
	root := idx.Root()
	lakefilePath := filepath.Join(root, "lakefile.lean")
	rows := [][2]string{
		{"Template", statusValue(lakefile.ReadVersion(lakefilePath))},
		{"Toolchain", statusValue(idx.LeanVersion())},
		{"AxiomLib", statusValue(axiomLibPin(lakefilePath))},
		{"Corpus", corpusStatus()},
		{"Local files", fmt.Sprintf("%d (%d modified)", local, modified)},
		{"Fetched files", fmt.Sprintf("%d", fetched)},
		{"Git", gitStatus(ctx, root)},
		{"Agent skills", skillSyncStatus(root)},
	}
	for _, r := range rows {
		fmt.Fprintf(out, "%-14s %s\n", r[0]+":", r[1])
	}
}

func statusValue(v string, err error) string {
	if err != nil {
		return fmt.Sprintf("unknown (%v)", err)
	}
	return v
}

func axiomLibPin(lakefilePath string) (string, error) {
	dep, err := lakefile.ReadGitDependency(lakefilePath, "AxiomLib")
	return dep.Rev, err
}

func corpusStatus() string {
	c, err := corpus.OpenInstalled()
	if errors.Is(err, corpus.ErrNotInstalled) {
		return fmt.Sprintf("not installed; run `%s upgrade`", binaryName)
	}
	if err != nil {
		return fmt.Sprintf("unknown (%v)", err)
	}
	return fmt.Sprintf("%s (%d files)", c.ExportID(), len(c.Files()))
}

// gitStatus summarises `git status --porcelain`, untracked files included.
func gitStatus(ctx context.Context, root string) string {
	cmd := exec.CommandContext(ctx, "git", "-C", root, "status", "--porcelain")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if msg := strings.TrimSpace(stderr.String()); strings.Contains(msg, "not a git repository") {
			return "not a git repository"
		}
		return fmt.Sprintf("unknown (%v)", err)
	}
	changes := 0
	for _, line := range strings.Split(stdout.String(), "\n") {
		if line != "" {
			changes++
		}
	}
	if changes == 0 {
		return "clean"
	}
	return fmt.Sprintf("dirty (%d uncommitted change(s))", changes)
}

// skillSyncStatus reports each configured agent's skill copies against .axiom/skills.
func skillSyncStatus(root string) string {
	ids, err := syncTargets(root, nil, "")
	if err != nil {
		return fmt.Sprintf("unknown (%v)", err)
	}
	if len(ids) == 0 {
		return "no agents configured"
	}
	skills, err := agentskills.LoadCanonical(root)
	if errors.Is(err, agentskills.ErrNoCanonical) {
		return "no canonical skills in " + agentskills.CanonicalDir
	}
	if err != nil {
		return fmt.Sprintf("unknown (%v)", err)
	}
	parts := make([]string, 0, len(ids))
	anyStale := false
	for _, id := range ids {
		state := "in sync"
		stale, err := agentskills.Stale(root, id, skills)
		switch {
		case err != nil:
			state = fmt.Sprintf("unknown (%v)", err)
		case stale:
			state = "stale"
			anyStale = true
		}
		parts = append(parts, id+" "+state)
	}
	summary := strings.Join(parts, ", ")
	if anyStale {
		summary += fmt.Sprintf("; run `%s agents sync`", binaryName)
	}
	return summary
}

// writeFetchedSection renders the fetched portion of `axm status`. With the
// --all-fetched flag it prints two labelled groups (Direct / Dependencies),
// each newest-first; otherwise it shows only direct fetches within
// recentFetchWindow under a "Recently fetched (N):" heading and appends a
// summary footer when older direct entries or any indirect entries are
// hidden. An empty map prints nothing (no heading, no footer). wroteSection is
// updated when this function emits anything, so it owns the blank-line
// separator from preceding sections.
func writeFetchedSection(out io.Writer, fetched map[string]axmindex.Fetched, now time.Time, wroteSection *bool) {
	if len(fetched) == 0 {
		return
	}

	// Partition into direct and indirect, newest-first by FetchedAt.
	var direct, indirect []fetchedEntry
	for name, e := range fetched {
		fe := fetchedEntry{name: name, Fetched: e}
		if e.Indirect {
			indirect = append(indirect, fe)
		} else {
			direct = append(direct, fe)
		}
	}
	sortNewestFirst(direct)
	sortNewestFirst(indirect)

	if statusAllFetched {
		if *wroteSection {
			fmt.Fprintln(out)
		}
		fmt.Fprintf(out, "Direct (%d):\n", len(direct))
		writeFetchedRows(out, direct, now)
		fmt.Fprintln(out)
		fmt.Fprintf(out, "Dependencies (%d):\n", len(indirect))
		writeFetchedRows(out, indirect, now)
		*wroteSection = true
		return
	}

	// Default view: direct fetches within the recency window only.
	var recent []fetchedEntry
	for _, e := range direct {
		if now.Sub(e.FetchedAt) <= recentFetchWindow {
			recent = append(recent, e)
		}
	}

	if *wroteSection {
		fmt.Fprintln(out)
	}
	fmt.Fprintf(out, "Recently fetched (%d):\n", len(recent))
	writeFetchedRows(out, recent, now)

	// Footer only when something is hidden: older direct entries beyond the
	// window, or any indirect entries.
	if len(recent) < len(direct) || len(indirect) > 0 {
		fmt.Fprintf(out,
			"\n%d fetched directly, %d pulled as dependencies — run `axm status --all-fetched` for the full list.\n",
			len(direct), len(indirect))
	}
	*wroteSection = true
}

// fetchedEntry pairs an index filename with its Fetched record so the section
// renderer can sort and display without repeated map lookups.
type fetchedEntry struct {
	name string
	axmindex.Fetched
}

// sortNewestFirst orders entries by FetchedAt descending, breaking ties by
// filename ascending so output is deterministic for tests.
func sortNewestFirst(entries []fetchedEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if !entries[i].FetchedAt.Equal(entries[j].FetchedAt) {
			return entries[i].FetchedAt.After(entries[j].FetchedAt)
		}
		return entries[i].name < entries[j].name
	})
}

// writeFetchedRows prints one row per entry as a left-aligned, whitespace-
// delimited file_id column followed by the humanized fetch age. The column is
// padded to the widest file_id so the age column lines up.
func writeFetchedRows(out io.Writer, entries []fetchedEntry, now time.Time) {
	width := 0
	for _, e := range entries {
		if len(e.FileID) > width {
			width = len(e.FileID)
		}
	}
	for _, e := range entries {
		fmt.Fprintf(out, "  %-*s  %s\n", width, e.FileID, humanizeAgo(now.Sub(e.FetchedAt)))
	}
}

// enumerateWorkspaceFiles returns workspace-relative paths for every
// "Workspace/**/*.lean" file plus "Axioms.lean" if it exists. Output is
// unsorted; the caller sorts.
func enumerateWorkspaceFiles(root string) ([]string, error) {
	var paths []string

	if _, err := os.Stat(filepath.Join(root, "Axioms.lean")); err == nil {
		paths = append(paths, "Axioms.lean")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}

	workspaceDir := filepath.Join(root, "Workspace")
	err := filepath.WalkDir(workspaceDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, fs.ErrNotExist) {
				return fs.SkipAll
			}
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".lean" {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		// Use forward slashes for stable display across platforms.
		paths = append(paths, filepath.ToSlash(rel))
		return nil
	})
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	return paths, nil
}

// humanizeAgo renders a duration as "N <unit> ago" for status output.
// Negative durations (clock skew) are reported as "just now".
func humanizeAgo(d time.Duration) string {
	if d < 0 {
		return "just now"
	}
	switch {
	case d < time.Minute:
		s := int(d.Seconds())
		if s <= 1 {
			return "1 second ago"
		}
		return fmt.Sprintf("%d seconds ago", s)
	case d < time.Hour:
		m := int(d.Minutes())
		if m == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", m)
	case d < 24*time.Hour:
		h := int(d.Hours())
		if h == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", h)
	default:
		days := int(d / (24 * time.Hour))
		if days == 1 {
			return "1 day ago"
		}
		return fmt.Sprintf("%d days ago", days)
	}
}
