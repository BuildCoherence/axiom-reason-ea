package axmindex

import (
	"time"
)

// Published is a single server-sync entry in published.json. A publish or
// pull can advance it.
//
// Path key on disk is relative to workspace root, e.g. "Workspace/Foo.lean"
// or "Axioms.lean".
type Published struct {
	FileID      string    `json:"file_id"`      // unified file_id (the user-facing form)
	ContentHash string    `json:"content_hash"` // hex output of NormalizedHash
	PublishedAt time.Time `json:"published_at"` // RFC3339
}

// publishedFile is the on-disk shape of published.json: a top-level
// "schema" marker plus the path-keyed entries map.
type publishedFile struct {
	Schema  int                  `json:"schema"`
	Entries map[string]Published `json:"entries"`
}

// Published reads published.json from disk. Missing file -> empty map.
// Refuses files whose "schema" field doesn't match this build (rejects
// both newer and stale-older versions; pre-beta posture).
func (i *Index) Published() (map[string]Published, error) {
	path := i.publishedPath()
	var f publishedFile
	if err := readMap(path, &f); err != nil {
		return nil, err
	}
	if err := rejectStaleSchema(path, f.Schema); err != nil {
		return nil, err
	}
	if f.Entries == nil {
		f.Entries = map[string]Published{}
	}
	return f.Entries, nil
}

// SetPublished merges a single entry into published.json. Atomic.
func (i *Index) SetPublished(path string, entry Published) error {
	m, err := i.Published()
	if err != nil {
		return err
	}
	m[path] = entry
	return writeMapAtomic(i.publishedPath(), publishedFile{Schema: schemaVersion, Entries: m})
}
