package userconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	cfg, err := Load()
	if err != nil || cfg.Username != "" {
		t.Fatalf("missing file: Load() = %+v, %v; want zero config", cfg, err)
	}

	dir := filepath.Join(home, ".axiom")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(`{"username":"Alice"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err = Load()
	if err != nil || cfg.Username != "Alice" {
		t.Fatalf("Load() = %+v, %v; want username Alice", cfg, err)
	}

	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "config.json") {
		t.Fatalf("malformed file: Load() error = %v, want parse error naming config.json", err)
	}
}

func TestSaveRoundTrips(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	if err := Save(Config{Username: "alice"}); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load()
	if err != nil || cfg.Username != "alice" {
		t.Fatalf("Load() after Save = %+v, %v", cfg, err)
	}
	entries, err := os.ReadDir(filepath.Join(home, ".axiom"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("~/.axiom entries = %v, %v; want only config.json", entries, err)
	}
}
