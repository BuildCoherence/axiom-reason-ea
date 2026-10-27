package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// The corpus builds on these pins only (corpus-export project.go writes them).
const (
	wantToolchain   = "leanprover/lean4:v4.34.0"
	wantAxiomLibTag = "v1.0.6-beta"
	wantAxiomLibRev = "ba3a485c6a01cde5ca66ae5c392b79296b624eb8"
)

type severity string

const (
	severityBlock  severity = "block"
	severityReview severity = "review"
)

// finding locates a defect by path plus a JSON pointer ("#/a/0") or line
// (":12"); it never carries the offending value.
type finding struct {
	Severity severity `json:"severity"`
	Check    string   `json:"check"`
	Path     string   `json:"path"`
	Where    string   `json:"where,omitempty"`
	Kind     string   `json:"kind"`
}

func (f finding) String() string {
	return fmt.Sprintf("%s %s %s%s %s", f.Severity, f.Check, f.Path, f.Where, f.Kind)
}

type gateOptions struct {
	skipLake bool
	lakeLog  string
	literals []literalSet
}

// rootFiles are the top-level entries every corpus carries.
var rootFiles = []string{
	"lean-toolchain", "lakefile.lean", "lake-manifest.json", "corpus.json", "modeling-refs.json",
	"search-index.json", "heads.json", "theorem-redirects.json", "AUTHORS", "NOTICE",
}

type corpusIndex struct {
	Toolchain       string          `json:"toolchain"`
	AxiomLibTag     string          `json:"axiomlib_tag"`
	AxiomLibRev     string          `json:"axiomlib_rev"`
	GraphGeneration json.RawMessage `json:"graph_generation"`
	Files           []struct {
		ID     string `json:"id"`
		SHA256 string `json:"sha256"`
	} `json:"files"`
}

type gate struct {
	root     string
	files    []string // slash-separated, relative to root, sorted
	decoded  map[string]any
	literals *literalMatcher
	findings []finding
}

func (g *gate) add(sev severity, check, rel, where, kind string) {
	g.findings = append(g.findings, finding{Severity: sev, Check: check, Path: rel, Where: where, Kind: kind})
}

func (g *gate) block(check, rel, where, kind string) { g.add(severityBlock, check, rel, where, kind) }

func runGate(ctx context.Context, root string, opts gateOptions) ([]finding, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", root)
	}
	g := &gate{root: root, decoded: map[string]any{}, literals: newLiteralMatcher(opts.literals)}
	if err := g.walk(); err != nil {
		return nil, err
	}
	g.checkLayout()
	g.checkReservedNames()
	g.decodeJSON()
	idx := g.index()
	g.checkPins(idx)
	g.checkHashes(idx)
	if err := g.checkImports(); err != nil {
		return nil, err
	}
	g.checkGraph(idx)
	if err := g.checkPII(); err != nil {
		return nil, err
	}
	if !opts.skipLake {
		if err := g.checkLakeBuild(ctx, opts.lakeLog); err != nil {
			return nil, err
		}
	}
	return g.findings, nil
}

// walk lists every regular file; a top-level .lake from an in-place build is
// not corpus content.
func (g *gate) walk() error {
	return filepath.WalkDir(g.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(g.root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == ".lake" {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			g.block("layout", rel, "", "not a regular file")
			return nil
		}
		g.files = append(g.files, rel)
		return nil
	})
}

func (g *gate) has(rel string) bool {
	i := sort.SearchStrings(g.files, rel)
	return i < len(g.files) && g.files[i] == rel
}

func (g *gate) read(rel string) ([]byte, error) {
	return os.ReadFile(filepath.Join(g.root, filepath.FromSlash(rel)))
}

func (g *gate) checkLayout() {
	for _, rel := range rootFiles {
		if !g.has(rel) {
			g.block("layout", rel, "", "missing")
		}
	}
}

