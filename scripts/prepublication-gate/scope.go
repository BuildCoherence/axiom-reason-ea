package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

const (
	// GitHub caps nodes(ids:) and connection pages at 100.
	graphqlBatch = 100
	prepubRefs   = "refs/prepub/"
	zeroSHA      = "0000000000000000000000000000000000000000"
)

var scopeFetchRefspecs = []string{
	"+refs/heads/*:" + prepubRefs + "heads/*",
	"+refs/tags/*:" + prepubRefs + "tags/*",
	"+refs/pull/*/head:" + prepubRefs + "pull/*",
}

type scopeText struct{ label, text string }

// scopeInputs holds the text inputs (class 2 and every ref name) the deny and
// gitleaks legs scan; the class 1 git objects are fetched into the clone,
// under refs/prepub/, where the history scans reach them through --all.
type scopeInputs struct{ texts []scopeText }

func (s *scopeInputs) add(label, text string) {
	if text != "" {
		s.texts = append(s.texts, scopeText{label, text})
	}
}

type collector struct {
	ctx   context.Context
	run   runner
	root  string
	repo  string
	in    *scopeInputs
	found []finding
	// nodes maps a GraphQL node id to the label of the text it owns, for its edit history.
	nodes map[string]string
	order []string
}

func collectScope(ctx context.Context, run runner, root, repo string) (*scopeInputs, []finding, error) {
	c := &collector{ctx: ctx, run: run, root: root, repo: repo, in: &scopeInputs{}, nodes: map[string]string{}}
	steps := []func() error{
		c.gitObjects, c.issues, c.pulls, c.comments, c.renames, c.edits, c.actionsEmpty,
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return nil, nil, err
		}
	}
	return c.in, c.found, nil
}

func (c *collector) node(id, label string) {
	if id == "" {
		return
	}
	if _, seen := c.nodes[id]; !seen {
		c.order = append(c.order, id)
	}
	c.nodes[id] = label
}

func (c *collector) git(args ...string) ([]byte, error) {
	return c.run(c.ctx, c.root, "git", args...)
}

// ghList pages through a REST collection with gh api --paginate and returns every element.
func (c *collector) ghList(endpoint string) ([]json.RawMessage, error) {
	pages, err := c.ghPages(endpoint)
	if err != nil {
		return nil, err
	}
	var items []json.RawMessage
	for _, page := range pages {
		var elems []json.RawMessage
		if err := json.Unmarshal(page, &elems); err != nil {
			return nil, fmt.Errorf("%s: page is not an array: %w", endpoint, err)
		}
		items = append(items, elems...)
	}
	return items, nil
}

// ghPages returns each page gh api --paginate printed; gh concatenates page bodies on stdout.
func (c *collector) ghPages(endpoint string) ([]json.RawMessage, error) {
	out, err := c.run(c.ctx, c.root, "gh", "api", "--paginate", endpoint)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(out))
	var pages []json.RawMessage
	for {
		var page json.RawMessage
		if err := dec.Decode(&page); errors.Is(err, io.EOF) {
			return pages, nil
		} else if err != nil {
			return nil, fmt.Errorf("%s: %w", endpoint, err)
		}
		pages = append(pages, page)
	}
}

func (c *collector) repoPath(rest string) string {
	sep := "?"
	if strings.Contains(rest, "?") {
		sep = "&"
	}
	return "repos/" + c.repo + "/" + rest + sep + "per_page=100"
}

