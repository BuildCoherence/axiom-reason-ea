package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

// Search Domain identifiers, also the subcommand names.
const (
	domainTypes     = "types"
	domainConstants = "constants"
	domainUsers     = "users"
	domainSource    = "source"
)

const (
	ansiBold  = "\x1b[1m"
	ansiReset = "\x1b[0m"
)

const searchJSONHelp = "--json prints one object: {query, domain, total, limit, offset, has_more, results}. " +
	"types, constants and users results are the matching search-index.json rows verbatim; " +
	"source results are {file_id, publisher, created_at, matches: [{line, text}]}."

// corpusContent reads one corpus file's bytes; tests count calls through it.
var corpusContent = (*corpus.Corpus).Content

func init() {
	rootCmd.AddCommand(newSearchCmd())
}

// newSearchCmd builds a fresh `search` tree so tests get fresh flag state.
func newSearchCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "search",
		Short: "Search the installed Published Corpus within a Search Domain",
		Long: "Search the installed Published Corpus within one Search Domain.\n\n" +
			"Pick a domain subcommand:\n" +
			"  types       type heads, by name\n" +
			"  constants   every declaration, by fully-qualified name\n" +
			"  users       exported users, by username\n" +
			"  source      corpus .lean file content (substring scan)\n\n" +
			"Matching is case-insensitive. To search several domains, run several commands. " +
			"Search reads only the local corpus; run `" + binaryName + " upgrade` if none is installed.\n\n" +
			searchJSONHelp,
		SilenceUsage: true,
	}
	addPagingFlags(c.PersistentFlags())
	c.PersistentFlags().String("sort", "created_at:desc",
		"ordering: <key>:<dir>; key ∈ {name, created_at}; dir ∈ {asc, desc}")

	c.AddCommand(
		newSearchDomainCmd(domainTypes, "types [<query>]",
			"Discover type heads by name",
			"Substring-match type heads by searchable name or type head. With no query, lists every type head.",
			cobra.MaximumNArgs(1),
			func(cmd *cobra.Command) { addAuthorDateFlags(cmd) }),
		newSearchDomainCmd(domainConstants, "constants [<query>]",
			"Discover declarations by fully-qualified name",
			"Substring-match every declaration (def / theorem / axiom / …) by name. With no query, lists every declaration.",
			cobra.MaximumNArgs(1),
			func(cmd *cobra.Command) {
				cmd.Flags().StringSlice("kind", nil,
					"filter to declaration kinds (repeatable or comma-separated; matches ANY)")
				addAuthorDateFlags(cmd)
			}),
		newSearchDomainCmd(domainUsers, "users [<query>]",
			"Discover exported users by username",
			"Substring-match exported users by username. --sort created_at orders by first publication; name orders by username.",
			cobra.MaximumNArgs(1),
			func(cmd *cobra.Command) {
				cmd.Flags().Bool("active-contributors", false, "not available in the local edition")
			}),
		newSearchDomainCmd(domainSource, "source <query>",
			"Scan corpus .lean file content",
			"Substring-scan the content of every corpus file and print each matching line. Sorts by created_at only.",
			cobra.ExactArgs(1),
			func(cmd *cobra.Command) { addAuthorDateFlags(cmd) }),
	)
	return c
}

func addAuthorDateFlags(cmd *cobra.Command) {
	cmd.Flags().String("author", "", "filter to a publisher username (leading @ optional)")
	cmd.Flags().String("created-after", "", "lower bound (inclusive): RFC3339 or YYYY-MM-DD")
	cmd.Flags().String("created-before", "", "upper bound (exclusive): RFC3339 or YYYY-MM-DD")
}

func newSearchDomainCmd(domain, use, short, long string, args cobra.PositionalArgs, addFlags func(*cobra.Command)) *cobra.Command {
	c := &cobra.Command{
		Use:          use,
		Short:        short,
		Long:         long + "\n\n" + searchJSONHelp,
		Args:         args,
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runSearchDomain(cmd, args, domain)
		},
	}
	addFlags(c)
	return c
}

