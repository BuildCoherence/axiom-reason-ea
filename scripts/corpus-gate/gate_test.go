package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

const cleanReview = "review pii graph/7/labels.json#/0/label ipv4"

func TestCleanCorpusPasses(t *testing.T) {
	dir := cleanFixture().write(t)
	r := runCLI(t, gateOptions{skipLake: true}, dir)
	if r.code != exitPass {
		t.Fatalf("exit %d, want %d\nstdout:\n%s\nstderr:\n%s", r.code, exitPass, r.stdout, r.stderr)
	}
	if got := r.lines(); !reflect.DeepEqual(got, []string{cleanReview}) {
		t.Fatalf("findings %q, want only %q", got, cleanReview)
	}
	if !strings.Contains(r.stderr, "0 blocking, 1 for review") {
		t.Fatalf("stderr %q lacks the summary", r.stderr)
	}
}

// Each case plants one defect; the gate must exit 1 and name it by path
// without echoing the planted value.
func TestBlockingDefects(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(t *testing.T, f *fixture)
		after  func(t *testing.T, dir string)
		want   string
		secret string
	}{
		{
			name:   "unresolved import",
			mutate: func(_ *testing.T, f *fixture) { f.lean["aaaa0003"] = "prelude\npublic import A.zzzz9999\n" },
			want:   "block import A/aaaa0003.lean:2 import A.* does not resolve inside the corpus",
		},
		{
			name:   "import all of a missing nested module",
			mutate: func(_ *testing.T, f *fixture) { f.lean["aaaa0003"] = "import all A.aaaa0001.sub\n" },
			want:   "block import A/aaaa0003.lean:1 import A.* does not resolve inside the corpus",
		},
		{
			name: "sha mismatch",
			after: func(t *testing.T, dir string) {
				appendFile(t, filepath.Join(dir, "A", "aaaa0001.lean"), "-- edited\n")
			},
			want: "block sha256 A/aaaa0001.lean SHA-256 differs from corpus.json",
		},
		{
			name: "unlisted source",
			after: func(t *testing.T, dir string) {
				writeFile(t, filepath.Join(dir, "A", "aaaa0009.lean"), "theorem x : True := trivial\n")
			},
			want: "block sha256 A/aaaa0009.lean not listed in corpus.json",
		},
		{
			name: "listed source missing",
			after: func(t *testing.T, dir string) {
				if err := os.Remove(filepath.Join(dir, "A", "aaaa0001.lean")); err != nil {
					t.Fatal(err)
				}
			},
			want: "block sha256 A/aaaa0001.lean listed in corpus.json but missing",
		},
		{
			name: "reserved device name",
			mutate: func(_ *testing.T, f *fixture) {
				f.json["data/u/con.json"] = map[string]any{"profile": map[string]any{"username": "con"}}
			},
			want: "block reserved-name data/u/con.json Windows reserved device name",
		},
		{
			name:   "superscript reserved device name directory",
			mutate: func(_ *testing.T, f *fixture) { f.json["data/def/LPT³/x.json"] = map[string]any{} },
			want:   "block reserved-name data/def/LPT³ Windows reserved device name",
		},
		{
			name: "undecodable graph file",
			after: func(t *testing.T, dir string) {
				writeFile(t, filepath.Join(dir, "graph", "7", "labels.json"), `[{"id": "cccc0001"`)
			},
			want: "block json graph/7/labels.json undecodable",
		},
		{
			name: "graph file with trailing data",
			after: func(t *testing.T, dir string) {
				appendFile(t, filepath.Join(dir, "graph", "7", "graph.json"), "{}\n")
			},
			want: "block json graph/7/graph.json undecodable",
		},
		{
			name: "manifest path outside the corpus files",
			mutate: func(_ *testing.T, f *fixture) {
				f.json["graph/7/manifest.json"].(map[string]any)["labels_path"] = "/graph/8/labels.json"
			},
			want: "block graph graph/7/manifest.json#/labels_path path does not resolve inside the corpus",
		},
		{
			name: "manifest path escaping the corpus",
			mutate: func(_ *testing.T, f *fixture) {
				f.json["graph/7/manifest.json"].(map[string]any)["geometry_path"] = "/graph/../../etc/passwd"
			},
			want: "block graph graph/7/manifest.json#/geometry_path path escapes or is not canonical",
		},
		{
			name: "missing generation",
			after: func(t *testing.T, dir string) {
				if err := os.Rename(filepath.Join(dir, "graph", "7"), filepath.Join(dir, "graph", "6")); err != nil {
					t.Fatal(err)
				}
			},
			want: "block graph graph/7 generation named by corpus.json is missing",
		},
		{
			name:   "toolchain pin",
			mutate: func(_ *testing.T, f *fixture) { f.text["lean-toolchain"] = "leanprover/lean4:v4.35.0\n" },
			want:   "block pins lean-toolchain toolchain is not " + wantToolchain,
		},
		{
			name:   "missing index file",
			mutate: func(_ *testing.T, f *fixture) { delete(f.json, "heads.json") },
			want:   "block layout heads.json missing",
		},
		{
			name:   "email in data",
			mutate: func(_ *testing.T, f *fixture) { profile(f)["bio"] = "write to Jane.Doe+x@mail.example.org" },
			want:   "block pii data/u/alice.json#/profile/bio email",
			secret: "Jane.Doe",
		},
		{
			name:   "firebase uid in data",
			mutate: func(_ *testing.T, f *fixture) { profile(f)["user_id"] = "Xq3ZbK9mWfPtR2sLvN8cYd4HgJ1e" },
			want:   "block pii data/u/alice.json#/profile/user_id firebase-uid",
			secret: "Xq3ZbK9mWfPtR2sLvN8cYd4HgJ1e",
		},
		{
			name:   "ipv4 in data",
			mutate: func(_ *testing.T, f *fixture) { profile(f)["last_ip"] = "seen from 203.0.113.42." },
			want:   "block pii data/u/alice.json#/profile/last_ip ipv4",
			secret: "203.0.113.42",
		},
		{
			name:   "ipv6 in data",
			mutate: func(_ *testing.T, f *fixture) { profile(f)["last_ip"] = "2001:db8:85a3::8a2e:370:7334" },
			want:   "block pii data/u/alice.json#/profile/last_ip ipv6",
			secret: "2001:db8",
		},
		{
			name: "ipv6 beside a token id",
			mutate: func(_ *testing.T, f *fixture) {
				profile(f)["token_id"] = "Foo.Bar::src::3"
				profile(f)["last_ip"] = "2001:db8:85a3::8a2e:370:7334"
			},
			want:   "block pii data/u/alice.json#/profile/last_ip ipv6",
			secret: "2001:db8",
		},
		{
			name: "user agent in data",
			mutate: func(_ *testing.T, f *fixture) {
				profile(f)["ua"] = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
			},
			want:   "block pii data/u/alice.json#/profile/ua user-agent",
			secret: "Mozilla",
		},
		{
			name: "email as a key withholds the key",
			mutate: func(_ *testing.T, f *fixture) {
				f.json["heads.json"].(map[string]any)["bob@example.com"] = map[string]any{}
			},
			want:   "block pii heads.json#/<key> email",
			secret: "bob@example.com",
		},
		{
			name: "email in graph labels publishers",
			mutate: func(_ *testing.T, f *fixture) {
				f.json["graph/7/labels.json"].([]any)[0].(map[string]any)["pubs"] = []any{"eve@example.com"}
			},
			want:   "block pii graph/7/labels.json#/0/pubs/0 email",
			secret: "eve@example.com",
		},
		{
			name:   "email in AUTHORS",
			mutate: func(_ *testing.T, f *fixture) { f.text["AUTHORS"] += "mallory@example.com\n" },
			want:   "block pii AUTHORS:5 email",
			secret: "mallory@example.com",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := cleanFixture()
			if tc.mutate != nil {
				tc.mutate(t, f)
			}
			dir := f.write(t)
			if tc.after != nil {
				tc.after(t, dir)
			}
			r := runCLI(t, gateOptions{skipLake: true}, dir)
			if r.code != exitBlock {
				t.Fatalf("exit %d, want %d\nstdout:\n%s\nstderr:\n%s", r.code, exitBlock, r.stdout, r.stderr)
			}
			if !slices.Contains(r.lines(), tc.want) {
				t.Fatalf("findings lack %q:\n%s", tc.want, r.stdout)
			}
			if tc.secret != "" && strings.Contains(r.stdout+r.stderr, tc.secret) {
				t.Fatalf("diagnostics echo the planted value %q:\n%s", tc.secret, r.stdout)
			}
		})
	}
}

