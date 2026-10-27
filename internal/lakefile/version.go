// Package lakefile provides parsers for Lake's `lakefile.lean` file.
//
// Today the package exposes a single read-only entry point —
// ReadVersion — used by the workspace upgrade phase (per
// the internal axm-upgrade doc § "Workspace upgrade phase →
// Reading the Workspace's current tag") to discover the
// currently-pinned lean-client tag without invoking the Lean
// toolchain.
//
// The parser is deliberately line-based rather than a full Lean
// parser: lakefiles in practice declare `version := v!"<semver>"`
// on a single line inside the package block, and pulling in a
// Lean grammar to read one field would be wildly disproportionate.
// The trade-off is documented per-regex below.
//
// A `WriteVersion` function is NOT part of this package — the
// publish-side substitution lives in workflow YAML per the design.
package lakefile

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	"golang.org/x/mod/semver"
)

// Sentinel errors returned by ReadVersion. Wrapped with %w so callers
// can use errors.Is to dispatch on the specific failure mode and
// surface the right remediation copy from
// the internal upgrade-axiom-workspace doc step 5.
var (
	// ErrNoPackageBlock — the lakefile has no `package <name> where`
	// line at all. Shouldn't happen for a valid Axiom Workspace
	// (every Workspace's lakefile declares a package); surfaces as
	// "lakefile is malformed" to the user.
	ErrNoPackageBlock = errors.New("no `package` block in lakefile.lean")

	// ErrMultiplePackageBlocks — more than one `package <name> where`
	// line. We can't disambiguate which one is the workspace's, so
	// refuse rather than guess. Lake itself rejects multi-package
	// lakefiles (a directory has at most one package), so this is
	// genuinely a malformed file.
	ErrMultiplePackageBlocks = errors.New("multiple `package` blocks in lakefile.lean")

	// ErrMissingVersionField — the package block was found but no
	// `version :=` line appears inside it. This is the
	// user-edited-or-pre-stamp-Workspace case the design notes:
	// refuse with the "re-init or upgrade-by-hand" remediation copy.
	ErrMissingVersionField = errors.New("`version` field missing from package block")

	// ErrUnparseableVersion — a `version :=` line was found but the
	// value is not `v!"<semver>"` shape, or the inner string is not
	// valid semver. Surfaces the same refusal as ErrMissingVersionField
	// per the design's "missing field, unparseable value, or
	// parsed-but-unpublished tag" single-refusal copy.
	ErrUnparseableVersion = errors.New("`version` field value is not v!\"<semver>\"")
)

// versionLineRe matches a single `version := v!"<value>"` line.
// Anchored to the full line (after the scanner's newline strip);
// permissive on whitespace before `version`, around `:=`, and after
// the closing `"`. Captures the inner string for semver validation.
//
//		^\s*version\s*:=\s*v!"([^"]+)"\s*$
//
//	  - `\s*` before `version` allows the field to sit inside the
//	    package block's body (Lake-conventional 2-space indent) or at
//	    any other indentation.
//	  - `v!"..."` is the literal Lake form — `v!` is Lean's `Lean.Version`
//	    macro carrying a string literal. The string can't contain a
//	    double quote without escaping, and Lake versions never do.
//	  - `\s*$` at the end tolerates trailing whitespace; comments after
//	    the value (e.g. `version := v!"0.3.1" -- the tag`) are NOT
//	    accepted to keep the matcher tight. If users complain, the
//	    pattern extends to `\s*(--.*)?$`.
var versionLineRe = regexp.MustCompile(`^\s*version\s*:=\s*v!"([^"]+)"\s*$`)

// packageBlockRe matches the opening line of a package block:
//
//		^\s*package\s+\S+\s+where\b
//
//	  - Anchored to start of line; allows leading whitespace so an
//	    exotic multi-package nesting still parses (defensive — we still
//	    refuse on multi-package by counting matches).
//	  - `\S+` captures the package name (we don't need its value, only
//	    that it's present); spec doesn't constrain to `axiomClient`
//	    specifically because the design's substitution targets the
//	    first `package axiomClient where` block, but a Workspace might
//	    have any name on the package declaration (user-renameable).
//	  - `\bwhere\b` anchors the literal `where` keyword. The line MAY
//	    continue with `extends ...` etc. on the same line; we don't care.
var packageBlockRe = regexp.MustCompile(`^\s*package\s+\S+\s+where\b`)

var gitDependencyRe = regexp.MustCompile(`^\s*require\s+(\S+)\s+from\s+git\s+"([^"]+)"\s+@\s+"([^"]+)"\s*$`)

// GitDependency is a parsed Lake git requirement.
type GitDependency struct {
	URL string
	Rev string
}

