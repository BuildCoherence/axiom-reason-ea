// Package cmd / lock.go — workspace-wide flock helper shared by every
// subcommand that mutates .axiomdata/ state (pull, fork, fetch).
//
// `axm pull`, `axm fork`, and `axm fetch` all RMW files under
// .axiomdata/index/ (published.json, fork_intents.json, fetched.json).
// Two concurrent invocations against the same workspace race on these
// files — e.g. `axm fetch` and `axm fork` both rewriting fetched.json.
// We serialize all three commands behind a single workspace-wide lockfile with
// LOCK_EX|LOCK_NB so a second invocation exits immediately with a
// git-style message rather than waiting.
//
// NB: the lockfile path — .axiomdata/workspace.lock — must live on a
// local filesystem. POSIX flock() may silently no-op on some NFS
// clients (pre-Linux 2.6.12 in particular), in which case the guard
// degrades to best-effort. The design assumes workspace roots live on
// local disk; users operating from an NFS-mounted workspace accept the
// weaker guarantee.
package cmd

import (
	"fmt"
	"path/filepath"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/gofrs/flock"
)

// workspaceLockFilename is the on-disk name of the workspace-wide lock
// file under .axiomdata/. Shared across pull, fork, and fetch so all
// three subcommands serialize against each other.
const workspaceLockFilename = "workspace.lock"

// acquireWorkspaceLock takes an exclusive, non-blocking flock on
// <root>/.axiomdata/workspace.lock. On success it returns the
// *flock.Flock; the caller MUST hold the returned value — typically via
// `defer lock.Unlock()` — for the entire duration of the critical
// section. gofrs/flock releases the underlying OS lock from a
// finalizer on the *Flock, so discarding the return value (e.g.
// `_, err := acquireWorkspaceLock(idx)`) lets the garbage collector
// unlock the workspace at an unpredictable moment mid-run and defeats
// the single-writer guarantee this helper exists to provide.
//
// On contention it returns a nil lock and an error whose message
// matches the git-style convention ("another axm command is running;
// exit it first"). Other I/O failures surface as-is, wrapped.
//
// The lock must live on a local filesystem; see the package doc for the
// NFS caveat.
func acquireWorkspaceLock(idx *axmindex.Index) (*flock.Flock, error) {
	lockPath := filepath.Join(idx.Root(), ".axiomdata", workspaceLockFilename)
	lock := flock.New(lockPath)
	locked, err := lock.TryLock()
	if err != nil {
		return nil, fmt.Errorf("acquiring workspace lock: %w", err)
	}
	if !locked {
		return nil, fmt.Errorf("another axm command is running; exit it first")
	}
	return lock, nil
}
