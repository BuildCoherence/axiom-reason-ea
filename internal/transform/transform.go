// Package transform is a thin wrapper over `lake exe axm_transform`.
//
// It writes one JSON request to stdin, scans NDJSON responses off stdout,
// streams stderr to the CLI's stderr (so the user sees live Lake progress),
// and surfaces the first per-file error when the subprocess fails.
package transform

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// Request is the JSON payload on stdin.
//
// Mode selects the pipeline: "" (or "forward") runs the
// upload/check forward transform; "reverse" runs the fork
// reverse transform inside the exe (see axm-transform
// §5). `omitempty` keeps existing forward-only callers
// (upload.go, check.go, fork.go's pre-step-6 path)
// byte-identical on the wire when Mode == "".
//
// ServerTime is CLI wall-clock at batch start as Unix seconds (the exe
// stamps Axioms.lean AuthenticatedTerm timestamps from this and they must
// land in the server's 5-minute validator window). Unix seconds is the
// same shape the validator's server_time uses, so the Lean side parses it
// directly as the timestamp — no date parsing, no /1000.
// DryRun=true validates only (used by `axm check`).
type Request struct {
	Mode       string `json:"mode,omitempty"` // "" | "forward" | "reverse"
	ServerTime int64  `json:"server_time"`    // Unix seconds
	Username   string `json:"username"`
	DryRun     bool   `json:"dry_run"`
	Files      []File `json:"files"`
}

// File entries are processed in the order received (the CLI topo-sorts
// before calling Invoke).
//
// Forward-mode callers populate WorkspaceImportMap. Reverse-mode
// callers (fork.go, landing in step 6) populate ReverseImportMap
// instead. Both maps are `omitempty` so the wire payload only
// carries the field that matters for the active mode.
type File struct {
	Path               string            `json:"path"` // "Axioms.lean" or "Workspace/Foo.lean"
	Source             string            `json:"source"`
	FileID             string            `json:"file_id"`                        // pre-allocated unified 8-char id
	WorkspaceImportMap map[string]string `json:"workspace_import_map,omitempty"` // forward: "Workspace.Foo" -> "<file_id>"
	ReverseImportMap   map[string]string `json:"reverse_import_map,omitempty"`   // reverse: "<file_id>" -> "Workspace.<stem>"
	// TransitiveOpenIDs lists ADDITIONAL same-user workspace file_ids
	// (the unified id) reachable transitively through bundle/junction re-exports
	// but NOT among this file's direct workspace imports. The exe appends one
	// `open <id>` per entry AFTER the direct rewritten-import opens, deduped.
	// omitempty so existing forward callers stay byte-identical on the wire.
	TransitiveOpenIDs []string `json:"transitive_open_ids,omitempty"` // forward: extra same-user opens (junction chains)
	ForkedFrom        *string  `json:"forked_from,omitempty"`
}

// Response is one NDJSON line on stdout (axm-transform.md §4).
// Error == ""  -> success (Content+DependsOn populated on non-dry-run).
// Error != ""  -> per-file failure; Details carries the structured payload.
type Response struct {
	Path      string        `json:"path"`
	FileID    string        `json:"file_id,omitempty"` // unified file_id (the input echoed back)
	Content   string        `json:"content,omitempty"`
	DependsOn []string      `json:"depends_on,omitempty"` // unified file_ids
	Error     string        `json:"error,omitempty"`      // "rule_violation" | "compile" | ""
	Details   *ErrorDetails `json:"details,omitempty"`
}

// ErrorDetails is the per-file error payload (axm-transform.md §7).
// Message is always present; Rule appears on rule_violation; Pos is
// required on compile and optional on rule_violation.
type ErrorDetails struct {
	Message string `json:"message"`
	Rule    string `json:"rule,omitempty"`
	Pos     *Pos   `json:"pos,omitempty"`
}

// Pos is a source position passed through verbatim from the exe's
// elaboration error.
type Pos struct {
	Line int `json:"line"`
	Col  int `json:"col"`
}

