package upgrade

import (
	"fmt"
	"os"
	"os/exec"
)

func startWorkspaceChild(execPath string) error {
	cmd := exec.Command(execPath, "upgrade", "--resume-workspace-upgrade")
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("reexec: starting %s: %w", execPath, err)
	}
	os.Exit(0)
	return nil
}
