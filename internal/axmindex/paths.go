package axmindex

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
)

// axiomDataDirName is the per-workspace metadata directory name.
const axiomDataDirName = ".axiomdata"

// publishedFilename is the on-disk name of the per-workspace state file
// that records files the user has published. PR #488 renamed it from
// "uploaded.json"; see migrate.go for the one-shot rename helper.
//
// This is the single source of truth for the filename — both the path
// accessors below and the migration code reference this constant rather
// than open-coding the literal.
const publishedFilename = "published.json"

// workspaceLockFilename is the on-disk name of the workspace-wide lock
// file under .axiomdata/. It mirrors cmd/lock.go's constant of the same
// name — the migration takes the same flock so it serializes against
// any concurrent `axm pull` / `axm fork` / `axm fetch` invocation.
const workspaceLockFilename = "workspace.lock"

// findWorkspaceRoot walks upward from start looking for a directory that
// contains ".axiomdata/". Returns the absolute path of that directory,
// or ErrNoWorkspace if none is found.
func findWorkspaceRoot(start string) (string, error) {
	abs, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(abs, axiomDataDirName)
		info, err := os.Stat(candidate)
		if err == nil && info.IsDir() {
			return abs, nil
		}
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(abs)
		if parent == abs {
			return "", ErrNoWorkspace
		}
		abs = parent
	}
}

// indexDir returns "<root>/.axiomdata/index".
func (i *Index) indexDir() string {
	return filepath.Join(i.root, axiomDataDirName, "index")
}

func (i *Index) publishedPath() string   { return filepath.Join(i.indexDir(), publishedFilename) }
func (i *Index) fetchedPath() string     { return filepath.Join(i.indexDir(), "fetched.json") }
func (i *Index) forkIntentsPath() string { return filepath.Join(i.indexDir(), "fork_intents.json") }

// renameFn is an indirection over os.Rename so tests can simulate a
// failed Rename (the "cleanup-after-failure" contract is otherwise hard
// to exercise — read-only-directory tricks are platform-fragile and
// don't run consistently as root in containers). All atomic-write call
// sites (writeBytesAtomic via writeMapAtomic and MigrateV0ToV1) route
// through this variable.
var renameFn = os.Rename

// writeBytesAtomic writes data to path via a sibling tempfile + rename.
// The containing directory is created lazily. On any failure between
// CreateTemp and Rename the tempfile is removed before returning so we
// never leave ".tmp-*" droppings on disk.
//
// Extracted from the previously-duplicated tempfile-write blocks in
// writeMapAtomic (index.go) and MigrateV0ToV1 (migrate.go) so both call
// sites share the same fsync / cleanup semantics.
// WriteFileAtomic is the exported entry point to the package's atomic
// sibling-tempfile + rename(2) write, for callers outside axmindex (e.g.
// cmd.cacheFetched writing .axiomdata/files/A/<id>.lean). It shares the same
// fsync / cleanup / EXDEV-safe semantics as the internal index writers.
func WriteFileAtomic(path string, data []byte) error {
	return writeBytesAtomic(path, data)
}

func writeBytesAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	// Best-effort cleanup if anything below fails. After a successful
	// Rename the tempfile no longer exists so Remove is a harmless ENOENT.
	defer func() {
		_ = os.Remove(tmpName)
	}()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return renameFn(tmpName, path)
}

// acquireWorkspaceFlock takes an exclusive, non-blocking flock on
// "<root>/.axiomdata/workspace.lock". On contention it returns an error
// matching cmd/lock.go's git-style message so the user-facing wording
// stays consistent across the lock-taking paths.
//
// The migration uses the same lockfile as cmd's acquireWorkspaceLock so
// the state-file rename serializes against any in-flight `axm pull`
// (or other mutator) that might be writing to published.json.
//
// Callers MUST hold the returned *flock.Flock for the entire critical
// section — typically via `defer lock.Unlock()`. gofrs/flock releases
// the OS lock from a *Flock finalizer, so discarding the returned
// handle lets the garbage collector unlock at an unpredictable moment.
func acquireWorkspaceFlock(workspaceRoot string) (*flock.Flock, error) {
	if err := os.MkdirAll(filepath.Join(workspaceRoot, axiomDataDirName), 0o755); err != nil {
		return nil, fmt.Errorf("axmindex migrate: mkdir %s: %w", filepath.Join(workspaceRoot, axiomDataDirName), err)
	}
	lockPath := filepath.Join(workspaceRoot, axiomDataDirName, workspaceLockFilename)
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
