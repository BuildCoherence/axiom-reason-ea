package viewer

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

const testPort = 4321

var testHost = "127.0.0.1:" + strconv.Itoa(testPort)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func siteFixture(t *testing.T) string {
	t.Helper()
	site := t.TempDir()
	writeFile(t, filepath.Join(site, "index.html"), "home")
	writeFile(t, filepath.Join(site, "404.html"), "archive 404 page")
	writeFile(t, filepath.Join(site, "local.html"), "local page")
	writeFile(t, filepath.Join(site, "f", "a1b2c3d4.html"), "file page")
	writeFile(t, filepath.Join(site, "f", "a1b2c3d4.txt"), "rsc payload")
	writeFile(t, filepath.Join(site, "data", "search-index.json"), `{"constants":[]}`)
	return site
}

// workspaceFixture returns a Workspace root and a secret file beside it.
func workspaceFixture(t *testing.T) (root, secret string) {
	t.Helper()
	parent := t.TempDir()
	root = filepath.Join(parent, "ws")
	writeFile(t, filepath.Join(root, ".axiomdata", "index", "published.json"), "{}")
	writeFile(t, filepath.Join(root, ".lake", "packages", "Dep.lean"), "dep")
	writeFile(t, filepath.Join(root, "Axioms.lean"), "import Axiom\n")
	writeFile(t, filepath.Join(root, "Workspace", "MyIdeas.lean"), "axiom local_claim : True\n")
	writeFile(t, filepath.Join(root, "Workspace", "notes.md"), "not lean")
	secret = filepath.Join(parent, "secret.lean")
	writeFile(t, secret, "SECRET")
	return root, secret
}

func newTestHandler(t *testing.T, site, workspace string) *Handler {
	t.Helper()
	h, err := NewHandler(site, workspace, testPort)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Close() })
	return h
}

func get(t *testing.T, h http.Handler, host, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "http://"+host+target, nil)
	req.Host = host
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func fileQuery(p string) string { return fileAPIPath + "?path=" + url.QueryEscape(p) }

func TestSiteResolution(t *testing.T) {
	h := newTestHandler(t, siteFixture(t), "")
	cases := []struct {
		target string
		status int
		body   string
	}{
		{"/", 200, "home"},
		{"/f/a1b2c3d4", 200, "file page"},
		{"/f/a1b2c3d4.html", 200, "file page"},
		{"/f/a1b2c3d4.txt", 200, "rsc payload"},
		{"/local", 200, "local page"},
		{"/data/search-index.json", 200, `{"constants":[]}`},
		{"/f/ffffffff.txt", 404, "archive 404 page"},
		{"/f/ffffffff", 404, "archive 404 page"},
		{"/no/such/page", 404, "archive 404 page"},
		{"/f", 404, "archive 404 page"},
		{"/../../etc/passwd", 404, "archive 404 page"},
	}
	for _, c := range cases {
		rec := get(t, h, testHost, c.target)
		if rec.Code != c.status || rec.Body.String() != c.body {
			t.Errorf("GET %s = %d %q, want %d %q", c.target, rec.Code, rec.Body.String(), c.status, c.body)
		}
	}
	if ct := get(t, h, testHost, "/f/a1b2c3d4").Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("/f/<id> Content-Type = %q, want text/html", ct)
	}
	if ct := get(t, h, testHost, "/f/nope").Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("404 page Content-Type = %q, want text/html", ct)
	}
}

func TestHostAllowlist(t *testing.T) {
	h := newTestHandler(t, siteFixture(t), "")
	port := strconv.Itoa(testPort)
	for host, want := range map[string]int{
		"127.0.0.1:" + port:    http.StatusOK,
		"localhost:" + port:    http.StatusOK,
		"LOCALHOST:" + port:    http.StatusOK,
		"evil.example:" + port: http.StatusForbidden,
		"evil.example":         http.StatusForbidden,
		"127.0.0.1:1":          http.StatusForbidden,
		"localhost":            http.StatusForbidden,
		"[::1]:" + port:        http.StatusForbidden,
	} {
		if got := get(t, h, host, "/").Code; got != want {
			t.Errorf("Host %q: status %d, want %d", host, got, want)
		}
	}
}

func TestRejectsWrites(t *testing.T) {
	h := newTestHandler(t, siteFixture(t), "")
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Host = testHost
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST / = %d, want 405", rec.Code)
	}
}

