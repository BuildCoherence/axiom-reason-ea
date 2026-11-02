// Command template-merge checks that every released 1.x axiom-client
// template tag merges into the target tag with no conflict, using the same
// classifier `axm upgrade` runs in a Workspace. When the target tag does not
// exist yet it prints a warning and exits 0.
//
// Usage (from the repository root):
//
//	go run ./scripts/template-merge [-repo <git url or path>] [-target v2.0.0]
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
)

const templateRepo = "https://github.com/BuildCoherence/axiom-client.git"

// releasedTags are the 1.x template tags a Workspace can sit on.
var releasedTags = []string{
	"v1.0.0-beta", "v1.1.0-beta", "v1.1.1-beta", "v1.1.2-beta",
	"v1.1.3-beta", "v1.1.4-beta", "v1.1.5-beta", "v1.1.6-beta",
}

// errTargetMissing means the target tag is not published on the repository.
var errTargetMissing = errors.New("target tag is not on the template repository")

// Merge is one tag's merge into the target.
type Merge struct {
	Tag       string
	Conflicts []string
}

func main() {
	repo := flag.String("repo", templateRepo, "template repository to clone")
	target := flag.String("target", "v2.0.0", "tag every released tag must merge into")
	flag.Parse()
	os.Exit(run(context.Background(), *repo, *target, releasedTags, os.Stdout, os.Stderr))
}

func run(ctx context.Context, repo, target string, tags []string, stdout, stderr io.Writer) int {
	dir, err := os.MkdirTemp("", "template-merge-")
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "template-merge: %v\n", err)
		return 1
	}
	defer func() { _ = os.RemoveAll(dir) }()
	merges, err := Check(ctx, repo, dir, target, tags)
	if errors.Is(err, errTargetMissing) {
		_, _ = fmt.Fprintf(stdout, "::warning title=template-merge skipped::%s has no tag %s; no merge was checked\n", repo, target)
		return 0
	}
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "template-merge: %v\n", err)
		return 1
	}
	code := 0
	for _, m := range merges {
		if len(m.Conflicts) == 0 {
			_, _ = fmt.Fprintf(stdout, "%s -> %s: clean\n", m.Tag, target)
			continue
		}
		code = 1
		_, _ = fmt.Fprintf(stdout, "%s -> %s: CONFLICT in %s\n", m.Tag, target, strings.Join(m.Conflicts, ", "))
	}
	return code
}

// Check clones repo bare into dir and classifies the merge of each tag into target.
func Check(ctx context.Context, repo, dir, target string, tags []string) ([]Merge, error) {
	if err := git(ctx, "", "clone", "--quiet", "--bare", "--", repo, dir); err != nil {
		return nil, err
	}
	targetRef := "refs/tags/" + target
	if err := git(ctx, dir, "rev-parse", "--quiet", "--verify", targetRef+"^{commit}"); err != nil {
		return nil, fmt.Errorf("%s: %w", target, errTargetMissing)
	}
	merges := make([]Merge, 0, len(tags))
	for _, tag := range tags {
		if err := git(ctx, dir, "update-ref", "--no-deref", "HEAD", "refs/tags/"+tag+"^{commit}"); err != nil {
			return nil, fmt.Errorf("%s: %w", tag, err)
		}
		res, err := upgrade.ClassifyMerge(ctx, dir, targetRef)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", tag, err)
		}
		m := Merge{Tag: tag}
		for _, c := range res.Changes {
			if c.Outcome != upgrade.OutcomeClean && c.Outcome != upgrade.OutcomeCleanDelete {
				m.Conflicts = append(m.Conflicts, c.Path)
			}
		}
		merges = append(merges, m)
	}
	return merges, nil
}

func git(ctx context.Context, dir string, args ...string) error {
	if dir != "" {
		args = append([]string{"-C", dir}, args...)
	}
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}
