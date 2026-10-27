package lakefile

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeLakefile writes content to a temp lakefile.lean and returns its path.
func writeLakefile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "lakefile.lean")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}

func TestReadVersion_Valid(t *testing.T) {
	path := writeLakefile(t, `import Lake
open Lake DSL

package axiomClient where
  version := v!"0.3.1"
  srcDir := "."
`)
	got, err := ReadVersion(path)
	if err != nil {
		t.Fatalf("ReadVersion: %v", err)
	}
	if got != "0.3.1" {
		t.Errorf("ReadVersion = %q, want %q (bare semver, no leading v)", got, "0.3.1")
	}
}

func TestReadVersion_ValidWithLeadingWhitespace(t *testing.T) {
	path := writeLakefile(t, "package axiomClient where\n\t\tversion := v!\"1.0.0\"\n")
	got, err := ReadVersion(path)
	if err != nil {
		t.Fatalf("ReadVersion: %v", err)
	}
	if got != "1.0.0" {
		t.Errorf("ReadVersion = %q, want %q", got, "1.0.0")
	}
}

func TestReadVersion_ValidWithMixedWhitespace(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  version  :=  v!"2.10.5"
`)
	got, err := ReadVersion(path)
	if err != nil {
		t.Fatalf("ReadVersion: %v", err)
	}
	if got != "2.10.5" {
		t.Errorf("ReadVersion = %q, want %q", got, "2.10.5")
	}
}

// TestReadVersion_ValidWithLeadingV — the regex captures the inner
// string verbatim; if a workspace stamps `v!"v0.3.1"` (legal Lake
// but non-canonical), the parser strips the leading `v` so callers
// always get the bare semver.
func TestReadVersion_ValidWithLeadingV(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  version := v!"v0.3.1"
`)
	got, err := ReadVersion(path)
	if err != nil {
		t.Fatalf("ReadVersion: %v", err)
	}
	if got != "0.3.1" {
		t.Errorf("ReadVersion = %q, want %q (leading v must be stripped)", got, "0.3.1")
	}
}

func TestReadVersion_MissingVersion(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  srcDir := "."
`)
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrMissingVersionField) {
		t.Errorf("err = %v, want ErrMissingVersionField", err)
	}
}

func TestReadVersion_NoPackageBlock(t *testing.T) {
	path := writeLakefile(t, `import Lake
open Lake DSL

require std from git "https://..."
`)
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrNoPackageBlock) {
		t.Errorf("err = %v, want ErrNoPackageBlock", err)
	}
}

func TestReadVersion_MultiplePackageBlocks(t *testing.T) {
	path := writeLakefile(t, `package foo where
  version := v!"0.1.0"

package bar where
  version := v!"0.2.0"
`)
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrMultiplePackageBlocks) {
		t.Errorf("err = %v, want ErrMultiplePackageBlocks", err)
	}
}

// TestReadVersion_UnparseableValue_NotVMacro — `version := "0.3.1"`
// without the `v!` macro doesn't match versionLineRe, so the parser
// keeps scanning and eventually returns ErrMissingVersionField.
func TestReadVersion_UnparseableValue_NotVMacro(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  version := "0.3.1"
`)
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrMissingVersionField) {
		t.Errorf("err = %v, want ErrMissingVersionField (regex shouldn't match v-macro-less form)", err)
	}
}

func TestReadVersion_UnparseableValue_NotSemver(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  version := v!"not-semver"
`)
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrUnparseableVersion) {
		t.Errorf("err = %v, want ErrUnparseableVersion", err)
	}
}

// TestReadVersion_UnparseableValue_PartialSemver — x/mod/semver's
// IsValid accepts shortened forms like "v0.3" (canonicalizes to
// "v0.3.0"). Our parser rejects them via the Canonical-equality
// check because the publish pipeline always stamps a full
// MAJOR.MINOR.PATCH triplet.
func TestReadVersion_UnparseableValue_PartialSemver(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  version := v!"0.3"
`)
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrUnparseableVersion) {
		t.Errorf("err = %v, want ErrUnparseableVersion (partial semver must be rejected)", err)
	}
}

