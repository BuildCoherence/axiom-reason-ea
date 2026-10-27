package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const scopeRepo = "o/r"

// fakeGH serves gh api calls from canned pages and fails on anything unexpected.
type fakeGH struct {
	t        *testing.T
	rest     map[string]string
	edits    map[string]string // node id -> first userContentEdits page JSON
	more     map[string]string // node id -> next page JSON (after its first cursor)
	graphqls int
}

var idsPattern = regexp.MustCompile(`nodes\(ids: (\[[^\]]*\])\)`)
var nodePattern = regexp.MustCompile(`node\(id: ("[^"]*")\)`)

func (f *fakeGH) run(args []string) ([]byte, error) {
	if len(args) >= 4 && args[0] == "api" && args[1] == "graphql" && args[2] == "-f" {
		f.graphqls++
		query := strings.TrimPrefix(args[3], "query=")
		if m := idsPattern.FindStringSubmatch(query); m != nil {
			var ids []string
			if err := json.Unmarshal([]byte(m[1]), &ids); err != nil {
				return nil, err
			}
			var nodes []string
			for _, id := range ids {
				page, ok := f.edits[id]
				if !ok {
					page = `{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}`
				}
				nodes = append(nodes, fmt.Sprintf(`{"id":%q,"userContentEdits":%s}`, id, page))
			}
			return []byte(`{"data":{"nodes":[` + strings.Join(nodes, ",") + `]}}`), nil
		}
		if m := nodePattern.FindStringSubmatch(query); m != nil && strings.Contains(query, `after: "c1"`) {
			var id string
			_ = json.Unmarshal([]byte(m[1]), &id)
			if page, ok := f.more[id]; ok {
				return []byte(`{"data":{"node":{"userContentEdits":` + page + `}}}`), nil
			}
		}
		f.t.Errorf("unexpected graphql query %q", query)
		return nil, fmt.Errorf("unexpected graphql query")
	}
	if len(args) == 3 && args[0] == "api" && args[1] == "--paginate" {
		if body, ok := f.rest[args[2]]; ok {
			return []byte(body), nil
		}
	}
	f.t.Errorf("unexpected gh call %q", args)
	return nil, fmt.Errorf("unexpected gh call %q", args)
}

func ep(rest string) string { return "repos/" + scopeRepo + "/" + rest }

// scopeFixture builds an origin with a hit only in refs/pull/1/head, a hit
// only in a commit no ref reaches (a force-push before SHA), and a hit in a
// tag name; then clones it the way the S2e operator would.
func scopeFixture(t *testing.T) (clone, mainSHA, pullSHA, beforeSHA string) {
	requireGit(t)
	base := t.TempDir()
	origin := filepath.Join(base, "origin.git")
	git(t, base, "init", "-q", "--bare", "-b", "main", origin)
	git(t, origin, "config", "uploadpack.allowAnySHA1InWant", "true")

	seed := initRepo(t)
	writeFile(t, seed, "README.md", "clean\n")
	mainSHA = commitAll(t, seed, "clean")
	git(t, seed, "remote", "add", "origin", origin)
	git(t, seed, "push", "-q", "origin", "main")
	git(t, seed, "tag", "v0-zebra-leak")
	git(t, seed, "push", "-q", "origin", "v0-zebra-leak")

	git(t, seed, "checkout", "-q", "-b", "pr")
	writeFile(t, seed, "pr.txt", "zebra-leak\n")
	pullSHA = commitAll(t, seed, "pr only")
	git(t, seed, "push", "-q", "origin", "HEAD:refs/pull/1/head")

	git(t, seed, "checkout", "-q", "-b", "tmp", "main")
	writeFile(t, seed, "forced.txt", "quokka/private\n")
	beforeSHA = commitAll(t, seed, "later force-pushed away")
	git(t, seed, "push", "-q", "origin", "tmp")
	git(t, seed, "push", "-q", "origin", ":tmp")

	clone = filepath.Join(base, "clone")
	git(t, base, "clone", "-q", origin, clone)
	return clone, mainSHA, pullSHA, beforeSHA
}

func scopeGH(t *testing.T, beforeSHA string, artifacts int) *fakeGH {
	edit := func(diff string) string { return fmt.Sprintf(`{"diff":%q}`, diff) }
	return &fakeGH{
		t: t,
		rest: map[string]string{
			ep("activity?per_page=100"): `[{"id":10,"before":"` + zeroSHA + `","ref":"refs/heads/main","activity_type":"push"}]` +
				`[{"id":11,"before":"` + beforeSHA + `","ref":"refs/heads/old-zebra-leak","activity_type":"force_push"}]`,
			// Two pages, as gh --paginate prints them.
			ep("issues?state=all&per_page=100"): `[{"number":2,"node_id":"I2","title":"zebra-leak in title","body":"clean"},` +
				`{"number":1,"node_id":"PRI1","title":"pr","body":"","pull_request":{}}]` +
				`[{"number":3,"node_id":"I3","title":"clean","body":"body has Quokka/Private"}]`,
			ep("pulls?state=all&per_page=100"):   `[{"number":1,"node_id":"PR1","title":"clean","body":"clean","head":{"ref":"feature/zebra-leak"}}]`,
			ep("pulls/1/reviews?per_page=100"):   `[{"id":401,"node_id":"R401","body":"review says zebra-leak"}]`,
			ep("issues/comments?per_page=100"):   `[{"id":101,"node_id":"C101","body":"zebra-leak"},{"id":102,"node_id":"C102","body":"edited to clean"}]`,
			ep("pulls/comments?per_page=100"):    `[{"id":201,"node_id":"RC201","body":"inline quokka/private"}]`,
			ep("comments?per_page=100"):          `[{"id":301,"node_id":"CC301","body":"commit comment zebra-leak"}]`,
			ep("issues/events?per_page=100"):     `[{"id":501,"event":"renamed","rename":{"from":"old zebra-leak title","to":"clean"},"issue":{"number":2}},{"id":502,"event":"labeled","issue":{"number":2}}]`,
			ep("actions/runs?per_page=100"):      `{"total_count":0,"workflow_runs":[]}`,
			ep("actions/artifacts?per_page=100"): fmt.Sprintf(`{"total_count":%d,"artifacts":[]}`, artifacts),
		},
		edits: map[string]string{
			"C102": `{"pageInfo":{"hasNextPage":false,"endCursor":"c1"},"nodes":[` + edit("edited to clean") + `,` + edit("first draft named zebra-leak") + `]}`,
			"PR1":  `{"pageInfo":{"hasNextPage":true,"endCursor":"c1"},"nodes":[` + edit("clean") + `]}`,
		},
		more: map[string]string{
			"PR1": `{"pageInfo":{"hasNextPage":false,"endCursor":"c2"},"nodes":[` + edit("older body: Quokka/Private") + `]}`,
		},
	}
}

