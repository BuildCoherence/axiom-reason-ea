// Package corpustest writes small Published Corpus fixtures for tests.
package corpustest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
)

// File is one fixture corpus file.
type File struct {
	ID          string
	Content     string
	Deps        []string
	Publisher   *string
	PublishedAt time.Time // zero means the fixture's FrozenAt
}

// Fixture describes a corpus to write.
type Fixture struct {
	FrozenAt time.Time
	Files    []File
	Heads    map[string]corpus.Head // keyed by lowercase username, as the export writes it
	Index    corpus.SearchIndex
	Refs     []corpus.ModelingRef
}

// Write lays out the fixture's corpus.json, heads.json, search-index.json,
// modeling-refs.json and A/<id>.lean under root.
func Write(t testing.TB, root string, f Fixture) {
	t.Helper()
	type entry struct {
		ID          string    `json:"id"`
		SHA256      string    `json:"sha256"`
		Publisher   *string   `json:"publisher"`
		PublishedAt time.Time `json:"published_at"`
		ForkedFrom  *string   `json:"forked_from"`
		Deps        []string  `json:"deps"`
	}
	entries := make([]entry, 0, len(f.Files))
	for _, file := range f.Files {
		sum := sha256.Sum256([]byte(file.Content))
		deps := file.Deps
		if deps == nil {
			deps = []string{}
		}
		publishedAt := file.PublishedAt
		if publishedAt.IsZero() {
			publishedAt = f.FrozenAt
		}
		entries = append(entries, entry{ID: file.ID, SHA256: hex.EncodeToString(sum[:]), Publisher: file.Publisher, PublishedAt: publishedAt, Deps: deps})
		writeFile(t, filepath.Join(root, "A", file.ID+".lean"), []byte(file.Content))
	}
	manifest := map[string]any{
		"export_id": f.FrozenAt.UTC().Format("20060102T150405Z"),
		"frozen_at": f.FrozenAt.UTC(),
		"files":     entries,
	}
	writeJSON(t, filepath.Join(root, "corpus.json"), manifest)
	heads := f.Heads
	if heads == nil {
		heads = map[string]corpus.Head{}
	}
	writeJSON(t, filepath.Join(root, "heads.json"), heads)
	index := f.Index
	if index.Constants == nil {
		index.Constants = []corpus.Constant{}
	}
	if index.Types == nil {
		index.Types = []corpus.TypeHead{}
	}
	if index.Users == nil {
		index.Users = []corpus.User{}
	}
	writeJSON(t, filepath.Join(root, "search-index.json"), index)
	refs := f.Refs
	if refs == nil {
		refs = []corpus.ModelingRef{}
	}
	writeJSON(t, filepath.Join(root, "modeling-refs.json"), refs)
}

// Install writes the fixture as the active, complete install under
// home/.axiom/corpus and returns the install directory.
func Install(t testing.TB, home string, f Fixture) string {
	t.Helper()
	staging := t.TempDir()
	Write(t, staging, f)
	manifest, err := os.ReadFile(filepath.Join(staging, "corpus.json"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(manifest)
	name := hex.EncodeToString(sum[:])
	dir := filepath.Join(home, ".axiom", "corpus")
	install := filepath.Join(dir, name)
	Write(t, install, f)
	writeFile(t, filepath.Join(install, corpus.MarkerFile), []byte(name+"\n"))
	writeFile(t, filepath.Join(dir, corpus.PointerFile), []byte(name+"\n"))
	return install
}

func writeJSON(t testing.TB, path string, v any) {
	t.Helper()
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, path, raw)
}

func writeFile(t testing.TB, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}
