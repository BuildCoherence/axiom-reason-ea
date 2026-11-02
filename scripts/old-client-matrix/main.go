// Command old-client-matrix runs one old-client matrix cell: a released 1.x
// axm, in a committed Workspace cloned from its paired template tag, runs
// `axm upgrade` against the preview feed (AXIOM_API_URL) and the candidate
// release (AXM_RELEASE_BASE_URL), then the cell checks the result.
//
// Usage (from the repository root, both variables set):
//
//	go run ./scripts/old-client-matrix -cli 1.1.5-beta [-want-version 2.0.0] [-want-template v2.0.0] [-work <dir>]
package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/lakefile"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
)

const (
	templateRepo = "https://github.com/BuildCoherence/axiom-client.git"
	remoteName   = "axiom-client"
	userSkill    = ".axiom/skills/my-notes/SKILL.md"
	userSkillMD  = "---\nname: my-notes\ndescription: My own notes on this Workspace.\n---\n\nKeep proofs short.\n"
)

// release is a released 1.x axm: where its archives live and the template tag its `axm init` cloned.
type release struct {
	Source   string
	Template string
}

var releases = map[string]release{
	"1.0.0-beta": {
		"https://storage.googleapis.com/cl-axiom-production-production-axm/axm/v1.0.0-beta/",
		"v1.0.0-beta",
	},
	"1.0.1-beta": {
		"https://storage.googleapis.com/cl-axiom-production-production-axm/axm/v1.0.1-beta/",
		"v1.1.0-beta",
	},
	"1.1.0-beta": {
		"https://storage.googleapis.com/cl-axiom-production-production-axm/axm/v1.1.0-beta/",
		"v1.1.1-beta",
	},
	"1.1.1-beta": {
		"https://storage.googleapis.com/cl-axiom-production-production-axm/axm/1.1.1-beta/",
		"v1.1.2-beta",
	},
	"1.1.2-beta": {
		"https://storage.googleapis.com/cl-axiom-production-production-axm/axm/1.1.2-beta/",
		"v1.1.3-beta",
	},
	"1.1.3-beta": {
		"https://storage.googleapis.com/cl-axiom-production-production-axm/axm/1.1.3-beta/",
		"v1.1.5-beta",
	},
	"1.1.4-beta": {
		"https://storage.googleapis.com/cl-axiom-production-production-axm/axm/1.1.4-beta/",
		"v1.1.5-beta",
	},
	"1.1.5-beta": {
		"https://storage.googleapis.com/cl-axiom-production-production-axm/axm/1.1.5-beta/",
		"v1.1.5-beta",
	},
}

var corpusRow = regexp.MustCompile(`(?m)^Corpus:\s+\S+ \(\d+ files\)\s*$`)

type cell struct {
	cli, wantVersion, wantTemplate string
	rel                            release
	work, bin, ws                  string
	env                            []string
	timeout                        time.Duration
}

func main() {
	cli := flag.String("cli", "", "released axm version, e.g. 1.1.5-beta")
	wantVersion := flag.String("want-version", "2.0.0", "axm version the upgrade must install")
	wantTemplate := flag.String("want-template", "v2.0.0", "axiom-client tag the Workspace must reach")
	work := flag.String("work", "", "empty directory for the cell (default: a new temporary directory)")
	timeout := flag.Duration("timeout", 20*time.Minute, "bound on `axm upgrade`, including the Windows re-exec child")
	flag.Parse()
	c, err := newCell(*cli, *wantVersion, *wantTemplate, *work, *timeout)
	if err == nil {
		err = c.run(context.Background())
	}
	if err != nil {
		fmt.Printf("::error::old-client-matrix %s: %v\n", *cli, err)
		os.Exit(1)
	}
	fmt.Printf("old-client-matrix %s (%s/%s): PASS\n", *cli, runtime.GOOS, runtime.GOARCH)
}

