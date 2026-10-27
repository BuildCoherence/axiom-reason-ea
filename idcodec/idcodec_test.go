package idcodec

import (
	"strings"
	"testing"
)

// mintIterations is the number of Mint() draws the invariant/smoke tests run to
// exercise the CSPRNG path. High enough that the distribution smoke checks are
// effectively certain to observe the asserted properties on a healthy CSPRNG.
const mintIterations = 1000

// TestAlphabet_Shape pins the constant shapes the rest of the package and the
// Lean side depend on.
func TestAlphabet_Shape(t *testing.T) {
	if got := len(Alphabet); got != 32 {
		t.Errorf("len(Alphabet) = %d, want 32", got)
	}
	if got := len(FirstAlphabet); got != 22 {
		t.Errorf("len(FirstAlphabet) = %d, want 22", got)
	}
	if Alphabet != "0123456789abcdefghjkmnpqrstvwxyz" {
		t.Errorf("Alphabet = %q, want %q", Alphabet, "0123456789abcdefghjkmnpqrstvwxyz")
	}
	if FirstAlphabet != Alphabet[10:] {
		t.Errorf("FirstAlphabet = %q, want Alphabet[10:] = %q", FirstAlphabet, Alphabet[10:])
	}
	for _, excluded := range []byte{'i', 'l', 'o', 'u'} {
		if strings.IndexByte(Alphabet, excluded) >= 0 {
			t.Errorf("Alphabet contains excluded glyph %q", excluded)
		}
		if strings.IndexByte(FirstAlphabet, excluded) >= 0 {
			t.Errorf("FirstAlphabet contains excluded glyph %q", excluded)
		}
	}
	for i := 0; i < len(Alphabet); i++ {
		if c := Alphabet[i]; c >= 0x80 || c != lowerASCII(c) {
			t.Errorf("Alphabet[%d] = %q is not lowercase ASCII", i, c)
		}
	}
	if Length != 8 {
		t.Errorf("Length = %d, want 8", Length)
	}
}

func lowerASCII(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + ('a' - 'A')
	}
	return c
}

// TestMint_FixedWidth: every Mint() has len == Length.
func TestMint_FixedWidth(t *testing.T) {
	for i := 0; i < mintIterations; i++ {
		id := Mint()
		if len(id) != Length {
			t.Fatalf("Mint() = %q has len %d, want %d", id, len(id), Length)
		}
	}
}

// TestMint_LetterFirst: the letter-first invariant — the first char is always a
// FirstAlphabet letter (never a digit, never i/l/o/u).
func TestMint_LetterFirst(t *testing.T) {
	for i := 0; i < mintIterations; i++ {
		id := Mint()
		if strings.IndexByte(FirstAlphabet, id[0]) < 0 {
			t.Fatalf("Mint() = %q has non-FirstAlphabet first char %q", id, id[0])
		}
	}
}

// TestMint_AlphabetMembership: every character of every mint is in Alphabet.
func TestMint_AlphabetMembership(t *testing.T) {
	for i := 0; i < mintIterations; i++ {
		id := Mint()
		for j := 0; j < len(id); j++ {
			if strings.IndexByte(Alphabet, id[j]) < 0 {
				t.Fatalf("Mint() = %q has non-Alphabet char %q at index %d", id, id[j], j)
			}
		}
	}
}

// TestMint_Canonical: a mint is already canonical — Valid is true and
// Canonicalize returns (id, true) with canonical == id (no redirect).
func TestMint_Canonical(t *testing.T) {
	for i := 0; i < mintIterations; i++ {
		id := Mint()
		if !Valid(id) {
			t.Fatalf("Valid(Mint() = %q) = false, want true", id)
		}
		canon, ok := Canonicalize(id)
		if !ok || canon != id {
			t.Fatalf("Canonicalize(Mint() = %q) = (%q, %v), want (%q, true)", id, canon, ok, id)
		}
	}
}

