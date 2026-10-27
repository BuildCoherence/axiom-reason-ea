//go:build !windows

package upgrade

import (
	"fmt"
	"os"
	"syscall"
)

// reexecIntoWorkspacePhase replaces the running process with the new
// binary, passing the internal --resume-workspace-upgrade flag so the
// new binary's cmd/upgrade.go skips the binary check and dispatches
// straight to the workspace phase. The flag is deliberately not
// documented in --help; users who type it directly get the same
// behaviour but no surface promise.
//
// execPath is the install path resolved by the orchestrator BEFORE the
// self-replace. We must not call os.Executable() here: after
// selfupdate's rename dance it resolves to the deleted `.<exe>.old`
// file, not the new binary (see selfReplace). The new binary occupies
// execPath after the swap.
//
// syscall.Exec is a true execve on Unix — same PID, inherited fds,
// argv replaced. On success, this function does not return; the OS
// has already begun executing the new binary's main(). If it returns,
// the returned value is an error.
func reexecIntoWorkspacePhase(execPath string) error {
	argv := []string{execPath, "upgrade", "--resume-workspace-upgrade"}
	if err := syscall.Exec(execPath, argv, os.Environ()); err != nil {
		return fmt.Errorf("reexec: execve %s: %w", execPath, err)
	}
	// syscall.Exec only returns on failure; this line is unreachable
	// on success but the compiler requires it.
	return nil
}
