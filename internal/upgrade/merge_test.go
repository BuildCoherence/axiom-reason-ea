package upgrade

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// mergeTreeRecord models a single conflict-info record in the
// `git merge-tree --write-tree -z` stream. Within one record the
// mode/object/stage are SPACE-separated and a single TAB precedes the
// path: "<mode> <object> <stage>\t<path>". The record (not its
// individual fields) is NUL-terminated — `-z` only swaps the line
// terminator, it does NOT split the fields with NUL.
type mergeTreeRecord struct {
	Mode, BlobSHA, Stage, Path string
}

// mergeTreeFixture builds the NUL-separated bytes that
// `git merge-tree --write-tree -z` actually emits (verified against git
// 2.43.0). Layout:
//
//	<sha>\0
//	<mode> <object> <stage>\t<path>\0   (one per conflict record)
//	\0                                  (section separator, if any conflicts)
//	<informational messages>\0          (ignored by the parser)
//
// When there are conflict records we append the section separator plus a
// representative informational-messages block, so the fixture exercises
// the parser's "stop at the separator, ignore the rest" behaviour — the
// info block deliberately contains records with no TAB, which the parser
// must NOT try to interpret as conflict records.
func mergeTreeFixture(sha string, records ...mergeTreeRecord) []byte {
	var buf bytes.Buffer
	buf.WriteString(sha)
	buf.WriteByte(0)
	for _, r := range records {
		fmt.Fprintf(&buf, "%s %s %s\t%s", r.Mode, r.BlobSHA, r.Stage, r.Path)
		buf.WriteByte(0)
	}
	if len(records) > 0 {
		buf.WriteByte(0) // empty record: separates conflict info from messages
		// A representative informational-messages section, mirroring real git:
		// one message block per conflicted path (deduped across the stage 1/2/3
		// records), not a single block for the last path. Everything after the
		// separator must be ignored by the parser regardless.
		seen := map[string]struct{}{}
		for _, r := range records {
			if _, ok := seen[r.Path]; ok {
				continue
			}
			seen[r.Path] = struct{}{}
			buf.WriteString("1")
			buf.WriteByte(0)
			buf.WriteString(r.Path)
			buf.WriteByte(0)
			buf.WriteString("Auto-merging")
			buf.WriteByte(0)
			buf.WriteString("Auto-merging " + r.Path + "\n")
			buf.WriteByte(0)
		}
	}
	return buf.Bytes()
}

// Two fixture SHAs reused across tests. Real-looking 40-char hex.
const (
	fixtureTreeSHA = "0123456789abcdef0123456789abcdef01234567"
	fixtureBlobSHA = "fedcba9876543210fedcba9876543210fedcba98"
)

func conflictRecords(path string) []mergeTreeRecord {
	return []mergeTreeRecord{
		{"100644", fixtureBlobSHA, "1", path},
		{"100644", fixtureBlobSHA, "2", path},
		{"100644", fixtureBlobSHA, "3", path},
	}
}

func TestParseMergeTreeOutput_CleanMerge(t *testing.T) {
	input := mergeTreeFixture(fixtureTreeSHA)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.TreeSHA != fixtureTreeSHA {
		t.Errorf("TreeSHA = %q, want %q", result.TreeSHA, fixtureTreeSHA)
	}
	if len(result.Changes) != 0 {
		t.Errorf("len(Changes) = %d, want 0", len(result.Changes))
	}
}

func TestParseMergeTreeOutput_SingleBuildConfigConflict(t *testing.T) {
	input := mergeTreeFixture(fixtureTreeSHA, conflictRecords("lakefile.lean")...)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Changes) != 1 {
		t.Fatalf("len(Changes) = %d, want 1", len(result.Changes))
	}
	c := result.Changes[0]
	if c.Path != "lakefile.lean" {
		t.Errorf("Path = %q, want lakefile.lean", c.Path)
	}
	if c.Outcome != OutcomeBuildConfigConflict {
		t.Errorf("Outcome = %v, want OutcomeBuildConfigConflict", c.Outcome)
	}
}

