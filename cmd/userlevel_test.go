package cmd

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus/corpustest"
)

const (
	testSiteAsset     = "axiom-site-2.0.0.tar.zst"
	testCorpusAsset   = "axiom-corpus-20261001T000000Z.tar.zst"
	commandArgsEnv    = "AXM_TEST_COMMAND_ARGS"
	commandArgsSep    = "\x1f"
	testFrozenAtDate  = "2026-10-01"
	testCorpusFileCnt = 2
)

// releaseFixture serves a GitHub Release's assets at AXM_RELEASE_BASE_URL and counts GETs.
type releaseFixture struct {
	srv        *httptest.Server
	mu         sync.Mutex
	feedStatus int
	feed       string
	assets     map[string][]byte
	gets       map[string]int
	corpusSHA  string
	siteSHA    string
}

func newReleaseFixture(t *testing.T) *releaseFixture {
	t.Helper()
	f := &releaseFixture{feedStatus: http.StatusOK, assets: map[string][]byte{}, gets: map[string]int{}}

	corpusRoot := t.TempDir()
	corpustest.Write(t, corpusRoot, corpustest.Fixture{
		FrozenAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
		Files:    []corpustest.File{{ID: "a1111111", Content: "a\n"}, {ID: "b2222222", Content: "b\n"}},
	})
	corpusArchive := corpustest.TarZst(t, corpusRoot)
	f.corpusSHA = sha256Hex(corpusArchive)
	f.assets[testCorpusAsset] = corpusArchive

	siteRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(siteRoot, "index.html"), []byte("<!doctype html>archive\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	siteArchive := corpustest.TarZst(t, siteRoot)
	f.siteSHA = sha256Hex(siteArchive)
	f.assets[testSiteAsset] = siteArchive
	f.feed = fmt.Sprintf(`{"cli":{"current":"2.0.0"},"lean_client":{"current_tag":"9.9.9"},"site":{"asset":%q,"sha256":%q}}`, testSiteAsset, f.siteSHA)

	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		name := strings.TrimPrefix(r.URL.Path, "/")
		f.gets[name]++
		if name == "axm-version.json" {
			w.WriteHeader(f.feedStatus)
			fmt.Fprint(w, f.feed)
			return
		}
		body, ok := f.assets[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *releaseFixture) setFeedStatus(status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.feedStatus = status
}

// takeGets returns the GET counts since the last call.
func (f *releaseFixture) takeGets() map[string]int {
	f.mu.Lock()
	defer f.mu.Unlock()
	got := f.gets
	f.gets = map[string]int{}
	return got
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func testHome(t *testing.T) string {
	t.Helper()
	return t.TempDir()
}

// commandEnv configures a child axm process; the zero value pins no corpus.
type commandEnv struct {
	home, base, running string
	corpusSHA           string
	extra               []string
}

func TestAxmCommandProcess(t *testing.T) {
	raw := os.Getenv(commandArgsEnv)
	if raw == "" {
		return
	}
	version = os.Getenv("AXM_TEST_RUNNING_VERSION")
	corpusPin.URL = "https://github.com/" + releaseRepo + "/releases/download/v2.0.0/" + testCorpusAsset
	corpusPin.SHA256 = os.Getenv("AXM_TEST_CORPUS_SHA256")
	rootCmd.SetArgs(strings.Split(raw, commandArgsSep))
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

// runAxm runs a copy of the test binary as axm, since a binary upgrade replaces the executable.
func runAxm(t *testing.T, env commandEnv, dir string, args ...string) (stdout, stderr string, err error) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "axm")
	if runtime.GOOS == "windows" {
		target += ".exe"
	}
	if err := os.WriteFile(target, original, 0o700); err != nil {
		t.Fatal(err)
	}
	child := exec.Command(target, "-test.run=^TestAxmCommandProcess$")
	child.Dir = dir
	child.Env = append(os.Environ(),
		commandArgsEnv+"="+strings.Join(args, commandArgsSep),
		"AXM_TEST_RUNNING_VERSION="+env.running,
		"AXM_TEST_CORPUS_SHA256="+env.corpusSHA,
		"AXM_RELEASE_BASE_URL="+env.base,
		"AXIOM_SKIP_PREWARM=1",
		"HOME="+env.home,
		"USERPROFILE="+env.home,
	)
	child.Env = append(child.Env, env.extra...)
	var out, errOut bytes.Buffer
	child.Stdout, child.Stderr = &out, &errOut
	err = child.Run()
	return out.String(), errOut.String(), err
}

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.com"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
}

func writeTestFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func lakefileAt(tag string) string {
	return "import Lake\nopen Lake DSL\npackage axiom where\n  version := v!\"" + tag + "\"\n"
}

// oldTemplateWorkspace returns a Workspace cloned from a mirror at v1.0.0 whose
// v<leanClientTag> rewrites the onboarding skill, plus a committed user skill
// and a stale Claude copy.
func oldTemplateWorkspace(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not available in this test environment")
	}
	mirror := t.TempDir()
	gitIn(t, mirror, "init", "-q")
	writeTestFile(t, filepath.Join(mirror, "lakefile.lean"), lakefileAt("1.0.0"))
	writeTestFile(t, filepath.Join(mirror, ".axiom", "skills", "onboarding", "SKILL.md"), "---\ndescription: start\n---\nhosted instructions\n")
	gitIn(t, mirror, "add", "-A")
	gitIn(t, mirror, "commit", "-qm", "template 1.0.0")
	gitIn(t, mirror, "tag", "v1.0.0")
	writeTestFile(t, filepath.Join(mirror, "lakefile.lean"), lakefileAt(leanClientTag))
	writeTestFile(t, filepath.Join(mirror, ".axiom", "skills", "onboarding", "SKILL.md"), "---\ndescription: start\n---\nlocal instructions\n")
	gitIn(t, mirror, "commit", "-qam", "template "+leanClientTag)
	gitIn(t, mirror, "tag", "v"+leanClientTag)

	ws := filepath.Join(t.TempDir(), "ws")
	gitIn(t, mirror, "clone", "-q", "--branch", "v1.0.0", mirror, ws)
	gitIn(t, ws, "remote", "rename", "origin", "axiom-client")
	gitIn(t, ws, "checkout", "-q", "-b", "main")
	writeTestFile(t, filepath.Join(ws, ".axiom", "skills", "my-notes", "SKILL.md"), "---\ndescription: mine\n---\nmy notes\n")
	gitIn(t, ws, "add", "-A")
	gitIn(t, ws, "commit", "-qm", "my notes")
	if err := os.MkdirAll(filepath.Join(ws, ".axiomdata"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(ws, ".claude", "skills", "onboarding", "SKILL.md"), "stale copy\n")
	return ws
}

func TestUpgradeCommand_GoldenOutputInsideWorkspace(t *testing.T) {
	for _, withAuth := range []bool{true, false} {
		t.Run(fmt.Sprintf("auth=%v", withAuth), func(t *testing.T) {
			rel := newReleaseFixture(t)
			home := testHome(t)
			if withAuth {
				writeTestFile(t, filepath.Join(home, ".axiom", "auth.json"), `{"token":"secret","username":"alice"}`)
			}
			ws := oldTemplateWorkspace(t)
			env := commandEnv{home: home, base: rel.srv.URL, running: "2.0.0", corpusSHA: rel.corpusSHA}
			stdout, stderr, err := runAxm(t, env, ws, "upgrade")
			if err != nil {
				t.Fatalf("upgrade: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
			}
			corpusDir := filepath.Join("~", ".axiom", "corpus", rel.corpusSHA)
			want := "✓ workspace updated to template v" + leanClientTag + " (agent skills rewritten for local use)\n" +
				"Run lake build to rebuild against the new pins.\n" +
				fmt.Sprintf("✓ published corpus: %d files (frozen %s) → %s\n", testCorpusFileCnt, testFrozenAtDate, corpusDir)
			if withAuth {
				want += "✓ removed hosted sign-in token; kept your username \"alice\" for `axm pull`\n"
			}
			want += "  publishing has closed; your files stay local. Browse: axm viewer\n"
			if stdout != want {
				t.Fatalf("stdout:\n%s\nwant:\n%s\nstderr:\n%s", stdout, want, stderr)
			}

			synced, err := os.ReadFile(filepath.Join(ws, ".claude", "skills", "onboarding", "SKILL.md"))
			if err != nil || !strings.Contains(string(synced), "local instructions") {
				t.Fatalf("stale Claude copy not refreshed: %q, %v", synced, err)
			}
			mine, err := os.ReadFile(filepath.Join(ws, ".axiom", "skills", "my-notes", "SKILL.md"))
			if err != nil || !strings.Contains(string(mine), "my notes") {
				t.Fatalf("user-added skill changed: %q, %v", mine, err)
			}
			if copied, err := os.ReadFile(filepath.Join(ws, ".claude", "skills", "my-notes", "SKILL.md")); err != nil || !strings.Contains(string(copied), "my notes") {
				t.Fatalf("user-added skill not synced: %q, %v", copied, err)
			}
			if _, err := os.Stat(filepath.Join(home, ".axiom", "site", rel.siteSHA, "index.html")); err != nil {
				t.Fatalf("site not installed: %v", err)
			}
			if gets := rel.takeGets(); gets[testCorpusAsset] != 1 || gets[testSiteAsset] != 1 || gets["axm-version.json"] != 1 {
				t.Fatalf("GETs = %v", gets)
			}

			stdout, stderr, err = runAxm(t, env, ws, "upgrade")
			if err != nil || !strings.Contains(stdout, "Workspace is already up to date at "+leanClientTag) {
				t.Fatalf("second upgrade: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
			}
			if strings.Contains(stdout, "removed hosted sign-in token") {
				t.Fatalf("second run repeated the token migration:\n%s", stdout)
			}
			if gets := rel.takeGets(); gets[testCorpusAsset] != 0 || gets[testSiteAsset] != 0 {
				t.Fatalf("second run downloaded assets: %v", gets)
			}
		})
	}
}

func TestUpgradeCommand_FeedFailureStillInstallsCorpus(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusTooManyRequests} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			rel := newReleaseFixture(t)
			home := testHome(t)
			env := commandEnv{home: home, base: rel.srv.URL, running: "2.0.0", corpusSHA: rel.corpusSHA}
			rel.setFeedStatus(status)

			stdout, stderr, err := runAxm(t, env, t.TempDir(), "upgrade")
			if err == nil || !strings.Contains(stderr, "GitHub Version Feed") {
				t.Fatalf("feed failure exit: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
			}
			if !strings.Contains(stdout, "✓ published corpus: 2 files") {
				t.Fatalf("corpus not reported after feed failure:\n%s", stdout)
			}
			if gets := rel.takeGets(); gets[testCorpusAsset] != 1 || gets[testSiteAsset] != 0 {
				t.Fatalf("first-run GETs = %v", gets)
			}
			if _, err := os.Stat(filepath.Join(home, ".axiom", "site")); !os.IsNotExist(err) {
				t.Fatalf("site installed without a feed: %v", err)
			}

			rel.setFeedStatus(http.StatusOK)
			stdout, stderr, err = runAxm(t, env, t.TempDir(), "upgrade")
			if err != nil {
				t.Fatalf("retry: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
			}
			if gets := rel.takeGets(); gets[testCorpusAsset] != 0 || gets[testSiteAsset] != 1 {
				t.Fatalf("retry GETs = %v", gets)
			}
			if _, err := os.Stat(filepath.Join(home, ".axiom", "site", rel.siteSHA, "index.html")); err != nil {
				t.Fatalf("site not installed on retry: %v", err)
			}

			if _, _, err := runAxm(t, env, t.TempDir(), "upgrade"); err != nil {
				t.Fatal(err)
			}
			if gets := rel.takeGets(); len(gets) != 1 || gets["axm-version.json"] != 1 {
				t.Fatalf("converged run GETs = %v; want only the feed", gets)
			}
		})
	}
}

func TestInitCommand_ClonesCompiledTagAndInstallsUserAssets(t *testing.T) {
	for _, agent := range []string{"claude", "codex"} {
		t.Run(agent, func(t *testing.T) {
			repo := makeTaggedInitRepo(t)
			rel := newReleaseFixture(t)
			home := testHome(t)
			env := commandEnv{home: home, base: rel.srv.URL, running: "2.0.0", corpusSHA: rel.corpusSHA, extra: []string{
				"GIT_CONFIG_COUNT=1",
				"GIT_CONFIG_KEY_0=url." + repo + ".insteadOf",
				"GIT_CONFIG_VALUE_0=" + initSource,
			}}
			dest := filepath.Join(t.TempDir(), "my-ideas")
			stdout, stderr, err := runAxm(t, env, t.TempDir(), "init", "--agents", agent, dest)
			if err != nil {
				t.Fatalf("init: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
			}
			assertInitContent(t, dest, "active\n")
			remotes, err := exec.Command("git", "-C", dest, "remote").Output()
			if err != nil || strings.TrimSpace(string(remotes)) != "axiom-client" {
				t.Fatalf("remotes = %q, %v", remotes, err)
			}
			probe := map[string]string{"claude": ".claude/skills", "codex": ".agents/skills"}[agent]
			if _, err := os.Stat(filepath.Join(dest, filepath.FromSlash(probe), "demo", "SKILL.md")); err != nil {
				t.Fatalf("%s skills not set up: %v", agent, err)
			}
			for _, kind := range []string{"corpus", "site"} {
				sum := map[string]string{"corpus": rel.corpusSHA, "site": rel.siteSHA}[kind]
				marker, err := os.ReadFile(filepath.Join(home, ".axiom", kind, sum, ".complete"))
				if err != nil || strings.TrimSpace(string(marker)) != sum {
					t.Fatalf("%s not installed: %q, %v", kind, marker, err)
				}
			}
			if !strings.Contains(stdout, "✓ published corpus: 2 files") {
				t.Fatalf("stdout missing corpus line:\n%s", stdout)
			}
		})
	}
}
