//go:build corpusgate_e2e

package main

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// These tests run the real lake build; they need elan on PATH and network
// access to fetch AxiomLib.

func TestLakeBuildCleanCorpus(t *testing.T) {
	dir := cleanFixture().write(t)
	lakeLog := filepath.Join(t.TempDir(), "lake.log")
	r := runCLI(t, gateOptions{}, "-lake-log", lakeLog, dir)
	if r.code != exitPass {
		log, _ := os.ReadFile(lakeLog)
		t.Fatalf("exit %d, want %d\nstdout:\n%s\nstderr:\n%s\nlake log:\n%s", r.code, exitPass, r.stdout, r.stderr, log)
	}
	if got := r.lines(); !reflect.DeepEqual(got, []string{cleanReview}) {
		t.Fatalf("findings %q, want only %q", got, cleanReview)
	}
	if _, err := os.Stat(filepath.Join(dir, ".lake")); !os.IsNotExist(err) {
		t.Fatalf("lake build wrote .lake into the corpus (stat err %v)", err)
	}
}

func TestLakeBuildBrokenCorpus(t *testing.T) {
	f := cleanFixture()
	f.lean["aaaa0003"] = "import A.aaaa0001\n\ntheorem leaked : False := t1 -- secret-marker\n"
	dir := f.write(t)
	r := runCLI(t, gateOptions{}, dir)
	if r.code != exitBlock {
		t.Fatalf("exit %d, want %d\nstdout:\n%s\nstderr:\n%s", r.code, exitBlock, r.stdout, r.stderr)
	}
	want := "block lake-build A/aaaa0003.lean lake build failed"
	if !slices.Contains(r.lines(), want) {
		t.Fatalf("findings lack %q:\n%s", want, r.stdout)
	}
	if strings.Contains(r.stdout+r.stderr, "secret-marker") || strings.Contains(r.stdout, "leaked") {
		t.Fatalf("diagnostics echo Lean source:\n%s", r.stdout)
	}
}
