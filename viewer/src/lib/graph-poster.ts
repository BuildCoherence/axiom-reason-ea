// A static orthographic projection of the Graph Snapshot. Pure and node-safe: no
// `window`, no `document`, no React, so the server, the unit spec and the OG
// route all read one projection.
//
// It must look like the canvas: `nodeToken` follows `nodeColor`'s precedence,
// `nodeRadius` follows the canvas's sqrt(degree) sizing, depth is opacity alone,
// and the block carries the whole emitted graph rather than a ranked prefix.
//
// Nodes carry the Kind Legend's design TOKEN, never a literal and never a
// resolved value; a consumer that cannot resolve custom properties resolves the
// same token through `kindLegendHex`.

import { KIND_LEGEND_BY_KIND, type GraphNodeKind } from "./graph-kind-legend";
import {
  GRAPH_FLAG_FALSE_PROPOSITION,
  GRAPH_FLAG_SETTLED,
} from "./graph-node-flags";
import type { Base16Token } from "./resolve-css-color";

/** Square viewBox side. Unitless — the SVG scales to its container. */
export const GRAPH_POSTER_VIEWBOX = 100;

/** Inset, in viewBox units, so the outermost nodes are not clipped by the edge
 *  (a node's radius extends past its centre). */
const GRAPH_POSTER_PADDING = 4;

/** Where a degenerate projection lands: the middle of the square viewBox. */
const GRAPH_POSTER_CENTRE = GRAPH_POSTER_VIEWBOX / 2;

// The canvas's sizing formula, pre-scaled into viewBox units (×46). Literals
// rather than imports: `graph-scene-model.ts` is a client module that would pull
// the scene builder into a server render. The spec asserts the two agree.
const NODE_RADIUS_BASE = 0.23;
const NODE_RADIUS_PER_SQRT_DEGREE = 0.12;
const NODE_RADIUS_MAX = 0.92;
/** A SINGLE-NODE exception, applied after the cap — `nodeRadius`'s rule. */
const NODE_RADIUS_FALSE_MULTIPLE = 2.5;

/** Opacity range. Depth's ONLY channel now that radius carries degree. */
const NODE_OPACITY_NEAR = 1;
const NODE_OPACITY_FAR = 0.5;

/** Stroke width in viewBox units. One width for every kind — at this scale a
 *  second hairline weight is not resolvable, so alpha carries the distinction. */
export const GRAPH_POSTER_EDGE_WIDTH = 0.16;

/** How far an arc bows off its chord, as a fraction of the chord length —
 *  `GRAPH_ARC_LIFT`'s value, so the poster bows the way the canvas does. */
const GRAPH_POSTER_ARC_LIFT = 0.18;

/** Per-kind stroke opacity, mirroring the canvas's two edge layers, scaled down
 *  as a set: there is no depth sorting and no additive compositing here. */
const EDGE_OPACITY_BY_KIND: Readonly<Record<string, number>> = {
  entails: 0.42,
  negates: 0.6,
};
const EDGE_OPACITY_DEFAULT = 0.25;

/** How far the FARTHEST edge fades, as a fraction of its kind's opacity. */
const EDGE_DEPTH_FADE = 0.45;

/** The Graph Manifest's `poster` block — the whole emitted graph reduced to
 *  what a picture of it needs. Columnar; every array is parallel. */
export type GraphPosterBlock = {
  x: readonly number[];
  y: readonly number[];
  z: readonly number[];
  kind: readonly string[];
  flags: readonly number[];
  degree: readonly number[];
  src: readonly number[];
  dst: readonly number[];
  kinds: readonly string[];
  truncated?: boolean;
};

/** One projected node, in viewBox coordinates, ready to become a `<circle>`. */
export type GraphPosterNode = {
  /** Index into the block — stable, and the React key. */
  i: number;
  kind: string;
  /** Kind Legend colour token, e.g. `--base0C`. Render as `var(<token>)`. */
  token: Base16Token;
  cx: number;
  cy: number;
  r: number;
  opacity: number;
};

/** One projected edge. `d` is a quadratic Bézier path, matching the canvas. */
export type GraphPosterEdge = {
  i: number;
  kind: string;
  d: string;
  opacity: number;
};

export type GraphPosterScene = {
  nodes: GraphPosterNode[];
  edges: GraphPosterEdge[];
};

