package cmd

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus/corpustest"
)

func runModelingRefsCmd(t *testing.T, args ...string) (string, error) {
	t.Helper()
	return runCobra(t, newModelingRefsCmd(), args...)
}

func TestModelingRefsListsGrouped(t *testing.T) {
	installSearchFixture(t)
	out, err := runModelingRefsCmd(t)
	if err != nil {
		t.Fatal(err)
	}
	want := "Conventions (adopt by importing)\n" +
		"  actual-bridge       a1111111   — the bridge\n" +
		"  second-convention   d4444444   — another\n" +
		"\n" +
		"Examples (study, don't copy literally)\n" +
		"  worked-example   b2222222   — an example\n"
	if out != want {
		t.Errorf("output:\n%s\nwant:\n%s", out, want)
	}
}

func TestModelingRefsSlug(t *testing.T) {
	installSearchFixture(t)
	out, err := runModelingRefsCmd(t, "worked-example")
	if err != nil || out != "worked-example\tb2222222\t— an example\n" {
		t.Errorf("slug output = %q, %v", out, err)
	}
	_, err = runModelingRefsCmd(t, "no-such-ref")
	if err == nil || !strings.Contains(err.Error(), `no modeling reference with slug "no-such-ref"`) {
		t.Errorf("unknown slug err = %v", err)
	}
	if _, err := runModelingRefsCmd(t, "no-such-ref", "--json"); err == nil {
		t.Error("unknown slug --json: want error")
	}
}

func TestModelingRefsJSON(t *testing.T) {
	installSearchFixture(t)
	decode := func(out string) []map[string]any {
		t.Helper()
		var rows []map[string]any
		if err := json.Unmarshal([]byte(out), &rows); err != nil {
			t.Fatalf("decoding %q: %v", out, err)
		}
		return rows
	}
	out, err := runModelingRefsCmd(t, "--json")
	if err != nil {
		t.Fatal(err)
	}
	rows := decode(out)
	var slugs []string
	for _, r := range rows {
		wantKeys(t, "modeling-refs row", r, "slug", "category", "description", "file_id")
		slugs = append(slugs, r["slug"].(string))
	}
	if want := []string{"actual-bridge", "worked-example", "second-convention"}; !reflect.DeepEqual(slugs, want) {
		t.Errorf("slugs = %v, want %v", slugs, want)
	}

	out, err = runModelingRefsCmd(t, "actual-bridge", "--json")
	if err != nil {
		t.Fatal(err)
	}
	want := []map[string]any{{"slug": "actual-bridge", "category": "convention", "description": "the bridge", "file_id": "a1111111"}}
	if got := decode(out); !reflect.DeepEqual(got, want) {
		t.Errorf("slug --json = %v, want %v", got, want)
	}
}

func TestModelingRefsEmpty(t *testing.T) {
	forbidHTTP(t)
	corpustest.Install(t, setTestHome(t), corpustest.Fixture{FrozenAt: fxFrozenAt, Refs: []corpus.ModelingRef{}})
	out, err := runModelingRefsCmd(t)
	if err != nil || out != "no Modeling References in the published corpus\n" {
		t.Errorf("empty output = %q, %v", out, err)
	}
	out, err = runModelingRefsCmd(t, "--json")
	if err != nil || strings.TrimSpace(out) != "[]" {
		t.Errorf("empty --json = %q, %v", out, err)
	}
}
