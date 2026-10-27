// Command corpus-tarball builds the Published Corpus release asset
// axiom-corpus-<export_id>.tar.zst from a corpus directory, byte-reproducibly:
// the same file names and contents give the same archive on every OS,
// whatever the files' mtimes, owners or permission bits.
//
// Usage (from the repository root):
//
//	corpus-tarball [-corpus corpus] [-out .] [-version 2.0.0]
//	corpus-tarball -bridge-tag v2.0.0 -release-source cmd/release.go [-corpus corpus] [-out .]
//
// The first form writes the asset and prints its path, SHA-256 and, with
// -version, its Release download URL. The second form decides from the
// corpusURL constant in -release-source whether -bridge-tag is the Bridge
// Release tag. If it is not, it builds nothing and prints bridge=false. If it
// is, it builds the asset and fails unless the asset's SHA-256 and URL equal
// the corpusSHA256 and corpusURL constants. Output lines are key=value, so
// they can be appended to $GITHUB_OUTPUT.
package main

import (
	"archive/tar"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/klauspost/compress/zstd"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
)

const (
	releaseDownloadBase = "https://github.com/BuildCoherence/axiom-reason-ea/releases/download/"
	zstdLevel           = zstd.SpeedBestCompression
	fileMode            = 0o644
	dirMode             = 0o755
)

var exportIDPattern = regexp.MustCompile(`^[0-9]{8}T[0-9]{6}Z$`)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("corpus-tarball", flag.ContinueOnError)
	flags.SetOutput(stderr)
	corpusDir := flags.String("corpus", "corpus", "Published Corpus directory to archive")
	outDir := flags.String("out", ".", "directory to write axiom-corpus-<export_id>.tar.zst into")
	version := flags.String("version", "", "release version without the leading v; prints the asset's Release URL")
	bridgeTag := flags.String("bridge-tag", "", "release tag being built; checks the asset against -release-source when it is the Bridge tag")
	releaseSource := flags.String("release-source", "", "Go file declaring the corpusSHA256 and corpusURL constants (with -bridge-tag)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintf(stderr, "corpus-tarball: unexpected arguments %q\n", flags.Args())
		return 2
	}
	if (*bridgeTag == "") != (*releaseSource == "") {
		fmt.Fprintln(stderr, "corpus-tarball: -bridge-tag and -release-source go together")
		return 2
	}

	if *bridgeTag != "" {
		return bridgeCheck(*bridgeTag, *releaseSource, *corpusDir, *outDir, stdout, stderr)
	}

	asset, err := build(*corpusDir, *outDir)
	if err != nil {
		fmt.Fprintf(stderr, "corpus-tarball: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "asset=%s\nsha256=%s\n", asset.path, asset.sha256)
	if *version != "" {
		fmt.Fprintf(stdout, "url=%s\n", assetURL("v"+strings.TrimPrefix(*version, "v"), filepath.Base(asset.path)))
	}
	return 0
}

func bridgeCheck(tag, releaseSource, corpusDir, outDir string, stdout, stderr io.Writer) int {
	consts, err := readStringConsts(releaseSource, "corpusSHA256", "corpusURL")
	if err != nil {
		fmt.Fprintf(stderr, "corpus-tarball: %v\n", err)
		return 1
	}
	wantSHA, wantURL := consts["corpusSHA256"], consts["corpusURL"]
	if !strings.HasPrefix(wantURL, releaseDownloadBase+tag+"/") {
		fmt.Fprintf(stderr, "corpus-tarball: %s is not the Bridge Release tag (corpusURL %q); the corpus is not rebuilt\n", tag, wantURL)
		fmt.Fprintln(stdout, "bridge=false")
		return 0
	}

	asset, err := build(corpusDir, outDir)
	if err != nil {
		fmt.Fprintf(stderr, "corpus-tarball: %v\n", err)
		return 1
	}
	gotURL := assetURL(tag, filepath.Base(asset.path))
	failed := false
	if asset.sha256 != wantSHA {
		fmt.Fprintf(stderr, "corpus-tarball: Bridge tag %s: built %s has SHA-256 %s, but corpusSHA256 in %s is %q\n",
			tag, asset.path, asset.sha256, releaseSource, wantSHA)
		failed = true
	}
	if gotURL != wantURL {
		fmt.Fprintf(stderr, "corpus-tarball: Bridge tag %s: built asset URL is %s, but corpusURL in %s is %q\n",
			tag, gotURL, releaseSource, wantURL)
		failed = true
	}
	if failed {
		return 1
	}
	fmt.Fprintf(stdout, "bridge=true\nasset=%s\nsha256=%s\nurl=%s\n", asset.path, asset.sha256, gotURL)
	return 0
}

func assetURL(tag, name string) string {
	return releaseDownloadBase + tag + "/" + name
}

type builtAsset struct {
	path   string
	sha256 string
}

// build writes <outDir>/axiom-corpus-<export_id>.tar.zst from corpusDir.
func build(corpusDir, outDir string) (builtAsset, error) {
	c, err := corpus.Open(corpusDir)
	if err != nil {
		return builtAsset{}, err
	}
	if !exportIDPattern.MatchString(c.ExportID()) {
		return builtAsset{}, fmt.Errorf("%s: export_id %q is not YYYYMMDDTHHMMSSZ", filepath.Join(corpusDir, "corpus.json"), c.ExportID())
	}
	entries, err := listEntries(corpusDir)
	if err != nil {
		return builtAsset{}, err
	}

	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return builtAsset{}, err
	}
	final := filepath.Join(outDir, "axiom-corpus-"+c.ExportID()+".tar.zst")
	tmp, err := os.CreateTemp(outDir, ".axiom-corpus-*.tmp")
	if err != nil {
		return builtAsset{}, err
	}
	defer os.Remove(tmp.Name())
	sum := sha256.New()
	if err := writeArchive(io.MultiWriter(tmp, sum), corpusDir, entries); err != nil {
		tmp.Close()
		return builtAsset{}, err
	}
	if err := tmp.Close(); err != nil {
		return builtAsset{}, err
	}
	if err := os.Rename(tmp.Name(), final); err != nil {
		return builtAsset{}, err
	}
	return builtAsset{path: final, sha256: hex.EncodeToString(sum.Sum(nil))}, nil
}

