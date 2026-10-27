package main

import (
	"reflect"
	"testing"
)

const oflText = "Copyright 2010 Example\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\n"

func TestFontsLeg(t *testing.T) {
	root := t.TempDir()
	fonts := "viewer/public/fonts/"
	writeFile(t, root, fonts+"pt-serif-regular.woff2", "font")
	writeFile(t, root, fonts+"pt-serif-700.woff2", "font")
	writeFile(t, root, fonts+"pt-serif.OFL.txt", oflText)
	writeFile(t, root, fonts+"julia-mono-subset.woff2", "font")
	writeFile(t, root, fonts+"julia-mono.OFL.txt", oflText)
	writeFile(t, root, fonts+"mystery-400.ttf", "font")
	writeFile(t, root, fonts+"proprietary-bold.otf", "font")
	writeFile(t, root, fonts+"proprietary.OFL.txt", "All rights reserved.\n")
	writeFile(t, root, "viewer/node_modules/pkg/font.woff2", "ignored")
	writeFile(t, root, "viewer/out/fonts/mystery-400.ttf", "ignored build output")

	got, err := fontsLeg(root)
	if err != nil {
		t.Fatal(err)
	}
	want := []finding{
		{"fonts", "viewer/public/fonts/mystery-400.ttf", "no-license"},
		{"fonts", "viewer/public/fonts/proprietary-bold.otf", "license-not-ofl"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("findings:\n got %v\nwant %v", got, want)
	}
}

func TestCorpusLegSkipsWithoutCorpus(t *testing.T) {
	root := t.TempDir()
	r := runGate(t, nil, nil, "-root", root, "-legs", "corpus")
	if r.code != exitPass {
		t.Fatalf("exit %d, want %d\n%s%s", r.code, exitPass, r.stdout, r.stderr)
	}
	r.has(t, "corpus skipped: no corpus/")
}

func TestUnknownLegIsUsageError(t *testing.T) {
	r := runGate(t, nil, nil, "-legs", "deny,nope")
	if r.code != exitError {
		t.Fatalf("exit %d, want %d", r.code, exitError)
	}
}
