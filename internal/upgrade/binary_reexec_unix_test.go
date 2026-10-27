//go:build !windows

package upgrade

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestUnixContinuationProcess(t *testing.T) {
	if target := os.Getenv("AXM_TEST_REEXEC_TARGET"); target != "" {
		if err := reexecIntoWorkspacePhase(target); err != nil {
			t.Fatal(err)
		}
		t.Fatal("exec returned")
	}
}

func TestLegacyUnixReexecArgvAndPID(t *testing.T) {
	target := filepath.Join(t.TempDir(), "replacement")
	if err := os.WriteFile(target, []byte("#!/bin/sh\nprintf '%s\\n' \"$$\" \"$@\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, executable, "-test.run=^TestUnixContinuationProcess$")
	child.Env = append(os.Environ(), "AXM_TEST_REEXEC_TARGET="+target)
	out, err := child.Output()
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf("%d\nupgrade\n--resume-workspace-upgrade\n", child.Process.Pid)
	if string(out) != want {
		t.Fatalf("continuation = %q, want %q", out, want)
	}
	if err := reexecIntoWorkspacePhase(filepath.Join(t.TempDir(), "missing")); err == nil || !strings.Contains(err.Error(), "reexec:") {
		t.Fatalf("exec failure = %v", err)
	}
}
