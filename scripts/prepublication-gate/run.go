package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// runner runs a command in dir and returns its stdout. A non-zero exit is a
// *cmdError carrying the exit code and stderr.
type runner func(ctx context.Context, dir, name string, args ...string) ([]byte, error)

type cmdError struct {
	cmd    string
	code   int
	stderr string
}

func (e *cmdError) Error() string {
	return fmt.Sprintf("%s: exit %d: %s", e.cmd, e.code, strings.TrimSpace(e.stderr))
}

func execRunner() runner {
	return func(ctx context.Context, dir, name string, args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Dir = dir
		var stdout, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &stdout, &stderr
		err := cmd.Run()
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return stdout.Bytes(), &cmdError{cmd: name + " " + firstArg(args), code: exitErr.ExitCode(), stderr: stderr.String()}
		}
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		return stdout.Bytes(), nil
	}
}

func firstArg(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return args[0]
}
