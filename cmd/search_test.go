package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus/corpustest"
)

func strp(s string) *string { return &s }

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func dayp(y int, m time.Month, d int) *time.Time {
	t := day(y, m, d)
	return &t
}

// searchFixture: four files by alice, bob and a removed account, with index
// rows dated so every filter and sort direction separates them.
func searchFixture() corpustest.Fixture {
	return corpustest.Fixture{
		FrozenAt: fxFrozenAt,
		Files: []corpustest.File{
			{ID: "a1111111", Publisher: strp("alice"), PublishedAt: day(2026, 1, 10),
				Content: "import Foo\ndef carrierAlpha : Nat := 1\n-- CARRIER note\n"},
			{ID: "b2222222", Publisher: strp("bob"), PublishedAt: day(2026, 3, 5),
				Content: "def beta := carrier\n"},
			{ID: "c3333333", PublishedAt: day(2026, 2, 1),
				Content: "theorem gamma : True := trivial\n"},
			{ID: "d4444444", Publisher: strp("alice"), PublishedAt: day(2026, 4, 1),
				Content: "def delta := 0\n"},
		},
		Index: corpus.SearchIndex{
			Constants: []corpus.Constant{
				{DefID: "k1", Name: "Foo.carrierAlpha", Kind: "def", TypeHead: strp("Axiom.Statement"), FileID: "a1111111",
					CreatedAt: day(2026, 1, 10), Publisher: strp("alice"), DeclByteStart: 11, SignatureByteEnd: 35},
				{DefID: "k2", Name: "Bar.beta", Kind: "theorem", TypeHead: strp("Axiom.Statement"), FileID: "b2222222",
					CreatedAt: day(2026, 3, 5), Publisher: strp("bob"), DeclarationRole: strp("statement")},
				{DefID: "k3", Name: "Baz.gamma", Kind: "theorem", FileID: "c3333333", CreatedAt: day(2026, 2, 1)},
				{DefID: "k4", Name: "Foo.delta", Kind: "axiom", TypeHead: strp("Axiom.Other"), FileID: "d4444444",
					CreatedAt: day(2026, 4, 1), Publisher: strp("alice")},
			},
			Types: []corpus.TypeHead{
				{TypeHead: "Nat", SearchableName: "Nat", Params: []corpus.TypeParam{}},
				{TypeHead: "Axiom.Statement", SearchableName: "Statement", Arity: 1,
					Params: []corpus.TypeParam{{Index: 0, Name: "p", Type: "Prop", Binder: "default"}},
					FileID: strp("a1111111"), DefID: strp("k1"), Kind: strp("def"), Publisher: strp("alice"),
					CreatedAt: dayp(2026, 1, 10)},
				{TypeHead: "Axiom.Empty", SearchableName: "EmptyHead", Params: []corpus.TypeParam{},
					FileID: strp("b2222222"), DefID: strp("k2"), Kind: strp("def"), Publisher: strp("bob"),
					CreatedAt: dayp(2026, 3, 5)},
			},
			Users: []corpus.User{
				{Username: "alice", FirstPublishedAt: dayp(2026, 1, 10)},
				{Username: "bob", FirstPublishedAt: dayp(2026, 3, 5)},
				{Username: "carol"},
			},
		},
		Refs: []corpus.ModelingRef{
			{Slug: "actual-bridge", Category: "convention", Description: "the bridge", FileID: "a1111111"},
			{Slug: "worked-example", Category: "example", Description: "an example", FileID: "b2222222"},
			{Slug: "second-convention", Category: "convention", Description: "another", FileID: "d4444444"},
		},
	}
}

// installSearchFixture installs searchFixture in a fresh home and forbids HTTP.
func installSearchFixture(t *testing.T) {
	t.Helper()
	forbidHTTP(t)
	corpustest.Install(t, setTestHome(t), searchFixture())
}

func runCobra(t *testing.T, c *cobra.Command, args ...string) (string, error) {
	t.Helper()
	var out, errb bytes.Buffer
	c.SetOut(&out)
	c.SetErr(&errb)
	c.SetArgs(args)
	err := c.ExecuteContext(context.Background())
	return out.String(), err
}

func runSearch(t *testing.T, args ...string) (string, error) {
	t.Helper()
	return runCobra(t, newSearchCmd(), args...)
}