func newCell(cli, wantVersion, wantTemplate, work string, timeout time.Duration) (*cell, error) {
	rel, ok := releases[cli]
	if !ok {
		return nil, fmt.Errorf("-cli %q is not one of %s", cli, strings.Join(releasedVersions(), ", "))
	}
	for _, name := range []string{"AXIOM_API_URL", "AXM_RELEASE_BASE_URL"} {
		if os.Getenv(name) == "" {
			return nil, fmt.Errorf("%s must be set; a cell never reaches the production API or the GitHub Release", name)
		}
	}
	var err error
	if work == "" {
		work, err = os.MkdirTemp("", "old-client-matrix-")
	} else {
		err = os.MkdirAll(work, 0o755)
	}
	if err != nil {
		return nil, err
	}
	if work, err = filepath.Abs(work); err != nil {
		return nil, err
	}
	home := filepath.Join(work, "home")
	gitConfig := filepath.Join(work, "gitconfig")
	for _, dir := range []string{home, filepath.Join(work, "bin")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	if err := os.WriteFile(gitConfig, nil, 0o644); err != nil {
		return nil, err
	}
	exe := "axm"
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	return &cell{
		cli: cli, wantVersion: wantVersion, wantTemplate: wantTemplate, rel: rel,
		work: work, bin: filepath.Join(work, "bin", exe), ws: filepath.Join(work, "workspace"),
		env: append(os.Environ(),
			"HOME="+home, "USERPROFILE="+home,
			"GIT_CONFIG_GLOBAL="+gitConfig, "GIT_CONFIG_NOSYSTEM=1", "GIT_TERMINAL_PROMPT=0",
			"GIT_AUTHOR_NAME=Matrix User", "GIT_AUTHOR_EMAIL=matrix-user@example.invalid",
			"GIT_COMMITTER_NAME=Matrix User", "GIT_COMMITTER_EMAIL=matrix-user@example.invalid",
		),
		timeout: timeout,
	}, nil
}

func (c *cell) run(ctx context.Context) error {
	fmt.Printf("cell: axm %s from %s on template %s, work dir %s\n", c.cli, c.rel.Source, c.rel.Template, c.work)
	old, err := c.fetch(ctx, c.rel.Source)
	if err != nil {
		return fmt.Errorf("old binary: %w", err)
	}
	if err := os.WriteFile(c.bin, old, 0o755); err != nil {
		return err
	}
	if out, err := c.axm(ctx, "", "--version"); err != nil {
		return fmt.Errorf("old binary --version: %w: %s", err, out)
	} else {
		fmt.Printf("old binary: %s", out)
	}
	if err := c.makeWorkspace(ctx); err != nil {
		return fmt.Errorf("workspace: %w", err)
	}
	skillBefore, err := os.ReadFile(filepath.Join(c.ws, userSkill))
	if err != nil {
		return err
	}

	upgradeErr := c.upgrade(ctx)
	failures := []string{}
	fail := func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		fmt.Printf("FAIL %s\n", msg)
		failures = append(failures, msg)
	}
	if upgradeErr != nil {
		fail("axm upgrade: %v", upgradeErr)
	}
	if err := c.checkVersion(ctx); err != nil {
		fail("binary: %v", err)
	}
	if err := c.checkCandidateBinary(ctx); err != nil {
		fail("candidate binary: %v", err)
	}
	if err := c.checkTemplate(ctx); err != nil {
		fail("template: %v", err)
	}
	if err := c.checkUserSkill(ctx, skillBefore); err != nil {
		fail("user-added skill: %v", err)
	}
	if out, err := c.axm(ctx, c.ws, "status"); err != nil {
		fail("axm status: %v: %s", err, out)
	} else if !corpusRow.MatchString(out) {
		fail("axm status reports no installed corpus:\n%s", out)
	} else {
		fmt.Print(out)
	}
	if len(failures) > 0 {
		return fmt.Errorf("%d check(s) failed: %s", len(failures), strings.Join(failures, "; "))
	}
	return nil
}

// fetch returns the executable from base's archive for this platform, verified against base's checksums.txt.
func (c *cell) fetch(ctx context.Context, base string) ([]byte, error) {
	base = strings.TrimRight(base, "/") + "/"
	urls := upgrade.ArchiveURLs{
		Archive:   base + upgrade.ArchiveName(runtime.GOOS, runtime.GOARCH),
		Checksums: base + "checksums.txt",
	}
	bin, err := upgrade.FetchBinary(ctx, nil, urls, "axm", runtime.GOOS, runtime.GOARCH, io.Discard)
	if err == nil {
		fmt.Printf("verified %s against %s\n", urls.Archive, urls.Checksums)
	}
	return bin, err
}

func (c *cell) makeWorkspace(ctx context.Context) error {
	if _, err := c.git(ctx, "", "clone", "--quiet", "--branch", c.rel.Template, "--single-branch", "--", templateRepo, c.ws); err != nil {
		return err
	}
	if _, err := c.git(ctx, c.ws, "remote", "rename", "origin", remoteName); err != nil {
		return err
	}
	for _, sub := range []string{".axiomdata/index", ".axiomdata/files/A", filepath.Dir(userSkill)} {
		if err := os.MkdirAll(filepath.Join(c.ws, sub), 0o755); err != nil {
			return err
		}
	}
	if err := os.WriteFile(filepath.Join(c.ws, userSkill), []byte(userSkillMD), 0o644); err != nil {
		return err
	}
	if _, err := c.git(ctx, c.ws, "add", "--", userSkill); err != nil {
		return err
	}
	_, err := c.git(ctx, c.ws, "commit", "--quiet", "-m", "Add my-notes skill")
	return err
}