function normalize(value: number, min: number, max: number): number {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return 0.5;
  const t = (value - min) / span;
  if (!Number.isFinite(t)) return 0.5;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** ONE decimal place: a tenth of a viewBox unit is already sub-pixel, and a
 *  second digit ships in the document ~1600 times. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export type GraphPosterFit = {
  midX: number;
  midY: number;
  minZ: number;
  maxZ: number;
  /** viewBox units per world unit. 0 when the box has no extent. */
  scale: number;
};

/** Fit the block's bounding box to the padded viewBox. ONE scale for both axes:
 *  fitting them independently would draw the same graph as a different shape. */
export function fitPosterBlock(block: GraphPosterBlock): GraphPosterFit {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;
  const n = block.x.length;
  for (let i = 0; i < n; i++) {
    // A non-finite coordinate is skipped rather than allowed to poison the box
    // for every other node.
    const x = block.x[i],
      y = block.y[i],
      z = block.z[i];
    if (Number.isFinite(x)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (Number.isFinite(y)) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (Number.isFinite(z)) {
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  const inner = GRAPH_POSTER_VIEWBOX - GRAPH_POSTER_PADDING * 2;
  return {
    midX: (minX + maxX) / 2,
    midY: (minY + maxY) / 2,
    minZ,
    maxZ,
    scale: Number.isFinite(extent) && extent > 0 ? inner / extent : 0,
  };
}

/** Place one world coordinate on a viewBox axis. `sign` is -1 for y, which
 *  flips `+y`-up world space into SVG's `+y`-down. */
function place(value: number, mid: number, scale: number, sign: 1 | -1): number {
  const placed = GRAPH_POSTER_CENTRE + sign * (value - mid) * scale;
  // A `NaN` in an SVG coordinate drops the mark entirely, with no error
  // anywhere.
  return Number.isFinite(placed) ? round(placed) : GRAPH_POSTER_CENTRE;
}

/** A node's colour token: the canvas's `nodeColor` precedence exactly — False,
 *  then settled, then the kind. */
export function nodeLegendKey(kind: string, flags: number): string {
  return flags & GRAPH_FLAG_FALSE_PROPOSITION
    ? "false-proposition"
    : flags & GRAPH_FLAG_SETTLED
      ? "settled"
      : kind;
}

export function nodeToken(kind: string, flags: number): Base16Token {
  const key = nodeLegendKey(kind, flags);
  const entry = KIND_LEGEND_BY_KIND.get(key as GraphNodeKind);
  if (!entry) {
    // Reachable if a Generation emits a kind this release predates; name it so
    // `format_version` is the obvious diagnosis.
    throw new Error(`graph-poster: no Kind Legend entry for "${key}"`);
  }
  return entry.token;
}

/** A node's radius, in viewBox units — the canvas's `nodeRadius`, pre-scaled. */
export function nodeRadius(degree: number, isFalseProposition: boolean): number {
  const r = Math.min(
    NODE_RADIUS_BASE + Math.sqrt(Math.max(degree, 0)) * NODE_RADIUS_PER_SQRT_DEGREE,
    NODE_RADIUS_MAX,
  );
  return isFalseProposition ? r * NODE_RADIUS_FALSE_MULTIPLE : r;
}

/** A quadratic Bézier bowing away from the frame's centre — `arcControlPoint`'s
 *  3D outward bow, approximated in 2D. */
function arcPath(ax: number, ay: number, bx: number, by: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  // The chord's normal, oriented outward from the frame's centre.
  let nx = -(by - ay);
  let ny = bx - ax;
  const outX = mx - GRAPH_POSTER_CENTRE;
  const outY = my - GRAPH_POSTER_CENTRE;
  if (nx * outX + ny * outY < 0) {
    nx = -nx;
    ny = -ny;
  }
  const qx = round(mx + nx * GRAPH_POSTER_ARC_LIFT);
  const qy = round(my + ny * GRAPH_POSTER_ARC_LIFT);
  return `M${ax} ${ay}Q${qx} ${qy} ${bx} ${by}`;
}

/** Project the whole block onto the square viewBox, orthographic down z. Nodes
 *  come back BACK-TO-FRONT, which is SVG's paint order; edges come back in wire
 *  order and are drawn under every node. */
export function graphPosterScene(
  block: GraphPosterBlock | undefined,
): GraphPosterScene {
  if (!block || block.x.length === 0) return { nodes: [], edges: [] };
  const { midX, midY, minZ, maxZ, scale } = fitPosterBlock(block);
  const n = Math.min(
    block.x.length,
    block.y.length,
    block.z.length,
    block.kind.length,
    block.flags.length,
    block.degree.length,
  );

  const cx = new Array<number>(n);
  const cy = new Array<number>(n);
  const nodes: (GraphPosterNode & { depth: number })[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const depth = normalize(block.z[i], minZ, maxZ);
    const flags = block.flags[i];
    cx[i] = place(block.x[i], midX, scale, 1);
    cy[i] = place(block.y[i], midY, scale, -1);
    nodes[i] = {
      i,
      kind: block.kind[i],
      token: nodeToken(block.kind[i], flags),
      cx: cx[i],
      cy: cy[i],
      r: round(
        nodeRadius(block.degree[i], (flags & GRAPH_FLAG_FALSE_PROPOSITION) !== 0),
      ),
      opacity: round(
        NODE_OPACITY_FAR + (NODE_OPACITY_NEAR - NODE_OPACITY_FAR) * depth,
      ),
      depth,
    };
  }

  // A short column is a malformed manifest, not a reason to throw during a
  // server render: the poster degrades to the pairs all three columns agree on.
  const pairs = Math.min(block.src.length, block.dst.length, block.kinds.length);
  const edges: GraphPosterEdge[] = [];
  for (let e = 0; e < pairs; e++) {
    const a = block.src[e];
    const b = block.dst[e];
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    if (a < 0 || b < 0 || a >= n || b >= n || a === b) continue;
    const kind = block.kinds[e];
    // The same z ramp the discs use, so an arc recedes with the nodes it joins.
    const depth = normalize((block.z[a] + block.z[b]) / 2, minZ, maxZ);
    const base = EDGE_OPACITY_BY_KIND[kind] ?? EDGE_OPACITY_DEFAULT;
    edges.push({
      i: e,
      kind,
      d: arcPath(cx[a], cy[a], cx[b], cy[b]),
      opacity: round(base * (EDGE_DEPTH_FADE + (1 - EDGE_DEPTH_FADE) * depth)),
    });
  }

  return {
    nodes: nodes
      .sort((p, q) => p.depth - q.depth)
      .map(({ depth: _depth, ...node }) => node),
    edges,
  };
}

/** The poster's inner SVG markup, as ONE string: React streams a subtree this
 *  large into `<template>` placeholders that `$RS()` swaps in, which needs
 *  JavaScript — the one thing the poster must not depend on. Every value written
 *  is a number this module computed or a `--baseNN` token, and `paint` takes a
 *  token RESOLVER rather than a raw map, so nothing attacker-controlled reaches
 *  an attribute. */
export function graphPosterSvgBody(
  scene: GraphPosterScene,
  paint: { node: (token: Base16Token) => string; edge: string },
): string {
  const out: string[] = [];
  // Arcs first, so every disc paints over the edges that meet it.
  if (scene.edges.length > 0) {
    out.push(
      `<g fill="none" stroke="${paint.edge}" stroke-width="${GRAPH_POSTER_EDGE_WIDTH}" stroke-linecap="round">`,
    );
    for (const edge of scene.edges) {
      out.push(`<path d="${edge.d}" opacity="${edge.opacity}"/>`);
    }
    out.push("</g>");
  }
  // One group per fill, so the colour is written once rather than ~850 times.
  // Opacity stays per-element: it carries continuous depth.
  const byToken = new Map<Base16Token, GraphPosterNode[]>();
  for (const node of scene.nodes) {
    const group = byToken.get(node.token);
    if (group) group.push(node);
    else byToken.set(node.token, [node]);
  }
  for (const [token, group] of byToken) {
    out.push(`<g fill="${paint.node(token)}">`);
    for (const node of group) {
      out.push(
        `<circle cx="${node.cx}" cy="${node.cy}" r="${node.r}" opacity="${node.opacity}"/>`,
      );
    }
    out.push("</g>");
  }
  return out.join("");
}

/** Which Kind Legend rows the picture ACTUALLY CONTAINS, in legend order.
 *  Derived from the drawn block, never from a static list or from `counts`:
 *  whether a STATE is present is a fact about what was drawn, and there is
 *  exactly one `False` node in a corpus. */
export function graphPosterLegendKeys(
  block: GraphPosterBlock | undefined,
): string[] {
  if (!block) return [];
  const present = new Set<string>();
  const n = Math.min(block.kind.length, block.flags.length);
  for (let i = 0; i < n; i++) {
    present.add(nodeLegendKey(block.kind[i], block.flags[i]));
  }
  // Legend order, not encounter order, so the rows read as a scale.
  return [...KIND_LEGEND_BY_KIND.keys()].filter((key) => present.has(key));
}