// maxLineBytes caps the bufio.Scanner token size to 10 MB per NDJSON
// line. A single authenticated term fits well below this limit.
const maxLineBytes = 10 * 1024 * 1024

// Invoke runs `lake exe axm_transform` with cwd=workspaceRoot, JSON-encodes
// req on stdin, scans NDJSON off stdout, pipes stderr to the caller-supplied
// writer (Cobra callers pass `cmd.ErrOrStderr()` so integration tests can
// capture it; pass os.Stderr from non-cobra contexts).
//
// Non-JSON stdout lines (Lean panics, stray prints, "error: no default
// toolchain", …) are echoed to stderrW with an `axm transform: ` prefix so
// the user sees the actual failure cause instead of a cryptic "transform
// reported errors".
//
// Return contract:
//   - Clean exit: results complete, err == nil. Per-file failures ride on
//     Response.Error; caller decides abort.
//   - Non-zero exit: results = what was scanned; err wraps the exit code
//     and names the first failing path.
//   - ctx cancel: subprocess killed; err = ctx.Err().
//   - `lake` missing: err wraps ErrLakeMissing.
func Invoke(ctx context.Context, workspaceRoot string, req Request, stderrW io.Writer) ([]Response, error) {
	if stderrW == nil {
		stderrW = os.Stderr
	}

	// Override: tests set AXM_TRANSFORM_BIN to point at a fake binary.
	name := "lake"
	args := []string{"exe", "axm_transform"}
	if override := os.Getenv("AXM_TRANSFORM_BIN"); override != "" {
		name = override
		args = nil
	}

	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = workspaceRoot
	cmd.Stderr = stderrW

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		// Missing binary on PATH: report via ErrLakeMissing.
		if isExecNotFound(err) {
			return nil, fmt.Errorf("%w: %v", ErrLakeMissing, err)
		}
		return nil, err
	}

	// Encode request on a goroutine so we can start reading stdout immediately.
	encErrCh := make(chan error, 1)
	go func() {
		err := json.NewEncoder(stdin).Encode(req)
		// Ignore close error: on cancellation the pipe may already be
		// closed, and any I/O failure will surface via Wait() or the
		// encode error above.
		_ = stdin.Close()
		encErrCh <- err
	}()

	var results []Response
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineBytes)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var r Response
		if err := json.Unmarshal(line, &r); err != nil {
			// Non-JSON line on stdout — almost certainly a Lean panic or
			// stray print that would otherwise be silently dropped. Echo
			// it to the caller's stderr with a clear prefix so the user
			// sees the actual failure cause.
			fmt.Fprintf(stderrW, "axm transform: %s\n", line)
			continue
		}
		results = append(results, r)
	}
	scanErr := scanner.Err()

	waitErr := cmd.Wait()

	// Drain the encoder goroutine; it closed stdin when it finished.
	encErr := <-encErrCh

	// ctx cancellation wins over other errors — caller asked to stop.
	if ctxErr := ctx.Err(); ctxErr != nil {
		return results, ctxErr
	}

	if waitErr != nil {
		// Non-zero exit: find the first Response with an error string set.
		var firstFailingPath string
		for _, r := range results {
			if r.Error != "" {
				firstFailingPath = r.Path
				break
			}
		}
		if firstFailingPath == "" && len(results) > 0 {
			firstFailingPath = results[len(results)-1].Path
		}
		if firstFailingPath != "" {
			return results, fmt.Errorf("transform: subprocess failed at %q: %w", firstFailingPath, waitErr)
		}
		return results, fmt.Errorf("transform: subprocess failed: %w", waitErr)
	}

	if scanErr != nil {
		return results, fmt.Errorf("transform: stdout scan error: %w", scanErr)
	}
	if encErr != nil {
		return results, fmt.Errorf("transform: stdin encode error: %w", encErr)
	}
	return results, nil
}

// isExecNotFound is true if err indicates that the program could not be
// located on PATH (or similar startup failure).
func isExecNotFound(err error) bool {
	return errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist)
}
