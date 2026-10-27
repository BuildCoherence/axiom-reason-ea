// Edge BUNDLING geometry — the sketch's "many strands gather into a conduit"
// (design contract: edge bundling + five-state flow machine).
//
// dagre (layout.ts) routes premise→container and container→conclusion as N
// INDEPENDENT polylines that each hit the container edge separately. The sketch
// instead wants the premise strands to MERGE into one heavy trunk before
// entering the proof, and a single trunk back out to the conclusion — like thick
// block-arrows feeding a conduit. We do NOT change the layout (we may only read
// its output); instead we DERIVE the bundle geometry from the layout `boxes`
// here and emit a re-shaped edge set the shell turns into React Flow edges.
//
// We consume ONLY `boxes` (absolute, CENTER-based) — never re-run dagre. The
// trunk is a vertical conduit on the container's centre line. Each strand drops
// straight DOWN from its premise to a shared GATHER BAND, then eases onto the
// trunk's centreline with a VERTICAL tangent at the apex (hierarchical-edge-
// bundling feel) — so strands kiss the spine tangentially instead of stabbing a
// single hard vertex. The "drop then gather" keeps the curved part in the empty
// band BELOW the premise cards, so it works whether premises are one row or a
// multi-row 2-D block (the grid layout): upper-row strands simply have a longer
// vertical stub down to the band.

import { CONTAINER_NODE_ID } from "../types";
import type { LayoutBox, LayoutEdge } from "../layout-model";

/** Gap (px) between the trunk apex and the container's top edge — the short
 *  visible run of heavy trunk before it enters the proof. */
const BUNDLE_GAP = 28;

/** Minimum vertical stub (px) every strand drops straight down before it is
 *  allowed to curve, so the curve lives below the premise cards (no slicing
 *  through a card) regardless of how the premises are arranged. */
const MIN_STUB = 18;

/** Shared description of the trunk/spine geometry, stamped on every bundled
 *  strand + trunk segment so the renderer can draw smooth, consistent curves
 *  without re-deriving the layout. All coords absolute (same space as `boxes`). */
export interface BundleGeometry {
  /** x of the trunk centreline (the spine). */
  spineX: number;
  /** y of the trunk apex — where strands merge and the trunk-in begins. */
  apexY: number;
  /** y of the gather band — strands drop straight down to here, then curve. */
  gatherY: number;
  /** y of the container top edge — where the trunk-in ends / trunk-out begins. */
  containerTopY: number;
}

/** A re-shaped edge ready for the shell to wrap as a React Flow edge. The
 *  `role` discriminates how `waypoint-edge` renders it and how the shell
 *  resolves its flow state:
 *   - "strand": one premise → the shared apex (keeps premise identity).
 *   - "trunk" : the shared conduit (apex → container, container → conclusion).
 *               Its state is GRAPH-level (flows iff ALL premises held), so the
 *               shell resolves it and is the SAME for every trunk segment.
 *   - "plain" : an ordinary routed edge (interior DAG, or any edge not part of
 *               the premise-fan-in / trunk) — rendered through the raw dagre
 *               waypoints unchanged. */
export type BundledEdgeRole = "strand" | "trunk" | "plain";

export interface BundledEdge {
  /** Stable id (the shell may suffix to disambiguate split trunk segments). */
  id: string;
  source: string;
  target: string;
  role: BundledEdgeRole;
  /** Polyline in absolute flow coords (same space as `boxes`). For a strand:
   *  [premise bottom-centre, stub bottom (on the gather band), apex]. The
   *  renderer drops straight down the stub then eases a cubic onto the apex. */
  points: Array<{ x: number; y: number }>;
  /** For a "strand": the premise id whose stance colours it. Else undefined. */
  premiseId?: string;
  /** Trunk/spine geometry — present on strands + trunk so the renderer can draw
   *  the bundle curve / heavy conduit consistently. Absent on plain edges. */
  geometry?: BundleGeometry;
}

/** Bottom-centre of a center-based box (where a strand leaves a premise). */
function bottomCenter(b: LayoutBox): { x: number; y: number } {
  return { x: b.x, y: b.y + b.height / 2 };
}
/** Top-centre of a center-based box (where the trunk enters the container). */
function topCenter(b: LayoutBox): { x: number; y: number } {
  return { x: b.x, y: b.y - b.height / 2 };
}
/** Bottom-centre alias used for the container's outbound trunk origin. */
function containerBottom(b: LayoutBox): { x: number; y: number } {
  return { x: b.x, y: b.y + b.height / 2 };
}

