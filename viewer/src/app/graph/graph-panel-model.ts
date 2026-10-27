// `?prop=` / `?def=` on `/graph` is a SELECTION parameter, not a route — a click never navigates.

import { kindLegendEntry, type GraphNodeKind } from "@/lib/graph-kind-legend";
import { canonicalizeId } from "@/lib/id-codec";
import type { PropData } from "@/components/lean-ui/types";

import { formatGraphCount } from "./graph-page-model";
import { GRAPH_BARE_PATH, graphClearSelectionUrl } from "./graph-picking";
import type { DecodedGraphGeometry, DecodedGraphLabels } from "./graph-wire";

/** The id alone cannot pick the panel: proposition and Proof Node ids share one Crockford alphabet. */
export type GraphPanelSelection = {
  kind: "prop" | "def";
  id: string;
};

export function graphSelectionParam(
  selection: GraphPanelSelection,
): "prop" | "def" {
  return selection.kind;
}

export function graphSelectionForNode(
  kind: GraphNodeKind,
  id: string,
): GraphPanelSelection {
  return { kind: kind === "proof" ? "def" : "prop", id };
}

/** `?def=` and `?prop=` never coexist; every other query parameter is preserved in order. */
export function graphSelectionUrl(
  search: string,
  selection: GraphPanelSelection | null,
): string {
  if (selection === null) return graphClearSelectionUrl(search);
  const param = graphSelectionParam(selection);
  const rest = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  rest.delete("prop");
  rest.delete("def");
  const merged = new URLSearchParams();
  merged.set(param, selection.id);
  for (const [key, value] of rest) merged.append(key, value);
  return `${GRAPH_BARE_PATH}?${merged.toString()}`;
}

/** One raw query value; the first occurrence wins, matching `URLSearchParams.get`. */
export type GraphRawParam = string | readonly string[] | undefined | null;

function firstParam(raw: GraphRawParam): string | null {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) return raw.length > 0 ? raw[0] : null;
  return typeof raw === "string" ? raw : null;
}

/** The deep-link selection from the page URL's `?def=` / `?prop=`. */
export function readGraphSelection(params: {
  prop?: GraphRawParam;
  def?: GraphRawParam;
}): GraphPanelSelection | null {
  const def = canonicalGraphId(firstParam(params.def));
  if (def !== null) return { kind: "def", id: def };
  const prop = canonicalGraphId(firstParam(params.prop));
  return prop !== null ? { kind: "prop", id: prop } : null;
}

/** Case-folded through `canonicalizeId` (mirroring Go's idcodec) with NO redirect. */
export function canonicalGraphId(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  const result = canonicalizeId(raw);
  return result.ok ? result.canonical : null;
}

/** A merged proposition resolves through the alias map, so its panel data carries a DIFFERENT `proposition_id`. */
export function graphCanonicalPropId(
  requestedId: string,
  data: Pick<PropData, "proposition_id"> | null,
): string | null {
  if (data === null) return null;
  const live = data.proposition_id;
  if (typeof live !== "string" || live === "") return null;
  return live === requestedId ? null : live;
}

/** `text` is the whole sentence — the component renders it verbatim. */
export type GraphContextFact = { id: string; text: string };

export type GraphContextNegates = { id: string; label: string };

export type GraphContextLink = { href: string; label: string };

export type GraphContextStripModel = {
  facts: readonly GraphContextFact[];
  negates: GraphContextNegates | null;
  link: GraphContextLink | null;
};

export type GraphContextStripInput = {
  selection: GraphPanelSelection;
  /** `null` while unresolved; every labels-derived line is omitted rather than guessed. */
  index: number | null;
  labels: DecodedGraphLabels | null;
  /** Graph Manifest `band_cut_points`. */
  bandCutPoints: readonly number[];
  /** Graph Manifest `band_counts`. Its LENGTH is the "of N" denominator. */
  bandCounts: readonly number[];
  /** Graph Manifest `formal_identity_total` — the "held by" denominator. */
  formalIdentityTotal: number;
  /** The proposition's panel data, when it has landed. */
  propData: PropData | null;
};

