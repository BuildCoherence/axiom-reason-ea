package upgrade

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/userconfig"
)

func tempHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

func seed(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateHostedAuth_KeepsUsernameRemovesTokenAndAck(t *testing.T) {
	home := tempHome(t)
	authPath := filepath.Join(home, ".axiom", "auth.json")
	seed(t, authPath, `{"token":"secret","username":"alice"}`)
	ackPath := filepath.Join(home, ".axiom", "publish-ack.json")
	seed(t, ackPath, `{"schema":1}`)

	m, err := migrateHostedAuth(home)
	if err != nil || !m.Removed || m.Username != "alice" {
		t.Fatalf("migration = %+v, %v", m, err)
	}
	for _, gone := range []string{authPath, ackPath} {
		if _, err := os.Stat(gone); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("%s still present: %v", gone, err)
		}
	}
	cfg, err := userconfig.Load()
	if err != nil || cfg.Username != "alice" {
		t.Fatalf("config = %+v, %v", cfg, err)
	}
	cfgPath, _ := userconfig.Path()
	before, _ := os.ReadFile(cfgPath)

	m, err = migrateHostedAuth(home)
	if err != nil || m.Removed {
		t.Fatalf("second migration = %+v, %v; want a no-op", m, err)
	}
	after, _ := os.ReadFile(cfgPath)
	if string(before) != string(after) {
		t.Fatalf("second run changed config.json: %q -> %q", before, after)
	}
}

func TestMigrateHostedAuth_ExistingConfigUsernameWins(t *testing.T) {
	home := tempHome(t)
	seed(t, filepath.Join(home, ".axiom", "config.json"), `{"username":"bob"}`)
	seed(t, filepath.Join(home, ".axiom", "auth.json"), `{"token":"secret","username":"alice"}`)
	m, err := migrateHostedAuth(home)
	if err != nil || !m.Removed || m.Username != "bob" {
		t.Fatalf("migration = %+v, %v", m, err)
	}
}

func TestMigrateHostedAuth_CorruptTokenFileIsStillRemoved(t *testing.T) {
	home := tempHome(t)
	authPath := filepath.Join(home, ".axiom", "auth.json")
	seed(t, authPath, `{`)
	m, err := migrateHostedAuth(home)
	if err != nil || !m.Removed || m.Username != "" {
		t.Fatalf("migration = %+v, %v", m, err)
	}
	if _, err := os.Stat(authPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("token file kept: %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, ".axiom", "config.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("config.json written without a username: %v", err)
	}
}

func TestRunUserLevel_SiteFailureStillInstallsCorpusAndMigrates(t *testing.T) {
	home := tempHome(t)
	seed(t, filepath.Join(home, ".axiom", "auth.json"), `{"token":"secret","username":"alice"}`)
	srv := newAssetServer(t)
	corpusAsset, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))
	site := UserAsset{Kind: SiteKind, URL: srv.URL + "/axiom-site-2.0.0.tar.zst", SHA256: strings.Repeat("0", 64)}

	res, err := RunUserLevel(context.Background(), UserLevelOptions{Corpus: &corpusAsset, Site: &site, HTTPClient: srv.Client()})
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("error = %v; want the site 404", err)
	}
	assertActive(t, filepath.Join(home, ".axiom"), corpusAsset, "a")
	if res.Corpus == nil || !res.Corpus.Changed || res.Site != nil || !res.Migration.Removed {
		t.Fatalf("result = %+v", res)
	}
}

func TestSiteAsset(t *testing.T) {
	t.Setenv("AXM_RELEASE_BASE_URL", "")
	sum := strings.Repeat("a", 64)
	for _, tc := range []struct {
		asset, sha, wantErr string
	}{
		{"axiom-site-2.0.0.tar.zst", sum, ""},
		{"", sum, "site asset"},
		{"../axiom-site-2.0.0.tar.zst", sum, "site asset"},
		{"axiom-site-2.0.0.tar.zst", "abc", "site sha256"},
	} {
		feed := &VersionFeed{}
		feed.Site.Asset, feed.Site.SHA256 = tc.asset, tc.sha
		got, err := feed.SiteAsset("owner/repo")
		if tc.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("%q: error = %v", tc.asset, err)
			}
			continue
		}
		want := "https://github.com/owner/repo/releases/latest/download/axiom-site-2.0.0.tar.zst"
		if err != nil || got.URL != want || got.Kind != SiteKind || got.SHA256 != sum {
			t.Errorf("SiteAsset = %+v, %v", got, err)
		}
	}
}
