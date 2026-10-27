// The columnar wire decoder for `graph.json` and `labels.json`. Pure: no
// `three`, no `window`, no `document`.
//
// Positional, therefore version-gated: a reordered or re-typed column is silent
// corruption, so `format_version` is checked before a single column is read.
//
// The emitted node index is the ONE join key, and only within one Generation —
// no index is ever cached across Generations, and the labels decode takes the
// geometry's node count so a mismatched pair fails loudly.

import type { GraphEdgeKind, GraphNodeKind } from "@/lib/graph-kind-legend";
import { isGraphEdgeKind, isGraphNodeKind } from "@/lib/graph-kind-legend";

import { GRAPH_MANIFEST_FORMAT_VERSION } from "./graph-manifest-types";

export {
  GRAPH_FLAG_USER_AXIOM,
  GRAPH_FLAG_ISOLATED,
  GRAPH_FLAG_CONCLUDES_FALSE,
  GRAPH_FLAG_PREMISE_FREE,
  GRAPH_FLAG_SETTLED,
  GRAPH_FLAG_FALSE_PROPOSITION,
  GRAPH_FLAG_MASK,
} from "@/lib/graph-node-flags";

/** The quantisation basis the encoder published. Identical to the manifest's
 *  `bounds`, asserted cross-language. */
export type GraphQuantBasis = {
  steps: number;
  min: readonly [number, number, number];
  max: readonly [number, number, number];
};

export type DecodedGraphGeometry = {
  formatVersion: number;
  generation: number;
  nodeCount: number;
  edgeCount: number;
  quant: GraphQuantBasis;
  /** Node ids in EMISSION order. Index i is the join key for every column. */
  ids: readonly string[];
  /** Dequantised positions, xyz-interleaved. Float32 because the array is
   *  uploaded verbatim as a GPU attribute. */
  positions: Float32Array;
  kinds: readonly GraphNodeKind[];
  /** Per-node flag bits (`GRAPH_FLAG_*`). */
  flags: Uint8Array;
  /** Degree, as the builder counted it. */
  degrees: Uint32Array;
  /** holders(P) per node. Zero for every non-proposition kind, and zero when
   *  the Generation predates the column. */
  adopters: Uint32Array;
  /** holders(¬P) per node — the reject leg. See `adopters`. */
  rejecters: Uint32Array;
  /** Acknowledgers who hold neither P nor ¬P. Zero for older Generations. */
  acknowledgedUndecided: Uint32Array;
  /** Rank index (see the manifest's `rank_semantics`). */
  ranks: Uint32Array;
  edgeSrc: Uint32Array;
  edgeDst: Uint32Array;
  edgeKinds: readonly GraphEdgeKind[];
};

/** The `@handle` search lane's source: a dictionary of distinct usernames plus a
 *  FORWARD CSR over it (`off` has `count + 1` entries; node i's publishers are
 *  `idx[off[i] : off[i + 1]]`). No inverse index — a needle marks dictionary
 *  entries, then one ascending walk of `off` emits matching nodes in emission
 *  order. `lowerNames` is `names` lowercased ONCE per labels payload, the
 *  `lowerLabels` precedent. */
export type DecodedGraphPublishers = {
  readonly names: readonly string[];
  readonly lowerNames: readonly string[];
  readonly off: Uint32Array;
  readonly idx: Uint32Array;
};

export type DecodedGraphLabels = {
  ids: readonly string[];
  labels: readonly string[];
  kinds: readonly GraphNodeKind[];
  /** Zero-based rank band. Also derivable from the manifest alone (see
   *  `graphBandForIndex`), so the arrival never waits on this fetch. */
  bands: Uint8Array;
  /** Negation partner's node index, or -1 when the partner is not in this
   *  Generation. */
  neg: Int32Array;
  /** `null` when this Generation's index carries no publisher block — the keys
   *  absent (a pre-feature Generation, or the heal's publisher-drop rung),
   *  explicitly `null`, or present but malformed. Required, never optional: the
   *  three states a consumer must distinguish are "block", "no block" and a
   *  decode failure, and an optional field would quietly add a fourth. */
  publishers: DecodedGraphPublishers | null;
};

/** Why a decode produced no payload. `format_version` is its own outcome, not a
 *  flavour of `malformed`: it means "this release is too old", not "these bytes
 *  are corrupt". */
export type GraphDecodeFailure =
  | { status: "format_version"; got: number; want: number }
  | { status: "malformed"; detail: string };

export type GraphGeometryDecode =
  | { status: "ok"; geometry: DecodedGraphGeometry }
  | GraphDecodeFailure;

