// Pure: no `three`, no `window`, no `document` — the poster and the OG route
// import this module.
// Instanced quads, not `THREE.Points`: points cull by centroid and `gl_PointSize`
// is driver-capped, so the same scene renders at different sizes per GPU.

import {
  KIND_LEGEND_BY_KIND,
  type GraphEdgeKind,
  type GraphKind,
  type GraphNodeKind,
  kindLegendColor,
} from "@/lib/graph-kind-legend";
import type { ResolvedMode } from "@/lib/theme/apply-theme";

import {
  GRAPH_FLAG_FALSE_PROPOSITION,
  GRAPH_FLAG_SETTLED,
  type DecodedGraphGeometry,
} from "./graph-wire";

/** The one bit the node shader reads: draw a ring. Derived from the wire flags
 *  by `isRinged`, never copied from them. */
export const GRAPH_RING_BIT = 1;

// Module constants, per the config surface: never operator levers, never env vars.

/** Samples per entailment arc. */
export const GRAPH_ARC_SEGMENTS = 8;

/** Arc height as a fraction of the chord length. */
export const GRAPH_ARC_LIFT = 0.18;

/** Past this many highlight segments the fat-line renderer is dropped for plain
 *  lines: `LineSegments2` expands every segment into an instanced quad pair. */
export const GRAPH_HIGHLIGHT_FAT_LINE_MAX_SEGMENTS = 500;

/** The whole scene's draw-call ceiling, at rest and under selection. Asserted. */
export const GRAPH_MAX_DRAW_CALLS = 6;

/** Particles per incident arc; the draw-call plan states this layer's instance count. */
export const GRAPH_PARTICLES_PER_EDGE = 3;

/** Device-pixel-ratio ceilings; mobile is where the frame budget binds. */
export const GRAPH_DPR_MAX_DESKTOP = 2;
export const GRAPH_DPR_MAX_MOBILE = 1.5;

/** Node disc radius in normalised world units (roughly [-1, 1], see `graphSceneBasis`). */
const NODE_RADIUS_BASE = 0.005;
/** Growth with degree — `sqrt`, so a 100-degree hub is 10× a leaf's area. */
const NODE_RADIUS_PER_SQRT_DEGREE = 0.0026;
const NODE_RADIUS_MAX = 0.02;
/** Applied AFTER the cap: raising `NODE_RADIUS_MAX` for this one node would
 *  re-bunch every dense region. */
const NODE_RADIUS_FALSE_MULTIPLE = 2.5;

/** Arrowhead cone height in world units — one size for the whole graph. */
export const GRAPH_ARROW_LENGTH = 0.009;
/** Where along the arc the glyph sits; the midpoint is an arc's emptiest part. */
export const GRAPH_ARROW_REL_POS = 0.5;

/** How far a de-emphasised node fades. Not zero: it must stay locatable. */
export const GRAPH_DIM_ALPHA = 0.12;
/** What the base edge layers drop to under a selection — one uniform, so edge
 *  dimming needs no per-edge attribute and no extra draw call. */
export const GRAPH_EDGE_DIM_FACTOR = 0.25;
/** The selection highlight's alpha. The arrowheads on those same arcs are lifted
 *  to it, so the glyph and the arc it annotates read as ONE mark. */
export const GRAPH_HIGHLIGHT_OPACITY = 1;

/** The entailment web — the bulk of the arcs, and a directed layer. */
const ENTAILS_OPACITY = 0.325;
/** Negation is the loud exception in a field of quiet arcs. */
const NEGATES_OPACITY = 0.425;
/** The hero draws the same scene behind page copy, at half the ink. */
const LANDING_EDGE_OPACITY_SCALE = 0.5;

/** Dash geometry for the `negates` layer, in normalised world units. */
export const GRAPH_NEGATES_DASH_SIZE = 0.02;
export const GRAPH_NEGATES_GAP_SIZE = 0.014;

/** Which surface is drawing the scene. Edge opacity is the ONE thing the two
 *  diverge on — the picture is otherwise shared. */
export type GraphSurface = "graph" | "landing";

/** A surface's at-rest edge alphas, arrowheads included: they follow their own
 *  surface's `entails` and never carry a number of their own. */
