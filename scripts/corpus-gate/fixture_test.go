package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// fixture is a Published Corpus in the layout corpus-export writes; write
// derives corpus.json's file entries from lean.
type fixture struct {
	lean  map[string]string
	json  map[string]any
	text  map[string]string
	index map[string]any
}

const fixtureLakefile = `import Lake
open Lake DSL

package axiomCorpus where
  leanOptions := #[⟨` + "`" + `autoImplicit, false⟩]

require AxiomLib from git "https://github.com/BuildCoherence/axiom-lib" @ "` + wantAxiomLibTag + `"

@[default_target]
lean_lib A where
  roots := #[` + "`" + `A]
  globs := #[Glob.submodules ` + "`" + `A]
`

const fixtureManifest = `{"version": "1.1.0",
 "packagesDir": ".lake/packages",
 "packages":
 [{"url": "https://github.com/BuildCoherence/axiom-lib",
   "type": "git",
   "subDir": null,
   "scope": "",
   "rev": "` + wantAxiomLibRev + `",
   "name": "AxiomLib",
   "manifestFile": "lake-manifest.json",
   "inputRev": "` + wantAxiomLibTag + `",
   "inherited": false,
   "configFile": "lakefile.toml"}],
 "name": "axiomCorpus",
 "lakeDir": ".lake"}
`

func cleanFixture() *fixture {
	return &fixture{
		lean: map[string]string{
			"aaaa0001": "import Axiom\n\n/-- A doc comment. -/\ntheorem t1 : True := trivial\n",
			"aaaa0002": "-- header comment\n/- block /- nested -/ comment -/\nimport A.aaaa0001\n\n" +
				"@[simp] theorem t2 : True := t1\n\ndef pairs (h : Nat × Nat × Nat) : Nat := h.1 + h.2.1 + h.2.2\n",
		},
		text: map[string]string{
			"lean-toolchain": wantToolchain + "\n",
			"lakefile.lean":  fixtureLakefile,
			"AUTHORS":        "Publishers of files in this corpus (publication does not claim authorship)\n\nalice\nunattributed (account removed)\n",
			"NOTICE":         "Requests to remove a file go to support@coherencelabs.net and are honored.\n",
		},
		json: map[string]any{
			"heads.json":             map[string]any{"alice": map[string]any{"snapshot_file_id": "aaaa0001", "snapshot_def_id": "bbbb0001", "published_at": "2026-10-01T12:00:00Z"}},
			"theorem-redirects.json": map[string]any{"bbbb0003": map[string]any{"file_id": "aaaa0002", "proposition_id": "cccc0001"}},
			"modeling-refs.json":     []any{map[string]any{"slug": "free-will", "category": "metaphysics", "description": "A reference model.", "file_id": "aaaa0002"}},
			"search-index.json": map[string]any{
				"constants": []any{map[string]any{"def_id": "bbbb0001", "name": "t1", "kind": "theorem", "type_head": "True",
					"file_id": "aaaa0001", "created_at": "2026-10-01T12:00:00.123456Z", "publisher": "alice",
					"decl_byte_start": 14, "signature_byte_end": 40, "declaration_role": "theorem"}},
				"types": []any{map[string]any{"type_head": "Builtin", "searchable_name": "Builtin", "arity": 1,
					"params":  []any{map[string]any{"index": 0, "name": "a", "type": "Prop", "binder": "default"}},
					"file_id": nil, "def_id": nil, "kind": nil, "publisher": nil, "created_at": nil}},
				"users": []any{map[string]any{"username": "alice", "first_published_at": "2026-10-01T12:00:00Z"}},
			},
			"data/f/aaaa0001.json": map[string]any{"file": map[string]any{"id": "aaaa0001", "content": "theorem t1 : True := trivial\n",
				"lean_version": "4.34.0", "created_at": "2026-10-01T12:00:00+00:00", "forked_from": nil,
				"publisher": map[string]any{"username": "alice"}}, "closure": []any{"aaaa0001"}},
			"data/u/alice.json": map[string]any{"profile": map[string]any{"username": "alice"},
				"held_propositions": map[string]any{"popularity": map[string]any{"items": []any{}, "graph_slice": []any{}, "total": 0}}},
			"data/def/bbbb0001.json": map[string]any{"def": map[string]any{"file_content": "theorem t1 : True := trivial\n",
				"decl": map[string]any{"def_id": "bbbb0001", "qualified_name": "t1"}}, "referenced_by": []any{}},
			"data/prop/cccc0001.json": map[string]any{"proposition": map[string]any{"proposition_id": "cccc0001"},
				"holders": map[string]any{"proposition_id": "cccc0001", "pro": []any{}, "con": []any{}}},
			"data/theorem/bbbb0001.json": map[string]any{"created_at": "2026-10-01T12:00:00Z", "file_content": "x :: xs"},
			"graph/7/manifest.json": map[string]any{"format_version": 3, "generation": 7, "built_at": "2026-10-01T12:00:00Z",
				"geometry_path": "/graph/7/graph.json", "labels_path": "/graph/7/labels.json"},
			"graph/7/graph.json":  map[string]any{"format_version": 3, "generation": 7, "nodes": []any{map[string]any{"id": "cccc0001", "x": 0.25}}, "edges": []any{}},
			"graph/7/labels.json": []any{map[string]any{"id": "cccc0001", "label": "h.1.2.3.4", "pubs": []any{"alice"}}},
		},
		index: map[string]any{
			"export_id": "20261001T120000Z", "frozen_at": "2026-10-01T12:00:00Z", "toolchain": wantToolchain,
			"axiomlib_tag": wantAxiomLibTag, "axiomlib_rev": wantAxiomLibRev, "graph_generation": 7,
			"counts": map[string]any{"files": 2}, "theorems": []any{"bbbb0001"}, "proposition_aliases": map[string]any{},
		},
	}
}

func (f *fixture) write(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	put := func(rel string, data []byte) {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	ids := make([]string, 0, len(f.lean))
	for id := range f.lean {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	files := []any{}
	for _, id := range ids {
		sum := sha256.Sum256([]byte(f.lean[id]))
		files = append(files, map[string]any{"id": id, "sha256": hex.EncodeToString(sum[:]), "publisher": "alice",
			"published_at": "2026-10-01T12:00:00Z", "forked_from": nil, "deps": []any{}})
		put("A/"+id+".lean", []byte(f.lean[id]))
	}
	index := map[string]any{"files": files}
	for k, v := range f.index {
		index[k] = v
	}
	f.json["corpus.json"] = index
	for rel, v := range f.json {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		if err := enc.Encode(v); err != nil {
			t.Fatal(err)
		}
		put(rel, buf.Bytes())
	}
	for rel, s := range f.text {
		put(rel, []byte(s))
	}
	put("lake-manifest.json", []byte(fixtureManifest))
	return dir
}

type gateRun struct {
	code           int
	stdout, stderr string
}

func runCLI(t *testing.T, opts gateOptions, args ...string) gateRun {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := run(context.Background(), args, strings.NewReader(""), &stdout, &stderr, opts)
	return gateRun{code: code, stdout: stdout.String(), stderr: stderr.String()}
}

func (r gateRun) lines() []string {
	return strings.FieldsFunc(r.stdout, func(c rune) bool { return c == '\n' })
}