func runSearchDomain(cmd *cobra.Command, args []string, domain string) error {
	if cmd.Flags().Changed("active-contributors") {
		return fmt.Errorf("--active-contributors is not available in the local edition: the published corpus records no contributor activity")
	}
	var query string
	if len(args) == 1 {
		query = args[0]
	}
	if domain == domainSource && query == "" {
		return fmt.Errorf("source search needs a non-empty query")
	}
	pg, err := parsePaging(cmd)
	if err != nil {
		return err
	}
	sortRaw, _ := cmd.Flags().GetString("sort")
	byName, desc, err := parseSearchSort(sortRaw)
	if err != nil {
		return err
	}
	if domain == domainSource && byName {
		return fmt.Errorf("source can only be sorted by created_at (got --sort %s)", sortRaw)
	}
	filters, err := parseSearchFilters(cmd)
	if err != nil {
		return err
	}

	pc, err := corpus.OpenInstalled()
	if err != nil {
		return err
	}
	out := cmd.OutOrStdout()
	if domain == domainSource {
		hits, err := scanSource(pc, query, filters, desc)
		if err != nil {
			return err
		}
		return emitSearch(out, pg, query, domain, hits, func(p page[sourceHit]) error {
			return renderSource(out, p, query, colorEnabled(out))
		})
	}

	idx, err := pc.SearchIndex()
	if err != nil {
		return err
	}
	q := strings.ToLower(query)
	switch domain {
	case domainTypes:
		rows := keep(idx.Types, func(r corpus.TypeHead) bool {
			return (containsFold(r.SearchableName, q) || containsFold(r.TypeHead, q)) &&
				filters.match(r.Kind, r.Publisher, r.CreatedAt)
		})
		sortRows(rows, byName, desc, func(r corpus.TypeHead) string { return r.SearchableName },
			func(r corpus.TypeHead) time.Time { return timeOrZero(r.CreatedAt) })
		return emitSearch(out, pg, query, domain, rows, func(p page[corpus.TypeHead]) error { return renderTypes(out, p) })
	case domainConstants:
		rows := keep(idx.Constants, func(r corpus.Constant) bool {
			return containsFold(r.Name, q) && filters.match(&r.Kind, r.Publisher, &r.CreatedAt)
		})
		sortRows(rows, byName, desc, func(r corpus.Constant) string { return r.Name },
			func(r corpus.Constant) time.Time { return r.CreatedAt })
		return emitSearch(out, pg, query, domain, rows, func(p page[corpus.Constant]) error { return renderConstants(out, "CONSTANTS", p) })
	case domainUsers:
		rows := keep(idx.Users, func(r corpus.User) bool { return containsFold(r.Username, q) })
		sortRows(rows, byName, desc, func(r corpus.User) string { return r.Username },
			func(r corpus.User) time.Time { return timeOrZero(r.FirstPublishedAt) })
		return emitSearch(out, pg, query, domain, rows, func(p page[corpus.User]) error { return renderUsers(out, p) })
	default:
		return fmt.Errorf("unknown domain %q", domain)
	}
}

// paging holds the shared --limit / --offset / --json values.
type paging struct {
	limit, offset int
	json          bool
}

type flagAdder interface {
	Int(name string, value int, usage string) *int
	Bool(name string, value bool, usage string) *bool
}

func addPagingFlags(fs flagAdder) {
	fs.Int("limit", 20, "max rows to return (1..100)")
	fs.Int("offset", 0, "rows to skip (>=0)")
	fs.Bool("json", false, "emit the matching rows as JSON (shape in the command help)")
}

func parsePaging(cmd *cobra.Command) (paging, error) {
	limit, _ := cmd.Flags().GetInt("limit")
	if limit < 1 || limit > 100 {
		return paging{}, fmt.Errorf("--limit must be between 1 and 100 (got %d)", limit)
	}
	offset, _ := cmd.Flags().GetInt("offset")
	if offset < 0 {
		return paging{}, fmt.Errorf("--offset must be non-negative (got %d)", offset)
	}
	jsonMode, _ := cmd.Flags().GetBool("json")
	return paging{limit: limit, offset: offset, json: jsonMode}, nil
}

// parseSearchSort parses "<key>:<dir>" with key name or created_at.
func parseSearchSort(raw string) (byName, desc bool, err error) {
	k, d, ok := strings.Cut(raw, ":")
	if !ok || k == "" || d == "" {
		return false, false, fmt.Errorf("--sort must be <key>:<dir> (e.g. created_at:desc)")
	}
	if k != "name" && k != "created_at" {
		return false, false, fmt.Errorf("--sort key must be name or created_at (got %q)", k)
	}
	if d != "asc" && d != "desc" {
		return false, false, fmt.Errorf("--sort dir must be asc or desc (got %q)", d)
	}
	return k == "name", d == "desc", nil
}

// searchFilters holds the domain knobs; an unregistered knob stays zero.
type searchFilters struct {
	kinds  map[string]bool
	author string
	after  *time.Time
	before *time.Time
}

func parseSearchFilters(cmd *cobra.Command) (searchFilters, error) {
	var f searchFilters
	if kinds, _ := cmd.Flags().GetStringSlice("kind"); len(kinds) > 0 {
		f.kinds = make(map[string]bool, len(kinds))
		for _, k := range kinds {
			f.kinds[strings.TrimSpace(k)] = true
		}
	}
	author, _ := cmd.Flags().GetString("author")
	f.author = strings.ToLower(strings.TrimPrefix(author, "@"))
	var err error
	if f.after, err = parseDateFlag(cmd, "created-after"); err != nil {
		return f, err
	}
	if f.before, err = parseDateFlag(cmd, "created-before"); err != nil {
		return f, err
	}
	return f, nil
}

