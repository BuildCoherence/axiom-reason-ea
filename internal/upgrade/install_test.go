package upgrade

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"testing"

	"github.com/klauspost/compress/zstd"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
)

type assetServer struct {
	*httptest.Server
	mu     sync.Mutex
	bodies map[string][]byte
	gets   map[string]int
}

func newAssetServer(t *testing.T) *assetServer {
	t.Helper()
	s := &assetServer{bodies: map[string][]byte{}, gets: map[string]int{}}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.gets[r.URL.Path]++
		body, ok := s.bodies[r.URL.Path]
		s.mu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *assetServer) serve(name string, body []byte) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bodies["/"+name] = body
	return s.URL + "/" + name
}

func (s *assetServer) total() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, c := range s.gets {
		n += c
	}
	return n
}

func tarZst(t *testing.T, files map[string]string) []byte {
	t.Helper()
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	var tarBuf bytes.Buffer
	tw := tar.NewWriter(&tarBuf)
	for _, name := range names {
		if strings.HasSuffix(name, "/") {
			if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeDir, Mode: 0o755}); err != nil {
				t.Fatal(err)
			}
			continue
		}
		body := files[name]
		if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	enc, err := zstd.NewWriter(&out)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := enc.Write(tarBuf.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := enc.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func sumHex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func corpusFiles(version string) map[string]string {
	return map[string]string{
		"corpus.json":    `{"export_id":"` + version + `","frozen_at":"2026-10-01T00:00:00Z","files":[]}`,
		"A/":             "",
		"A/Example.lean": "-- " + version + "\n",
	}
}

// publish serves an archive and returns its asset pin.
func publish(t *testing.T, srv *assetServer, name string, files map[string]string) (UserAsset, []byte) {
	t.Helper()
	archive := tarZst(t, files)
	return UserAsset{Kind: CorpusKind, URL: srv.serve(name, archive), SHA256: sumHex(archive)}, archive
}

func assertActive(t *testing.T, axiomDir string, want UserAsset, version string) {
	t.Helper()
	kindDir := filepath.Join(axiomDir, want.Kind)
	active, err := corpus.ActiveInstall(kindDir)
	if err != nil {
		t.Fatalf("active install: %v", err)
	}
	if active != filepath.Join(kindDir, want.SHA256) {
		t.Fatalf("active install = %s, want %s", active, want.SHA256)
	}
	got, err := os.ReadFile(filepath.Join(active, "A", "Example.lean"))
	if err != nil || string(got) != "-- "+version+"\n" {
		t.Fatalf("installed content = %q, %v; want version %s", got, err, version)
	}
	c, err := corpus.Open(active)
	if err != nil || c.ExportID() != version {
		t.Fatalf("corpus.Open(active) = %v, %v; want export %s", c, err, version)
	}
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

func sameNames(got []string, want ...string) bool {
	sort.Strings(want)
	return strings.Join(got, ",") == strings.Join(want, ",")
}

func TestInstallUserAsset_FreshInstallThenNoOp(t *testing.T) {
	srv := newAssetServer(t)
	axiomDir := t.TempDir()
	asset, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))

	res, err := installUserAsset(context.Background(), srv.Client(), axiomDir, asset)
	if err != nil || !res.Changed || len(res.Warnings) != 0 {
		t.Fatalf("fresh install = %+v, %v", res, err)
	}
	assertActive(t, axiomDir, asset, "a")
	marker, _ := os.ReadFile(filepath.Join(res.Dir, corpus.MarkerFile))
	if strings.TrimSpace(string(marker)) != asset.SHA256 {
		t.Fatalf("marker = %q", marker)
	}
	if got := dirNames(t, filepath.Join(axiomDir, CorpusKind)); !sameNames(got, asset.SHA256, corpus.PointerFile) {
		t.Fatalf("corpus dir = %v; want only the install and the pointer", got)
	}

	res, err = installUserAsset(context.Background(), srv.Client(), axiomDir, asset)
	if err != nil || res.Changed {
		t.Fatalf("second install = %+v, %v; want unchanged", res, err)
	}
	if srv.total() != 1 {
		t.Fatalf("asset GETs = %v; want exactly one across both runs", srv.gets)
	}
}