export interface BundleInput {
  /** Absolute center-based boxes from the layout result. */
  boxes: Record<string, LayoutBox>;
  /** dagre-routed edges (post-reduction): premise→container, container→
   *  conclusion, plus interior edges when expanded. */
  edges: LayoutEdge[];
  /** True iff a proof-group container exists. */
  hasContainer: boolean;
}

export interface BundleResult {
  edges: BundledEdge[];
  /** The shared trunk geometry (apex/spine/band); null if no container. */
  geometry: BundleGeometry | null;
}

/**
 * Re-shape the layout edges into bundled strands + a single heavy trunk.
 *
 * When there IS a container:
 *   - An edge into the container becomes a STRAND only when its source box is
 *     above the container. It drops from that box's bottom-centre to the shared
 *     gather band, then eases onto the trunk apex. Carries the premise's stance.
 *   - One TRUNK segment runs apex → container top-centre (the conduit in).
 *   - Every edge whose source is the container (→ conclusion) becomes a TRUNK
 *     segment from container bottom-centre straight down to the target top.
 *   - All other edges (interior↔interior) pass through as PLAIN, unchanged.
 *
 * When there is NO container, every edge passes through as PLAIN.
 *
 * Robust to a 2-D premise grid: the gather band sits BELOW the lowest premise.
 * Each strand descends to it in a clear LANE — if dropping straight down from a
 * premise would pierce a lower-row card (aligned columns), the descent x is
 * shifted into the nearest gutter that is clear all the way down, so strands
 * thread BETWEEN cards instead of slicing through them. Below the gather band
 * the strand eases onto the spine with a vertical tangent at the apex. Works for
 * one row (no lower card to dodge → straight stub) or several.
 */
export function bundleEdges(input: BundleInput): BundleResult {
  const { boxes, edges, hasContainer } = input;
  const containerBox = boxes[CONTAINER_NODE_ID];

  if (!hasContainer || containerBox === undefined) {
    return {
      edges: edges.map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        role: "plain" as const,
        points: plainWaypoints(e, boxes),
      })),
      geometry: null,
    };
  }

  const top = topCenter(containerBox);
  const apex = { x: top.x, y: top.y - BUNDLE_GAP };

  const strandSourceBox = (e: LayoutEdge): LayoutBox | undefined => {
    if (e.target !== CONTAINER_NODE_ID) return undefined;
    const sourceBox = boxes[e.source];
    if (sourceBox === undefined || bottomCenter(sourceBox).y >= top.y) {
      return undefined;
    }
    return sourceBox;
  };

  // The premises feeding the container (strand sources). We need their lowest
  // bottom edge to place the gather band BELOW the whole premise block — so a
  // multi-row grid's lower row still has a downward stub and nothing curves
  // through a card.
  const strandSources = edges
    .map(strandSourceBox)
    .filter((box): box is LayoutBox => box !== undefined);
  const lowestPremiseBottom =
    strandSources.length > 0
      ? Math.max(...strandSources.map((b) => b.y + b.height / 2))
      : apex.y - MIN_STUB * 2;

  // Gather band: below the lowest premise (so every stub drops), clamped to sit
  // a little above the apex so there is room for the merge curve. If premises
  // crowd the container, fall back to a point just below them.
  const gatherY = clamp(
    lowestPremiseBottom + MIN_STUB,
    lowestPremiseBottom + 2,
    apex.y - MIN_STUB,
  );

  const geometry: BundleGeometry = {
    spineX: apex.x,
    apexY: apex.y,
    gatherY,
    containerTopY: top.y,
  };

  // All premise boxes (the obstacles a descending strand must thread between).
  const premiseBoxes = strandSources;

  const out: BundledEdge[] = [];
  let sawInbound = false;

  for (const e of edges) {
    const strandSource = strandSourceBox(e);
    const outOfContainer = e.source === CONTAINER_NODE_ID;

    if (strandSource !== undefined) {
      // STRAND polyline: premise bottom → (clear descent lane) → gather point →
      // apex. The LAST point is always the apex; the renderer eases a cubic from
      // the second-to-last point onto the apex with a vertical arrival tangent,
      // and rounds the earlier corners. Lane routing keeps the descent out of any
      // lower-row card (2-D grid robustness).
      out.push({
        id: `strand:${e.source}`,
        source: e.source,
        target: CONTAINER_NODE_ID,
        role: "strand",
        premiseId: e.source,
        points: strandWaypoints(strandSource, apex, gatherY, premiseBoxes),
        geometry,
      });
      sawInbound = true;
      continue;
    }

    if (outOfContainer) {
      // TRUNK out: container bottom-centre → target (conclusion) top-centre.
      const tgtBox = boxes[e.target];
      if (tgtBox === undefined) continue;
      out.push({
        id: `trunk-out:${e.target}`,
        source: CONTAINER_NODE_ID,
        target: e.target,
        role: "trunk",
        points: [containerBottom(containerBox), topCenter(tgtBox)],
        geometry,
      });
      continue;
    }

    // PLAIN: interior↔interior (expanded). We DISCARD dagre's raw routed
    // polyline (it clips to the box border at the approach angle → off-centre
    // attachments + dog-leg mid-waypoints) and re-derive a clean source-bottom-
    // centre → target-top-centre run from the now-exact fixed-height boxes. The
    // renderer eases a vertical-tangent curve between them (see waypoint-edge).
    out.push({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      role: "plain",
      points: plainWaypoints(e, boxes),
    });
  }

  // TRUNK in: the single heavy conduit from the apex into the container top.
  if (sawInbound) {
    out.push({
      id: "trunk-in",
      source: CONTAINER_NODE_ID,
      target: CONTAINER_NODE_ID,
      role: "trunk",
      points: [apex, top],
      geometry,
    });
  }

  return { edges: out, geometry };
}