func profile(f *fixture) map[string]any {
	return f.json["data/u/alice.json"].(map[string]any)["profile"].(map[string]any)
}

// Lean source and its JSON copies are the public record: hits there are
// reported for review and do not fail the gate.
func TestLeanSourceHitsAreReviewOnly(t *testing.T) {
	f := cleanFixture()
	f.lean["aaaa0003"] = "import A.aaaa0001\n\n/-- Contact: carol@example.com -/\ntheorem t3 : True := t1\n"
	f.json["data/f/aaaa0001.json"].(map[string]any)["file"].(map[string]any)["content"] = "-- dave@example.com\n"
	f.json["data/def/bbbb0001.json"].(map[string]any)["def"].(map[string]any)["file_content"] = "-- 198.51.100.7\n"
	dir := f.write(t)
	r := runCLI(t, gateOptions{skipLake: true}, dir)
	if r.code != exitPass {
		t.Fatalf("exit %d, want %d\n%s", r.code, exitPass, r.stdout)
	}
	want := []string{
		"review pii A/aaaa0003.lean:3 email",
		"review pii data/def/bbbb0001.json#/def/file_content ipv4",
		"review pii data/f/aaaa0001.json#/file/content email",
		cleanReview,
	}
	got := r.lines()
	slices.Sort(got)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("findings\n%q\nwant\n%q", got, want)
	}
	if strings.Contains(r.stdout, "example.com") {
		t.Fatalf("diagnostics echo a planted value:\n%s", r.stdout)
	}
}

