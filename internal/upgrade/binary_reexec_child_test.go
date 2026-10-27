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

func init() {
	if os.Getenv("AXM_TEST_CHILD_CONTINUATION") != "1" || len(os.Args) != 3 || os.Args[1] != "upgrade" {
		return
	}
	if os.Args[2] != "--resume-workspace-upgrade" {
		os.Exit(2)
	}
	// The child stays alive until the test observes the parent's successful exit.
	marker := os.Getenv("AXM_TEST_CHILD_MARKER")
	// Rename publishes the marker whole; the parent polls and must never see a partial write.
	if err := os.WriteFile(marker+".tmp", []byte(strings.Join(os.Args[1:], " ")), 0600); err != nil {
		os.Exit(3)
	}
	if err := os.Rename(marker+".tmp", marker); err != nil {
		os.Exit(3)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(marker + ".release"); err == nil {
			_ = os.WriteFile(marker+".done", nil, 0600)
			os.Exit(0)
		}
		time.Sleep(10 * time.Millisecond)
	}
	os.Exit(4)
}

func TestStartWorkspaceChildProcess(t *testing.T) {
	if os.Getenv("AXM_TEST_CHILD_CONTINUATION") != "1" {
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := startWorkspaceChild(executable); err != nil {
		t.Fatal(err)
	}
	t.Fatal("parent did not exit")
}

func TestWindowsContinuationStartsChildAndExitsParent(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "child")
	defer func() {
		_ = os.WriteFile(marker+".release", nil, 0600)
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if _, err := os.Stat(marker + ".done"); err == nil {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Error("child did not finish")
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	parent := exec.CommandContext(ctx, executable, "-test.run=^TestStartWorkspaceChildProcess$")
	parent.Env = append(os.Environ(), "AXM_TEST_CHILD_CONTINUATION=1", "AXM_TEST_CHILD_MARKER="+marker)
	// File-backed stdio lets Wait observe the parent independently of the child.
	output, err := os.CreateTemp(t.TempDir(), "stdio")
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	parent.Stdout, parent.Stderr = output, output
	if err := parent.Run(); err != nil {
		t.Fatalf("parent: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		args, err := os.ReadFile(marker)
		if err == nil {
			if string(args) != "upgrade --resume-workspace-upgrade" {
				t.Fatalf("child argv = %s", args)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("child never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := startWorkspaceChild(filepath.Join(t.TempDir(), "missing")); err == nil || !strings.Contains(fmt.Sprint(err), "reexec: starting") {
		t.Fatalf("start failure = %v", err)
	}
}
