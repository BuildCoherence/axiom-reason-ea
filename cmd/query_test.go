package cmd

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func runQueryCmd(t *testing.T, args ...string) (string, error) {
	t.Helper()
	return runCobra(t, newQueryCmd(), args...)
}

func TestQueryExactTypeHead(t *testing.T) {
	installSearchFixture(t)
	out, err := runQueryCmd(t, "Axiom.Statement")
	if err != nil {
		t.Fatal(err)
	}
	want := "Axiom.Statement  (1-2 of 2)\n" +
		"name              kind     author  created_at    file_id\n" +
		"Bar.beta          theorem  bob     Mar 5, 2026   b2222222\n" +
		"Foo.carrierAlpha  def      alice   Jan 10, 2026  a1111111\n"
	if out != want {
		t.Errorf("output:\n%s\nwant:\n%s", out, want)
	}

	// Exact match only: a prefix of a type head matches nothing.
	if _, err := runQueryCmd(t, "Axiom.Stat"); err == nil || !strings.Contains(err.Error(), "unknown type head `Axiom.Stat`") {
		t.Errorf("prefix query err = %v", err)
	}
	// A known type head with no declarations is an empty result, not an error.
	if out, err := runQueryCmd(t, "Axiom.Empty"); err != nil || out != "(no matches)\n" {
		t.Errorf("Axiom.Empty = %q, %v", out, err)
	}
}

func TestQueryPagingAndJSON(t *testing.T) {
	installSearchFixture(t)
	out, err := runQueryCmd(t, "Axiom.Statement", "--limit", "1", "--offset", "1", "--json")
	if err != nil {
		t.Fatal(err)
	}
	var env map[string]any
	if err := json.Unmarshal([]byte(out), &env); err != nil {
		t.Fatalf("decoding %q: %v", out, err)
	}
	wantKeys(t, "query envelope", env, "type_head", "total", "limit", "offset", "has_more", "results")
	if env["type_head"] != "Axiom.Statement" || env["total"] != 2.0 || env["has_more"] != false {
		t.Errorf("envelope = %v", env)
	}
	if got := column(t, env, "def_id"); !reflect.DeepEqual(got, []string{"k1"}) {
		t.Errorf("def ids = %v", got)
	}
	row := env["results"].([]any)[0].(map[string]any)
	wantKeys(t, "query row", row, "def_id", "name", "kind", "type_head", "file_id", "created_at", "publisher",
		"decl_byte_start", "signature_byte_end", "declaration_role")
	if row["decl_byte_start"] != 11.0 || row["signature_byte_end"] != 35.0 {
		t.Errorf("byte range = %v..%v", row["decl_byte_start"], row["signature_byte_end"])
	}

	out, err = runQueryCmd(t, "Axiom.Statement", "--limit", "1")
	if err != nil || !strings.HasSuffix(out, "-- showing 1 of 2; --offset 1 for more\n") {
		t.Errorf("continuation missing: %q, %v", out, err)
	}
	for _, args := range [][]string{
		{"Axiom.Statement", "--limit", "0"},
		{"Axiom.Statement", "--limit", "101"},
		{"Axiom.Statement", "--offset", "-1"},
	} {
		if _, err := runQueryCmd(t, args...); err == nil {
			t.Errorf("%v: want error", args)
		}
	}
}

func TestQueryUnsupportedFlags(t *testing.T) {
	installSearchFixture(t)
	cases := map[string][]string{
		"-p/--param is not available in the local edition": {"Axiom.Statement", "-p", "p=True"},
		"-p/--param is not available":                      {"Axiom.Statement", "--param", "p=True"},
		"--order-by is not available in the local edition": {"Axiom.Statement", "--order-by", "created_at:asc"},
	}
	for want, args := range cases {
		_, err := runQueryCmd(t, args...)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%v: err = %v, want containing %q", args, err, want)
		}
	}
}
