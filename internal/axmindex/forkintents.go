package axmindex

// forkIntentsFile is the on-disk shape of fork_intents.json: a top-level
// "schema" marker plus the path-keyed entries map.
type forkIntentsFile struct {
	Schema  int               `json:"schema"`
	Entries map[string]string `json:"entries"`
}

// ForkIntents reads fork_intents.json from disk. Keys are workspace paths
// like "Workspace/<dest>.lean"; values are the origin base50 file_ids
// recorded by `axm fork`. Missing file -> empty map. Refuses files whose
// "schema" field doesn't match this build (rejects both newer and
// stale-older versions; pre-beta posture).
func (i *Index) ForkIntents() (map[string]string, error) {
	path := i.forkIntentsPath()
	var f forkIntentsFile
	if err := readMap(path, &f); err != nil {
		return nil, err
	}
	if err := rejectStaleSchema(path, f.Schema); err != nil {
		return nil, err
	}
	if f.Entries == nil {
		f.Entries = map[string]string{}
	}
	return f.Entries, nil
}

// SetForkIntent merges a single entry into fork_intents.json. Atomic.
// `fileID` is the base50-encoded origin file_id (the user-facing form).
func (i *Index) SetForkIntent(path, fileID string) error {
	m, err := i.ForkIntents()
	if err != nil {
		return err
	}
	m[path] = fileID
	return writeMapAtomic(i.forkIntentsPath(), forkIntentsFile{Schema: schemaVersion, Entries: m})
}

// ConsumeForkIntent removes path from fork_intents.json and returns
// the removed UUID (empty string if absent). If the entry is absent
// the file is left untouched.
func (i *Index) ConsumeForkIntent(path string) (string, error) {
	m, err := i.ForkIntents()
	if err != nil {
		return "", err
	}
	uuid, ok := m[path]
	if !ok {
		return "", nil
	}
	delete(m, path)
	if err := writeMapAtomic(i.forkIntentsPath(), forkIntentsFile{Schema: schemaVersion, Entries: m}); err != nil {
		return "", err
	}
	return uuid, nil
}
