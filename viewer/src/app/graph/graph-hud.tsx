"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import type { GraphLabelsUnavailableReason } from "./graph-artifacts";
import { formatGraphCount } from "./graph-page-model";
import {
  buildGraphSearchIndex,
  graphSearchInputDisabled,
  graphSearchNotice,
  graphSearchOutlineRow,
  graphSearchReducer,
  graphSearchStatus,
  graphSearchView,
  initialGraphSearchState,
} from "./graph-search-model";
import type { DecodedGraphLabels } from "./graph-wire";

/** Passed INTO the model as its limit, not sliced off the result, so the count and the canvas's lit set stay honest. */
const HUD_RESULT_LIMIT = 20;

export type GraphSearchOverlayProps = {
  /** `band_counts.length` — the shared row builder still composes a band label. */
  bandCount: number;
  /** Every node of the current Generation, or `null` while the shell's idle fetch is in flight. */
  labels: DecodedGraphLabels | null;
  searchUnavailableReason: GraphLabelsUnavailableReason | null;
  onSelect: (id: string) => void;
  /** The match SET, not the query: two matchers over one query is two answers. */
  onMatchesChange?: (indices: ReadonlySet<number> | null) => void;
  className?: string;
};

export function GraphSearchOverlay({
  bandCount,
  labels,
  searchUnavailableReason,
  onSelect,
  onMatchesChange,
  className,
}: GraphSearchOverlayProps) {
  const [state, dispatch] = useReducer(
    graphSearchReducer,
    undefined,
    initialGraphSearchState,
  );
  const searchId = useId();
  const resultsId = useId();
  const noticeId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  /** Separate from "is there a query": collapsing the list leaves the query active and the canvas's matches lit. */
  const [resultsOpen, setResultsOpen] = useState(false);

  const index = useMemo(
    () => (labels ? buildGraphSearchIndex(labels) : null),
    [labels],
  );
  const status = graphSearchStatus(index, searchUnavailableReason);
  const inputDisabled = graphSearchInputDisabled(status);
  const view = useMemo(
    () => graphSearchView(index, state, HUD_RESULT_LIMIT),
    [index, state],
  );
  /** The ONE line under the box, whichever thing is worth saying — two notices
   *  are unrepresentable by type. */
  const notice = graphSearchNotice(
    index,
    searchUnavailableReason,
    state.query,
    resultsOpen,
  );

  // Keyed on the VIEW, not called from the dispatcher: the labels payload
  // landing changes the match set with no query change.
  const onMatchesChangeRef = useRef(onMatchesChange);
  onMatchesChangeRef.current = onMatchesChange;
  useEffect(() => {
    onMatchesChangeRef.current?.(view.matchIndices);
  }, [view]);

  const resultRows = useMemo(
    () => view.results.map((entry) => graphSearchOutlineRow(entry, bandCount)),
    [view.results, bandCount],
  );

  const clear = useCallback(() => {
    dispatch({ kind: "query", value: "" });
    setResultsOpen(true);
    inputRef.current?.focus();
  }, []);

  // `pointerdown` on the document, not `blur` on the input: a click on a result
  // row blurs the input before the row's own click fires.
  useEffect(() => {
    if (!resultsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const card = cardRef.current;
      if (card && event.target instanceof Node && card.contains(event.target)) {
        return;
      }
      setResultsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [resultsOpen]);

  return (
    // The corner, the z-index and the `pointer-events-none` belong to the
    // stage's top-left HUD column (graph-explorer.tsx); this row does not place
    // itself. `pointer-events-auto` stays on the card alone, so the empty space
    // beside it cannot swallow drags meant for the canvas.
    <div className={cn("flex justify-start", className)}>
      <div
        ref={cardRef}
        role="search"
        className="pointer-events-auto flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur-sm supports-[backdrop-filter]:bg-background/80"
      >
        <label htmlFor={searchId} className="sr-only">
          Search the Knowledge Graph
        </label>
        <div className="flex items-center gap-2 px-3">
          <SearchGlyph />
          <input
            ref={inputRef}
            id={searchId}
            type="search"
            value={state.query}
            onChange={(event) => {
              dispatch({ kind: "query", value: event.target.value });
              setResultsOpen(true);
            }}
            onFocus={() => setResultsOpen(true)}
            // Escape clears the box rather than bubbling: it also closes the
            // node panel, and an uncleared query would leave the canvas dimmed
            // to a match set the visitor thought they had dismissed.
            onKeyDown={(event) => {
              if (event.key === "Escape" && state.query !== "") {
                event.preventDefault();
                event.stopPropagation();
                clear();
              }
            }}
            disabled={inputDisabled}
            placeholder={
              inputDisabled ? "Search unavailable" : "Search the graph…"
            }
            aria-controls={resultsId}
            aria-describedby={notice !== null ? noticeId : undefined}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2.5 font-serif text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-search-cancel-button]:hidden"
          />
          {state.query !== "" ? (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear the search"
              className="shrink-0 rounded-sm px-1 font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ✕
            </button>
          ) : null}
        </div>

        {/* The container is always in the tree (the input's `aria-controls`
            names it). Which branch the notice came from — a labels failure or
            the publisher lane — is the model's decision, including whether
            `resultsOpen` gates it. */}
        <div id={resultsId}>
          {notice !== null ? (
            <p
              id={noticeId}
              role="status"
              className="border-t border-border px-3 py-2 font-serif text-xs leading-relaxed text-muted-foreground"
            >
              {notice}
            </p>
          ) : null}

          {/* Gated on the notice: a line saying the lane is unavailable must not
              sit above a "0 matching" count answering the same query. */}
          {view.querying && resultsOpen && notice === null ? (
            <div className="border-t border-border">
              <p
                role="status"
                className="px-3 pb-1 pt-2 font-mono text-[0.625rem] uppercase tracking-widest text-muted-foreground"
              >
                {/* `view.total` is computed before any cap; `resultRows.length`
                    would report the cap on every broad query. */}
                {status === "pending"
                  ? "Loading the index…"
                  : `${formatGraphCount(view.total)} matching`}
              </p>
              {resultRows.length === 0 ? (
                status === "pending" ? null : (
                  <p className="px-3 pb-3 font-serif text-sm leading-relaxed text-muted-foreground">
                    No nodes in this view match that.
                  </p>
                )
              ) : (
                <ul className="max-h-[min(22rem,50vh)] overflow-y-auto overscroll-contain">
                  {resultRows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        // Collapse on the way out: the selection flies the
                        // camera to the node, and the query stays, so the match
                        // set stays lit.
                        onClick={() => {
                          setResultsOpen(false);
                          onSelect(row.id);
                        }}
                        className="flex w-full items-baseline gap-2.5 px-3 py-2 text-left font-serif text-sm leading-snug hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-1 inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: `var(${row.token})` }}
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {row.label}
                        </span>
                        <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                          {row.kindLabel}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {view.total > resultRows.length ? (
                <p className="px-3 pb-2 font-serif text-xs leading-relaxed text-muted-foreground">
                  Showing the first {formatGraphCount(resultRows.length)}. Keep
                  typing to narrow it.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Inline rather than a lucide import, so the HUD adds no icon dependency to this chunk. */
function SearchGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

/** DECORATIVE and `aria-hidden`: every entry duplicates something the canvas already exposes properly. */
type GraphControlHint = { gesture: string; effect: string };

/** Split on `hover`, not a width breakpoint: a narrow desktop window still has a mouse, a large tablet still does not. */
export const GRAPH_CONTROL_HINTS_POINTER: readonly GraphControlHint[] = [
  { gesture: "Drag", effect: "rotate" },
  { gesture: "Scroll", effect: "zoom" },
  { gesture: "Right-drag", effect: "pan" },
  { gesture: "Click", effect: "select" },
  { gesture: "0", effect: "reset" },
];

export const GRAPH_CONTROL_HINTS_TOUCH: readonly GraphControlHint[] = [
  { gesture: "Drag", effect: "rotate" },
  { gesture: "Pinch", effect: "zoom" },
  { gesture: "Tap", effect: "select" },
];

function HintRow({
  hints,
  className,
}: {
  hints: readonly GraphControlHint[];
  className: string;
}) {
  return (
    <p
      className={cn(
        "flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[0.625rem] uppercase tracking-wider",
        className,
      )}
    >
      {hints.map((hint, i) => (
        <span key={hint.gesture} className="flex items-center gap-2">
          {i === 0 ? null : (
            <span aria-hidden="true" className="text-muted-foreground/40">
              ·
            </span>
          )}
          <span className="whitespace-nowrap">
            <span className="font-semibold text-foreground">{hint.gesture}</span>{" "}
            <span className="text-muted-foreground">{hint.effect}</span>
          </span>
        </span>
      ))}
    </p>
  );
}

export function GraphControlsHint({ className }: { className?: string }) {
  return (
    // The anchoring, the z-index and the pointer-events belong to the stage's
    // bottom HUD column (graph-explorer.tsx), which stacks the degraded notice
    // above this row.
    <div aria-hidden="true" className={cn("flex justify-center", className)}>
      <HintRow
        hints={GRAPH_CONTROL_HINTS_POINTER}
        className="hidden [@media(hover:hover)]:flex"
      />
      <HintRow
        hints={GRAPH_CONTROL_HINTS_TOUCH}
        className="flex [@media(hover:hover)]:hidden"
      />
    </div>
  );
}
