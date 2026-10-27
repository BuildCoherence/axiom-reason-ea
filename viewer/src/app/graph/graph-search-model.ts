// Search runs over `labels.json` — every node of the current Generation, never the manifest's ranked prefix.

import { kindLegendEntry, type GraphNodeKind } from "@/lib/graph-kind-legend";

import type { GraphLabelsUnavailableReason } from "./graph-artifacts";
import { graphBandLabel, type GraphOutlineRow } from "./graph-page-model";
import type { DecodedGraphLabels, DecodedGraphPublishers } from "./graph-wire";

/** `index` is the EMITTED NODE INDEX — the join key across the artifacts, valid only within one Generation. */
export type GraphSearchEntry = {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly kind: GraphNodeKind;
  readonly band: number;
};

export function graphSearchEntries(
  labels: DecodedGraphLabels,
): GraphSearchEntry[] {
  const count = labels.ids.length;
  const entries: GraphSearchEntry[] = new Array(count);
  for (let i = 0; i < count; i++) {
    entries[i] = {
      index: i,
      id: labels.ids[i],
      label: labels.labels[i],
      kind: labels.kinds[i],
      band: labels.bands[i],
    };
  }
  return entries;
}

/** Caps rendered ROWS only — the match count and the canvas's lit set are computed uncapped. */
export const GRAPH_SEARCH_MAX_RESULTS = 100;

export type GraphSearchIndex = {
  readonly entries: readonly GraphSearchEntry[];
  /** Parallel to `entries`, lowercased once per labels payload rather than per keystroke. */
  readonly lowerLabels: readonly string[];
  /** The decoded block itself and NOTHING derived from it — no inverse index. An
   *  inverse index would return a union over several matching handles as
   *  per-publisher runs, which is not emission order, and would be a second
   *  structure to build, invalidate and test. `null` when this view's index
   *  omits publishers. */
  readonly publishers: DecodedGraphPublishers | null;
};

export function buildGraphSearchIndex(
  labels: DecodedGraphLabels,
): GraphSearchIndex {
  const entries = graphSearchEntries(labels);
  return {
    entries,
    lowerLabels: entries.map((entry) => entry.label.toLowerCase()),
    publishers: labels.publishers,
  };
}

/** EXACT prefix, never a distance: a fuzzy id match would answer a typo with a confidently wrong node. */
export function graphIdPrefixMatches(
  entries: readonly GraphSearchEntry[],
  query: string,
): GraphSearchEntry[] {
  const needle = query.trim().toUpperCase();
  if (needle === "") return [];
  return entries.filter((entry) => entry.id.toUpperCase().startsWith(needle));
}

/** The `@handle` lane. Two passes over the FORWARD CSR: the needle marks
 *  dictionary indices (O(dictionary) substring tests against the once-lowercased
 *  dictionary), then one ascending walk of `off` emits any node carrying a
 *  marked index.
 *
 *  Results therefore come back in EMISSION ORDER — rank order within the core,
 *  then rank order within the Frontier, because `RankLess`'s leading leg is
 *  Frontier-last. No new sort and no new key: the row order and the canvas's
 *  `matchIndices` have to agree, and a rank sort here would break that.
 *
 *  Matching is username-only, and structurally so: `display_name` is not on this
 *  wire at all. */
function searchByPublisher(
  index: GraphSearchIndex,
  handle: string,
  limit: number,
): GraphSearchEntry[] {
  const publishers = index.publishers;
  if (publishers === null) return [];
  // A bare `@` matches nothing, the rule the empty query already follows: a
  // half-typed sigil must not light every node in the Generation.
  const needle = handle.trim().toLowerCase();
  if (needle === "") return [];

  const { lowerNames, off, idx } = publishers;
  const marked = new Uint8Array(lowerNames.length);
  let any = false;
  for (let d = 0; d < lowerNames.length; d++) {
    if (lowerNames[d].includes(needle)) {
      marked[d] = 1;
      any = true;
    }
  }
  if (!any) return [];

  const out: GraphSearchEntry[] = [];
  const entries = index.entries;
  for (let i = 0; i < entries.length; i++) {
    if (out.length >= limit) break;
    const end = off[i + 1];
    for (let p = off[i]; p < end; p++) {
      if (marked[idx[p]]) {
        out.push(entries[i]);
        break;
      }
    }
  }
  return out;
}

/** An empty or whitespace-only query matches NOTHING — an untouched box must not drop a list over the graph. */
export function searchGraph(
  index: GraphSearchIndex,
  query: string,
  limit: number = GRAPH_SEARCH_MAX_RESULTS,
): GraphSearchEntry[] {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  // There are exactly THREE search lanes, and a LEADING `@` selects the third
  // exclusively — neither the id-prefix lane nor the label lane runs. `a@b` is
  // not a handle query.
  if (trimmed.startsWith("@")) {
    return searchByPublisher(index, trimmed.slice(1).trim(), limit);
  }

  const needle = trimmed.toLowerCase();
  const out: GraphSearchEntry[] = [];
  const seen = new Set<number>();

  for (const entry of graphIdPrefixMatches(index.entries, trimmed)) {
    if (out.length >= limit) return out;
    seen.add(entry.index);
    out.push(entry);
  }
  // `label` alone: `kind` would make "proof" light every proof node, and `band` is an integer, so "2" would match a third of the graph.
  const { entries, lowerLabels } = index;
  for (let i = 0; i < entries.length; i++) {
    if (out.length >= limit) break;
    if (seen.has(entries[i].index)) continue;
    if (!lowerLabels[i].includes(needle)) continue;
    out.push(entries[i]);
  }
  return out;
}

