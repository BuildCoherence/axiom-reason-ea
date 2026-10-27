"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { paginate, queryTypeHead, type SearchIndex } from "@/lib/search-index.mjs";

import { Pager } from "./pager";
import { ConstantResultRow, RowActionRegion, TypeHeadResultRow } from "./result-rows";
import { PAGE_SIZE, SEARCH_PATH } from "./search-route";

const CARD =
  "mt-4 overflow-hidden rounded-xl border border-[var(--base02)] bg-background shadow-[var(--shadow-float)]";

/**
 * Every declaration whose type head is exactly `typeHead`, newest first, as
 * `axm query <type_head>` lists them. Per-parameter predicates are not offered.
 */
export function TypeHeadQuery({
  index,
  typeHead,
  fromQ,
  onInspect,
}: {
  index: SearchIndex;
  typeHead: string;
  fromQ: string | null;
  onInspect: (defId: string) => void;
}) {
  const router = useRouter();
  const [offset, setOffset] = React.useState(0);
  const { schema, rows, known } = React.useMemo(
    () => queryTypeHead(index, typeHead),
    [index, typeHead],
  );
  const page = paginate(rows, PAGE_SIZE, offset);

  const back = () =>
    router.push(fromQ ? `${SEARCH_PATH}?${new URLSearchParams({ q: fromQ })}` : SEARCH_PATH);

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-8">
      <button
        type="button"
        onClick={back}
        className="mb-3.5 inline-flex items-center gap-2 text-[13px] text-[var(--base04)] hover:underline"
      >
        ‹ <span>Back to</span> <b className="text-[var(--base05)]">Search</b>
        {fromQ && <span className="font-mono text-[var(--base05)]">&ldquo;{fromQ}&rdquo;</span>}
      </button>

      <h1 className="font-mono text-sm text-muted-foreground">
        Declarations of type head <span className="text-foreground">{typeHead}</span>
      </h1>

      {!known ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Unknown type head <code>{typeHead}</code>. Search type heads to find one.
        </p>
      ) : (
        <>
          {schema !== null && (
            <section className={CARD} aria-label="Type head">
              <div className="flex items-stretch">
                <TypeHeadResultRow
                  row={schema}
                  showArity
                  onInspect={onInspect}
                  action={
                    schema.def_id !== null ? (
                      <RowActionRegion
                        variant="button"
                        onClick={() => onInspect(schema.def_id as string)}
                      >
                        View def →
                      </RowActionRegion>
                    ) : null
                  }
                />
              </div>
            </section>
          )}

          <section className={CARD} aria-labelledby="type-head-instances">
            <div className="flex items-baseline gap-2 border-b border-[var(--base02)] px-4 py-3">
              <h2
                id="type-head-instances"
                className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-foreground"
              >
                Instances
              </h2>
              <span className="text-xs text-muted-foreground">{page.total}</span>
              <span className="ml-auto text-xs text-muted-foreground">Newest first</span>
            </div>
            {page.results.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No matches.</p>
            ) : (
              <ul className="divide-y divide-[var(--base02)]">
                {page.results.map((row) => (
                  <ConstantResultRow key={row.def_id} row={row} onInspect={onInspect} />
                ))}
              </ul>
            )}
          </section>

          {page.total > page.limit && (
            <Pager
              total={page.total}
              limit={page.limit}
              offset={page.offset}
              onOffsetChange={setOffset}
            />
          )}
        </>
      )}
    </div>
  );
}
