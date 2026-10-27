// Package workflowlint checks this repository's GitHub Actions workflows for
// the hardening the release token depends on: read-only default permissions,
// no pull_request_target trigger, and every action pinned to a commit SHA.
// It reads the block-style YAML these workflows use; it is not a general YAML
// parser.
package workflowlint

import (
	"fmt"
	"regexp"
	"strings"
)

// Grant is one write permission a job holds.
type Grant struct {
	Job, Scope string
}

// Report is what Lint found in one workflow file.
type Report struct {
	Problems []string
	Writes   []Grant
}

var (
	pinnedAction = regexp.MustCompile(`^[\w.-]+/[\w.-]+(/[\w./-]+)?@[0-9a-f]{40}$`)
	pinnedDocker = regexp.MustCompile(`^docker://[^@\s]+@sha256:[0-9a-f]{64}$`)
	blockScalar  = regexp.MustCompile(`^[|>][+-]?[0-9]?$`)
	keyLine      = regexp.MustCompile(`^([\w.-]+|"[^"]*"|'[^']*'):(?:\s+(.*))?$`)
)

// listItem is the path key of a list item that is not a mapping.
const listItem = "-"

type entry struct {
	line  int
	path  []string
	value string
}

// Lint checks the workflow source src; name labels its problems.
func Lint(name string, src []byte) Report {
	var r Report
	entries := parse(src)
	topPermissions := false
	for _, e := range entries {
		at := fmt.Sprintf("%s:%d", name, e.line)
		key := e.path[len(e.path)-1]
		if key == "pull_request_target" || strings.Contains(e.value, "pull_request_target") {
			r.Problems = append(r.Problems, at+": pull_request_target trigger")
		}
		if key == "uses" && !strings.HasPrefix(e.value, "./") && !pinnedAction.MatchString(e.value) && !pinnedDocker.MatchString(e.value) {
			r.Problems = append(r.Problems, fmt.Sprintf("%s: %q is not pinned to a 40-hex commit SHA", at, e.value))
		}
		switch {
		case key == listItem:
		case len(e.path) == 1 && key == "permissions":
			topPermissions = true
			for _, pv := range permissionValues(e.value) {
				scope, level := pv[0], pv[1]
				if level != "read" && level != "none" && level != "read-all" {
					r.Problems = append(r.Problems, fmt.Sprintf("%s: default permission %s is %q, not read-only", at, scope, level))
				}
			}
		case len(e.path) == 2 && e.path[0] == "permissions":
			if e.value != "read" && e.value != "none" {
				r.Problems = append(r.Problems, fmt.Sprintf("%s: default permission %s is %q, not read-only", at, key, e.value))
			}
		case len(e.path) == 3 && e.path[0] == "jobs" && key == "permissions":
			for _, pv := range permissionValues(e.value) {
				if pv[1] == "write" || pv[1] == "write-all" {
					r.Writes = append(r.Writes, Grant{e.path[1], pv[0]})
				}
			}
		case len(e.path) == 4 && e.path[0] == "jobs" && e.path[2] == "permissions":
			if e.value == "write" {
				r.Writes = append(r.Writes, Grant{e.path[1], key})
			}
		}
	}
	if !topPermissions {
		r.Problems = append(r.Problems, name+": no top-level permissions block, so the default token is not read-only")
	}
	return r
}

// permissionValues reads an inline permissions value (read-all, write-all, or
// a flow map) as scope/level pairs in source order.
func permissionValues(v string) [][2]string {
	switch v {
	case "":
		return nil
	case "read-all", "write-all":
		return [][2]string{{"*", v}}
	}
	var out [][2]string
	body := strings.TrimSuffix(strings.TrimPrefix(v, "{"), "}")
	for item := range strings.SplitSeq(body, ",") {
		scope, level, ok := strings.Cut(item, ":")
		if ok {
			out = append(out, [2]string{strings.TrimSpace(scope), strings.TrimSpace(level)})
		} else if s := strings.TrimSpace(item); s != "" {
			out = append(out, [2]string{s, "invalid"})
		}
	}
	return out
}

// parse returns every mapping key with its path and inline value, skipping
// comments and the bodies of block scalars (run scripts).
func parse(src []byte) []entry {
	type frame struct {
		indent int
		key    string
	}
	var (
		out         []entry
		stack       []frame
		scalarAbove = -1
	)
	for i, raw := range strings.Split(strings.ReplaceAll(string(src), "\r\n", "\n"), "\n") {
		text := strings.TrimRight(raw, " \t")
		body := strings.TrimLeft(text, " ")
		indent := len(text) - len(body)
		if body == "" {
			continue
		}
		if scalarAbove >= 0 {
			if indent > scalarAbove {
				continue
			}
			scalarAbove = -1
		}
		if strings.HasPrefix(body, "#") {
			continue
		}
		for strings.HasPrefix(body, "- ") {
			body = strings.TrimLeft(body[2:], " ")
			indent = len(text) - len(body)
		}
		body = stripComment(body)
		m := keyLine.FindStringSubmatch(body)
		if m == nil {
			// A plain list item, such as one event in a list of triggers.
			path := []string{listItem}
			for j := len(stack) - 1; j >= 0; j-- {
				path = append([]string{stack[j].key}, path...)
			}
			out = append(out, entry{line: i + 1, path: path, value: strings.Trim(body, `"'`)})
			continue
		}
		key := strings.Trim(m[1], `"'`)
		value := strings.Trim(strings.TrimSpace(m[2]), `"'`)
		for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
			stack = stack[:len(stack)-1]
		}
		stack = append(stack, frame{indent, key})
		path := make([]string, len(stack))
		for j, f := range stack {
			path[j] = f.key
		}
		out = append(out, entry{line: i + 1, path: path, value: value})
		if blockScalar.MatchString(value) {
			scalarAbove = indent
		}
	}
	return out
}

// stripComment drops a trailing " #" comment that is outside quotes.
func stripComment(s string) string {
	var quote rune
	for i, c := range s {
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '#' && i > 0 && (s[i-1] == ' ' || s[i-1] == '\t'):
			return strings.TrimRight(s[:i], " \t")
		}
	}
	return s
}
