package axmindex

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
)

// legacyUploadedFilename is the pre-rename name of the per-workspace
// state file. PR #488 renamed it to "published.json" (see paths.go);
// MigrateV0ToV1 translates the old file in place on first run of every
// `axm` invocation that touches a workspace.
const legacyUploadedFilename = "uploaded.json"

// maxLegacyPayloadBytes caps the size of an uploaded.json we'll accept
// at migration time. A bytes-on-disk index this large indicates either
// a corrupt file or an adversarial input — neither of which the
// translation pass should waste memory chewing through. 100 MiB is well
// above any realistic state file (each entry is ~120 bytes; this caps
// at ~800k entries) while keeping memory pressure bounded.
//
// Declared as a `var` rather than `const` so tests can shrink the cap
// without writing a 100+ MiB fixture file on every CI run.
var maxLegacyPayloadBytes int64 = 100 << 20 // 100 MiB

// MigrateV0ToV1 performs the one-shot uploaded.json -> published.json
// rename for a single workspace root. It is invoked from the root Cobra
// command's PersistentPreRunE so it runs before any subcommand opens
// the index.
//
// Contract:
//   - workspaceRoot is the absolute path to the .axiomdata/-containing
//     directory. If the directory is not yet a workspace (e.g. a fresh
//     `axm auth` invocation in an empty dir), the caller passes in the
//     empty string and MigrateV0ToV1 is a no-op.
//   - The workspace flock is taken before any read/rename so concurrent
//     `axm pull` / `axm fork` / `axm fetch` invocations cannot race the
//     migration.
//     After the lock is acquired the idempotency check is re-run: if a
//     concurrent process completed the migration while we waited, we
//     no-op without re-translating.
//   - If .axiomdata/index/published.json already exists, returns nil
//     (idempotent — already migrated, or a partial-state crash that
//     happens to have produced the new file before the old was removed;
//     either way the new file is authoritative).
//   - If .axiomdata/index/uploaded.json does not exist, returns nil
//     (fresh workspace, nothing to migrate).
//   - Otherwise: reads the legacy file, rewrites every entry's
//     `uploaded_at` field to `published_at`, atomically writes the
//     translated payload to published.json, then removes the legacy
//     uploaded.json. Any I/O or JSON error is returned wrapped so the
//     CLI exits non-zero with a clear message rather than silently
//     proceeding against an un-migrated state file.
//
// The migration is self-healing: fresh workspaces never had the legacy
// file; previously-migrated workspaces hit the idempotent fast-path
// and pay only two os.Stat calls.
func MigrateV0ToV1(workspaceRoot string) error {
	if workspaceRoot == "" {
		return nil
	}

	// Fast-path stat *before* taking the flock: previously-migrated
	// workspaces (the common case after this PR lands) pay only two
	// os.Stat calls and avoid the flock cost entirely.
	indexDir := filepath.Join(workspaceRoot, axiomDataDirName, "index")
	newPath := filepath.Join(indexDir, publishedFilename)
	oldPath := filepath.Join(indexDir, legacyUploadedFilename)
	if done, err := migrationAlreadyDone(newPath, oldPath); err != nil {
		return err
	} else if done {
		return nil
	}

	// Slow path: acquire the workspace flock so we serialize against
	// concurrent `axm pull` / `axm fork` / `axm fetch` invocations.
	// Without this guard process A could finish migrating + write a
	// fresh entry into published.json while process B (pre-rename, with
	// its stale read of uploaded.json) renames its stale translation
	// over A's fresh file, losing the just-written entry.
	lock, err := acquireWorkspaceFlock(workspaceRoot)
	if err != nil {
		return err
	}
	defer func() { _ = lock.Unlock() }()

	// Re-check under the lock: another process may have completed the
	// migration while we waited. If published.json now exists and
	// uploaded.json doesn't, we're done.
	if done, err := migrationAlreadyDone(newPath, oldPath); err != nil {
		return err
	} else if done {
		return nil
	}

	// No new file. Is there an old file to migrate from?
	// Lstat-and-refuse first: symlinks at oldPath would let a confused
	// (or adversarial) file system redirect the read out of
	// .axiomdata/index/. The migration's contract assumes the source
	// lives at the documented path; refuse anything else.
	info, err := os.Lstat(oldPath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			// Fresh workspace, never had the old file. No-op.
			return nil
		}
		return fmt.Errorf("axmindex migrate: lstat %s: %w", oldPath, err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("axmindex migrate: refusing to migrate symlinked %s", oldPath)
	}

	// Bounded read: cap at maxLegacyPayloadBytes so a corrupt or
	// adversarial state file can't OOM the CLI on migration.
	if info.Size() > maxLegacyPayloadBytes {
		return fmt.Errorf("axmindex migrate: %s size %d exceeds cap %d", oldPath, info.Size(), maxLegacyPayloadBytes)
	}
	f, err := os.Open(oldPath)
	if err != nil {
		return fmt.Errorf("axmindex migrate: open %s: %w", oldPath, err)
	}
	data, err := io.ReadAll(io.LimitReader(f, maxLegacyPayloadBytes))
	_ = f.Close()
	if err != nil {
		return fmt.Errorf("axmindex migrate: read %s: %w", oldPath, err)
	}

	// Translate uploaded_at -> published_at on every entry. We round-
	// trip through a generic map so the migration tolerates any v0
	// schema flavor (legacy schema-0 entries with no envelope, or
	// schema-2 entries with the envelope) and forwards every other
	// field unchanged.
	translated, err := translateLegacyPayload(data)
	if err != nil {
		return fmt.Errorf("axmindex migrate: parse %s: %w", oldPath, err)
	}

	// Atomic write of the new file, then remove the old one. A crash
	// between write-new and remove-old leaves both files on disk — the
	// idempotent fast-path above handles that state by treating the
	// new file as authoritative and sweeping the stale old file on the
	// next invocation.
	if err := writeBytesAtomic(newPath, translated); err != nil {
		return fmt.Errorf("axmindex migrate: write %s: %w", newPath, err)
	}
	// New file is in place; legacy file is now redundant. A failure
	// removing it is non-fatal: the idempotent fast-path above will
	// sweep it on the next invocation.
	_ = os.Remove(oldPath)

	// Stderr breadcrumb so users running an older shell history can
	// correlate any subsequent surprises ("why did my state file change
	// shape?") with the actual migration event.
	fmt.Fprintln(os.Stderr, "axm: migrated workspace state file uploaded.json -> published.json")
	return nil
}

