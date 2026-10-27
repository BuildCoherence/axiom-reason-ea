package upgrade

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/klauspost/compress/zstd"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
)

const (
	// Bounds a hostile or corrupt asset; the corpus and site archives are far smaller.
	maxUserAssetBytes     = 2 << 30
	maxUserExtractedBytes = 8 << 30
	userAssetDirMode      = 0o755
	userAssetFileMode     = 0o644
	downloadPrefix        = ".download-"
	pointerTempPrefix     = ".current-"
)

var sha256HexRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

// UserAsset is one hash-pinned Release archive installed under ~/.axiom/<Kind>/.
type UserAsset struct {
	Kind   string
	URL    string
	SHA256 string
}

// InstallResult names the active install and whether this run changed it.
type InstallResult struct {
	Dir      string
	Changed  bool
	Warnings []string
}

type installer struct {
	client *http.Client
	// wrap lets tests inject write failures at a named path.
	wrap func(path string, w io.Writer) io.Writer
}

// installUserAsset makes asset the active install under axiomDir/<Kind>, downloading at most once.
func installUserAsset(ctx context.Context, client *http.Client, axiomDir string, asset UserAsset) (*InstallResult, error) {
	if client == nil {
		client = newReleaseClient()
	}
	return (&installer{client: client}).install(ctx, axiomDir, asset)
}

func (in *installer) install(ctx context.Context, axiomDir string, asset UserAsset) (*InstallResult, error) {
	if !sha256HexRe.MatchString(asset.SHA256) {
		return nil, fmt.Errorf("%s: pinned SHA-256 %q is not 64 lowercase hex digits", asset.Kind, asset.SHA256)
	}
	if asset.Kind == "" || strings.ContainsAny(asset.Kind, `/\.`) || asset.URL == "" {
		return nil, fmt.Errorf("%s: invalid install request", asset.Kind)
	}
	kindDir := filepath.Join(axiomDir, asset.Kind)
	target := filepath.Join(kindDir, asset.SHA256)
	if active, err := corpus.ActiveInstall(kindDir); err == nil && active == target {
		return &InstallResult{Dir: target}, nil
	}
	if !installComplete(target, asset.SHA256) {
		if err := in.fetchAndExtract(ctx, kindDir, target, asset); err != nil {
			return nil, err
		}
	}
	if err := in.switchPointer(kindDir, asset.SHA256); err != nil {
		return nil, err
	}
	return &InstallResult{Dir: target, Changed: true, Warnings: removeSuperseded(kindDir, asset.SHA256)}, nil
}

func installComplete(dir, sum string) bool {
	marker, err := os.ReadFile(filepath.Join(dir, corpus.MarkerFile))
	return err == nil && strings.TrimSpace(string(marker)) == sum
}

func (in *installer) fetchAndExtract(ctx context.Context, kindDir, target string, asset UserAsset) error {
	if err := os.MkdirAll(kindDir, userAssetDirMode); err != nil {
		return fmt.Errorf("%s: creating %s: %w", asset.Kind, kindDir, err)
	}
	tmp, err := os.CreateTemp(kindDir, downloadPrefix+"*")
	if err != nil {
		return fmt.Errorf("%s: creating a download file in %s: %w", asset.Kind, kindDir, err)
	}
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
	}()
	if err := in.download(ctx, tmp, asset); err != nil {
		return err
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("%s: rewinding %s: %w", asset.Kind, tmp.Name(), err)
	}
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("%s: removing the incomplete install %s: %w", asset.Kind, target, err)
	}
	if err := in.extract(tmp, target); err != nil {
		_ = os.RemoveAll(target)
		return fmt.Errorf("%s: extracting %s into %s: %w", asset.Kind, asset.URL, target, err)
	}
	if err := in.writeFile(filepath.Join(target, corpus.MarkerFile), []byte(asset.SHA256+"\n")); err != nil {
		_ = os.RemoveAll(target)
		return fmt.Errorf("%s: %w", asset.Kind, err)
	}
	return nil
}

