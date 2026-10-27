// Package upgrade replaces the executable and converges Workspace templates.
package upgrade

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/minio/selfupdate"
	"golang.org/x/mod/semver"
)

const (
	maxExtractedExecutableBytes = 50 * 1024 * 1024
	maxArchiveBytes             = 100 * 1024 * 1024
	maxSidecarBytes             = 1 * 1024 * 1024
	archiveProjectName          = "axm"
)

// Result captures the outcome of a binary upgrade attempt.
type Result struct {
	OldVersion     string
	NewVersion     string
	AlreadyCurrent bool
}

// Options carries the binary target and process-continuation policy.
type Options struct {
	RunningVersion string
	TargetVersion  string
	ReleaseRepo    string
	BinaryName     string
	GOOS, GOARCH   string
	Stdout, Stderr io.Writer
	SkipReExec     bool
	HTTPClient     *http.Client
}

// RunBinaryUpgrade verifies and installs a Release archive, then optionally re-execs.
func RunBinaryUpgrade(ctx context.Context, opts Options) (*Result, error) {
	if opts.RunningVersion == opts.TargetVersion && opts.RunningVersion != "dev" {
		return &Result{OldVersion: opts.RunningVersion, NewVersion: opts.TargetVersion, AlreadyCurrent: true}, nil
	}
	if opts.TargetVersion == "" {
		return nil, errors.New("axm upgrade: target version is empty")
	}
	if !semver.IsValid("v" + opts.TargetVersion) {
		return nil, fmt.Errorf("axm upgrade: target version %q is not a valid semver", opts.TargetVersion)
	}
	if opts.ReleaseRepo == "" {
		return nil, errors.New("axm upgrade: release repo is empty")
	}
	if opts.GOOS == "" || opts.GOARCH == "" {
		return nil, errors.New("axm upgrade: GOOS/GOARCH must be set in Options")
	}
	if opts.BinaryName == "" {
		opts.BinaryName = "axm"
	}
	client := opts.HTTPClient
	if client == nil {
		client = newReleaseClient()
	}
	stderr := opts.Stderr
	if stderr == nil {
		stderr = io.Discard
	}
	urls := BuildArchiveURLs(opts.ReleaseRepo, opts.TargetVersion, opts.GOOS, opts.GOARCH)
	fmt.Fprintln(stderr, "axm upgrade: downloading archive...")
	archive, sums, err := downloadAll(ctx, client, urls)
	if err != nil {
		return nil, err
	}
	fmt.Fprintln(stderr, "axm upgrade: verifying checksum...")
	if err := verifyChecksum(archive, sums, opts.GOOS, opts.GOARCH); err != nil {
		return nil, fmt.Errorf("%w (artifacts: %s, %s)", err, urls.Archive, urls.Checksums)
	}
	innerBinary, err := extractBinary(archive, opts.BinaryName, opts.GOOS)
	if err != nil {
		return nil, fmt.Errorf("%w (archive: %s)", err, urls.Archive)
	}

	// Capture before selfupdate renames and removes the running image.
	var execPath string
	if !opts.SkipReExec {
		execPath, err = os.Executable()
		if err != nil {
			return nil, fmt.Errorf("axm upgrade: locating executable before self-replace: %w", err)
		}
	}
	fmt.Fprintln(stderr, "axm upgrade: replacing binary...")
	if err := selfReplace(innerBinary); err != nil {
		return nil, err
	}
	if opts.SkipReExec {
		return &Result{OldVersion: opts.RunningVersion, NewVersion: opts.TargetVersion}, nil
	}
	fmt.Fprintln(stderr, "axm upgrade: launching new binary for workspace phase...")
	if err := reexecIntoWorkspacePhase(execPath); err != nil {
		msg := fmt.Sprintf("axm upgraded to %s, but launching the new binary for the workspace phase failed: %v.\nRe-run `axm upgrade` from this Workspace to complete it.", opts.TargetVersion, err)
		fmt.Fprintln(stderr, msg)
		return nil, fmt.Errorf("%s", msg)
	}
	return &Result{OldVersion: opts.RunningVersion, NewVersion: opts.TargetVersion}, nil
}