export type GraphLabelsDecode =
  | { status: "ok"; labels: DecodedGraphLabels }
  | GraphDecodeFailure;

/** The inverse of the Go encoder's coordinate quantisation. Operation order
 *  mirrors `DequantizeGeometryCoord` exactly — `q * span`, then the divide — so
 *  both languages produce the same bits. A degenerate axis returns `lo`. */
export function dequantizeGraphCoord(
  q: number,
  lo: number,
  hi: number,
  steps: number,
): number {
  const span = hi - lo;
  if (!(span > 0)) return lo;
  return lo + (q * span) / steps;
}

/** The rank band of emitted node `index`, from `band_cut_points` alone — no
 *  `labels.json` dependency, which is why the arrival never waits on that fetch.
 *  Out-of-range indices clamp rather than throw.
 *
 *  CORE-ONLY, deliberately. `band_cut_points` describes the core, so an index at
 *  or past the manifest's `frontier_cut_point` derives `shellBands - 1` while
 *  `labels.bands[i]` carries the Frontier band. That is the right answer for the
 *  ONE consumer — the arrival's band stagger, whose last step already runs to
 *  `nodeCount` and therefore blooms the Frontier with the outermost wave — and
 *  it is why nothing derives a band LABEL from this (that would read "Band 6 of
 *  5"). Do not "fix" it into a sixth step. */
export function graphBandForIndex(
  bandCutPoints: readonly number[],
  index: number,
): number {
  if (bandCutPoints.length === 0) return 0;
  let band = 0;
  for (let b = 0; b < bandCutPoints.length; b++) {
    if (index >= bandCutPoints[b]) band = b;
    else break;
  }
  return band;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
  }
  return value as number[];
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (typeof entry !== "string") return null;
  }
  return value as string[];
}

function triple(value: unknown): [number, number, number] | null {
  const nums = numberArray(value);
  if (!nums || nums.length !== 3) return null;
  return [nums[0], nums[1], nums[2]];
}

function malformed(detail: string): GraphDecodeFailure {
  return { status: "malformed", detail };
}

/** Decode `labels.json`'s publisher block, or `null`.
 *
 *  A missing key and an explicit `null` are the SAME state here — a Generation
 *  that predates the block, and the heal's publisher-drop rung, which omits the
 *  keys entirely — and neither may fail the decode. Nor may a malformed block:
 *  the publisher lane is one of three search lanes, so a bad CSR costs the page
 *  `@handle` search and NEVER its labels. Validation mirrors `neg[]`'s: cheap,
 *  total, and degrading to the "no block" state rather than throwing. */
function decodeGraphPublishers(
  raw: Record<string, unknown>,
  count: number,
): DecodedGraphPublishers | null {
  const pubsRaw = raw.pubs;
  const offRaw = raw.pub_off;
  const idxRaw = raw.pub_idx;
  const missing = (value: unknown): boolean =>
    value === undefined || value === null;
  // The three keys are present or absent TOGETHER on the wire; a partial block
  // is as unusable as none.
  if (missing(pubsRaw) && missing(offRaw) && missing(idxRaw)) return null;
  if (missing(pubsRaw) || missing(offRaw) || missing(idxRaw)) return null;

  const names = stringArray(pubsRaw);
  const off = numberArray(offRaw);
  const idx = numberArray(idxRaw);
  if (!names || !off || !idx) return null;

  // `pub_off` is indexed by node and carries the closing offset.
  if (off.length !== count + 1) return null;
  if (off[0] !== 0) return null;
  for (let i = 0; i < off.length; i++) {
    if (!Number.isInteger(off[i]) || off[i] < 0) return null;
    if (i > 0 && off[i] < off[i - 1]) return null;
  }
  // The closing offset IS the flat array's length; anything else would walk a
  // node's slice off the end of `pub_idx`.
  if (off[count] !== idx.length) return null;
  for (let i = 0; i < idx.length; i++) {
    if (!Number.isInteger(idx[i]) || idx[i] < 0 || idx[i] >= names.length) {
      return null;
    }
  }

  return {
    names,
    // Once per labels payload, never per keystroke — the `lowerLabels`
    // precedent, and what makes an `@` query O(dictionary) substring tests.
    lowerNames: names.map((name) => name.toLowerCase()),
    off: Uint32Array.from(off),
    idx: Uint32Array.from(idx),
  };
}

/** Decode `graph.json`. `expectedFormatVersion` defaults to the same constant
 *  the server half's manifest reader gates on, imported rather than restated. */
