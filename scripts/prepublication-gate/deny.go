package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

const (
	denyVar = "DENY_PATTERNS"
	// allowlistPath holds developer-ruled corpus/A paths whose deny-list hits are accepted (never rewritten).
	allowlistPath    = "scripts/prepublication-gate/allowlist.txt"
	allowlistPrefix  = "corpus/A/"
	commitLinePrefix = "\x00commit "
)

// gitLogFormat starts each commit with a NUL-led marker no diff or message line can carry.
var gitLogArgs = []string{
	"log", "-p", "--all", "--diff-merges=first-parent", "--no-color", "--no-ext-diff", "--no-textconv",
	"--format=%x00commit %H%nAuthor: %an <%ae>%nCommitter: %cn <%ce>%n%n%B",
}

type denyList struct{ patterns []string }

func parsePatterns(raw string) []string {
	var out []string
	for line := range strings.Lines(raw) {
		p := strings.TrimSpace(line)
		if p == "" || strings.HasPrefix(p, "#") {
			continue
		}
		out = append(out, strings.ToLower(p))
	}
	return out
}

// loadDenyList reads DENY_PATTERNS. Unset or empty fails, except on a fork
// pull_request, which GitHub runs without Actions secrets.
func loadDenyList(env func(string) string) (*denyList, error) {
	if pats := parsePatterns(env(denyVar)); len(pats) > 0 {
		return &denyList{patterns: pats}, nil
	}
	if forkPullRequest(env) {
		return nil, errSkip{reason: denyVar + " unset"}
	}
	return nil, fmt.Errorf("%s is unset or empty; set it to the deny-list, one pattern per line", denyVar)
}

func forkPullRequest(env func(string) string) bool {
	if env("GITHUB_EVENT_NAME") != "pull_request" {
		return false
	}
	data, err := os.ReadFile(env("GITHUB_EVENT_PATH"))
	if err != nil {
		return false
	}
	var event struct {
		PullRequest *struct {
			Head struct {
				Repo *struct {
					FullName string `json:"full_name"`
				} `json:"repo"`
			} `json:"head"`
			Base struct {
				Repo struct {
					FullName string `json:"full_name"`
				} `json:"repo"`
			} `json:"base"`
		} `json:"pull_request"`
	}
	if json.Unmarshal(data, &event) != nil || event.PullRequest == nil {
		return false
	}
	head := event.PullRequest.Head.Repo
	return head == nil || head.FullName != event.PullRequest.Base.Repo.FullName
}

// match returns the 1-based numbers of the patterns found in line.
func (d *denyList) match(line []byte) []int {
	low := bytes.ToLower(line)
	var hits []int
	for i, p := range d.patterns {
		if bytes.Contains(low, []byte(p)) {
			hits = append(hits, i+1)
		}
	}
	return hits
}

func (d *denyList) scanText(leg, location string, data []byte) []finding {
	var out []finding
	n := 0
	for line := range bytes.Lines(data) {
		n++
		for _, i := range d.match(line) {
			out = append(out, finding{leg, location + ":" + strconv.Itoa(n), "pattern#" + strconv.Itoa(i)})
		}
	}
	return out
}

func (g *gate) denyLeg(ctx context.Context) ([]finding, error) {
	d, err := loadDenyList(g.env)
	if err != nil {
		return nil, err
	}
	allow, err := loadAllowlist(g.root)
	if err != nil {
		return nil, err
	}
	files, err := g.treeFiles(ctx)
	if err != nil {
		return nil, err
	}
	var out []finding
	for _, rel := range files {
		if allow[rel] {
			continue
		}
		data, err := os.ReadFile(filepath.Join(g.root, filepath.FromSlash(rel)))
		if err != nil {
			return nil, err
		}
		out = append(out, d.scanText("deny-tree", rel, data)...)
	}
	if isGitRepo(g.root) {
		log, err := g.run(ctx, g.root, "git", gitLogArgs...)
		if err != nil {
			return nil, err
		}
		out = append(out, d.scanHistory(log, allow)...)
	}
	if g.scope != nil {
		for _, item := range g.scope.texts {
			out = append(out, d.scanText("deny-scope", item.label, []byte(item.text))...)
		}
	}
	return out, nil
}

// scanHistory scans `git log -p` output, locating each hit by commit and, inside a diff, by path.
func (d *denyList) scanHistory(log []byte, allow map[string]bool) []finding {
	var out []finding
	commit, path := "", ""
	sc := bufio.NewScanner(bytes.NewReader(log))
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		line := sc.Bytes()
		if rest, ok := bytes.CutPrefix(line, []byte(commitLinePrefix)); ok {
			commit, path = string(rest), ""
			continue
		}
		if rest, ok := bytes.CutPrefix(line, []byte("diff --git a/")); ok {
			if i := bytes.Index(rest, []byte(" b/")); i >= 0 {
				path = string(rest[i+3:])
			}
		}
		if path != "" && allow[path] {
			continue
		}
		loc := commit + " message"
		if path != "" {
			loc = commit + ":" + path
		}
		for _, i := range d.match(line) {
			out = append(out, finding{"deny-history", loc, "pattern#" + strconv.Itoa(i)})
		}
	}
	return out
}

func loadAllowlist(root string) (map[string]bool, error) {
	data, err := os.ReadFile(filepath.Join(root, allowlistPath))
	if os.IsNotExist(err) {
		return map[string]bool{}, nil
	}
	if err != nil {
		return nil, err
	}
	allow := map[string]bool{}
	for line := range strings.Lines(string(data)) {
		p := strings.TrimSpace(line)
		if p == "" || strings.HasPrefix(p, "#") {
			continue
		}
		if !strings.HasPrefix(p, allowlistPrefix) {
			return nil, fmt.Errorf("%s: %q: only %s paths may be allowlisted", allowlistPath, p, allowlistPrefix)
		}
		allow[p] = true
	}
	return allow, nil
}

func isGitRepo(root string) bool {
	_, err := os.Stat(filepath.Join(root, ".git"))
	return err == nil
}

// buildOutputDirs are the viewer's gitignored install and build directories.
var buildOutputDirs = []string{"node_modules", ".next", "out", "test-results", "playwright-report"}

// treeFiles lists the files a publication would carry: tracked and untracked-but-not-ignored
// files in a git work tree, otherwise every file outside .git and build output.
func (g *gate) treeFiles(ctx context.Context) ([]string, error) {
	if isGitRepo(g.root) {
		out, err := g.run(ctx, g.root, "git", "ls-files", "-z", "--cached", "--others", "--exclude-standard")
		if err != nil {
			return nil, err
		}
		var files []string
		for f := range strings.SplitSeq(strings.TrimSuffix(string(out), "\x00"), "\x00") {
			if f == "" {
				continue
			}
			if info, err := os.Lstat(filepath.Join(g.root, filepath.FromSlash(f))); err == nil && info.Mode().IsRegular() {
				files = append(files, f)
			}
		}
		return files, nil
	}
	var files []string
	err := filepath.WalkDir(g.root, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if e.IsDir() && (e.Name() == ".git" || slices.Contains(buildOutputDirs, e.Name())) {
			return filepath.SkipDir
		}
		if e.Type().IsRegular() {
			rel, err := filepath.Rel(g.root, p)
			if err != nil {
				return err
			}
			files = append(files, filepath.ToSlash(rel))
		}
		return nil
	})
	return files, err
}
