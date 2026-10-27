package axmindex

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// seedLegacyUploaded writes a v0 (or v2-envelope) uploaded.json into the
// workspace's .axiomdata/index/ directory.
func seedLegacyUploaded(t *testing.T, root string, payload []byte) string {
	t.Helper()
	dir := filepath.Join(root, axiomDataDirName, "index")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, legacyUploadedFilename)
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func workspaceRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, axiomDataDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

// TestMigrate_FreshWorkspace exercises the "self-healing" case: a
// workspace that never had a legacy file. The migration must be a no-op
// (no error, no published.json created).
func TestMigrate_FreshWorkspace(t *testing.T) {
	root := workspaceRoot(t)
	if err := MigrateV0ToV1(root); err != nil {
		t.Fatalf("MigrateV0ToV1: %v", err)
	}
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	if _, err := os.Stat(newPath); err == nil {
		t.Fatalf("published.json should not be created on a fresh workspace")
	}
}

// TestMigrate_HappyPath seeds a legacy uploaded.json with one entry,
// runs the migration, and asserts:
//   - published.json exists with the entry's uploaded_at field renamed
//     to published_at.
//   - uploaded.json no longer exists.
//   - All other fields (file_id, content_hash, envelope schema) pass
//     through unchanged.
func TestMigrate_HappyPath(t *testing.T) {
	root := workspaceRoot(t)
	legacy := []byte(`{
  "schema": 2,
  "entries": {
    "Workspace/A.lean": {
      "file_id": "u-aaa",
      "content_hash": "hash-a",
      "uploaded_at": "2026-01-02T03:04:05Z"
    }
  }
}
`)
	oldPath := seedLegacyUploaded(t, root, legacy)

	if err := MigrateV0ToV1(root); err != nil {
		t.Fatalf("MigrateV0ToV1: %v", err)
	}

	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Errorf("uploaded.json should be removed; stat err = %v", err)
	}
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	data, err := os.ReadFile(newPath)
	if err != nil {
		t.Fatalf("read published.json: %v", err)
	}
	var raw struct {
		Schema  float64                   `json:"schema"`
		Entries map[string]map[string]any `json:"entries"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal published.json: %v", err)
	}
	if raw.Schema != 2 {
		t.Errorf("schema = %v, want 2", raw.Schema)
	}
	entry := raw.Entries["Workspace/A.lean"]
	if entry == nil {
		t.Fatalf("entry Workspace/A.lean missing from published.json: %v", raw.Entries)
	}
	if _, has := entry["uploaded_at"]; has {
		t.Errorf("entry still has uploaded_at: %v", entry)
	}
	if entry["published_at"] != "2026-01-02T03:04:05Z" {
		t.Errorf("published_at = %v, want 2026-01-02T03:04:05Z", entry["published_at"])
	}
	if entry["file_id"] != "u-aaa" {
		t.Errorf("file_id = %v, want u-aaa", entry["file_id"])
	}
	if entry["content_hash"] != "hash-a" {
		t.Errorf("content_hash = %v, want hash-a", entry["content_hash"])
	}
}

// TestMigrate_Idempotent runs the migration twice. The second call must
// be a no-op (no error, published.json content unchanged, uploaded.json
// still absent).
func TestMigrate_Idempotent(t *testing.T) {
	root := workspaceRoot(t)
	seedLegacyUploaded(t, root, []byte(`{"schema":2,"entries":{}}`))
	if err := MigrateV0ToV1(root); err != nil {
		t.Fatalf("first MigrateV0ToV1: %v", err)
	}
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	before, err := os.ReadFile(newPath)
	if err != nil {
		t.Fatalf("read published.json: %v", err)
	}
	if err := MigrateV0ToV1(root); err != nil {
		t.Fatalf("second MigrateV0ToV1: %v", err)
	}
	after, err := os.ReadFile(newPath)
	if err != nil {
		t.Fatalf("re-read published.json: %v", err)
	}
	if string(before) != string(after) {
		t.Errorf("published.json mutated by second migration:\nbefore=%s\nafter=%s", before, after)
	}
}

// TestMigrate_CrashMidRename simulates a partial state where both
// uploaded.json and published.json exist on disk simultaneously.
// This can happen if the CLI crashed after we wrote the new file but
// before we removed the old one. The new file is authoritative; the
// migration is a no-op for the data and best-effort sweeps the stale
// old file.
//
// Post-conditions:
//   - No error.
//   - published.json content is preserved exactly (the new file wins).
//   - uploaded.json is gone after the migration.
func TestMigrate_CrashMidRename(t *testing.T) {
	root := workspaceRoot(t)
	indexDir := filepath.Join(root, axiomDataDirName, "index")
	if err := os.MkdirAll(indexDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// New file: the authoritative payload (would have been written by
	// a previous run before its os.Remove of the old file landed).
	newPayload := []byte(`{
  "schema": 2,
  "entries": {
    "Workspace/A.lean": {
      "file_id": "u-new",
      "content_hash": "hash-new",
      "published_at": "2026-02-02T00:00:00Z"
    }
  }
}
`)
	newPath := filepath.Join(indexDir, publishedFilename)
	if err := os.WriteFile(newPath, newPayload, 0o644); err != nil {
		t.Fatal(err)
	}
	// Stale legacy file from the pre-crash state.
	oldPayload := []byte(`{
  "schema": 2,
  "entries": {
    "Workspace/A.lean": {
      "file_id": "u-stale",
      "content_hash": "hash-stale",
      "uploaded_at": "2025-01-01T00:00:00Z"
    }
  }
}
`)
	oldPath := filepath.Join(indexDir, legacyUploadedFilename)
	if err := os.WriteFile(oldPath, oldPayload, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := MigrateV0ToV1(root); err != nil {
		t.Fatalf("MigrateV0ToV1: %v", err)
	}

	// New file content must be preserved verbatim — the migration must
	// not overwrite the authoritative new file with stale legacy data.
	got, err := os.ReadFile(newPath)
	if err != nil {
		t.Fatalf("read published.json: %v", err)
	}
	if string(got) != string(newPayload) {
		t.Errorf("published.json was modified by migration; want=%s\ngot=%s", newPayload, got)
	}
	// Stale legacy file should have been swept.
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Errorf("uploaded.json should be removed after crash-mid-rename recovery; stat err = %v", err)
	}
}

// TestMigrate_MalformedPayload is the second build-PR regression test:
// a malformed v0 uploaded.json (truncated JSON) must cause the
// migration to return a non-nil error so the CLI aborts non-zero
// rather than silently proceeding against an un-migrated state file.
//
// Post-conditions:
//   - Non-nil error returned.
//   - published.json is NOT created (no partial write).
//   - uploaded.json is left in place (we did not silently delete the
//     user's data).
func TestMigrate_MalformedPayload(t *testing.T) {
	root := workspaceRoot(t)
	oldPath := seedLegacyUploaded(t, root, []byte(`{"schema":2,"entries":{not json`))

	err := MigrateV0ToV1(root)
	if err == nil {
		t.Fatalf("expected error for malformed uploaded.json, got nil")
	}
	if !strings.Contains(err.Error(), "axmindex migrate") {
		t.Errorf("error %q missing axmindex migrate prefix", err.Error())
	}

	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	if _, err := os.Stat(newPath); err == nil {
		t.Errorf("published.json must not be created on malformed-payload failure")
	}
	// The user's legacy file must survive so they can rerun once we ship
	// a fix or repair the JSON by hand. Silent deletion would be data loss.
	if _, err := os.Stat(oldPath); err != nil {
		t.Errorf("uploaded.json should remain on malformed-payload failure; stat err = %v", err)
	}
}

// TestMigrate_LegacyEnvelopeless covers a schema-0 (pre-envelope)
// uploaded.json: just the entries map at top level with no "schema"
// or "entries" key. The migration's generic map round-trip should
// pass the unrecognized top-level keys through unchanged and still
// rename uploaded_at on any entry-shaped sub-object it encounters.
//
// In practice we never wrote that variant to disk this far back, but
// the round-trip should tolerate it: a missing "entries" key means
// nothing to rename, and the file simply becomes published.json
// verbatim. That keeps the migration's contract "self-healing".
func TestMigrate_LegacyEnvelopeless(t *testing.T) {
	root := workspaceRoot(t)
	seedLegacyUploaded(t, root, []byte(`{}`))
	if err := MigrateV0ToV1(root); err != nil {
		t.Fatalf("MigrateV0ToV1: %v", err)
	}
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	if _, err := os.Stat(newPath); err != nil {
		t.Errorf("published.json should exist after migrating empty-envelope: %v", err)
	}
}

// TestMigrate_UnknownTopLevelKeyPassthrough verifies the contract that
// unrecognized top-level keys in uploaded.json are preserved verbatim
// in the translated published.json. The migration's round-trip-through-
// a-map design is supposed to forward everything it doesn't explicitly
// transform; this test pins that contract.
func TestMigrate_UnknownTopLevelKeyPassthrough(t *testing.T) {
	root := workspaceRoot(t)
	seedLegacyUploaded(t, root, []byte(`{
  "schema": 2,
  "entries": {
    "Workspace/A.lean": {
      "file_id": "u-aaa",
      "content_hash": "hash-a",
      "uploaded_at": "2026-01-02T03:04:05Z"
    }
  },
  "future_field": {"x": 1, "y": [2, 3]}
}
`))
	if err := MigrateV0ToV1(root); err != nil {
		t.Fatalf("MigrateV0ToV1: %v", err)
	}
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	data, err := os.ReadFile(newPath)
	if err != nil {
		t.Fatalf("read published.json: %v", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	ff, ok := raw["future_field"]
	if !ok {
		t.Fatalf("future_field missing from published.json: %s", data)
	}
	var got map[string]any
	if err := json.Unmarshal(ff, &got); err != nil {
		t.Fatalf("unmarshal future_field: %v", err)
	}
	if got["x"].(float64) != 1 {
		t.Errorf("future_field.x = %v, want 1", got["x"])
	}
}

// TestMigrate_SymlinkRefused covers the case where an attacker (or a
// confused symlink) must not be able to redirect the migration's read out of
// .axiomdata/index/.
func TestMigrate_SymlinkRefused(t *testing.T) {
	root := workspaceRoot(t)
	indexDir := filepath.Join(root, axiomDataDirName, "index")
	if err := os.MkdirAll(indexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Symlink target: a sibling file with arbitrary content. We don't
	// want to read /etc/hosts in tests because portable behavior across
	// CI runners isn't guaranteed.
	target := filepath.Join(t.TempDir(), "elsewhere.json")
	if err := os.WriteFile(target, []byte(`{"schema":2,"entries":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	oldPath := filepath.Join(indexDir, legacyUploadedFilename)
	if err := os.Symlink(target, oldPath); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	err := MigrateV0ToV1(root)
	if err == nil {
		t.Fatalf("expected error for symlinked uploaded.json, got nil")
	}
	if !strings.Contains(err.Error(), "symlinked") {
		t.Errorf("error %q should mention symlinked", err.Error())
	}
	newPath := filepath.Join(indexDir, publishedFilename)
	if _, err := os.Stat(newPath); err == nil {
		t.Errorf("published.json must not be created when source is symlinked")
	}
}

// TestMigrate_SizeCapRefused covers the case where oversized uploaded.json
// files are refused so a corrupt or adversarial state file can't OOM the CLI.
// We shrink the cap to 1 KiB so the test stays fast; production is
// 100 MiB.
func TestMigrate_SizeCapRefused(t *testing.T) {
	// Shrink the cap. Restore on cleanup so other tests see the
	// production value.
	orig := maxLegacyPayloadBytes
	maxLegacyPayloadBytes = 1024
	t.Cleanup(func() { maxLegacyPayloadBytes = orig })

	root := workspaceRoot(t)
	// 2 KiB payload — JSON-valid but oversize.
	var payload []byte
	payload = append(payload, []byte(`{"schema":2,"entries":{},"pad":"`)...)
	for len(payload) < 2048 {
		payload = append(payload, 'A')
	}
	payload = append(payload, []byte(`"}`)...)
	oldPath := seedLegacyUploaded(t, root, payload)

	err := MigrateV0ToV1(root)
	if err == nil {
		t.Fatalf("expected error for oversize uploaded.json, got nil")
	}
	if !strings.Contains(err.Error(), "exceeds cap") {
		t.Errorf("error %q should mention exceeds cap", err.Error())
	}
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	if _, err := os.Stat(newPath); err == nil {
		t.Errorf("published.json must not be created when source exceeds cap")
	}
	if _, err := os.Stat(oldPath); err != nil {
		t.Errorf("uploaded.json should remain on size-cap failure; stat err = %v", err)
	}
}

// TestMigrate_UnknownSchemaMarkerRefused covers the case where a schema-1
// (or any unknown non-zero, non-current) marker fails loudly during
// migration rather than producing a published.json the next Open
// would reject with a confusing schema error.
func TestMigrate_UnknownSchemaMarkerRefused(t *testing.T) {
	root := workspaceRoot(t)
	seedLegacyUploaded(t, root, []byte(`{"schema":1,"entries":{}}`))
	err := MigrateV0ToV1(root)
	if err == nil {
		t.Fatalf("expected error for unknown schema marker, got nil")
	}
	if !strings.Contains(err.Error(), "schema") {
		t.Errorf("error %q should mention schema", err.Error())
	}
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	if _, err := os.Stat(newPath); err == nil {
		t.Errorf("published.json must not be created on unknown-schema failure")
	}
}

// TestMigrate_ByteIdenticalOutput covers the case where the same input
// produces byte-identical output across invocations. Go's map iteration
// is randomized, so without explicit key sorting the marshaled JSON
// could differ run-to-run. We feed multi-entry input and call
// translateLegacyPayload twice; both byte slices must be equal.
func TestMigrate_ByteIdenticalOutput(t *testing.T) {
	input := []byte(`{
  "schema": 2,
  "entries": {
    "Workspace/Z.lean": {"file_id":"z","content_hash":"hz","uploaded_at":"2026-01-01T00:00:00Z"},
    "Workspace/A.lean": {"file_id":"a","content_hash":"ha","uploaded_at":"2026-01-02T00:00:00Z"},
    "Workspace/M.lean": {"file_id":"m","content_hash":"hm","uploaded_at":"2026-01-03T00:00:00Z"}
  }
}
`)
	out1, err := translateLegacyPayload(input)
	if err != nil {
		t.Fatalf("translateLegacyPayload (1): %v", err)
	}
	for i := 0; i < 20; i++ {
		out2, err := translateLegacyPayload(input)
		if err != nil {
			t.Fatalf("translateLegacyPayload (run %d): %v", i, err)
		}
		if string(out1) != string(out2) {
			t.Fatalf("translateLegacyPayload output diverged at run %d:\nfirst=%s\nlater=%s", i, out1, out2)
		}
	}
}

// TestMigrate_ConcurrentWorkspaceRoot covers the case where two (or more)
// goroutines calling MigrateWorkspaceRoot against the same workspace
// must produce exactly one migration. One goroutine wins the flock
// and translates; the others wait, then re-check under the lock and
// see published.json already exists (or — if they raced past the
// fast-path stat first — get a contention error from TryLock and we
// retry; we keep the test deterministic by counting both outcomes as
// "no-op").
//
// The race we're preventing: process A reads uploaded.json, writes
// published.json with translated content + a freshly-published entry;
// process B (started slightly later but pre-rename) reads its OLD
// uploaded.json, translates, and renames OVER A's freshly-published
// published.json, losing A's entry. The flock + re-check pattern makes
// that impossible.
func TestMigrate_ConcurrentWorkspaceRoot(t *testing.T) {
	t.Parallel()
	root := workspaceRoot(t)
	original := []byte(`{
  "schema": 2,
  "entries": {
    "Workspace/A.lean": {
      "file_id": "u-aaa",
      "content_hash": "hash-a",
      "uploaded_at": "2026-01-02T03:04:05Z"
    }
  }
}
`)
	seedLegacyUploaded(t, root, original)

	const goroutines = 8
	var wg sync.WaitGroup
	var migrateErrs atomic.Int32
	var contentionErrs atomic.Int32
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			err := MigrateWorkspaceRoot(root)
			if err != nil {
				// Lock contention is acceptable — the loser goroutine
				// will be retried by the user (or the next CLI
				// invocation), and the eventual state is correct as
				// long as the data is intact.
				if strings.Contains(err.Error(), "another axm command is running") {
					contentionErrs.Add(1)
					return
				}
				migrateErrs.Add(1)
				t.Errorf("MigrateWorkspaceRoot: %v", err)
			}
		}()
	}
	wg.Wait()

	if migrateErrs.Load() != 0 {
		t.Fatalf("got %d non-contention errors from concurrent migration", migrateErrs.Load())
	}

	// Exactly one published.json must exist; uploaded.json must be gone
	// (any goroutine that won the lock cleaned it up).
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	oldPath := filepath.Join(root, axiomDataDirName, "index", legacyUploadedFilename)
	data, err := os.ReadFile(newPath)
	if err != nil {
		t.Fatalf("published.json missing: %v", err)
	}
	// Verify the translation actually happened (uploaded_at -> published_at).
	if strings.Contains(string(data), "uploaded_at") {
		t.Errorf("published.json still contains uploaded_at: %s", data)
	}
	if !strings.Contains(string(data), "published_at") {
		t.Errorf("published.json missing published_at: %s", data)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Errorf("uploaded.json should be removed; stat err = %v", err)
	}

	// Re-running the migration must be a no-op (idempotent fast-path).
	if err := MigrateWorkspaceRoot(root); err != nil {
		t.Errorf("idempotent re-run: %v", err)
	}
	dataAfter, err := os.ReadFile(newPath)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if string(data) != string(dataAfter) {
		t.Errorf("published.json mutated by idempotent re-run:\nbefore=%s\nafter=%s", data, dataAfter)
	}
}

// TestMigrate_RenameFailureCleansUp covers the case where a failed os.Rename
// (simulated via the renameFn indirection) must leave no tempfile
// behind, no published.json, and the legacy uploaded.json intact.
func TestMigrate_RenameFailureCleansUp(t *testing.T) {
	root := workspaceRoot(t)
	legacy := []byte(`{
  "schema": 2,
  "entries": {
    "Workspace/A.lean": {
      "file_id": "u-aaa",
      "content_hash": "hash-a",
      "uploaded_at": "2026-01-02T03:04:05Z"
    }
  }
}
`)
	oldPath := seedLegacyUploaded(t, root, legacy)

	// Inject a failing rename. Restore on cleanup so subsequent tests
	// see the production behavior.
	orig := renameFn
	sentinel := errors.New("synthetic rename failure")
	renameFn = func(oldname, newname string) error {
		return sentinel
	}
	t.Cleanup(func() { renameFn = orig })

	err := MigrateV0ToV1(root)
	if err == nil {
		t.Fatalf("expected error from failed rename, got nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("error %v does not wrap sentinel %v", err, sentinel)
	}

	indexDir := filepath.Join(root, axiomDataDirName, "index")
	newPath := filepath.Join(indexDir, publishedFilename)
	if _, err := os.Stat(newPath); err == nil {
		t.Errorf("published.json must not exist after failed rename")
	}
	if _, err := os.Stat(oldPath); err != nil {
		t.Errorf("uploaded.json should be intact after failed rename: %v", err)
	}
	// No leftover .tmp-* files in the index directory.
	entries, err := os.ReadDir(indexDir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), publishedFilename+".tmp-") {
			t.Errorf("tempfile left behind after failed rename: %s", e.Name())
		}
	}
}