export function decodeGraphGeometry(
  raw: unknown,
  expectedFormatVersion: number = GRAPH_MANIFEST_FORMAT_VERSION,
): GraphGeometryDecode {
  if (!isRecord(raw)) return malformed("payload is not an object");

  // Before any column is read: the columns are positional.
  const formatVersion = raw.format_version;
  if (typeof formatVersion !== "number") {
    return malformed("format_version is missing or not a number");
  }
  if (formatVersion !== expectedFormatVersion) {
    return {
      status: "format_version",
      got: formatVersion,
      want: expectedFormatVersion,
    };
  }

  const nodeCount = raw.node_count;
  const edgeCount = raw.edge_count;
  if (
    typeof nodeCount !== "number" ||
    !Number.isInteger(nodeCount) ||
    nodeCount < 0
  ) {
    return malformed("node_count is missing or not a non-negative integer");
  }
  if (
    typeof edgeCount !== "number" ||
    !Number.isInteger(edgeCount) ||
    edgeCount < 0
  ) {
    return malformed("edge_count is missing or not a non-negative integer");
  }

  const quantRaw = raw.quant;
  if (!isRecord(quantRaw)) return malformed("quant is missing");
  const steps = quantRaw.steps;
  const min = triple(quantRaw.min);
  const max = triple(quantRaw.max);
  if (typeof steps !== "number" || !Number.isInteger(steps) || steps <= 0) {
    return malformed("quant.steps is not a positive integer");
  }
  if (!min || !max) return malformed("quant.min/quant.max are not [x, y, z]");

  const nodes = raw.nodes;
  if (!isRecord(nodes)) return malformed("nodes is missing");
  const ids = stringArray(nodes.id);
  const xs = numberArray(nodes.x);
  const ys = numberArray(nodes.y);
  const zs = numberArray(nodes.z);
  const kindsRaw = stringArray(nodes.kind);
  const flagsRaw = numberArray(nodes.flags);
  const degRaw = numberArray(nodes.deg);
  const rankRaw = numberArray(nodes.rank);
  // Out of `nodeColumns` on purpose: `adopt` / `ack` / `reject` are additive columns
  // carried without a format-version bump, so a Generation may legitimately
  // have none.
  const adoptRaw = numberArray(nodes.adopt);
  const ackRaw = numberArray(nodes.ack);
  const rejectRaw = numberArray(nodes.reject);
  const nodeColumns: Record<string, readonly unknown[] | null> = {
    id: ids,
    x: xs,
    y: ys,
    z: zs,
    kind: kindsRaw,
    flags: flagsRaw,
    deg: degRaw,
    rank: rankRaw,
  };
  for (const [name, column] of Object.entries(nodeColumns)) {
    if (!column) return malformed(`nodes.${name} is missing or mistyped`);
    // A short column reads `undefined` past the end, coerces to NaN and puts a
    // node at the origin; length equality is the only cheap guard.
    if (column.length !== nodeCount) {
      return malformed(
        `nodes.${name} has ${column.length} entries, want node_count ${nodeCount}`,
      );
    }
  }

  const edges = raw.edges;
  if (!isRecord(edges)) return malformed("edges is missing");
  const srcRaw = numberArray(edges.src);
  const dstRaw = numberArray(edges.dst);
  const edgeKindsRaw = stringArray(edges.kind);
  const edgeColumns: Record<string, readonly unknown[] | null> = {
    src: srcRaw,
    dst: dstRaw,
    kind: edgeKindsRaw,
  };
  for (const [name, column] of Object.entries(edgeColumns)) {
    if (!column) return malformed(`edges.${name} is missing or mistyped`);
    if (column.length !== edgeCount) {
      return malformed(
        `edges.${name} has ${column.length} entries, want edge_count ${edgeCount}`,
      );
    }
  }

  const positions = new Float32Array(nodeCount * 3);
  const flags = new Uint8Array(nodeCount);
  const degrees = new Uint32Array(nodeCount);
  const ranks = new Uint32Array(nodeCount);
  const adopters = new Uint32Array(nodeCount);
  const acknowledgedUndecided = new Uint32Array(nodeCount);
  const rejecters = new Uint32Array(nodeCount);
  const kinds: GraphNodeKind[] = new Array(nodeCount);

  for (let i = 0; i < nodeCount; i++) {
    positions[i * 3] = dequantizeGraphCoord(xs![i], min[0], max[0], steps);
    positions[i * 3 + 1] = dequantizeGraphCoord(ys![i], min[1], max[1], steps);
    positions[i * 3 + 2] = dequantizeGraphCoord(zs![i], min[2], max[2], steps);
    const kind = kindsRaw![i];
    if (!isGraphNodeKind(kind)) {
      return malformed(`nodes.kind[${i}] = "${kind}" has no Kind Legend entry`);
    }
    kinds[i] = kind;
    flags[i] = flagsRaw![i] & 0xff;
    degrees[i] = degRaw![i];
    ranks[i] = rankRaw![i];
    // An absent or short column means "unknown", which renders as no ring —
    // never as a ring claiming 0/0.
    adopters[i] =
      adoptRaw && adoptRaw.length === nodeCount ? (adoptRaw[i] ?? 0) : 0;
    acknowledgedUndecided[i] =
      ackRaw && ackRaw.length === nodeCount ? (ackRaw[i] ?? 0) : 0;
    rejecters[i] =
      rejectRaw && rejectRaw.length === nodeCount ? (rejectRaw[i] ?? 0) : 0;
  }

  const edgeSrc = new Uint32Array(edgeCount);
  const edgeDst = new Uint32Array(edgeCount);
  const edgeKinds: GraphEdgeKind[] = new Array(edgeCount);
  for (let i = 0; i < edgeCount; i++) {
    const s = srcRaw![i];
    const d = dstRaw![i];
    if (
      !Number.isInteger(s) ||
      !Number.isInteger(d) ||
      s < 0 ||
      d < 0 ||
      s >= nodeCount ||
      d >= nodeCount
    ) {
      return malformed(
        `edges[${i}] = (${s}, ${d}) points outside [0, ${nodeCount})`,
      );
    }
    edgeSrc[i] = s;
    edgeDst[i] = d;
    const kind = edgeKindsRaw![i];
    if (!isGraphEdgeKind(kind)) {
      return malformed(`edges.kind[${i}] = "${kind}" has no Kind Legend entry`);
    }
    edgeKinds[i] = kind;
  }

  const generation = typeof raw.generation === "number" ? raw.generation : 0;

  return {
    status: "ok",
    geometry: {
      formatVersion,
      generation,
      nodeCount,
      edgeCount,
      quant: { steps, min, max },
      ids: ids!,
      positions,
      kinds,
      flags,
      degrees,
      ranks,
      adopters,
      acknowledgedUndecided,
      rejecters,
      edgeSrc,
      edgeDst,
      edgeKinds,
    },
  };
}

