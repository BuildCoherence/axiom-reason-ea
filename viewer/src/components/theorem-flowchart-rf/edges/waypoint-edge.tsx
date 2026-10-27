import * as React from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";

import type { BundledEdgeRole } from "./bundling";
import {
  cubicAt,
  dist,
  pathFromPoints,
  plainPath,
  round,
  strandCubic,
  strandPath,
} from "./paths";
import styles from "./edges.module.css";

// Custom waypoint edge — the bundled, five-state-flow edge.
//
// React Flow's built-in edges re-derive their own bezier from the two endpoints,
// which is what causes a graph engine to route edges THROUGH nodes. We instead
// draw an SVG path through the WAYPOINTS our geometry produced (dagre's routing
// for plain interior edges; the bundling helper's strand/trunk geometry for the
// premise-fan-in and conduit). React Flow stays the pan/zoom shell.
//
// CONDUIT LOOK (this round): the premise strands no longer fan to ONE sharp
// vertex. Each strand drops straight down to a shared gather band, then eases
// onto the trunk's centreline with a VERTICAL tangent at the apex (hierarchical-
// edge-bundling feel) — strands kiss the spine tangentially. The trunk is drawn
// as a HEAVY conduit: a wide soft "casing" stroke under a narrower core, so it
// reads as the sketch's block-arrow rather than a thin line.
//
// FIVE-STATE FLOW MACHINE (design): the edge renders a RESOLVED `state` the
// shell computed graph-wide (the trunk's state depends on ALL premises, so it
// cannot be derived per-edge). This component is a pure renderer of (points,
// role, state) — it does no stance logic; the bundle CURVE shape is derived
// entirely from `points` (the path emitters live in `./paths`, shared with the
// OG renderer).
//
//   strand  held       → flowing  (green, marching dashes when motion OK)
//   strand  undecided  → dormant  (muted, static dotted)
//   strand  rejected   → severed  (red; a visible BREAK/gap + ✕ at the MIDPOINT)
//   trunk   all-held   → flowing  (green conduit, heavy)
//   trunk   any-not    → blocked  (greyed conduit + a stop-bar at the apex)
//
// A11y / MOTION (hard requirement): every state is distinguishable WITHOUT
// animation — color + dash + marker + break/stop-bar. The marching-dash is
// enhancement only and lives behind `prefers-reduced-motion: no-preference`
// (edges.module.css). Arrowheads track state via per-state inline markers that
// inherit the path stroke (`context-stroke`), so a green edge never keeps a grey
// head. Edges are NON-FOCUSABLE for AT (the shell sets `edgesFocusable={false}`
// on <ReactFlow>): they expose only opaque "Edge from <hash> to <hash>"
// names, so the relations are conveyed by the named nodes + the visual flow, not
// by tabbing through edges.

/**
 * Resolved, graph-level visual state for an edge/segment. NOT the raw viewer
 * stance — the shell maps stance → this (held→flowing, undecided→dormant,
 * rejected→severed for strands; all-held→flowing else blocked for the trunk).
 */
export type EdgeFlowState =
  | "flowing"
  | "dormant"
  | "severed"
  | "blocked"
  | "pending-flowing"
  | "pending-severed"
  | "pending-dormant"
  | "neutral";

export interface WaypointEdgeData {
  /** Polyline in absolute flow coordinates (strand/trunk/plain geometry). */
  points: Array<{ x: number; y: number }>;
  /** What kind of edge this is — drives stroke weight + severed/blocked marks. */
  role: BundledEdgeRole;
  /** Resolved flow state (computed graph-wide in the shell). */
  state: EdgeFlowState;
  [key: string]: unknown;
}

// NOTE: the bundle CURVE geometry (gather band, spine, apex) is derived ENTIRELY
// from the 3-point strand polyline the shell already forwards in `points`
// ([premise bottom, stub bottom, apex]) — so the `WaypointEdgeData` contract the
// shell sets is UNCHANGED this round (no new field to thread through the shell).

// --- Severed strategy switch -------------------------------------------------
// PRIMARY = "break": a rejected strand is drawn with a literal GAP at the
// MIDPOINT of the connecting strand (the premise→bundle line) — reads
// unambiguously as severed, static, survives reduced-motion. To switch to
// reverse-red flow instead, set this to "reverse-red".
const SEVERED_MODE: "break" | "reverse-red" = "break";

