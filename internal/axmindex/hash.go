package axmindex

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// NormalizedHash returns the hex SHA-256 of a normalized form of source.
//
// Scope of normalization:
//   - Line endings: CRLF (\r\n) is folded to LF (\n) so the same file
//     authored on Windows and on Mac/Linux hashes identically. A lone
//     CR (\r, old-Mac style) is NOT normalized — it would be surprising
//     in modern Lean source and silently rewriting it could mask a real
//     corruption.
//   - BOM: a leading UTF-8 BOM (\ufeff) is NOT stripped. Lean source is
//     UTF-8 by toolchain contract and should not carry a BOM; if one
//     slips in, preserving it means the server re-hashes to the same
//     value the client computed, rather than silently diverging.
//   - Trailing newlines: the trailing newline at end-of-file is NOT
//     trimmed here. trimAndCollapse below terminates non-empty output
//     with exactly one '\n' so the hash is stable whether or not the
//     input ended with a newline, but no additional end-of-file
//     trimming is performed.
//   - Character set: this function assumes UTF-8 input (Lean toolchain
//     contract). It does not validate encoding — the only byte-level
//     rewriting it performs is the CRLF → LF fold above, everything
//     else is byte-preserving.
//
// Keeping this conservative is important: the server re-runs the exact
// same normalization on received content and compares against the
// client-reported hash. Any divergence between client and server
// normalization would break reproducibility of the content-hash
// contract.
//
// Further normalization steps applied on top of the line-ending fold:
//  1. Strip Lean line comments: `-- ...` to end of line.
//  2. Strip Lean block comments: `/- ... -/`, tracking nested depth.
//  3. Trim trailing whitespace from each resulting line.
//  4. Drop blank / whitespace-only lines entirely. Without this,
//     adding a block comment (even on its own line) would change the
//     hash, contradicting the spec's "stable across adding/removing
//     line and block comments" test.
//
// Bytes outside comments are preserved verbatim, and string literals are
// lexed so a comment opener inside a `"..."` string stays data. This
// reverses design §"Open questions" #1's original conservative posture,
// which mis-assessed the harm direction: not lexing strings cannot cause
// two distinct files to hash apart, only to hash the SAME when they
// differ — and an unbalanced `/-` inside a string would open a block
// comment that swallowed the rest of the file, so every later edit
// hashed identically and was silently never published (coherence-f6cn.3.2).
// Only `"` opens a string here: Lean uses `'` in ordinary identifiers
// (`x'`), so treating it as a char-literal delimiter would be unsafe.
//
// This is the single definition of "same content" across `axm status`,
// `axm check`, `axm pull`, and `axm fork`'s duplicate-content guard.
func NormalizedHash(source []byte) string {
	normalized := strings.ReplaceAll(string(source), "\r\n", "\n")
	stripped := stripComments([]byte(normalized))
	trimmed := trimAndCollapse(stripped)
	sum := sha256.Sum256(trimmed)
	return hex.EncodeToString(sum[:])
}

// stripComments removes Lean line and (nestable) block comments, preserving
// all other bytes including newlines. Malformed block comments (e.g. an
// unmatched `-/`) are tolerated — depth is tracked but never reported as
// an error per the spec's permissive posture.
func stripComments(source []byte) []byte {
	var out []byte
	depth := 0 // block-comment nesting depth
	i := 0
	n := len(source)
	for i < n {
		if depth > 0 {
			// Inside a block comment. Look for `/-` (nest) or `-/` (pop).
			if i+1 < n && source[i] == '/' && source[i+1] == '-' {
				depth++
				i += 2
				continue
			}
			if i+1 < n && source[i] == '-' && source[i+1] == '/' {
				depth--
				i += 2
				continue
			}
			// Preserve newlines so line numbers / trimming behave.
			if source[i] == '\n' {
				out = append(out, '\n')
			}
			i++
			continue
		}

		// Outside comments. A string literal is opaque: copy it verbatim
		// (including the quotes and any comment-looking bytes inside) so a
		// `--` or `/-` in string data cannot open a comment. Backslash
		// escapes the next byte, so an escaped quote does not close the
		// string. An unterminated string copies to EOF, matching the
		// permissive posture for malformed input.
		if source[i] == '"' {
			out = append(out, source[i])
			i++
			for i < n {
				c := source[i]
				if c == '\\' && i+1 < n {
					out = append(out, c, source[i+1])
					i += 2
					continue
				}
				out = append(out, c)
				i++
				if c == '"' {
					break
				}
			}
			continue
		}

		// Check for comment openers.
		if i+1 < n && source[i] == '-' && source[i+1] == '-' {
			// Line comment: skip to but not including the newline.
			i += 2
			for i < n && source[i] != '\n' {
				i++
			}
			continue
		}
		if i+1 < n && source[i] == '/' && source[i+1] == '-' {
			depth++
			i += 2
			continue
		}

		out = append(out, source[i])
		i++
	}
	return out
}

// trimAndCollapse removes trailing whitespace from each line and drops
// any line that is entirely whitespace. The result is joined with '\n'
// and terminated with a trailing newline when non-empty, so the hash
// output is stable regardless of whether the source ended with a newline.
func trimAndCollapse(b []byte) []byte {
	raw := strings.Split(string(b), "\n")
	out := make([]string, 0, len(raw))
	for _, line := range raw {
		t := strings.TrimRight(line, " \t")
		if t == "" {
			continue
		}
		out = append(out, t)
	}
	if len(out) == 0 {
		return nil
	}
	joined := strings.Join(out, "\n") + "\n"
	return []byte(joined)
}
