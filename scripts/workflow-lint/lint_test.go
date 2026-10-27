package workflowlint

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const sha = "0123456789abcdef0123456789abcdef01234567"

// releaseWrite is the only write grant any workflow may hold: the job that
// publishes the draft Release.
var releaseWrite = map[string][]Grant{"release.yml": {{Job: "release", Scope: "contents"}}}

func TestRepositoryWorkflows(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", ".github", "workflows", "*.y*ml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) < 2 {
		t.Fatalf("found %d workflows, want ci.yml and release.yml at least", len(paths))
	}
	writes := map[string][]Grant{}
	for _, p := range paths {
		src, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		r := Lint(filepath.Base(p), src)
		for _, problem := range r.Problems {
			t.Error(problem)
		}
		if len(r.Writes) > 0 {
			writes[filepath.Base(p)] = r.Writes
		}
	}
	if !reflect.DeepEqual(writes, releaseWrite) {
		t.Errorf("write grants = %v, want only %v", writes, releaseWrite)
	}
}

func TestLint(t *testing.T) {
	for _, tc := range []struct {
		name         string
		src          string
		wantProblems []string
		wantWrites   []Grant
	}{
		{
			name: "hardened",
			src: `name: ok
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@` + sha + ` # v6.1.0
      - uses: ./.github/actions/local
      - name: script text is not workflow structure
        run: |
          echo "permissions: write-all"
          echo "uses: evil/action@v1"
          # pull_request_target
  release:
    permissions:
      contents: write
    uses: org/repo/.github/workflows/x.yml@` + sha + `
`,
			wantWrites: []Grant{{"release", "contents"}},
		},
		{
			name:         "no default permissions",
			src:          "on: push\njobs:\n  a:\n    runs-on: x\n",
			wantProblems: []string{"no top-level permissions block"},
		},
		{
			name:         "default write",
			src:          "on: push\npermissions:\n  contents: write\n",
			wantProblems: []string{"default permission contents is \"write\""},
		},
		{
			name:         "default write-all",
			src:          "on: push\npermissions: write-all\n",
			wantProblems: []string{"default permission * is \"write-all\""},
		},
		{
			name:         "default flow map with a write",
			src:          "on: push\npermissions: { contents: read, packages: write }\n",
			wantProblems: []string{"default permission packages is \"write\""},
		},
		{
			name:         "pull_request_target key",
			src:          "on:\n  pull_request_target:\n    types: [opened]\npermissions: {}\n",
			wantProblems: []string{"t.yml:2: pull_request_target trigger"},
		},
		{
			name:         "pull_request_target list item",
			src:          "on:\n  - push\n  - pull_request_target\npermissions: read-all\n",
			wantProblems: []string{"t.yml:3: pull_request_target trigger"},
		},
		{
			name:         "pull_request_target flow list",
			src:          "on: [push, pull_request_target]\npermissions: read-all\n",
			wantProblems: []string{"t.yml:1: pull_request_target trigger"},
		},
		{
			name: "unpinned actions",
			src: `on: push
permissions:
  contents: read
jobs:
  a:
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-go@924ae3a
      - uses: "actions/setup-node@` + strings.ToUpper(sha) + `"
      - uses: docker://alpine:3
`,
			wantProblems: []string{
				`t.yml:7: "actions/checkout@v6" is not pinned`,
				`t.yml:8: "actions/setup-go@924ae3a" is not pinned`,
				`t.yml:9: "actions/setup-node@` + strings.ToUpper(sha) + `" is not pinned`,
				`t.yml:10: "docker://alpine:3" is not pinned`,
			},
		},
		{
			name: "job write grants",
			src: `on: push
permissions:
  contents: read
jobs:
  a:
    permissions: write-all
  b:
    permissions: { issues: write, contents: read }
  c:
    permissions:
      id-token: write
      contents: read
`,
			wantWrites: []Grant{{"a", "*"}, {"b", "issues"}, {"c", "id-token"}},
		},
		{
			name: "CRLF line endings",
			src:  "on: push\r\npermissions:\r\n  contents: read\r\njobs:\r\n  a:\r\n    steps:\r\n      - uses: a/b@v1\r\n",
			wantProblems: []string{
				`t.yml:7: "a/b@v1" is not pinned`,
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := Lint("t.yml", []byte(tc.src))
			if len(r.Problems) != len(tc.wantProblems) {
				t.Fatalf("problems = %q, want %d matching %q", r.Problems, len(tc.wantProblems), tc.wantProblems)
			}
			for i, want := range tc.wantProblems {
				if !strings.Contains(r.Problems[i], want) {
					t.Errorf("problem %d = %q, want it to contain %q", i, r.Problems[i], want)
				}
			}
			if !reflect.DeepEqual(r.Writes, tc.wantWrites) {
				t.Errorf("writes = %v, want %v", r.Writes, tc.wantWrites)
			}
		})
	}
}
