// Package cliprompt holds the reusable Y/N prompt-handling primitives
// shared across axm commands, so every prompt accepts the same answer
// vocabulary (`y` / `yes`, case-insensitive, whitespace-trimmed).
//
// The package is intentionally tiny: just two pure-ish helpers, no TTY
// detection (that stays at the call site so this package never imports
// golang.org/x/term and stays trivially testable).
package cliprompt

import (
	"bufio"
	"io"
	"strings"
)

// ReadAnswer reads a single line from r and returns it with the trailing
// newline stripped. EOF before any input yields ("", nil) so callers can
// treat an empty answer as the prompt's default-reject branch.
func ReadAnswer(r io.Reader) (string, error) {
	scanner := bufio.NewScanner(r)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return "", err
		}
		return "", nil
	}
	return scanner.Text(), nil
}

// ParseYes reports whether the answer should be treated as acceptance for a
// `[y/N]`-style prompt. Trims surrounding whitespace, lowercases, then
// matches "y" or "yes" exactly. Everything else — including empty input,
// "n", "yep", "ya" — is rejection.
func ParseYes(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "y" || s == "yes"
}
