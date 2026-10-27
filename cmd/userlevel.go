package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/agentskills"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
)

// corpusPin is the compiled Bridge Release corpus; an empty hash means this build pins none.
var corpusPin = upgrade.UserAsset{Kind: upgrade.CorpusKind, URL: corpusURL, SHA256: corpusSHA256}

// runUserLevelSteps installs the corpus and, given a feed, the site, then migrates auth.json.
func runUserLevelSteps(ctx context.Context, cmd *cobra.Command, label string, feed *upgrade.VersionFeed, feedErr error) error {
	var errs []error
	if feedErr != nil {
		errs = append(errs, feedErr)
	}
	opts := upgrade.UserLevelOptions{}
	if corpusPin.SHA256 != "" {
		pin := corpusPin
		pin.URL = upgrade.ResolveAssetURL(pin.URL)
		opts.Corpus = &pin
	}
	if feed != nil {
		site, err := feed.SiteAsset(releaseRepo)
		if err != nil {
			errs = append(errs, err)
		} else {
			opts.Site = &site
		}
	}
	res, err := upgrade.RunUserLevel(ctx, opts)
	errs = append(errs, err)
	if res != nil {
		if err := printUserLevel(cmd.OutOrStdout(), cmd.ErrOrStderr(), res); err != nil {
			errs = append(errs, err)
		}
	}
	if err := errors.Join(errs...); err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	return nil
}

func printUserLevel(out, errW io.Writer, res *upgrade.UserLevelResult) error {
	for _, r := range []*upgrade.InstallResult{res.Corpus, res.Site} {
		if r != nil {
			for _, w := range r.Warnings {
				progress.Warnf(errW, "%s", w)
			}
		}
	}
	if res.Corpus != nil {
		c, err := corpus.Open(res.Corpus.Dir)
		if err != nil {
			return err
		}
		progress.Successf(out, "published corpus: %d files (frozen %s) → %s", len(c.Files()), c.FrozenDate(), homeRelative(res.Corpus.Dir))
	}
	if res.Migration.Removed {
		if res.Migration.Username != "" {
			progress.Successf(out, "removed hosted sign-in token; kept your username %q for `axm pull`", res.Migration.Username)
		} else {
			progress.Successf(out, "removed hosted sign-in token")
		}
	}
	if res.Corpus != nil {
		fmt.Fprintln(out, "  publishing has closed; your files stay local. Browse: axm viewer")
	}
	return nil
}

func homeRelative(path string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	rel, err := filepath.Rel(home, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return path
	}
	return "~" + string(filepath.Separator) + rel
}

// syncConfiguredAgents refreshes stale per-agent skill copies without pruning.
func syncConfiguredAgents(errW io.Writer, ws string) error {
	ids, err := syncTargets(ws, nil, "")
	if err != nil || len(ids) == 0 {
		return err
	}
	skills, err := agentskills.LoadCanonical(ws)
	if errors.Is(err, agentskills.ErrNoCanonical) {
		return nil
	}
	if err != nil {
		return err
	}
	results, err := agentskills.Sync(ws, ids, skills, false, false)
	if err != nil {
		return err
	}
	for _, id := range ids {
		a, _ := agentskills.ByID(id)
		r := results[id]
		if len(r.Created)+len(r.Updated) == 0 {
			continue
		}
		for _, w := range r.Warnings {
			progress.Warnf(errW, "%s: %s", a.Name, w)
		}
	}
	return nil
}