// searchJSON runs a search with --json and returns the decoded envelope.
func searchJSON(t *testing.T, args ...string) map[string]any {
	t.Helper()
	out, err := runSearch(t, append(args, "--json")...)
	if err != nil {
		t.Fatalf("search %v: %v", args, err)
	}
	var env map[string]any
	if err := json.Unmarshal([]byte(out), &env); err != nil {
		t.Fatalf("decoding %q: %v", out, err)
	}
	return env
}

// column returns field of every results[] row.
func column(t *testing.T, env map[string]any, field string) []string {
	t.Helper()
	rows, ok := env["results"].([]any)
	if !ok {
		t.Fatalf("results is %T, want array", env["results"])
	}
	got := make([]string, 0, len(rows))
	for _, r := range rows {
		got = append(got, r.(map[string]any)[field].(string))
	}
	return got
}

func wantKeys(t *testing.T, what string, m map[string]any, want ...string) {
	t.Helper()
	got := make([]string, 0, len(m))
	for k := range m {
		got = append(got, k)
	}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s keys = %v, want %v", what, got, want)
	}
}

func TestSearchTypesFiltersAndSorts(t *testing.T) {
	installSearchFixture(t)
	cases := []struct {
		args []string
		want []string
	}{
		{[]string{"types"}, []string{"Axiom.Empty", "Axiom.Statement", "Nat"}},
		{[]string{"types", "--sort", "created_at:asc"}, []string{"Nat", "Axiom.Statement", "Axiom.Empty"}},
		{[]string{"types", "--sort", "name:asc"}, []string{"Axiom.Empty", "Nat", "Axiom.Statement"}},
		{[]string{"types", "--sort", "name:desc"}, []string{"Axiom.Statement", "Nat", "Axiom.Empty"}},
		{[]string{"types", "stat"}, []string{"Axiom.Statement"}},
		{[]string{"types", "AXIOM.EMP"}, []string{"Axiom.Empty"}},
		{[]string{"types", "--author", "@Alice"}, []string{"Axiom.Statement"}},
		{[]string{"types", "--created-after", "2026-01-10"}, []string{"Axiom.Empty", "Axiom.Statement"}},
		{[]string{"types", "--created-after", "2026-01-10T00:00:01Z"}, []string{"Axiom.Empty"}},
		{[]string{"types", "--created-before", "2026-03-05"}, []string{"Axiom.Statement"}},
		{[]string{"types", "--limit", "1", "--offset", "1"}, []string{"Axiom.Statement"}},
		{[]string{"types", "zzz"}, []string{}},
	}
	for _, tc := range cases {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got := column(t, searchJSON(t, tc.args...), "type_head")
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("type heads = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSearchConstantsFiltersAndSorts(t *testing.T) {
	installSearchFixture(t)
	cases := []struct {
		args []string
		want []string
	}{
		{[]string{"constants"}, []string{"Foo.delta", "Bar.beta", "Baz.gamma", "Foo.carrierAlpha"}},
		{[]string{"constants", "--sort", "created_at:asc"}, []string{"Foo.carrierAlpha", "Baz.gamma", "Bar.beta", "Foo.delta"}},
		{[]string{"constants", "--sort", "name:asc"}, []string{"Bar.beta", "Baz.gamma", "Foo.carrierAlpha", "Foo.delta"}},
		{[]string{"constants", "--sort", "name:desc"}, []string{"Foo.delta", "Foo.carrierAlpha", "Baz.gamma", "Bar.beta"}},
		{[]string{"constants", "foo."}, []string{"Foo.delta", "Foo.carrierAlpha"}},
		{[]string{"constants", "--kind", "theorem"}, []string{"Bar.beta", "Baz.gamma"}},
		{[]string{"constants", "--kind", "def,axiom"}, []string{"Foo.delta", "Foo.carrierAlpha"}},
		{[]string{"constants", "--kind", "def", "--kind", "theorem"}, []string{"Bar.beta", "Baz.gamma", "Foo.carrierAlpha"}},
		{[]string{"constants", "--author", "ALICE"}, []string{"Foo.delta", "Foo.carrierAlpha"}},
		{[]string{"constants", "--author", "@bob"}, []string{"Bar.beta"}},
		{[]string{"constants", "--created-after", "2026-03-05"}, []string{"Foo.delta", "Bar.beta"}},
		{[]string{"constants", "--created-before", "2026-03-05"}, []string{"Baz.gamma", "Foo.carrierAlpha"}},
		{[]string{"constants", "--created-after", "2026-02-01", "--created-before", "2026-04-01"}, []string{"Bar.beta", "Baz.gamma"}},
		{[]string{"constants", "--limit", "2", "--offset", "1", "--sort", "created_at:asc"}, []string{"Baz.gamma", "Bar.beta"}},
	}
	for _, tc := range cases {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got := column(t, searchJSON(t, tc.args...), "name")
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("names = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSearchUsersSorts(t *testing.T) {
	installSearchFixture(t)
	cases := []struct {
		args []string
		want []string
	}{
		{[]string{"users"}, []string{"bob", "alice", "carol"}},
		{[]string{"users", "--sort", "created_at:asc"}, []string{"carol", "alice", "bob"}},
		{[]string{"users", "--sort", "name:asc"}, []string{"alice", "bob", "carol"}},
		{[]string{"users", "--sort", "name:desc"}, []string{"carol", "bob", "alice"}},
		{[]string{"users", "AL"}, []string{"alice"}},
		{[]string{"users", "--limit", "2"}, []string{"bob", "alice"}},
	}
	for _, tc := range cases {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got := column(t, searchJSON(t, tc.args...), "username")
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("usernames = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSearchPagingBounds(t *testing.T) {
	installSearchFixture(t)
	env := searchJSON(t, "constants", "--limit", "3", "--offset", "1")
	if env["total"] != 4.0 || env["limit"] != 3.0 || env["offset"] != 1.0 || env["has_more"] != false {
		t.Errorf("envelope = %v", env)
	}
	env = searchJSON(t, "constants", "--limit", "2")
	if env["has_more"] != true || len(column(t, env, "name")) != 2 {
		t.Errorf("first page = %v", env)
	}
	env = searchJSON(t, "constants", "--offset", "4")
	if got := column(t, env, "name"); len(got) != 0 || env["total"] != 4.0 || env["has_more"] != false {
		t.Errorf("past-the-end page = %v", env)
	}
	out, err := runSearch(t, "constants", "--offset", "9")
	if err != nil || out != "(no rows at --offset 9; 4 total)\n" {
		t.Errorf("past-the-end human = %q, %v", out, err)
	}
	if got := column(t, searchJSON(t, "constants", "--limit", "100"), "name"); len(got) != 4 {
		t.Errorf("--limit 100 rows = %v", got)
	}
	for _, args := range [][]string{
		{"constants", "--limit", "0"},
		{"constants", "--limit", "101"},
		{"users", "--offset", "-1"},
	} {
		if _, err := runSearch(t, args...); err == nil {
			t.Errorf("%v: want error", args)
		}
	}
}

func TestSearchRejectsBadFlagValues(t *testing.T) {
	installSearchFixture(t)
	cases := map[string][]string{
		"--sort must be":    {"types", "--sort", "created_at"},
		"--sort key must":   {"types", "--sort", "popularity:desc"},
		"--sort dir must":   {"types", "--sort", "name:up"},
		"--created-after":   {"constants", "--created-after", "yesterday"},
		"--created-before":  {"source", "x", "--created-before", "2026/01/01"},
		"sorted by created": {"source", "carrier", "--sort", "name:asc"},
	}
	for want, args := range cases {
		_, err := runSearch(t, args...)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%v: err = %v, want containing %q", args, err, want)
		}
	}
}

func TestSearchActiveContributorsUnsupported(t *testing.T) {
	installSearchFixture(t)
	_, err := runSearch(t, "users", "--active-contributors")
	if err == nil || !strings.Contains(err.Error(), "--active-contributors is not available in the local edition") {
		t.Fatalf("err = %v", err)
	}
}

func TestSearchHumanTables(t *testing.T) {
	installSearchFixture(t)
	out, err := runSearch(t, "types", "--sort", "name:asc")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if lines[0] != "TYPE HEADS  (1-3 of 3)" {
		t.Errorf("header = %q", lines[0])
	}
	if f := strings.Fields(lines[1]); !reflect.DeepEqual(f, []string{"searchable_name", "type_head", "arity", "author", "created_at", "file_id"}) {
		t.Errorf("columns = %v", f)
	}
	if f := strings.Fields(lines[3]); !reflect.DeepEqual(f, []string{"Nat", "Nat", "0", "platform"}) {
		t.Errorf("built-in row = %v", f)
	}
	if f := strings.Fields(lines[4]); !reflect.DeepEqual(f, []string{"Statement", "Axiom.Statement", "1", "alice", "Jan", "10,", "2026", "a1111111"}) {
		t.Errorf("statement row = %v", f)
	}

	out, err = runSearch(t, "constants", "--limit", "1", "--kind", "theorem", "--sort", "created_at:asc")
	if err != nil {
		t.Fatal(err)
	}
	want := "CONSTANTS  (1-1 of 2)\n" +
		"name       kind     author  created_at   file_id\n" +
		"Baz.gamma  theorem  —       Feb 1, 2026  c3333333\n" +
		"-- showing 1 of 2; --offset 1 for more\n"
	if out != want {
		t.Errorf("constants output:\n%s\nwant:\n%s", out, want)
	}

	out, err = runSearch(t, "users", "--sort", "name:asc")
	if err != nil {
		t.Fatal(err)
	}
	want = "USERS  (1-3 of 3)\n" +
		"username  first_published_at\n" +
		"alice     Jan 10, 2026\n" +
		"bob       Mar 5, 2026\n" +
		"carol     —\n"
	if out != want {
		t.Errorf("users output:\n%s\nwant:\n%s", out, want)
	}

	out, err = runSearch(t, "users", "nobody")
	if err != nil || out != "(no matches)\n" {
		t.Errorf("no-match output = %q, %v", out, err)
	}
}

func TestSearchJSONShapes(t *testing.T) {
	installSearchFixture(t)
	envelope := []string{"query", "domain", "total", "limit", "offset", "has_more", "results"}
	cases := []struct {
		args    []string
		rowKeys []string
	}{
		{[]string{"types", "Statement"}, []string{"type_head", "searchable_name", "arity", "params", "file_id", "def_id", "kind", "publisher", "created_at"}},
		{[]string{"constants", "beta"}, []string{"def_id", "name", "kind", "type_head", "file_id", "created_at", "publisher", "decl_byte_start", "signature_byte_end", "declaration_role"}},
		{[]string{"users", "alice"}, []string{"username", "first_published_at"}},
		{[]string{"source", "beta"}, []string{"file_id", "publisher", "created_at", "matches"}},
	}
	for _, tc := range cases {
		env := searchJSON(t, tc.args...)
		wantKeys(t, tc.args[0]+" envelope", env, envelope...)
		if env["query"] != tc.args[1] || env["domain"] != tc.args[0] {
			t.Errorf("%v: query/domain = %v/%v", tc.args, env["query"], env["domain"])
		}
		rows := env["results"].([]any)
		if len(rows) != 1 {
			t.Fatalf("%v: %d rows", tc.args, len(rows))
		}
		wantKeys(t, tc.args[0]+" row", rows[0].(map[string]any), tc.rowKeys...)
	}

	// Index rows round-trip verbatim.
	row := searchJSON(t, "constants", "beta")["results"].([]any)[0].(map[string]any)
	want := map[string]any{
		"def_id": "k2", "name": "Bar.beta", "kind": "theorem", "type_head": "Axiom.Statement", "file_id": "b2222222",
		"created_at": "2026-03-05T00:00:00Z", "publisher": "bob", "decl_byte_start": 0.0, "signature_byte_end": 0.0,
		"declaration_role": "statement",
	}
	if !reflect.DeepEqual(row, want) {
		t.Errorf("constants row = %v, want %v", row, want)
	}
	src := searchJSON(t, "source", "beta")["results"].([]any)[0].(map[string]any)
	wantSrc := map[string]any{
		"file_id": "b2222222", "publisher": "bob", "created_at": "2026-03-05T00:00:00Z",
		"matches": []any{map[string]any{"line": 1.0, "text": "def beta := carrier"}},
	}
	if !reflect.DeepEqual(src, wantSrc) {
		t.Errorf("source row = %v, want %v", src, wantSrc)
	}
	if empty := searchJSON(t, "users", "nobody"); empty["results"] == nil {
		t.Error("empty results encode as null, want []")
	}
}

// countReads counts corpus content reads per file id for the test's duration.
func countReads(t *testing.T) map[string]int {
	t.Helper()
	reads := map[string]int{}
	orig := corpusContent
	corpusContent = func(c *corpus.Corpus, id string) ([]byte, error) {
		reads[id]++
		return orig(c, id)
	}
	t.Cleanup(func() { corpusContent = orig })
	return reads
}

func TestSearchSourceScan(t *testing.T) {
	installSearchFixture(t)
	cases := []struct {
		args []string
		want []string
	}{
		{[]string{"source", "carrier"}, []string{"b2222222", "a1111111"}},
		{[]string{"source", "carrier", "--sort", "created_at:asc"}, []string{"a1111111", "b2222222"}},
		{[]string{"source", "CARRIER", "--author", "bob"}, []string{"b2222222"}},
		{[]string{"source", "carrier", "--created-before", "2026-03-05"}, []string{"a1111111"}},
		{[]string{"source", "theorem"}, []string{"c3333333"}},
		{[]string{"source", "def", "--limit", "2"}, []string{"d4444444", "b2222222"}},
		{[]string{"source", "no-such-text"}, []string{}},
	}
	for _, tc := range cases {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got := column(t, searchJSON(t, tc.args...), "file_id")
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("file ids = %v, want %v", got, tc.want)
			}
		})
	}

	out, err := runSearch(t, "source", "carrier", "--sort", "created_at:asc")
	if err != nil {
		t.Fatal(err)
	}
	want := "SOURCE  (1-2 of 2)\n\n" +
		"a1111111 · @alice · Jan 10, 2026\n" +
		"    2: def carrierAlpha : Nat := 1\n" +
		"    3: -- CARRIER note\n\n" +
		"b2222222 · @bob · Mar 5, 2026\n" +
		"    1: def beta := carrier\n"
	if out != want {
		t.Errorf("source output:\n%s\nwant:\n%s", out, want)
	}
	out, err = runSearch(t, "source", "gamma")
	if err != nil || !strings.Contains(out, "c3333333 · (unattributed) · Feb 1, 2026") {
		t.Errorf("unattributed header missing: %q, %v", out, err)
	}
	if _, err := runSearch(t, "source", ""); err == nil {
		t.Error("empty source query: want error")
	}
	if _, err := runSearch(t, "source"); err == nil {
		t.Error("missing source query: want error")
	}
}

func TestSearchSourceReadsEachFileOnce(t *testing.T) {
	installSearchFixture(t)
	reads := countReads(t)
	if _, err := runSearch(t, "source", "e", "--limit", "1"); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"a1111111": 1, "b2222222": 1, "c3333333": 1, "d4444444": 1}
	if !reflect.DeepEqual(reads, want) {
		t.Errorf("reads = %v, want %v", reads, want)
	}

	reads = countReads(t)
	if _, err := runSearch(t, "source", "e", "--author", "bob"); err != nil {
		t.Fatal(err)
	}
	if want := map[string]int{"b2222222": 1}; !reflect.DeepEqual(reads, want) {
		t.Errorf("filtered reads = %v, want %v", reads, want)
	}
}

func TestCorpusCommandsWithoutCorpus(t *testing.T) {
	forbidHTTP(t)
	setTestHome(t)
	cases := map[string]func() (string, error){
		"search types":     func() (string, error) { return runSearch(t, "types") },
		"search constants": func() (string, error) { return runSearch(t, "constants", "x") },
		"search users":     func() (string, error) { return runSearch(t, "users") },
		"search source":    func() (string, error) { return runSearch(t, "source", "x") },
		"query":            func() (string, error) { return runCobra(t, newQueryCmd(), "Nat") },
		"modeling-refs":    func() (string, error) { return runCobra(t, newModelingRefsCmd()) },
	}
	for name, run := range cases {
		_, err := run()
		if !errors.Is(err, corpus.ErrNotInstalled) || !strings.Contains(err.Error(), "run `axm upgrade`") {
			t.Errorf("%s: err = %v, want ErrNotInstalled", name, err)
		}
	}
}
