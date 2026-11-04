package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/transform"
	"github.com/spf13/cobra"
)

// installFakeTransform writes a /bin/sh fake at <tempdir>/fake-axm-transform
// that ignores its stdin and prints `body` verbatim on stdout before
// exiting 0. `body` should be the full NDJSON output the test wants
// Invoke to scan — one Response per line. Returns the binary path so
// the caller can set AXM_TRANSFORM_BIN.
func installFakeTransform(t *testing.T, body string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake binary uses /bin/sh; not portable to windows")
	}
	if strings.Contains(body, "'") {
		t.Fatalf("test bug: fake transform body contains single quote: %q", body)
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "fake-axm-transform")
	script := "#!/bin/sh\ncat > /dev/null\nprintf '%s' '" + body + "'\nexit 0\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return bin
}

// stubLakeOnPATH writes a no-op `lake` shim into a tempdir, prepends
// that dir to PATH, and returns nothing. Required because `axm check`'s
// pre-flight calls transform.CheckLakeInstalledIn which exec's `lake`.
func stubLakeOnPATH(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("lake shim uses /bin/sh; not portable to windows")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "lake"),
		[]byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// initWorkspace creates a workspace skeleton at root with the .axiomdata
// directory and a lean-toolchain file the default flow needs.
func initWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, sub := range []string{".axiomdata", "Workspace"} {
		if err := os.MkdirAll(filepath.Join(root, sub), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "lean-toolchain"),
		[]byte("leanprover/lean4:v4.13.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func installAppendingTransform(t *testing.T, capturePath string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake binary uses /bin/sh; not portable to windows")
	}
	if strings.Contains(capturePath, "'") {
		t.Fatalf("test bug: capture path contains single quote")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "appending-axm-transform")
	script := "#!/bin/sh\n" +
		"req=$(cat)\n" +
		"printf '%s\\n' \"$req\" >> '" + capturePath + "'\n" +
		"path=$(printf '%s' \"$req\" | sed -n 's/.*\"path\":\"\\([^\"]*\\)\".*/\\1/p')\n" +
		"file_id=$(printf '%s' \"$req\" | sed -n 's/.*\"file_id\":\"\\([^\"]*\\)\".*/\\1/p')\n" +
		"printf '{\"path\":\"%s\",\"file_id\":\"%s\",\"content\":\"transformed\",\"depends_on\":[]}\\n' \"$path\" \"$file_id\"\n" +
		"exit 0\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return bin
}

func readCapturedTransformRequests(t *testing.T, capturePath string) []transform.Request {
	t.Helper()
	raw, err := os.ReadFile(capturePath)
	if err != nil {
		t.Fatalf("transform requests were not captured: %v", err)
	}
	var reqs []transform.Request
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var req transform.Request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			t.Fatalf("captured request is not valid JSON: %v\n%s", err, line)
		}
		reqs = append(reqs, req)
	}
	return reqs
}

func keysOf(m map[string]transform.File) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// runCheckCmd runs runCheck with checkCmd's real flag set, capturing stdout and stderr.
func runCheckCmd(t *testing.T, root string, args ...string) (string, string, error) {
	t.Helper()
	t.Chdir(root)
	checkAllFlag = false

	cmd := &cobra.Command{
		Use:          "check",
		SilenceUsage: true,
		RunE:         runCheck,
	}
	cmd.Flags().AddFlagSet(checkCmd.Flags())

	var stdout, stderr bytes.Buffer
	cmd.SetOut(&stdout)
	cmd.SetErr(&stderr)
	cmd.SetArgs(args)
	err := cmd.ExecuteContext(context.Background())
	return stdout.String(), stderr.String(), err
}

