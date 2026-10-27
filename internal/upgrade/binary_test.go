package upgrade

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/minio/selfupdate"
)

func TestArchiveExt_Windows(t *testing.T) {
	if got := ArchiveExt("windows"); got != ".zip" {
		t.Fatalf("extension = %q", got)
	}
}
func TestArchiveExt_Unix(t *testing.T) {
	for _, platform := range []string{"linux", "darwin"} {
		if got := ArchiveExt(platform); got != ".tar.gz" {
			t.Fatalf("extension = %q", got)
		}
	}
}
func TestBuildArchiveURLs(t *testing.T) {
	t.Setenv("AXM_RELEASE_BASE_URL", "")
	for _, platform := range []string{"linux", "darwin", "windows"} {
		for _, arch := range []string{"amd64", "arm64"} {
			got := BuildArchiveURLs("BuildCoherence/axiom-reason-ea", "2.0.0", platform, arch)
			base := "https://github.com/BuildCoherence/axiom-reason-ea/releases/download/v2.0.0/"
			want := ArchiveURLs{Archive: base + "axm_" + platform + "_" + arch + ArchiveExt(platform), Checksums: base + "checksums.txt"}
			if got != want {
				t.Fatalf("URLs = %#v, want %#v", got, want)
			}
		}
	}
	// Every version, including zero, selects an immutable tagged release.
	got := BuildArchiveURLs("owner/repo", "0.0.0", "linux", "amd64")
	if !strings.Contains(got.Archive, "/releases/download/v0.0.0/") {
		t.Fatal(got)
	}
}