func TestInstallUserAsset_HashDiffersReinstalls(t *testing.T) {
	srv := newAssetServer(t)
	axiomDir := t.TempDir()
	first, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))
	second, _ := publish(t, srv, "axiom-corpus-b.tar.zst", corpusFiles("b"))
	if _, err := installUserAsset(context.Background(), srv.Client(), axiomDir, first); err != nil {
		t.Fatal(err)
	}
	res, err := installUserAsset(context.Background(), srv.Client(), axiomDir, second)
	if err != nil || !res.Changed {
		t.Fatalf("reinstall = %+v, %v", res, err)
	}
	assertActive(t, axiomDir, second, "b")
	if _, err := os.Stat(filepath.Join(axiomDir, CorpusKind, first.SHA256)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("superseded install still present: %v", err)
	}
	if srv.gets["/axiom-corpus-a.tar.zst"] != 1 || srv.gets["/axiom-corpus-b.tar.zst"] != 1 {
		t.Fatalf("asset GETs = %v", srv.gets)
	}
}

func TestInstallUserAsset_UnmarkedDirectoryIsMissing(t *testing.T) {
	srv := newAssetServer(t)
	axiomDir := t.TempDir()
	asset, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))
	partial := filepath.Join(axiomDir, CorpusKind, asset.SHA256)
	if err := os.MkdirAll(partial, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(partial, "half-written"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(axiomDir, CorpusKind, corpus.PointerFile), []byte(asset.SHA256+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := corpus.ActiveInstall(filepath.Join(axiomDir, CorpusKind)); !errors.Is(err, corpus.ErrNotInstalled) {
		t.Fatalf("reader accepted an unmarked install: %v", err)
	}
	if _, err := installUserAsset(context.Background(), srv.Client(), axiomDir, asset); err != nil {
		t.Fatal(err)
	}
	assertActive(t, axiomDir, asset, "a")
	if _, err := os.Stat(filepath.Join(partial, "half-written")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale partial file survived: %v", err)
	}
	if srv.total() != 1 {
		t.Fatalf("asset GETs = %v", srv.gets)
	}
}

func TestInstallUserAsset_MarkedInstallSwitchesPointerWithoutDownload(t *testing.T) {
	srv := newAssetServer(t)
	axiomDir := t.TempDir()
	first, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))
	second, _ := publish(t, srv, "axiom-corpus-b.tar.zst", corpusFiles("b"))
	ctx := context.Background()
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, second); err != nil {
		t.Fatal(err)
	}
	// Re-point at a fresh install of first, as a run that died after writing
	// second's marker but before switching the pointer would leave it.
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, first); err != nil {
		t.Fatal(err)
	}
	completed := filepath.Join(axiomDir, CorpusKind, second.SHA256)
	if err := os.MkdirAll(filepath.Join(completed, "A"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range corpusFiles("b") {
		if !strings.HasSuffix(name, "/") {
			if err := os.WriteFile(filepath.Join(completed, filepath.FromSlash(name)), []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := os.WriteFile(filepath.Join(completed, corpus.MarkerFile), []byte(second.SHA256+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	before := srv.total()
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, second); err != nil {
		t.Fatal(err)
	}
	assertActive(t, axiomDir, second, "b")
	if srv.total() != before {
		t.Fatalf("a marked install was downloaded again: %v", srv.gets)
	}
}

func TestInstallUserAsset_TruncatedTarballKeepsPriorAndConverges(t *testing.T) {
	srv := newAssetServer(t)
	axiomDir := t.TempDir()
	ctx := context.Background()
	prior, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, prior); err != nil {
		t.Fatal(err)
	}
	next, archive := publish(t, srv, "axiom-corpus-b.tar.zst", corpusFiles("b"))

	srv.serve("axiom-corpus-b.tar.zst", archive[:len(archive)/2])
	_, err := installUserAsset(ctx, srv.Client(), axiomDir, next)
	if err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("truncated download error = %v; want a checksum failure", err)
	}
	assertActive(t, axiomDir, prior, "a")

	// A truncated archive published under its own hash fails extraction instead.
	broken := archive[:len(archive)-8]
	corrupt := UserAsset{Kind: CorpusKind, URL: srv.serve("axiom-corpus-broken.tar.zst", broken), SHA256: sumHex(broken)}
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, corrupt); err == nil || !strings.Contains(err.Error(), "extracting") {
		t.Fatalf("corrupt archive error = %v; want an extraction failure", err)
	}
	assertActive(t, axiomDir, prior, "a")
	if _, err := os.Stat(filepath.Join(axiomDir, CorpusKind, corrupt.SHA256)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed extraction left its directory: %v", err)
	}

	srv.serve("axiom-corpus-b.tar.zst", archive)
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, next); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	assertActive(t, axiomDir, next, "b")
	if got := dirNames(t, filepath.Join(axiomDir, CorpusKind)); !sameNames(got, next.SHA256, corpus.PointerFile) {
		t.Fatalf("corpus dir after convergence = %v", got)
	}
}

func TestInstallUserAsset_ENOSPCKeepsPriorAndNamesPath(t *testing.T) {
	for _, stage := range []string{downloadPrefix, "Example.lean"} {
		t.Run(stage, func(t *testing.T) {
			srv := newAssetServer(t)
			axiomDir := t.TempDir()
			ctx := context.Background()
			prior, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))
			if _, err := installUserAsset(ctx, srv.Client(), axiomDir, prior); err != nil {
				t.Fatal(err)
			}
			next, _ := publish(t, srv, "axiom-corpus-b.tar.zst", corpusFiles("b"))
			var failedPath string
			in := &installer{client: srv.Client(), wrap: func(path string, w io.Writer) io.Writer {
				if !strings.Contains(filepath.Base(path), stage) {
					return w
				}
				failedPath = path
				return failingWriter{path: path}
			}}
			_, err := in.install(ctx, axiomDir, next)
			if err == nil || !errors.Is(err, syscall.ENOSPC) {
				t.Fatalf("error = %v; want ENOSPC", err)
			}
			if failedPath == "" || !strings.Contains(err.Error(), failedPath) {
				t.Fatalf("error %q does not name %q", err, failedPath)
			}
			assertActive(t, axiomDir, prior, "a")

			if _, err := installUserAsset(ctx, srv.Client(), axiomDir, next); err != nil {
				t.Fatalf("rerun: %v", err)
			}
			assertActive(t, axiomDir, next, "b")
		})
	}
}

