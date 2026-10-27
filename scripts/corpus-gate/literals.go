package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// literalSet is account text known only to the export database (display
// names, bios, usernames that must not be published). Kind names its findings.
type literalSet struct {
	Kind   string   `json:"kind"`
	Values []string `json:"values"`
	// ReviewInSource also reports whole-word occurrences in Lean source.
	ReviewInSource bool `json:"review_in_source"`
}

type literalNeedle struct {
	text string // lowercased
	lead int    // byte offset of the needle's first word in text
	kind string
}

// literalMatcher finds literal values by whole-value equality, and inside Lean
// source by whole-word occurrence, ignoring case.
type literalMatcher struct {
	whole   map[string][]string
	byWord  map[string][]literalNeedle
	nonWord []literalNeedle
}

func readLiterals(path string, stdin io.Reader) ([]literalSet, error) {
	var data []byte
	var err error
	if path == "-" {
		data, err = io.ReadAll(stdin)
	} else {
		data, err = os.ReadFile(path)
	}
	if err != nil {
		return nil, fmt.Errorf("read literals: %w", err)
	}
	var sets []literalSet
	if err := json.Unmarshal(data, &sets); err != nil {
		return nil, errors.New("literals: not a JSON array of {kind, values, review_in_source}")
	}
	for _, s := range sets {
		if s.Kind == "" {
			return nil, errors.New("literals: a set has no kind")
		}
	}
	return sets, nil
}

func newLiteralMatcher(sets []literalSet) *literalMatcher {
	m := &literalMatcher{whole: map[string][]string{}, byWord: map[string][]literalNeedle{}}
	for _, set := range sets {
		for _, v := range set.Values {
			text := strings.ToLower(strings.TrimSpace(v))
			if text == "" {
				continue
			}
			if !slices.Contains(m.whole[text], set.Kind) {
				m.whole[text] = append(m.whole[text], set.Kind)
			}
			if !set.ReviewInSource {
				continue
			}
			start, end, ok := nextWord(text, 0)
			n := literalNeedle{text: text, lead: start, kind: set.Kind}
			if !ok {
				m.nonWord = append(m.nonWord, n)
				continue
			}
			first := text[start:end]
			m.byWord[first] = append(m.byWord[first], n)
		}
	}
	return m
}

func (m *literalMatcher) empty() bool { return m == nil || len(m.whole) == 0 }

// wholeValue returns the kinds whose value equals s.
func (m *literalMatcher) wholeValue(s string) []string {
	if m.empty() {
		return nil
	}
	return m.whole[strings.ToLower(strings.TrimSpace(s))]
}

// inSource returns the kinds with a whole-word occurrence in s, sorted.
func (m *literalMatcher) inSource(s string) []string {
	if m.empty() {
		return nil
	}
	ls := strings.ToLower(s)
	found := map[string]bool{}
	for _, k := range m.wholeValue(s) {
		found[k] = true
	}
	for _, n := range m.nonWord {
		if strings.Contains(ls, n.text) {
			found[n.kind] = true
		}
	}
	for pos := 0; ; {
		start, end, ok := nextWord(ls, pos)
		if !ok {
			break
		}
		for _, n := range m.byWord[ls[start:end]] {
			at := start - n.lead
			if at >= 0 && strings.HasPrefix(ls[at:], n.text) && wordBounded(ls, at, at+len(n.text)) {
				found[n.kind] = true
			}
		}
		pos = end
	}
	kinds := make([]string, 0, len(found))
	for k := range found {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	return kinds
}

func isWordRune(r rune) bool { return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) }

// nextWord returns the byte span of the first run of word runes at or after from.
func nextWord(s string, from int) (int, int, bool) {
	start := -1
	for i, r := range s[from:] {
		i += from
		switch {
		case isWordRune(r) && start < 0:
			start = i
		case !isWordRune(r) && start >= 0:
			return start, i, true
		}
	}
	if start >= 0 {
		return start, len(s), true
	}
	return 0, 0, false
}

// wordBounded reports whether s[start:end] neither continues a word before
// start nor runs into one after end.
func wordBounded(s string, start, end int) bool {
	first, _ := utf8.DecodeRuneInString(s[start:end])
	last, _ := utf8.DecodeLastRuneInString(s[start:end])
	if before, _ := utf8.DecodeLastRuneInString(s[:start]); start > 0 && isWordRune(first) && isWordRune(before) {
		return false
	}
	if after, _ := utf8.DecodeRuneInString(s[end:]); end < len(s) && isWordRune(last) && isWordRune(after) {
		return false
	}
	return true
}