func makeTarGz(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, content := range entries {
		hdr := &tar.Header{
			Name: name,
			Mode: 0o755,
			Size: int64(len(content)),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("tar header: %v", err)
		}
		if _, err := tw.Write([]byte(content)); err != nil {
			t.Fatalf("tar write: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("gz close: %v", err)
	}
	return buf.Bytes()
}

func makeZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create: %v", err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("zip write: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func TestExtractTarGz_FindsBinaryAtRoot(t *testing.T) {
	archive := makeTarGz(t, map[string]string{
		"axm":     "FAKE_BINARY_BYTES",
		"LICENSE": "MIT",
	})
	got, err := extractTarGz(archive, "axm")
	if err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}
	if string(got) != "FAKE_BINARY_BYTES" {
		t.Fatalf("got %q, want %q", got, "FAKE_BINARY_BYTES")
	}
}

func TestExtractTarGz_NotFound(t *testing.T) {
	archive := makeTarGz(t, map[string]string{"README": "x"})
	_, err := extractTarGz(archive, "axm")
	if err == nil || !strings.Contains(err.Error(), "not found in tar.gz") {
		t.Fatalf("expected not-found error, got %v", err)
	}
}

func TestExtractTarGz_TolerantOfLeadingDirPrefix(t *testing.T) {
	archive := makeTarGz(t, map[string]string{
		"./axm": "WITH_DOT_SLASH",
	})
	got, err := extractTarGz(archive, "axm")
	if err != nil {
		t.Fatalf("extractTarGz tolerant: %v", err)
	}
	if string(got) != "WITH_DOT_SLASH" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractZip_FindsBinaryAtRoot(t *testing.T) {
	archive := makeZip(t, map[string]string{
		"axm.exe": "FAKE_EXE_BYTES",
		"LICENSE": "MIT",
	})
	got, err := extractZip(archive, "axm.exe")
	if err != nil {
		t.Fatalf("extractZip: %v", err)
	}
	if string(got) != "FAKE_EXE_BYTES" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractZip_NotFound(t *testing.T) {
	archive := makeZip(t, map[string]string{"README": "x"})
	_, err := extractZip(archive, "axm.exe")
	if err == nil || !strings.Contains(err.Error(), "not found in zip") {
		t.Fatalf("expected not-found error, got %v", err)
	}
}

func TestExtractBinary_DispatchByOS(t *testing.T) {
	// Linux/darwin → tar.gz path.
	tgz := makeTarGz(t, map[string]string{"axm": "UNIX_BYTES"})
	got, err := extractBinary(tgz, "axm", "linux")
	if err != nil || string(got) != "UNIX_BYTES" {
		t.Fatalf("linux extract: got=%q err=%v", got, err)
	}
	// Windows → zip path, expects .exe suffix.
	zipped := makeZip(t, map[string]string{"axm.exe": "WIN_BYTES"})
	got, err = extractBinary(zipped, "axm", "windows")
	if err != nil || string(got) != "WIN_BYTES" {
		t.Fatalf("windows extract: got=%q err=%v", got, err)
	}
	// Staging binary name — pins that extractBinary uses BinaryName
	// (not archiveProjectName) to locate the inner entry.
	stgTgz := makeTarGz(t, map[string]string{"axm-staging": "STG_BYTES"})
	got, err = extractBinary(stgTgz, "axm-staging", "linux")
	if err != nil || string(got) != "STG_BYTES" {
		t.Fatalf("staging extract: got=%q err=%v", got, err)
	}
}

// makeChecksumsLine returns a sha256sum-style line `<hex>  <name>`.
func makeChecksumsLine(content []byte, name string) string {
	sum := sha256.Sum256(content)
	return fmt.Sprintf("%x  %s", sum, name)
}

func TestVerifyChecksum_Match(t *testing.T) {
	archive := []byte("ARCHIVE_BYTES_HERE")
	line := makeChecksumsLine(archive, "axm_linux_amd64.tar.gz")
	sums := []byte("OTHER  some_other_file\n" + line + "\n")
	if err := verifyChecksum(archive, sums, "linux", "amd64"); err != nil {
		t.Fatalf("verifyChecksum match: %v", err)
	}
}

func TestVerifyChecksum_Mismatch(t *testing.T) {
	archive := []byte("REAL_BYTES")
	// Sum is over different bytes so verification should fail.
	wrong := makeChecksumsLine([]byte("FAKE_BYTES"), "axm_linux_amd64.tar.gz")
	sums := []byte(wrong + "\n")
	err := verifyChecksum(archive, sums, "linux", "amd64")
	if err == nil {
		t.Fatalf("expected mismatch error")
	}
	if !strings.Contains(err.Error(), "sha256=") {
		t.Fatalf("expected sha256= in error, got %v", err)
	}
}

func TestVerifyChecksum_FileNotListed(t *testing.T) {
	archive := []byte("X")
	sums := []byte("abc123  some_other_file\n")
	err := verifyChecksum(archive, sums, "linux", "amd64")
	if err == nil || !strings.Contains(err.Error(), "not listed") {
		t.Fatalf("expected not-listed error, got %v", err)
	}
}

func TestVerifyChecksum_TolerantOfWhitespace(t *testing.T) {
	archive := []byte("BYTES")
	hex := fmt.Sprintf("%x", sha256.Sum256(archive))
	want := "axm_darwin_arm64.tar.gz"
	cases := []string{
		hex + "  " + want, // double-space (sha256sum default)
		hex + " " + want,  // single space
		hex + "\t" + want, // tab
		hex + " *" + want, // binary-mode marker
	}
	for _, line := range cases {
		sums := []byte(line + "\n")
		if err := verifyChecksum(archive, sums, "darwin", "arm64"); err != nil {
			t.Errorf("line %q: %v", line, err)
		}
	}
}

func TestRunBinaryUpgrade_AlreadyCurrent(t *testing.T) {
	// Both versions equal AND not "dev" → short-circuit, no HTTP IO.
	// Passing nil HTTPClient is safe: if the orchestrator wrongly
	// proceeded to network calls it would nil-deref and the test
	// would fail. The fact that this returns cleanly is the assertion.
	opts := Options{
		RunningVersion: "1.6.0",
		TargetVersion:  "1.6.0",
		ReleaseRepo:    "irrelevant",
		BinaryName:     "axm",
		GOOS:           "linux",
		GOARCH:         "amd64",
	}
	res, err := RunBinaryUpgrade(context.Background(), opts)
	if err != nil {
		t.Fatalf("RunBinaryUpgrade: %v", err)
	}
	if !res.AlreadyCurrent {
		t.Fatalf("AlreadyCurrent=false, want true")
	}
	if res.OldVersion != "1.6.0" || res.NewVersion != "1.6.0" {
		t.Fatalf("version fields: %+v", res)
	}
}

func TestRunBinaryUpgrade_InvalidTarget(t *testing.T) {
	for _, target := range []string{"dev", "../../elsewhere", "2.0.0/evil", "v2.0.0"} {
		_, err := RunBinaryUpgrade(context.Background(), Options{RunningVersion: "dev", TargetVersion: target, ReleaseRepo: "owner/repo"})
		if err == nil || !strings.Contains(err.Error(), "valid semver") {
			t.Fatalf("target %q: %v", target, err)
		}
	}
}
func TestRunBinaryUpgrade_EmptyRepo(t *testing.T) {
	_, err := RunBinaryUpgrade(context.Background(), Options{RunningVersion: "1.0.0", TargetVersion: "2.0.0"})
	if err == nil || !strings.Contains(err.Error(), "release repo is empty") {
		t.Fatalf("error = %v", err)
	}
}

func TestRunBinaryUpgrade_DevAlwaysProceeds(t *testing.T) {
	// A dev build never reports AlreadyCurrent, so it reaches target
	// validation even when the target string matches.
	res, err := RunBinaryUpgrade(context.Background(), Options{RunningVersion: "dev", TargetVersion: "dev"})
	if err == nil || !strings.Contains(err.Error(), "not a valid semver") {
		t.Fatalf("error = %v, res = %+v", err, res)
	}
}

func TestBinaryUpgradeProcess(t *testing.T) {
	if os.Getenv("AXM_TEST_BINARY_UPGRADE") != "1" {
		return
	}
	client := newReleaseClient()
	if base := os.Getenv("AXM_TEST_GITHUB_HOST"); base != "" {
		target, _ := url.Parse(base)
		client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
			req = req.Clone(req.Context())
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			return http.DefaultTransport.RoundTrip(req)
		})
	}
	_, err := RunBinaryUpgrade(context.Background(), Options{
		HTTPClient:     client,
		RunningVersion: "1.1.5-beta", TargetVersion: "2.0.0", ReleaseRepo: "owner/repo",
		GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, SkipReExec: true,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(0)
}

func TestRunBinaryUpgrade_DownloadReplaceAndChecksumRefusal(t *testing.T) {
	for _, tc := range []struct{ mismatch, override bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		mismatch := tc.mismatch
		t.Run(fmt.Sprintf("mismatch=%v/override=%v", mismatch, tc.override), func(t *testing.T) {
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(executable)
			if err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(t.TempDir(), "axm"+map[bool]string{true: ".exe"}[runtime.GOOS == "windows"])
			if err := os.WriteFile(target, original, 0700); err != nil {
				t.Fatal(err)
			}
			archiveName := "axm_" + runtime.GOOS + "_" + runtime.GOARCH + ArchiveExt(runtime.GOOS)
			archive := makeTarGz(t, map[string]string{"axm": "new executable"})
			if runtime.GOOS == "windows" {
				archive = makeZip(t, map[string]string{"axm.exe": "new executable"})
			}
			checksum := makeChecksumsLine(archive, archiveName)
			if mismatch {
				checksum = makeChecksumsLine([]byte("corrupt"), archiveName)
			}
			prefix := "/owner/repo/releases/download/v2.0.0"
			if tc.override {
				prefix = ""
			}
			counts := map[string]int{}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				counts[r.URL.Path]++
				if r.Header.Get("Authorization") != "" {
					t.Error("release request sent credentials")
				}
				switch r.URL.Path {
				case prefix + "/" + archiveName:
					_, _ = w.Write(archive)
				case prefix + "/checksums.txt":
					_, _ = w.Write([]byte(checksum))
				default:
					http.NotFound(w, r)
				}
			}))
			defer srv.Close()
			child := exec.Command(target, "-test.run=^TestBinaryUpgradeProcess$")
			base := ""
			if tc.override {
				base = srv.URL
			}
			child.Env = append(os.Environ(), "AXM_TEST_BINARY_UPGRADE=1", "AXM_RELEASE_BASE_URL="+base, "AXM_TEST_GITHUB_HOST="+srv.URL)
			out, err := child.CombinedOutput()
			if mismatch {
				if err == nil || !strings.Contains(string(out), "checksum:") {
					t.Fatalf("expected checksum failure: %v %s", err, out)
				}
			} else if err != nil {
				t.Fatalf("upgrade: %v %s", err, out)
			}
			after, err := os.ReadFile(target)
			if err != nil {
				t.Fatal(err)
			}
			if mismatch && !bytes.Equal(after, original) {
				t.Fatal("checksum failure modified executable")
			}
			if !mismatch && string(after) != "new executable" {
				t.Fatal("replacement did not land")
			}
			if counts[prefix+"/"+archiveName] != 1 || counts[prefix+"/checksums.txt"] != 1 || len(counts) != 2 {
				t.Fatalf("requests = %v", counts)
			}
		})
	}
}