func TestParseMergeTreeOutput_SingleNonBuildConfigConflict(t *testing.T) {
	input := mergeTreeFixture(fixtureTreeSHA, conflictRecords("Axiom/Foo.lean")...)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Changes) != 1 {
		t.Fatalf("len(Changes) = %d, want 1", len(result.Changes))
	}
	c := result.Changes[0]
	if c.Path != "Axiom/Foo.lean" {
		t.Errorf("Path = %q, want Axiom/Foo.lean", c.Path)
	}
	if c.Outcome != OutcomeNonBuildConfigConflict {
		t.Errorf("Outcome = %v, want OutcomeNonBuildConfigConflict", c.Outcome)
	}
}

func TestParseMergeTreeOutput_AllThreeBuildConfigPaths(t *testing.T) {
	var records []mergeTreeRecord
	for _, p := range []string{"lakefile.lean", "lean-toolchain", "lake-manifest.json"} {
		records = append(records, conflictRecords(p)...)
	}
	input := mergeTreeFixture(fixtureTreeSHA, records...)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Changes) != 3 {
		t.Fatalf("len(Changes) = %d, want 3", len(result.Changes))
	}
	for _, c := range result.Changes {
		if c.Outcome != OutcomeBuildConfigConflict {
			t.Errorf("Outcome for %q = %v, want OutcomeBuildConfigConflict", c.Path, c.Outcome)
		}
	}
}

func TestParseMergeTreeOutput_MixedConflicts(t *testing.T) {
	var records []mergeTreeRecord
	records = append(records, conflictRecords("lakefile.lean")...)
	records = append(records, conflictRecords("Axiom/Bar.lean")...)
	input := mergeTreeFixture(fixtureTreeSHA, records...)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Changes) != 2 {
		t.Fatalf("len(Changes) = %d, want 2", len(result.Changes))
	}
	seen := map[string]Outcome{}
	for _, c := range result.Changes {
		seen[c.Path] = c.Outcome
	}
	if seen["lakefile.lean"] != OutcomeBuildConfigConflict {
		t.Errorf("lakefile.lean outcome = %v, want OutcomeBuildConfigConflict", seen["lakefile.lean"])
	}
	if seen["Axiom/Bar.lean"] != OutcomeNonBuildConfigConflict {
		t.Errorf("Axiom/Bar.lean outcome = %v, want OutcomeNonBuildConfigConflict", seen["Axiom/Bar.lean"])
	}
}

func TestParseMergeTreeOutput_StagesAreDeduped(t *testing.T) {
	// Three records for the same path (stages 1/2/3) — same as
	// conflictRecords. We expect ONE FileChange, not three.
	input := mergeTreeFixture(fixtureTreeSHA, conflictRecords("Axiom/Dedupe.lean")...)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Changes) != 1 {
		t.Fatalf("len(Changes) = %d, want 1 (stages must dedupe)", len(result.Changes))
	}
}

func TestParseMergeTreeOutput_PathWithSpaces(t *testing.T) {
	path := "Axiom/Some File.lean"
	input := mergeTreeFixture(fixtureTreeSHA, conflictRecords(path)...)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Changes) != 1 {
		t.Fatalf("len(Changes) = %d, want 1", len(result.Changes))
	}
	if result.Changes[0].Path != path {
		t.Errorf("Path = %q, want %q", result.Changes[0].Path, path)
	}
}

func TestParseMergeTreeOutput_Empty(t *testing.T) {
	_, err := parseMergeTreeOutput(nil)
	if err == nil {
		t.Fatal("expected error on empty input")
	}
	if !strings.Contains(err.Error(), "empty output") {
		t.Errorf("error %q does not contain %q", err.Error(), "empty output")
	}
}

func TestParseMergeTreeOutput_MalformedSHA(t *testing.T) {
	input := mergeTreeFixture("hello")
	_, err := parseMergeTreeOutput(input)
	if err == nil {
		t.Fatal("expected error on malformed SHA")
	}
	if !strings.Contains(err.Error(), "is not a 40-char hex SHA") {
		t.Errorf("error %q does not contain %q", err.Error(), "is not a 40-char hex SHA")
	}
}