// ArchiveExt returns the platform's published archive extension.
func ArchiveExt(goos string) string {
	if goos == "windows" {
		return ".zip"
	}
	return ".tar.gz"
}

// ArchiveURLs names the version-pinned archive and checksum sidecar.
type ArchiveURLs struct {
	Archive   string
	Checksums string
}

// BuildArchiveURLs constructs the two GitHub Release asset URLs.
func BuildArchiveURLs(repo, version, goos, goarch string) ArchiveURLs {
	archive := fmt.Sprintf("%s_%s_%s%s", archiveProjectName, goos, goarch, ArchiveExt(goos))
	return ArchiveURLs{
		Archive:   ReleaseAssetURL(repo, version, archive),
		Checksums: ReleaseAssetURL(repo, version, "checksums.txt"),
	}
}

func downloadAll(ctx context.Context, client *http.Client, urls ArchiveURLs) (archive, sums []byte, err error) {
	if archive, err = downloadOne(ctx, client, "archive", urls.Archive, maxArchiveBytes); err != nil {
		return
	}
	sums, err = downloadOne(ctx, client, "checksums", urls.Checksums, maxSidecarBytes)
	return
}

func downloadOne(ctx context.Context, client *http.Client, label, url string, maxBytes int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: GET %s: %w", label, url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("%s: GET %s: HTTP 429: %w", label, url, ErrRateLimited)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, maxSidecarBytes))
		return nil, fmt.Errorf("%s: GET %s: server returned %d: %s", label, url, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%s: reading body from %s: %w", label, url, err)
	}
	if int64(len(body)) > maxBytes {
		return nil, fmt.Errorf("%s: GET %s: body exceeds %d-byte limit", label, url, maxBytes)
	}
	return body, nil
}

// verifyChecksum parses checksums.txt for the row matching the
// published archive filename (`<archiveProjectName>_<goos>_<goarch>.<ext>`),
// then sha256s the archive bytes and compares. checksums.txt is the
// standard sha256sum-style output: `<hex-sum>  <filename>` per line.
// Tolerates either two-space separator (sha256sum default) or any
// whitespace run; tolerates the `*` binary-mode marker
// (`<sum> *<filename>`) some tools emit.
func verifyChecksum(archive, sums []byte, goos, goarch string) error {
	want := fmt.Sprintf("%s_%s_%s%s", archiveProjectName, goos, goarch, ArchiveExt(goos))
	var expected string
	sc := bufio.NewScanner(bytes.NewReader(sums))
	// Default Scanner buffer is 64 KiB; checksums.txt files are tiny
	// (one line per OS/arch combo + header) so the default suffices.
	for sc.Scan() {
		line := sc.Text()
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		// Strip the leading `*` binary-mode marker if present.
		name := strings.TrimPrefix(fields[1], "*")
		if name == want {
			expected = fields[0]
			break
		}
	}
	if err := sc.Err(); err != nil {
		return fmt.Errorf("checksum: scanning checksums.txt: %w", err)
	}
	if expected == "" {
		return fmt.Errorf("checksum: %q not listed in checksums.txt", want)
	}
	actual := fmt.Sprintf("%x", sha256.Sum256(archive))
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("checksum: %s sha256=%s but checksums.txt declares %s",
			want, actual, expected)
	}
	return nil
}

// extractBinary returns the inner binary bytes from `archive`. Format
// is determined by goos: .tar.gz on Unix, .zip on Windows.
func extractBinary(archive []byte, binaryName, goos string) ([]byte, error) {
	if goos == "windows" {
		return extractZip(archive, binaryName+".exe")
	}
	return extractTarGz(archive, binaryName)
}