func (c *cell) upgrade(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.bin, "upgrade")
	cmd.Dir = c.ws
	cmd.Env = c.env
	// Pipes, not files: on Windows the old binary exits after starting the
	// new one, which inherits these handles, so Wait returns when it exits.
	var out bytes.Buffer
	cmd.Stdout = io.MultiWriter(os.Stdout, &out)
	cmd.Stderr = cmd.Stdout
	cmd.WaitDelay = c.timeout
	fmt.Println("$ axm upgrade")
	err := cmd.Run()
	if errors.Is(err, exec.ErrWaitDelay) {
		return fmt.Errorf("the re-exec child still held stdout %s after the old binary exited", c.timeout)
	}
	return err
}

func (c *cell) checkVersion(ctx context.Context) error {
	out, err := c.axm(ctx, "", "--version")
	if err != nil {
		return fmt.Errorf("--version: %w: %s", err, out)
	}
	if got, want := strings.TrimSpace(out), "axm version "+c.wantVersion; got != want {
		return fmt.Errorf("--version printed %q, want %q", got, want)
	}
	return nil
}

func (c *cell) checkCandidateBinary(ctx context.Context) error {
	want, err := c.fetch(ctx, os.Getenv("AXM_RELEASE_BASE_URL"))
	if err != nil {
		return err
	}
	got, err := os.ReadFile(c.bin)
	if err != nil {
		return err
	}
	if !bytes.Equal(got, want) {
		return errors.New("the installed axm is not the executable in the candidate archive")
	}
	return nil
}

func (c *cell) checkTemplate(ctx context.Context) error {
	version, err := lakefile.ReadVersion(filepath.Join(c.ws, "lakefile.lean"))
	if err != nil {
		return err
	}
	if want := strings.TrimPrefix(c.wantTemplate, "v"); version != want {
		return fmt.Errorf("lakefile.lean version is %q, want %q", version, want)
	}
	tracking := "refs/remotes/" + remoteName + "/" + c.wantTemplate
	local, err := c.git(ctx, c.ws, "rev-parse", "--verify", tracking)
	if err != nil {
		return err
	}
	remote, err := c.git(ctx, c.ws, "ls-remote", "--exit-code", remoteName, "refs/tags/"+c.wantTemplate)
	if err != nil {
		return err
	}
	if fields := strings.Fields(remote); len(fields) == 0 || fields[0] != strings.TrimSpace(local) {
		return fmt.Errorf("%s is %s, but %s on %s is %q", tracking, strings.TrimSpace(local), c.wantTemplate, templateRepo, strings.TrimSpace(remote))
	}
	changed, err := c.git(ctx, c.ws, "diff", "--name-only", "--diff-filter=DM", tracking, "--")
	if err != nil {
		return err
	}
	if changed = strings.TrimSpace(changed); changed != "" {
		return fmt.Errorf("Workspace files differ from or lack %s files:\n%s", c.wantTemplate, changed)
	}
	return nil
}

func (c *cell) checkUserSkill(ctx context.Context, before []byte) error {
	after, err := os.ReadFile(filepath.Join(c.ws, userSkill))
	if err != nil {
		return err
	}
	committed, err := c.git(ctx, c.ws, "show", "HEAD:"+userSkill)
	if err != nil {
		return err
	}
	for name, got := range map[string][]byte{"working tree": after, "HEAD": []byte(committed)} {
		if !bytes.Equal(got, before) {
			return fmt.Errorf("%s copy changed:\n%s", name, got)
		}
	}
	return nil
}

func (c *cell) axm(ctx context.Context, dir string, args ...string) (string, error) {
	return c.command(ctx, dir, c.bin, args...)
}

func (c *cell) git(ctx context.Context, dir string, args ...string) (string, error) {
	return c.command(ctx, dir, "git", args...)
}

func (c *cell) command(ctx context.Context, dir, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = c.env
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return stdout.String(), fmt.Errorf("%s %s: %w: %s", filepath.Base(name), strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

// releasedVersions lists the cells' -cli values in order.
func releasedVersions() []string {
	versions := make([]string, 0, len(releases))
	for v := range releases {
		versions = append(versions, v)
	}
	slices.Sort(versions)
	return versions
}