// TestSelfReplace_NewBinaryLandsAtOriginalPath pins the dependency
// assumption the re-exec fix rests on: minio/selfupdate.Apply moves the
// new binary into the SAME path the target occupied before the call,
// and removes the `.<name>.old` file it renamed the prior binary aside
// to. The orchestrator therefore re-execs the path it captured BEFORE
// Apply (where the new binary now lives), never a path resolved after
// the swap.
//
// Regression guard for the reported bug: re-execing os.Executable()
// resolved AFTER Apply pointed at `/.../.<name>.old` — the
// renamed-aside, then-removed prior binary — and failed with ENOENT
// ("reexec: execve .../.<name>.old: no such file or directory").
// If selfupdate ever stopped writing the replacement to the target
// path or stopped removing the `.old` file on Unix, this test would
// fail and the re-exec contract would need revisiting.
//
// Run over both binary names so the coverage is explicit for the
// production (`axm` → `.axm.old`) and staging (`axm-staging` →
// `.axm-staging.old`) installs alike — the re-exec path is shared, so
// the bug and its fix are identical in both environments.
func TestSelfReplace_NewBinaryLandsAtOriginalPath(t *testing.T) {
	for _, binaryName := range []string{"axm", "axm-staging"} {
		t.Run(binaryName, func(t *testing.T) {
			dir := t.TempDir()
			// Mirror the production install layout (~/.local/bin/<name>,
			// a real file, not a symlink — both install scripts do this).
			targetPath := filepath.Join(dir, binaryName)
			if err := os.WriteFile(targetPath, []byte("OLD-BINARY"), 0o755); err != nil {
				t.Fatalf("seeding old binary: %v", err)
			}

			// The orchestrator captures the install path here, BEFORE Apply.
			capturedPath := targetPath

			newBytes := []byte("NEW-BINARY")
			if err := selfupdate.Apply(bytes.NewReader(newBytes), selfupdate.Options{TargetPath: targetPath}); err != nil {
				t.Fatalf("selfupdate.Apply: %v", err)
			}

			// The path captured before the swap now holds the NEW binary —
			// re-execing it runs the replacement, which is the whole point.
			got, err := os.ReadFile(capturedPath)
			if err != nil {
				t.Fatalf("reading captured path after Apply: %v", err)
			}
			if string(got) != string(newBytes) {
				t.Errorf("captured path holds %q after Apply; want the new binary %q", got, newBytes)
			}

			// The `.old` sidecar — what os.Executable() would resolve to if
			// called AFTER the swap — must be gone. A re-exec of it is the
			// reported ENOENT failure.
			oldPath := filepath.Join(dir, "."+binaryName+".old")
			if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
				t.Errorf("expected %s to be removed after Apply; stat err = %v", oldPath, err)
			}
		})
	}
}