// extractTarGz scans a tar.gz for the entry matching wantName (exact
// or basename — tolerant of a leading `./` or directory prefix). The
// read cap bounds memory if the archive is malformed and, by reading one
// byte past the cap, distinguishes an at-limit file from an over-limit
// one so an oversized entry is rejected rather than silently truncated.
func extractTarGz(archive []byte, wantName string) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, fmt.Errorf("extract: gzip: %w", err)
	}
	defer func() { _ = gz.Close() }()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil, fmt.Errorf("extract: %q not found in tar.gz", wantName)
		}
		if err != nil {
			return nil, fmt.Errorf("extract: reading tar: %w", err)
		}
		if hdr.Name == wantName || filepath.Base(hdr.Name) == wantName {
			var buf bytes.Buffer
			n, err := io.CopyN(&buf, tr, maxExtractedExecutableBytes+1)
			if err != nil && err != io.EOF {
				return nil, fmt.Errorf("extract: reading %s: %w", wantName, err)
			}
			if n > maxExtractedExecutableBytes {
				return nil, fmt.Errorf("extract: %s exceeds the %d-byte limit; refusing to install a truncated executable", wantName, maxExtractedExecutableBytes)
			}
			return buf.Bytes(), nil
		}
	}
}

// extractZip scans a zip for the entry matching wantName (exact or
// basename — tolerant of a leading directory prefix). The read cap and
// over-limit rejection mirror the tar.gz path.
func extractZip(archive []byte, wantName string) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return nil, fmt.Errorf("extract: zip: %w", err)
	}
	for _, f := range zr.File {
		if f.Name == wantName || filepath.Base(f.Name) == wantName {
			rc, err := f.Open()
			if err != nil {
				return nil, fmt.Errorf("extract: opening %s: %w", wantName, err)
			}
			var buf bytes.Buffer
			n, copyErr := io.CopyN(&buf, rc, maxExtractedExecutableBytes+1)
			_ = rc.Close()
			if copyErr != nil && copyErr != io.EOF {
				return nil, fmt.Errorf("extract: reading %s: %w", wantName, copyErr)
			}
			if n > maxExtractedExecutableBytes {
				return nil, fmt.Errorf("extract: %s exceeds the %d-byte limit; refusing to install a truncated executable", wantName, maxExtractedExecutableBytes)
			}
			return buf.Bytes(), nil
		}
	}
	return nil, fmt.Errorf("extract: %q not found in zip", wantName)
}

// selfReplace atomically replaces the running binary with the bytes
// from the verified archive. selfupdate.Apply, on every platform:
//  1. writes the new bytes to `.<exe>.new` in the same directory,
//  2. renames the running `<exe>` aside to `.<exe>.old`,
//  3. renames `.<exe>.new` into place as `<exe>`,
//  4. removes `.<exe>.old` (Unix) or, when the OS refuses to delete a
//     running image, hides it for cleanup on next launch (Windows).
//
// The step-2 rename is the load-bearing subtlety for the re-exec that
// follows: it moves the inode the running process was loaded from, so
// after Apply returns os.Executable() (which reads /proc/self/exe on
// Linux) resolves to the now-deleted `.<exe>.old` path rather than the
// new binary. The orchestrator therefore captures the install path
// BEFORE calling selfReplace and re-execs that — see RunBinaryUpgrade
// step 7.
//
// We pass empty selfupdate.Options{} because the sha256 check has
// already run; selfupdate's own Checksum / PublicKey hooks would be
// weaker re-verifications of what we just established.
//
// Errors are inspected via selfupdate.RollbackError to distinguish
// "rollback succeeded, prior binary intact" from "rollback itself
// failed, binary missing or half-replaced". The second case is rare
// but load-bearing on Windows where an AV / file indexer can hold a
// handle to <exe>.old; surface a remediation pointing the user at the
// install script rather than letting them sit at a non-functional
// shell.
func selfReplace(binaryBytes []byte) error {
	err := selfupdate.Apply(bytes.NewReader(binaryBytes), selfupdate.Options{})
	if err == nil {
		return nil
	}
	if rbErr := selfupdate.RollbackError(err); rbErr != nil {
		return fmt.Errorf(
			"apply: %w (rollback ALSO failed: %v — the axm binary on disk may be missing or half-replaced; reinstall via the install script: curl -sfL https://install.axiom.computer | sh)",
			err, rbErr,
		)
	}
	return fmt.Errorf("apply: %w (prior axm binary was restored)", err)
}