/** Visible gap length (px) at the break of a severed strand. */
const SEVER_GAP = 9;

// --- Conduit weights ---------------------------------------------------------
/** Core (foreground) stroke width of the trunk conduit. */
const TRUNK_CORE = 5;
/** Soft casing stroke under the core — gives the conduit its block-arrow heft. */
const TRUNK_CASING = 11;
/** Strand stroke width — thinner than the trunk so strands read as feeding it. */
const STRAND_WIDTH = 2;
/** Plain (interior DAG) edge width. */
const PLAIN_WIDTH = 1.75;

/** Stroke color per resolved state — all via theme vars (no hardcoded hex). */
function strokeFor(state: EdgeFlowState): string {
  switch (state) {
    case "flowing":
      return "var(--base0B)"; // green — adopted / flowing
    case "pending-flowing":
      return "var(--base0B)";
    case "severed":
      return "var(--base08)"; // red — rejected / severed
    case "pending-severed":
      return "var(--base08)";
    case "dormant":
      return "var(--base04)"; // muted — undecided / dormant
    case "pending-dormant":
      return "var(--base04)";
    case "blocked":
      return "var(--base03)"; // grey — trunk blocked at the apex
    default:
      return "var(--base03)"; // neutral
  }
}

/**
 * Static dash pattern per state, so the distinction survives WITHOUT color and
 * WITHOUT animation (a11y). `flowing` uses a marching-capable dash (the CSS
 * keyframe shifts its offset when motion is allowed); the others are static.
 */
function dashFor(state: EdgeFlowState): string | undefined {
  switch (state) {
    case "flowing":
      return "8 8"; // one 16px pattern — matches the keyframe offset
    case "pending-flowing":
      return "3 5";
    case "dormant":
      return "2 5"; // sparse dotted — clearly "not flowing"
    case "pending-dormant":
      return "3 5";
    case "severed":
      return "5 4"; // dashed red (plus the literal break, below)
    case "pending-severed":
      return "3 5";
    case "blocked":
      return "3 6"; // greyed, blocked
    default:
      return undefined; // neutral — solid
  }
}

/**
 * A severed strand: draw the FULL strand (premise → bundle), but break it at the
 * MIDPOINT of the connecting line — a literal gap with a drawn segment on EITHER
 * side. Returns the two sub-paths + the gap centre (for the ✕ glyph). Falls back
 * to null if the geometry is missing (caller draws a plain severed segment then).
 *
 * We flatten the exact drawn strand (rounded lead-in polyline + the easing cubic
 * onto the apex) into a dense polyline, walk its true arc length to find the
 * midpoint, then split it at midpoint ∓ SEVER_GAP/2 so the gap is centred on the
 * geometric middle of the strand regardless of how many lane-dodge waypoints it
 * has. The ✕ sits at that midpoint.
 */