func TestParseMergeTreeOutput_RecordWithoutTab(t *testing.T) {
	// A conflict record with no TAB before the path is malformed — the
	// parser must surface a clear error rather than mis-slice it.
	var buf bytes.Buffer
	buf.WriteString(fixtureTreeSHA)
	buf.WriteByte(0)
	buf.WriteString("100644 " + fixtureBlobSHA + " 1 lakefile.lean") // space, not TAB
	buf.WriteByte(0)
	_, err := parseMergeTreeOutput(buf.Bytes())
	if err == nil {
		t.Fatal("expected error on record without TAB")
	}
	if !strings.Contains(err.Error(), "no TAB before the path") {
		t.Errorf("error %q does not contain %q", err.Error(), "no TAB before the path")
	}
}

// TestParseMergeTreeOutput_RealGitConflict_Regression locks in the fix for
// the `axm upgrade` crash "classifying merge: git merge-tree: parsing
// output: conflict records not a multiple of 4 fields". The bytes below
// are the verbatim `git merge-tree --write-tree -z` output (git 2.43.0)
// from a workspace whose lake-manifest.json and lakefile.lean both
// conflict — the exact stream that crashed the old parser, which assumed
// the conflict section was NUL-separated 4-tuples.
func TestParseMergeTreeOutput_RealGitConflict_Regression(t *testing.T) {
	raw := "7aad869e0fb4a721de9383135e5ba49ab4d65ece\x00" +
		"100644 5c3c6a8ba05804655db093cee17b918401a537d8 1\tlake-manifest.json\x00" +
		"100644 91254892bc3f3c40f8e6e5f77e36926434239027 2\tlake-manifest.json\x00" +
		"100644 6eb47be4bc0705faeb5f110215e15bc4cab62472 3\tlake-manifest.json\x00" +
		"100644 c5d14c706c0e4b46d9f46273db1aa1e43187863d 1\tlakefile.lean\x00" +
		"100644 fbcd42cb0dee5605d58dee200c4c897d304a40c3 2\tlakefile.lean\x00" +
		"100644 3dbb0622d025089720afa43cda31f672a9498bb7 3\tlakefile.lean\x00" +
		"\x00" +
		"1\x00lake-manifest.json\x00Auto-merging\x00Auto-merging lake-manifest.json\n\x00" +
		"1\x00lake-manifest.json\x00CONFLICT (contents)\x00CONFLICT (content): Merge conflict in lake-manifest.json\n\x00" +
		"1\x00lakefile.lean\x00Auto-merging\x00Auto-merging lakefile.lean\n\x00" +
		"1\x00lakefile.lean\x00CONFLICT (contents)\x00CONFLICT (content): Merge conflict in lakefile.lean\n\x00"
	result, err := parseMergeTreeOutput([]byte(raw))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.TreeSHA != "7aad869e0fb4a721de9383135e5ba49ab4d65ece" {
		t.Errorf("TreeSHA = %q, want 7aad869e0fb4a721de9383135e5ba49ab4d65ece", result.TreeSHA)
	}
	if len(result.Changes) != 2 {
		t.Fatalf("len(Changes) = %d, want 2 (lake-manifest.json, lakefile.lean)", len(result.Changes))
	}
	for _, c := range result.Changes {
		if c.Outcome != OutcomeBuildConfigConflict {
			t.Errorf("path %q outcome = %v, want OutcomeBuildConfigConflict", c.Path, c.Outcome)
		}
	}
}

