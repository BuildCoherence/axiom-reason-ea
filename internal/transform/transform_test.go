package transform

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// syncBuf is a thread-safe wrapper around bytes.Buffer. exec.Cmd.Stderr
// gets concurrently written to by the os/exec goroutine *and* by our
// scanner-loop's Fprintf, and bytes.Buffer is not concurrent-safe; using
// a plain *bytes.Buffer here causes lost writes (and post-Wait reads
// can read garbled state). Used by TestInvokeLeanSpecErrorShape.
type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuf) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// TestMain compiles a small "fake axm_transform" helper binary once and
// drops its path in an env var so individual tests can point the library
// at it via AXM_TRANSFORM_BIN.
func TestMain(m *testing.M) {
	// Re-entry mode: when invoked with AXM_TRANSFORM_FAKE=<mode>, run the
	// fake-transform logic instead of the test binary.
	if mode := os.Getenv("AXM_TRANSFORM_FAKE"); mode != "" {
		runFake(mode)
		return
	}
	os.Exit(m.Run())
}

// fakeBinPath returns the path of the currently-running test binary, which
// (via AXM_TRANSFORM_FAKE) will masquerade as `axm_transform`.
func fakeBinPath(t *testing.T) string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" && filepath.Ext(exe) != ".exe" {
		exe += ".exe"
	}
	return exe
}

// runFake implements the helper-subprocess: read JSON from stdin, emit
// canned NDJSON on stdout, optionally fail depending on mode.
func runFake(mode string) {
	switch mode {
	case "echo":
		// Read the request, emit one success Response per file.
		var req Request
		if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
			os.Exit(2)
		}
		enc := json.NewEncoder(os.Stdout)
		for _, f := range req.Files {
			_ = enc.Encode(Response{
				Path:      f.Path,
				FileID:    f.FileID,
				Content:   "ok: " + f.Source,
				DependsOn: []string{},
			})
		}
		os.Exit(0)
	case "partial_then_fail":
		// Emit one success and one error in the spec wire format
		// (axm-transform.md §4), then exit nonzero with some
		// unread stdin remaining to verify partial results propagate.
		// JSON is hand-written rather than encoded via the Go struct so
		// the fake's contract is the spec, not whatever shape the Go
		// types currently have.
		var req Request
		_ = json.NewDecoder(os.Stdin).Decode(&req)
		if len(req.Files) > 0 {
			f := req.Files[0]
			_, _ = os.Stdout.WriteString(`{"path":"` + f.Path + `","file_id":"` + f.FileID + `","content":"ok","depends_on":[]}` + "\n")
		}
		if len(req.Files) > 1 {
			f := req.Files[1]
			_, _ = os.Stdout.WriteString(`{"path":"` + f.Path + `","error":"compile","details":{"message":"bad","pos":{"line":1,"col":0}}}` + "\n")
		}
		os.Exit(3)
	case "hang":
		// Block forever, reading stdin to completion then sleeping, so
		// the test can exercise ctx cancellation.
		_, _ = bufio.NewReader(os.Stdin).ReadString(0)
		time.Sleep(1 * time.Hour)
		os.Exit(0)
	case "stderr_passthrough":
		_, _ = os.Stderr.WriteString("lake-stderr-line\n")
		var req Request
		_ = json.NewDecoder(os.Stdin).Decode(&req)
		os.Exit(0)
	case "lean_spec_error":
		// Emit one success line followed by a per-file error line in the
		// shape mandated by axm-transform.md §4: top-level string
		// `error` with sibling object `details`. This is what the real
		// `lake exe axm_transform` writes — see
		// axiom/lean-lib/test/axm_transform/rule_violation_multiple_axioms/stdout.golden.
		var req Request
		_ = json.NewDecoder(os.Stdin).Decode(&req)
		// First file: success.
		if len(req.Files) > 0 {
			f := req.Files[0]
			_, _ = os.Stdout.WriteString(`{"path":"` + f.Path + `","file_id":"` + f.FileID + `","content":"ok","depends_on":[]}` + "\n")
		}
		// Second file: spec-shaped error line, byte-for-byte matching
		// the lean-lib golden.
		if len(req.Files) > 1 {
			f := req.Files[1]
			_, _ = os.Stdout.WriteString(`{"details":{"message":"multiple user_axioms blocks found in Axioms.lean","pos":{"col":0,"line":7},"rule":"multiple_axiom_blocks"},"error":"rule_violation","path":"` + f.Path + `"}` + "\n")
		}
		os.Exit(1)
	default:
		os.Exit(99)
	}
}

// withFake returns an env var setting chain that points Invoke at our
// re-entry binary in the given mode.
func withFake(t *testing.T, mode string) func() {
	t.Helper()
	t.Setenv("AXM_TRANSFORM_BIN", fakeBinPath(t))
	// Ensure the child process runs in "fake" mode.
	prev, had := os.LookupEnv("AXM_TRANSFORM_FAKE")
	if err := os.Setenv("AXM_TRANSFORM_FAKE", mode); err != nil {
		t.Fatal(err)
	}
	return func() {
		if had {
			_ = os.Setenv("AXM_TRANSFORM_FAKE", prev)
		} else {
			_ = os.Unsetenv("AXM_TRANSFORM_FAKE")
		}
	}
}