export type GraphEdgeOpacities = {
  entails: number;
  negates: number;
  arrow: number;
};

/** The one derivation of a surface's edge alphas. The island stores what this
 *  returns on the scene, so no writer re-derives them per frame. */
export function graphEdgeOpacities(surface: GraphSurface): GraphEdgeOpacities {
  const scale = surface === "landing" ? LANDING_EDGE_OPACITY_SCALE : 1;
  const entails = ENTAILS_OPACITY * scale;
  return { entails, negates: NEGATES_OPACITY * scale, arrow: entails };
}

/** Clamp the renderer's device pixel ratio. The floor of 1 matters as much as
 *  the ceiling: a headless or downscaled context can report a fraction. */
export function clampGraphDevicePixelRatio(
  devicePixelRatio: number,
  isMobile: boolean,
): number {
  const ceiling = isMobile ? GRAPH_DPR_MAX_MOBILE : GRAPH_DPR_MAX_DESKTOP;
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(Math.max(devicePixelRatio, 1), ceiling);
}

/** Linear-ish 0..1 RGB, which is what a GPU attribute wants. */
export type GraphRgb = readonly [number, number, number];

export type GraphSceneColors = Readonly<Record<GraphKind, GraphRgb>>;

/** Every Kind Legend colour for a theme mode. Through the Kind Legend and
 *  nowhere else: a second colour table is a legend that can be silently wrong. */
export function graphSceneColors(mode: ResolvedMode): GraphSceneColors {
  const out: Partial<Record<GraphKind, GraphRgb>> = {};
  for (const entry of KIND_LEGEND_BY_KIND.values()) {
    const [r, g, b] = kindLegendColor(entry.kind, mode);
    out[entry.kind] = [r / 255, g / 255, b / 255];
  }
  return out as GraphSceneColors;
}

/** How layout coordinates map into scene space: `world = (layout - center) * scale`. */
export type GraphSceneBasis = {
  center: readonly [number, number, number];
  scale: number;
  /** Half-extent of the normalised cloud — what the camera frames. */
  radius: number;
};

/** The canonical world basis, derived from the quantisation bounds rather than
 *  the decoded positions, so the server half can compute it without the geometry.
 *  It is NOT the poster's framing: narrowing it to the drawn subset would
 *  rescale the whole scene, the camera clamps included. */
export function graphSceneBasis(
  bounds: Pick<DecodedGraphGeometry["quant"], "min" | "max">,
): GraphSceneBasis {
  const { min, max } = bounds;
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const scale = extent > 0 ? 2 / extent : 1;
  return { center, scale, radius: extent > 0 ? 1 : 0 };
}

export type GraphNodeLayer = {
  count: number;
  /** Instance offsets, xyz-interleaved (`count * 3`). */
  offsets: Float32Array;
  /** Instance colours, rgb-interleaved (`count * 3`). */
  colors: Float32Array;
  /** Instance disc radii in world units (`count`). */
  sizes: Float32Array;
  /** Instance flag bits as floats (`count`); only `GRAPH_RING_BIT` is read. */
  flags: Float32Array;
  /** Per-instance emphasis (`count`), multiplied into the fragment's alpha: 1.0
   *  normal, `GRAPH_DIM_ALPHA` dimmed, 0.0 hidden. Rewritten in place, because a
   *  selection must never rebuild the scene model. */
  dims: Float32Array;
  /** Per-instance cumulative Adopt and Acknowledgement fractions (`count * 2`). */
  ringFractions: Float32Array;
};

export type GraphEdgeLayer = {
  kind: GraphEdgeKind;
  /** Number of line SEGMENTS (each is two vertices). */
  segmentCount: number;
  /** Segment endpoints, xyz-interleaved (`segmentCount * 2 * 3`). */
  positions: Float32Array;
  /** Per-vertex distance along the WHOLE arc, for `LineDashedMaterial`: three's
   *  `computeLineDistances()` restarts at 0 per segment pair, which renders every
   *  chord solid. */
  distances: Float32Array;
  /** Wire edge indices for this layer; only populated for `entails`. */
  edgeIndices?: readonly number[];
};