// migrationAlreadyDone returns true if published.json exists. As a
// best-effort side effect it also sweeps a stale uploaded.json (a
// crash-mid-rename leftover) so future invocations don't keep paying
// the stat cost.
func migrationAlreadyDone(newPath, oldPath string) (bool, error) {
	if _, err := os.Stat(newPath); err == nil {
		if _, oldErr := os.Stat(oldPath); oldErr == nil {
			_ = os.Remove(oldPath)
		}
		return true, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return false, fmt.Errorf("axmindex migrate: stat %s: %w", newPath, err)
	}
	return false, nil
}

// translateLegacyPayload reads a legacy uploaded.json byte slice and
// returns the byte slice for the new published.json with each entry's
// `uploaded_at` key renamed to `published_at`. The envelope and all
// other top-level keys pass through unchanged.
//
// Guards:
//   - A nil-or-empty input returns the canonical empty published.json so
//     downstream readers see a well-formed file.
//   - A "schema" marker that isn't 0 (legacy/pre-envelope) or the
//     current schemaVersion is refused up-front. This fails loudly here
//     rather than producing a translated published.json that the next
//     Index.Published() call would reject with a confusing schema error.
//   - Entry keys are sorted before marshaling so the byte output is
//     stable across invocations (Go's map iteration is randomized).
func translateLegacyPayload(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return []byte("{}\n"), nil
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	// Schema-marker check. Accept absent (pre-envelope), 0 (legacy
	// marker), or schemaVersion (current build). Reject everything else
	// — e.g. a `"schema": 1` file written by an interim build, or a
	// newer-than-current schema we don't yet understand.
	if schemaRaw, ok := raw["schema"]; ok {
		var schema int
		if err := json.Unmarshal(schemaRaw, &schema); err != nil {
			return nil, fmt.Errorf("refusing to migrate uploaded.json with unrecognized schema marker %s", string(schemaRaw))
		}
		if schema != 0 && schema != schemaVersion {
			return nil, fmt.Errorf("refusing to migrate uploaded.json with unrecognized schema marker %d", schema)
		}
	}

	entriesRaw, ok := raw["entries"]
	if ok && len(entriesRaw) > 0 {
		var entries map[string]map[string]json.RawMessage
		if err := json.Unmarshal(entriesRaw, &entries); err != nil {
			return nil, err
		}
		// Sort keys for stable byte output. Go's encoding/json already
		// emits map keys in sorted order, but we sort explicitly here
		// (a) as a behavioral contract documented at the call site and
		// (b) so any future refactor that swaps the marshaler can't
		// silently regress determinism.
		keys := make([]string, 0, len(entries))
		for k := range entries {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		ordered := make(map[string]map[string]json.RawMessage, len(entries))
		for _, k := range keys {
			entry := entries[k]
			if v, ok := entry["uploaded_at"]; ok {
				entry["published_at"] = v
				delete(entry, "uploaded_at")
			}
			ordered[k] = entry
		}
		newEntries, err := json.Marshal(ordered)
		if err != nil {
			return nil, err
		}
		raw["entries"] = newEntries
	}
	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return nil, err
	}
	out = append(out, '\n')
	return out, nil
}

// MigrateWorkspaceRoot is a thin convenience for callers that have
// not yet opened an *Index. It locates the .axiomdata/ ancestor of
// `start` (using the same walk as Open) and, if found, runs
// MigrateV0ToV1 against it. When no workspace ancestor exists
// (e.g. `axm auth` from a non-workspace directory), it returns nil
// — there is nothing to migrate.
func MigrateWorkspaceRoot(start string) error {
	root, err := findWorkspaceRoot(start)
	if err != nil {
		if errors.Is(err, ErrNoWorkspace) {
			return nil
		}
		return err
	}
	return MigrateV0ToV1(root)
}
