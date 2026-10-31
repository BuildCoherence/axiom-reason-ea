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

// templateRepoFixture makes a repository whose v1-clean tag merges cleanly
// into v2 and whose v1-conflict tag, a sibling of v2, edits the same line.
func templateRepoFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitConfig := filepath.Join(dir, "gitconfig")
	if err := os.WriteFile(gitConfig, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	repo := filepath.Join(dir, "repo")
	t.Setenv("GIT_CONFIG_GLOBAL", gitConfig)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repo}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.invalid",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.invalid")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(repo, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	run("init", "-q", "-b", "main")
	write("lakefile.lean", "version 1.0\n")
	write("README.md", "one\n")
	run("add", "-A")
	run("commit", "-qm", "base")
	run("tag", "v1-clean")
	write("lakefile.lean", "version 1.1\n")
	run("commit", "-qam", "sibling")
	run("tag", "v1-conflict")
	run("checkout", "-q", "v1-clean")
	write("lakefile.lean", "version 2.0\n")
	write("README.md", "two\n")
	run("commit", "-qam", "target")
	run("tag", "v2")
	return repo
}

func TestReportsCleanAndConflictingMerges(t *testing.T) {
	repo := templateRepoFixture(t)
	var stdout, stderr bytes.Buffer
	code := run(context.Background(), repo, "v2", []string{"v1-clean", "v1-conflict"}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("run = %d, want 1; stdout %q stderr %q", code, stdout.String(), stderr.String())
	}
	want := "v1-clean -> v2: clean\nv1-conflict -> v2: CONFLICT in lakefile.lean\n"
	if stdout.String() != want {
		t.Errorf("stdout = %q, want %q", stdout.String(), want)
	}
}

func TestCleanMergesPass(t *testing.T) {
	repo := templateRepoFixture(t)
	var stdout, stderr bytes.Buffer
	if code := run(context.Background(), repo, "v2", []string{"v1-clean"}, &stdout, &stderr); code != 0 {
		t.Fatalf("run = %d, want 0; stdout %q stderr %q", code, stdout.String(), stderr.String())
	}
}

func TestMissingTargetWarnsAndSkips(t *testing.T) {
	repo := templateRepoFixture(t)
	var stdout, stderr bytes.Buffer
	code := run(context.Background(), repo, "v3", []string{"v1-clean"}, &stdout, &stderr)
	if code != 0 || !strings.HasPrefix(stdout.String(), "::warning title=template-merge skipped::") {
		t.Fatalf("run = %d, stdout %q; want 0 and a skip warning", code, stdout.String())
	}
}

func TestMissingReleasedTagFails(t *testing.T) {
	repo := templateRepoFixture(t)
	var stdout, stderr bytes.Buffer
	if code := run(context.Background(), repo, "v2", []string{"v0-absent"}, &stdout, &stderr); code != 1 {
		t.Fatalf("run = %d, want 1; stdout %q", code, stdout.String())
	}
}
