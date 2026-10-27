package corpustest

import (
	"archive/tar"
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/klauspost/compress/zstd"
)

// TarZst archives root's tree, entries at the archive root, as a Release
// asset in the axiom-corpus-<export_id>.tar.zst format.
func TarZst(t testing.TB, root string) []byte {
	t.Helper()
	var tarBuf bytes.Buffer
	tw := tar.NewWriter(&tarBuf)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || path == root {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		if d.IsDir() {
			return tw.WriteHeader(&tar.Header{Name: name + "/", Typeflag: tar.TypeDir, Mode: 0o755})
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(data))}); err != nil {
			return err
		}
		_, err = tw.Write(data)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	enc, err := zstd.NewWriter(&out)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := enc.Write(tarBuf.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := enc.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