// TestMint_CSPRNGDrawShape is a distribution smoke test (not a statistical
// test): over many mints the first character takes more than one distinct value,
// and the later positions include at least one digit — proving the first char
// draws from the 22-letter set and the rest from the 32-symbol set (the two
// draws actually differ).
func TestMint_CSPRNGDrawShape(t *testing.T) {
	firstChars := map[byte]struct{}{}
	sawDigitAfterFirst := false
	for i := 0; i < mintIterations; i++ {
		id := Mint()
		firstChars[id[0]] = struct{}{}
		for j := 1; j < len(id); j++ {
			if id[j] >= '0' && id[j] <= '9' {
				sawDigitAfterFirst = true
			}
		}
	}
	if len(firstChars) <= 1 {
		t.Errorf("Mint() first char took %d distinct values over %d mints, want > 1", len(firstChars), mintIterations)
	}
	if !sawDigitAfterFirst {
		t.Errorf("Mint() never produced a digit after the first char over %d mints; expected the rest to draw from the 32-symbol Alphabet", mintIterations)
	}
}

// TestValid_AcceptsCanonical: a hand-written canonical sample and a mint both
// validate.
func TestValid_AcceptsCanonical(t *testing.T) {
	if !Valid("abcd0139") {
		t.Errorf("Valid(%q) = false, want true", "abcd0139")
	}
	if id := Mint(); !Valid(id) {
		t.Errorf("Valid(Mint() = %q) = false, want true", id)
	}
}

// TestValid_RejectsDigitLeading: digit-leading first char is rejected.
func TestValid_RejectsDigitLeading(t *testing.T) {
	for _, s := range []string{"0bcdefgh", "9bcdefgh"} {
		if Valid(s) {
			t.Errorf("Valid(%q) = true, want false (digit-leading)", s)
		}
	}
}

// TestValid_RejectsWrongLength: length != 8 is rejected. The 7- and 9-char
// cases use only valid chars so they isolate the length failure from membership.
func TestValid_RejectsWrongLength(t *testing.T) {
	for _, s := range []string{"", "abcdefg", "abcdefgh9"} {
		if Valid(s) {
			t.Errorf("Valid(%q) = true, want false (wrong length %d)", s, len(s))
		}
	}
}

// TestValid_RejectsUnfoldedExcludedGlyph: an un-folded i/l/o/u in the validation
// input is rejected, in both first and non-first position.
func TestValid_RejectsUnfoldedExcludedGlyph(t *testing.T) {
	cases := []string{
		"iabcdefg", "abcdefgi",
		"labcdefg", "abcdefgl",
		"oabcdefg", "abcdefgo",
		"uabcdefg", "abcdefgu",
	}
	for _, s := range cases {
		if Valid(s) {
			t.Errorf("Valid(%q) = true, want false (excluded glyph)", s)
		}
	}
}

// TestValid_RejectsUppercase: no case folding in Valid, so any uppercase is
// rejected.
func TestValid_RejectsUppercase(t *testing.T) {
	for _, s := range []string{"Abcdefgh", "aBcdefgh", "ABCDEFGH"} {
		if Valid(s) {
			t.Errorf("Valid(%q) = true, want false (uppercase)", s)
		}
	}
}

// TestValid_RejectsNonAlphabet: a non-alphabet character (including a multibyte
// rune) is rejected.
func TestValid_RejectsNonAlphabet(t *testing.T) {
	for _, s := range []string{"abc-defg", "abc defg", "abc.defg", "abcdéfgh"} {
		if Valid(s) {
			t.Errorf("Valid(%q) = true, want false (non-alphabet)", s)
		}
	}
}

// TestCanonicalize_CaseFold: uppercase input folds to a valid lowercase id and
// differs from the input (would 308).
func TestCanonicalize_CaseFold(t *testing.T) {
	canon, ok := Canonicalize("ABCDEFGH")
	if !ok || canon != "abcdefgh" {
		t.Errorf("Canonicalize(%q) = (%q, %v), want (%q, true)", "ABCDEFGH", canon, ok, "abcdefgh")
	}
	if canon == "ABCDEFGH" {
		t.Errorf("Canonicalize(%q) returned canonical == input; expected a fold (would 308)", "ABCDEFGH")
	}
	canon, ok = Canonicalize("aBcDeFgH")
	if !ok || canon != "abcdefgh" {
		t.Errorf("Canonicalize(%q) = (%q, %v), want (%q, true)", "aBcDeFgH", canon, ok, "abcdefgh")
	}
}

