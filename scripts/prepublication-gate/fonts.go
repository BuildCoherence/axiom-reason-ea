package main

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

const (
	// A font file's license is <prefix>.OFL.txt beside it, where <prefix> is a
	// leading run of the font's dash-separated name ("pt-serif" for pt-serif-700.woff2).
	fontLicenseSuffix = ".OFL.txt"
	oflMarker         = "SIL OPEN FONT LICENSE"
	corpusDir         = "corpus"
	corpusGatePkg     = "./scripts/corpus-gate"
)

var (
	fontExts = []string{".woff2", ".woff", ".ttf", ".otf"}
)

func fontsLeg(root string) ([]finding, error) {
	base := filepath.Join(root, viewerDir)
	var out []finding
	err := filepath.WalkDir(base, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if e.IsDir() && slices.Contains(buildOutputDirs, e.Name()) {
			return filepath.SkipDir
		}
		if e.IsDir() || !slices.Contains(fontExts, strings.ToLower(filepath.Ext(p))) {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		if kind := fontLicenseProblem(p); kind != "" {
			out = append(out, finding{"fonts", filepath.ToSlash(rel), kind})
		}
		return nil
	})
	return out, err
}

func fontLicenseProblem(fontPath string) string {
	parts := strings.Split(strings.TrimSuffix(filepath.Base(fontPath), filepath.Ext(fontPath)), "-")
	for n := len(parts); n > 0; n-- {
		data, err := os.ReadFile(filepath.Join(filepath.Dir(fontPath), strings.Join(parts[:n], "-")+fontLicenseSuffix))
		if err != nil {
			continue
		}
		if bytes.Contains(bytes.ToUpper(data), []byte(oflMarker)) {
			return ""
		}
		return "license-not-ofl"
	}
	return "no-license"
}

// corpusLeg runs the corpus gate (its PII grep among its checks) once corpus/ is committed.
func (g *gate) corpusLeg(ctx context.Context) ([]finding, error) {
	if _, err := os.Stat(filepath.Join(g.root, corpusDir)); os.IsNotExist(err) {
		return nil, errSkip{reason: "no " + corpusDir + "/"}
	}
	bin, err := os.MkdirTemp("", "corpus-gate-")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(bin) }()
	exe := filepath.Join(bin, "corpus-gate")
	if _, err := g.run(ctx, g.root, "go", "build", "-o", exe, corpusGatePkg); err != nil {
		return nil, err
	}
	out, err := g.run(ctx, g.root, exe, corpusDir)
	var ce *cmdError
	if errors.As(err, &ce) && ce.code == exitBlock {
		return corpusBlocking(out), nil
	}
	return nil, err
}

// corpusBlocking keeps the corpus gate's blocking lines; its review lines are
// for the developer's ruling and do not fail publication.
func corpusBlocking(out []byte) []finding {
	var findings []finding
	for line := range strings.Lines(string(out)) {
		if line = strings.TrimSpace(line); strings.HasPrefix(line, "block ") {
			findings = append(findings, finding{"corpus", corpusDir, line})
		}
	}
	return findings
}