/** One arrowhead per `entails` edge, sampled on the arc along the curve's tangent. */
export type GraphArrowLayer = {
  count: number;
  /** Cone base-center positions, xyz-interleaved (`count * 3`). */
  positions: Float32Array;
  /** Unit directions premise → conclusion, xyz-interleaved (`count * 3`). */
  directions: Float32Array;
  /** Cone heights in world units (`count`). */
  lengths: Float32Array;
  /** Wire edge index per instance (`count`). The build SKIPS degenerate edges,
   *  so an instance's ordinal is not its edge's — a selection that only knows
   *  edges has no other way back to the instances it owns. */
  edgeIndices: readonly number[];
};

export type GraphSceneModel = {
  basis: GraphSceneBasis;
  nodes: GraphNodeLayer;
  entails: GraphEdgeLayer;
  negates: GraphEdgeLayer;
  /** Entailment direction, drawn as instanced cones. */
  arrows: GraphArrowLayer;
};

export type GraphHighlightModel = {
  /** The fat-line renderer, or the plain fallback past the segment cap. One
   *  draw call either way. */
  renderer: "line-segments-2" | "line-segments";
  segmentCount: number;
  positions: Float32Array;
  /** Edge indices contributing to the highlight, in wire order. */
  edgeIndices: readonly number[];
};

export type GraphDrawCallId =
  | "nodes"
  | "entails"
  | "negates"
  | "arrows"
  | "highlight"
  | "particles";

export type GraphDrawCall = {
  id: GraphDrawCallId;
  /** `instanced-quads` covers every INSTANCED mesh, whatever its unit geometry:
   *  what the budget records is that the whole layer is one call. */
  primitive: "instanced-quads" | "line-segments" | "line-segments-2";
  /** Instances for the instanced layers; segments for the line layers. */
  count: number;
};

function nodeRadius(degree: number, isFalseProposition = false): number {
  const r = Math.min(
    NODE_RADIUS_BASE +
      Math.sqrt(Math.max(degree, 0)) * NODE_RADIUS_PER_SQRT_DEGREE,
    NODE_RADIUS_MAX,
  );
  // AFTER the cap, deliberately — see NODE_RADIUS_FALSE_MULTIPLE.
  return isFalseProposition ? r * NODE_RADIUS_FALSE_MULTIPLE : r;
}

/** The ring channel carries public formal-stance proportions, not wire flags. */
export function isRinged(
  adopters: number,
  acknowledgedUndecided: number,
  rejecters: number,
): boolean {
  return adopters + acknowledgedUndecided + rejecters > 0;
}

/** Cumulative segment boundaries in Adopt, acknowledged-neutral, Reject order. */
export function ringFractions(
  adopters: number,
  acknowledgedUndecided: number,
  rejecters: number,
): readonly [number, number] {
  const total = adopters + acknowledgedUndecided + rejecters;
  if (total <= 0) return [1, 1];
  return [adopters / total, (adopters + acknowledgedUndecided) / total];
}

/** A node's colour: its STATE if it has one, otherwise its kind. Precedence is
 *  False → settled → kind, so a node that is both paints red. */
export function nodeColor(
  kind: string,
  wireFlags: number,
  colors: GraphSceneColors,
): GraphRgb {
  if (wireFlags & GRAPH_FLAG_FALSE_PROPOSITION) {
    return colors["false-proposition"];
  }
  if (wireFlags & GRAPH_FLAG_SETTLED) return colors.settled;
  // Everything else falls to its KIND; adoption is the RING, not a colour.
  return colors[kind as GraphNodeKind];
}

/** The control point of an edge's quadratic Bezier, bowed AWAY from the origin.
 *  A midpoint on the origin falls back to +y: one NaN vertex takes the whole
 *  draw call with it. */
function arcControlPoint(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): [number, number, number] {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const mz = (az + bz) / 2;
  const chord = Math.hypot(bx - ax, by - ay, bz - az);
  const lift = chord * GRAPH_ARC_LIFT;
  const mag = Math.hypot(mx, my, mz);
  if (!(mag > 1e-9)) return [mx, my + lift, mz];
  return [
    mx + (mx / mag) * lift,
    my + (my / mag) * lift,
    mz + (mz / mag) * lift,
  ];
}