func parseDateFlag(cmd *cobra.Command, name string) (*time.Time, error) {
	raw, _ := cmd.Flags().GetString(name)
	if raw == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return &t, nil
	}
	if t, err := time.Parse(time.DateOnly, raw); err == nil {
		return &t, nil
	}
	return nil, fmt.Errorf("--%s must be RFC3339 or YYYY-MM-DD (got %q)", name, raw)
}

// match reports whether a row passes every set filter. A row without a
// publisher or date fails the corresponding filter.
func (f searchFilters) match(kind, publisher *string, at *time.Time) bool {
	if f.kinds != nil && (kind == nil || !f.kinds[*kind]) {
		return false
	}
	if f.author != "" && (publisher == nil || strings.ToLower(*publisher) != f.author) {
		return false
	}
	if f.after != nil && (at == nil || at.Before(*f.after)) {
		return false
	}
	if f.before != nil && (at == nil || !at.Before(*f.before)) {
		return false
	}
	return true
}

func keep[T any](rows []T, pred func(T) bool) []T {
	kept := make([]T, 0, len(rows))
	for _, r := range rows {
		if pred(r) {
			kept = append(kept, r)
		}
	}
	return kept
}

// sortRows orders rows by name (case-insensitive) or time; ties keep index order.
func sortRows[T any](rows []T, byName, desc bool, name func(T) string, at func(T) time.Time) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if desc {
			a, b = b, a
		}
		if byName {
			return strings.ToLower(name(a)) < strings.ToLower(name(b))
		}
		return at(a).Before(at(b))
	})
}

func containsFold(s, lowerQuery string) bool {
	return strings.Contains(strings.ToLower(s), lowerQuery)
}

