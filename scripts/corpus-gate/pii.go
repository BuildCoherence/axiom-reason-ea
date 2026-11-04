package main

import (
	"bufio"
	"bytes"
	"fmt"
	"net/netip"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

const (
	piiEmail     = "email"
	piiUID       = "firebase-uid"
	piiIPv4      = "ipv4"
	piiIPv6      = "ipv6"
	piiUserAgent = "user-agent"
)

// firebaseUIDLength is the width of a Firebase Auth generated uid.
const firebaseUIDLength = 28

var (
	emailPattern     = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`)
	userAgentPattern = regexp.MustCompile(`(?i)\b(?:mozilla|applewebkit|chrome|chromium|safari|firefox|gecko|edg|opr|` +
		`headlesschrome|curl|wget|python-requests|python-urllib|aiohttp|go-http-client|okhttp|postmanruntime|axios|` +
		`node-fetch|undici|libwww-perl|java|dalvik)/\d`)
)

// leanSourceKeys name JSON fields whose strings are copies or slices of
// published Lean source; hits under them are reported for review only.
var leanSourceKeys = map[string]bool{
	"content": true, "file_content": true, "file_content_by_file": true, "source": true, "text": true,
	"label": true, "inlined_type_summary": true, "type": true, "name": true, "qualified_name": true,
	"local_name": true, "searchable_name": true, "type_head": true, "axiom_name": true, "conclusion_prop": true,
}

// structuralKeys name JSON fields whose strings are ids the Lean validator
// builds from declaration names (`<decl>::src::<i>`), which the qualified_name
// fields already carry; their `::<i>` suffix would otherwise read as IPv6.
var structuralKeys = map[string]bool{"token_id": true}

// piiKinds lists the PII pattern kinds found in s, sorted.
func piiKinds(s string) []string {
	found := map[string]bool{}
	if emailPattern.MatchString(s) {
		found[piiEmail] = true
	}
	if userAgentPattern.MatchString(s) {
		found[piiUserAgent] = true
	}
	for _, tok := range strings.FieldsFunc(s, func(r rune) bool { return !isASCIIAlnum(r) }) {
		if isFirebaseUIDShaped(tok) {
			found[piiUID] = true
		}
	}
	for _, tok := range strings.FieldsFunc(s, func(r rune) bool { return !(r == '.' || isDigit(r)) }) {
		tok = strings.Trim(tok, ".")
		if strings.Count(tok, ".") != 3 {
			continue
		}
		if a, err := netip.ParseAddr(tok); err == nil && a.Is4() {
			found[piiIPv4] = true
		}
	}
	for _, tok := range strings.FieldsFunc(s, func(r rune) bool { return !(r == ':' || r == '.' || isHex(r)) }) {
		tok = strings.TrimRight(tok, ".")
		if strings.Count(tok, ":") < 2 {
			continue
		}
		if a, err := netip.ParseAddr(tok); err == nil && a.Is6() && !a.IsUnspecified() {
			found[piiIPv6] = true
		}
	}
	kinds := make([]string, 0, len(found))
	for k := range found {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	return kinds
}

func isDigit(r rune) bool { return '0' <= r && r <= '9' }

func isHex(r rune) bool { return isDigit(r) || ('a' <= r && r <= 'f') || ('A' <= r && r <= 'F') }

func isASCIIAlnum(r rune) bool {
	return r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r))
}

// isFirebaseUIDShaped matches a 28-character base62 token with both letter
// cases, which a random base62 uid has with near certainty.
func isFirebaseUIDShaped(tok string) bool {
	if len(tok) != firebaseUIDLength {
		return false
	}
	upper, lower := false, false
	for _, r := range tok {
		upper = upper || unicode.IsUpper(r)
		lower = lower || unicode.IsLower(r)
	}
	return upper && lower
}

func (g *gate) checkPII() error {
	for _, rel := range g.files {
		switch {
		case jsonScope(rel):
			if v, ok := g.decoded[rel]; ok {
				g.scanJSON(rel, v, "", false)
			}
		case rel == "AUTHORS":
			if err := g.scanLines(rel, severityBlock); err != nil {
				return err
			}
		case strings.HasPrefix(rel, "A/"):
			if err := g.scanLines(rel, severityReview); err != nil {
				return err
			}
		}
	}
	return nil
}

func (g *gate) scanLines(rel string, sev severity) error {
	data, err := g.read(rel)
	if err != nil {
		return err
	}
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 0, 64*1024), len(data)+1)
	for n := 1; sc.Scan(); n++ {
		where := fmt.Sprintf(":%d", n)
		for _, kind := range piiKinds(sc.Text()) {
			g.add(sev, "pii", rel, where, kind)
		}
		literal := g.literals.wholeValue
		if sev == severityReview {
			literal = g.literals.inSource
		}
		for _, kind := range literal(sc.Text()) {
			g.add(sev, "pii", rel, where, kind)
		}
	}
	return sc.Err()
}

func (g *gate) scanJSON(rel string, v any, ptr string, lean bool) {
	sevFor := func(lean bool) severity {
		if lean {
			return severityReview
		}
		return severityBlock
	}
	switch v := v.(type) {
	case string:
		for _, kind := range piiKinds(v) {
			g.add(sevFor(lean), "pii", rel, "#"+ptr, kind)
		}
		literal := g.literals.wholeValue
		if lean {
			literal = g.literals.inSource
		}
		for _, kind := range literal(v) {
			g.add(sevFor(lean), "pii", rel, "#"+ptr, kind)
		}
	case []any:
		for i, e := range v {
			g.scanJSON(rel, e, fmt.Sprintf("%s/%d", ptr, i), lean)
		}
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			for _, kind := range append(piiKinds(k), g.literals.wholeValue(k)...) {
				g.add(severityBlock, "pii", rel, "#"+ptr+"/<key>", kind)
			}
			if structuralKeys[k] {
				continue
			}
			g.scanJSON(rel, v[k], ptr+"/"+g.pointerSegment(k), lean || leanSourceKeys[k])
		}
	}
}

// pointerSegment escapes k per RFC 6901 and withholds a key that itself
// matches a PII pattern or literal.
func (g *gate) pointerSegment(k string) string {
	if len(piiKinds(k)) > 0 || len(g.literals.wholeValue(k)) > 0 {
		return "<key>"
	}
	return strings.NewReplacer("~", "~0", "/", "~1").Replace(k)
}
