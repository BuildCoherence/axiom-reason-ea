// Package corpus reads the Published Corpus installed under ~/.axiom/corpus/.
//
// Install contract (the writer is `axm upgrade` / `axm init`):
//   - each install is extracted into ~/.axiom/corpus/<sha256>/, named by the
//     lowercase hex SHA-256 of the installed archive;
//   - the install is complete only once <sha256>/.complete exists and holds
//     that same hash;
//   - ~/.axiom/corpus/current holds the name of the active install directory
//     and is switched atomically after the marker is written.
//
// An install whose marker is missing or does not match counts as missing.
package corpus

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/idcodec"
)

const (
	// PointerFile names the file in Dir that names the active install.
	PointerFile = "current"
	// MarkerFile names the completion marker inside an install directory.
	MarkerFile = ".complete"
)

// ErrNotInstalled reports that no complete corpus install is active.
var ErrNotInstalled = errors.New("no published corpus is installed; run `axm upgrade`")

// File is one corpus.json files[] entry.
type File struct {
	ID          string    `json:"id"`
	SHA256      string    `json:"sha256"`
	Publisher   *string   `json:"publisher"`
	PublishedAt time.Time `json:"published_at"`
	ForkedFrom  *string   `json:"forked_from"`
	Deps        []string  `json:"deps"`
}

// Head is one heads.json value: a user's published Axiom Snapshot.
type Head struct {
	SnapshotFileID string    `json:"snapshot_file_id"`
	SnapshotDefID  string    `json:"snapshot_def_id"`
	PublishedAt    time.Time `json:"published_at"`
}

// Constant is one search-index.json constants[] row.
type Constant struct {
	DefID            string    `json:"def_id"`
	Name             string    `json:"name"`
	Kind             string    `json:"kind"`
	TypeHead         *string   `json:"type_head"`
	FileID           string    `json:"file_id"`
	CreatedAt        time.Time `json:"created_at"`
	Publisher        *string   `json:"publisher"`
	DeclByteStart    int       `json:"decl_byte_start"`
	SignatureByteEnd int       `json:"signature_byte_end"`
	DeclarationRole  *string   `json:"declaration_role"`
}