func timeOrZero(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

// page is one --limit/--offset window over a sorted result set.
type page[T any] struct {
	Total   int  `json:"total"`
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"has_more"`
	Results []T  `json:"results"`
}

func paginate[T any](rows []T, pg paging) page[T] {
	start := min(pg.offset, len(rows))
	end := min(start+pg.limit, len(rows))
	results := make([]T, end-start)
	copy(results, rows[start:end])
	return page[T]{Total: len(rows), Limit: pg.limit, Offset: pg.offset, HasMore: end < len(rows), Results: results}
}

func emitSearch[T any](out io.Writer, pg paging, query, domain string, rows []T, render func(page[T]) error) error {
	p := paginate(rows, pg)
	if pg.json {
		return writeJSONOut(out, struct {
			Query  string `json:"query"`
			Domain string `json:"domain"`
			page[T]
		}{query, domain, p})
	}
	return render(p)
}

func writeJSONOut(out io.Writer, v any) error {
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// sourceHit is one corpus file whose content contains the query.
type sourceHit struct {
	FileID    string       `json:"file_id"`
	Publisher *string      `json:"publisher"`
	CreatedAt time.Time    `json:"created_at"`
	Matches   []sourceLine `json:"matches"`
}

type sourceLine struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

// scanSource filters corpus files by publisher and date before reading any
// content, then reads each remaining file exactly once.
func scanSource(pc *corpus.Corpus, query string, filters searchFilters, desc bool) ([]sourceHit, error) {
	files := keep(pc.Files(), func(f corpus.File) bool { return filters.match(nil, f.Publisher, &f.PublishedAt) })
	sortRows(files, false, desc, func(f corpus.File) string { return f.ID },
		func(f corpus.File) time.Time { return f.PublishedAt })
	var hits []sourceHit
	for _, f := range files {
		content, err := corpusContent(pc, f.ID)
		if err != nil {
			return nil, fmt.Errorf("reading %s from the corpus: %w", f.ID, err)
		}
		var matches []sourceLine
		for i, line := range strings.Split(string(content), "\n") {
			if asciiIndexFold(line, query) >= 0 {
				matches = append(matches, sourceLine{Line: i + 1, Text: line})
			}
		}
		if len(matches) > 0 {
			hits = append(hits, sourceHit{FileID: f.ID, Publisher: f.Publisher, CreatedAt: f.PublishedAt, Matches: matches})
		}
	}
	return hits, nil
}

// ── Rendering ────────────────────────────────────────────────────────────

func renderTypes(out io.Writer, p page[corpus.TypeHead]) error {
	if !writeSectionHeader(out, "TYPE HEADS", p.Total, p.Offset, len(p.Results)) {
		return nil
	}
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "searchable_name\ttype_head\tarity\tauthor\tcreated_at\tfile_id")
	for _, r := range p.Results {
		author := "platform"
		if r.FileID != nil {
			author = stringOr(r.Publisher, "—")
		}
		fmt.Fprintf(tw, "%s\t%s\t%d\t%s\t%s\t%s\n",
			r.SearchableName, r.TypeHead, r.Arity, author, humanDate(timeOrZero(r.CreatedAt)), stringOr(r.FileID, ""))
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	writeContinuation(out, p.Total, p.Offset, len(p.Results))
	return nil
}

func renderConstants(out io.Writer, label string, p page[corpus.Constant]) error {
	if !writeSectionHeader(out, label, p.Total, p.Offset, len(p.Results)) {
		return nil
	}
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "name\tkind\tauthor\tcreated_at\tfile_id")
	for _, r := range p.Results {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
			r.Name, r.Kind, stringOr(r.Publisher, "—"), humanDate(r.CreatedAt), r.FileID)
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	writeContinuation(out, p.Total, p.Offset, len(p.Results))
	return nil
}

func renderUsers(out io.Writer, p page[corpus.User]) error {
	if !writeSectionHeader(out, "USERS", p.Total, p.Offset, len(p.Results)) {
		return nil
	}
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "username\tfirst_published_at")
	for _, r := range p.Results {
		first := "—"
		if r.FirstPublishedAt != nil {
			first = humanDate(*r.FirstPublishedAt)
		}
		fmt.Fprintf(tw, "%s\t%s\n", r.Username, first)
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	writeContinuation(out, p.Total, p.Offset, len(p.Results))
	return nil
}

// renderSource prints ripgrep-style blocks: a file header, then each matching
// line with its line number.
func renderSource(out io.Writer, p page[sourceHit], query string, useColor bool) error {
	if !writeSectionHeader(out, "SOURCE", p.Total, p.Offset, len(p.Results)) {
		return nil
	}
	for _, r := range p.Results {
		fmt.Fprintln(out)
		handle := "(unattributed)"
		if r.Publisher != nil {
			handle = "@" + *r.Publisher
		}
		fmt.Fprintf(out, "%s · %s · %s\n", r.FileID, handle, humanDate(r.CreatedAt))
		for _, m := range r.Matches {
			fmt.Fprintf(out, "    %d: %s\n", m.Line, emphasize(m.Text, query, useColor))
		}
	}
	writeContinuation(out, p.Total, p.Offset, len(p.Results))
	return nil
}

// writeSectionHeader prints "LABEL  (start-end of total)" and reports whether
// the page has rows; an empty page prints why instead.
func writeSectionHeader(out io.Writer, label string, total, offset, n int) bool {
	if n == 0 {
		if total == 0 {
			fmt.Fprintln(out, "(no matches)")
		} else {
			fmt.Fprintf(out, "(no rows at --offset %d; %d total)\n", offset, total)
		}
		return false
	}
	fmt.Fprintf(out, "%s  (%d-%d of %d)\n", label, offset+1, offset+n, total)
	return true
}

func writeContinuation(out io.Writer, total, offset, n int) {
	if offset+n < total {
		fmt.Fprintf(out, "-- showing %d of %d; --offset %d for more\n", n, total, offset+n)
	}
}

func stringOr(p *string, fallback string) string {
	if p == nil {
		return fallback
	}
	return *p
}

// humanDate renders a time as "Jun 18, 2026"; the zero time renders empty.
func humanDate(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("Jan 2, 2006")
}

// emphasize bolds every ASCII-case-insensitive occurrence of q in line when
// color is enabled. It scans the original bytes so slicing stays in range on
// Unicode Lean source.
func emphasize(line, q string, useColor bool) string {
	if !useColor || q == "" {
		return line
	}
	var b strings.Builder
	for {
		j := asciiIndexFold(line, q)
		if j < 0 {
			b.WriteString(line)
			break
		}
		b.WriteString(line[:j])
		b.WriteString(ansiBold)
		b.WriteString(line[j : j+len(q)])
		b.WriteString(ansiReset)
		line = line[j+len(q):]
	}
	return b.String()
}

// asciiIndexFold returns the byte index of the first ASCII-case-insensitive
// occurrence of sub in s, or -1. Non-ASCII bytes compare exactly.
func asciiIndexFold(s, sub string) int {
	if sub == "" {
		return -1
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		match := true
		for k := 0; k < len(sub); k++ {
			if lowerASCII(s[i+k]) != lowerASCII(sub[k]) {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func lowerASCII(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + 32
	}
	return c
}

// colorEnabled is off when NO_COLOR or CI is set or out is not a terminal.
func colorEnabled(out io.Writer) bool {
	if os.Getenv("NO_COLOR") != "" || os.Getenv("CI") != "" {
		return false
	}
	f, ok := out.(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}