func TestListenIsLoopbackOnly(t *testing.T) {
	ln, err := Listen(0)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	addr := ln.Addr().(*net.TCPAddr)
	if !addr.IP.Equal(net.ParseIP(LoopbackHost)) || addr.Port == 0 {
		t.Fatalf("listener address %v, want %s with a free port", addr, LoopbackHost)
	}
	if _, err := Listen(addr.Port); err == nil || !strings.Contains(err.Error(), strconv.Itoa(addr.Port)) {
		t.Fatalf("Listen on a port in use: err %v, want an error naming port %d", err, addr.Port)
	}
}

func TestWorkspaceFileList(t *testing.T) {
	root, _ := workspaceFixture(t)
	h := newTestHandler(t, siteFixture(t), root)
	rec := get(t, h, testHost, filesAPIPath)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s = %d", filesAPIPath, rec.Code)
	}
	var body struct {
		Files []workspaceFile `json:"files"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	want := []workspaceFile{{"Axioms.lean"}, {"Workspace/MyIdeas.lean"}}
	if !reflect.DeepEqual(body.Files, want) {
		t.Fatalf("files = %v, want %v", body.Files, want)
	}
}

func TestEmptyWorkspaceListsNoFiles(t *testing.T) {
	h := newTestHandler(t, siteFixture(t), t.TempDir())
	rec := get(t, h, testHost, filesAPIPath)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"files":[]}` {
		t.Fatalf("GET %s = %d %s", filesAPIPath, rec.Code, rec.Body.String())
	}
}

func TestWorkspaceFileRead(t *testing.T) {
	root, _ := workspaceFixture(t)
	h := newTestHandler(t, siteFixture(t), root)
	rec := get(t, h, testHost, fileQuery("Workspace/MyIdeas.lean"))
	if rec.Code != http.StatusOK || rec.Body.String() != "axiom local_claim : True\n" {
		t.Fatalf("read = %d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/plain; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	for _, p := range []string{"", "Workspace", "Workspace/missing.lean"} {
		if rec := get(t, h, testHost, fileQuery(p)); rec.Code != http.StatusNotFound {
			t.Errorf("path %q: status %d, want 404", p, rec.Code)
		}
	}
}

func TestOutsideWorkspaceHasNoLocalAPI(t *testing.T) {
	h := newTestHandler(t, siteFixture(t), "")
	for _, target := range []string{filesAPIPath, fileQuery("Axioms.lean")} {
		if rec := get(t, h, testHost, target); rec.Code == http.StatusOK {
			t.Errorf("GET %s = 200 outside a Workspace", target)
		}
	}
	if rec := get(t, h, testHost, "/f/a1b2c3d4"); rec.Code != http.StatusOK {
		t.Errorf("archive page = %d outside a Workspace", rec.Code)
	}
}

// assertEscapeRejected checks that p, which names secret from inside the Workspace, is not served.
func assertEscapeRejected(t *testing.T, h http.Handler, p string) {
	t.Helper()
	rec := get(t, h, testHost, fileQuery(p))
	if rec.Code == http.StatusOK || strings.Contains(rec.Body.String(), "SECRET") {
		t.Errorf("path %q escaped the Workspace: %d %q", p, rec.Code, rec.Body.String())
	}
}

func TestWorkspaceConfinement(t *testing.T) {
	root, secret := workspaceFixture(t)
	if err := os.Symlink(secret, filepath.Join(root, "Workspace", "link.lean")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(secret), filepath.Join(root, "Workspace", "out")); err != nil {
		t.Fatal(err)
	}
	h := newTestHandler(t, siteFixture(t), root)
	for _, p := range []string{
		"../secret.lean",
		"Workspace/../../secret.lean",
		filepath.ToSlash(secret),
		secret,
		"Workspace/link.lean",
		"Workspace/out/secret.lean",
	} {
		assertEscapeRejected(t, h, p)
	}
	if rec := get(t, h, testHost, fileQuery("Workspace/../Axioms.lean")); rec.Code != http.StatusOK {
		t.Errorf("an in-root `..` path = %d, want 200", rec.Code)
	}
	if body := get(t, h, testHost, filesAPIPath).Body.String(); strings.Contains(body, "link.lean") || strings.Contains(body, "secret") {
		t.Errorf("file list includes an escaping link: %s", body)
	}
}