// TestReadVersion_VersionLineBeforePackageIgnored — a top-level
// `version :=` ABOVE the package block must NOT win over the real one
// INSIDE the package block.
func TestReadVersion_VersionLineBeforePackageIgnored(t *testing.T) {
	path := writeLakefile(t, `version := v!"9.9.9"

package axiomClient where
  version := v!"0.1.0"
`)
	got, err := ReadVersion(path)
	if err != nil {
		t.Fatalf("ReadVersion: %v", err)
	}
	if got != "0.1.0" {
		t.Errorf("ReadVersion = %q, want %q (top-level version must NOT win)", got, "0.1.0")
	}
}

func TestReadVersion_TopLevelVersionOnly_NoPackageBlock(t *testing.T) {
	path := writeLakefile(t, `version := v!"0.3.1"
`)
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrNoPackageBlock) {
		t.Errorf("err = %v, want ErrNoPackageBlock", err)
	}
}

func TestReadVersion_CommentsInsidePackageBlock(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  -- this is a comment
  -- another comment
  version := v!"0.3.1"
`)
	got, err := ReadVersion(path)
	if err != nil {
		t.Fatalf("ReadVersion: %v", err)
	}
	if got != "0.3.1" {
		t.Errorf("ReadVersion = %q, want %q", got, "0.3.1")
	}
}

func TestReadVersion_CommentBeforeVersionField(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  -- old version: 0.2.0
  version := v!"0.3.0"
`)
	got, err := ReadVersion(path)
	if err != nil {
		t.Fatalf("ReadVersion: %v", err)
	}
	if got != "0.3.0" {
		t.Errorf("ReadVersion = %q, want %q (comment must not be parsed as the version line)", got, "0.3.0")
	}
}

func TestReadVersion_FileNotFound(t *testing.T) {
	_, err := ReadVersion(filepath.Join(t.TempDir(), "does-not-exist.lean"))
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Errorf("err = %v, want os.ErrNotExist wrap", err)
	}
}

func TestReadVersion_EmptyFile(t *testing.T) {
	path := writeLakefile(t, "")
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrNoPackageBlock) {
		t.Errorf("err = %v, want ErrNoPackageBlock", err)
	}
}

// TestReadVersion_TrailingCommentRejected — the regex is anchored at
// `\s*$`; a trailing `-- comment` after the value causes the regex
// not to match. The parser keeps scanning and returns
// ErrMissingVersionField. Documented as a known tradeoff in the spec.
func TestReadVersion_TrailingCommentRejected(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
  version := v!"0.3.1" -- the tag
`)
	_, err := ReadVersion(path)
	if !errors.Is(err, ErrMissingVersionField) {
		t.Errorf("err = %v, want ErrMissingVersionField (trailing comment after value not supported)", err)
	}
}

func TestReadGitDependencyTag(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		want    string
		wantErr string
	}{
		{"current beta", `require AxiomLib from git "https://github.com/BuildCoherence/axiom-lib" @ "v1.0.5-beta"`, "v1.0.5-beta", ""},
		{"newer release", `  require AxiomLib from git "https://example.test/lib" @ "v1.1.0"`, "v1.1.0", ""},
		{"floating branch", `require AxiomLib from git "https://example.test/lib" @ "main"`, "", "not pinned to a full semver tag"},
		{"missing v", `require AxiomLib from git "https://example.test/lib" @ "1.0.5-beta"`, "", "not pinned to a full semver tag"},
		{"short semver", `require AxiomLib from git "https://example.test/lib" @ "v1.0"`, "", "not pinned to a full semver tag"},
		{"different dependency", `require Other from git "https://example.test/lib" @ "v1.0.5-beta"`, "", "not found"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := writeLakefile(t, "package axiomClient where\n"+tt.line+"\n")
			got, err := ReadGitDependencyTag(path, "AxiomLib")
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("ReadGitDependencyTag error = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("ReadGitDependencyTag = %q, %v; want %q, nil", got, err, tt.want)
			}
		})
	}
}

func TestReadGitDependencyTagRejectsDuplicate(t *testing.T) {
	path := writeLakefile(t, `package axiomClient where
require AxiomLib from git "https://example.test/one" @ "v1.0.5-beta"
require AxiomLib from git "https://example.test/two" @ "v1.0.6-beta"
`)
	_, err := ReadGitDependencyTag(path, "AxiomLib")
	if err == nil || !strings.Contains(err.Error(), "multiple git requirements") {
		t.Fatalf("ReadGitDependencyTag error = %v, want duplicate refusal", err)
	}
}