func TestInvokeEchoSuccess(t *testing.T) {
	restore := withFake(t, "echo")
	defer restore()

	ctx := context.Background()
	req := Request{
		ServerTime: time.Now().UTC().Unix(),
		Username:   "alice",
		Files: []File{
			{Path: "Workspace/A.lean", Source: "a", FileID: "u-a"},
			{Path: "Workspace/B.lean", Source: "b", FileID: "u-b"},
		},
	}
	res, err := Invoke(ctx, t.TempDir(), req, nil)
	if err != nil {
		t.Fatalf("Invoke err = %v", err)
	}
	if len(res) != 2 {
		t.Fatalf("len(res) = %d, want 2", len(res))
	}
	if res[0].Path != "Workspace/A.lean" || res[0].Content != "ok: a" {
		t.Fatalf("res[0] = %+v", res[0])
	}
	if res[1].FileID != "u-b" {
		t.Fatalf("res[1].FileID = %q, want u-b", res[1].FileID)
	}
}

func TestInvokePartialThenFail(t *testing.T) {
	restore := withFake(t, "partial_then_fail")
	defer restore()

	ctx := context.Background()
	req := Request{
		Files: []File{
			{Path: "A.lean", FileID: "u-a", Source: "a"},
			{Path: "B.lean", FileID: "u-b", Source: "b"},
		},
	}
	res, err := Invoke(ctx, t.TempDir(), req, nil)
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if len(res) != 2 {
		t.Fatalf("len(res) = %d, want 2 (partial scanned)", len(res))
	}
	if !strings.Contains(err.Error(), "B.lean") {
		t.Fatalf("err = %v, should name first failing path B.lean", err)
	}
	// The exit-code error should be wrapped, retrievable via errors.As.
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("err does not wrap *exec.ExitError: %v", err)
	}
}

// TestInvokeLeanSpecErrorShape is a regression test for bug #327. The
// real `lake exe axm_transform` emits per-file errors in the shape
// documented at the internal axm-transform doc §4:
//
//	{"path":"...","error":"rule_violation","details":{"rule":"...","message":"...","pos":{"line":N,"col":M}}}
//
// i.e. `error` is a string and `details` is a sibling object. The Go
// scanner used to model `error` as a nested object, so it failed to
// unmarshal every real per-file error line, dumped the raw NDJSON to
// stderr, and dropped the failure on the floor — meaning
// printTransformErrors / printCheckErrors saw an empty failure set and
// the "subprocess failed at <path>" fallback named the wrong file.
//
// This test asserts the observable behavior at the scanner layer:
//   - The spec-shaped error line lands in results[i].Error (kind /
//     message / details all populated).
//   - The wrap error names the actually-failing path (B.lean), not the
//     last-scanned path.
//   - The raw NDJSON is NOT echoed to stderr with the `axm transform: `
//     prefix used for unknown-shape stdout.
func TestInvokeLeanSpecErrorShape(t *testing.T) {
	restore := withFake(t, "lean_spec_error")
	defer restore()

	ctx := context.Background()
	req := Request{
		Files: []File{
			{Path: "Workspace/A.lean", FileID: "u-a", Source: "a"},
			{Path: "Axioms.lean", FileID: "u-ax", Source: "x"},
		},
	}
	stderr := &syncBuf{}
	res, err := Invoke(ctx, t.TempDir(), req, stderr)

	// The fake exits 1, so Invoke must return a non-nil error.
	if err == nil {
		t.Fatal("want error from non-zero exit, got nil")
	}

	// Both lines should have been scanned into results.
	if len(res) != 2 {
		t.Fatalf("len(res) = %d (results=%+v), want 2 (one success + one spec-shaped error); stderr=%q; err=%v", len(res), res, stderr.String(), err)
	}

	// First entry: success on Workspace/A.lean.
	if res[0].Path != "Workspace/A.lean" || res[0].Error != "" {
		t.Errorf("res[0] = %+v, want success on Workspace/A.lean", res[0])
	}

	// Second entry: spec-shaped error on Axioms.lean. This is the
	// load-bearing assertion — current code drops this line.
	got := res[1]
	if got.Path != "Axioms.lean" {
		t.Errorf("res[1].Path = %q, want Axioms.lean", got.Path)
	}
	if got.Error == "" {
		t.Fatalf("res[1].Error is empty; spec-shaped error line was dropped. stderr captured by Invoke:\n%s", stderr.String())
	}
	if got.Error != "rule_violation" {
		t.Errorf("res[1].Error = %q, want %q", got.Error, "rule_violation")
	}
	if got.Details == nil {
		t.Fatalf("res[1].Details is nil; spec-shaped details object was dropped")
	}
	if !strings.Contains(got.Details.Message, "multiple user_axioms blocks") {
		t.Errorf("res[1].Details.Message = %q, want it to mention 'multiple user_axioms blocks'", got.Details.Message)
	}
	if got.Details.Rule != "multiple_axiom_blocks" {
		t.Errorf("res[1].Details.Rule = %q, want multiple_axiom_blocks", got.Details.Rule)
	}
	if got.Details.Pos == nil {
		t.Errorf("res[1].Details.Pos is nil; want non-nil with line=7, col=0")
	} else {
		if got.Details.Pos.Line != 7 {
			t.Errorf("res[1].Details.Pos.Line = %d, want 7", got.Details.Pos.Line)
		}
		if got.Details.Pos.Col != 0 {
			t.Errorf("res[1].Details.Pos.Col = %d, want 0", got.Details.Pos.Col)
		}
	}

	// The wrap error should name the actually-failing path, not a
	// sibling that succeeded.
	if !strings.Contains(err.Error(), "Axioms.lean") {
		t.Errorf("err = %v, should name failing path Axioms.lean", err)
	}
	if strings.Contains(err.Error(), "Workspace/A.lean") {
		t.Errorf("err = %v, should NOT name sibling Workspace/A.lean (it succeeded)", err)
	}

	// Sanity: the raw NDJSON must not have been echoed as an
	// "unknown shape" stdout line. Today's bug surfaces here too.
	if strings.Contains(stderr.String(), "axm transform: {") {
		t.Errorf("raw NDJSON was echoed to stderr as unknown-shape line; full stderr:\n%s", stderr.String())
	}
}

