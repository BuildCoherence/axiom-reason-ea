package main

import (
	"bytes"
	"path/filepath"
	"testing"
)

var readme = filepath.Join("..", "..", "README.md")

// TestRepositoryReadme pins what the workflow runs from the real README; a
// Quickstart edit that changes it updates these lines too.
func TestRepositoryReadme(t *testing.T) {
	for _, tc := range []struct {
		os, part string
		release  bool
		want     string
	}{
		{"unix", "install", false,
			"curl -fsSL https://install.axiom.computer | sh   # or install.ps1, a Release download, or go install\n"},
		{"unix", "install", true,
			"curl -fsSL https://github.com/BuildCoherence/axiom-reason-ea/releases/latest/download/install.sh | sh   # or install.ps1, a Release download, or go install\n"},
		{"windows", "install", false,
			"irm https://install.axiom.computer/install.ps1 | iex   # Windows (PowerShell)\n"},
		{"windows", "install", true,
			"irm https://github.com/BuildCoherence/axiom-reason-ea/releases/latest/download/install.ps1 | iex   # Windows (PowerShell)\n"},
		{"unix", "setup", false,
			"axm init my-ideas --agents claude && cd my-ideas    # or --agents codex\n"},
		{"windows", "setup", true,
			"axm init my-ideas --agents claude && cd my-ideas    # or --agents codex\n"},
		{"unix", "viewer", false, "axm viewer\n"},
		{"windows", "viewer", false, "axm viewer\n"},
	} {
		var stdout, stderr bytes.Buffer
		if code := run(readme, tc.os, tc.part, tc.release, &stdout, &stderr); code != 0 {
			t.Fatalf("run(%s, %s, release=%v) = %d: %s", tc.os, tc.part, tc.release, code, stderr.String())
		}
		if got := stdout.String(); got != tc.want {
			t.Errorf("run(%s, %s, release=%v) printed %q, want %q", tc.os, tc.part, tc.release, got, tc.want)
		}
	}
}

func TestRejectsBadFlags(t *testing.T) {
	for _, tc := range [][2]string{{"linux", "install"}, {"unix", "all"}} {
		var stdout, stderr bytes.Buffer
		if code := run(readme, tc[0], tc[1], false, &stdout, &stderr); code != 1 || stdout.Len() != 0 {
			t.Errorf("run(-os %s -part %s) = %d, stdout %q; want 1 and no output", tc[0], tc[1], code, stdout.String())
		}
	}
}
