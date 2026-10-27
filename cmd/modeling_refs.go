package cmd

import (
	"fmt"
	"io"
	"strings"
	"text/tabwriter"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/spf13/cobra"
)

// Category values in modeling-refs.json.
const (
	categoryConvention = "convention"
	categoryExample    = "example"
)

func init() {
	rootCmd.AddCommand(newModelingRefsCmd())
}

// newModelingRefsCmd builds a fresh `modeling-refs` command so tests get fresh flag state.
func newModelingRefsCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "modeling-refs [slug]",
		Short: "List the Modeling References of the installed Published Corpus",
		Long: "Lists the canonical Modeling References recorded in the installed Published Corpus, " +
			"grouped into Conventions (adopt by importing) and Examples (study, don't copy literally); each row shows " +
			"the reference's kebab-case slug, its File ID and a short description. " +
			"With a <slug> argument, resolves that single reference.\n\n" +
			"--json prints a JSON array of the matching modeling-refs.json entries " +
			"{slug, category, description, file_id} (one element with a <slug>).",
		Args:         cobra.MaximumNArgs(1),
		SilenceUsage: true,
		RunE:         runModelingRefs,
	}
	c.Flags().Bool("json", false, "emit the matching entries as a JSON array")
	return c
}

func runModelingRefs(cmd *cobra.Command, args []string) error {
	pc, err := corpus.OpenInstalled()
	if err != nil {
		return err
	}
	refs, err := pc.ModelingRefs()
	if err != nil {
		return err
	}
	jsonMode, _ := cmd.Flags().GetBool("json")
	out := cmd.OutOrStdout()

	if len(args) == 1 {
		match, ok := filterBySlug(refs, args[0])
		if !ok {
			return fmt.Errorf("no modeling reference with slug %q in the published corpus", args[0])
		}
		if jsonMode {
			return writeJSONOut(out, []corpus.ModelingRef{match})
		}
		_, err := fmt.Fprintf(out, "%s\t%s\t— %s\n", match.Slug, match.FileID, match.Description)
		return err
	}
	if jsonMode {
		if refs == nil {
			refs = []corpus.ModelingRef{}
		}
		return writeJSONOut(out, refs)
	}
	_, err = io.WriteString(out, formatGroupedRefs(refs))
	return err
}

func filterBySlug(refs []corpus.ModelingRef, slug string) (corpus.ModelingRef, bool) {
	for _, r := range refs {
		if r.Slug == slug {
			return r, true
		}
	}
	return corpus.ModelingRef{}, false
}

// formatGroupedRefs renders Conventions then Examples in file order, omitting
// an empty group.
func formatGroupedRefs(refs []corpus.ModelingRef) string {
	if len(refs) == 0 {
		return "no Modeling References in the published corpus\n"
	}
	var conventions, examples []corpus.ModelingRef
	for _, r := range refs {
		switch r.Category {
		case categoryConvention:
			conventions = append(conventions, r)
		case categoryExample:
			examples = append(examples, r)
		}
	}

	var b strings.Builder
	section := func(title string, rows []corpus.ModelingRef) {
		if len(rows) == 0 {
			return
		}
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString(title)
		b.WriteString("\n")
		tw := tabwriter.NewWriter(&b, 0, 0, 3, ' ', 0)
		for _, r := range rows {
			fmt.Fprintf(tw, "  %s\t%s\t— %s\n", r.Slug, r.FileID, r.Description)
		}
		_ = tw.Flush()
	}
	section("Conventions (adopt by importing)", conventions)
	section("Examples (study, don't copy literally)", examples)
	return b.String()
}