// ---- Plain (interior DAG) edge geometry ------------------------------------
// The interior sub-DAG's edges are the "plain" ones. dagre owns the NODE
// positions (its ranking), but its routed `edge().points` are unusable for a
// clean look: it clips the polyline to each box border at the edge's approach
// ANGLE (so a node with several in/out edges gets them fanned across its border,
// well off-centre — and a long diagonal even lands on the card's SIDE, below the
// top), and inserts dog-leg mid-waypoints through its dummy nodes. The boxes we
// are handed are exact, so we throw dagre's polyline away and draw our OWN run:
// source BOTTOM-centre → target TOP-centre (the TB-layout faces), which the
// renderer eases into a vertical-tangent curve. Whether that run has to dodge is
// decided by the obstacle scan alone — never by how many ranks it spans, since
// box heights vary and a short gap can still hold a card. Nothing in the way ⇒
// the two endpoints; otherwise the nearest clear vertical lane, same idea as the
// strand descent.

/**
 * Clean waypoints for a plain interior edge from the EXACT boxes (not dagre's
 * routed polyline). Returns `[srcBottomCentre, …lane…, tgtTopCentre]`; the
 * renderer eases a vertical-tangent curve through them. Falls back to dagre's
 * own points only if a box is missing (degenerate — shouldn't happen expanded).
 */
