// Command toolchain-floor fails unless the Go toolchain running it is at least
// the `toolchain` directive in go.mod. GoReleaser runs it as a before hook, so
// a release built with an older toolchain (one that still trusts a revoked
// root, say) stops before any build.
//
// Usage (from the repository root): go run ./scripts/toolchain-floor
package main

import (
	"errors"
	"fmt"
	"go/version"
	"io"
	"os"
	"runtime"

	"golang.org/x/mod/modfile"
)

func main() {
	os.Exit(run("go.mod", runtime.Version(), os.Stdout, os.Stderr))
}

func run(gomodPath, goVersion string, stdout, stderr io.Writer) int {
	data, err := os.ReadFile(gomodPath)
	if err == nil {
		err = check(gomodPath, data, goVersion)
	}
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "toolchain-floor: %v\n", err)
		return 1
	}
	_, _ = fmt.Fprintf(stdout, "toolchain-floor: %s meets the go.mod toolchain floor\n", goVersion)
	return 0
}

// check reports whether goVersion is a release at or above the toolchain
// directive of the go.mod file in data.
func check(gomodPath string, data []byte, goVersion string) error {
	f, err := modfile.Parse(gomodPath, data, nil)
	if err != nil {
		return err
	}
	if f.Toolchain == nil {
		return errors.New(gomodPath + " has no toolchain directive")
	}
	floor := f.Toolchain.Name
	if !version.IsValid(floor) {
		return fmt.Errorf("%s: toolchain %q is not a Go release name", gomodPath, floor)
	}
	if !version.IsValid(goVersion) {
		return fmt.Errorf("running %q, which is not a Go release; set GOTOOLCHAIN=%s or later", goVersion, floor)
	}
	if version.Compare(goVersion, floor) < 0 {
		return fmt.Errorf("running %s, below the %s toolchain %s; set GOTOOLCHAIN=%s or later", goVersion, gomodPath, floor, floor)
	}
	return nil
}
