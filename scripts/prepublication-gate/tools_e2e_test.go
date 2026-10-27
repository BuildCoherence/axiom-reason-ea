//go:build prepub_e2e

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// These tests run the real gitleaks, license-checker (through npx) and
// go-licenses; they need all three on PATH and network access for npx.

// fakeGitHubToken is built at run time so this file itself carries no secret-shaped literal.
func fakeGitHubToken() string {
	return "ghp_" + strings.Repeat("aB3dE6gH9k", 3) + "Lm2nP5"
}

func repoGitleaksConfig(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", gitleaksConfig))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestGitleaksHistoryAndAllowlist(t *testing.T) {
	requireGit(t)
	repo := initRepo(t)
	writeFile(t, repo, "config.go", "package x\n\nconst v = \""+fakeGitHubToken()+"\"\n")
	leaked := commitAll(t, repo, "leak")
	writeFile(t, repo, "config.go", "package x\n")
	writeFile(t, repo, "viewer/src/components/footer-legal-links.ts",
		"// Key"+"-addressable: signup/clickwrap code asks for `LEGAL_LINKS.terms` /\nexport const x = 1;\n")
	commitAll(t, repo, "scrub")

	bare := runGate(t, nil, nil, "-root", repo, "-legs", "gitleaks")
	bare.has(t, "gitleaks "+leaked+":config.go:3 github-pat")
	if !strings.Contains(bare.stdout, "footer-legal-links.ts") {
		t.Fatalf("expected the known false positive without the allowlist:\n%s", bare.stdout)
	}

	writeFile(t, repo, gitleaksConfig, repoGitleaksConfig(t))
	commitAll(t, repo, "config")
	r := runGate(t, nil, nil, "-root", repo, "-legs", "gitleaks")
	if r.code != exitBlock {
		t.Fatalf("exit %d, want %d\n%s%s", r.code, exitBlock, r.stdout, r.stderr)
	}
	r.has(t, "gitleaks "+leaked+":config.go:3 github-pat")
	if strings.Contains(r.stdout, "footer-legal-links.ts") {
		t.Errorf("allowlisted false positive reported:\n%s", r.stdout)
	}
	if strings.Contains(r.stdout+r.stderr, fakeGitHubToken()) {
		t.Errorf("diagnostics echo the secret")
	}
}

func TestGitleaksScopeText(t *testing.T) {
	clone, _, _, beforeSHA := scopeFixture(t)
	gh := scopeGH(t, beforeSHA, 0)
	gh.rest[ep("issues/comments?per_page=100")] = `[{"id":777,"node_id":"C777","body":"token ` + fakeGitHubToken() + `"}]`
	r := runGate(t, nil, ghRunner(gh), "-root", clone, "-legs", "gitleaks", "-scope", scopeRepo)
	if r.code != exitBlock {
		t.Fatalf("exit %d, want %d\n%s%s", r.code, exitBlock, r.stdout, r.stderr)
	}
	r.has(t, "gitleaks-scope issue-comment/777:1 github-pat")
}

type npmPkg struct{ name, version, license string }

func npmFixture(t *testing.T, deps ...npmPkg) string {
	t.Helper()
	root := t.TempDir()
	depMap := map[string]string{}
	for _, d := range deps {
		depMap[d.name] = d.version
		body, _ := json.Marshal(map[string]string{"name": d.name, "version": d.version, "license": d.license})
		writeFile(t, root, "viewer/node_modules/"+d.name+"/package.json", string(body))
	}
	body, _ := json.Marshal(map[string]any{
		"name": "axiom-viewer", "version": "0.1.0", "private": true, "license": "Apache-2.0", "dependencies": depMap,
	})
	writeFile(t, root, "viewer/package.json", string(body))
	return root
}

var shippedDeps = []npmPkg{
	{"@img/sharp-libvips-linux-x64", "1.2.4", "LGPL-3.0-or-later"},
	{"caniuse-lite", "1.0.30001700", "CC-BY-4.0"},
	{"react", "19.0.0", "MIT"},
}

func TestLicenseCheckerFixturePasses(t *testing.T) {
	g := &gate{root: npmFixture(t, shippedDeps...), run: execRunner()}
	got, err := g.npmLicenses(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("findings %v, want none", got)
	}
}

func TestLicenseCheckerFixtureFailsOnCopyleft(t *testing.T) {
	for _, bad := range []npmPkg{
		{"lgpl-dep", "2.0.0", "LGPL-2.1-or-later"},
		{"mpl-dep", "1.0.0", "MPL-2.0"},
	} {
		t.Run(bad.name, func(t *testing.T) {
			g := &gate{root: npmFixture(t, append(shippedDeps, bad)...), run: execRunner()}
			got, err := g.npmLicenses(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			want := finding{"licenses", "npm:" + bad.name + "@" + bad.version, bad.license}
			if len(got) != 1 || got[0] != want {
				t.Fatalf("findings %v, want [%v]", got, want)
			}
		})
	}
}

const mitText = `MIT License

Copyright (c) 2026 Example

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

// goModuleFixture is a main module (itself unlicensed, as the gate ignores it)
// depending on one local module that carries depLicense, or no license when empty.
func goModuleFixture(t *testing.T, depLicense string) string {
	t.Helper()
	root := t.TempDir()
	writeFile(t, root, "go.mod", "module example.com/fx\n\ngo 1.25\n\nrequire example.com/dep v0.0.0\n\nreplace example.com/dep => ./dep\n")
	writeFile(t, root, "main.go", "package main\n\nimport \"example.com/dep\"\n\nfunc main() { dep.F() }\n")
	writeFile(t, root, "dep/go.mod", "module example.com/dep\n\ngo 1.25\n")
	writeFile(t, root, "dep/dep.go", "package dep\n\n// F does nothing.\nfunc F() {}\n")
	if depLicense != "" {
		writeFile(t, root, "dep/LICENSE", depLicense)
	}
	return root
}

func TestGoLicensesFixtures(t *testing.T) {
	g := &gate{root: goModuleFixture(t, mitText), run: execRunner()}
	got, err := g.goLicenses(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("MIT dependency failed: %v", got)
	}

	g = &gate{root: goModuleFixture(t, ""), run: execRunner()}
	got, err = g.goLicenses(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	// go-licenses v1 and v2 word the unlicensed dependency differently.
	wants := []finding{
		{"licenses", "go", "Unknown_license_type__found_for_library_example.com/dep"},
		{"licenses", "go", "Did_not_find_license_for_library_'example.com/dep'."},
	}
	if len(got) != 1 || (got[0] != wants[0] && got[0] != wants[1]) {
		t.Fatalf("findings %v, want one of %v", got, wants)
	}
}