function bezierPoint(t: number, a: number, c: number, b: number): number {
  const u = 1 - t;
  return u * u * a + 2 * u * t * c + t * t * b;
}

/** A point at `t` along the SAME arc the edge layers draw. `ax..bz` are already
 *  in scene space, so this does no centring or scaling of its own. */
export function graphArcPointAt(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  t: number,
): [number, number, number] {
  const [cx, cy, cz] = arcControlPoint(ax, ay, az, bx, by, bz);
  return [
    bezierPoint(t, ax, cx, bx),
    bezierPoint(t, ay, cy, by),
    bezierPoint(t, az, cz, bz),
  ];
}

/** Sample arcs into a flat `LineSegments` buffer; distances accumulate along the arc. */
function buildArcBuffer(
  geometry: DecodedGraphGeometry,
  basis: GraphSceneBasis,
  edgeIndices: readonly number[],
  segments: number,
): { positions: Float32Array; distances: Float32Array; segmentCount: number } {
  const segmentsPerArc = Math.max(1, segments);
  const segmentCount = edgeIndices.length * segmentsPerArc;
  const positions = new Float32Array(segmentCount * 2 * 3);
  const distances = new Float32Array(segmentCount * 2);
  const { center, scale } = basis;

  let p = 0;
  let d = 0;
  for (const edgeIndex of edgeIndices) {
    const s = geometry.edgeSrc[edgeIndex];
    const t = geometry.edgeDst[edgeIndex];
    const ax = (geometry.positions[s * 3] - center[0]) * scale;
    const ay = (geometry.positions[s * 3 + 1] - center[1]) * scale;
    const az = (geometry.positions[s * 3 + 2] - center[2]) * scale;
    const bx = (geometry.positions[t * 3] - center[0]) * scale;
    const by = (geometry.positions[t * 3 + 1] - center[1]) * scale;
    const bz = (geometry.positions[t * 3 + 2] - center[2]) * scale;
    const [cx, cy, cz] = arcControlPoint(ax, ay, az, bx, by, bz);

    let prevX = ax;
    let prevY = ay;
    let prevZ = az;
    let travelled = 0;
    for (let i = 1; i <= segmentsPerArc; i++) {
      const u = i / segmentsPerArc;
      const nx = bezierPoint(u, ax, cx, bx);
      const ny = bezierPoint(u, ay, cy, by);
      const nz = bezierPoint(u, az, cz, bz);

      positions[p++] = prevX;
      positions[p++] = prevY;
      positions[p++] = prevZ;
      positions[p++] = nx;
      positions[p++] = ny;
      positions[p++] = nz;

      distances[d++] = travelled;
      travelled += Math.hypot(nx - prevX, ny - prevY, nz - prevZ);
      distances[d++] = travelled;

      prevX = nx;
      prevY = ny;
      prevZ = nz;
    }
  }

  return { positions, distances, segmentCount };
}

export type GraphSceneOptions = {
  /** Chords per arc; exposed so lowering it is a call-site change. */
  arcSegments?: number;
};

/** Build the at-rest scene. EXACTLY TWO edge layers, split by kind and never by
 *  anything else: they need different materials, and a material change is a draw
 *  call whatever the geometry does. */
