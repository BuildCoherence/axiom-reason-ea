package axmindex

import (
	"time"
)

// Fetched is a single entry in fetched.json.
//
// Filename key is "<file_id>.lean"; the file itself lives at
// .axiomdata/files/A/<file_id>.lean.
type Fetched struct {
	FileID    string    `json:"file_id"` // unified file_id (the user-facing form)
	FetchedAt time.Time `json:"fetched_at"`
	// Indirect marks a cache member pulled only as a closure dependency
	// rather than explicitly named on a fetch command. The zero value
	// (false = directly-requested) matches the legacy meaning, so existing
	// schema-2 fetched.json files without this field read back as direct.
	// omitempty keeps direct entries from serializing the field at all.
	Indirect bool `json:"indirect,omitempty"`
}

// fetchedFile is the on-disk shape of fetched.json: a top-level
// "schema" marker plus the filename-keyed entries map.
type fetchedFile struct {
	Schema  int                `json:"schema"`
	Entries map[string]Fetched `json:"entries"`
}

// Fetched reads fetched.json from disk. Missing file -> empty map.
// Refuses files whose "schema" field doesn't match this build (rejects
// both newer and stale-older versions; pre-beta posture).
func (i *Index) Fetched() (map[string]Fetched, error) {
	path := i.fetchedPath()
	var f fetchedFile
	if err := readMap(path, &f); err != nil {
		return nil, err
	}
	if err := rejectStaleSchema(path, f.Schema); err != nil {
		return nil, err
	}
	if f.Entries == nil {
		f.Entries = map[string]Fetched{}
	}
	return f.Entries, nil
}

// SetFetched merges a single entry into fetched.json. Atomic.
func (i *Index) SetFetched(filename string, entry Fetched) error {
	m, err := i.Fetched()
	if err != nil {
		return err
	}
	m[filename] = entry
	return writeMapAtomic(i.fetchedPath(), fetchedFile{Schema: schemaVersion, Entries: m})
}

// SetFetchedBulk merges many entries into fetched.json in a single
// read-modify-write. It is NOT internally synchronized: there is no in-process
// lock, so it is safe only under the workspace flock that serializes axm
// commands (acquireWorkspaceLock) — callers must hold that lock, which is what
// guarantees no concurrent recorder reads a stale map and clobbers another's
// write. The merge is monotonic toward direct: an entry already recorded as
// direct (indirect:false) is never demoted to indirect.
//
// Per filename key, given the existing entry (if any) and the incoming one:
//   - New key: insert the incoming entry as given.
//   - Incoming direct (indirect:false): set/keep indirect:false, take the
//     incoming FileID, and refresh FetchedAt to the incoming time. This both
//     promotes a previously-indirect member to direct and keeps a direct
//     entry direct — a just-named file surfaces in the status recency window.
//   - Existing direct, incoming indirect:true: never demote — keep the
//     existing entry untouched (indirect stays false, FetchedAt unchanged).
//   - Existing indirect, incoming indirect:true: idempotent; take the
//     incoming entry (refreshing FetchedAt), matching SetFetched's
//     last-writer-wins merge semantics — kept simple intentionally.
func (i *Index) SetFetchedBulk(entries map[string]Fetched) error {
	m, err := i.Fetched()
	if err != nil {
		return err
	}
	for filename, incoming := range entries {
		existing, ok := m[filename]
		switch {
		case !ok:
			// New key: insert as given.
			m[filename] = incoming
		case !incoming.Indirect:
			// Incoming direct: set/keep direct, adopt FileID, refresh time.
			// Covers both promote-indirect-to-direct and direct-stays-direct.
			m[filename] = incoming
		case existing.Indirect:
			// Existing indirect, incoming indirect: idempotent, last writer wins.
			m[filename] = incoming
		default:
			// Existing direct, incoming indirect: never demote; keep existing.
		}
	}
	return writeMapAtomic(i.fetchedPath(), fetchedFile{Schema: schemaVersion, Entries: m})
}
