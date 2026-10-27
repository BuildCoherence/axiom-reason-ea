// Picking is the island's vertex shader in reverse: a disc's radius is exactly
// `iSize` view-space units, so projecting that displacement gives its true
// on-screen radius. The overlay label rides the same projection, so it can never
// name a different node than a click resolves. No `three`, `window` or `document`.

import type { GraphNodeLayer } from "./graph-scene-model";

/** Column-major 4×4, i.e. three's `Matrix4.elements` verbatim. */
export type GraphMatrix4 = ArrayLike<number>;

/** The canvas box in CSS pixels, never device pixels — the renderer's DPR must
 *  not leak into this arithmetic. */
export type GraphViewport = { width: number; height: number };

/** Minimum pick radius, CSS pixels: a leaf disc is a few pixels across, far
 *  under the ~44 px touch-target guidance. Applies to the mouse too. */
export const GRAPH_PICK_MIN_RADIUS_PX = 10;

export type GraphProjectedNode = {
  index: number;
  /** Normalised device coordinates, both in [-1, 1] when on screen. */
  ndcX: number;
  ndcY: number;
  /** Clip-space `w`. Smaller is nearer, which is how overlapping discs are
   *  resolved. */
  w: number;
  /** The disc's projected radius, in NDC units, on each axis. */
  radiusNdcX: number;
  radiusNdcY: number;
};

export type GraphProjectionInputs = {
  nodes: Pick<GraphNodeLayer, "count" | "offsets" | "sizes">;
  /** `camera.matrixWorldInverse * root.matrixWorld` — world → view. */
  modelView: GraphMatrix4;
  /** `camera.projectionMatrix` — view → clip. */
  projection: GraphMatrix4;
  viewport: GraphViewport;
};

type Vec4 = { x: number; y: number; z: number; w: number };

/** `m * v`, with `m` column-major. */
function transform(m: GraphMatrix4, v: Vec4): Vec4 {
  return {
    x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12] * v.w,
    y: m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13] * v.w,
    z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14] * v.w,
    w: m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15] * v.w,
  };
}

/** Project one node to NDC with its disc radius; `null` when it is behind the
 *  camera, where a negative `w` would mirror it to a plausible on-screen spot. */
export function projectGraphNode(
  inputs: GraphProjectionInputs,
  index: number,
): GraphProjectedNode | null {
  const { nodes, modelView, projection } = inputs;
  if (!Number.isInteger(index) || index < 0 || index >= nodes.count) return null;

  const view = transform(modelView, {
    x: nodes.offsets[index * 3],
    y: nodes.offsets[index * 3 + 1],
    z: nodes.offsets[index * 3 + 2],
    w: 1,
  });
  const clip = transform(projection, view);
  if (!(clip.w > 0)) return null;

  const ndcX = clip.x / clip.w;
  const ndcY = clip.y / clip.w;

  const size = nodes.sizes[index];
  const right = transform(projection, { ...view, x: view.x + size });
  const up = transform(projection, { ...view, y: view.y + size });

  return {
    index,
    ndcX,
    ndcY,
    w: clip.w,
    radiusNdcX: right.w > 0 ? Math.abs(right.x / right.w - ndcX) : 0,
    radiusNdcY: up.w > 0 ? Math.abs(up.y / up.w - ndcY) : 0,
  };
}

/** Pointer client coordinates → NDC. The Y axis flips: the DOM's origin is
 *  top-left, NDC's is centre with Y up. */
export function graphPointerNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const width = rect.width > 0 ? rect.width : 1;
  const height = rect.height > 0 ? rect.height : 1;
  return {
    x: ((clientX - rect.left) / width) * 2 - 1,
    y: -(((clientY - rect.top) / height) * 2 - 1),
  };
}

export type GraphPickOptions = {
  /** Pick radius floor in CSS pixels; see `GRAPH_PICK_MIN_RADIUS_PX`. */
  minRadiusPx?: number;
};

/** Resolve a pointer position to a node, or `null` for a miss. Nearest-to-camera
 *  wins; ties go to the lower index, so the answer is stable frame to frame. */