// gitObjects fetches every branch, tag, pull head and activity before-SHA into
// refs/prepub/ and records every ref name, including deleted refs from the activity listing.
func (c *collector) gitObjects() error {
	remote, err := c.git("ls-remote", "origin")
	if err != nil {
		return err
	}
	for line := range strings.Lines(string(remote)) {
		if sha, name, ok := strings.Cut(strings.TrimSpace(line), "\t"); ok {
			c.in.add("ref-to "+sha, name)
		}
	}
	if _, err := c.git(append([]string{"fetch", "--quiet", "--no-tags", "origin"}, scopeFetchRefspecs...)...); err != nil {
		return err
	}
	activity, err := c.ghList(c.repoPath("activity"))
	if err != nil {
		return err
	}
	for _, raw := range activity {
		var a struct {
			ID           int64  `json:"id"`
			Before       string `json:"before"`
			Ref          string `json:"ref"`
			ActivityType string `json:"activity_type"`
		}
		if err := json.Unmarshal(raw, &a); err != nil {
			return fmt.Errorf("activity: %w", err)
		}
		c.in.add("activity/"+strconv.FormatInt(a.ID, 10)+" ref", a.Ref)
		if (a.ActivityType == "force_push" || a.ActivityType == "branch_deletion") && a.Before != "" && a.Before != zeroSHA {
			if err := c.pinBefore(a.Before); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *collector) pinBefore(sha string) error {
	if _, err := c.git("cat-file", "-e", sha+"^{commit}"); err != nil {
		if _, err := c.git("fetch", "--quiet", "--no-tags", "origin", sha); err != nil {
			c.found = append(c.found, finding{"scope", "activity-before " + sha, "unfetchable"})
			return nil
		}
	}
	_, err := c.git("update-ref", prepubRefs+"before/"+sha, sha)
	return err
}

type textItem struct {
	ID     int64                `json:"id"`
	NodeID string               `json:"node_id"`
	Number int                  `json:"number"`
	Title  string               `json:"title"`
	Body   string               `json:"body"`
	PR     json.RawMessage      `json:"pull_request"`
	Head   struct{ Ref string } `json:"head"`
}

func (c *collector) issues() error {
	items, err := c.ghList(c.repoPath("issues?state=all"))
	if err != nil {
		return err
	}
	for _, raw := range items {
		var it textItem
		if err := json.Unmarshal(raw, &it); err != nil {
			return fmt.Errorf("issues: %w", err)
		}
		if it.PR != nil {
			continue // a PR; pulls() reads it
		}
		label := "issue#" + strconv.Itoa(it.Number)
		c.in.add(label+" title", it.Title)
		c.in.add(label+" body", it.Body)
		c.node(it.NodeID, label+" body")
	}
	return nil
}

func (c *collector) pulls() error {
	items, err := c.ghList(c.repoPath("pulls?state=all"))
	if err != nil {
		return err
	}
	for _, raw := range items {
		var it textItem
		if err := json.Unmarshal(raw, &it); err != nil {
			return fmt.Errorf("pulls: %w", err)
		}
		label := "pr#" + strconv.Itoa(it.Number)
		c.in.add(label+" title", it.Title)
		c.in.add(label+" body", it.Body)
		c.in.add(label+" headRefName", it.Head.Ref)
		c.node(it.NodeID, label+" body")
		reviews, err := c.ghList(c.repoPath("pulls/" + strconv.Itoa(it.Number) + "/reviews"))
		if err != nil {
			return err
		}
		for _, raw := range reviews {
			var r textItem
			if err := json.Unmarshal(raw, &r); err != nil {
				return fmt.Errorf("reviews: %w", err)
			}
			rl := label + " review/" + strconv.FormatInt(r.ID, 10)
			c.in.add(rl, r.Body)
			c.node(r.NodeID, rl)
		}
	}
	return nil
}

func (c *collector) comments() error {
	for _, kind := range []struct{ endpoint, label string }{
		{"issues/comments", "issue-comment/"},
		{"pulls/comments", "review-comment/"},
		{"comments", "commit-comment/"},
	} {
		items, err := c.ghList(c.repoPath(kind.endpoint))
		if err != nil {
			return err
		}
		for _, raw := range items {
			var it textItem
			if err := json.Unmarshal(raw, &it); err != nil {
				return fmt.Errorf("%s: %w", kind.endpoint, err)
			}
			label := kind.label + strconv.FormatInt(it.ID, 10)
			c.in.add(label, it.Body)
			c.node(it.NodeID, label)
		}
	}
	return nil
}

// renames records every old and new title from renamed events, for issues and PRs alike.
func (c *collector) renames() error {
	events, err := c.ghList(c.repoPath("issues/events"))
	if err != nil {
		return err
	}
	for _, raw := range events {
		var ev struct {
			ID     int64  `json:"id"`
			Event  string `json:"event"`
			Rename *struct {
				From string `json:"from"`
				To   string `json:"to"`
			} `json:"rename"`
			Issue struct {
				Number int `json:"number"`
			} `json:"issue"`
		}
		if err := json.Unmarshal(raw, &ev); err != nil {
			return fmt.Errorf("issues/events: %w", err)
		}
		if ev.Event != "renamed" || ev.Rename == nil {
			continue
		}
		label := "#" + strconv.Itoa(ev.Issue.Number) + " renamed/" + strconv.FormatInt(ev.ID, 10)
		c.in.add(label+" from", ev.Rename.From)
		c.in.add(label+" to", ev.Rename.To)
	}
	return nil
}

type editsPage struct {
	PageInfo struct {
		HasNextPage bool   `json:"hasNextPage"`
		EndCursor   string `json:"endCursor"`
	} `json:"pageInfo"`
	Nodes []struct {
		Diff *string `json:"diff"`
	} `json:"nodes"`
}

const editsFields = `userContentEdits(first: 100%s) { pageInfo { hasNextPage endCursor } nodes { diff } }`

// edits reads every prior revision (userContentEdits) of every collected issue, PR, review and comment.
func (c *collector) edits() error {
	for start := 0; start < len(c.order); start += graphqlBatch {
		ids := c.order[start:min(start+graphqlBatch, len(c.order))]
		quoted, _ := json.Marshal(ids)
		query := fmt.Sprintf(`query { nodes(ids: %s) { id ... on UserContentEditable { %s } } }`, quoted, fmt.Sprintf(editsFields, ""))
		var resp struct {
			Data struct {
				Nodes []*struct {
					ID               string     `json:"id"`
					UserContentEdits *editsPage `json:"userContentEdits"`
				} `json:"nodes"`
			} `json:"data"`
		}
		if err := c.graphql(query, &resp); err != nil {
			return err
		}
		for _, n := range resp.Data.Nodes {
			if n == nil || n.UserContentEdits == nil {
				continue
			}
			k, err := c.addEdits(n.ID, n.UserContentEdits, 0)
			if err != nil {
				return err
			}
			for page := n.UserContentEdits; page.PageInfo.HasNextPage; {
				if page, err = c.moreEdits(n.ID, page.PageInfo.EndCursor); err != nil {
					return err
				}
				if k, err = c.addEdits(n.ID, page, k); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func (c *collector) moreEdits(id, cursor string) (*editsPage, error) {
	qid, _ := json.Marshal(id)
	qcur, _ := json.Marshal(cursor)
	query := fmt.Sprintf(`query { node(id: %s) { ... on UserContentEditable { %s } } }`, qid, fmt.Sprintf(editsFields, ", after: "+string(qcur)))
	var resp struct {
		Data struct {
			Node *struct {
				UserContentEdits *editsPage `json:"userContentEdits"`
			} `json:"node"`
		} `json:"data"`
	}
	if err := c.graphql(query, &resp); err != nil {
		return nil, err
	}
	if resp.Data.Node == nil || resp.Data.Node.UserContentEdits == nil {
		return nil, fmt.Errorf("graphql: node %s vanished while paging its edits", id)
	}
	return resp.Data.Node.UserContentEdits, nil
}

func (c *collector) addEdits(id string, page *editsPage, k int) (int, error) {
	label, ok := c.nodes[id]
	if !ok {
		return k, fmt.Errorf("graphql: unexpected node %s", id)
	}
	for _, e := range page.Nodes {
		k++
		if e.Diff != nil {
			c.in.add(label+" edit/"+strconv.Itoa(k), *e.Diff)
		}
	}
	return k, nil
}

func (c *collector) graphql(query string, into any) error {
	out, err := c.run(c.ctx, c.root, "gh", "api", "graphql", "-f", "query="+query)
	if err != nil {
		return err
	}
	var probe struct {
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(out, &probe); err != nil {
		return fmt.Errorf("graphql: %w", err)
	}
	if len(probe.Errors) > 0 {
		return fmt.Errorf("graphql: %s", probe.Errors[0].Message)
	}
	return json.Unmarshal(out, into)
}

// actionsEmpty checks that every Actions run, with its logs and artifacts, was deleted before the flip.
func (c *collector) actionsEmpty() error {
	for _, kind := range []string{"actions/runs", "actions/artifacts"} {
		pages, err := c.ghPages(c.repoPath(kind))
		if err != nil {
			return err
		}
		for _, page := range pages {
			var p struct {
				TotalCount int `json:"total_count"`
			}
			if err := json.Unmarshal(page, &p); err != nil {
				return fmt.Errorf("%s: %w", kind, err)
			}
			if p.TotalCount > 0 {
				c.found = append(c.found, finding{"scope", kind, "not-empty:" + strconv.Itoa(p.TotalCount)})
				break
			}
		}
	}
	return nil
}
