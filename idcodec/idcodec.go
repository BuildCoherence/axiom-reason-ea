// Package idcodec is Axiom's single implementation of the unified identifier
// encoding: an 8-character, letter-first, confusable-free, case-insensitive
// Crockford base32 string. It is used by both the API and the CLI to mint File,
// Def, and Proposition IDs and to validate/canonicalize id-bearing URL segments.
//
// The encoding (see the internal unified-identifier-encoding doc):
//   - 8 characters, fixed width.
//   - The first character is a letter (FirstAlphabet), which keeps every id a
//     legal Lean identifier (a Lean identifier may not begin with a digit).
//   - Every character is drawn from the Crockford base32 Alphabet, which excludes
//     the four confusable glyphs i, l, o, u.
//   - The canonical form is lowercase; reads fold case and the Crockford
//     confusables (i/l → 1, o → 0) before validating.
//
// This package neither encodes a UUID/integer nor decodes back to one — the
// 8-char string *is* the identifier — and it extracts no timestamp.
package idcodec

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

// Alphabet is the Crockford base32 alphabet in lowercase-canonical order:
// the digit symbols 0-9 followed by the 22 letters, with i, l, o, u excluded
// (the four Crockford-confusable / non-canonical glyphs). Index i is the
// symbol with value i. 32 symbols total.
const Alphabet = "0123456789abcdefghjkmnpqrstvwxyz"

// FirstAlphabet is the 22-letter subset legal as the FIRST character of an id:
// Alphabet with the ten digits removed. A leading letter makes every id a
// legal Lean identifier (a Lean identifier may not begin with a digit), which
// is the property the namespace/import/open splice relies on.
const FirstAlphabet = "abcdefghjkmnpqrstvwxyz"

// Length is the fixed id width.
const Length = 8

// Mint returns a fresh canonical 8-char unified identifier, drawn from a CSPRNG.
// The first character is uniform over the 22 letters (FirstAlphabet); the
// remaining seven are uniform over the full 32-symbol Alphabet. The result is
// always lowercase-canonical and satisfies Valid.
//
// Mint panics only if the system CSPRNG (crypto/rand) fails, which on a healthy
// host does not happen; callers do not handle an error from Mint. The retry the
// design describes is the unique-constraint retry at the database call site, not
// a re-roll inside the encoder, so the encoder needs no error return.
func Mint() string {
	var out [Length]byte

	// First character: unbiased draw over the 22 letters. crypto/rand.Int
	// rejection-samples internally, so there is no modulo bias for the
	// non-power-of-two count 22.
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(FirstAlphabet))))
	if err != nil {
		panic(fmt.Errorf("idcodec: crypto/rand failed: %w", err))
	}
	out[0] = FirstAlphabet[n.Int64()]

	// Remaining seven characters: unbiased draw over the 32 symbols. Drawn
	// per-symbol with rand.Int for symmetry with the first character (32 being
	// a power of two, this is bias-free).
	for i := 1; i < Length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(Alphabet))))
		if err != nil {
			panic(fmt.Errorf("idcodec: crypto/rand failed: %w", err))
		}
		out[i] = Alphabet[n.Int64()]
	}

	return string(out[:])
}

// Valid reports whether s is an already-canonical unified identifier: exactly
// Length characters, the first drawn from FirstAlphabet (a lowercase letter,
// none of i/l/o/u), every character drawn from Alphabet (lowercase, none of
// i/l/o/u), with NO case folding and NO Crockford input folding applied. This
// is the strict semantic the route handlers gate on (malformed → 400) and the
// exact predicate the Lean side mirrors for its import gate.
func Valid(s string) bool {
	if len(s) != Length {
		return false
	}
	if strings.IndexByte(FirstAlphabet, s[0]) < 0 {
		return false
	}
	for i := 1; i < Length; i++ {
		if strings.IndexByte(Alphabet, s[i]) < 0 {
			return false
		}
	}
	return true
}

// Canonicalize maps a possibly-non-canonical id to its canonical lowercase
// form and reports whether the result is valid. It (1) lowercases all ASCII
// letters, then (2) applies Crockford input folding — i, I, l, L → '1' and
// o, O → '0' — then (3) checks the strict predicate Valid on the folded result.
// 'u'/'U' has NO Crockford fold target, so any input containing it is invalid
// (ok == false). The returned canonical string is meaningful only when ok is
// true; when ok is false the caller returns 400 and ignores canonical.
//
// Route pipeline:
//
//	canon, ok := Canonicalize(raw)
//	if !ok            { return 400 }
//	if canon != raw   { return 308 redirect to canon }
//	// else serve lookup(canon)
func Canonicalize(s string) (canonical string, ok bool) {
	// (1) Case fold ASCII A-Z, then (2) Crockford input fold i/l → 1, o → 0.
	// u/U is intentionally not mapped (no canonical digit), so it survives and
	// Valid rejects it below. Any non-ASCII byte passes through and fails Valid.
	lowered := strings.ToLower(s)
	var b strings.Builder
	b.Grow(len(lowered))
	for i := 0; i < len(lowered); i++ {
		switch c := lowered[i]; c {
		case 'i', 'l':
			b.WriteByte('1')
		case 'o':
			b.WriteByte('0')
		default:
			b.WriteByte(c)
		}
	}
	canonical = b.String()
	return canonical, Valid(canonical)
}