func (in *installer) download(ctx context.Context, dst *os.File, asset UserAsset) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.URL, nil)
	if err != nil {
		return fmt.Errorf("%s: %w", asset.Kind, err)
	}
	resp, err := in.client.Do(req)
	if err != nil {
		return fmt.Errorf("%s: GET %s: %w", asset.Kind, asset.URL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusTooManyRequests {
		return fmt.Errorf("%s: GET %s: HTTP 429: %w", asset.Kind, asset.URL, ErrRateLimited)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: GET %s: server returned %d", asset.Kind, asset.URL, resp.StatusCode)
	}
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(in.writer(dst.Name(), dst), hash), io.LimitReader(resp.Body, maxUserAssetBytes+1))
	if err != nil {
		return fmt.Errorf("%s: downloading %s to %s: %w", asset.Kind, asset.URL, dst.Name(), err)
	}
	if n > maxUserAssetBytes {
		return fmt.Errorf("%s: GET %s: body exceeds %d-byte limit", asset.Kind, asset.URL, int64(maxUserAssetBytes))
	}
	if got := hex.EncodeToString(hash.Sum(nil)); got != asset.SHA256 {
		return fmt.Errorf("%s: checksum: %s has SHA-256 %s, want %s", asset.Kind, asset.URL, got, asset.SHA256)
	}
	return nil
}

func (in *installer) extract(src io.Reader, target string) error {
	dec, err := zstd.NewReader(src, zstd.WithDecoderConcurrency(1))
	if err != nil {
		return err
	}
	defer dec.Close()
	if err := os.MkdirAll(target, userAssetDirMode); err != nil {
		return err
	}
	var total int64
	tr := tar.NewReader(dec)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		rel, err := archiveEntryPath(hdr.Name)
		if err != nil {
			return err
		}
		if rel == "" {
			continue
		}
		dst := filepath.Join(target, filepath.FromSlash(rel))
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(dst, userAssetDirMode); err != nil {
				return err
			}
		case tar.TypeReg:
			total += hdr.Size
			if total > maxUserExtractedBytes {
				return fmt.Errorf("archive expands beyond %d bytes", int64(maxUserExtractedBytes))
			}
			if err := os.MkdirAll(filepath.Dir(dst), userAssetDirMode); err != nil {
				return err
			}
			if err := in.copyFile(dst, tr); err != nil {
				return err
			}
		default:
			return fmt.Errorf("archive entry %q has unsupported type %q", hdr.Name, hdr.Typeflag)
		}
	}
}

func archiveEntryPath(name string) (string, error) {
	clean := path.Clean(strings.TrimPrefix(name, "./"))
	if clean == "." {
		return "", nil
	}
	if path.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, `\`) || filepath.VolumeName(clean) != "" {
		return "", fmt.Errorf("archive entry %q escapes the install directory", name)
	}
	if clean == corpus.MarkerFile {
		return "", fmt.Errorf("archive entry %q collides with the completion marker", name)
	}
	return clean, nil
}

func (in *installer) copyFile(dst string, src io.Reader) error {
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, userAssetFileMode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(in.writer(dst, f), src); err != nil {
		_ = f.Close()
		return fmt.Errorf("writing %s: %w", dst, err)
	}
	return f.Close()
}

func (in *installer) writeFile(dst string, data []byte) error {
	return in.copyFile(dst, bytes.NewReader(data))
}

func (in *installer) writer(path string, w io.Writer) io.Writer {
	if in.wrap == nil {
		return w
	}
	return in.wrap(path, w)
}

func (in *installer) switchPointer(kindDir, name string) error {
	tmp, err := os.CreateTemp(kindDir, pointerTempPrefix+"*")
	if err != nil {
		return fmt.Errorf("creating a pointer file in %s: %w", kindDir, err)
	}
	_, werr := io.WriteString(in.writer(tmp.Name(), tmp), name+"\n")
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		_ = os.Remove(tmp.Name())
		return fmt.Errorf("writing %s: %w", tmp.Name(), err)
	}
	pointer := filepath.Join(kindDir, corpus.PointerFile)
	if err := os.Rename(tmp.Name(), pointer); err != nil {
		_ = os.Remove(tmp.Name())
		return fmt.Errorf("switching %s: %w", pointer, err)
	}
	return nil
}

// removeSuperseded is best-effort: Windows refuses to remove a directory with an open file.
func removeSuperseded(kindDir, active string) []string {
	entries, err := os.ReadDir(kindDir)
	if err != nil {
		return []string{fmt.Sprintf("could not list %s for cleanup: %v", kindDir, err)}
	}
	var warnings []string
	for _, e := range entries {
		if e.Name() == active || e.Name() == corpus.PointerFile {
			continue
		}
		stale := filepath.Join(kindDir, e.Name())
		// Unmark first so a partial removal can never pass as a complete install.
		if e.IsDir() {
			if err := os.Remove(filepath.Join(stale, corpus.MarkerFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
				warnings = append(warnings, fmt.Sprintf("could not remove superseded %s: %v", stale, err))
				continue
			}
		}
		if err := os.RemoveAll(stale); err != nil {
			warnings = append(warnings, fmt.Sprintf("could not remove superseded %s: %v", stale, err))
		}
	}
	return warnings
}
