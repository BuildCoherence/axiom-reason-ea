package cmd

import (
	"strings"
	"testing"
)

func TestRetiredHostedCommandsExitOneWithOneLine(t *testing.T) {
	home := t.TempDir()
	root := initStatusWorkspace(t)
	for _, args := range [][]string{
		{"publish"},
		{"publish", "--yes", "Workspace/A.lean"},
		{"auth"},
		{"auth", "--no-browser"},
		{"whoami"},
		{"status", "--remote"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			code, stderr := runAxmProcess(t, root, home, args...)
			if code != 1 {
				t.Fatalf("exit code = %d, want 1; stderr=%q", code, stderr)
			}
			lines := strings.Split(strings.TrimSpace(stderr), "\n")
			want := "is retired: publishing has closed and the Axiom toolkit is local"
			if len(lines) != 1 || !strings.Contains(lines[0], want) {
				t.Fatalf("stderr = %q, want one line containing %q", stderr, want)
			}
		})
	}
}

func TestRetiredHostedCommandsAbsentFromHelp(t *testing.T) {
	usage := rootCmd.UsageString()
	for _, name := range retiredHostedCommands {
		if strings.Contains(usage, "\n  "+name+" ") {
			t.Errorf("axm --help lists retired command %q:\n%s", name, usage)
		}
	}
	if !strings.Contains(usage, "\n  status ") {
		t.Fatalf("help fixture lost the visible command list:\n%s", usage)
	}
	if strings.Contains(statusCmd.UsageString(), "--remote") {
		t.Errorf("axm status --help lists the retired --remote flag")
	}
}
