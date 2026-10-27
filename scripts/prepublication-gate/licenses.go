package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
)

const (
	viewerDir         = "viewer"
	licenseCheckerPkg = "license-checker@25.0.1"
	// go-licenses classifies licenses by type; only notice, permissive and unencumbered pass.
	goLicensesDisallowed = "forbidden,restricted,reciprocal,unknown"
)

var permissiveSPDX = []string{
	"0BSD", "Apache-2.0", "BlueOak-1.0.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "ISC", "MIT", "MIT-0",
	"Python-2.0", "Unlicense", "Zlib",
}

// npmExclusions are production dependencies with a non-permissive license that the release never ships.
var npmExclusions = []struct {
	namePrefix string
	exact      bool
	reason     string
}{
	{"@img/sharp-libvips-", false, "LGPL-3.0-or-later; Next's optional image-optimization dependency, never loaded under images.unoptimized: true, absent from out/ and every Release asset"},
	{"caniuse-lite", true, "CC-BY-4.0; attribution-only browser-support data next uses at build time, absent from out/"},
}

var (
	goModulePattern = regexp.MustCompile(`(?m)^module\s+(\S+)`)
	// goLicensesVerdict matches go-licenses check's per-library verdict lines; v1 reports a
	// dependency without a license as an unknown type, v2 as "Did not find license".
	goLicensesVerdict = regexp.MustCompile(`^(?:(?:Not allowed license|\w+ license type) .* found for library \S+|Did not find license for library \S+)$`)
)

func (g *gate) licensesLeg(ctx context.Context) ([]finding, error) {
	out, err := g.goLicenses(ctx)
	if err != nil {
		return nil, err
	}
	npm, err := g.npmLicenses(ctx)
	if err != nil {
		return nil, err
	}
	return append(out, npm...), nil
}

func (g *gate) goLicenses(ctx context.Context) ([]finding, error) {
	gomod, err := os.ReadFile(filepath.Join(g.root, "go.mod"))
	if err != nil {
		return nil, err
	}
	m := goModulePattern.FindSubmatch(gomod)
	if m == nil {
		return nil, fmt.Errorf("go.mod declares no module")
	}
	_, err = g.run(ctx, g.root, "go-licenses", "check", "./...",
		"--disallowed_types="+goLicensesDisallowed, "--ignore="+string(m[1]))
	var ce *cmdError
	if !errors.As(err, &ce) {
		return nil, err
	}
	var out []finding
	for line := range strings.Lines(ce.stderr) {
		if line = strings.TrimSpace(line); goLicensesVerdict.MatchString(line) {
			out = append(out, finding{"licenses", "go", strings.ReplaceAll(line, " ", "_")})
		}
	}
	if len(out) == 0 {
		return nil, err
	}
	return out, nil
}

func (g *gate) npmLicenses(ctx context.Context) ([]finding, error) {
	dir := filepath.Join(g.root, viewerDir)
	if _, err := os.Stat(filepath.Join(dir, "node_modules")); err != nil {
		return nil, fmt.Errorf("%s/node_modules is missing; run npm ci in %s first (license-checker reads installed packages)", viewerDir, viewerDir)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return nil, err
	}
	var self struct{ Name, Version, License string }
	if err := json.Unmarshal(data, &self); err != nil {
		return nil, fmt.Errorf("%s/package.json: %w", viewerDir, err)
	}
	out, err := g.run(ctx, abs, "npx", "--yes", licenseCheckerPkg, "--production", "--json", "--start", abs)
	if err != nil {
		return nil, err
	}
	findings, err := evaluateNPMLicenses(out, self.Name+"@"+self.Version)
	if err != nil {
		return nil, err
	}
	// license-checker reports a private root package as UNLICENSED; its own declaration is what ships.
	if !permissiveExpression(self.License) {
		findings = append(findings, finding{"licenses", viewerDir + "/package.json", "license:" + strings.ReplaceAll(self.License, " ", "_")})
	}
	return findings, nil
}

// evaluateNPMLicenses checks `license-checker --json` output: every package
// except the root must be permissive or excluded by name.
func evaluateNPMLicenses(report []byte, rootKey string) ([]finding, error) {
	var pkgs map[string]struct {
		Licenses json.RawMessage `json:"licenses"`
	}
	if err := json.Unmarshal(report, &pkgs); err != nil {
		return nil, fmt.Errorf("license-checker report: %w", err)
	}
	keys := make([]string, 0, len(pkgs))
	for k := range pkgs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out []finding
	for _, key := range keys {
		if key == rootKey || excludedPackage(packageName(key)) {
			continue
		}
		licenses, err := licenseList(pkgs[key].Licenses)
		if err != nil {
			return nil, fmt.Errorf("license-checker report: %s: %w", key, err)
		}
		if len(licenses) == 0 {
			out = append(out, finding{"licenses", "npm:" + key, "no-license"})
			continue
		}
		for _, l := range licenses {
			if !permissiveExpression(l) {
				out = append(out, finding{"licenses", "npm:" + key, strings.ReplaceAll(l, " ", "_")})
			}
		}
	}
	return out, nil
}

func licenseList(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var one string
	if err := json.Unmarshal(raw, &one); err == nil {
		return []string{one}, nil
	}
	var many []string
	if err := json.Unmarshal(raw, &many); err != nil {
		return nil, err
	}
	return many, nil
}

// packageName strips the trailing @version from a license-checker key.
func packageName(key string) string {
	if i := strings.LastIndex(key, "@"); i > 0 {
		return key[:i]
	}
	return key
}

func excludedPackage(name string) bool {
	for _, e := range npmExclusions {
		if (e.exact && name == e.namePrefix) || (!e.exact && strings.HasPrefix(name, e.namePrefix)) {
			return true
		}
	}
	return false
}

// permissiveExpression accepts an SPDX expression whose every AND term, in at
// least one OR alternative, is permissive. license-checker marks guessed
// licenses with a trailing "*".
func permissiveExpression(expr string) bool {
	expr = strings.NewReplacer("(", " ", ")", " ").Replace(expr)
	for alt := range strings.SplitSeq(expr, " OR ") {
		ok := true
		for term := range strings.SplitSeq(alt, " AND ") {
			if !slices.Contains(permissiveSPDX, strings.TrimSuffix(strings.TrimSpace(term), "*")) {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}