function severedStrand(
  points: Array<{ x: number; y: number }>,
): { before: string; after: string; breakAt: { x: number; y: number } } | null {
  if (points.length < 3) return null;
  const flat = flattenStrand(points);
  if (flat.length < 2) return null;

  // Cumulative arc length along the flattened strand.
  const cum: number[] = [0];
  for (let i = 1; i < flat.length; i++) {
    cum.push(cum[i - 1] + dist(flat[i - 1], flat[i]));
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return null;

  const mid = total / 2;
  const half = Math.min(SEVER_GAP / 2, total / 2 - 1);
  const breakAt = pointAtLength(flat, cum, mid);

  return {
    before: pathUpToLength(flat, cum, mid - half),
    after: pathFromLength(flat, cum, mid + half),
    breakAt,
  };
}

/** Densely sample the EXACT drawn strand (lead-in rounded polyline + easing
 *  cubic onto the apex) into a polyline, so arc-length math runs on the real
 *  curve the renderer draws. */
function flattenStrand(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  const apex = points[points.length - 1];
  const gather = points[points.length - 2];
  const lead = points.slice(0, points.length - 1); // [...lane, gather]
  // Lead-in: the rounded polyline is visually close to the straight segments
  // (small 6px corner radius), so straight segments through its points are a
  // faithful flattening for the midpoint walk.
  const out: Array<{ x: number; y: number }> = [lead[0]];
  for (let i = 1; i < lead.length; i++) out.push(lead[i]);
  // Easing cubic gather → apex, sampled.
  const c = strandCubic(gather, apex);
  const STEPS = 24;
  for (let i = 1; i <= STEPS; i++) out.push(cubicAt(c, i / STEPS));
  return out;
}

/** Point at arc length `len` along a flattened polyline with cumulative `cum`. */
function pointAtLength(
  flat: Array<{ x: number; y: number }>,
  cum: number[],
  len: number,
): { x: number; y: number } {
  const total = cum[cum.length - 1];
  const target = Math.max(0, Math.min(total, len));
  for (let i = 1; i < flat.length; i++) {
    if (cum[i] >= target) {
      const segLen = cum[i] - cum[i - 1] || 1;
      const t = (target - cum[i - 1]) / segLen;
      return {
        x: flat[i - 1].x + (flat[i].x - flat[i - 1].x) * t,
        y: flat[i - 1].y + (flat[i].y - flat[i - 1].y) * t,
      };
    }
  }
  return flat[flat.length - 1];
}

/** SVG path from the strand start up to arc length `len` (the "before" segment). */
function pathUpToLength(
  flat: Array<{ x: number; y: number }>,
  cum: number[],
  len: number,
): string {
  let d = `M ${round(flat[0].x)},${round(flat[0].y)}`;
  for (let i = 1; i < flat.length; i++) {
    if (cum[i] >= len) {
      const p = pointAtLength(flat, cum, len);
      d += ` L ${round(p.x)},${round(p.y)}`;
      break;
    }
    d += ` L ${round(flat[i].x)},${round(flat[i].y)}`;
  }
  return d;
}

/** SVG path from arc length `len` to the strand end (the "after" segment). */
function pathFromLength(
  flat: Array<{ x: number; y: number }>,
  cum: number[],
  len: number,
): string {
  const start = pointAtLength(flat, cum, len);
  let d = `M ${round(start.x)},${round(start.y)}`;
  for (let i = 1; i < flat.length; i++) {
    if (cum[i] > len) d += ` L ${round(flat[i].x)},${round(flat[i].y)}`;
  }
  return d;
}

// --- Per-state arrowhead markers --------------------------------------------
// React Flow's shared markers are deduplicated by id and can render grey when no
// color is set on the markerEnd (the shell does not set one). We instead emit
// our OWN <marker> per edge instance, with a unique id, and fill it via
// `context-stroke` so the arrowhead INHERITS the path's stroke colour — the head
// always matches the edge state, and per-instance ids mean no cross-edge bleed.
// (`context-stroke` is supported in all current evergreen browsers — Chrome 124+
// / 2024.) We fall back to a literal `fill` of the same theme var for safety.

function markerIdFor(edgeId: string): string {
  // Sanitize to a valid id fragment.
  return `wp-arrow-${edgeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function ArrowMarker({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 12 12"
        refX="9"
        refY="6"
        markerWidth="9"
        markerHeight="9"
        orient="auto-start-reverse"
        markerUnits="userSpaceOnUse"
      >
        {/* context-stroke makes the head inherit the referencing path's stroke;
         *  the literal `fill={color}` is the fallback for any engine that lacks
         *  context-stroke, so the head is never the wrong colour. */}
        <path
          d="M1 1 L11 6 L1 11 z"
          fill="context-stroke"
          stroke="none"
          style={{ fill: color }}
        />
      </marker>
    </defs>
  );
}

export function WaypointEdge({ id, data }: EdgeProps) {
  const edgeData = data as WaypointEdgeData | undefined;
  const points = edgeData?.points ?? [];
  const role = edgeData?.role ?? "plain";
  const state = edgeData?.state ?? "neutral";

  const isTrunk = role === "trunk";
  const isStrand = role === "strand";
  const isPlain = role === "plain";

  const path = React.useMemo(() => {
    if (isStrand) return strandPath(points);
    if (isPlain) return plainPath(points); // interior DAG: vertical-tangent curve
    return pathFromPoints(points); // trunk conduit: straight/rounded line
  }, [isStrand, isPlain, points]);

  const stroke = strokeFor(state);
  const dash = dashFor(state);
  const flowing = state === "flowing";

  const markerId = markerIdFor(id);
  // Strands end at the merge (no node), so no arrowhead. Trunk/plain carry the
  // arrow into their target — UNLESS the trunk is blocked (not delivering).
  const blockedTrunk = state === "blocked" && isTrunk;
  const showArrow = !isStrand && !blockedTrunk;
  const markerEndRef = showArrow ? `url(#${markerId})` : undefined;

  // --- Severed strand (primary): curve with a visible break at its MIDPOINT ---
  const severed = React.useMemo(
    () =>
      (state === "severed" || state === "pending-severed") && isStrand && SEVERED_MODE === "break"
        ? severedStrand(points)
        : null,
    [state, isStrand, points],
  );

  if (severed !== null) {
    const segStyle: React.CSSProperties = {
      stroke,
      strokeWidth: STRAND_WIDTH,
      strokeDasharray: dash,
      strokeLinecap: "round",
      fill: "none",
    };
    const tick = 5;
    return (
      <>
        <BaseEdge id={id} path={severed.before} style={segStyle} data-flow-state={state} />
        <BaseEdge id={`${id}__after`} path={severed.after} style={segStyle} data-flow-state={state} />
        <line
          x1={round(severed.breakAt.x - tick)}
          y1={round(severed.breakAt.y - tick)}
          x2={round(severed.breakAt.x + tick)}
          y2={round(severed.breakAt.y + tick)}
          stroke={stroke}
          strokeWidth={1.75}
        />
        <line
          x1={round(severed.breakAt.x - tick)}
          y1={round(severed.breakAt.y + tick)}
          x2={round(severed.breakAt.x + tick)}
          y2={round(severed.breakAt.y - tick)}
          stroke={stroke}
          strokeWidth={1.75}
        />
      </>
    );
  }

  // --- Reverse-red severed (alternate): unbroken red, reverse march ---------
  const reverseRed =
    (state === "severed" || state === "pending-severed") && isStrand && SEVERED_MODE === "reverse-red";

  // --- Blocked trunk: greyed conduit + a "stop" bar at the apex --------------
  const blockBar =
    blockedTrunk && points.length >= 2
      ? blockBarAt(points[0], points[1])
      : null;

  const strandStyle: React.CSSProperties = {
    stroke: reverseRed ? "var(--base08)" : stroke,
    strokeWidth: STRAND_WIDTH,
    strokeDasharray: reverseRed ? "8 8" : dash,
    strokeLinecap: "round",
    fill: "none",
  };

  // --- TRUNK: heavy conduit (soft casing under a core stroke) ----------------
  if (isTrunk) {
    return (
      <>
        {showArrow && <ArrowMarker id={markerId} color={stroke} />}
        {/* Casing: a wide, soft, low-opacity stroke that gives the conduit its
         *  block-arrow heft. Solid + round caps/joins; never dashed. */}
        <path
          d={path}
          stroke={stroke}
          strokeWidth={TRUNK_CASING}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.22}
        />
        {/* Core: the foreground conduit. Dash + flow animation live here. */}
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEndRef}
          data-flow-state={state}
          className={flowing ? styles.flowing : undefined}
          style={{
            stroke,
            strokeWidth: TRUNK_CORE,
            strokeDasharray: dash,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            fill: "none",
          }}
        />
        {blockBar !== null && (
          <line
            x1={blockBar.x1}
            y1={blockBar.y1}
            x2={blockBar.x2}
            y2={blockBar.y2}
            stroke={stroke}
            strokeWidth={4}
            strokeLinecap="round"
          />
        )}
      </>
    );
  }

  // --- STRAND or PLAIN edge --------------------------------------------------
  return (
    <>
      {showArrow && <ArrowMarker id={markerId} color={stroke} />}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEndRef}
        data-flow-state={state}
        className={
          flowing
            ? styles.flowing
            : reverseRed
              ? styles.flowingReverse
              : undefined
        }
        style={
          isStrand
            ? strandStyle
            : {
                stroke,
                strokeWidth: PLAIN_WIDTH,
                strokeDasharray: dash,
                strokeLinecap: "round",
                fill: "none",
              }
        }
      />
    </>
  );
}

/** A short perpendicular "stop" bar centred on `p0` (the apex), normal to the
 *  p0→p1 direction — the visible "blocked here" indicator on the trunk. */
function blockBarAt(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const half = 11;
  return {
    x1: round(p0.x - nx * half),
    y1: round(p0.y - ny * half),
    x2: round(p0.x + nx * half),
    y2: round(p0.y + ny * half),
  };
}
