// Mirrors the Go envelope in `axiom/api/internal/graphsnap/manifest.go`.
//
// Permanently additive-compatible: fields are never removed or repurposed, and
// an unknown field is normal and must never fail a read. The one break the API
// can signal is `format_version`.

import type { GraphNodeKind } from "@/lib/graph-kind-legend";
import type { GraphPosterBlock } from "@/lib/graph-poster";

/** The only `format_version` this viewer understands. A manifest with another
 *  fails the build; an artifact with another is a degraded rung. */
export const GRAPH_MANIFEST_FORMAT_VERSION = 1;

/** Node/edge tallies. `counts` is what this Generation EMITTED, `totals` what
 *  the corpus holds before the caps trimmed it. */
export type GraphManifestCounts = {
  nodes: number;
  edges: number;
  propositions: number;
  proof_nodes: number;
  isolated: number;
  entails_edges: number;
  negates_edges: number;
  /** Frontier propositions, counted within `propositions`. Optional: a manifest
   *  built before the shell existed omits it. */
  frontier?: number;
};

/** Layout bounding box, `[x, y, z]`. The poster's projection scales by it. */
export type GraphManifestBounds = {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
};

/** One of the 200 ranked nodes carried inline for the server render. `dest` is
 *  `null` when the node has no crawlable destination, and a `null` must never
 *  fall back to a fabricated URL. */
export type GraphManifestTopNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  degree: number;
  x: number;
  y: number;
  z: number;
  /** Index band `0..frontierBand` of the ranked node array. */
  band: number;
  /** The node's geometry flag bits, as `graph.json` carries them — so a server
   *  render can state a node's state without decoding the geometry. Optional: a
   *  manifest built before the field existed omits it. */
  flags?: number;
  dest: string | null;
};

/** The three 12-id starter lists. Ids, not nodes: resolve them against
 *  `top_nodes` for a label. */
export type GraphManifestStarters = {
  most_adopted: readonly string[];
  most_contested: readonly string[];
  newest: readonly string[];
};

export type GraphManifest = {
  format_version: number;
  generation: number;
  built_at: string;
  /** Serve-time watermark lag, computed by the handler (never the stored flag). */
  stale: boolean;
  scope: string;
  topology: string;
  counts: GraphManifestCounts;
  totals: GraphManifestCounts;
  truncated: boolean;
  trim_reason: string | null;
  labels_char_cap: number;
  formal_identity_total: number;
  bounds: GraphManifestBounds;
  band_cut_points: readonly number[];
  band_counts: readonly number[];
  /** First emitted index of the Frontier shell — the core is `[0, it)`.
   *  Optional: a manifest built before the shell existed omits it. */
  frontier_cut_point?: number;
  /** Root-relative, same-origin. */
  geometry_path: string;
  labels_path: string;
  rank_semantics: string;
  top_nodes: readonly GraphManifestTopNode[];
  /** The whole emitted graph, drawing-only — the SSR poster's input. Optional
   *  because it is additive; the poster renders empty rather than throwing. */
  poster?: GraphPosterBlock;
  starters: GraphManifestStarters;
};
