package cmd

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// makeTaggedInitRepo returns a template repo whose v<leanClientTag> tag
// differs from its later main commit.
func makeTaggedInitRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not available in this test environment")
	}
	repo := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repo}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	run("init", "-q")
	run("config", "user.name", "test")
	run("config", "user.email", "test@example.com")
	path := filepath.Join(repo, "version.txt")
	if err := os.WriteFile(path, []byte("active\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	skill := filepath.Join(repo, ".axiom", "skills", "demo", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(skill), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skill, []byte("---\ndescription: demo\n---\ndemo skill\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "-A")
	run("commit", "-qm", "active")
	run("tag", "v"+leanClientTag)
	if err := os.WriteFile(path, []byte("newer-main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("commit", "-qam", "candidate")
	return repo
}

func assertInitContent(t *testing.T, dest, want string) {
	t.Helper()
	got, err := os.ReadFile(filepath.Join(dest, "version.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Fatalf("cloned content = %q, want %q", got, want)
	}
}

func TestRunClone_ClonesRequestedTagAndSeedsWorkspace(t *testing.T) {
	repo := makeTaggedInitRepo(t)
	dest := filepath.Join(t.TempDir(), "workspace")
	if err := runClone(io.Discard, repo, "v"+leanClientTag, dest); err != nil {
		t.Fatalf("runClone: %v", err)
	}
	assertInitContent(t, dest, "active\n")
	if _, err := os.Stat(filepath.Join(dest, ".axiomdata", "files", "A")); err != nil {
		t.Fatalf(".axiomdata not seeded: %v", err)
	}
	remotes, err := exec.Command("git", "-C", dest, "remote").Output()
	if err != nil || strings.TrimSpace(string(remotes)) != "axiom-client" {
		t.Fatalf("remotes = %q, %v", remotes, err)
	}
}

// TestRunClone_IgnoresGlobalCRLFConversion reproduces a Windows runner's
// global core.autocrlf=true on any OS: the Workspace must still check out the
// template's LF bytes, and keep that setting for later checkouts.
func TestRunClone_IgnoresGlobalCRLFConversion(t *testing.T) {
	repo := makeTaggedInitRepo(t)
	global := filepath.Join(t.TempDir(), "gitconfig")
	if err := os.WriteFile(global, []byte("[core]\n\tautocrlf = true\n\teol = crlf\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", global)
	dest := filepath.Join(t.TempDir(), "workspace")
	if err := runClone(io.Discard, repo, "v"+leanClientTag, dest); err != nil {
		t.Fatalf("runClone: %v", err)
	}
	assertInitContent(t, dest, "active\n")
	for key, want := range map[string]string{"core.autocrlf": "input", "core.eol": "lf"} {
		out, err := exec.Command("git", "-C", dest, "config", "--local", key).Output()
		if err != nil || strings.TrimSpace(string(out)) != want {
			t.Errorf("workspace %s = %q (%v), want %q", key, out, err, want)
		}
	}
}

func TestRunClone_MissingTagFails(t *testing.T) {
	repo := makeTaggedInitRepo(t)
	dest := filepath.Join(t.TempDir(), "workspace")
	err := runClone(io.Discard, repo, "v0.0.0-missing", dest)
	if err == nil || !strings.Contains(err.Error(), "v0.0.0-missing") {
		t.Fatalf("runClone error = %v; want a failure naming the tag", err)
	}
}

// TestPreflightGitSource_Unreachable covers the failure path of the
// ls-remote probe. It uses a nonexistent local path (offline-safe) so the
// test runs reliably in sandboxed CI. The returned error must name both
// possible causes of a GitHub private-repo 404 — URL wrong or auth
// missing — without guessing between them, and must point the user at
// `gh auth login --web` + SSO authorization. See
// the internal ci-private-repo-clone-auth doc §3.
func TestPreflightGitSource_Unreachable(t *testing.T) {
	var errBuf bytes.Buffer
	missing := filepath.Join(t.TempDir(), "no-such-repo")
	err := preflightGitSource(&errBuf, missing)
	if err == nil {
		t.Fatalf("expected preflight error for nonexistent source")
	}
	msg := err.Error()
	for _, want := range []string{
		"URL is wrong",
		"credentials lack access",
		"SSO",
		"gh auth login",
		"BuildCoherence",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("preflight error missing %q: %q", want, msg)
		}
	}
}

// TestRenameOriginToAxiomClient_HappyPath confirms the rename runs on a
// repo that has an `origin` remote and yields a repo with `axiom-client`
// instead.
func TestRenameOriginToAxiomClient_HappyPath(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	mustRunGit := func(args ...string) {
		t.Helper()
		c := exec.Command("git", append([]string{"-C", dir}, args...)...)
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	mustRunGit("init", "-q", "-b", "main")
	mustRunGit("remote", "add", "origin", "https://example.com/repo.git")

	var errBuf bytes.Buffer
	if err := renameOriginToAxiomClient(&errBuf, dir); err != nil {
		t.Fatalf("rename returned error: %v\nstderr: %s", err, errBuf.String())
	}

	remotes, err := exec.Command("git", "-C", dir, "remote").Output()
	if err != nil {
		t.Fatalf("list remotes: %v", err)
	}
	got := strings.TrimSpace(string(remotes))
	if got != "axiom-client" {
		t.Errorf("remotes = %q, want %q", got, "axiom-client")
	}
}

// TestRenameOriginToAxiomClient_NoOrigin confirms a missing-origin git
// repo is tolerated as a no-op. This guards against future refactors of
// the populate strategies that leave no `origin` behind.
func TestRenameOriginToAxiomClient_NoOrigin(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	c := exec.Command("git", "-C", dir, "init", "-q", "-b", "main")
	if out, err := c.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}

	var errBuf bytes.Buffer
	if err := renameOriginToAxiomClient(&errBuf, dir); err != nil {
		t.Errorf("rename should swallow no-origin error, got: %v\nstderr: %s", err, errBuf.String())
	}
}

// TestRunPrewarm_ProbesInsideWorkspace: with no elan default toolchain, lake
// works only where a lean-toolchain file pins one, so init must probe and
// build inside the new workspace rather than in the directory it ran from.
func TestRunPrewarm_ProbesInsideWorkspace(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("lake shim uses /bin/sh; not portable to windows")
	}
	bin := t.TempDir()
	script := "#!/bin/sh\n" +
		"[ -f lean-toolchain ] || { echo 'error: no default toolchain configured' >&2; exit 1; }\n" +
		"[ \"$1\" = build ] && : > built\nexit 0\n"
	if err := os.WriteFile(filepath.Join(bin, "lake"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	t.Chdir(t.TempDir())
	ws := t.TempDir()
	if err := os.WriteFile(filepath.Join(ws, "lean-toolchain"), []byte("leanprover/lean4:v4.34.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var errW bytes.Buffer
	if err := runPrewarm(context.Background(), &errW, ws); err != nil {
		t.Fatalf("runPrewarm err = %v", err)
	}
	if strings.Contains(errW.String(), "skipped") {
		t.Errorf("pre-warm was skipped; stderr=%q", errW.String())
	}
	if _, err := os.Stat(filepath.Join(ws, "built")); err != nil {
		t.Errorf("lake build did not run in the workspace: %v", err)
	}
}