var reservedDeviceNames = func() map[string]bool {
	m := map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true}
	for _, prefix := range []string{"COM", "LPT"} {
		for _, d := range []string{"0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"} {
			m[prefix+d] = true
		}
	}
	return m
}()

// isReservedName applies Windows' rule: the stem before the first dot, with
// trailing spaces dropped, names the device.
func isReservedName(part string) bool {
	stem, _, _ := strings.Cut(part, ".")
	return reservedDeviceNames[strings.ToUpper(strings.TrimRight(stem, " "))]
}

func (g *gate) checkReservedNames() {
	seen := map[string]bool{}
	for _, rel := range g.files {
		parts := strings.Split(rel, "/")
		for i, part := range parts {
			p := strings.Join(parts[:i+1], "/")
			if seen[p] {
				continue
			}
			seen[p] = true
			if isReservedName(part) {
				g.block("reserved-name", p, "", "Windows reserved device name")
			}
		}
	}
}

// jsonScope reports whether rel is one of the JSON files the gate decodes and
// greps as blocking.
func jsonScope(rel string) bool {
	switch rel {
	case "corpus.json", "heads.json", "search-index.json", "modeling-refs.json", "theorem-redirects.json":
		return true
	}
	return strings.HasPrefix(rel, "data/") || strings.HasPrefix(rel, "graph/")
}

func decodeStrict(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, errors.New("trailing data")
	}
	return v, nil
}

func (g *gate) decodeJSON() {
	for _, rel := range g.files {
		if !jsonScope(rel) {
			continue
		}
		data, err := g.read(rel)
		if err != nil {
			g.block("json", rel, "", "unreadable")
			continue
		}
		v, err := decodeStrict(data)
		if err != nil {
			g.block("json", rel, "", "undecodable")
			continue
		}
		g.decoded[rel] = v
	}
}

func (g *gate) index() *corpusIndex {
	if _, ok := g.decoded["corpus.json"]; !ok {
		return nil
	}
	data, err := g.read("corpus.json")
	if err != nil {
		return nil
	}
	var idx corpusIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		g.block("layout", "corpus.json", "", "unexpected shape")
		return nil
	}
	return &idx
}

func (g *gate) checkPins(idx *corpusIndex) {
	if g.has("lean-toolchain") {
		if data, err := g.read("lean-toolchain"); err != nil || strings.TrimSpace(string(data)) != wantToolchain {
			g.block("pins", "lean-toolchain", "", "toolchain is not "+wantToolchain)
		}
	}
	if g.has("lake-manifest.json") {
		var manifest struct {
			Packages []struct{ Name, Rev, InputRev string }
		}
		data, err := g.read("lake-manifest.json")
		if err == nil {
			err = json.Unmarshal(data, &manifest)
		}
		pinned := false
		for _, p := range manifest.Packages {
			if p.Name == "AxiomLib" {
				pinned = p.Rev == wantAxiomLibRev && p.InputRev == wantAxiomLibTag
			}
		}
		if err != nil || !pinned {
			g.block("pins", "lake-manifest.json", "", "AxiomLib is not pinned to "+wantAxiomLibTag+" at "+wantAxiomLibRev)
		}
	}
	if idx != nil && (idx.Toolchain != wantToolchain || idx.AxiomLibTag != wantAxiomLibTag || idx.AxiomLibRev != wantAxiomLibRev) {
		g.block("pins", "corpus.json", "", "toolchain or AxiomLib pin differs from the gate's")
	}
}

func safeID(id string) bool {
	return id != "" && id != "." && id != ".." && !strings.ContainsAny(id, "/\\\x00")
}

