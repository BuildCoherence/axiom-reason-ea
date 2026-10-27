// The ONE binding of a node or edge kind to a colour token and a display label:
// every consumer — the island, the search HUD, the poster, the OG card — reads
// this array, and a kind with no row has no colour and fails at the type level.
//
// Colours are named as design tokens, never literals, and resolved through
// `resolve-css-color.ts`, so the legend and the canvas follow the theme by one
// code path. Pure module, so the server half can render from it.

import {
  resolveCssColor,
  resolveCssColorHex,
  type Base16Token,
  type Rgb255,
} from "./resolve-css-color";
import type { ResolvedMode } from "./theme/apply-theme";

/** Node kinds on the wire. Ids share one Crockford alphabet, so the kind is the
 *  only thing that routes a selection to `?prop=` vs `?def=`. */
export type GraphNodeKind = "proposition" | "proof";

/** Edge kinds: `entails` (premise → conclusion) and `negates`, which stays
 *  proposition-to-proposition in every topology. */
export type GraphEdgeKind = "entails" | "negates";

/** Node STATES — not kinds. Each is a proposition distinguished by a flag bit,
 *  and a state must never be accepted where a wire kind is expected:
 *  `isGraphNodeKind("settled")` is false. */
export type GraphNodeState = "settled" | "false-proposition";

export type GraphKind = GraphNodeKind | GraphEdgeKind | GraphNodeState;

export type KindLegendEntry = {
  readonly kind: GraphKind;
  /** Which section of the legend this row belongs to. */
  readonly group: "node" | "edge" | "state";
  /** States only: drawn with the ring treatment, so colour is not the sole
   *  channel. Always false for kinds. */
  readonly ringed?: boolean;
  /** Glossary-canonical display label — the string the DOM legend renders. */
  readonly label: string;
  /** The single colour source for this kind, in both the render and the swatch. */
  readonly token: Base16Token;
  /** Edges only. Always false for nodes, so consumers read a boolean rather
   *  than branching on `undefined`. */
  readonly dashed: boolean;
};

// Ordered as the DOM legend reads top-to-bottom: nodes first, then edges.
//
// `false-proposition` shares `--base08` with `negates` deliberately — negation
// and contradiction are one semantic family — and colour is not its only
// channel: the False node is drawn oversized.
const ENTRIES: readonly KindLegendEntry[] = [
  {
    // Grey is the point: a proposition's colour states its epistemic status, and
    // "nobody has taken a position" is the absence of one.
    kind: "proposition",
    group: "node",
    label: "Proposition",
    token: "--base04",
    dashed: false,
  },
  {
    kind: "proof",
    group: "node",
    label: "Proof Node",
    token: "--base0D",
    dashed: false,
  },
  {
    // "True", not "Settled": this row pairs with the red `False`, and
    // "Settled / False" would name the two on different axes.
    kind: "settled",
    group: "state",
    label: "True",
    token: "--base0B",
    dashed: false,
    ringed: false,
  },
  {
    kind: "false-proposition",
    group: "state",
    label: "False",
    token: "--base08",
    dashed: false,
    // No ring: it now means the adopt/reject split, which a contradiction does
    // not have. Oversizing is the channel that survives.
    ringed: false,
  },
  {
    kind: "entails",
    group: "edge",
    label: "Entails",
    token: "--base04",
    dashed: false,
  },
  {
    kind: "negates",
    group: "edge",
    label: "Negates",
    token: "--base08",
    dashed: true,
  },
];

/** The Kind Legend. Frozen: a mutated row would repaint the canvas and the
 *  legend inconsistently, depending on module evaluation order. */
export const KIND_LEGEND: readonly KindLegendEntry[] = Object.freeze(
  ENTRIES.map((entry) => Object.freeze(entry)),
);

/** Lookup view over `KIND_LEGEND`, holding the SAME entry objects. */
export const KIND_LEGEND_BY_KIND: ReadonlyMap<GraphKind, KindLegendEntry> =
  new Map(KIND_LEGEND.map((entry) => [entry.kind, entry]));

/** The row for `kind`, or throw. Reachable if a wire payload widens the
 *  vocabulary before the client does; the message names the kind so a
 *  `format_version` mismatch is the obvious diagnosis. */
export function kindLegendEntry(kind: GraphKind): KindLegendEntry {
  const entry = KIND_LEGEND_BY_KIND.get(kind);
  if (!entry) {
    throw new Error(`graph-kind-legend: no Kind Legend entry for "${kind}"`);
  }
  return entry;
}

export const KIND_LEGEND_NODES: readonly KindLegendEntry[] = KIND_LEGEND.filter(
  (entry) => entry.group === "node",
);

export const KIND_LEGEND_EDGES: readonly KindLegendEntry[] = KIND_LEGEND.filter(
  (entry) => entry.group === "edge",
);

/** The node-STATE rows. Separate from `KIND_LEGEND_NODES` because a state is
 *  not a kind: these describe propositions the wire calls `proposition`. */
export const KIND_LEGEND_STATES: readonly KindLegendEntry[] =
  KIND_LEGEND.filter((entry) => entry.group === "state");

export function isGraphNodeKind(value: string): value is GraphNodeKind {
  return KIND_LEGEND_BY_KIND.get(value as GraphKind)?.group === "node";
}

export function isGraphEdgeKind(value: string): value is GraphEdgeKind {
  return KIND_LEGEND_BY_KIND.get(value as GraphKind)?.group === "edge";
}

/** The kind's colour as an sRGB triple — what the island uploads to the GPU. */
export function kindLegendColor(kind: GraphKind, mode: ResolvedMode): Rgb255 {
  return resolveCssColor(kindLegendEntry(kind).token, mode);
}

/** The kind's colour as `#rrggbb` — what a DOM swatch renders. */
export function kindLegendHex(kind: GraphKind, mode: ResolvedMode): string {
  return resolveCssColorHex(kindLegendEntry(kind).token, mode);
}
