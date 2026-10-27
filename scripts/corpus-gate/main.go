// Command corpus-gate checks a Published Corpus directory offline: lake
// build, import resolution, per-file SHA-256, Windows reserved names, graph
// artifacts and a PII pattern grep. Diagnostics name paths, never values.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
)

const (
	exitPass  = 0
	exitBlock = 1
	exitError = 2
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	code := run(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr, gateOptions{})
	stop()
	os.Exit(code)
}

func run(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer, opts gateOptions) int {
	fs := flag.NewFlagSet("corpus-gate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	report := fs.String("report", "", "write every finding as JSON to this file")
	fs.StringVar(&opts.lakeLog, "lake-log", "", "write lake build's full output to this file")
	literals := fs.String("literals", "", "JSON file (- for stdin) of account text sets the corpus must not carry")
	fs.Usage = func() {
		_, _ = fmt.Fprintln(stderr, "usage: corpus-gate [-report findings.json] [-lake-log lake.log] [-literals file|-] <corpus-dir>")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return exitError
	}
	if fs.NArg() != 1 {
		fs.Usage()
		return exitError
	}
	if *literals != "" {
		sets, err := readLiterals(*literals, stdin)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "corpus-gate: %v\n", err)
			return exitError
		}
		opts.literals = append(opts.literals, sets...)
	}
	findings, err := runGate(ctx, fs.Arg(0), opts)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "corpus-gate: %v\n", err)
		return exitError
	}
	for _, f := range findings {
		_, _ = fmt.Fprintln(stdout, f)
	}
	if *report != "" {
		if err := writeReport(*report, findings); err != nil {
			_, _ = fmt.Fprintf(stderr, "corpus-gate: %v\n", err)
			return exitError
		}
	}
	blocking, review := 0, 0
	for _, f := range findings {
		if f.Severity == severityBlock {
			blocking++
		} else {
			review++
		}
	}
	_, _ = fmt.Fprintf(stderr, "corpus-gate: %d blocking, %d for review\n", blocking, review)
	if blocking > 0 {
		return exitBlock
	}
	return exitPass
}

func writeReport(path string, findings []finding) error {
	if findings == nil {
		findings = []finding{}
	}
	data, err := json.MarshalIndent(map[string]any{"findings": findings}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		return errors.Join(errors.New("write report"), err)
	}
	return nil
}
