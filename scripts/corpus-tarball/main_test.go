package main

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/klauspost/compress/zstd"
)

const (
	fixtureDir      = "testdata/corpus"
	fixtureExportID = "20261101T120000Z"
	// goldenSHA256 is the SHA-256 of the archive of testdata/corpus. It must
	// be the same on every OS; a change here means the asset format changed.
	goldenSHA256 = "75303511c6ecf5dcf9920430f6dc919a36bdc63caa15fc58c773fe9d53359d36"
)

func buildFixture(t *testing.T, corpusDir string) builtAsset {
	t.Helper()
	asset, err := build(corpusDir, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return asset
}

func TestGoldenSHA256(t *testing.T) {
	asset := buildFixture(t, fixtureDir)
	if got, want := filepath.Base(asset.path), "axiom-corpus-"+fixtureExportID+".tar.zst"; got != want {
		t.Errorf("asset name = %q, want %q", got, want)
	}
	if asset.sha256 != goldenSHA256 {
		t.Errorf("sha256 = %s, want golden %s", asset.sha256, goldenSHA256)
	}
	raw, err := os.ReadFile(asset.path)
	if err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256(raw); hex.EncodeToString(sum[:]) != asset.sha256 {
		t.Errorf("reported sha256 %s does not match the written file", asset.sha256)
	}
}

func TestHeadersAreNormalized(t *testing.T) {
	asset := buildFixture(t, fixtureDir)
	var names []string
	readArchive(t, asset.path, func(hdr *tar.Header, _ []byte) {
		names = append(names, hdr.Name)
		if !hdr.ModTime.Equal(time.Unix(0, 0)) || hdr.Uid != 0 || hdr.Gid != 0 || hdr.Uname != "" || hdr.Gname != "" {
			t.Errorf("%s: mtime %v uid %d gid %d uname %q gname %q, want all zero", hdr.Name, hdr.ModTime, hdr.Uid, hdr.Gid, hdr.Uname, hdr.Gname)
		}
		wantMode := int64(fileMode)
		if hdr.Typeflag == tar.TypeDir {
			wantMode = dirMode
		}
		if hdr.Mode != wantMode {
			t.Errorf("%s: mode %o, want %o", hdr.Name, hdr.Mode, wantMode)
		}
	})
	for i := 1; i < len(names); i++ {
		if strings.TrimSuffix(names[i-1], "/") >= strings.TrimSuffix(names[i], "/") {
			t.Errorf("entries not sorted: %q before %q", names[i-1], names[i])
		}
	}
}

func TestContentChangeChangesHash(t *testing.T) {
	dir := copyFixture(t)
	path := filepath.Join(dir, "A", "b2222222.lean")
	if err := os.WriteFile(path, []byte("def b : Nat := 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := buildFixture(t, dir).sha256; got == goldenSHA256 {
		t.Errorf("changing A/b2222222.lean left the hash at %s", got)
	}
}

func TestMetadataChangeKeepsHash(t *testing.T) {
	dir := copyFixture(t)
	stamp := time.Date(2031, 3, 4, 5, 6, 7, 0, time.UTC)
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		mode := fs.FileMode(0o600)
		if d.IsDir() {
			mode = 0o700
		}
		if err := os.Chmod(path, mode); err != nil {
			return err
		}
		stamp = stamp.Add(time.Hour)
		return os.Chtimes(path, stamp, stamp)
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := buildFixture(t, dir).sha256; got != goldenSHA256 {
		t.Errorf("changing only mtimes and modes changed the hash to %s, want %s", got, goldenSHA256)
	}
}

func TestRoundTrip(t *testing.T) {
	asset := buildFixture(t, fixtureDir)
	extracted := t.TempDir()
	readArchive(t, asset.path, func(hdr *tar.Header, content []byte) {
		path := filepath.Join(extracted, filepath.FromSlash(hdr.Name))
		var err error
		switch hdr.Typeflag {
		case tar.TypeDir:
			err = os.MkdirAll(path, 0o755)
		case tar.TypeReg:
			err = os.WriteFile(path, content, 0o644)
		default:
			t.Fatalf("%s: unexpected type %c", hdr.Name, hdr.Typeflag)
		}
		if err != nil {
			t.Fatal(err)
		}
	})
	want, got := snapshotTree(t, fixtureDir), snapshotTree(t, extracted)
	if len(got) != len(want) {
		t.Errorf("extracted %d entries, fixture has %d", len(got), len(want))
	}
	for name, content := range want {
		if gotContent, ok := got[name]; !ok {
			t.Errorf("%s missing after extraction", name)
		} else if gotContent != content {
			t.Errorf("%s differs after extraction", name)
		}
	}
	for name := range got {
		if _, ok := want[name]; !ok {
			t.Errorf("%s extracted but not in the fixture", name)
		}
	}
}

func TestPrintsSHA256AndURL(t *testing.T) {
	out := t.TempDir()
	stdout, stderr, code := runCLI(t, "-corpus", fixtureDir, "-out", out, "-version", "2.0.0")
	if code != 0 {
		t.Fatalf("exit %d, stderr %s", code, stderr)
	}
	name := "axiom-corpus-" + fixtureExportID + ".tar.zst"
	for _, line := range []string{
		"asset=" + filepath.Join(out, name),
		"sha256=" + goldenSHA256,
		"url=https://github.com/BuildCoherence/axiom-reason-ea/releases/download/v2.0.0/" + name,
	} {
		if !strings.Contains(stdout, line+"\n") {
			t.Errorf("stdout %q lacks %q", stdout, line)
		}
	}
}

func TestBridgeTagCheck(t *testing.T) {
	bridgeURL := "https://github.com/BuildCoherence/axiom-reason-ea/releases/download/v2.0.0/axiom-corpus-" + fixtureExportID + ".tar.zst"
	cases := []struct {
		name       string
		tag        string
		sha, url   string
		wantCode   int
		wantStdout string
		wantStderr string
		wantAsset  bool
	}{
		{name: "bridge tag, equal hash", tag: "v2.0.0", sha: goldenSHA256, url: bridgeURL, wantStdout: "bridge=true\n", wantAsset: true},
		{name: "bridge tag, different hash", tag: "v2.0.0", sha: strings.Repeat("ab", 32), url: bridgeURL, wantCode: 1,
			wantStderr: "has SHA-256 " + goldenSHA256 + ", but corpusSHA256"},
		{name: "bridge tag, different asset name", tag: "v2.0.0", sha: goldenSHA256,
			url: "https://github.com/BuildCoherence/axiom-reason-ea/releases/download/v2.0.0/axiom-corpus-20250101T000000Z.tar.zst", wantCode: 1,
			wantStderr: "but corpusURL"},
		{name: "later tag", tag: "v2.0.1", sha: strings.Repeat("ab", 32), url: bridgeURL, wantStdout: "bridge=false\n",
			wantStderr: "v2.0.1 is not the Bridge Release tag"},
		{name: "tag that only prefixes the bridge tag", tag: "v2.0", sha: goldenSHA256, url: bridgeURL, wantStdout: "bridge=false\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := filepath.Join(t.TempDir(), "release.go")
			writeReleaseSource(t, src, tc.sha, tc.url)
			out := t.TempDir()
			stdout, stderr, code := runCLI(t, "-corpus", fixtureDir, "-out", out, "-bridge-tag", tc.tag, "-release-source", src)
			if code != tc.wantCode {
				t.Fatalf("exit %d, want %d; stderr %s", code, tc.wantCode, stderr)
			}
			if !strings.HasPrefix(stdout, tc.wantStdout) {
				t.Errorf("stdout %q, want prefix %q", stdout, tc.wantStdout)
			}
			if !strings.Contains(stderr, tc.wantStderr) {
				t.Errorf("stderr %q lacks %q", stderr, tc.wantStderr)
			}
			if tc.wantCode == 0 {
				_, err := os.Stat(filepath.Join(out, "axiom-corpus-"+fixtureExportID+".tar.zst"))
				if built := err == nil; built != tc.wantAsset {
					t.Errorf("asset built = %v, want %v", built, tc.wantAsset)
				}
			}
		})
	}
}

func TestBridgeCheckRejectsMissingConstant(t *testing.T) {
	src := filepath.Join(t.TempDir(), "release.go")
	if err := os.WriteFile(src, []byte("package cmd\n\nconst corpusURL = \"x\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, stderr, code := runCLI(t, "-corpus", fixtureDir, "-out", t.TempDir(), "-bridge-tag", "v2.0.0", "-release-source", src)
	if code == 0 || !strings.Contains(stderr, "missing string constant(s) corpusSHA256") {
		t.Errorf("exit %d stderr %q, want a failure naming corpusSHA256", code, stderr)
	}
}

func TestRejectsSymlink(t *testing.T) {
	dir := copyFixture(t)
	if err := os.Symlink("corpus.json", filepath.Join(dir, "link.json")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := build(dir, t.TempDir()); err == nil || !strings.Contains(err.Error(), "only regular files and directories") {
		t.Errorf("build with a symlink: err = %v", err)
	}
}

func runCLI(t *testing.T, args ...string) (string, string, int) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := run(args, &stdout, &stderr)
	return stdout.String(), stderr.String(), code
}

func writeReleaseSource(t *testing.T, path, sha, url string) {
	t.Helper()
	src := "package cmd\n\nconst (\n\tcorpusExportID = \"" + fixtureExportID + "\"\n\tcorpusSHA256   = \"" + sha + "\"\n\tcorpusURL      = \"" + url + "\"\n)\n"
	if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readArchive(t *testing.T, path string, visit func(*tar.Header, []byte)) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	dec, err := zstd.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	defer dec.Close()
	tr := tar.NewReader(dec)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(tr)
		if err != nil {
			t.Fatal(err)
		}
		visit(hdr, content)
	}
}

// snapshotTree maps each slash-separated path under root to its content;
// directories map to "/".
func snapshotTree(t *testing.T, root string) map[string]string {
	t.Helper()
	tree := map[string]string{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || path == root {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if d.IsDir() {
			tree[filepath.ToSlash(rel)] = "/"
			return nil
		}
		content, err := os.ReadFile(path)
		tree[filepath.ToSlash(rel)] = string(content)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return tree
}

func copyFixture(t *testing.T) string {
	t.Helper()
	dst := t.TempDir()
	for name, content := range snapshotTree(t, fixtureDir) {
		path := filepath.Join(dst, filepath.FromSlash(name))
		var err error
		if content == "/" {
			err = os.MkdirAll(path, 0o755)
		} else if err = os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
			err = os.WriteFile(path, []byte(content), 0o644)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	return dst
}