type failingWriter struct{ path string }

func (f failingWriter) Write([]byte) (int, error) {
	return 0, &fs.PathError{Op: "write", Path: f.path, Err: syscall.ENOSPC}
}

func TestInstallKillHelperProcess(t *testing.T) {
	axiomDir := os.Getenv("AXM_TEST_KILL_INSTALL_DIR")
	if axiomDir == "" {
		return
	}
	asset := UserAsset{Kind: CorpusKind, URL: os.Getenv("AXM_TEST_KILL_INSTALL_URL"), SHA256: os.Getenv("AXM_TEST_KILL_INSTALL_SHA")}
	in := &installer{client: http.DefaultClient, wrap: func(path string, w io.Writer) io.Writer {
		if filepath.Base(path) == "Example.lean" {
			os.Exit(3)
		}
		return w
	}}
	_, _ = in.install(context.Background(), axiomDir, asset)
	os.Exit(0)
}

func TestInstallUserAsset_KillDuringExtractKeepsPriorAndConverges(t *testing.T) {
	srv := newAssetServer(t)
	axiomDir := t.TempDir()
	ctx := context.Background()
	prior, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, prior); err != nil {
		t.Fatal(err)
	}
	next, _ := publish(t, srv, "axiom-corpus-b.tar.zst", corpusFiles("b"))

	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.Command(exe, "-test.run=^TestInstallKillHelperProcess$")
	child.Env = append(os.Environ(), "AXM_TEST_KILL_INSTALL_DIR="+axiomDir, "AXM_TEST_KILL_INSTALL_URL="+next.URL, "AXM_TEST_KILL_INSTALL_SHA="+next.SHA256)
	out, err := child.CombinedOutput()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 3 {
		t.Fatalf("helper did not die mid-extract: %v %s", err, out)
	}
	if _, err := os.Stat(filepath.Join(axiomDir, CorpusKind, next.SHA256, "A")); err != nil {
		t.Fatalf("helper died before extraction began: %v", err)
	}
	assertActive(t, axiomDir, prior, "a")

	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, next); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	assertActive(t, axiomDir, next, "b")
	if got := dirNames(t, filepath.Join(axiomDir, CorpusKind)); !sameNames(got, next.SHA256, corpus.PointerFile) {
		t.Fatalf("leftovers after convergence = %v", got)
	}
}