/** N is the INTEGER `holders`, never `holder_rows.length`, which counts locked-out identities too. */
export function graphHeldByText(
  holders: number,
  formalIdentityTotal: number,
): string {
  const denominator = Math.max(holders, formalIdentityTotal);
  return `Held by ${formatGraphCount(holders)} of ${formatGraphCount(denominator)}`;
}

/** `supports.length` — the arguments a visitor can open and read; no endpoint exposes the raw certificate count. */
export function graphProofCountText(proofCount: number): string {
  if (proofCount === 0) return "No proofs";
  return proofCount === 1 ? "1 proof" : `${formatGraphCount(proofCount)} proofs`;
}

/** Derived from `supports[]`, not the Generation's flag column: the panel opens for nodes outside the ranked set. */
export function graphIsSettled(propData: PropData | null): boolean {
  return (propData?.supports ?? []).some(
    (support) => (support.premise_count ?? 0) === 0,
  );
}

/** `concludes_false` means the SELECTED claim is the contradiction, not that this argument is suspect. */
export function graphIsFalseProposition(propData: PropData | null): boolean {
  return (propData?.supports ?? []).some(
    (support) => support.concludes_false === true,
  );
}

export const GRAPH_SETTLED_FACT_TEXT = "Settled — proved from no premises";

export const GRAPH_FALSE_FACT_TEXT = "False — the contradiction";

export function graphOthersInBandText(
  bandCounts: readonly number[],
  band: number,
): string | null {
  const count = band >= 0 && band < bandCounts.length ? bandCounts[band] : 0;
  const others = count - 1;
  if (others <= 0) return null;
  return others === 1
    ? "1 other in this band"
    : `${formatGraphCount(others)} others in this band`;
}

// `negation_proposition_id` is forward-only — reading it would drop the line for half of every pair.
/** -1 (partner outside this Generation) is the only legal negative; it yields `null` and the caller omits the line. */
export function graphNegatesPartner(
  labels: DecodedGraphLabels | null,
  index: number | null,
): GraphContextNegates | null {
  if (labels === null || index === null) return null;
  if (!Number.isInteger(index) || index < 0 || index >= labels.neg.length) {
    return null;
  }
  const partner = labels.neg[index];
  if (partner < 0 || partner >= labels.ids.length) return null;
  return { id: labels.ids[partner], label: labels.labels[partner] };
}

/** From `supports[].def_id`, never the manifest's `dest`: `dest` exists only on the ranked 200. */
export function graphPropLinkOut(
  propData: PropData | null,
): GraphContextLink | null {
  if (propData === null) return null;
  const support = (propData.supports ?? []).find(
    (entry) => typeof entry.def_id === "string" && entry.def_id !== "",
  );
  if (support === undefined) return null;
  const href =
    `/theorem/${encodeURIComponent(support.def_id)}` +
    `?prop=${encodeURIComponent(propData.proposition_id)}`;
  return { href, label: "Read the proof" };
}

/** No query parameter: the Theorem Page is already about this declaration. */
export function graphDefLinkOut(defId: string): GraphContextLink {
  return {
    href: `/theorem/${encodeURIComponent(defId)}`,
    label: "Open the Theorem Page",
  };
}

/** Everything the strip prints, in render order. */
export function graphContextStrip(
  input: GraphContextStripInput,
): GraphContextStripModel {
  const facts: GraphContextFact[] = [];

  if (input.selection.kind === "prop" && input.propData !== null) {
    if (graphIsFalseProposition(input.propData)) {
      facts.push({ id: "false", text: GRAPH_FALSE_FACT_TEXT });
    } else if (graphIsSettled(input.propData)) {
      facts.push({ id: "settled", text: GRAPH_SETTLED_FACT_TEXT });
    }
    facts.push({
      id: "proofs",
      text: graphProofCountText((input.propData.supports ?? []).length),
    });
  }

  return {
    facts,
    negates: graphNegatesPartner(input.labels, input.index),
    link:
      input.selection.kind === "def"
        ? graphDefLinkOut(input.selection.id)
        : graphPropLinkOut(input.propData),
  };
}