func TestInvokeCtxCancel(t *testing.T) {
	restore := withFake(t, "hang")
	defer restore()

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	req := Request{Files: []File{{Path: "X.lean", FileID: "u-x", Source: "x"}}}
	start := time.Now()
	_, err := Invoke(ctx, t.TempDir(), req, nil)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("want cancellation error, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want ctx cancel", err)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("cancel took %v; child was not killed promptly", elapsed)
	}
}

func TestInvokeMissingBinary(t *testing.T) {
	// Point at a binary path that does not exist.
	t.Setenv("AXM_TRANSFORM_BIN", filepath.Join(t.TempDir(), "does-not-exist-xyz"))
	_, err := Invoke(context.Background(), t.TempDir(), Request{}, nil)
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if !errors.Is(err, ErrLakeMissing) {
		t.Fatalf("err = %v, want wrapping ErrLakeMissing", err)
	}
}

func TestCheckLakeInstalled(t *testing.T) {
	// Case 1: lake not on PATH -> error.
	t.Setenv("PATH", "")
	err := CheckLakeInstalled(context.Background())
	if err == nil {
		t.Fatal("want error with empty PATH")
	}
	if !errors.Is(err, ErrLakeMissing) {
		t.Fatalf("err = %v, want wrapping ErrLakeMissing", err)
	}
}

func TestCheckLakeInstalledPresent(t *testing.T) {
	// Build a PATH containing a directory with a dummy "lake" executable.
	dir := t.TempDir()
	lake := filepath.Join(dir, "lake")
	if runtime.GOOS == "windows" {
		lake += ".exe"
	}
	if err := os.WriteFile(lake, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if err := CheckLakeInstalled(context.Background()); err != nil {
		t.Fatalf("CheckLakeInstalled err = %v, want nil", err)
	}
}

// TestCheckLakeInstalled_ElanNoDefaultToolchain: when elan's `lake` shim
// is on PATH but there's no default toolchain configured, elan exits
// non-zero with a "no default toolchain configured" message on stderr.
// We surface the same ErrLakeMissing sentinel so callers (axm init, axm
// check, axm fork, axm pull) can print the elan install hint.
func TestCheckLakeInstalled_ElanNoDefaultToolchain(t *testing.T) {
	dir := t.TempDir()
	// Mimic elan's stderr output verbatim (casing preserved; our matcher
	// lower-cases both sides). Windows resolves `lake` to a batch file via
	// PATHEXT, so the fake shim is a .cmd script there.
	lake := filepath.Join(dir, "lake")
	script := "#!/bin/sh\n" +
		"echo 'error: no default toolchain configured' >&2\n" +
		"exit 1\n"
	if runtime.GOOS == "windows" {
		lake += ".cmd"
		script = "@echo error: no default toolchain configured 1>&2\r\n" +
			"@exit /b 1\r\n"
	}
	if err := os.WriteFile(lake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	err := CheckLakeInstalled(context.Background())
	if err == nil {
		t.Fatal("want error when elan reports no default toolchain")
	}
	if !errors.Is(err, ErrLakeMissing) {
		t.Fatalf("err = %v, want wrapping ErrLakeMissing", err)
	}
	if !strings.Contains(err.Error(), "no default toolchain") {
		t.Errorf("err = %v, want it to mention `no default toolchain`", err)
	}
}