// Validator token ids end in `::<i>`, which parses as IPv6.
func TestTokenIDsAreNotScanned(t *testing.T) {
	f := cleanFixture()
	def := f.json["data/def/bbbb0001.json"].(map[string]any)["def"].(map[string]any)
	def["source_tokens"] = []any{map[string]any{"token_id": "Foo.Bar::src::3"}, map[string]any{"token_id": "c::author"}}
	r := runCLI(t, gateOptions{skipLake: true}, f.write(t))
	if r.code != exitPass {
		t.Fatalf("exit %d, want %d\n%s", r.code, exitPass, r.stdout)
	}
	if got := r.lines(); !reflect.DeepEqual(got, []string{cleanReview}) {
		t.Fatalf("findings %q, want only %q", got, cleanReview)
	}
}

func TestReportFile(t *testing.T) {
	f := cleanFixture()
	profile(f)["email"] = "x@example.com"
	dir := f.write(t)
	report := filepath.Join(t.TempDir(), "findings.json")
	r := runCLI(t, gateOptions{skipLake: true}, "-report", report, dir)
	if r.code != exitBlock {
		t.Fatalf("exit %d, want %d", r.code, exitBlock)
	}
	data, err := os.ReadFile(report)
	if err != nil {
		t.Fatal(err)
	}
	var got struct{ Findings []finding }
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	want := []finding{
		{Severity: severityBlock, Check: "pii", Path: "data/u/alice.json", Where: "#/profile/email", Kind: piiEmail},
		{Severity: severityReview, Check: "pii", Path: "graph/7/labels.json", Where: "#/0/label", Kind: piiIPv4},
	}
	if !reflect.DeepEqual(got.Findings, want) {
		t.Fatalf("report findings %+v, want %+v", got.Findings, want)
	}
}

func TestUsageAndEnvironmentErrors(t *testing.T) {
	if r := runCLI(t, gateOptions{skipLake: true}); r.code != exitError {
		t.Fatalf("no argument: exit %d, want %d", r.code, exitError)
	}
	if r := runCLI(t, gateOptions{skipLake: true}, filepath.Join(t.TempDir(), "absent")); r.code != exitError {
		t.Fatalf("absent corpus: exit %d, want %d", r.code, exitError)
	}
	dir := cleanFixture().write(t)
	t.Setenv("PATH", t.TempDir())
	r := runCLI(t, gateOptions{}, dir)
	if r.code != exitError || !strings.Contains(r.stderr, "lake build") {
		t.Fatalf("without lake: exit %d stderr %q, want %d naming lake build", r.code, r.stderr, exitError)
	}
}

