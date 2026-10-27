package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Synthetic deny-list patterns; real patterns are never committed to this repository.
const (
	patA = "zebra-leak"
	patB = "Quokka/Private"
)

var testPatterns = patA + "\n" + patB + "\n"

type result struct {
	code           int
	stdout, stderr string
}

func (r result) lines() []string {
	return strings.Split(strings.TrimSpace(r.stdout), "\n")
}

func (r result) has(t *testing.T, want string) {
	t.Helper()
	for _, l := range r.lines() {
		if l == want {
			return
		}
	}
	t.Errorf("output lacks %q:\n%s", want, r.stdout)
}

func (r result) noPatternEcho(t *testing.T) {
	t.Helper()
	all := strings.ToLower(r.stdout + r.stderr)
	for _, p := range parsePatterns(testPatterns) {
		if strings.Contains(all, p) {
			t.Errorf("diagnostics echo a deny-list pattern:\n%s\n%s", r.stdout, r.stderr)
		}
	}
}

func envOf(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func runGate(t *testing.T, env map[string]string, run runner, args ...string) result {
	t.Helper()
	if run == nil {
		run = execRunner()
	}
	var stdout, stderr bytes.Buffer
	code := mainRun(context.Background(), args, &stdout, &stderr, envOf(env), run)
	return result{code, stdout.String(), stderr.String()}
}

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.invalid",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.invalid",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	git(t, dir, "init", "-q", "-b", "main")
	return dir
}

func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func commitAll(t *testing.T, dir, msg string) string {
	t.Helper()
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-q", "--allow-empty", "-m", msg)
	return git(t, dir, "rev-parse", "HEAD")
}