export function buildGraphSceneModel(
  geometry: DecodedGraphGeometry,
  colors: GraphSceneColors,
  options: GraphSceneOptions = {},
): GraphSceneModel {
  const basis = graphSceneBasis(geometry.quant);
  const { center, scale } = basis;
  const count = geometry.nodeCount;

  const offsets = new Float32Array(count * 3);
  const nodeColors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const flags = new Float32Array(count);
  const dims = new Float32Array(count).fill(1);
  const ringFractionAttributes = new Float32Array(count * 2).fill(1);

  for (let i = 0; i < count; i++) {
    offsets[i * 3] = (geometry.positions[i * 3] - center[0]) * scale;
    offsets[i * 3 + 1] = (geometry.positions[i * 3 + 1] - center[1]) * scale;
    offsets[i * 3 + 2] = (geometry.positions[i * 3 + 2] - center[2]) * scale;

    const rgb = nodeColor(geometry.kinds[i], geometry.flags[i], colors);
    nodeColors[i * 3] = rgb[0];
    nodeColors[i * 3 + 1] = rgb[1];
    nodeColors[i * 3 + 2] = rgb[2];

    sizes[i] = nodeRadius(
      geometry.degrees[i],
      (geometry.flags[i] & GRAPH_FLAG_FALSE_PROPOSITION) !== 0,
    );
    // Only the bits the shader reads travel to the GPU: the raw byte would let
    // an appended wire bit change the render without a code change.
    const adopt = geometry.adopters[i] ?? 0;
    const acknowledged = geometry.acknowledgedUndecided[i] ?? 0;
    const reject = geometry.rejecters[i] ?? 0;
    flags[i] = isRinged(adopt, acknowledged, reject) ? GRAPH_RING_BIT : 0;
    const fractions = ringFractions(adopt, acknowledged, reject);
    ringFractionAttributes[i * 2] = fractions[0];
    ringFractionAttributes[i * 2 + 1] = fractions[1];
  }

  const entailsEdges: number[] = [];
  const negatesEdges: number[] = [];
  for (let e = 0; e < geometry.edgeCount; e++) {
    (geometry.edgeKinds[e] === "negates" ? negatesEdges : entailsEdges).push(e);
  }

  const arcSegments = options.arcSegments ?? GRAPH_ARC_SEGMENTS;
  const entails = buildArcBuffer(geometry, basis, entailsEdges, arcSegments);
  const negates = buildArcBuffer(geometry, basis, negatesEdges, arcSegments);

  const arrowPositions = new Float32Array(entailsEdges.length * 3);
  const arrowDirections = new Float32Array(entailsEdges.length * 3);
  const arrowLengths = new Float32Array(entailsEdges.length);
  const arrowEdges: number[] = [];
  let arrowCount = 0;
  for (const e of entailsEdges) {
    const s = geometry.edgeSrc[e];
    const d = geometry.edgeDst[e];
    const ax = offsets[s * 3],
      ay = offsets[s * 3 + 1],
      az = offsets[s * 3 + 2];
    const bx = offsets[d * 3],
      by = offsets[d * 3 + 1],
      bz = offsets[d * 3 + 2];
    const chord = Math.hypot(bx - ax, by - ay, bz - az);
    if (chord < 1e-6) continue;
    const [cx, cy, cz] = arcControlPoint(ax, ay, az, bx, by, bz);
    // Tangent AT THE SAMPLE POINT: a chord-aligned cone visibly detaches from
    // its own curve wherever the arc bows.
    const tt = GRAPH_ARROW_REL_POS;
    let vx = 2 * (1 - tt) * (cx - ax) + 2 * tt * (bx - cx),
      vy = 2 * (1 - tt) * (cy - ay) + 2 * tt * (by - cy),
      vz = 2 * (1 - tt) * (cz - az) + 2 * tt * (bz - cz);
    const tan = Math.hypot(vx, vy, vz);
    if (tan < 1e-6) continue;
    vx /= tan;
    vy /= tan;
    vz /= tan;
    const coneLen = Math.min(GRAPH_ARROW_LENGTH, chord * 0.5);
    // Sampled on the arc, so the glyph sits ON the curve it annotates.
    const t = GRAPH_ARROW_REL_POS;
    arrowPositions[arrowCount * 3] = bezierPoint(t, ax, cx, bx);
    arrowPositions[arrowCount * 3 + 1] = bezierPoint(t, ay, cy, by);
    arrowPositions[arrowCount * 3 + 2] = bezierPoint(t, az, cz, bz);
    arrowDirections[arrowCount * 3] = vx;
    arrowDirections[arrowCount * 3 + 1] = vy;
    arrowDirections[arrowCount * 3 + 2] = vz;
    arrowLengths[arrowCount] = coneLen;
    arrowEdges.push(e);
    arrowCount++;
  }

  return {
    basis,
    nodes: {
      count,
      offsets,
      colors: nodeColors,
      sizes,
      flags,
      dims,
      ringFractions: ringFractionAttributes,
    },
    entails: { kind: "entails", ...entails, edgeIndices: entailsEdges },
    negates: { kind: "negates", ...negates },
    arrows: {
      count: arrowCount,
      positions: arrowPositions.subarray(0, arrowCount * 3),
      directions: arrowDirections.subarray(0, arrowCount * 3),
      lengths: arrowLengths.subarray(0, arrowCount),
      edgeIndices: arrowEdges,
    },
  };
}