// TestParseNameStatusZ_Mixed covers the three statuses `git diff-tree
// --name-status -z HEAD <mergetree>` emits for our comparison (no -M, so
// no renames): A (add), M (modify), D (delete). Only D must be flagged
// deleted; the others carry a blob the apply step writes.
func TestParseNameStatusZ_Mixed(t *testing.T) {
	raw := "A\x00Axiom/New.lean\x00" +
		"M\x00lakefile.lean\x00" +
		"D\x00.axiom/skills/bfo-upper-ontology/SKILL.md\x00"
	got, err := parseNameStatusZ([]byte(raw))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []nameStatusChange{
		{path: "Axiom/New.lean", deleted: false},
		{path: "lakefile.lean", deleted: false},
		{path: ".axiom/skills/bfo-upper-ontology/SKILL.md", deleted: true},
	}
	if len(got) != len(want) {
		t.Fatalf("len(got) = %d, want %d (%+v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// TestParseNameStatusZ_Empty — a merge that changes nothing makes
// diff-tree emit no bytes at all; that yields zero changes, not an error.
func TestParseNameStatusZ_Empty(t *testing.T) {
	for _, in := range [][]byte{nil, {}} {
		got, err := parseNameStatusZ(in)
		if err != nil {
			t.Fatalf("unexpected error for %q: %v", in, err)
		}
		if len(got) != 0 {
			t.Errorf("len(got) = %d for %q, want 0", len(got), in)
		}
	}
}

// TestParseNameStatusZ_RenameDefensive locks in the two-path handling for
// rename/copy records. ClassifyMerge never passes -M/-C so these never
// occur in practice, but if a caller ever adds rename detection an
// `R<score>\0old\0new` record must consume BOTH paths and report the new
// one — otherwise the second path would be mis-read as the next status
// token, corrupting every change after it.
func TestParseNameStatusZ_RenameDefensive(t *testing.T) {
	raw := "R100\x00old/path.lean\x00new/path.lean\x00" +
		"D\x00gone.lean\x00"
	got, err := parseNameStatusZ([]byte(raw))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []nameStatusChange{
		{path: "new/path.lean", deleted: false},
		{path: "gone.lean", deleted: true},
	}
	if len(got) != len(want) {
		t.Fatalf("len(got) = %d, want %d (%+v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// TestParseNameStatusZ_StatusWithoutPath — a status token with no
// following path is malformed; the parser must surface an error rather
// than silently drop it or panic on an out-of-range index.
func TestParseNameStatusZ_StatusWithoutPath(t *testing.T) {
	raw := "M\x00lakefile.lean\x00D\x00" // trailing D with no path
	_, err := parseNameStatusZ([]byte(raw))
	if err == nil {
		t.Fatal("expected error on status without a path")
	}
	if !strings.Contains(err.Error(), "missing path field") {
		t.Errorf("error %q does not contain %q", err.Error(), "missing path field")
	}
}

// modifyDeleteRecords builds the conflict records git emits for a
// modify/delete conflict: stage 1 (base) and stage 2 (ours) only — NO
// stage 3, because the incoming side deleted the path.
func modifyDeleteRecords(path string) []mergeTreeRecord {
	return []mergeTreeRecord{
		{"100644", fixtureBlobSHA, "1", path},
		{"100644", fixtureBlobSHA, "2", path},
	}
}

// TestParseMergeTreeOutput_ModifyDeleteConflict covers a modify/delete
// conflict (incoming deleted a path the Workspace modified): merge-tree
// emits stage-1 + stage-2 records but no stage-3. The classifier must
// bucket it as OutcomeModifyDeleteConflict so the apply step keeps the
// user's file instead of cat-file'ing a new blob that no longer exists.
func TestParseMergeTreeOutput_ModifyDeleteConflict(t *testing.T) {
	input := mergeTreeFixture(fixtureTreeSHA, modifyDeleteRecords("Axiom/Custom.lean")...)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Changes) != 1 {
		t.Fatalf("len(Changes) = %d, want 1", len(result.Changes))
	}
	c := result.Changes[0]
	if c.Path != "Axiom/Custom.lean" {
		t.Errorf("Path = %q, want Axiom/Custom.lean", c.Path)
	}
	if c.Outcome != OutcomeModifyDeleteConflict {
		t.Errorf("Outcome = %v, want OutcomeModifyDeleteConflict", c.Outcome)
	}
}

// TestParseMergeTreeOutput_ModifyDeleteBuildConfigPrecedence locks in
// that the missing-stage-3 (theirs-deleted) check takes precedence over
// the build-config path check: even lakefile.lean, if deleted upstream
// while modified locally, is a modify/delete conflict — there is no new
// version to offer through the step-9 build-config prompt.
func TestParseMergeTreeOutput_ModifyDeleteBuildConfigPrecedence(t *testing.T) {
	input := mergeTreeFixture(fixtureTreeSHA, modifyDeleteRecords("lakefile.lean")...)
	result, err := parseMergeTreeOutput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Changes) != 1 || result.Changes[0].Outcome != OutcomeModifyDeleteConflict {
		t.Fatalf("Changes = %+v, want one OutcomeModifyDeleteConflict", result.Changes)
	}
}

func TestIsBuildConfig_BuildConfigPaths(t *testing.T) {
	for _, p := range []string{"lakefile.lean", "lean-toolchain", "lake-manifest.json"} {
		if !isBuildConfig(p) {
			t.Errorf("isBuildConfig(%q) = false, want true", p)
		}
	}
}

func TestIsBuildConfig_NonBuildConfigPaths(t *testing.T) {
	for _, p := range []string{
		"lakefile.lean.bak",
		"axiom/lakefile.lean",
		"README.md",
		"",
		"lean-toolchain.bak",
	} {
		if isBuildConfig(p) {
			t.Errorf("isBuildConfig(%q) = true, want false", p)
		}
	}
}

// runGit is a tiny test helper that runs a git command in dir and fails
// the test on error. Used by the real-git integration test below.
func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
}

// TestClassifyMerge_RealGit drives ClassifyMerge against a real git repo
// with a known conflict, end-to-end. This is the coverage that was
// missing when the parser shipped: every other test in this file feeds
// the parser hand-built fixtures, so a fixture that lied about git's
// output format (as the original one did) went undetected. Running the
// actual `git merge-tree --write-tree -z` pins the parser to git's true
// output, so any future format drift — or a regression in our reading of
// it — fails here.
func TestClassifyMerge_RealGit(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	ctx := context.Background()

	runGit(t, dir, "init", "-q", "-b", "main")

	write := func(rel, content string) {
		t.Helper()
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Base commit: a build-config file and a source file.
	write("lakefile.lean", "package base\n")
	write("Axiom/Foo.lean", "base\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "base")

	// Divergent branch: conflict lakefile.lean, cleanly add a new file.
	runGit(t, dir, "checkout", "-q", "-b", "other")
	write("lakefile.lean", "package theirs\n")
	write("Axiom/Bar.lean", "added on other\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "other")

	// Back on main: a conflicting edit to the same build-config file.
	runGit(t, dir, "checkout", "-q", "main")
	write("lakefile.lean", "package ours\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "main")

	result, err := ClassifyMerge(ctx, dir, "other")
	if err != nil {
		t.Fatalf("ClassifyMerge: %v", err)
	}
	if !looksLikeSHA(result.TreeSHA) {
		t.Errorf("TreeSHA = %q, want a 40-char hex SHA", result.TreeSHA)
	}

	byPath := map[string]FileChange{}
	for _, c := range result.Changes {
		byPath[c.Path] = c
	}
	lake, ok := byPath["lakefile.lean"]
	if !ok {
		t.Fatalf("lakefile.lean missing from changes: %+v", result.Changes)
	}
	if lake.Outcome != OutcomeBuildConfigConflict {
		t.Errorf("lakefile.lean outcome = %v, want OutcomeBuildConfigConflict", lake.Outcome)
	}
	bar, ok := byPath["Axiom/Bar.lean"]
	if !ok {
		t.Fatalf("Axiom/Bar.lean missing from changes: %+v", result.Changes)
	}
	if bar.Outcome != OutcomeClean {
		t.Errorf("Axiom/Bar.lean outcome = %v, want OutcomeClean", bar.Outcome)
	}
	if !looksLikeSHA(bar.MergedBlobSHA) {
		t.Errorf("Axiom/Bar.lean MergedBlobSHA = %q, want a 40-char hex SHA", bar.MergedBlobSHA)
	}
}

// TestClassifyMerge_RealGit_CleanDeletion is the regression test for the
// `axm upgrade` crash "classifying merge: git merge-tree: annotating
// clean changes: resolving blob SHA for <path>: git rev-parse: exit
// status 128 (... exists on disk, but not in <tree>)". It reproduces the
// lean-client PR #1070 shape: the incoming version deletes a file (a
// retired AI-skill) the Workspace hasn't touched, so the merge removes it
// cleanly. Before the fix, annotateCleanChanges ran `git rev-parse
// <tree>:<deleted-path>` and aborted the whole upgrade; now the deletion
// classifies as OutcomeCleanDelete with no blob to resolve.
func TestClassifyMerge_RealGit_CleanDeletion(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	ctx := context.Background()

	runGit(t, dir, "init", "-q", "-b", "main")

	write := func(rel, content string) {
		t.Helper()
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Base commit: a skill the upgrade will remove, plus an unrelated file.
	skill := ".axiom/skills/bfo-upper-ontology/SKILL.md"
	write(skill, "old skill\n")
	write("Axiom/Keep.lean", "base\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "base")

	// Incoming version: delete the skill, cleanly add a replacement.
	runGit(t, dir, "checkout", "-q", "-b", "other")
	runGit(t, dir, "rm", "-q", skill)
	write(".axiom/skills/new-skill/SKILL.md", "new skill\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "revamp skills")

	// Back on main, an unrelated edit so both sides genuinely diverge
	// from the merge base (the property a real upgrade relies on).
	runGit(t, dir, "checkout", "-q", "main")
	write("Axiom/Keep.lean", "edited on main\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "main")

	result, err := ClassifyMerge(ctx, dir, "other")
	if err != nil {
		t.Fatalf("ClassifyMerge: %v", err)
	}

	byPath := map[string]FileChange{}
	for _, c := range result.Changes {
		byPath[c.Path] = c
	}
	del, ok := byPath[skill]
	if !ok {
		t.Fatalf("%s missing from changes: %+v", skill, result.Changes)
	}
	if del.Outcome != OutcomeCleanDelete {
		t.Errorf("%s outcome = %v, want OutcomeCleanDelete", skill, del.Outcome)
	}
	if del.MergedBlobSHA != "" {
		t.Errorf("%s MergedBlobSHA = %q, want empty (nothing to resolve for a deletion)", skill, del.MergedBlobSHA)
	}
	// The clean add alongside the deletion still resolves a blob.
	add, ok := byPath[".axiom/skills/new-skill/SKILL.md"]
	if !ok {
		t.Fatalf("new-skill missing from changes: %+v", result.Changes)
	}
	if add.Outcome != OutcomeClean || !looksLikeSHA(add.MergedBlobSHA) {
		t.Errorf("new-skill = %+v, want OutcomeClean with a blob SHA", add)
	}
}

// TestClassifyMerge_RealGit_ModifyDelete drives ClassifyMerge against a
// real modify/delete conflict: the incoming branch deletes a file that
// HEAD modified. `git merge-tree` reports the conflict with stage-1 and
// stage-2 records only (no stage-3), and the classifier must bucket it
// as OutcomeModifyDeleteConflict rather than a normal conflict — the
// latter would make the apply step `git cat-file` a new-version blob
// that doesn't exist (exit 128).
func TestClassifyMerge_RealGit_ModifyDelete(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	ctx := context.Background()

	runGit(t, dir, "init", "-q", "-b", "main")
	write := func(rel, content string) {
		t.Helper()
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Base: a file both sides start from.
	custom := "Axiom/Custom.lean"
	write(custom, "base\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "base")

	// Incoming version deletes the file.
	runGit(t, dir, "checkout", "-q", "-b", "other")
	runGit(t, dir, "rm", "-q", custom)
	runGit(t, dir, "commit", "-q", "-m", "delete Custom.lean")

	// HEAD modifies the same file → modify/delete conflict.
	runGit(t, dir, "checkout", "-q", "main")
	write(custom, "user edited\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "edit Custom.lean")

	result, err := ClassifyMerge(ctx, dir, "other")
	if err != nil {
		t.Fatalf("ClassifyMerge: %v", err)
	}
	var got *FileChange
	for i := range result.Changes {
		if result.Changes[i].Path == custom {
			got = &result.Changes[i]
		}
	}
	if got == nil {
		t.Fatalf("%s missing from changes: %+v", custom, result.Changes)
	}
	if got.Outcome != OutcomeModifyDeleteConflict {
		t.Errorf("%s outcome = %v, want OutcomeModifyDeleteConflict", custom, got.Outcome)
	}
}
