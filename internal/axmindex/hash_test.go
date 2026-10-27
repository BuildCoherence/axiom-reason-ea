package axmindex

import "testing"

func TestNormalizedHashStableTrailingWS(t *testing.T) {
	a := []byte("theorem t : True := trivial\n")
	b := []byte("theorem t : True := trivial   \n")
	if NormalizedHash(a) != NormalizedHash(b) {
		t.Fatal("trailing-whitespace-only edit changed hash")
	}
}

func TestNormalizedHashStableLineComments(t *testing.T) {
	a := []byte("theorem t : True := trivial\n")
	b := []byte("-- a comment\ntheorem t : True := trivial -- trailing\n")
	if NormalizedHash(a) != NormalizedHash(b) {
		t.Fatalf("adding line comments changed hash:\n a=%q\n b=%q", a, b)
	}
}

func TestNormalizedHashStableBlockComments(t *testing.T) {
	a := []byte("theorem t : True := trivial\n")
	b := []byte("/- a block -/\ntheorem t : True := trivial\n")
	if NormalizedHash(a) != NormalizedHash(b) {
		t.Fatal("adding a block comment changed hash")
	}
}

func TestNormalizedHashNestedBlockComments(t *testing.T) {
	a := []byte("x\n")
	// Nested: the inner `-/` must not close the outer block.
	b := []byte("/- /- inner -/ outer -/\nx\n")
	if NormalizedHash(a) != NormalizedHash(b) {
		t.Fatalf("nested block comment not stripped fully:\n a=%q b=%q", a, b)
	}
}

func TestNormalizedHashDistinguishesContent(t *testing.T) {
	a := []byte("theorem t : True := trivial\n")
	b := []byte("theorem u : True := trivial\n")
	if NormalizedHash(a) == NormalizedHash(b) {
		t.Fatal("hash collided on differing non-comment content")
	}
}

func TestNormalizedHashPermissiveUnbalanced(t *testing.T) {
	// Unmatched -/ outside a block: spec says tolerate (track depth, don't error).
	// We just want no panic here and a deterministic hash.
	_ = NormalizedHash([]byte("foo -/ bar\n"))
	_ = NormalizedHash([]byte("/- oops\n"))
}

// TestNormalizedHashCommentTokensInStringAreData is the regression for
// coherence-f6cn.3.2: comment openers inside a Lean string literal must
// be treated as data, not stripped. Two theorems whose only difference
// is the text inside a string that happens to contain `--` must hash
// APART, and adding an actual comment must still be invisible.
func TestNormalizedHashCommentTokensInStringAreData(t *testing.T) {
	a := []byte(`def s := "a -- b"` + "\n")
	b := []byte(`def s := "a -- c"` + "\n")
	if NormalizedHash(a) == NormalizedHash(b) {
		t.Fatal("string content after a `--` was stripped: distinct files hashed the same")
	}
}

// TestNormalizedHashUnbalancedBlockOpenerInStringDoesNotSwallowFile is
// the worst-case for coherence-f6cn.3.2: an unbalanced `/-` inside a
// string must NOT open a block comment that eats the rest of the file.
// If it did, the trailing declaration would vanish from the hash and a
// later edit to it would be silently invisible.
func TestNormalizedHashUnbalancedBlockOpenerInStringDoesNotSwallowFile(t *testing.T) {
	base := []byte(`def u := "path /- x"` + "\n" + "theorem t : True := trivial\n")
	edited := []byte(`def u := "path /- x"` + "\n" + "theorem t : False := sorry\n")
	if NormalizedHash(base) == NormalizedHash(edited) {
		t.Fatal("a `/-` inside a string swallowed the rest of the file: edit below it was invisible to the hash")
	}
}

// TestNormalizedHashEscapedQuoteInStringDoesNotEndString verifies the
// backslash-escape handling: an escaped quote does not close the string,
// so a `--` after it stays string data.
func TestNormalizedHashEscapedQuoteInStringDoesNotEndString(t *testing.T) {
	a := []byte(`def s := "x \" -- y"` + "\n")
	b := []byte(`def s := "x \" -- z"` + "\n")
	if NormalizedHash(a) == NormalizedHash(b) {
		t.Fatal("bytes after an escaped quote + `--` were stripped: escape handling wrong")
	}
}

// TestNormalizedHashPrimeIdentifierNotStringDelimiter guards the choice
// to treat only `"` as a string opener: a `'` is an ordinary Lean
// identifier character (`x'`), so a real trailing comment near a
// prime-suffixed name must still be stripped (i.e. stay invisible).
func TestNormalizedHashPrimeIdentifierNotStringDelimiter(t *testing.T) {
	a := []byte("def x' := 1\n")
	b := []byte("def x' := 1 -- a note\n")
	if NormalizedHash(a) != NormalizedHash(b) {
		t.Fatal("a `'` was treated as a string delimiter; the trailing comment was not stripped")
	}
}

// TestNormalizedHashCRLFEqualsLF locks in the Windows / Unix line-ending
// equivalence documented on NormalizedHash. Regression guard for the
// round-2 fix: if someone drops the CRLF fold the same Lean source
// authored on Windows and Mac/Linux would hash differently and the
// content-hash contract with the server would silently diverge.
func TestNormalizedHashCRLFEqualsLF(t *testing.T) {
	crlf := []byte("a\r\nb\n")
	lf := []byte("a\nb\n")
	if NormalizedHash(crlf) != NormalizedHash(lf) {
		t.Fatalf("CRLF and LF variants hashed differently:\n crlf=%q\n lf=%q", crlf, lf)
	}
}

// TestNormalizedHashMixedLineEndings covers the realistic case of a file
// partially rewritten on a different platform: some lines end in CRLF,
// others in LF. The normalized hash must match the all-LF form.
func TestNormalizedHashMixedLineEndings(t *testing.T) {
	mixed := []byte("theorem t : True := trivial\r\n-- comment\nx := 1\r\n")
	lf := []byte("theorem t : True := trivial\n-- comment\nx := 1\n")
	if NormalizedHash(mixed) != NormalizedHash(lf) {
		t.Fatalf("mixed CRLF/LF hashed differently from pure LF:\n mixed=%q\n lf=%q", mixed, lf)
	}
}
