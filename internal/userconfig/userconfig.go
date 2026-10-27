// Package userconfig reads ~/.axiom/config.json, the per-user settings file
// of the form {"username": "<u>"}.
package userconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Config is the decoded ~/.axiom/config.json.
type Config struct {
	Username string `json:"username,omitempty"`
}

// Path returns ~/.axiom/config.json.
func Path() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("locating home directory: %w", err)
	}
	return filepath.Join(home, ".axiom", "config.json"), nil
}

// Load returns the saved config; a missing file is the zero Config.
func Load() (Config, error) {
	path, err := Path()
	if err != nil {
		return Config{}, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Config{}, nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("reading %s: %w", path, err)
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, fmt.Errorf("parsing %s: %w", path, err)
	}
	return cfg, nil
}

// Save atomically replaces ~/.axiom/config.json with cfg.
func Save(cfg Config) error {
	path, err := Path()
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*.json")
	if err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	_, werr := tmp.Write(append(raw, '\n'))
	if err := errors.Join(werr, tmp.Close()); err != nil {
		_ = os.Remove(tmp.Name())
		return fmt.Errorf("writing %s: %w", path, err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		_ = os.Remove(tmp.Name())
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}