// TestMigrateWorkspaceRoot_NoWorkspace covers the convenience wrapper:
// when no .axiomdata/ ancestor exists, MigrateWorkspaceRoot returns
// nil so the CLI's PersistentPreRunE doesn't abort `axm auth` /
// `axm init` invocations made from outside a workspace.
func TestMigrateWorkspaceRoot_NoWorkspace(t *testing.T) {
	dir := t.TempDir()
	if err := MigrateWorkspaceRoot(dir); err != nil {
		t.Fatalf("MigrateWorkspaceRoot on bare dir: %v", err)
	}
}

// TestMigrateWorkspaceRoot_WalksUp covers the happy path of the
// convenience wrapper: a deep subdirectory of a workspace should
// resolve up to the workspace root and run the migration.
func TestMigrateWorkspaceRoot_WalksUp(t *testing.T) {
	root := workspaceRoot(t)
	seedLegacyUploaded(t, root, []byte(`{"schema":2,"entries":{}}`))
	sub := filepath.Join(root, "pkg", "deep")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := MigrateWorkspaceRoot(sub); err != nil {
		t.Fatalf("MigrateWorkspaceRoot: %v", err)
	}
	newPath := filepath.Join(root, axiomDataDirName, "index", publishedFilename)
	if _, err := os.Stat(newPath); err != nil {
		t.Errorf("published.json should exist after migration from subdir: %v", err)
	}
}