func TestRunBinaryUpgrade_EmptyTargetVersion(t *testing.T) {
	opts := Options{
		RunningVersion: "1.5.0",
		TargetVersion:  "",
		ReleaseRepo:    "some-bucket",
		BinaryName:     "axm",
		GOOS:           "linux",
		GOARCH:         "amd64",
	}
	_, err := RunBinaryUpgrade(context.Background(), opts)
	if err == nil || !strings.Contains(err.Error(), "target version is empty") {
		t.Fatalf("expected target version empty error, got %v", err)
	}
}

// TestExtractTarGz_RejectsOversized is the regression for
// coherence-f6cn.3.5: an entry larger than the read cap must be rejected,
// not silently truncated. An entry of exactly the cap still extracts.
func TestExtractTarGz_RejectsOversized(t *testing.T) {
	atLimit := strings.Repeat("x", maxExtractedExecutableBytes)
	over := makeTarGz(t, map[string]string{"axm": atLimit + "x"})
	if _, err := extractTarGz(over, "axm"); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected an over-limit rejection, got %v", err)
	}
	exact := makeTarGz(t, map[string]string{"axm": atLimit})
	got, err := extractTarGz(exact, "axm")
	if err != nil {
		t.Fatalf("exactly-at-limit entry should extract, got %v", err)
	}
	if len(got) != maxExtractedExecutableBytes {
		t.Fatalf("at-limit entry truncated: got %d bytes, want %d", len(got), maxExtractedExecutableBytes)
	}
}

// TestExtractZip_RejectsOversized mirrors the tar.gz over-limit guard for
// the zip path (coherence-f6cn.3.5).
func TestExtractZip_RejectsOversized(t *testing.T) {
	atLimit := strings.Repeat("x", maxExtractedExecutableBytes)
	over := makeZip(t, map[string]string{"axm.exe": atLimit + "x"})
	if _, err := extractZip(over, "axm.exe"); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected an over-limit rejection, got %v", err)
	}
	exact := makeZip(t, map[string]string{"axm.exe": atLimit})
	got, err := extractZip(exact, "axm.exe")
	if err != nil {
		t.Fatalf("exactly-at-limit entry should extract, got %v", err)
	}
	if len(got) != maxExtractedExecutableBytes {
		t.Fatalf("at-limit entry truncated: got %d bytes, want %d", len(got), maxExtractedExecutableBytes)
	}
}