func TestInstallUserAsset_SupersededRemovalFailureIsNonFatal(t *testing.T) {
	srv := newAssetServer(t)
	axiomDir := t.TempDir()
	ctx := context.Background()
	prior, _ := publish(t, srv, "axiom-corpus-a.tar.zst", corpusFiles("a"))
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, prior); err != nil {
		t.Fatal(err)
	}
	priorDir := filepath.Join(axiomDir, CorpusKind, prior.SHA256)
	var release func()
	if runtime.GOOS == "windows" {
		held, err := os.Open(filepath.Join(priorDir, "A", "Example.lean"))
		if err != nil {
			t.Fatal(err)
		}
		release = func() { _ = held.Close() }
	} else {
		if os.Geteuid() == 0 {
			t.Skip("root ignores directory permissions")
		}
		locked := filepath.Join(priorDir, "A")
		if err := os.Chmod(locked, 0o500); err != nil {
			t.Fatal(err)
		}
		release = func() { _ = os.Chmod(locked, 0o755) }
	}
	t.Cleanup(release)
	next, _ := publish(t, srv, "axiom-corpus-b.tar.zst", corpusFiles("b"))
	res, err := installUserAsset(ctx, srv.Client(), axiomDir, next)
	if err != nil {
		t.Fatalf("install failed on a cleanup error: %v", err)
	}
	if len(res.Warnings) == 0 || !strings.Contains(res.Warnings[0], priorDir) {
		t.Fatalf("warnings = %v; want one naming %s", res.Warnings, priorDir)
	}
	assertActive(t, axiomDir, next, "b")
	if installComplete(priorDir, prior.SHA256) {
		t.Fatal("a partly removed superseded install still carries its completion marker")
	}

	release()
	before := srv.total()
	if _, err := installUserAsset(ctx, srv.Client(), axiomDir, prior); err != nil {
		t.Fatalf("reinstalling the partly removed install: %v", err)
	}
	assertActive(t, axiomDir, prior, "a")
	if srv.total() != before+1 {
		t.Fatalf("partly removed install was not downloaded again: %v", srv.gets)
	}
}

func TestInstallUserAsset_RejectsEscapingEntries(t *testing.T) {
	for _, name := range []string{"../escape.txt", "/abs.txt", ".complete"} {
		t.Run(name, func(t *testing.T) {
			srv := newAssetServer(t)
			root := t.TempDir()
			axiomDir := filepath.Join(root, "home", ".axiom")
			asset, _ := publish(t, srv, "axiom-corpus-x.tar.zst", map[string]string{name: "x"})
			_, err := installUserAsset(context.Background(), srv.Client(), axiomDir, asset)
			if err == nil {
				t.Fatal("install accepted an escaping entry")
			}
			if _, err := os.Stat(filepath.Join(axiomDir, "escape.txt")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("entry escaped: %v", err)
			}
			if _, err := corpus.ActiveInstall(filepath.Join(axiomDir, CorpusKind)); !errors.Is(err, corpus.ErrNotInstalled) {
				t.Fatalf("rejected archive became active: %v", err)
			}
		})
	}
}

func TestInstallUserAsset_RejectsMalformedPin(t *testing.T) {
	_, err := installUserAsset(context.Background(), nil, t.TempDir(), UserAsset{Kind: CorpusKind, URL: "http://127.0.0.1:1/x", SHA256: "ABC"})
	if err == nil || !strings.Contains(err.Error(), "64 lowercase hex") {
		t.Fatalf("error = %v", err)
	}
}