func TestReservedNames(t *testing.T) {
	for name, want := range map[string]bool{
		"CON": true, "con.json": true, "Aux.tar.gz": true, "nul ": true, "COM0": true, "com9.lean": true,
		"COM¹": true, "lpt².json": true, "LPT3": true, "console.json": false, "COM10": false, "LPT": false,
		"prn1": false, "aaaa0001.lean": false, ".lake": false,
	} {
		if got := isReservedName(name); got != want {
			t.Errorf("isReservedName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestPIIKindsIgnoreCorpusShapes(t *testing.T) {
	for _, s := range []string{
		"2026-10-01T12:00:00Z", "2026-10-01T12:00:00.123+00:00", "leanprover/lean4:v4.34.0", "1.0.6-beta",
		"ba3a485c6a01cde5ca66ae5c392b79296b624eb8", "aaaa0001", "x :: xs", "1.2.3.4.5", "999.1.1.1",
		"@[simp] theorem foo", "support at example dot com", "alllowercaseidentifierof28ch",
	} {
		if kinds := piiKinds(s); len(kinds) != 0 {
			t.Errorf("piiKinds(%q) = %v, want none", s, kinds)
		}
	}
	for s, want := range map[string]string{
		"a@b.co":                            piiEmail,
		"10.0.0.1":                          piiIPv4,
		"::1":                               piiIPv6,
		"fe80::1ff:fe23:4567:890a.":         piiIPv6,
		"curl/8.5.0":                        piiUserAgent,
		"python-requests/2.31":              piiUserAgent,
		"uid=Xq3ZbK9mWfPtR2sLvN8cYd4HgJ1e;": piiUID,
	} {
		if got := piiKinds(s); !reflect.DeepEqual(got, []string{want}) {
			t.Errorf("piiKinds(%q) = %v, want [%s]", s, got, want)
		}
	}
}

func TestHeaderImports(t *testing.T) {
	src := "module\n-- import A.ignored\n/- import A.alsoIgnored\n/- nested -/ -/\nprelude\n" +
		"public import A.«aaaa0001»\nmeta import all Axiom\nimport\n  A.aaaa0002\n\ntheorem t : True := trivial\nimport A.late\n"
	got := headerImports(src)
	want := []leanImport{{"A.«aaaa0001»", 6}, {"Axiom", 7}, {"A.aaaa0002", 9}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("headerImports = %+v, want %+v", got, want)
	}
}

// The lake output shape is lake v4.34.0's failure summary.
func TestFailedModules(t *testing.T) {
	out := "✔ [2/4] Built A.aaaa0001 (1.8s)\n✖ [3/4] Building A.aaaa0002 (243ms)\n" +
		"error: A/aaaa0002.lean:3:23: Type mismatch\nSome required targets logged failures:\n- A.aaaa0002\n- Axiom.Core\n" +
		"error: build failed\n"
	if got, want := failedModules(out), []string{"A/aaaa0002.lean", "."}; !reflect.DeepEqual(got, want) {
		t.Fatalf("failedModules = %q, want %q", got, want)
	}
}

// The gate's pins equal the lean-client template's while both live in one
// repository; the template is absent after extraction.
func TestPinsMatchLeanClient(t *testing.T) {
	toolchain, err := os.ReadFile("../../lean-client/lean-toolchain")
	if os.IsNotExist(err) {
		t.Skip("lean-client template not present")
	}
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(toolchain)) != wantToolchain {
		t.Fatalf("lean-client toolchain %q, gate %q", toolchain, wantToolchain)
	}
	raw, err := os.ReadFile("../../lean-client/lake-manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Packages []struct{ Name, Rev, InputRev string }
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, p := range manifest.Packages {
		if p.Name == "AxiomLib" {
			if p.Rev != wantAxiomLibRev || p.InputRev != wantAxiomLibTag {
				t.Fatalf("lean-client AxiomLib %s %s, gate %s %s", p.InputRev, p.Rev, wantAxiomLibTag, wantAxiomLibRev)
			}
			return
		}
	}
	t.Fatal("lean-client manifest has no AxiomLib package")
}

func writeFile(t *testing.T, path, s string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

func appendFile(t *testing.T, path, s string) {
	t.Helper()
	fh, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fh.WriteString(s); err != nil {
		t.Fatal(err)
	}
	if err := fh.Close(); err != nil {
		t.Fatal(err)
	}
}

// Account text from the export database blocks as a whole JSON value or
// AUTHORS line, and is review-only inside Lean source.
func TestAccountLiterals(t *testing.T) {
	f := cleanFixture()
	f.lean["aaaa0003"] = "/-- by Planted Person, see Planted Person's notes -/\ntheorem t3 : True := trivial\n"
	f.json["data/f/aaaa0001.json"].(map[string]any)["file"].(map[string]any)["lean_version"] = "planted person"
	f.json["data/def/bbbb0001.json"].(map[string]any)["def"].(map[string]any)["file_content"] = "-- Planted Person\n"
	f.json["data/theorem/bbbb0001.json"].(map[string]any)["file_content"] = "-- UnplantedPersonal\n"
	profile(f)["note"] = " A planted bio sentence. "
	profile(f)["ghost"] = map[string]any{"Lurker": 1}
	f.text["AUTHORS"] += "lurker\n"
	dir := f.write(t)
	literals := `[{"kind": "display-name", "values": ["Planted Person", ""], "review_in_source": true},
		{"kind": "bio", "values": ["a planted bio sentence."], "review_in_source": true},
		{"kind": "username", "values": ["lurker"]}]`

	var stdout, stderr bytes.Buffer
	code := run(context.Background(), []string{"-literals", "-", dir}, strings.NewReader(literals), &stdout, &stderr,
		gateOptions{skipLake: true})
	if code != exitBlock {
		t.Fatalf("exit %d, want %d\n%s%s", code, exitBlock, stdout.String(), stderr.String())
	}
	got := strings.FieldsFunc(stdout.String(), func(c rune) bool { return c == '\n' })
	slices.Sort(got)
	want := []string{
		"block pii AUTHORS:5 username",
		"block pii data/f/aaaa0001.json#/file/lean_version display-name",
		"block pii data/u/alice.json#/profile/ghost/<key> username",
		"block pii data/u/alice.json#/profile/note bio",
		"review pii A/aaaa0003.lean:1 display-name",
		"review pii data/def/bbbb0001.json#/def/file_content display-name",
		cleanReview,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("findings\n%q\nwant\n%q", got, want)
	}
	for _, v := range []string{"Planted", "planted", "lurker", "Lurker"} {
		if strings.Contains(stdout.String(), v) {
			t.Fatalf("diagnostics echo literal %q:\n%s", v, stdout.String())
		}
	}

	path := filepath.Join(t.TempDir(), "literals.json")
	writeFile(t, path, literals)
	if r := runCLI(t, gateOptions{skipLake: true}, "-literals", path, dir); r.code != exitBlock {
		t.Fatalf("-literals file: exit %d, want %d", r.code, exitBlock)
	}
	if r := runCLI(t, gateOptions{skipLake: true}, "-literals", path, cleanFixture().write(t)); r.code != exitPass {
		t.Fatalf("clean corpus with literals: exit %d, want %d\n%s", r.code, exitPass, r.stdout)
	}
	writeFile(t, path, `{"kind": "bio"}`)
	if r := runCLI(t, gateOptions{skipLake: true}, "-literals", path, dir); r.code != exitError {
		t.Fatalf("malformed literals: exit %d, want %d", r.code, exitError)
	}
}

func TestLiteralWordBoundaries(t *testing.T) {
	m := newLiteralMatcher([]literalSet{
		{Kind: "display-name", Values: []string{"Sam", "★ Star", "Ann-Marie"}, ReviewInSource: true},
		{Kind: "username", Values: []string{"bob"}},
	})
	for s, want := range map[string][]string{
		"-- Sam wrote this":     {"display-name"},
		"sample sam_lemma Sams": nil,
		"by (sam)":              {"display-name"},
		"x ★ star y":            {"display-name"},
		"ann-marie.lemma":       {"display-name"},
		"bob":                   {"username"},
		"-- bob was here":       nil,
	} {
		if got := m.inSource(s); !slices.Equal(got, want) {
			t.Errorf("inSource(%q) = %v, want %v", s, got, want)
		}
	}
	if got := m.wholeValue(" SAM "); !reflect.DeepEqual(got, []string{"display-name"}) {
		t.Errorf("wholeValue ignores case and padding: %v", got)
	}
	if got := m.wholeValue("Sam wrote"); got != nil {
		t.Errorf("wholeValue matched a longer value: %v", got)
	}
}