/** Decode `labels.json`. `expectedNodeCount` is the join guard: `labels.json`
 *  carries no `format_version` of its own, so a labels artifact from a different
 *  Generation must fail here rather than silently shift every claim by one. */
export function decodeGraphLabels(
  raw: unknown,
  expectedNodeCount: number | null,
): GraphLabelsDecode {
  if (!isRecord(raw)) return malformed("payload is not an object");

  const ids = stringArray(raw.id);
  const labels = stringArray(raw.label);
  const kindsRaw = stringArray(raw.kind);
  const bandsRaw = numberArray(raw.band);
  const negRaw = numberArray(raw.neg);
  const columns: Record<string, readonly unknown[] | null> = {
    id: ids,
    label: labels,
    kind: kindsRaw,
    band: bandsRaw,
    neg: negRaw,
  };
  for (const [name, column] of Object.entries(columns)) {
    if (!column) return malformed(`${name} is missing or mistyped`);
  }

  const count = ids!.length;
  for (const [name, column] of Object.entries(columns)) {
    if (column!.length !== count) {
      return malformed(
        `column ${name} has ${column!.length} entries, want ${count}`,
      );
    }
  }
  if (expectedNodeCount !== null && count !== expectedNodeCount) {
    return malformed(
      `labels describe ${count} nodes but the geometry has ${expectedNodeCount} — the two artifacts are from different Generations`,
    );
  }

  const kinds: GraphNodeKind[] = new Array(count);
  const bands = new Uint8Array(count);
  const neg = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const kind = kindsRaw![i];
    if (!isGraphNodeKind(kind)) {
      return malformed(`kind[${i}] = "${kind}" has no Kind Legend entry`);
    }
    kinds[i] = kind;
    bands[i] = bandsRaw![i] & 0xff;
    const partner = negRaw![i];
    // -1 (no partner in this Generation) is the only legal negative: anything
    // else would point the "Negates" line at a node that is not here.
    neg[i] =
      partner === -1 ||
      (Number.isInteger(partner) && partner >= 0 && partner < count)
        ? partner
        : -1;
  }

  return {
    status: "ok",
    labels: {
      ids: ids!,
      labels: labels!,
      kinds,
      bands,
      neg,
      publishers: decodeGraphPublishers(raw, count),
    },
  };
}