// ReadGitDependency returns one named Lake git requirement.
func ReadGitDependency(path, dependency string) (GitDependency, error) {
	f, err := os.Open(path)
	if err != nil {
		return GitDependency{}, fmt.Errorf("opening %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()

	var found *GitDependency
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(strings.TrimLeft(line, " \t"), "--") {
			continue
		}
		match := gitDependencyRe.FindStringSubmatch(line)
		if match == nil || match[1] != dependency {
			continue
		}
		if found != nil {
			return GitDependency{}, fmt.Errorf("multiple git requirements for %s", dependency)
		}
		found = &GitDependency{URL: match[2], Rev: match[3]}
	}
	if err := scanner.Err(); err != nil {
		return GitDependency{}, fmt.Errorf("reading %s: %w", path, err)
	}
	if found == nil {
		return GitDependency{}, fmt.Errorf("git requirement for %s not found", dependency)
	}
	return *found, nil
}

// ReadGitDependencyTag returns the exact semver tag pinned by a Lake git
// dependency declaration, including its leading "v".
func ReadGitDependencyTag(path, dependency string) (string, error) {
	requirement, err := ReadGitDependency(path, dependency)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(requirement.Rev, "v") || !semver.IsValid(requirement.Rev) || semver.Canonical(requirement.Rev) != requirement.Rev {
		return "", fmt.Errorf("%s git requirement is not pinned to a full semver tag: %q", dependency, requirement.Rev)
	}
	return requirement.Rev, nil
}

// ReadVersion parses the lakefile at `path` and returns the
// semver string from its package block's `version := v!"<semver>"`
// line, WITHOUT the leading `v` (e.g. `"0.3.1"`, not `"v0.3.1"`).
//
// The parser is line-based (NOT a full Lean parser): it scans for
// the package block opening, then within the remainder of the file
// finds the next `version :=` line. Comments inside the package
// block are ignored. Multiple package blocks → ErrMultiplePackageBlocks.
// No version field → ErrMissingVersionField.
//
// Validation: the captured value is checked with
// `semver.IsValid("v" + value)` — the x/mod/semver package requires
// a leading `v`, so we prepend before checking. Failure →
// ErrUnparseableVersion.
//
// The returned string has the leading `v` stripped to match the
// design's "the value follows ... `v!"0.3.2"`" convention — the
// stored form is the bare semver, not the `v`-prefixed form.
func ReadVersion(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("opening %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()

	// Two-pass strategy (single read, line-numbered slices held in memory):
	//   1. Scan all lines; find ALL package-block opening lines.
	//   2. If 0 → ErrNoPackageBlock. If >1 → ErrMultiplePackageBlocks.
	//   3. Else scan from the package-block opening forward; first
	//      `version :=` line wins. Stop at EOF.
	//
	// Lakefiles are small (typically <100 lines); buffering the
	// whole file is fine.
	var lines []string
	scanner := bufio.NewScanner(f)
	// Default Scanner buffer (64K) is plenty for lakefiles, but bump
	// it defensively in case a Workspace ships an unusual file.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("reading %s: %w", path, err)
	}

	packageLines := []int{}
	for i, l := range lines {
		if packageBlockRe.MatchString(l) {
			packageLines = append(packageLines, i)
		}
	}
	switch len(packageLines) {
	case 0:
		return "", ErrNoPackageBlock
	case 1:
		// fallthrough to scan
	default:
		return "", ErrMultiplePackageBlocks
	}

	start := packageLines[0]
	for i := start + 1; i < len(lines); i++ {
		line := lines[i]
		// Skip pure-comment lines (Lake uses `--` for single-line comments).
		if strings.HasPrefix(strings.TrimLeft(line, " \t"), "--") {
			continue
		}
		m := versionLineRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		value := m[1]
		// semver.IsValid requires a leading `v`; prepend before
		// checking, but return the bare semver (no `v`) to match the
		// design's stored-form convention.
		check := value
		if !strings.HasPrefix(check, "v") {
			check = "v" + check
		}
		if !semver.IsValid(check) {
			return "", fmt.Errorf("%w: got %q", ErrUnparseableVersion, value)
		}
		// x/mod/semver accepts shortened forms like "v0.3" (canonicalizes
		// to "v0.3.0") and "v1" ("v1.0.0"). The design requires a full
		// MAJOR.MINOR.PATCH triplet because that's what the publish
		// pipeline stamps; reject anything that canonicalizes to a
		// different string than the supplied value (modulo our
		// prepended `v`). This catches both partial semvers AND
		// build-metadata suffixes (`+meta`), which Canonical also
		// strips.
		if semver.Canonical(check) != check {
			return "", fmt.Errorf("%w: got %q (not a full MAJOR.MINOR.PATCH semver)", ErrUnparseableVersion, value)
		}
		// Strip leading `v` if present so the returned value is the
		// bare semver per the design.
		return strings.TrimPrefix(value, "v"), nil
	}
	return "", ErrMissingVersionField
}