export function pickGraphNode(
  inputs: GraphProjectionInputs,
  pointer: { x: number; y: number },
  options: GraphPickOptions = {},
): GraphProjectedNode | null {
  const { nodes, viewport } = inputs;
  const minRadiusPx = options.minRadiusPx ?? GRAPH_PICK_MIN_RADIUS_PX;
  // NDC spans 2 units across the whole viewport, hence the 2×.
  const minNdcX = viewport.width > 0 ? (2 * minRadiusPx) / viewport.width : 0;
  const minNdcY = viewport.height > 0 ? (2 * minRadiusPx) / viewport.height : 0;

  let best: GraphProjectedNode | null = null;
  for (let index = 0; index < nodes.count; index++) {
    const projected = projectGraphNode(inputs, index);
    if (!projected) continue;

    const rx = Math.max(projected.radiusNdcX, minNdcX);
    const ry = Math.max(projected.radiusNdcY, minNdcY);
    if (!(rx > 0) || !(ry > 0)) continue;

    const dx = (pointer.x - projected.ndcX) / rx;
    const dy = (pointer.y - projected.ndcY) / ry;
    if (dx * dx + dy * dy > 1) continue;

    if (best === null || projected.w < best.w) best = projected;
  }
  return best;
}

/** Where the label anchor goes, in CSS pixels from the canvas's top-left. */
export type GraphOverlayPosition = {
  leftPx: number;
  topPx: number;
  /** The node's projected radius in CSS pixels — where the adoption ring sits,
   *  and it varies with degree AND camera distance, so no constant lift clears
   *  it. */
  radiusPx: number;
};

export function graphOverlayPosition(
  projected: Pick<GraphProjectedNode, "ndcX" | "ndcY" | "radiusNdcY">,
  viewport: GraphViewport,
): GraphOverlayPosition {
  return {
    leftPx: ((projected.ndcX + 1) / 2) * viewport.width,
    topPx: ((1 - projected.ndcY) / 2) * viewport.height,
    radiusPx: (projected.radiusNdcY / 2) * viewport.height,
  };
}

/** The overlay label's position for one node, or `null` when there is nowhere
 *  to put it. Calls picking's own projection, so the two cannot disagree. */
export function graphNodeOverlayPosition(
  inputs: GraphProjectionInputs,
  index: number,
): GraphOverlayPosition | null {
  const projected = projectGraphNode(inputs, index);
  if (!projected) return null;
  return graphOverlayPosition(projected, inputs.viewport);
}

/** How far a pointer may travel and still be a tap, CSS pixels — tight enough
 *  that the start of an orbit drag is not a selection. */
export const GRAPH_TAP_MAX_MOVE_PX = 6;
/** And how long: a long press is a platform gesture, not a selection. */
export const GRAPH_TAP_MAX_DURATION_MS = 700;

export type GraphPointerSample = { x: number; y: number; timeMs: number };

/** Was that press-and-release a tap? The canvas cannot use `click`:
 *  `OrbitControls` captures the pointer, so every orbit drag ends in a `click`
 *  at the release point. */
export function isGraphTap(
  start: GraphPointerSample,
  end: GraphPointerSample,
  options: { maxMovePx?: number; maxDurationMs?: number } = {},
): boolean {
  const maxMove = options.maxMovePx ?? GRAPH_TAP_MAX_MOVE_PX;
  const maxDuration = options.maxDurationMs ?? GRAPH_TAP_MAX_DURATION_MS;
  if (end.timeMs - start.timeMs > maxDuration) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) <= maxMove;
}

/** The page with no selection. */
export const GRAPH_BARE_PATH = "/graph";

/** The query parameters that carry a selection. Both, because a tombstone or a
 *  Proof Node deep link arrives as `?def=`. */
const SELECTION_PARAMS = ["prop", "def"] as const;

export type GraphCanvasTap =
  /** A hit. Always re-selects, even when already selected — that is how a
   *  dismissed mobile drawer comes back. */
  | { kind: "select"; index: number }
  /** A miss on the background. Clears the selection AND the URL. */
  | { kind: "clear"; url: string };

/** Background-tap semantics live in the hit test, not the drawer: the mobile
 *  drawer is `modal={false}`, so vaul renders no overlay and never receives the
 *  tap. The caller applies `url` with `replaceState`, never `pushState`. */
export function resolveGraphCanvasTap(
  pick: { index: number } | null,
  search = "",
): GraphCanvasTap {
  if (pick) return { kind: "select", index: pick.index };
  return { kind: "clear", url: graphClearSelectionUrl(search) };
}

/** `/graph` with ONLY the selection parameters stripped — `utm_*` and every
 *  other query parameter survive. */
export function graphClearSelectionUrl(search: string): string {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  for (const key of SELECTION_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest.length > 0 ? `${GRAPH_BARE_PATH}?${rest}` : GRAPH_BARE_PATH;
}
