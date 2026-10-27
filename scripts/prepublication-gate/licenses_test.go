package main

import (
	"errors"
	"reflect"
	"testing"
)

func TestEvaluateNPMLicenses(t *testing.T) {
	report := `{
		"axiom-viewer@0.1.0": {"licenses": "UNLICENSED"},
		"@img/sharp-libvips-linux-x64@1.2.4": {"licenses": "LGPL-3.0-or-later"},
		"@img/sharp-libvips-darwin-arm64@1.2.4": {"licenses": "LGPL-3.0-or-later"},
		"caniuse-lite@1.0.30001700": {"licenses": "CC-BY-4.0"},
		"react@19.0.0": {"licenses": "MIT"},
		"guessed@1.0.0": {"licenses": "MIT*"},
		"dual@1.0.0": {"licenses": "(MIT OR Apache-2.0)"},
		"both@1.0.0": {"licenses": "Apache-2.0 AND MIT"},
		"several@1.0.0": {"licenses": ["MIT", "ISC"]}
	}`
	got, err := evaluateNPMLicenses([]byte(report), "axiom-viewer@0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("permissive and excluded packages failed: %v", got)
	}

	bad := `{
		"axiom-viewer@0.1.0": {"licenses": "UNLICENSED"},
		"lgpl-dep@2.0.0": {"licenses": "LGPL-2.1-or-later"},
		"mpl-dep@1.0.0": {"licenses": "MPL-2.0"},
		"weak-dual@1.0.0": {"licenses": "(MIT AND GPL-3.0-only)"},
		"mixed@1.0.0": {"licenses": ["MIT", "GPL-2.0"]},
		"unknown@1.0.0": {"licenses": "UNKNOWN"},
		"custom@1.0.0": {"licenses": "Custom: https://example.invalid/license"},
		"none@1.0.0": {},
		"caniuse-lite-fork@1.0.0": {"licenses": "CC-BY-4.0"},
		"@img/sharp-linux-x64@0.34.0": {"licenses": "LGPL-3.0-or-later"}
	}`
	got, err = evaluateNPMLicenses([]byte(bad), "axiom-viewer@0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	want := []finding{
		{"licenses", "npm:@img/sharp-linux-x64@0.34.0", "LGPL-3.0-or-later"},
		{"licenses", "npm:caniuse-lite-fork@1.0.0", "CC-BY-4.0"},
		{"licenses", "npm:custom@1.0.0", "Custom:_https://example.invalid/license"},
		{"licenses", "npm:lgpl-dep@2.0.0", "LGPL-2.1-or-later"},
		{"licenses", "npm:mixed@1.0.0", "GPL-2.0"},
		{"licenses", "npm:mpl-dep@1.0.0", "MPL-2.0"},
		{"licenses", "npm:none@1.0.0", "no-license"},
		{"licenses", "npm:unknown@1.0.0", "UNKNOWN"},
		{"licenses", "npm:weak-dual@1.0.0", "(MIT_AND_GPL-3.0-only)"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("findings:\n got %v\nwant %v", got, want)
	}
}

func TestPackageName(t *testing.T) {
	for key, want := range map[string]string{
		"react@19.0.0":                       "react",
		"@img/sharp-libvips-linux-x64@1.2.4": "@img/sharp-libvips-linux-x64",
		"noversion":                          "noversion",
	} {
		if got := packageName(key); got != want {
			t.Errorf("packageName(%q) = %q, want %q", key, got, want)
		}
	}
}

func TestNPMLicensesNeedsInstalledModules(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "viewer/package.json", `{"name":"v","license":"Apache-2.0"}`)
	g := &gate{root: root, run: execRunner()}
	_, err := g.npmLicenses(t.Context())
	if err == nil || errors.Is(err, errSkip{}) {
		t.Fatalf("err = %v, want a missing node_modules error", err)
	}
}