/** One field, and no second by construction: this reducer cannot express "clear the selection" or "write the URL". */
export type GraphSearchState = {
  readonly query: string;
};

/** Exported so the spec can assert the state's shape for every action. */
export const GRAPH_SEARCH_STATE_KEYS: readonly string[] = ["query"];

export function initialGraphSearchState(): GraphSearchState {
  return { query: "" };
}

export type GraphSearchAction = { kind: "query"; value: string };

/** A single-member union on purpose: the exhaustive `switch` makes a second action a compile error, not a silent no-op. */
export function graphSearchReducer(
  state: GraphSearchState,
  action: GraphSearchAction,
): GraphSearchState {
  switch (action.kind) {
    case "query":
      return { query: action.value };
  }
}

export type GraphSearchView = {
  querying: boolean;
  /** The rows to RENDER — capped at `limit`. */
  results: readonly GraphSearchEntry[];
  /** Uncapped, and NOT `results.length`: a count read off the capped list turns "1,240 matching" into "100 matching". */
  total: number;
  /** What the canvas dims against, uncapped — one search, one answer, two renderings of it. */
  matchIndices: ReadonlySet<number> | null;
};

export function graphSearchView(
  index: GraphSearchIndex | null,
  state: GraphSearchState,
  limit: number = GRAPH_SEARCH_MAX_RESULTS,
): GraphSearchView {
  const querying = state.query.trim() !== "";
  if (!querying || index === null) {
    return { querying, results: [], total: 0, matchIndices: null };
  }
  const matches = searchGraph(index, state.query, Number.POSITIVE_INFINITY);
  return {
    querying,
    results: matches.slice(0, limit),
    total: matches.length,
    matchIndices: new Set(matches.map((entry) => entry.index)),
  };
}

/** `pending` is the honest state between arrival and the idle labels fetch landing. */
export type GraphSearchStatus = "pending" | "ready" | "unavailable";

export function graphSearchStatus(
  index: GraphSearchIndex | null,
  reason: GraphLabelsUnavailableReason | null,
): GraphSearchStatus {
  if (reason !== null) return "unavailable";
  return index === null ? "pending" : "ready";
}

/** A box that cannot search must not accept typing: silent empty results read as "the corpus has nothing matching". */
export function graphSearchInputDisabled(status: GraphSearchStatus): boolean {
  return status === "unavailable";
}

/** Every message opens with "Search unavailable" so the visitor learns which FACILITY is gone. */
export function graphSearchUnavailableMessage(
  reason: GraphLabelsUnavailableReason,
): string {
  switch (reason) {
    case "not_found":
      return "Search unavailable — this view's index has expired. Reload for the current one.";
    case "rate_limited":
      return "Search unavailable — too many requests just now. Try again shortly.";
    case "timeout":
      return "Search unavailable — the index took too long to load.";
    case "error":
      return "Search unavailable — the index could not be loaded.";
  }
}

/** The ONE line under the search box, whichever thing is worth saying — so two
 *  notices are unrepresentable by TYPE rather than by an argued rule, and the
 *  HUD needs one `<p role="status">` and one DOM id.
 *
 *  Three branches and nothing else:
 *  1. a labels failure ⇒ that reason's message, ungated by `resultsOpen` as
 *     today (it explains why the box beside it is DISABLED);
 *  2. otherwise a healthy index whose publisher block is absent, under a query
 *     in the `@` lane, with the card open ⇒ the publisher message;
 *  3. otherwise `null`.
 *
 *  This is deliberately NOT a fifth `GraphLabelsUnavailableReason`: widening
 *  that union would make `graphSearchStatus` return `"unavailable"`, disabling
 *  the very box that produced the state and taking the healthy label and id
 *  lanes with it.
 *
 *  `index !== null` is load-bearing. Both `labels` and the unavailable reason
 *  start `null` and the labels fetch is idle-deferred, so `(null, null)` —
 *  status `"pending"` — is the NORMAL state for the first seconds of every
 *  visit; without the conjunct, typing `@alice` in that window asserts a false
 *  thing about a healthy Generation and then vanishes.
 *
 *  The publisher branch is gated on `resultsOpen` and the labels branch is not:
 *  that branch's rationale does not transfer (this box stays enabled), and
 *  ungated the notice would linger under a collapsed card.
 *
 *  The message keeps the `graphSearchUnavailableMessage` family's
 *  `"Search unavailable — <clause>"` shape on purpose; the two are one voice,
 *  not a drift. */
export function graphSearchNotice(
  index: GraphSearchIndex | null,
  reason: GraphLabelsUnavailableReason | null,
  query: string,
  resultsOpen: boolean,
): string | null {
  if (reason !== null) return graphSearchUnavailableMessage(reason);
  if (
    index !== null &&
    index.publishers === null &&
    // A bare `@` satisfies this, deliberately: the notice describes the LANE,
    // not the needle.
    query.trim().startsWith("@") &&
    resultsOpen
  ) {
    return "Search unavailable — this view's index omits publishers.";
  }
  return null;
}

/** A hit SELECTS, it never navigates — the row carries no `href`. */
export function graphSearchOutlineRow(
  entry: GraphSearchEntry,
  bandCount: number,
): GraphOutlineRow {
  const legend = kindLegendEntry(entry.kind);
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    kindLabel: legend.label,
    token: legend.token,
    band: entry.band,
    bandLabel: graphBandLabel(entry.band, bandCount),
  };
}
