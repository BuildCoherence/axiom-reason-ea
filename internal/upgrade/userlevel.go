package upgrade

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/userconfig"
)

const (
	// CorpusKind and SiteKind name the install directories under ~/.axiom.
	CorpusKind = "corpus"
	SiteKind   = "site"
	authFile   = "auth.json"
	ackFile    = "publish-ack.json"
)

// UserLevelOptions selects the hash-pinned assets to install; a nil asset is skipped.
type UserLevelOptions struct {
	Corpus     *UserAsset
	Site       *UserAsset
	HTTPClient *http.Client
}

// AuthMigration reports the one-time removal of the hosted sign-in token.
type AuthMigration struct {
	Removed  bool
	Username string
}

// UserLevelResult reports each user-level step that ran.
type UserLevelResult struct {
	Corpus    *InstallResult
	Site      *InstallResult
	Migration AuthMigration
}

// RunUserLevel installs the corpus and site and migrates auth.json; every step runs even if another fails.
func RunUserLevel(ctx context.Context, opts UserLevelOptions) (*UserLevelResult, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("locating home directory: %w", err)
	}
	axiomDir := filepath.Join(home, ".axiom")
	res := &UserLevelResult{}
	var errs []error
	if opts.Corpus != nil {
		r, err := installUserAsset(ctx, opts.HTTPClient, axiomDir, *opts.Corpus)
		res.Corpus = r
		errs = append(errs, err)
	}
	if opts.Site != nil {
		r, err := installUserAsset(ctx, opts.HTTPClient, axiomDir, *opts.Site)
		res.Site = r
		errs = append(errs, err)
	}
	res.Migration, err = migrateHostedAuth(home)
	errs = append(errs, err)
	return res, errors.Join(errs...)
}

// migrateHostedAuth keeps auth.json's username in config.json, then deletes auth.json and publish-ack.json.
func migrateHostedAuth(home string) (AuthMigration, error) {
	var m AuthMigration
	authPath := filepath.Join(home, ".axiom", authFile)
	raw, err := os.ReadFile(authPath)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return m, fmt.Errorf("reading %s: %w", authPath, err)
	default:
		var auth struct {
			Username string `json:"username"`
		}
		// A corrupt token file carries no username to keep, but is still removed.
		_ = json.Unmarshal(raw, &auth)
		cfg, err := userconfig.Load()
		if err != nil {
			return m, err
		}
		if cfg.Username == "" && auth.Username != "" {
			cfg.Username = auth.Username
			if err := userconfig.Save(cfg); err != nil {
				return m, err
			}
		}
		if err := os.Remove(authPath); err != nil {
			return m, fmt.Errorf("removing %s: %w", authPath, err)
		}
		m = AuthMigration{Removed: true, Username: cfg.Username}
	}
	ack := filepath.Join(home, ".axiom", ackFile)
	if err := os.Remove(ack); err != nil && !errors.Is(err, os.ErrNotExist) {
		return m, fmt.Errorf("removing %s: %w", ack, err)
	}
	return m, nil
}
