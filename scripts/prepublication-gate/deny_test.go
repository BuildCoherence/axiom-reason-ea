package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func eventFile(t *testing.T, head, base string) string {
	t.Helper()
	headRepo := `null`
	if head != "" {
		headRepo = `{"full_name":"` + head + `"}`
	}
	p := filepath.Join(t.TempDir(), "event.json")
	body := `{"pull_request":{"head":{"repo":` + headRepo + `},"base":{"repo":{"full_name":"` + base + `"}}}}`
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDenyUnsetFailsOutsideForkPullRequests(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.txt", "clean\n")
	for name, env := range map[string]map[string]string{
		"unset, no event":     {},
		"empty":               {denyVar: "  \n# only a comment\n"},
		"push":                {"GITHUB_EVENT_NAME": "push"},
		"same-repo PR":        {"GITHUB_EVENT_NAME": "pull_request", "GITHUB_EVENT_PATH": eventFile(t, "o/r", "o/r")},
		"PR, unreadable":      {"GITHUB_EVENT_NAME": "pull_request", "GITHUB_EVENT_PATH": filepath.Join(root, "missing.json")},
		"pull_request_target": {"GITHUB_EVENT_NAME": "pull_request_target", "GITHUB_EVENT_PATH": eventFile(t, "fork/r", "o/r")},
	} {
		t.Run(name, func(t *testing.T) {
			r := runGate(t, env, nil, "-root", root, "-legs", "deny")
			if r.code == exitPass {
				t.Fatalf("exit %d, want non-zero\n%s%s", r.code, r.stdout, r.stderr)
			}
			if !strings.Contains(r.stderr, denyVar) {
				t.Errorf("stderr does not name %s:\n%s", denyVar, r.stderr)
			}
			if strings.Contains(r.stdout, "skipped") {
				t.Errorf("leg skipped on %s:\n%s", name, r.stdout)
			}
		})
	}
}

func TestDenyUnsetSkipsOnForkPullRequest(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.txt", "clean\n")
	for name, event := range map[string]string{
		"fork":         eventFile(t, "someone/axiom-reason-ea", "BuildCoherence/axiom-reason-ea"),
		"deleted fork": eventFile(t, "", "BuildCoherence/axiom-reason-ea"),
	} {
		t.Run(name, func(t *testing.T) {
			env := map[string]string{"GITHUB_EVENT_NAME": "pull_request", "GITHUB_EVENT_PATH": event}
			r := runGate(t, env, nil, "-root", root, "-legs", "deny")
			if r.code != exitPass {
				t.Fatalf("exit %d, want %d\n%s%s", r.code, exitPass, r.stdout, r.stderr)
			}
			if !strings.Contains(r.stdout, "skipped: DENY_PATTERNS unset") {
				t.Errorf("stdout lacks the skip line:\n%s", r.stdout)
			}
		})
	}
}

func TestDenyTreeWithoutGit(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "clean.go", "package x\n")
	writeFile(t, root, "viewer/src/a.ts", "// ok\n// see ZEBRA-LEAK notes\n")
	writeFile(t, root, ".git-not-a-repo/b.txt", "quokka/private\n")
	r := runGate(t, map[string]string{denyVar: testPatterns}, nil, "-root", root, "-legs", "deny")
	if r.code != exitBlock {
		t.Fatalf("exit %d, want %d\n%s%s", r.code, exitBlock, r.stdout, r.stderr)
	}
	r.has(t, "deny-tree viewer/src/a.ts:2 pattern#1")
	r.has(t, "deny-tree .git-not-a-repo/b.txt:1 pattern#2")
	r.noPatternEcho(t)
}

func TestDenyTreeAndHistory(t *testing.T) {
	requireGit(t)
	repo := initRepo(t)
	writeFile(t, repo, "README.md", "clean\n")
	writeFile(t, repo, "old.txt", "line\nmentions zebra-leak here\n")
	first := commitAll(t, repo, "first")
	writeFile(t, repo, "old.txt", "line\n")
	writeFile(t, repo, "corpus/A/aaaa0001.lean", "-- zebra-leak in a ruled corpus file\n")
	writeFile(t, repo, allowlistPath, "# developer ruling\ncorpus/A/aaaa0001.lean\n")
	second := commitAll(t, repo, "scrub, but the message says Quokka/Private")
	writeFile(t, repo, "untracked.txt", "zebra-leak\n")

	r := runGate(t, map[string]string{denyVar: testPatterns}, nil, "-root", repo, "-legs", "deny")
	if r.code != exitBlock {
		t.Fatalf("exit %d, want %d\n%s%s", r.code, exitBlock, r.stdout, r.stderr)
	}
	r.has(t, "deny-tree untracked.txt:1 pattern#1")
	r.has(t, "deny-history "+first+":old.txt pattern#1")
	r.has(t, "deny-history "+second+" message pattern#2")
	if strings.Contains(r.stdout, "corpus/A/aaaa0001.lean") || strings.Contains(r.stdout, "deny-tree old.txt") {
		t.Errorf("allowlisted or clean file reported:\n%s", r.stdout)
	}
	r.noPatternEcho(t)
}

func TestAllowlistAcceptsOnlyCorpusA(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, allowlistPath, "viewer/src/a.ts\n")
	r := runGate(t, map[string]string{denyVar: testPatterns}, nil, "-root", root, "-legs", "deny")
	if r.code != exitError || !strings.Contains(r.stderr, "only corpus/A/ paths") {
		t.Fatalf("exit %d, want %d with an allowlist error\n%s", r.code, exitError, r.stderr)
	}
}