type entry struct {
	name  string // slash-separated, relative to the corpus root
	isDir bool
}

// listEntries returns every directory and regular file under root, sorted by
// slash-separated name, so the order does not depend on the OS's walk order.
func listEntries(root string) ([]entry, error) {
	var entries []entry
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		switch {
		case d.IsDir():
			entries = append(entries, entry{name: name, isDir: true})
		case d.Type().IsRegular():
			entries = append(entries, entry{name: name})
		default:
			return fmt.Errorf("%s: only regular files and directories can be archived", path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })
	return entries, nil
}

func writeArchive(w io.Writer, root string, entries []entry) error {
	enc, err := zstd.NewWriter(w, zstd.WithEncoderLevel(zstdLevel), zstd.WithEncoderConcurrency(1))
	if err != nil {
		return err
	}
	tw := tar.NewWriter(enc)
	epoch := time.Unix(0, 0).UTC()
	for _, e := range entries {
		hdr := &tar.Header{Name: e.name, ModTime: epoch, Format: tar.FormatPAX}
		var content []byte
		if e.isDir {
			hdr.Typeflag = tar.TypeDir
			hdr.Name += "/"
			hdr.Mode = dirMode
		} else {
			content, err = os.ReadFile(filepath.Join(root, filepath.FromSlash(e.name)))
			if err != nil {
				return err
			}
			hdr.Typeflag = tar.TypeReg
			hdr.Mode = fileMode
			hdr.Size = int64(len(content))
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return fmt.Errorf("%s: %w", e.name, err)
		}
		if _, err := tw.Write(content); err != nil {
			return fmt.Errorf("%s: %w", e.name, err)
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return enc.Close()
}

// readStringConsts reads the named string constants from a Go source file
// without compiling it, so the check sees exactly what the binary compiles in.
func readStringConsts(path string, names ...string) (map[string]string, error) {
	file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.SkipObjectResolution)
	if err != nil {
		return nil, err
	}
	want := make(map[string]bool, len(names))
	for _, n := range names {
		want[n] = true
	}
	found := map[string]string{}
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
		}
		for _, spec := range gen.Specs {
			vs := spec.(*ast.ValueSpec)
			for i, ident := range vs.Names {
				if !want[ident.Name] || i >= len(vs.Values) {
					continue
				}
				lit, ok := vs.Values[i].(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					return nil, fmt.Errorf("%s: constant %s is not a string literal", path, ident.Name)
				}
				value, err := strconv.Unquote(lit.Value)
				if err != nil {
					return nil, fmt.Errorf("%s: constant %s: %w", path, ident.Name, err)
				}
				found[ident.Name] = value
			}
		}
	}
	var missing []string
	for _, n := range names {
		if _, ok := found[n]; !ok {
			missing = append(missing, n)
		}
	}
	if len(missing) > 0 {
		return nil, errors.New(path + ": missing string constant(s) " + strings.Join(missing, ", "))
	}
	return found, nil
}