func writeUserConfig(t *testing.T, home, username string) {
	t.Helper()
	dir := filepath.Join(home, ".axiom")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"username": username})
	if err := os.WriteFile(filepath.Join(dir, "config.json"), body, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRunCheck_DefaultElaboratesLocallyWithSavedUsername(t *testing.T) {
	forbidHTTP(t)
	stubLakeOnPATH(t)
	root := initWorkspace(t)
	writeUserConfig(t, setTestHome(t), "alice")
	if err := os.WriteFile(filepath.Join(root, "Workspace/A.lean"), []byte("def a : Nat := 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	capture := filepath.Join(t.TempDir(), "requests.ndjson")
	t.Setenv("AXM_TRANSFORM_BIN", installAppendingTransform(t, capture))

	stdout, stderr, err := runCheckCmd(t, root)
	if err != nil {
		t.Fatalf("runCheck err = %v\nstdout=%s\nstderr=%s", err, stdout, stderr)
	}
	if !strings.Contains(stdout, "axm check: OK (1 file(s) elaborated cleanly)") {
		t.Errorf("missing OK summary; stdout=%q", stdout)
	}
	reqs := readCapturedTransformRequests(t, capture)
	if len(reqs) != 1 || !reqs[0].DryRun || reqs[0].Username != "alice" {
		t.Fatalf("transform requests = %+v, want one dry-run request for alice", reqs)
	}
}

func TestRunCheck_UsernameDefaultsToAnonymous(t *testing.T) {
	stubLakeOnPATH(t)
	root := initWorkspace(t)
	setTestHome(t)
	if err := os.WriteFile(filepath.Join(root, "Workspace/A.lean"), []byte("def a : Nat := 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	capture := filepath.Join(t.TempDir(), "requests.ndjson")
	t.Setenv("AXM_TRANSFORM_BIN", installAppendingTransform(t, capture))

	if _, stderr, err := runCheckCmd(t, root, "Workspace/A.lean"); err != nil {
		t.Fatalf("runCheck err = %v\nstderr=%s", err, stderr)
	}
	if reqs := readCapturedTransformRequests(t, capture); len(reqs) != 1 || reqs[0].Username != "anonymous" {
		t.Fatalf("transform requests = %+v, want username anonymous", reqs)
	}
}

func TestRunCheck_CompatibilityFlagsKeepLocalPath(t *testing.T) {
	for _, flag := range []string{"--basic", "--offline"} {
		t.Run(flag, func(t *testing.T) {
			forbidHTTP(t)
			stubLakeOnPATH(t)
			root := initWorkspace(t)
			setTestHome(t)
			if err := os.WriteFile(filepath.Join(root, "Workspace/A.lean"), []byte("def x : Nat := 1\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			t.Setenv("AXM_TRANSFORM_BIN", installFakeTransform(t, `{"path":"Workspace/A.lean","file_id":"FAKE-A"}`+"\n"))

			stdout, stderr, err := runCheckCmd(t, root, flag, "Workspace/A.lean")
			if err != nil {
				t.Fatalf("runCheck %s err = %v\nstdout=%s\nstderr=%s", flag, err, stdout, stderr)
			}
			if !strings.Contains(stdout, "elaborated cleanly") {
				t.Errorf("missing OK summary; stdout=%q", stdout)
			}
		})
	}
}

func TestRunCheck_NothingModifiedExitsZero(t *testing.T) {
	stubLakeOnPATH(t)
	root := initWorkspace(t)
	setTestHome(t)

	stdout, stderr, err := runCheckCmd(t, root)
	if err != nil {
		t.Fatalf("runCheck err = %v\nstderr=%s", err, stderr)
	}
	if !strings.Contains(stdout, "axm check: nothing to check (no modified workspace files).") {
		t.Errorf("stdout = %q, want nothing-to-check message", stdout)
	}
}

func TestRunCheck_MissingElanPrintsRemediation(t *testing.T) {
	root := initWorkspace(t)
	setTestHome(t)
	t.Setenv("PATH", t.TempDir())

	_, stderr, err := runCheckCmd(t, root)
	if err == nil {
		t.Fatal("runCheck without lake succeeded; want an error")
	}
	if !strings.Contains(stderr, "Install elan (the Lean toolchain manager) from https://lean-lang.org/install/") {
		t.Errorf("stderr = %q, want elan install remediation", stderr)
	}
}

// TestRunCheck_BuildsAxiomBeforeElaborating covers a workspace whose init
// warm-up never ran: the fake transform fails as the real one does when
// Axiom.olean is absent, so check passes only if it builds first.
func TestRunCheck_BuildsAxiomBeforeElaborating(t *testing.T) {
	root := initWorkspace(t)
	setTestHome(t)
	marker := filepath.Join(t.TempDir(), "built")
	installWorkspaceLake(t, marker, "0")
	if err := os.WriteFile(filepath.Join(root, "Workspace/A.lean"), []byte("import Axiom\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	installNeedsBuildTransform(t, marker, "Workspace/A.lean", "X", "")

	stdout, stderr, err := runCheckCmd(t, root, "Workspace/A.lean")
	if err != nil {
		t.Fatalf("runCheck err = %v\nstdout=%s\nstderr=%s", err, stdout, stderr)
	}
	if !strings.Contains(stdout, "axm check: OK (1 file(s) elaborated cleanly)") {
		t.Errorf("stdout = %q, want OK summary", stdout)
	}
}

func TestRunCheck_BuildFailureStopsBeforeElaborating(t *testing.T) {
	root := initWorkspace(t)
	setTestHome(t)
	installWorkspaceLake(t, filepath.Join(t.TempDir(), "built"), "1")
	if err := os.WriteFile(filepath.Join(root, "Workspace/A.lean"), []byte("import Axiom\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	capture := filepath.Join(t.TempDir(), "requests.ndjson")
	t.Setenv("AXM_TRANSFORM_BIN", installAppendingTransform(t, capture))

	_, stderr, err := runCheckCmd(t, root, "Workspace/A.lean")
	if err == nil {
		t.Fatal("runCheck succeeded with a failing lake build; want an error")
	}
	if !strings.Contains(stderr, "lake build axm_transform Axiom Env") {
		t.Errorf("stderr = %q, want the lake build remedy", stderr)
	}
	if _, statErr := os.Stat(capture); !os.IsNotExist(statErr) {
		t.Errorf("transform ran after a failed build (capture stat err = %v)", statErr)
	}
}

func TestRunCheck_LocalFailureExitsNonZero(t *testing.T) {
	stubLakeOnPATH(t)
	root := initWorkspace(t)
	setTestHome(t)
	if err := os.WriteFile(filepath.Join(root, "Workspace/Bad.lean"), []byte("theorem bad : 1 = 2 := sorry\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	body := `{"path":"Workspace/Bad.lean","error":"compile","details":{"message":"type mismatch","pos":{"line":1,"col":0}}}` + "\n"
	t.Setenv("AXM_TRANSFORM_BIN", installFakeTransform(t, body))

	_, stderr, err := runCheckCmd(t, root, "Workspace/Bad.lean")
	if err == nil || !strings.Contains(err.Error(), "1 file(s) failed validation") {
		t.Fatalf("err = %v, want 1 file(s) failed validation", err)
	}
	if !strings.Contains(stderr, "type mismatch") {
		t.Errorf("stderr = %q, want the elaboration message", stderr)
	}
}

// TestRunCheck_TransformInvokeError_Surfaced — the transform fake
// emits a per-file failure row AND exits non-zero, so transform.Invoke
// returns both `failed != nil` and `invokeErr != nil`. The runner must
// surface invokeErr's message, not just the count-only summary.
func TestRunCheck_TransformInvokeError_Surfaced(t *testing.T) {
	stubLakeOnPATH(t)
	root := initWorkspace(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	if err := os.WriteFile(filepath.Join(root, "Workspace/A.lean"),
		[]byte("def x : Nat := 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Fake that prints a failure row then exits non-zero — the transform
	// package wraps the exit code into a returned error.
	if runtime.GOOS == "windows" {
		t.Skip("fake binary uses /bin/sh; not portable to windows")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "fake-axm-transform")
	body := `{"path":"Workspace/A.lean","error":"compile","details":{"message":"boom","pos":{"line":1,"col":0}}}`
	script := "#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' '" + body + "'\nexit 7\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AXM_TRANSFORM_BIN", bin)

	stdout, stderr, err := runCheckCmd(t, root, "Workspace/A.lean")
	if err == nil {
		t.Fatalf("expected non-nil error\nstdout=%s\nstderr=%s", stdout, stderr)
	}
	// The summary error still names the count.
	if !strings.Contains(err.Error(), "1 file(s) failed validation") {
		t.Errorf("error = %q, want substring %q", err.Error(), "1 file(s) failed validation")
	}
	// And stderr carries the original invokeErr (exit code 7) so the user
	// can diagnose the underlying transform/lake failure.
	if !strings.Contains(stderr, "exit") {
		t.Errorf("stderr missing transform invokeErr; stderr=%q", stderr)
	}
}

func TestRunCheck_TransformsEachFileInSeparateRequest(t *testing.T) {
	stubLakeOnPATH(t)
	root := initWorkspace(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	write := func(rel, src string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, rel), []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("Workspace/A.lean", "def a : Nat := 1\n")
	write("Workspace/B.lean", "import Workspace.A\n\ndef b : Nat := a\n")

	capture := filepath.Join(t.TempDir(), "requests.ndjson")
	t.Setenv("AXM_TRANSFORM_BIN", installAppendingTransform(t, capture))

	stdout, stderr, err := runCheckCmd(t, root, "Workspace/B.lean")
	if err != nil {
		t.Fatalf("runCheck err = %v\nstdout=%s\nstderr=%s", err, stdout, stderr)
	}
	if !strings.Contains(stdout, "axm check: OK (2 file(s) elaborated cleanly)") {
		t.Errorf("missing OK summary; stdout=%q stderr=%q", stdout, stderr)
	}

	reqs := readCapturedTransformRequests(t, capture)
	if len(reqs) != 2 {
		t.Fatalf("captured %d transform requests, want 2", len(reqs))
	}
	var seen []string
	for _, req := range reqs {
		if !req.DryRun {
			t.Errorf("DryRun = false, want true")
		}
		if len(req.Files) != 1 {
			t.Fatalf("request carried %d files, want exactly 1: %+v", len(req.Files), req)
		}
		seen = append(seen, req.Files[0].Path)
		if got := len(req.Files[0].WorkspaceImportMap); got != 2 {
			t.Errorf("%s workspace_import_map has %d entries, want full closure map of 2", req.Files[0].Path, got)
		}
		if req.Files[0].WorkspaceImportMap["Workspace.A"] == "" || req.Files[0].WorkspaceImportMap["Workspace.B"] == "" {
			t.Errorf("%s workspace_import_map missing closure entries: %+v", req.Files[0].Path, req.Files[0].WorkspaceImportMap)
		}
	}
	if strings.Join(seen, ",") != "Workspace/A.lean,Workspace/B.lean" {
		t.Fatalf("transform request order = %v, want topo order [Workspace/A.lean Workspace/B.lean]", seen)
	}
}

// TestRunCheck_TransitiveOpenIDs_WiredIntoTransformRequest is the #800 seam
// test. The axmindex unit tests prove TransitiveOpenPaths *computes* the
// transitive open set; this proves `axm check` actually *threads* it into the
// transform request. Junction chain Repro_Use -> Repro_Bundle -> Repro_Struct:
// Repro_Use imports only the bundle, but its request must carry Repro_Struct's
// throwaway file_id in transitive_open_ids (so the exe emits `open <struct-id>`
// at the consumer), while the bundle — for which Struct is a *direct* import —
// must not repeat it.
func TestRunCheck_TransitiveOpenIDs_WiredIntoTransformRequest(t *testing.T) {
	stubLakeOnPATH(t)
	root := initWorkspace(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	write := func(rel, src string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, rel), []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("Workspace/Repro_Struct.lean", "structure S : Prop where\n  apply : ∀ p : Prop, p → p\n")
	write("Workspace/Repro_Bundle.lean", "import Workspace.Repro_Struct\n")
	write("Workspace/Repro_Use.lean",
		"import Workspace.Repro_Bundle\n\ntheorem repro (s : S) (p : Prop) (hp : p) : p :=\n  s.apply p hp\n")

	capture := filepath.Join(t.TempDir(), "request.json")
	t.Setenv("AXM_TRANSFORM_BIN", installAppendingTransform(t, capture))

	if _, stderr, err := runCheckCmd(t, root, "Workspace/Repro_Use.lean"); err != nil {
		t.Fatalf("runCheck err = %v\nstderr=%s", err, stderr)
	}

	reqs := readCapturedTransformRequests(t, capture)
	byPath := make(map[string]transform.File, len(reqs))
	for _, req := range reqs {
		if len(req.Files) != 1 {
			t.Fatalf("captured request carried %d files, want exactly 1: %+v", len(req.Files), req)
		}
		byPath[req.Files[0].Path] = req.Files[0]
	}
	structFile, okS := byPath["Workspace/Repro_Struct.lean"]
	bundle, okB := byPath["Workspace/Repro_Bundle.lean"]
	use, okU := byPath["Workspace/Repro_Use.lean"]
	if !okS || !okB || !okU {
		t.Fatalf("request missing one of the chain files; got paths %v", keysOf(byPath))
	}

	// Repro_Use reaches Struct only transitively (through the bundle), so
	// Struct's minted id must be the single entry in Use's transitive_open_ids.
	if got := use.TransitiveOpenIDs; len(got) != 1 || got[0] != structFile.FileID {
		t.Errorf("Repro_Use transitive_open_ids = %v, want [%s] (Struct's id)", got, structFile.FileID)
	}
	// Struct is the bundle's DIRECT import, so it must not also surface as a
	// transitive open on the bundle.
	if len(bundle.TransitiveOpenIDs) != 0 {
		t.Errorf("Repro_Bundle transitive_open_ids = %v, want empty (Struct is a direct import)", bundle.TransitiveOpenIDs)
	}
}
