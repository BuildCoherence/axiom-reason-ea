package axmindex

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// newTempIndex creates a fresh workspace with an empty .axiomdata/ dir.
func newTempIndex(t *testing.T) *Index {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, axiomDataDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	idx, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	return idx
}

func TestOpenNoWorkspace(t *testing.T) {
	dir := t.TempDir()
	_, err := Open(dir)
	if !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func TestOpenFindsAncestor(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, axiomDataDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(root, "pkg", "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	idx, err := Open(sub)
	if err != nil {
		t.Fatal(err)
	}
	gotRoot, wantRoot, err := evalSymlinkPair(idx.Root(), root)
	if err != nil {
		t.Fatal(err)
	}
	if gotRoot != wantRoot {
		t.Fatalf("Root() = %q, want %q", gotRoot, wantRoot)
	}
}

// evalSymlinkPair resolves symlinks on both paths so we can compare them
// even on systems where t.TempDir() routes through /private/ on macOS etc.
func evalSymlinkPair(a, b string) (string, string, error) {
	ra, err := filepath.EvalSymlinks(a)
	if err != nil {
		return "", "", err
	}
	rb, err := filepath.EvalSymlinks(b)
	if err != nil {
		return "", "", err
	}
	return ra, rb, nil
}

func TestPublishedMissingFileEmpty(t *testing.T) {
	idx := newTempIndex(t)
	m, err := idx.Published()
	if err != nil {
		t.Fatal(err)
	}
	if m == nil {
		t.Fatal("expected non-nil empty map")
	}
	if len(m) != 0 {
		t.Fatalf("len = %d, want 0", len(m))
	}
}

func TestSetPublishedMerges(t *testing.T) {
	idx := newTempIndex(t)
	t0 := time.Now().UTC().Truncate(time.Second)
	if err := idx.SetPublished("Workspace/A.lean", Published{
		FileID: "uuid-a", ContentHash: "hash-a", PublishedAt: t0,
	}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetPublished("Workspace/B.lean", Published{
		FileID: "uuid-b", ContentHash: "hash-b", PublishedAt: t0,
	}); err != nil {
		t.Fatal(err)
	}
	m, err := idx.Published()
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 2 {
		t.Fatalf("len = %d, want 2", len(m))
	}
	if m["Workspace/A.lean"].FileID != "uuid-a" {
		t.Fatalf("A file_id = %q", m["Workspace/A.lean"].FileID)
	}
	if m["Workspace/B.lean"].FileID != "uuid-b" {
		t.Fatalf("B file_id = %q", m["Workspace/B.lean"].FileID)
	}
}

func TestSetPublishedOverwritesSameKey(t *testing.T) {
	idx := newTempIndex(t)
	if err := idx.SetPublished("A.lean", Published{FileID: "v1", ContentHash: "h1"}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetPublished("A.lean", Published{FileID: "v2", ContentHash: "h2"}); err != nil {
		t.Fatal(err)
	}
	m, _ := idx.Published()
	if got := m["A.lean"].FileID; got != "v2" {
		t.Fatalf("file_id = %q, want v2", got)
	}
}

func TestAtomicWriteNoTempLeftover(t *testing.T) {
	idx := newTempIndex(t)
	if err := idx.SetPublished("A.lean", Published{FileID: "v1"}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(idx.indexDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" || containsTmpDashStar(e.Name()) {
			t.Fatalf("leftover tempfile: %s", e.Name())
		}
	}
}

func containsTmpDashStar(name string) bool {
	for i := 0; i+len(".tmp-") <= len(name); i++ {
		if name[i:i+len(".tmp-")] == ".tmp-" {
			return true
		}
	}
	return false
}

func TestFetchedRoundTrip(t *testing.T) {
	idx := newTempIndex(t)
	t0 := time.Now().UTC().Truncate(time.Second)
	if err := idx.SetFetched("abc.lean", Fetched{FileID: "uuid-1", FetchedAt: t0}); err != nil {
		t.Fatal(err)
	}
	m, err := idx.Fetched()
	if err != nil {
		t.Fatal(err)
	}
	if m["abc.lean"].FileID != "uuid-1" {
		t.Fatalf("FileID = %q, want uuid-1", m["abc.lean"].FileID)
	}
}

func TestForkIntentsRoundTrip(t *testing.T) {
	idx := newTempIndex(t)
	if err := idx.SetForkIntent("Workspace/Dest.lean", "origin-uuid"); err != nil {
		t.Fatal(err)
	}
	m, err := idx.ForkIntents()
	if err != nil {
		t.Fatal(err)
	}
	if m["Workspace/Dest.lean"] != "origin-uuid" {
		t.Fatalf("value = %q", m["Workspace/Dest.lean"])
	}

	got, err := idx.ConsumeForkIntent("Workspace/Dest.lean")
	if err != nil {
		t.Fatal(err)
	}
	if got != "origin-uuid" {
		t.Fatalf("ConsumeForkIntent = %q, want origin-uuid", got)
	}

	// After consumption the map is empty.
	m2, _ := idx.ForkIntents()
	if len(m2) != 0 {
		t.Fatalf("after consume len = %d, want 0", len(m2))
	}

	// Absent key consumes cleanly as empty string.
	got, err = idx.ConsumeForkIntent("Workspace/Nope.lean")
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("consume absent = %q, want empty", got)
	}
}

func TestCorruptIndexErr(t *testing.T) {
	idx := newTempIndex(t)
	if err := os.MkdirAll(idx.indexDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(idx.publishedPath(), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := idx.Published()
	var corrupt *ErrCorruptIndex
	if !errors.As(err, &corrupt) {
		t.Fatalf("err = %v, want *ErrCorruptIndex", err)
	}
	if corrupt.Path != idx.publishedPath() {
		t.Fatalf("Path = %q, want %q", corrupt.Path, idx.publishedPath())
	}
}

func TestOpenFromTestdataFixture(t *testing.T) {
	idx, err := Open("testdata")
	if err != nil {
		t.Fatal(err)
	}
	// Empty fixtures should produce empty maps.
	if m, err := idx.Published(); err != nil || len(m) != 0 {
		t.Fatalf("Published = (%v, %v)", m, err)
	}
	if m, err := idx.Fetched(); err != nil || len(m) != 0 {
		t.Fatalf("Fetched = (%v, %v)", m, err)
	}
	if m, err := idx.ForkIntents(); err != nil || len(m) != 0 {
		t.Fatalf("ForkIntents = (%v, %v)", m, err)
	}
}

// TestPublishedJSONShape sanity-checks that the serialized shape matches
// the schema the spec documents: a top-level "schema" marker plus an
// "entries" object whose values carry file_id/content_hash/published_at.
func TestPublishedJSONShape(t *testing.T) {
	idx := newTempIndex(t)
	t0 := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := idx.SetPublished("A.lean", Published{
		FileID: "u", ContentHash: "h", PublishedAt: t0,
	}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(idx.publishedPath())
	if err != nil {
		t.Fatal(err)
	}
	var raw struct {
		Schema  float64                   `json:"schema"`
		Entries map[string]map[string]any `json:"entries"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	if raw.Schema != float64(schemaVersion) {
		t.Errorf("schema = %v, want %d", raw.Schema, schemaVersion)
	}
	entry := raw.Entries["A.lean"]
	for _, k := range []string{"file_id", "content_hash", "published_at"} {
		if _, ok := entry[k]; !ok {
			t.Errorf("missing key %q in serialized entry: %v", k, entry)
		}
	}
}

// TestUnknownSchemaVersionRejected verifies that a JSON file whose
// top-level "schema" field exceeds schemaVersion is refused on read
// with a clear "upgrade axm" error, for all three index files. This
// is the forward-compat guard that keeps an older CLI from silently
// misinterpreting a newer workspace.
func TestUnknownSchemaVersionRejected(t *testing.T) {
	idx := newTempIndex(t)
	if err := os.MkdirAll(idx.indexDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		path string
		read func() error
	}{
		{"published", idx.publishedPath(), func() error { _, err := idx.Published(); return err }},
		{"fetched", idx.fetchedPath(), func() error { _, err := idx.Fetched(); return err }},
		{"forkIntents", idx.forkIntentsPath(), func() error { _, err := idx.ForkIntents(); return err }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := []byte(`{"schema": 999, "entries": {}}`)
			if err := os.WriteFile(tc.path, payload, 0o644); err != nil {
				t.Fatal(err)
			}
			err := tc.read()
			if err == nil {
				t.Fatalf("expected error for schema=999, got nil")
			}
			msg := err.Error()
			for _, want := range []string{"upgrade axm", "schema version 999"} {
				if !containsSubstring(msg, want) {
					t.Errorf("error %q missing %q", msg, want)
				}
			}
		})
	}
}

// TestCurrentSchemaVersionAccepted ensures a file exactly at the known
// schemaVersion reads cleanly.
func TestCurrentSchemaVersionAccepted(t *testing.T) {
	idx := newTempIndex(t)
	if err := os.MkdirAll(idx.indexDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte(fmt.Sprintf(`{"schema": %d, "entries": {}}`, schemaVersion))
	for _, p := range []string{idx.publishedPath(), idx.fetchedPath(), idx.forkIntentsPath()} {
		if err := os.WriteFile(p, payload, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := idx.Published(); err != nil {
		t.Errorf("Published: %v", err)
	}
	if _, err := idx.Fetched(); err != nil {
		t.Errorf("Fetched: %v", err)
	}
	if _, err := idx.ForkIntents(); err != nil {
		t.Errorf("ForkIntents: %v", err)
	}
}

// TestStaleSchemaVersionRejected verifies that schema versions strictly
// older than schemaVersion (but >0) are refused with the
// "re-run `axm init`" message. A v1 entry's `uuid` field can't be
// reinterpreted as a base50 file_id, so we bail rather than silently
// misread.
func TestStaleSchemaVersionRejected(t *testing.T) {
	if schemaVersion < 2 {
		t.Skip("schemaVersion < 2; no stale version to test against")
	}
	idx := newTempIndex(t)
	if err := os.MkdirAll(idx.indexDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		path string
		read func() error
	}{
		{"published", idx.publishedPath(), func() error { _, err := idx.Published(); return err }},
		{"fetched", idx.fetchedPath(), func() error { _, err := idx.Fetched(); return err }},
		{"forkIntents", idx.forkIntentsPath(), func() error { _, err := idx.ForkIntents(); return err }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := []byte(`{"schema": 1, "entries": {}}`)
			if err := os.WriteFile(tc.path, payload, 0o644); err != nil {
				t.Fatal(err)
			}
			err := tc.read()
			if err == nil {
				t.Fatalf("expected error for stale schema=1, got nil")
			}
			msg := err.Error()
			for _, want := range []string{"schema version 1", "re-run `axm init`"} {
				if !containsSubstring(msg, want) {
					t.Errorf("error %q missing %q", msg, want)
				}
			}
		})
	}
}

func containsSubstring(s, sub string) bool {
	return len(sub) == 0 || len(s) >= len(sub) && indexOf(s, sub) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// TestSchemaFieldOnAllFiles verifies each writer emits the current
// schemaVersion at the top level of its JSON file.
func TestSchemaFieldOnAllFiles(t *testing.T) {
	idx := newTempIndex(t)
	if err := idx.SetPublished("A.lean", Published{FileID: "u"}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetFetched("abc.lean", Fetched{FileID: "u"}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetForkIntent("Workspace/D.lean", "u"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{idx.publishedPath(), idx.fetchedPath(), idx.forkIntentsPath()} {
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatalf("read %s: %v", p, err)
		}
		var head struct {
			Schema float64 `json:"schema"`
		}
		if err := json.Unmarshal(data, &head); err != nil {
			t.Fatalf("unmarshal %s: %v", p, err)
		}
		if head.Schema != float64(schemaVersion) {
			t.Errorf("%s: schema = %v, want %d", p, head.Schema, schemaVersion)
		}
	}
}

// TestLeanVersion_StripsPrefix covers the happy path: lean-toolchain
// in the workspace root with the canonical "leanprover/lean4:" prefix
// is parsed into the bare version string. The trailing newline (POSIX
// convention) is also stripped.
func TestLeanVersion_StripsPrefix(t *testing.T) {
	idx := newTempIndex(t)
	if err := os.WriteFile(filepath.Join(idx.Root(), "lean-toolchain"),
		[]byte("leanprover/lean4:v4.13.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := idx.LeanVersion()
	if err != nil {
		t.Fatalf("LeanVersion: %v", err)
	}
	if got != "v4.13.0" {
		t.Fatalf("LeanVersion = %q, want %q", got, "v4.13.0")
	}
}

// TestLeanVersion_NoPrefix tolerates a bare version (some setups omit
// the toolchain prefix). Still trims whitespace.
func TestLeanVersion_NoPrefix(t *testing.T) {
	idx := newTempIndex(t)
	if err := os.WriteFile(filepath.Join(idx.Root(), "lean-toolchain"),
		[]byte("  v4.13.0  \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := idx.LeanVersion()
	if err != nil {
		t.Fatalf("LeanVersion: %v", err)
	}
	if got != "v4.13.0" {
		t.Fatalf("LeanVersion = %q, want %q", got, "v4.13.0")
	}
}

// TestLeanVersion_Missing surfaces a wrapped error when the toolchain
// file is absent, so callers can add their "reading lean-toolchain:"
// prefix.
func TestLeanVersion_Missing(t *testing.T) {
	idx := newTempIndex(t)
	_, err := idx.LeanVersion()
	if err == nil {
		t.Fatal("expected error when lean-toolchain is missing")
	}
	if !strings.HasPrefix(err.Error(), "lean-toolchain file not found:") {
		t.Fatalf("error = %q, want prefix %q", err.Error(), "lean-toolchain file not found:")
	}
}
