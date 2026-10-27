package cmd

import (
	"fmt"
	"time"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(newQueryCmd())
}

// newQueryCmd builds a fresh `query` command so tests get fresh flag state.
func newQueryCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "query <type_head>",
		Short: "List the declarations of one type head in the installed Published Corpus",
		Long: "Lists every declaration in the installed Published Corpus whose type head is exactly <type_head>, " +
			"newest first. Per-parameter predicates are not available in the local edition.\n\n" +
			"--json prints one object: {type_head, total, limit, offset, has_more, results}, where results are " +
			"the matching search-index.json constants rows verbatim.",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE:         runQuery,
	}
	addPagingFlags(c.Flags())
	c.Flags().StringArrayP("param", "p", nil, "not available in the local edition")
	c.Flags().String("order-by", "", "not available in the local edition")
	return c
}

func runQuery(cmd *cobra.Command, args []string) error {
	if cmd.Flags().Changed("param") {
		return fmt.Errorf("-p/--param is not available in the local edition: per-parameter query predicates are not supported; `%s query <type_head>` lists every declaration of the type head", binaryName)
	}
	if cmd.Flags().Changed("order-by") {
		return fmt.Errorf("--order-by is not available in the local edition: query results are ordered newest first")
	}
	pg, err := parsePaging(cmd)
	if err != nil {
		return err
	}
	typeHead := args[0]

	pc, err := corpus.OpenInstalled()
	if err != nil {
		return err
	}
	idx, err := pc.SearchIndex()
	if err != nil {
		return err
	}
	rows := keep(idx.Constants, func(r corpus.Constant) bool { return r.TypeHead != nil && *r.TypeHead == typeHead })
	if len(rows) == 0 && !hasTypeHead(idx.Types, typeHead) {
		return fmt.Errorf("unknown type head `%s` — try `%s search types <substring>`", typeHead, binaryName)
	}
	sortRows(rows, false, true, func(r corpus.Constant) string { return r.Name },
		func(r corpus.Constant) time.Time { return r.CreatedAt })

	p := paginate(rows, pg)
	out := cmd.OutOrStdout()
	if pg.json {
		return writeJSONOut(out, struct {
			TypeHead string `json:"type_head"`
			page[corpus.Constant]
		}{typeHead, p})
	}
	return renderConstants(out, typeHead, p)
}

func hasTypeHead(types []corpus.TypeHead, typeHead string) bool {
	for _, t := range types {
		if t.TypeHead == typeHead {
			return true
		}
	}
	return false
}
