//go:build windows

package upgrade

// reexecIntoWorkspacePhase spawns the new binary as a child process
// and exits the current (old-PID) process. Windows has no execve; the
// closest behaviour is "spawn the replacement, hand it stdio, then
// exit ourselves so the user observes a single process transition."
// This loses the PID equivalence Unix gets, but the user-visible
// behaviour matches: one `axm upgrade` invocation, one observable
// process tree at any given time.
//
// We do NOT use cmd.Wait — that would keep the old process alive as
// the parent of the new one, defeating the point. os.Exit(0) after a
// successful Start drops the parent immediately; the child inherits
// stdio handles via cmd.Stdin/Stdout/Stderr assignments.
//
// execPath is the install path resolved by the orchestrator BEFORE the
// self-replace. We must not call os.Executable() here: selfupdate
// renames the running binary aside to `.<exe>.old` before moving the
// new binary into execPath (see selfReplace), so os.Executable() would
// resolve to the renamed-aside old binary rather than the replacement.
func reexecIntoWorkspacePhase(execPath string) error {
	return startWorkspaceChild(execPath)
}
