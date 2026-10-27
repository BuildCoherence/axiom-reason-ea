package axmindex

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// TestSetFetchedBulkNewDirect covers the new-direct cell of the merge
// truth table: an empty map gains a direct (indirect:false) entry.
func TestSetFetchedBulkNewDirect(t *testing.T) {
	idx := newTempIndex(t)
	t0 := time.Now().UTC().Truncate(time.Second)
	if err := idx.SetFetchedBulk(map[string]Fetched{
		"a.lean": {FileID: "id-a", FetchedAt: t0, Indirect: false},
	}); err != nil {
		t.Fatal(err)
	}
	m, err := idx.Fetched()
	if err != nil {
		t.Fatal(err)
	}
	got := m["a.lean"]
	if got.FileID != "id-a" || got.Indirect {
		t.Fatalf("a.lean = %+v, want direct id-a", got)
	}
}

// TestSetFetchedBulkNewIndirect covers the new-indirect cell: an empty
// map gains an indirect (indirect:true) entry.
func TestSetFetchedBulkNewIndirect(t *testing.T) {
	idx := newTempIndex(t)
	t0 := time.Now().UTC().Truncate(time.Second)
	if err := idx.SetFetchedBulk(map[string]Fetched{
		"dep.lean": {FileID: "id-dep", FetchedAt: t0, Indirect: true},
	}); err != nil {
		t.Fatal(err)
	}
	m, err := idx.Fetched()
	if err != nil {
		t.Fatal(err)
	}
	got := m["dep.lean"]
	if got.FileID != "id-dep" || !got.Indirect {
		t.Fatalf("dep.lean = %+v, want indirect id-dep", got)
	}
}

// TestSetFetchedBulkPromoteIndirectToDirect covers the
// promote-indirect-to-direct cell: an existing indirect:true entry that is
// then bulk-written as direct becomes indirect:false with FetchedAt
// refreshed to the incoming (newer) time.
func TestSetFetchedBulkPromoteIndirectToDirect(t *testing.T) {
	idx := newTempIndex(t)
	tOld := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	tNew := time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)
	if err := idx.SetFetchedBulk(map[string]Fetched{
		"x.lean": {FileID: "id-x", FetchedAt: tOld, Indirect: true},
	}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetFetchedBulk(map[string]Fetched{
		"x.lean": {FileID: "id-x", FetchedAt: tNew, Indirect: false},
	}); err != nil {
		t.Fatal(err)
	}
	m, err := idx.Fetched()
	if err != nil {
		t.Fatal(err)
	}
	got := m["x.lean"]
	if got.Indirect {
		t.Fatalf("x.lean still indirect; want promoted to direct: %+v", got)
	}
	if !got.FetchedAt.Equal(tNew) {
		t.Fatalf("FetchedAt = %v, want refreshed to %v", got.FetchedAt, tNew)
	}
}

// TestSetFetchedBulkNoDemoteDirect covers the no-demote-direct cell: an
// existing indirect:false (direct) entry stays direct, and its FetchedAt is
// unchanged, when bulk-written as indirect:true.
func TestSetFetchedBulkNoDemoteDirect(t *testing.T) {
	idx := newTempIndex(t)
	tDirect := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	tLater := time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)
	if err := idx.SetFetchedBulk(map[string]Fetched{
		"y.lean": {FileID: "id-y", FetchedAt: tDirect, Indirect: false},
	}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetFetchedBulk(map[string]Fetched{
		"y.lean": {FileID: "id-y", FetchedAt: tLater, Indirect: true},
	}); err != nil {
		t.Fatal(err)
	}
	m, err := idx.Fetched()
	if err != nil {
		t.Fatal(err)
	}
	got := m["y.lean"]
	if got.Indirect {
		t.Fatalf("y.lean demoted to indirect; want kept direct: %+v", got)
	}
	if !got.FetchedAt.Equal(tDirect) {
		t.Fatalf("FetchedAt = %v, want unchanged %v", got.FetchedAt, tDirect)
	}
}

// TestFetchedBackwardCompatNoIndirectField verifies that an existing
// schema-2 fetched.json written WITHOUT the `indirect` field reads back
// with Indirect == false, since false is the legacy directly-requested
// meaning. This is why step 2 does not bump schemaVersion.
func TestFetchedBackwardCompatNoIndirectField(t *testing.T) {
	idx := newTempIndex(t)
	if err := os.MkdirAll(idx.indexDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"schema": 2, "entries": {"legacy.lean": {"file_id": "id-legacy", "fetched_at": "2026-01-02T03:04:05Z"}}}`)
	if err := os.WriteFile(idx.fetchedPath(), payload, 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := idx.Fetched()
	if err != nil {
		t.Fatal(err)
	}
	got := m["legacy.lean"]
	if got.FileID != "id-legacy" {
		t.Fatalf("FileID = %q, want id-legacy", got.FileID)
	}
	if got.Indirect {
		t.Fatalf("legacy entry read as indirect; want false (directly-requested)")
	}
}

// TestFetchedOmitemptyDirect verifies that the omitempty tag keeps a direct
// (indirect:false) entry from serializing an "indirect" key at all, so
// existing direct entries round-trip byte-compatibly with pre-field files.
func TestFetchedOmitemptyDirect(t *testing.T) {
	idx := newTempIndex(t)
	t0 := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := idx.SetFetchedBulk(map[string]Fetched{
		"direct.lean": {FileID: "id-d", FetchedAt: t0, Indirect: false},
	}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(idx.fetchedPath())
	if err != nil {
		t.Fatal(err)
	}
	var raw struct {
		Entries map[string]map[string]any `json:"entries"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	entry := raw.Entries["direct.lean"]
	if _, ok := entry["indirect"]; ok {
		t.Fatalf("direct entry serialized an \"indirect\" key: %v", entry)
	}

	// An indirect entry, by contrast, must carry the field.
	if err := idx.SetFetchedBulk(map[string]Fetched{
		"dep.lean": {FileID: "id-dep", FetchedAt: t0, Indirect: true},
	}); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(idx.fetchedPath())
	if err != nil {
		t.Fatal(err)
	}
	raw.Entries = nil
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	if v, ok := raw.Entries["dep.lean"]["indirect"]; !ok || v != true {
		t.Fatalf("indirect entry missing/false \"indirect\" key: %v", raw.Entries["dep.lean"])
	}
}
