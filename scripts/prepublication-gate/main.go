// Command prepublication-gate checks the axiom-reason-ea tree and its history
// before publication: the deny-list, gitleaks, dependency licenses, font
// licenses and the corpus gate. With -scope it also collects every input the
// repository's visibility flip exposes (refs, activity, issue and PR text with
// prior revisions) and scans it. Diagnostics name locations, never matched
// values or deny-list patterns.
//
// Usage (from the repository root):
//
//	prepublication-gate [-root .] [-legs deny,gitleaks,licenses,fonts,corpus]
//	prepublication-gate -scope OWNER/NAME [-root .]
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"slices"
	"strings"
)

const (
	exitPass  = 0
	exitBlock = 1
	exitError = 2
)

var allLegs = []string{"deny", "gitleaks", "licenses", "fonts", "corpus"}

type finding struct {
	leg, location, kind string
}

func (f finding) String() string { return f.leg + " " + f.location + " " + f.kind }

// errSkip marks a leg that decided not to run; its message is printed and the leg passes.
type errSkip struct{ reason string }

func (e errSkip) Error() string { return "skipped: " + e.reason }

type gate struct {
	root  string
	env   func(string) string
	run   runner
	scope *scopeInputs
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	code := mainRun(ctx, os.Args[1:], os.Stdout, os.Stderr, os.Getenv, execRunner())
	stop()
	os.Exit(code)
}

func mainRun(ctx context.Context, args []string, stdout, stderr io.Writer, env func(string) string, run runner) int {
	fs := flag.NewFlagSet("prepublication-gate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	root := fs.String("root", ".", "repository root to check")
	legsFlag := fs.String("legs", strings.Join(allLegs, ","), "comma-separated legs to run")
	scopeRepo := fs.String("scope", "", "OWNER/NAME: also collect and scan the full gate scope from GitHub (needs gh and an origin remote)")
	if err := fs.Parse(args); err != nil {
		return exitError
	}
	if fs.NArg() != 0 {
		_, _ = fmt.Fprintf(stderr, "prepublication-gate: unexpected arguments %q\n", fs.Args())
		return exitError
	}
	legs := strings.Split(*legsFlag, ",")
	for _, l := range legs {
		if !slices.Contains(allLegs, l) {
			_, _ = fmt.Fprintf(stderr, "prepublication-gate: unknown leg %q (want some of %s)\n", l, strings.Join(allLegs, ","))
			return exitError
		}
	}

	g := &gate{root: *root, env: env, run: run}
	var findings []finding
	if *scopeRepo != "" {
		inputs, scopeFindings, err := collectScope(ctx, run, *root, *scopeRepo)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "prepublication-gate: scope: %v\n", err)
			return exitError
		}
		g.scope = inputs
		findings = append(findings, scopeFindings...)
	}

	failed := false
	for _, leg := range legs {
		got, err := g.runLeg(ctx, leg)
		var skip errSkip
		switch {
		case errors.As(err, &skip):
			_, _ = fmt.Fprintf(stdout, "%s %s\n", leg, skip.Error())
		case err != nil:
			_, _ = fmt.Fprintf(stderr, "prepublication-gate: %s: %v\n", leg, err)
			failed = true
		}
		findings = append(findings, got...)
	}
	for _, f := range findings {
		_, _ = fmt.Fprintln(stdout, f)
	}
	_, _ = fmt.Fprintf(stderr, "prepublication-gate: %d findings\n", len(findings))
	switch {
	case failed:
		return exitError
	case len(findings) > 0:
		return exitBlock
	}
	return exitPass
}

func (g *gate) runLeg(ctx context.Context, leg string) ([]finding, error) {
	switch leg {
	case "deny":
		return g.denyLeg(ctx)
	case "gitleaks":
		return g.gitleaksLeg(ctx)
	case "licenses":
		return g.licensesLeg(ctx)
	case "fonts":
		return fontsLeg(g.root)
	case "corpus":
		return g.corpusLeg(ctx)
	}
	return nil, fmt.Errorf("unknown leg %q", leg)
}