/** The join key is Generation-scoped, so this is rebuilt whenever the labels payload is. */
export function graphIndexById(
  labels: DecodedGraphLabels | null,
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  if (labels === null) return map;
  for (let i = 0; i < labels.ids.length; i++) {
    if (!map.has(labels.ids[i])) map.set(labels.ids[i], i);
  }
  return map;
}

/** An unknown id gets no selection: a guessed axis opens the wrong panel against the wrong endpoint. */
export function graphSelectionForId(
  id: string,
  labels: DecodedGraphLabels | null,
  indexById: ReadonlyMap<string, number>,
  fallbackKinds: Readonly<Record<string, GraphNodeKind>>,
): GraphPanelSelection | null {
  const index = indexById.get(id);
  if (labels !== null && index !== undefined && index < labels.kinds.length) {
    return graphSelectionForNode(labels.kinds[index], id);
  }
  const kind = fallbackKinds[id];
  return kind === undefined ? null : graphSelectionForNode(kind, id);
}

/** The server-rendered fallback `graphSelectionForId` reads before `labels.json` lands. */
export function graphNodeKinds(manifest: {
  top_nodes: readonly { id: string; kind: GraphNodeKind }[];
}): Record<string, GraphNodeKind> {
  const kinds: Record<string, GraphNodeKind> = {};
  for (const node of manifest.top_nodes) kinds[node.id] = node.kind;
  return kinds;
}

/** The edge columns ALONE — `degrees` counts incident edges rather than distinct
 *  neighbours, so the walk below cannot reach it. */
export type GraphEdgeColumns = Pick<
  DecodedGraphGeometry,
  "edgeCount" | "edgeSrc" | "edgeDst"
>;

/** ONE walk of the edge columns per selection, serving both consumers: the canvas
 *  emphasises `indices` (the selection is a member), the panel lists `neighbours`
 *  (it is not). */
export type GraphEgoWalk = {
  indices: ReadonlySet<number>;
  /** Distinct, in first-incidence order: a reciprocal pair and a repeated edge
   *  are one neighbour, and a self-loop is none. */
  neighbours: readonly number[];
};

/** `null` for a node this Generation does not carry — never an empty walk, which
 *  would claim the node is isolated. */
export function graphEgoWalk(
  geometry: GraphEdgeColumns | null,
  index: number | null,
): GraphEgoWalk | null {
  if (geometry === null || index === null) return null;
  const indices = new Set<number>([index]);
  const neighbours: number[] = [];
  for (let e = 0; e < geometry.edgeCount; e++) {
    const src = geometry.edgeSrc[e];
    const dst = geometry.edgeDst[e];
    const other = src === index ? dst : dst === index ? src : -1;
    // Seeded with the selection, so this rejects the self-loop as well as the duplicate.
    if (other < 0 || indices.has(other)) continue;
    indices.add(other);
    neighbours.push(other);
  }
  return { indices, neighbours };
}

/** One row of the panel's Connected section — faced like a search result. */
export type GraphConnectedRow = {
  selection: GraphPanelSelection;
  label: string;
  /** Kind Legend display label ("Proposition" / "Proof Node"). */
  kindLabel: string;
  /** Kind Legend colour token; render as `var(<token>)`. */
  token: string;
};

/** The Connected section's ONE list — the collapsed count is `rows.length`, so it
 *  cannot disagree with what expanding shows. Empty means no section at all: a
 *  walk that never ran and a label payload that never landed are both unknown,
 *  and a rendered zero would answer them with a claim. */
export function graphConnectedRows(
  walk: GraphEgoWalk | null,
  labels: DecodedGraphLabels | null,
): readonly GraphConnectedRow[] {
  if (walk === null || labels === null) return [];
  const rows: GraphConnectedRow[] = [];
  for (const index of walk.neighbours) {
    if (index >= labels.ids.length) continue;
    const kind = labels.kinds[index];
    const legend = kindLegendEntry(kind);
    rows.push({
      selection: graphSelectionForNode(kind, labels.ids[index]),
      label: labels.labels[index],
      kindLabel: legend.label,
      token: legend.token,
    });
  }
  return rows;
}

/** The collapsed row's number, from the same list the expansion renders. */
export function graphConnectedCountText(count: number): string {
  return count === 1
    ? "1 connection"
    : `${formatGraphCount(count)} connections`;
}
