package corpus_test

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus/corpustest"
)

var frozen = time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)

func fixture() corpustest.Fixture {
	return corpustest.Fixture{
		FrozenAt: frozen,
		Files: []corpustest.File{
			{ID: "a1111111", Content: "root\n", Deps: []string{"b2222222", "c3333333"}},
			{ID: "b2222222", Content: "b\n", Deps: []string{"d4444444"}},
			{ID: "c3333333", Content: "c\n", Deps: []string{"d4444444"}},
			{ID: "d4444444", Content: "d\n", Deps: []string{"e5555555"}},
			{ID: "e5555555", Content: "e\n"},
		},
		Heads: map[string]corpus.Head{
			"alice": {SnapshotFileID: "a1111111", SnapshotDefID: "x", PublishedAt: frozen},
		},
	}
}

func setHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

func TestOpenInstalledReadsActiveInstall(t *testing.T) {
	corpustest.Install(t, setHome(t), fixture())

	c, err := corpus.OpenInstalled()
	if err != nil {
		t.Fatalf("OpenInstalled: %v", err)
	}
	if got := c.FrozenDate(); got != "2026-11-01" {
		t.Errorf("FrozenDate = %q", got)
	}
	if got := c.ExportID(); got != "20261101T120000Z" {
		t.Errorf("ExportID = %q", got)
	}
	closure, err := c.Closure("a1111111")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"a1111111", "b2222222", "c3333333", "d4444444", "e5555555"}; !reflect.DeepEqual(closure, want) {
		t.Errorf("Closure = %v, want %v", closure, want)
	}
	content, err := c.Content("d4444444")
	if err != nil || string(content) != "d\n" {
		t.Errorf("Content = %q, %v", content, err)
	}
	if c.Has("f6666666") {
		t.Error("Has(unknown) = true")
	}
	head, ok, err := c.Head("ALiCe")
	if err != nil || !ok || head.SnapshotFileID != "a1111111" || !head.PublishedAt.Equal(frozen) {
		t.Errorf("Head(ALiCe) = %+v, %v, %v", head, ok, err)
	}
	if _, ok, err := c.Head("bob"); ok || err != nil {
		t.Errorf("Head(bob) = %v, %v; want not found", ok, err)
	}
}

func TestOpenInstalledTreatsIncompleteInstallAsMissing(t *testing.T) {
	cases := map[string]func(t *testing.T, install string){
		"no pointer": func(t *testing.T, install string) {
			mustRemove(t, filepath.Join(filepath.Dir(install), corpus.PointerFile))
		},
		"unmarked dir": func(t *testing.T, install string) {
			mustRemove(t, filepath.Join(install, corpus.MarkerFile))
		},
		"marker for another install": func(t *testing.T, install string) {
			mustWrite(t, filepath.Join(install, corpus.MarkerFile), strings.Repeat("0", 64))
		},
		"pointer escapes corpus dir": func(t *testing.T, install string) {
			mustWrite(t, filepath.Join(filepath.Dir(install), corpus.PointerFile), "../"+filepath.Base(install))
		},
	}
	for name, breakInstall := range cases {
		t.Run(name, func(t *testing.T) {
			install := corpustest.Install(t, setHome(t), fixture())
			breakInstall(t, install)
			if _, err := corpus.OpenInstalled(); !errors.Is(err, corpus.ErrNotInstalled) {
				t.Fatalf("OpenInstalled error = %v, want ErrNotInstalled", err)
			}
		})
	}
	setHome(t)
	if _, err := corpus.OpenInstalled(); !errors.Is(err, corpus.ErrNotInstalled) || !strings.Contains(err.Error(), "run `axm upgrade`") {
		t.Fatalf("no corpus dir: error = %v, want ErrNotInstalled naming axm upgrade", err)
	}
}

func TestClosureRejectsDanglingDependency(t *testing.T) {
	f := fixture()
	f.Files[4].Deps = []string{"f6666666"}
	root := t.TempDir()
	corpustest.Write(t, root, f)
	c, err := corpus.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Closure("a1111111"); err == nil || !strings.Contains(err.Error(), "f6666666") {
		t.Fatalf("Closure error = %v, want dangling dependency named", err)
	}
}

func TestOpenRejectsInvalidFileID(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "corpus.json"), `{"frozen_at":"2026-11-01T12:00:00Z","files":[{"id":"../escape","deps":[]}]}`)
	if _, err := corpus.Open(root); err == nil || !strings.Contains(err.Error(), "invalid file id") {
		t.Fatalf("Open error = %v, want invalid file id", err)
	}
}

func TestIndexesAndFiles(t *testing.T) {
	f := fixture()
	alice := "alice"
	f.Files[1].Publisher = &alice
	f.Files[1].PublishedAt = time.Date(2026, 3, 5, 0, 0, 0, 0, time.UTC)
	f.Index = corpus.SearchIndex{
		Constants: []corpus.Constant{{DefID: "k1", Name: "Foo.bar", Kind: "def", FileID: "b2222222", Publisher: &alice}},
		Types:     []corpus.TypeHead{{TypeHead: "Nat", SearchableName: "Nat", Params: []corpus.TypeParam{}}},
		Users:     []corpus.User{{Username: "alice"}},
	}
	f.Refs = []corpus.ModelingRef{{Slug: "s", Category: "example", Description: "d", FileID: "a1111111"}}
	root := t.TempDir()
	corpustest.Write(t, root, f)
	c, err := corpus.Open(root)
	if err != nil {
		t.Fatal(err)
	}

	files := c.Files()
	var ids []string
	for _, file := range files {
		ids = append(ids, file.ID)
	}
	if want := []string{"a1111111", "b2222222", "c3333333", "d4444444", "e5555555"}; !reflect.DeepEqual(ids, want) {
		t.Errorf("Files ids = %v, want %v", ids, want)
	}
	if files[1].Publisher == nil || *files[1].Publisher != "alice" || files[1].PublishedAt.Month() != time.March {
		t.Errorf("Files[1] = %+v", files[1])
	}
	if files[0].Publisher != nil || !files[0].PublishedAt.Equal(frozen) {
		t.Errorf("Files[0] = %+v", files[0])
	}

	idx, err := c.SearchIndex()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(idx, f.Index) {
		t.Errorf("SearchIndex = %+v, want %+v", idx, f.Index)
	}
	refs, err := c.ModelingRefs()
	if err != nil || !reflect.DeepEqual(refs, f.Refs) {
		t.Errorf("ModelingRefs = %+v, %v", refs, err)
	}
}

func TestIndexReadErrorsNameTheFile(t *testing.T) {
	root := t.TempDir()
	corpustest.Write(t, root, fixture())
	mustWrite(t, filepath.Join(root, "search-index.json"), "{")
	mustRemove(t, filepath.Join(root, "modeling-refs.json"))
	c, err := corpus.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.SearchIndex(); err == nil || !strings.Contains(err.Error(), "parsing "+filepath.Join(root, "search-index.json")) {
		t.Errorf("SearchIndex err = %v", err)
	}
	if _, err := c.ModelingRefs(); !errors.Is(err, os.ErrNotExist) || !strings.Contains(err.Error(), "modeling-refs.json") {
		t.Errorf("ModelingRefs err = %v", err)
	}
}

func mustRemove(t *testing.T, path string) {
	t.Helper()
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
