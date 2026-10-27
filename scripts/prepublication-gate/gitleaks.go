package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

const gitleaksConfig = ".gitleaks.toml"

type leak struct {
	RuleID    string
	File      string
	StartLine int
	Commit    string
}

func (g *gate) gitleaksLeg(ctx context.Context) ([]finding, error) {
	root, err := filepath.Abs(g.root)
	if err != nil {
		return nil, err
	}
	mode := "dir"
	var extra []string
	if isGitRepo(root) {
		mode, extra = "git", []string{"--log-opts=--all"}
	}
	leaks, err := g.gitleaks(ctx, root, mode, root, extra...)
	if err != nil {
		return nil, err
	}
	var out []finding
	for _, l := range leaks {
		loc := relTo(root, l.File) + ":" + strconv.Itoa(l.StartLine)
		if l.Commit != "" {
			loc = l.Commit + ":" + loc
		}
		out = append(out, finding{"gitleaks", loc, l.RuleID})
	}
	if g.scope != nil && len(g.scope.texts) > 0 {
		scoped, err := g.gitleaksScope(ctx, root)
		if err != nil {
			return nil, err
		}
		out = append(out, scoped...)
	}
	return out, nil
}

// gitleaksScope writes each scope text to its own file so a leak maps back to its label.
func (g *gate) gitleaksScope(ctx context.Context, root string) ([]finding, error) {
	dir, err := os.MkdirTemp("", "prepublication-scope-")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(dir) }()
	labels := map[string]string{}
	for i, item := range g.scope.texts {
		name := fmt.Sprintf("%06d.txt", i)
		labels[name] = item.label
		if err := os.WriteFile(filepath.Join(dir, name), []byte(item.text), 0o600); err != nil {
			return nil, err
		}
	}
	leaks, err := g.gitleaks(ctx, root, "dir", dir)
	if err != nil {
		return nil, err
	}
	var out []finding
	for _, l := range leaks {
		out = append(out, finding{"gitleaks-scope", labels[filepath.Base(l.File)] + ":" + strconv.Itoa(l.StartLine), l.RuleID})
	}
	return out, nil
}

func (g *gate) gitleaks(ctx context.Context, root, mode, target string, extra ...string) ([]leak, error) {
	report, err := os.CreateTemp("", "gitleaks-*.json")
	if err != nil {
		return nil, err
	}
	if err := report.Close(); err != nil {
		return nil, err
	}
	defer func() { _ = os.Remove(report.Name()) }()
	args := []string{mode, "--no-banner", "--redact", "--exit-code=0", "--report-format=json", "--report-path=" + report.Name()}
	if _, err := os.Stat(filepath.Join(root, gitleaksConfig)); err == nil {
		args = append(args, "--config="+filepath.Join(root, gitleaksConfig))
	}
	args = append(args, extra...)
	args = append(args, target)
	if _, err := g.run(ctx, root, "gitleaks", args...); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(report.Name())
	if err != nil {
		return nil, err
	}
	var leaks []leak
	if err := json.Unmarshal(data, &leaks); err != nil {
		return nil, fmt.Errorf("gitleaks report: %w", err)
	}
	return leaks, nil
}

func relTo(root, p string) string {
	if !filepath.IsAbs(p) {
		return filepath.ToSlash(p)
	}
	if rel, err := filepath.Rel(root, p); err == nil {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(p)
}
