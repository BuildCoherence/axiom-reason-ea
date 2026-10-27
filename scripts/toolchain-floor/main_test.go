package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const gomod = "module example.com/m\n\ngo 1.25.7\n\ntoolchain go1.26.10\n"

func TestCheck(t *testing.T) {
	for _, tc := range []struct {
		name, gomod, goVersion, wantErr string
	}{
		{"equal", gomod, "go1.26.10", ""},
		{"later patch", gomod, "go1.26.11", ""},
		{"later minor", gomod, "go1.27.0", ""},
		{"earlier patch", gomod, "go1.26.9", "running go1.26.9, below the go.mod toolchain go1.26.10; set GOTOOLCHAIN=go1.26.10 or later"},
		{"earlier minor", gomod, "go1.25.12", "below the go.mod toolchain go1.26.10"},
		{"release candidate below floor", gomod, "go1.26rc1", "below the go.mod toolchain"},
		{"devel toolchain", gomod, "devel go1.27-abcdef", "is not a Go release"},
		{"no toolchain directive", "module example.com/m\n\ngo 1.25.7\n", "go1.27.0", "has no toolchain directive"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := check("go.mod", []byte(tc.gomod), tc.goVersion)
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("check(%s) = %v, want nil", tc.goVersion, err)
			case tc.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErr)):
				t.Fatalf("check(%s) = %v, want an error containing %q", tc.goVersion, err, tc.wantErr)
			}
		})
	}
}

func TestRunExitCodes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "go.mod")
	if err := os.WriteFile(path, []byte(gomod), 0o644); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if code := run(path, "go1.26.9", &stdout, &stderr); code != 1 {
		t.Fatalf("run below the floor exited %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "toolchain-floor: running go1.26.9") {
		t.Errorf("stderr = %q", stderr.String())
	}
	stdout.Reset()
	if code := run(path, "go1.26.10", &stdout, &stderr); code != 0 {
		t.Fatalf("run at the floor exited %d, want 0", code)
	}
	if code := run(filepath.Join(t.TempDir(), "missing.mod"), "go1.26.10", &stdout, &stderr); code != 1 {
		t.Fatalf("run without go.mod exited %d, want 1", code)
	}
}

// TestRepositoryFloor keeps the release floor at or above go1.26.10, the first
// toolchain without the revoked eMudhra roots.
func TestRepositoryFloor(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	if err := check("go.mod", data, "go1.26.9"); err == nil || strings.Contains(err.Error(), "no toolchain directive") {
		t.Fatal("go.mod toolchain floor accepts go1.26.9")
	}
}
