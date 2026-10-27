// Package axmindex is the single source of truth for the three
// .axiomdata/index/*.json indexes, the normalized Lean-source hash, and
// the two workspace-import graph operations (TransitiveClosure, TopoSort).
//
// Callers: cmd/check, cmd/status, cmd/pull, cmd/fetch, cmd/fork.
// Centralizing enforces a single "modified" definition across callsites
// and one atomic-write routine.
package axmindex

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// schemaVersion is the value written into the top-level "schema" field
// of every index JSON file and the maximum schema version this build
// knows how to read. Bump this when the on-disk shape changes in a way
// callers must notice.
//
// Version-handling contract (pre-beta, breaking changes allowed):
//   - Missing / zero ("schema": 0 or absent): tolerated silently for
//     backward compatibility with files written before the envelope was
//     introduced (legacy schema 0 entries had only the entries map at
//     top level; the loaders coerce them into schema 1+ shape).
//   - Equal to schemaVersion: read normally.
//   - Greater than schemaVersion: refuse with a clear "upgrade axm"
//     error so an older CLI paired with a newer workspace never
//     silently misinterprets the file.
//   - Strictly less than schemaVersion (and >0): refuse with a clear
//     "schema N is no longer supported, re-run `axm init` and re-fetch /
//     re-publish" error. The CLI cannot meaningfully read a v1 entry's
//     `uuid` / `id` field as a base50 file_id (v1 stored raw-UUID
//     values), so we reject upfront rather than silently misinterpret.
//     Schema 2 introduces the `file_id` field rename and
//     base50-encoded values.
const schemaVersion = 2

// rejectStaleSchema returns nil if `got` is acceptable (0 = legacy /
// pre-envelope, or schemaVersion = current), and a user-facing error
// otherwise. Bumped from a single `>` check to bracket both directions
// when schemaVersion advanced past 1 (see schemaVersion docstring).
func rejectStaleSchema(path string, got int) error {
	if got == 0 || got == schemaVersion {
		return nil
	}
	if got > schemaVersion {
		return fmt.Errorf("index file %s has schema version %d; upgrade axm (this build supports up to version %d)", path, got, schemaVersion)
	}
	return fmt.Errorf("index file %s has schema version %d; this build supports schema %d only — re-run `axm init` and re-fetch / re-publish to migrate", path, got, schemaVersion)
}

// ErrNoWorkspace is returned by Open when no .axiomdata/ directory is
// found in workspaceRoot or any ancestor.
var ErrNoWorkspace = errors.New("axmindex: no .axiomdata/ directory found")

// ErrCycle reports a dependency cycle. Paths are ordered along the cycle.
type ErrCycle struct{ Paths []string }

func (e *ErrCycle) Error() string {
	return fmt.Sprintf("axmindex: import cycle: %v", e.Paths)
}

// ErrCorruptIndex wraps a JSON-unmarshal or I/O error against a specific
// index file. Callers should surface both the file path and the wrapped error.
type ErrCorruptIndex struct {
	Path string
	Err  error
}

func (e *ErrCorruptIndex) Error() string {
	return fmt.Sprintf("axmindex: corrupt index %s: %v", e.Path, e.Err)
}

func (e *ErrCorruptIndex) Unwrap() error { return e.Err }

// Index is the handle to a workspace's .axiomdata/ metadata. Getters
// re-read from disk each call; writers use tempfile+rename.
type Index struct {
	root string
}

// Open walks upward from workspaceRoot to find .axiomdata/. Returns
// ErrNoWorkspace if none is found. Missing subdirs (e.g. index/) are
// created lazily on first write.
func Open(workspaceRoot string) (*Index, error) {
	root, err := findWorkspaceRoot(workspaceRoot)
	if err != nil {
		return nil, err
	}
	return &Index{root: root}, nil
}

// Root returns the absolute workspace root.
func (i *Index) Root() string { return i.root }

// LeanVersion reads the workspace's `lean-toolchain` file and returns
// the toolchain string with the leading "leanprover/lean4:" prefix
// stripped. It reads from the workspace root that Open located, so
// invocations from subdirectories work the same as from the root.
//
// Returns a wrapped error when the file is missing or unreadable; the
// caller is responsible for adding a "reading lean-toolchain:" prefix
// when surfacing the error to the user.
//
// This method lives on Index — alongside Published / Fetched / ForkIntents
// — because it reads workspace-root-anchored state, the same concern
// `axmindex` already owns. `axm status` calls into it to report the
// workspace toolchain.
func (i *Index) LeanVersion() (string, error) {
	data, err := os.ReadFile(filepath.Join(i.root, "lean-toolchain"))
	if err != nil {
		return "", fmt.Errorf("lean-toolchain file not found: %w", err)
	}
	v := strings.TrimSpace(string(data))
	v = strings.TrimPrefix(v, "leanprover/lean4:")
	return v, nil
}

// readMap decodes the JSON map at path into out. A missing file is
// treated as an empty map (out is left nil). Corrupt JSON or I/O
// errors are wrapped in *ErrCorruptIndex.
func readMap(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return &ErrCorruptIndex{Path: path, Err: err}
	}
	if len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return &ErrCorruptIndex{Path: path, Err: err}
	}
	return nil
}

// writeMapAtomic serializes v as indented JSON and writes the result to
// path via a tempfile + rename. Delegates the bytes-on-disk dance to
// writeBytesAtomic so this routine and MigrateV0ToV1 share the same
// tempfile-prefix / fsync / cleanup contract.
func writeMapAtomic(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	// Append a trailing newline for human readability / POSIX-style lines.
	data = append(data, '\n')
	return writeBytesAtomic(path, data)
}