function plainWaypoints(
  e: LayoutEdge,
  boxes: Record<string, LayoutBox>,
): Array<{ x: number; y: number }> {
  const src = boxes[e.source];
  const tgt = boxes[e.target];
  if (src === undefined || tgt === undefined) return e.points;

  const start = bottomCenter(src);
  const end = topCenter(tgt);

  // Same rank or target above (shouldn't happen in a TB DAG): just connect.
  if (end.y <= start.y) return [start, end];

  // Obstacles: every box whose row band overlaps the gap and is NOT the source/
  // target (the interior children — premises/conclusion never fall in an
  // interior gap). The container is EXCLUDED: it is the enclosing wall, not a
  // card, and it overlaps every interior gap across the full interior width, so
  // counting it would leave no clear lane anywhere inside the proof.
  const obstacles = Object.entries(boxes)
    .filter(
      ([id]) => id !== e.source && id !== e.target && id !== CONTAINER_NODE_ID,
    )
    .map(([, b]) => b)
    .filter((b) => b.y + b.height / 2 > start.y && b.y - b.height / 2 < end.y);

  // If a straight descent down the source centre, then across to the target,
  // is already clear, keep it minimal. Otherwise pick a clear lane to descend.
  const laneX = clearLaneX(start.x, start.y, end.y, end.x, obstacles);
  if (Math.abs(laneX - start.x) < 1 && laneClear(start.x, start.y, end.y, obstacles)) {
    return [start, end];
  }
  const exitY = start.y + EXIT_DROP;
  const arriveY = end.y - EXIT_DROP;
  return [
    start,
    { x: start.x, y: exitY },
    { x: laneX, y: exitY },
    { x: laneX, y: arriveY },
    { x: end.x, y: arriveY },
    end,
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo; // degenerate (premises crammed against container)
  return Math.min(hi, Math.max(lo, v));
}

/** Horizontal clearance (px) kept between a descent lane and any card edge. */
export const LANE_CLEARANCE = 14;
/** Short vertical drop out of the card before any lateral move, so the strand
 *  clearly leaves the card before threading toward its lane. */
const EXIT_DROP = 12;

/**
 * Build a strand's waypoints from its premise box down to the apex, choosing a
 * descent LANE x that is clear of every other premise card between the card
 * bottom and the gather band. The returned polyline is:
 *   [start, (exit, laneTop, laneBottom)…, gatherPoint, apex]
 * where the final point is always the apex (renderer eases a cubic onto it). If
 * the natural straight-down lane is already clear (single row, or a gutter
 * column), the lateral hops collapse out and it's just [start, gatherPoint, apex].
 */
function strandWaypoints(
  src: LayoutBox,
  apex: { x: number; y: number },
  gatherY: number,
  premiseBoxes: LayoutBox[],
): Array<{ x: number; y: number }> {
  const start = bottomCenter(src);
  // Obstacles = every OTHER premise box (don't dodge yourself).
  const others = premiseBoxes.filter((b) => b !== src);
  const laneX = clearLaneX(start.x, start.y, gatherY, apex.x, others);

  if (Math.abs(laneX - start.x) < 1) {
    // Straight descent is clear: drop to the gather band on the card's own x.
    const gather = { x: start.x, y: Math.max(gatherY, start.y + 2) };
    return [start, gather, apex];
  }

  // Thread into the lane: drop a little, move horizontally to the lane, then
  // descend the lane to the gather band, then ease onto the apex.
  const exitY = Math.min(start.y + EXIT_DROP, gatherY);
  return [
    start,
    { x: start.x, y: exitY },
    { x: laneX, y: exitY },
    { x: laneX, y: gatherY },
    apex,
  ];
}

/**
 * Pick an x at which a vertical descent from `fromY` to `toY` clears every box
 * in `obstacles` (with LANE_CLEARANCE). Prefers the card's own x; if blocked,
 * searches outward, biased toward `preferX` (the spine) so lanes hug the trunk.
 */
function clearLaneX(
  startX: number,
  fromY: number,
  toY: number,
  preferX: number,
  obstacles: LayoutBox[],
): number {
  if (laneClear(startX, fromY, toY, obstacles)) return startX;

  // Candidate lanes: just outside each obstacle's left/right edge, plus a few
  // fixed steps out from the start. Choose the clear candidate nearest the
  // spine-ward direction, falling back to nearest of any clear candidate.
  const candidates: number[] = [];
  for (const b of obstacles) {
    candidates.push(b.x - b.width / 2 - LANE_CLEARANCE);
    candidates.push(b.x + b.width / 2 + LANE_CLEARANCE);
  }
  // Sort by closeness to the start, tie-broken toward the spine.
  candidates.sort((a, c) => {
    const da = Math.abs(a - startX);
    const dc = Math.abs(c - startX);
    if (da !== dc) return da - dc;
    return Math.abs(a - preferX) - Math.abs(c - preferX);
  });
  for (const x of candidates) {
    if (laneClear(x, fromY, toY, obstacles)) return x;
  }
  return startX; // give up — keep the straight lane (degenerate)
}

/** True iff a vertical segment at x over [fromY,toY] misses every obstacle box
 *  (expanded by LANE_CLEARANCE horizontally). */
function laneClear(
  x: number,
  fromY: number,
  toY: number,
  obstacles: LayoutBox[],
): boolean {
  const yLo = Math.min(fromY, toY);
  const yHi = Math.max(fromY, toY);
  for (const b of obstacles) {
    const left = b.x - b.width / 2 - LANE_CLEARANCE;
    const right = b.x + b.width / 2 + LANE_CLEARANCE;
    const topY = b.y - b.height / 2;
    const botY = b.y + b.height / 2;
    const xHits = x > left && x < right;
    const yOverlaps = yHi > topY && yLo < botY;
    if (xHits && yOverlaps) return false;
  }
  return true;
}