func ghRunner(gh *fakeGH) runner {
	real := execRunner()
	return func(ctx context.Context, dir, name string, args ...string) ([]byte, error) {
		if name == "gh" {
			return gh.run(args)
		}
		return real(ctx, dir, name, args...)
	}
}

func TestScopeReportsAHitInEveryInputClass(t *testing.T) {
	clone, mainSHA, pullSHA, beforeSHA := scopeFixture(t)
	gh := scopeGH(t, beforeSHA, 2)
	r := runGate(t, map[string]string{denyVar: testPatterns}, ghRunner(gh), "-root", clone, "-legs", "deny", "-scope", scopeRepo)
	if r.code != exitBlock {
		t.Fatalf("exit %d, want %d\n%s%s", r.code, exitBlock, r.stdout, r.stderr)
	}
	for _, want := range []string{
		// Class 1: git objects reachable only from a pull ref or a force-push before SHA.
		"deny-history " + pullSHA + ":pr.txt pattern#1",
		"deny-history " + beforeSHA + ":forced.txt pattern#2",
		// Class 1: ref, tag, activity and PR head names.
		"deny-scope ref-to " + mainSHA + ":1 pattern#1",
		"deny-scope activity/11 ref:1 pattern#1",
		"deny-scope pr#1 headRefName:1 pattern#1",
		// Class 2: issue, PR, review, comment text, old titles and prior revisions.
		"deny-scope issue#2 title:1 pattern#1",
		"deny-scope issue#3 body:1 pattern#2",
		"deny-scope pr#1 review/401:1 pattern#1",
		"deny-scope issue-comment/101:1 pattern#1",
		"deny-scope review-comment/201:1 pattern#2",
		"deny-scope commit-comment/301:1 pattern#1",
		"deny-scope #2 renamed/501 from:1 pattern#1",
		"deny-scope issue-comment/102 edit/2:1 pattern#1",
		"deny-scope pr#1 body edit/2:1 pattern#2",
		// Class 3 must be deleted before the flip.
		"scope actions/artifacts not-empty:2",
	} {
		r.has(t, want)
	}
	if strings.Contains(r.stdout, "issue-comment/102:") {
		t.Errorf("clean current body of an edited comment reported:\n%s", r.stdout)
	}
	if gh.graphqls != 2 {
		t.Errorf("graphql calls = %d, want 2 (one nodes batch, one edits page)", gh.graphqls)
	}
	r.noPatternEcho(t)
}

func TestScopeCleanRepositoryPasses(t *testing.T) {
	requireGit(t)
	base := t.TempDir()
	origin := filepath.Join(base, "origin.git")
	git(t, base, "init", "-q", "--bare", "-b", "main", origin)
	seed := initRepo(t)
	writeFile(t, seed, "README.md", "clean\n")
	commitAll(t, seed, "clean")
	git(t, seed, "remote", "add", "origin", origin)
	git(t, seed, "push", "-q", "origin", "main")
	clone := filepath.Join(base, "clone")
	git(t, base, "clone", "-q", origin, clone)

	gh := &fakeGH{t: t, rest: map[string]string{}}
	for _, e := range []string{"activity", "issues?state=all", "pulls?state=all", "issues/comments", "pulls/comments", "comments", "issues/events"} {
		sep := "?"
		if strings.Contains(e, "?") {
			sep = "&"
		}
		gh.rest[ep(e+sep+"per_page=100")] = `[]`
	}
	gh.rest[ep("actions/runs?per_page=100")] = `{"total_count":0,"workflow_runs":[]}`
	gh.rest[ep("actions/artifacts?per_page=100")] = `{"total_count":0,"artifacts":[]}`
	r := runGate(t, map[string]string{denyVar: testPatterns}, ghRunner(gh), "-root", clone, "-legs", "deny", "-scope", scopeRepo)
	if r.code != exitPass {
		t.Fatalf("exit %d, want %d\n%s%s", r.code, exitPass, r.stdout, r.stderr)
	}
}

func TestScopeUnfetchableBeforeSHABlocks(t *testing.T) {
	clone, _, _, _ := scopeFixture(t)
	gh := scopeGH(t, strings.Repeat("ab", 20), 0)
	r := runGate(t, map[string]string{denyVar: testPatterns}, ghRunner(gh), "-root", clone, "-legs", "deny", "-scope", scopeRepo)
	if r.code != exitBlock {
		t.Fatalf("exit %d, want %d\n%s%s", r.code, exitBlock, r.stdout, r.stderr)
	}
	r.has(t, "scope activity-before "+strings.Repeat("ab", 20)+" unfetchable")
}