func (g *gate) checkHashes(idx *corpusIndex) {
	if idx == nil {
		return
	}
	listed := map[string]bool{}
	for i, f := range idx.Files {
		where := fmt.Sprintf("#/files/%d", i)
		if !safeID(f.ID) {
			g.block("sha256", "corpus.json", where, "unsafe file id")
			continue
		}
		rel := "A/" + f.ID + ".lean"
		if listed[rel] {
			g.block("sha256", "corpus.json", where, "duplicate file id")
			continue
		}
		listed[rel] = true
		if !g.has(rel) {
			g.block("sha256", rel, "", "listed in corpus.json but missing")
			continue
		}
		data, err := g.read(rel)
		if err != nil {
			g.block("sha256", rel, "", "unreadable")
			continue
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != f.SHA256 {
			g.block("sha256", rel, "", "SHA-256 differs from corpus.json")
		}
	}
	for _, rel := range g.files {
		if strings.HasPrefix(rel, "A/") && !listed[rel] {
			g.block("sha256", rel, "", "not listed in corpus.json")
		}
	}
}

func (g *gate) leanSources() []string {
	var out []string
	for _, rel := range g.files {
		if strings.HasPrefix(rel, "A/") && strings.HasSuffix(rel, ".lean") {
			out = append(out, rel)
		}
	}
	return out
}

func (g *gate) checkImports() error {
	for _, rel := range g.leanSources() {
		data, err := g.read(rel)
		if err != nil {
			return err
		}
		for _, imp := range headerImports(string(data)) {
			parts := strings.Split(strings.NewReplacer("«", "", "»", "").Replace(imp.module), ".")
			if parts[0] != "A" {
				continue
			}
			if len(parts) < 2 || !g.has(strings.Join(parts, "/")+".lean") {
				g.block("import", rel, fmt.Sprintf(":%d", imp.line), "import A.* does not resolve inside the corpus")
			}
		}
	}
	return nil
}

type leanImport struct {
	module string
	line   int
}

type leanToken struct {
	text string
	line int
}

// headerImports reads the Lean 4 module header: optional `module` and
// `prelude`, then `[public] [meta] import [all] <ident>` commands.
func headerImports(src string) []leanImport {
	var out []leanImport
	toks := headerTokens(src)
	for i := 0; i < len(toks); i++ {
		switch toks[i].text {
		case "module", "prelude", "public", "meta", "private":
			continue
		case "import":
			j := i + 1
			if j < len(toks) && toks[j].text == "all" {
				j++
			}
			if j < len(toks) {
				out = append(out, leanImport{module: toks[j].text, line: toks[j].line})
			}
			i = j
		default:
			return out
		}
	}
	return out
}

// headerTokens splits src on whitespace with line numbers, skipping line
// comments and nested block comments.
func headerTokens(src string) []leanToken {
	var toks []leanToken
	line, depth := 1, 0
	var cur strings.Builder
	curLine := 0
	flush := func() {
		if cur.Len() > 0 {
			toks = append(toks, leanToken{text: cur.String(), line: curLine})
			cur.Reset()
		}
	}
	rs := []rune(src)
	for i := 0; i < len(rs); i++ {
		r := rs[i]
		next := rune(0)
		if i+1 < len(rs) {
			next = rs[i+1]
		}
		switch {
		case r == '\n':
			flush()
			line++
		case depth > 0 && r == '-' && next == '/':
			depth--
			i++
		case r == '/' && next == '-':
			flush()
			depth++
			i++
		case depth > 0:
		case r == '-' && next == '-':
			flush()
			for i+1 < len(rs) && rs[i+1] != '\n' {
				i++
			}
		case unicode.IsSpace(r):
			flush()
		default:
			if cur.Len() == 0 {
				curLine = line
			}
			cur.WriteRune(r)
		}
	}
	flush()
	return toks
}

func (g *gate) checkGraph(idx *corpusIndex) {
	gens := map[string]bool{}
	for _, rel := range g.files {
		if rest, ok := strings.CutPrefix(rel, "graph/"); ok {
			gen, _, _ := strings.Cut(rest, "/")
			gens[gen] = true
		}
	}
	if idx != nil {
		gen := strings.TrimSpace(string(idx.GraphGeneration))
		if gen == "" || strings.Trim(gen, "0123456789") != "" {
			g.block("graph", "corpus.json", "#/graph_generation", "not a generation number")
		} else if !gens[gen] {
			g.block("graph", "graph/"+gen, "", "generation named by corpus.json is missing")
		}
	}
	names := make([]string, 0, len(gens))
	for gen := range gens {
		names = append(names, gen)
	}
	sort.Strings(names)
	for _, gen := range names {
		dir := "graph/" + gen + "/"
		for _, name := range []string{"manifest.json", "graph.json", "labels.json"} {
			if !g.has(dir + name) {
				g.block("graph", dir+name, "", "missing")
			}
		}
		manifest, ok := g.decoded[dir+"manifest.json"].(map[string]any)
		if !ok {
			if g.has(dir+"manifest.json") && g.decoded[dir+"manifest.json"] != nil {
				g.block("graph", dir+"manifest.json", "", "not a JSON object")
			}
			continue
		}
		for _, key := range []string{"geometry_path", "labels_path"} {
			p, _ := manifest[key].(string)
			if !strings.HasPrefix(p, "/") {
				g.block("graph", dir+"manifest.json", "#/"+key, "not a corpus-rooted path")
				continue
			}
			clean := path.Clean(p)
			if clean != p || strings.Contains(clean, "..") {
				g.block("graph", dir+"manifest.json", "#/"+key, "path escapes or is not canonical")
				continue
			}
			if !g.has(strings.TrimPrefix(clean, "/")) {
				g.block("graph", dir+"manifest.json", "#/"+key, "path does not resolve inside the corpus")
			}
		}
	}
}

// checkLakeBuild builds a copy of the Lean project so the corpus directory
// gains no .lake output.
func (g *gate) checkLakeBuild(ctx context.Context, logPath string) error {
	lake, err := exec.LookPath("lake")
	if err != nil {
		return fmt.Errorf("lake build: %w (install elan)", err)
	}
	work, err := os.MkdirTemp("", "corpus-gate-lake-")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(work) }()
	for _, rel := range []string{"lean-toolchain", "lakefile.lean", "lake-manifest.json"} {
		if !g.has(rel) {
			return nil
		}
		data, err := g.read(rel)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(work, rel), data, 0o644); err != nil {
			return err
		}
	}
	if src := filepath.Join(g.root, "A"); dirExists(src) {
		if err := os.CopyFS(filepath.Join(work, "A"), os.DirFS(src)); err != nil {
			return err
		}
	}
	cmd := exec.CommandContext(ctx, lake, "build")
	cmd.Dir = work
	out, runErr := cmd.CombinedOutput()
	if logPath != "" {
		if err := os.WriteFile(logPath, out, 0o644); err != nil {
			return err
		}
	}
	if runErr == nil {
		return nil
	}
	var exitErr *exec.ExitError
	if !errors.As(runErr, &exitErr) {
		return fmt.Errorf("lake build: %w", runErr)
	}
	failed := failedModules(string(out))
	if len(failed) == 0 {
		g.block("lake-build", ".", "", "lake build failed")
	}
	for _, rel := range failed {
		g.block("lake-build", rel, "", "lake build failed")
	}
	return nil
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// failedModules maps lake's "Some required targets logged failures" list to
// corpus paths; a failure outside A is reported against the project root.
func failedModules(out string) []string {
	_, list, ok := strings.Cut(out, "Some required targets logged failures:")
	if !ok {
		return nil
	}
	seen := map[string]bool{}
	var paths []string
	for _, line := range strings.Split(list, "\n") {
		target, ok := strings.CutPrefix(strings.TrimSpace(line), "- ")
		if !ok {
			continue
		}
		rel := "."
		if id, ok := strings.CutPrefix(target, "A."); ok {
			rel = "A/" + strings.ReplaceAll(id, ".", "/") + ".lean"
		}
		if !seen[rel] {
			seen[rel] = true
			paths = append(paths, rel)
		}
	}
	return paths
}