/** The arrowheads' per-instance alpha multiplier. 1 leaves an instance on the
 *  material's own opacity; an arrowhead whose edge the highlight draws gets the
 *  ratio that lifts it from there to `GRAPH_HIGHLIGHT_OPACITY`. A material at
 *  zero — the arrival's first frames — lifts nothing: the layer is invisible and
 *  the ratio is unbounded. Returns whether any instance ended up lifted. */
export function writeGraphArrowEmphasis(
  values: Float32Array,
  edgeIndices: readonly number[],
  incidentEdges: ReadonlySet<number> | null,
  materialOpacity: number,
): boolean {
  const lift =
    incidentEdges && materialOpacity > 0
      ? GRAPH_HIGHLIGHT_OPACITY / materialOpacity
      : 1;
  let lifted = false;
  for (let i = 0; i < values.length; i++) {
    const emphasised = lift !== 1 && !!incidentEdges?.has(edgeIndices[i]);
    values[i] = emphasised ? lift : 1;
    lifted ||= emphasised;
  }
  return lifted;
}

/** The arcs incident to one node. `null` for no selection or an isolated node —
 *  an empty layer would still be a draw call. */
export function buildGraphHighlight(
  geometry: DecodedGraphGeometry,
  basis: GraphSceneBasis,
  selectedIndex: number | null,
  options: GraphSceneOptions = {},
): GraphHighlightModel | null {
  if (selectedIndex === null) return null;
  if (selectedIndex < 0 || selectedIndex >= geometry.nodeCount) return null;

  const edgeIndices: number[] = [];
  for (let e = 0; e < geometry.edgeCount; e++) {
    if (
      geometry.edgeSrc[e] === selectedIndex ||
      geometry.edgeDst[e] === selectedIndex
    ) {
      edgeIndices.push(e);
    }
  }
  if (edgeIndices.length === 0) return null;

  const arcSegments = options.arcSegments ?? GRAPH_ARC_SEGMENTS;
  const { positions, segmentCount } = buildArcBuffer(
    geometry,
    basis,
    edgeIndices,
    arcSegments,
  );

  return {
    renderer:
      segmentCount <= GRAPH_HIGHLIGHT_FAT_LINE_MAX_SEGMENTS
        ? "line-segments-2"
        : "line-segments",
    segmentCount,
    positions,
    edgeIndices,
  };
}

/** The complete draw-call plan for a frame; an empty layer contributes nothing.
 *  The island builds its objects from this plan, so the budget assertion binds. */
export function graphSceneDrawCalls(
  model: GraphSceneModel,
  highlight: GraphHighlightModel | null,
): readonly GraphDrawCall[] {
  const calls: GraphDrawCall[] = [];
  if (model.nodes.count > 0) {
    calls.push({
      id: "nodes",
      primitive: "instanced-quads",
      count: model.nodes.count,
    });
  }
  if (model.entails.segmentCount > 0) {
    calls.push({
      id: "entails",
      primitive: "line-segments",
      count: model.entails.segmentCount,
    });
  }
  if (model.negates.segmentCount > 0) {
    calls.push({
      id: "negates",
      primitive: "line-segments",
      count: model.negates.segmentCount,
    });
  }
  if (model.arrows.count > 0) {
    calls.push({
      id: "arrows",
      primitive: "instanced-quads",
      count: model.arrows.count,
    });
  }
  if (highlight && highlight.segmentCount > 0) {
    calls.push({
      id: "highlight",
      primitive: highlight.renderer,
      count: highlight.segmentCount,
    });
    // Planned unconditionally with the highlight, even though the island skips
    // it under `prefers-reduced-motion`: the plan is a CEILING.
    calls.push({
      id: "particles",
      primitive: "instanced-quads",
      count: highlight.edgeIndices.length * GRAPH_PARTICLES_PER_EDGE,
    });
  }
  return calls;
}