// TestCanonicalize_CrockfordFold: i/I and l/L fold to 1, o/O folds to 0, in
// non-first positions where the folded result is valid.
func TestCanonicalize_CrockfordFold(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"abcIefgh", "abc1efgh"}, // I -> 1
		{"abciefgh", "abc1efgh"}, // i -> 1
		{"abcLefgh", "abc1efgh"}, // L -> 1
		{"abclefgh", "abc1efgh"}, // l -> 1
		{"abcOefgh", "abc0efgh"}, // O -> 0
		{"abcoefgh", "abc0efgh"}, // o -> 0
	}
	for _, c := range cases {
		canon, ok := Canonicalize(c.in)
		if !ok || canon != c.want {
			t.Errorf("Canonicalize(%q) = (%q, %v), want (%q, true)", c.in, canon, ok, c.want)
		}
	}
}

// TestCanonicalize_AlreadyCanonical: an already-canonical id returns itself with
// canonical == input (no redirect path).
func TestCanonicalize_AlreadyCanonical(t *testing.T) {
	canon, ok := Canonicalize("abcd0139")
	if !ok || canon != "abcd0139" {
		t.Errorf("Canonicalize(%q) = (%q, %v), want (%q, true)", "abcd0139", canon, ok, "abcd0139")
	}
}

// TestCanonicalize_URejected: any input containing u/U is invalid (u has no
// fold target), regardless of case.
func TestCanonicalize_URejected(t *testing.T) {
	for _, s := range []string{"abcdefgu", "uBcdefgh", "abcdefgU", "Ubcdefgh"} {
		if _, ok := Canonicalize(s); ok {
			t.Errorf("Canonicalize(%q) ok = true, want false (u has no fold)", s)
		}
	}
}

// TestCanonicalize_RejectsWrongLengthAndDigitLead: length and digit-leading
// failures survive folding and fail Valid.
func TestCanonicalize_RejectsWrongLengthAndDigitLead(t *testing.T) {
	for _, s := range []string{"abc", "0bcdefgh"} {
		if _, ok := Canonicalize(s); ok {
			t.Errorf("Canonicalize(%q) ok = true, want false", s)
		}
	}
}

// TestCanonicalize_FoldedDigitLeadStaysInvalid is the sharp edge: an input whose
// FIRST char folds to a digit (leading O -> 0) must stay invalid — the
// letter-first rule is enforced after folding.
func TestCanonicalize_FoldedDigitLeadStaysInvalid(t *testing.T) {
	canon, ok := Canonicalize("obcdefgh")
	if ok {
		t.Errorf("Canonicalize(%q) = (%q, true), want ok = false (folds to leading digit %q)", "obcdefgh", canon, "0bcdefgh")
	}
	// Sanity: the fold did produce the leading-digit form we expect to be rejected.
	if canon != "0bcdefgh" {
		t.Errorf("Canonicalize(%q) folded to %q, want %q", "obcdefgh", canon, "0bcdefgh")
	}
}

// TestCanonicalize_Idempotent: the canonical form is a fixed point — for any s
// where Canonicalize(s) is (c, true), Canonicalize(c) == (c, true) and Valid(c).
func TestCanonicalize_Idempotent(t *testing.T) {
	inputs := []string{
		"ABCDEFGH", "aBcDeFgH", "abcIefgh", "abcOefgh", "abcd0139",
	}
	// Also fold a batch of mints through the property.
	for i := 0; i < 100; i++ {
		inputs = append(inputs, Mint())
	}
	for _, s := range inputs {
		c, ok := Canonicalize(s)
		if !ok {
			continue
		}
		c2, ok2 := Canonicalize(c)
		if !ok2 || c2 != c {
			t.Errorf("Canonicalize(%q) = (%q, %v) not a fixed point of Canonicalize(%q) = (%q, true)", c, c2, ok2, s, c)
		}
		if !Valid(c) {
			t.Errorf("Valid(%q) = false for canonical form of %q", c, s)
		}
	}
}

// TestValid_ImpliesCanonicalizeIdentity: for a mint id, Valid(id) is true and
// Canonicalize(id) returns (id, true) — a valid id is its own canonical form.
func TestValid_ImpliesCanonicalizeIdentity(t *testing.T) {
	for i := 0; i < mintIterations; i++ {
		id := Mint()
		if !Valid(id) {
			t.Fatalf("Valid(Mint() = %q) = false, want true", id)
		}
		canon, ok := Canonicalize(id)
		if !ok || canon != id {
			t.Fatalf("Canonicalize(Mint() = %q) = (%q, %v), want (%q, true)", id, canon, ok, id)
		}
	}
}
