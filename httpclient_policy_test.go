package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// httpClientAPIs are the net/http identifiers that issue outbound requests.
var httpClientAPIs = map[string]bool{
	"Client":                true,
	"DefaultClient":         true,
	"Get":                   true,
	"Head":                  true,
	"Post":                  true,
	"PostForm":              true,
	"NewRequest":            true,
	"NewRequestWithContext": true,
}

// httpClientOwner is the only package allowed to make outbound HTTP requests.
const httpClientOwner = "internal/upgrade"

// httpClientUses lists "<file>: http.<API>" for every production file under root
// outside httpClientOwner that references a net/http client API.
func httpClientUses(t *testing.T, root string) []string {
	t.Helper()
	var uses []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == httpClientOwner || rel == "vendor" || d.Name() == "testdata" || (rel != "." && strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(rel, ".go") || strings.HasSuffix(rel, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		names := map[string]bool{}
		for _, imp := range file.Imports {
			if p, _ := strconv.Unquote(imp.Path.Value); p == "net/http" {
				name := "http"
				if imp.Name != nil {
					name = imp.Name.Name
				}
				names[name] = true
			}
		}
		if len(names) == 0 {
			return nil
		}
		ast.Inspect(file, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if pkg, ok := sel.X.(*ast.Ident); ok && names[pkg.Name] && httpClientAPIs[sel.Sel.Name] {
				uses = append(uses, rel+": http."+sel.Sel.Name)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(uses)
	return uses
}

func TestOnlyUpgradeMakesHTTPRequests(t *testing.T) {
	if uses := httpClientUses(t, "."); len(uses) != 0 {
		t.Fatalf("net/http client APIs outside %s:\n%s", httpClientOwner, strings.Join(uses, "\n"))
	}
}

func TestHTTPClientPolicyDetectsViolations(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"cmd/leak.go":                  "package cmd\nimport web \"net/http\"\nfunc f() { _, _ = web.Get(\"x\") }\n",
		"cmd/client.go":                "package cmd\nimport \"net/http\"\nvar c = &http.Client{}\n",
		"cmd/server.go":                "package cmd\nimport \"net/http\"\nvar s = &http.Server{Handler: http.FileServer(http.Dir(\".\"))}\n",
		"cmd/leak_test.go":             "package cmd\nimport \"net/http\"\nvar r, _ = http.NewRequest(\"GET\", \"x\", nil)\n",
		httpClientOwner + "/client.go": "package upgrade\nimport \"net/http\"\nvar c = http.DefaultClient\n",
	}
	for name, body := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got := strings.Join(httpClientUses(t, root), "\n")
	want := "cmd/client.go: http.Client\ncmd/leak.go: http.Get"
	if got != want {
		t.Fatalf("violations = %q, want %q", got, want)
	}
}
