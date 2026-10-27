package cmd

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
)

// TestNeedsBinaryUpgrade covers the comparator that gates Flow B's
// binary-then-workspace re-exec dance. The interesting cases are the
// boundary conditions: dev builds never get bounced through binary
// replacement; an unparseable version falls through to "no"; equal
// versions skip the binary phase.
func TestNeedsBinaryUpgrade(t *testing.T) {
	cases := []struct {
		name             string
		running, current string
		want             bool
	}{
		{"below floor → true", "1.4.0", "1.6.0", true},
		{"at floor → false", "1.6.0", "1.6.0", false},
		{"above floor → false", "1.7.0", "1.6.0", false},
		{"dev build → false (developer override)", "dev", "1.6.0", false},
		{"empty running → false", "", "1.6.0", false},
		{"empty current → false", "1.4.0", "", false},
		{"unparseable running → false", "garbage", "1.6.0", false},
		{"unparseable current → false", "1.4.0", "garbage", false},
		{"prerelease running below release → true", "1.5.0-rc.1", "1.6.0", true},
		{"prerelease equal → false", "1.6.0-rc.1", "1.6.0-rc.1", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := needsBinaryUpgrade(tc.running, tc.current); got != tc.want {
				t.Errorf("needsBinaryUpgrade(%q, %q) = %v, want %v",
					tc.running, tc.current, got, tc.want)
			}
		})
	}
}

// TestUpgradeCmd_Registered confirms the cobra wiring (`init`) hooked
// the upgrade subcommand to the root tree and that the internal
// --resume-workspace-upgrade flag is hidden from help output.
func TestUpgradeCmd_Registered(t *testing.T) {
	c, _, err := rootCmd.Find([]string{"upgrade"})
	if err != nil {
		t.Fatalf("upgrade command not registered on root: %v", err)
	}
	if c.Use != "upgrade" {
		t.Errorf("Use = %q, want %q", c.Use, "upgrade")
	}
	resumeFlag := c.Flags().Lookup(resumeWorkspaceUpgradeFlag)
	if resumeFlag == nil {
		t.Fatalf("flag --%s not registered", resumeWorkspaceUpgradeFlag)
	}
	if !resumeFlag.Hidden {
		t.Errorf("flag --%s should be hidden", resumeWorkspaceUpgradeFlag)
	}
	yesFlag := c.Flags().Lookup("yes")
	if yesFlag == nil {
		t.Fatalf("flag --yes not registered")
	}
	if yesFlag.Shorthand != "y" {
		t.Errorf("--yes shorthand = %q, want %q", yesFlag.Shorthand, "y")
	}
	help := c.UsageString()
	for _, hidden := range []string{resumeWorkspaceUpgradeFlag, "AXM_RELEASE_BASE_URL"} {
		if strings.Contains(help, hidden) {
			t.Errorf("help exposes %s", hidden)
		}
	}
}

func binaryArchive(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	payload := []byte("replacement")
	if runtime.GOOS == "windows" {
		zw := zip.NewWriter(&buf)
		w, err := zw.Create("axm.exe")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(payload)
		if err := zw.Close(); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: "axm", Mode: 0755, Size: int64(len(payload))}); err != nil {
		t.Fatal(err)
	}
	_, _ = tw.Write(payload)
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestUpgradeCommand_RequestBoundAndFeedFailures(t *testing.T) {
	for _, tc := range []struct {
		name, running string
		status        int
		want          string
		assets        int
	}{
		{"current", "2.0.0", 200, "already up to date", 1},
		{"upgrade", "1.1.5-beta", 200, "upgraded from", 3},
		{"throttle", "2.0.0", 429, "try again later", 0},
		{"missing", "2.0.0", 404, "404", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rel := newReleaseFixture(t)
			rel.setFeedStatus(tc.status)
			asset := "axm_" + runtime.GOOS + "_" + runtime.GOARCH + upgrade.ArchiveExt(runtime.GOOS)
			archive := binaryArchive(t)
			rel.assets[asset] = archive
			rel.assets["checksums.txt"] = []byte(fmt.Sprintf("%x  %s\n", sha256.Sum256(archive), asset))
			env := commandEnv{home: testHome(t), base: rel.srv.URL, running: tc.running}
			stdout, stderr, err := runAxm(t, env, t.TempDir(), "upgrade")
			if (err != nil) != (tc.status != 200) || !strings.Contains(stdout+stderr, tc.want) {
				t.Fatalf("command: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
			}
			counts := rel.takeGets()
			if counts["axm-version.json"] != 1 || len(counts) != 1+tc.assets {
				t.Fatalf("requests = %v", counts)
			}
			for _, count := range counts {
				if count != 1 {
					t.Fatalf("repeated request: %v", counts)
				}
			}
		})
	}
}

func TestUpgradeCommand_CompiledWorkspaceTargetAndLegacyArgv(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprintf("legacy=%v", legacy), func(t *testing.T) {
			repo := makeTaggedInitRepo(t)
			run := func(args ...string) {
				t.Helper()
				command := exec.Command("git", append([]string{"-C", repo}, args...)...)
				if out, err := command.CombinedOutput(); err != nil {
					t.Fatalf("fixture: %v %s", err, out)
				}
			}
			if err := os.MkdirAll(filepath.Join(repo, ".axiomdata"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(repo, "lakefile.lean"), []byte("import Lake\nopen Lake DSL\npackage axiom where\n  version := v!\""+leanClientTag+"\"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			run("add", "lakefile.lean")
			run("commit", "-qm", "template")
			run("remote", "add", "axiom-client", repo)
			rel := newReleaseFixture(t)
			env := commandEnv{home: testHome(t), base: rel.srv.URL, running: "2.0.0"}
			args := []string{"upgrade"}
			if legacy {
				args = append(args, "--resume-workspace-upgrade")
			}
			stdout, stderr, err := runAxm(t, env, repo, args...)
			if err != nil || !strings.Contains(stdout, "Workspace is already up to date at "+leanClientTag) {
				t.Fatalf("workspace: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
			}
			// The resumed process has no feed from its parent, so it reads one for the site.
			if gets := rel.takeGets(); gets["axm-version.json"] != 1 || gets[testSiteAsset] != 1 {
				t.Fatalf("requests = %v; want one feed read and one site download", gets)
			}
			if err := os.WriteFile(filepath.Join(repo, "lakefile.lean"), []byte("dirty"), 0600); err != nil {
				t.Fatal(err)
			}
			stdout, stderr, err = runAxm(t, env, repo, args...)
			if err == nil || !strings.Contains(stderr, "uncommitted changes") {
				t.Fatalf("dirty workspace: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
			}
		})
	}
}

func TestModuleVersion(t *testing.T) {
	for _, tc := range []struct {
		version string
		ok      bool
		want    string
	}{
		{"v2.0.1", true, "2.0.1"}, {"(devel)", true, "dev"}, {"", true, "dev"}, {"", false, "dev"},
	} {
		info := &debug.BuildInfo{Main: debug.Module{Version: tc.version}}
		if got := moduleVersion(info, tc.ok); got != tc.want {
			t.Fatalf("version = %q, want %q", got, tc.want)
		}
	}
}

func TestUpgradeCommand_OfflineFeedExitsNonzero(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	base := srv.URL
	srv.Close()
	stdout, stderr, err := runAxm(t, commandEnv{home: testHome(t), base: base, running: "2.0.0"}, t.TempDir(), "upgrade")
	if err == nil || !strings.Contains(stderr, "GitHub Version Feed") {
		t.Fatalf("offline command: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
	}
}
