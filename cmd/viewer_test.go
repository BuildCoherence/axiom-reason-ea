package cmd

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus/corpustest"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
)

const testSiteInstall = "5173e0000000000000000000000000000000000000000000000000000000beef"

// installViewerFixtures installs a corpus and a site archive under home.
func installViewerFixtures(t *testing.T, home string) {
	t.Helper()
	corpustest.Install(t, home, corpustest.Fixture{FrozenAt: fxFrozenAt, Files: []corpustest.File{{ID: "a1b2c3d4", Content: "a\n"}}})
	installViewerSite(t, home)
}

func installViewerSite(t *testing.T, home string) {
	t.Helper()
	dir := filepath.Join(home, ".axiom", upgrade.SiteKind)
	writeTestFile(t, filepath.Join(dir, testSiteInstall, "index.html"), "archive home")
	writeTestFile(t, filepath.Join(dir, testSiteInstall, "f", "a1b2c3d4.html"), "file page")
	writeTestFile(t, filepath.Join(dir, testSiteInstall, "404.html"), "archive 404")
	writeTestFile(t, filepath.Join(dir, testSiteInstall, corpus.MarkerFile), testSiteInstall+"\n")
	writeTestFile(t, filepath.Join(dir, corpus.PointerFile), testSiteInstall+"\n")
}

func exitCode(t *testing.T, err error) int {
	t.Helper()
	var exit *exec.ExitError
	if !errors.As(err, &exit) {
		t.Fatalf("want a non-zero exit, got %v", err)
	}
	return exit.ExitCode()
}

func TestViewerMissingInstallsExitOne(t *testing.T) {
	home := testHome(t)
	_, stderr, err := runAxm(t, commandEnv{home: home}, t.TempDir(), "viewer", "--no-open")
	if exitCode(t, err) != 1 || !strings.Contains(stderr, "run `axm upgrade`") {
		t.Fatalf("no corpus: exit %v, stderr %q", err, stderr)
	}
	corpustest.Install(t, home, corpustest.Fixture{FrozenAt: fxFrozenAt})
	_, stderr, err = runAxm(t, commandEnv{home: home}, t.TempDir(), "viewer", "--no-open")
	if exitCode(t, err) != 1 || !strings.Contains(stderr, "no Axiom site archive is installed; run `axm upgrade`") {
		t.Fatalf("no site: exit %v, stderr %q", err, stderr)
	}
}

func TestViewerPortInUseFailsNamingPort(t *testing.T) {
	home := testHome(t)
	installViewerFixtures(t, home)
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	port := strconv.Itoa(busy.Addr().(*net.TCPAddr).Port)
	_, stderr, err := runAxm(t, commandEnv{home: home}, t.TempDir(), "viewer", "--no-open", "--port", port)
	if exitCode(t, err) == 0 || !strings.Contains(stderr, "port "+port) {
		t.Fatalf("port in use: exit %v, stderr %q", err, stderr)
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// startViewer runs `viewer` in-process from dir until the test ends and returns its base URL.
func startViewer(t *testing.T, dir string, args ...string) (base string, stdout, stderr *bytes.Buffer) {
	t.Helper()
	t.Chdir(dir)
	port := strconv.Itoa(freePort(t))
	c := newViewerCmd()
	stdout, stderr = &bytes.Buffer{}, &bytes.Buffer{}
	c.SetOut(stdout)
	c.SetErr(stderr)
	c.SetArgs(append([]string{"--port", port}, args...))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- c.ExecuteContext(ctx) }()
	base = "http://127.0.0.1:" + port
	deadline := time.Now().Add(10 * time.Second)
	for {
		resp, err := http.Get(base + "/")
		if err == nil {
			resp.Body.Close()
			break
		}
		select {
		case err := <-done:
			t.Fatalf("viewer exited early: %v; stderr %q", err, stderr)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatalf("viewer never served: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Cleanup(func() {
		cancel()
		if err := <-done; err != nil {
			t.Errorf("viewer shutdown: %v", err)
		}
	})
	return base, stdout, stderr
}

func httpGet(t *testing.T, url string) (int, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, string(body)
}

func TestViewerBrowserFailureKeepsServingOutsideWorkspace(t *testing.T) {
	home := testHome(t)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	installViewerFixtures(t, home)
	opened := make(chan string, 1)
	saved := openViewerURL
	openViewerURL = func(url string) error {
		opened <- url
		return errors.New("no opener available")
	}
	t.Cleanup(func() { openViewerURL = saved })

	base, stdout, stderr := startViewer(t, t.TempDir())
	if got := <-opened; got != base+"/" {
		t.Fatalf("opened %q, want %s/", got, base)
	}
	if !strings.Contains(stdout.String(), base+"/") || !strings.Contains(stderr.String(), "open "+base+"/ yourself") {
		t.Fatalf("stdout %q / stderr %q do not print the URL", stdout, stderr)
	}
	if code, body := httpGet(t, base+"/f/a1b2c3d4"); code != http.StatusOK || body != "file page" {
		t.Fatalf("archive page = %d %q", code, body)
	}
	if code, _ := httpGet(t, base+"/local/api/files"); code == http.StatusOK {
		t.Fatal("/local/api/files is 200 outside a Workspace")
	}
}

func TestViewerServesWorkspaceFromSubdirectory(t *testing.T) {
	home := testHome(t)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	installViewerFixtures(t, home)
	ws := t.TempDir()
	writeTestFile(t, filepath.Join(ws, ".axiomdata", "index", "published.json"), "{}")
	writeTestFile(t, filepath.Join(ws, "Workspace", "Mine.lean"), "theorem mine : True := trivial\n")
	opened := make(chan string, 1)
	saved := openViewerURL
	openViewerURL = func(url string) error { opened <- url; return nil }
	t.Cleanup(func() { openViewerURL = saved })

	base, stdout, _ := startViewer(t, filepath.Join(ws, "Workspace"), "--no-open")
	if len(opened) != 0 {
		t.Fatal("--no-open opened a browser")
	}
	if !strings.Contains(stdout.String(), base+"/local") {
		t.Fatalf("stdout %q does not name the Workspace page", stdout)
	}
	if code, body := httpGet(t, base+"/local/api/files"); code != http.StatusOK || body != `{"files":[{"path":"Workspace/Mine.lean"}]}`+"\n" {
		t.Fatalf("files = %d %q", code, body)
	}
	if code, body := httpGet(t, base+"/local/api/file?path=Workspace%2FMine.lean"); code != http.StatusOK || body != "theorem mine : True := trivial\n" {
		t.Fatalf("file = %d %q", code, body)
	}
}
