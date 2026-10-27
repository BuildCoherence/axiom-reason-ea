// The web read-path's single source of the unified identifier format in TS —
// a deliberate language-port of Axiom's Go `idcodec` package
// (axiom/idcodec/idcodec.go, spec the internal spec-idcodec doc). The
// unified id is an 8-character, letter-first, confusable-free,
// case-insensitive Crockford base32 string; the canonical form is lowercase,
// and reads fold case + the Crockford confusables (i/l → 1, o → 0) before
// validating.
//
// The constants and the ASCII Crockford mappings are copied VERBATIM from
// `idcodec.go`, and test/unit/id-codec.spec.ts mirrors idcodec_test.go
// one-to-one over them. The case fold is NOT copied — each side delegates to
// its runtime's Unicode table (Go `strings.ToLower` vs JS `toLowerCase`), which
// disagree on a handful of code points (notably U+0130 `İ`). That is safe only
// because the strict ASCII gate below runs on the folded result: a disagreement
// can make one side reject what the other accepts, but can never yield two
// DIFFERENT valid ids, so no URL resolves to different records. Do not weaken
// that gate or consume a folded string without it.
//
// This is the ONLY place the alphabet /
// id-shape lives in the web tree — route handlers import from here; do not
// re-derive a regex or alphabet anywhere else (the internal code-quality doc
// § "Centralize over duplicate", § canonical-version-with-derived-formats).
//
// READ-PATH ONLY: no mint/encode/decode. The web never mints ids (the API and
// CLI do, via the Go `idcodec`), and the 8-char string *is* the identifier
// (there is no UUID/integer to decode). This module validates + canonicalizes.

/** Crockford base32, lowercase-canonical: digits 0-9 then the 22 letters (i,l,o,u excluded). 32 symbols. */
export const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** The 22-letter subset legal as the FIRST character (ALPHABET with the ten digits dropped == ALPHABET.slice(10)). */
export const FIRST_ALPHABET = "abcdefghjkmnpqrstvwxyz";

/** Fixed id width. */
export const ID_LENGTH = 8;

/**
 * True iff `s` is an ALREADY-CANONICAL unified identifier: exactly ID_LENGTH
 * chars, the first in FIRST_ALPHABET (a lowercase letter, none of i/l/o/u),
 * every char in ALPHABET (lowercase, none of i/l/o/u). NO case folding, NO
 * Crockford folding applied. Mirrors Go idcodec.Valid — the strict predicate
 * the route handlers gate on (malformed → 400/notFound).
 *
 * Because the alphabets are lowercase and exclude i,l,o,u, this automatically
 * rejects any uppercase letter, any i/l/o/u in any position, a digit in
 * position 0, any non-alphabet glyph, and any wrong length — without folding.
 */
export function isValidId(s: string): boolean {
  // Length first; index iteration (NOT spreading into code points) matches the
  // Go byte loop — all alphabet symbols are single-code-unit ASCII, and index
  // iteration keeps a non-BMP char from masking a length mismatch.
  if (s.length !== ID_LENGTH) {
    return false;
  }
  if (FIRST_ALPHABET.indexOf(s[0]) < 0) {
    return false;
  }
  for (let i = 1; i < ID_LENGTH; i++) {
    if (ALPHABET.indexOf(s[i]) < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Fold a possibly-non-canonical id to its canonical lowercase form and report
 * validity. (1) lowercase ASCII A-Z, then (2) Crockford input-fold i/I/l/L →
 * '1', o/O → '0' (u/U has NO fold target — it survives and fails validity),
 * then (3) check isValidId on the folded result. `canonical` is meaningful only
 * when `ok` is true. Mirrors Go idcodec.Canonicalize.
 *
 * Folding direction (do NOT invert): Crockford folding is INPUT normalisation —
 * confusable letter forms map to canonical digit forms (I/L/O → 1/1/0), not the
 * reverse. The letter-first rule is enforced AFTER folding, so a leading `o`
 * folds to a leading `0` and is then rejected (it does not sneak in).
 *
 * Route pipeline (path routes):
 *   const { canonical, ok } = canonicalizeId(raw);
 *   if (!ok)               notFound();                 // 400-equivalent on the web
 *   if (canonical !== raw) redirect(<canonical URL>);  // 308 (Next default)
 *   // else serve lookup(canonical)
 */
export function canonicalizeId(s: string): { canonical: string; ok: boolean } {
  // (1) Case fold via the runtime's Unicode table — mostly ASCII A-Z, but a few
  // non-ASCII code points do fold into the alphabet (U+212A -> `k`), then
  // (2) Crockford input fold i/l → 1, o → 0. u/U is intentionally not mapped.
  const lowered = s.toLowerCase();
  let canonical = "";
  for (let i = 0; i < lowered.length; i++) {
    const c = lowered[i];
    if (c === "i" || c === "l") {
      canonical += "1";
    } else if (c === "o") {
      canonical += "0";
    } else {
      canonical += c;
    }
  }
  return { canonical, ok: isValidId(canonical) };
}