// TypeParam is one declared parameter of a type head.
type TypeParam struct {
	Index  int    `json:"index"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	Binder string `json:"binder"`
}

// TypeHead is one search-index.json types[] row; a platform built-in has a
// nil FileID, DefID, Kind, Publisher and CreatedAt.
type TypeHead struct {
	TypeHead       string      `json:"type_head"`
	SearchableName string      `json:"searchable_name"`
	Arity          int         `json:"arity"`
	Params         []TypeParam `json:"params"`
	FileID         *string     `json:"file_id"`
	DefID          *string     `json:"def_id"`
	Kind           *string     `json:"kind"`
	Publisher      *string     `json:"publisher"`
	CreatedAt      *time.Time  `json:"created_at"`
}

// User is one search-index.json users[] row.
type User struct {
	Username         string     `json:"username"`
	FirstPublishedAt *time.Time `json:"first_published_at"`
}

// SearchIndex is search-index.json.
type SearchIndex struct {
	Constants []Constant `json:"constants"`
	Types     []TypeHead `json:"types"`
	Users     []User     `json:"users"`
}

// ModelingRef is one modeling-refs.json entry.
type ModelingRef struct {
	Slug        string `json:"slug"`
	Category    string `json:"category"`
	Description string `json:"description"`
	FileID      string `json:"file_id"`
}

type manifest struct {
	ExportID string    `json:"export_id"`
	FrozenAt time.Time `json:"frozen_at"`
	Files    []File    `json:"files"`
}

// Corpus is an opened, complete corpus install.
type Corpus struct {
	root     string
	exportID string
	frozenAt time.Time
	files    map[string]File
}

// Dir returns ~/.axiom/corpus.
func Dir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("locating home directory: %w", err)
	}
	return filepath.Join(home, ".axiom", "corpus"), nil
}

// OpenInstalled opens the active install named by Dir()/current.
func OpenInstalled() (*Corpus, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	root, err := ActiveInstall(dir)
	if err != nil {
		return nil, err
	}
	return Open(root)
}

// ActiveInstall returns the complete install that dir/current names, or ErrNotInstalled.
func ActiveInstall(dir string) (string, error) {
	raw, err := os.ReadFile(filepath.Join(dir, PointerFile))
	if errors.Is(err, os.ErrNotExist) {
		return "", ErrNotInstalled
	}
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", filepath.Join(dir, PointerFile), err)
	}
	name := strings.TrimSpace(string(raw))
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return "", ErrNotInstalled
	}
	marker, err := os.ReadFile(filepath.Join(dir, name, MarkerFile))
	if errors.Is(err, os.ErrNotExist) {
		return "", ErrNotInstalled
	}
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", filepath.Join(dir, name, MarkerFile), err)
	}
	if strings.TrimSpace(string(marker)) != name {
		return "", ErrNotInstalled
	}
	return filepath.Join(dir, name), nil
}

// Open reads corpus.json from a corpus root directory.
func Open(root string) (*Corpus, error) {
	path := filepath.Join(root, "corpus.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var m manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	files := make(map[string]File, len(m.Files))
	for _, f := range m.Files {
		if !idcodec.Valid(f.ID) {
			return nil, fmt.Errorf("%s: invalid file id %q", path, f.ID)
		}
		files[f.ID] = f
	}
	return &Corpus{root: root, exportID: m.ExportID, frozenAt: m.FrozenAt, files: files}, nil
}

// ExportID returns corpus.json export_id.
func (c *Corpus) ExportID() string { return c.exportID }

// FrozenDate returns the UTC date of corpus.json frozen_at as YYYY-MM-DD.
func (c *Corpus) FrozenDate() string { return c.frozenAt.UTC().Format(time.DateOnly) }

// Has reports whether id is a corpus file.
func (c *Corpus) Has(id string) bool {
	_, ok := c.files[id]
	return ok
}

// Closure returns id followed by its transitive deps in breadth-first order.
func (c *Corpus) Closure(id string) ([]string, error) {
	if !c.Has(id) {
		return nil, fmt.Errorf("%s is not in the corpus", id)
	}
	seen := map[string]bool{id: true}
	order := []string{id}
	for i := 0; i < len(order); i++ {
		for _, dep := range c.files[order[i]].Deps {
			if seen[dep] {
				continue
			}
			if !c.Has(dep) {
				return nil, fmt.Errorf("corpus is inconsistent: %s depends on %s, which is not in corpus.json", order[i], dep)
			}
			seen[dep] = true
			order = append(order, dep)
		}
	}
	return order, nil
}

// Files returns every corpus.json files[] entry, ordered by id.
func (c *Corpus) Files() []File {
	files := make([]File, 0, len(c.files))
	for _, f := range c.files {
		files = append(files, f)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ID < files[j].ID })
	return files
}

// Content returns the bytes of A/<id>.lean.
func (c *Corpus) Content(id string) ([]byte, error) {
	if !c.Has(id) {
		return nil, fmt.Errorf("%s is not in the corpus", id)
	}
	return os.ReadFile(filepath.Join(c.root, "A", id+".lean"))
}

// Head returns username's heads.json entry; lookup is case-insensitive.
func (c *Corpus) Head(username string) (Head, bool, error) {
	var heads map[string]Head
	if err := c.readJSON("heads.json", &heads); err != nil {
		return Head{}, false, err
	}
	head, ok := heads[strings.ToLower(username)]
	return head, ok, nil
}

// SearchIndex reads search-index.json.
func (c *Corpus) SearchIndex() (SearchIndex, error) {
	var idx SearchIndex
	err := c.readJSON("search-index.json", &idx)
	return idx, err
}

// ModelingRefs reads modeling-refs.json.
func (c *Corpus) ModelingRefs() ([]ModelingRef, error) {
	var refs []ModelingRef
	err := c.readJSON("modeling-refs.json", &refs)
	return refs, err
}

func (c *Corpus) readJSON(name string, v any) error {
	path := filepath.Join(c.root, name)
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("reading %s: %w", path, err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("parsing %s: %w", path, err)
	}
	return nil
}
