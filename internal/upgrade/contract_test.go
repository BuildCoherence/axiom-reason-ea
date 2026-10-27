package upgrade

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestArchiveProjectName_MatchesGoReleaserConfig pins archiveProjectName
// to `project_name:` in axiom/cli/.goreleaser.yaml. archiveProjectName is
// the prefix of the published archive URL the upgrade phase fetches;
// GoReleaser's `archives.name_template` derives the bucket-side filename
// from `ProjectName`. A silent drift between the Go constant and the
// goreleaser config reproduces the #656 bug class (URL-shape mismatch
// surfacing as a 404). The installer module has an equivalent test
// against the same yaml.
func TestArchiveProjectName_MatchesGoReleaserConfig(t *testing.T) {
	path := filepath.Join("..", "..", ".goreleaser.yaml")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	got := parseGoReleaserProjectName(t, b)
	if got != archiveProjectName {
		t.Fatalf("archiveProjectName = %q, goreleaser project_name = %q (must agree per #658)",
			archiveProjectName, got)
	}
}

var projectNameLineRE = regexp.MustCompile(`(?m)^project_name:\s*(\S+)\s*$`)

func parseGoReleaserProjectName(t *testing.T, yaml []byte) string {
	t.Helper()
	var live []string
	for _, line := range strings.Split(string(yaml), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		live = append(live, line)
	}
	m := projectNameLineRE.FindStringSubmatch(strings.Join(live, "\n"))
	if len(m) < 2 {
		t.Fatalf("could not find `project_name:` in goreleaser yaml")
	}
	return strings.Trim(m[1], `"'`)
}
