// Seeded, rank-banded ForceAtlas2 placement behind an unchanged `LayoutResult`.
// Pure, DOM-free and Node-safe (see `theorem-layout-server-safety.spec.ts`).

import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

import {
  BAND_CLEARANCE,
  DEFAULT_PREMISE_COLUMNS,
  NODE_WIDTH,
  WOBBLE,
  layoutTheorem,
} from "./layout";
import { assignBands, partitionNodes, prepareGraph, reduceEdges } from "./layout-model";
import type {
  BoxTable,
  LayoutBox,
  LayoutEdge,
  LayoutResult,
  NodePartition,
  RankBandKind,
} from "./layout-model";
import { CONTAINER_NODE_ID } from "./types";
import type { FlowchartEdge, RfFlowchartNode } from "./types";

/** Kill switch. False restores the pre-FD premise grid on every surface at once. */
export const FD_ENABLED = true;

/** FA2 repulsion scale in unit space; the extent band is stated in terms of it. */
export const SCALING_RATIO = 0.15;

// Both are declared in layout.ts — the premise row pitch is derived from them
// there — and re-exported here, where they are spent: WOBBLE is the freedom a
// band interval grants, BAND_CLEARANCE is what separates two intervals.
export { BAND_CLEARANCE, WOBBLE };

/** Above this premise count the seed stands unrelaxed: FA2 here is exact O(n²). */
export const FD_MAX_NODES = 200;

/** Mirrors `NODESEP` in layout.ts, which does not export it. */
const NODESEP = 48;

/** FA2's linear attraction against 1/d² repulsion collapses a pixel-scale seed. */
const UNIT = NODE_WIDTH + NODESEP;

/** Seed perturbation (px): a regular grid under symmetric forces has zero net force. */
const JITTER = 6;

const BATCHES = 6;
const ITERATIONS_PER_BATCH = 8;

/** All ten FA2 settings spelled literally — never `inferSettings`, whose values move with graph order. */
const FA2_SETTINGS = {
  linLogMode: false,
  outboundAttractionDistribution: true,
  adjustSizes: false,
  edgeWeightInfluence: 1,
  scalingRatio: SCALING_RATIO,
  strongGravityMode: false,
  gravity: 1,
  slowDown: 1,
  barnesHutOptimize: false,
  barnesHutTheta: 0.5,
};

/** Solver input. Carries no viewer stance: a card's box is a measurement, not a role. */
export interface ForceLayoutInput {
  nodes: RfFlowchartNode[];
  edges: FlowchartEdge[];
  collapsed: boolean;
  premiseColumns?: number;
  boxes?: BoxTable;
  /**
   * False ⇒ the seed stands unrelaxed, the same output {@link FD_MAX_NODES}
   * produces. A parameter rather than `iterations: 0`, which FA2 throws on.
   * Reserved for the `n > 200` and kill-switch paths; no surface passes it yet,
   * so {@link FD_MAX_NODES} is what exercises this branch today.
   */
  relax?: boolean;
}

/** The path an outer placement took, and the value the settle telemetry reports. */
export type LayoutMode =
  | "fd"
  | "seed_disabled"
  | "seed_max_nodes"
  | "stack"
  | "grid_fallback";

export interface OuterLayout {
  result: LayoutResult;
  mode: LayoutMode;
}

/**
 * The outer placement a surface commits to, plus the path it took. The solver is
 * a parameter so a caller can exercise the throw arm, and the kill switch is read
 * HERE rather than at each mount, so one constant restores the pre-FD grid
 * everywhere. A throw is the ONLY source of `grid_fallback`: the theorem page has
 * no error boundary of its own (the landing island and the OG route have theirs).
 */
export function outerLayout(
  input: ForceLayoutInput,
  solve: (input: ForceLayoutInput) => LayoutResult = layoutTheoremForce,
  enabled: boolean = FD_ENABLED,
): OuterLayout {
  // `view` is inert for geometry (layout.ts § LayoutInput), so the fallback and
  // the solver's own seed pass the same literal and stay comparable.
  const grid = (): LayoutResult =>
    layoutTheorem({
      nodes: input.nodes,
      edges: input.edges,
      view: "author",
      collapsed: input.collapsed,
      premiseColumns: input.premiseColumns,
      boxes: input.boxes,
    });

  if (!enabled) return { result: grid(), mode: "seed_disabled" };
  let result: LayoutResult;
  try {
    result = solve(input);
  } catch {
    return { result: grid(), mode: "grid_fallback" };
  }
  // Disambiguation never adds or drops a premise, so the raw count is the count
  // the solver's own guards saw.
  const premises = input.nodes.filter((n) => n.kind === "premise").length;
  if (premises < 2) return { result, mode: "stack" };
  if (premises > FD_MAX_NODES) return { result, mode: "seed_max_nodes" };
  return { result, mode: "fd" };
}

/** A rank band as a y-interval. */
export interface RankBandBox {
  kind: RankBandKind;
  ids: string[];
  top: number;
  bottom: number;
}

interface CanonicalGraph extends NodePartition {
  edges: FlowchartEdge[];
}

type Placement = Map<string, LayoutBox>;

/** Pure, and invariant under any permutation of `nodes` / `edges`. */
export function layoutTheoremForce(input: ForceLayoutInput): LayoutResult {
  const columns = input.premiseColumns ?? DEFAULT_PREMISE_COLUMNS;
  const boxes = finiteBoxes(input.boxes);
  const raw = prepareGraph(input.nodes, input.edges);

  // Nothing to relax, so the pre-FD layout of the payload AS GIVEN stands.
  if (raw.premises.length < 2) {
    return layoutTheorem({
      nodes: raw.nodes,
      edges: raw.edges,
      view: "author",
      collapsed: input.collapsed,
      premiseColumns: columns,
      boxes,
    });
  }

  const nodes = [...raw.nodes].sort((a, b) => compare(a.id, b.id));
  const edges = [...raw.edges].sort(
    (a, b) => compare(a.source, b.source) || compare(a.target, b.target),
  );
  const graph: CanonicalGraph = { ...partitionNodes(nodes), edges };

  const seed = layoutTheorem({
    nodes,
    edges,
    view: "author",
    collapsed: input.collapsed,
    premiseColumns: columns,
    boxes,
  });

  const bands = bandBoxes(graph, columns, seed.boxes).filter(
    (band) => band.kind === "premise",
  );

  const placement: Placement = new Map();
  const reseed = () => {
    for (const p of graph.premises) placement.set(p.id, { ...seed.boxes[p.id] });
  };
  reseed();
  const relaxing =
    (input.relax ?? true) && graph.premises.length <= FD_MAX_NODES;
  if (relaxing && !relax(graph, seed.boxes, bands, placement)) reseed();

  for (const band of bands) {
    for (const id of band.ids) project(band, placement.get(id)!);
    separate(band.ids, placement);
    for (const id of band.ids) quantise(band, placement.get(id)!);
  }

  // Below the REALISED premise extent, holding the gaps the seed reserved.
  const dy = bottomOf(graph.premises, (id) => placement.get(id)!) -
    bottomOf(graph.premises, (id) => seed.boxes[id]);
  for (const [id, box] of Object.entries(seed.boxes)) {
    if (placement.has(id)) continue;
    placement.set(id, { ...box, x: Math.round(box.x), y: Math.round(box.y + dy) });
  }

  // Several conclusions never stack on the spine — their band takes the sweep.
  const conclusionIds = graph.conclusions
    .map((c) => c.id)
    .filter((id) => placement.has(id));
  separate(conclusionIds, placement);
  for (const id of conclusionIds) {
    const box = placement.get(id)!;
    box.x = Math.round(box.x);
  }

  const out: Record<string, LayoutBox> = {};
  for (const [id, box] of placement) out[id] = box;

  const layoutEdges: LayoutEdge[] = [];
  for (const e of reduceEdges(edges, graph.interiorIds, graph.conclusionIds)) {
    const s = out[e.source];
    const t = out[e.target];
    if (s === undefined || t === undefined) continue;
    layoutEdges.push({
      source: e.source,
      target: e.target,
      points: [
        { x: s.x, y: Math.round(s.y + s.height / 2) },
        { x: t.x, y: Math.round(t.y - t.height / 2) },
      ],
    });
  }
  for (const e of seed.edges) {
    if (!graph.interiorIds.has(e.source) || !graph.interiorIds.has(e.target)) continue;
    layoutEdges.push({
      source: e.source,
      target: e.target,
      points: e.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y + dy) })),
    });
  }

  return {
    boxes: out,
    edges: layoutEdges,
    containerChildren: seed.containerChildren,
    hasContainer: seed.hasContainer,
  };
}

/**
 * Disjoint y-intervals: `max(h ∈ band) + 2·WOBBLE` centred on the band's extent.
 *
 * SEPARATED by {@link BAND_CLEARANCE}, not merely disjoint — two intervals that
 * abut let the cards inside them wobble into contact, which is what pinched the
 * strands out of sight. The separation is the seed grid's: `PREMISE_ROW_GAP` is
 * `BAND_CLEARANCE + 2·WOBBLE`, so each interval eats WOBBLE of the pitch and the
 * clearance is what is left. Every card is clamped whole inside its interval
 * ({@link project} / {@link quantise}), so that leftover IS the realised gap
 * floor between adjacent bands.
 */
export function bandBoxes(
  graph: NodePartition,
  columns: number,
  boxes: Record<string, LayoutBox>,
): RankBandBox[] {
  const out: RankBandBox[] = [];
  for (const band of assignBands(graph, columns)) {
    const ids = band.ids.filter((id) => boxes[id] !== undefined);
    if (ids.length === 0) continue;
    let top = Infinity;
    let bottom = -Infinity;
    let tallest = 0;
    for (const id of ids) {
      const box = boxes[id];
      top = Math.min(top, box.y - box.height / 2);
      bottom = Math.max(bottom, box.y + box.height / 2);
      tallest = Math.max(tallest, box.height);
    }
    const centre = (top + bottom) / 2;
    const half = tallest / 2 + WOBBLE;
    out.push({ kind: band.kind, ids, top: centre - half, bottom: centre + half });
  }
  return out;
}

/** Relax the premises in place. False ⇒ the run produced a non-finite coordinate. */
function relax(
  graph: CanonicalGraph,
  seedBoxes: Record<string, LayoutBox>,
  bands: RankBandBox[],
  placement: Placement,
): boolean {
  for (const p of graph.premises) {
    const box = placement.get(p.id)!;
    const offset = jitter(p.id);
    box.x += offset.x;
    box.y += offset.y;
  }

  let cx = 0;
  let cy = 0;
  for (const p of graph.premises) {
    const box = placement.get(p.id)!;
    cx += box.x;
    cy += box.y;
  }
  cx /= graph.premises.length;
  cy /= graph.premises.length;

  // FA2 accumulates mass and attraction in insertion order.
  const anchors = [CONTAINER_NODE_ID, ...graph.conclusions.map((c) => c.id)].filter(
    (id) => seedBoxes[id] !== undefined,
  );
  const inserted = [
    ...graph.premises.map((p) => ({ id: p.id, box: placement.get(p.id)!, fixed: false })),
    ...anchors.map((id) => ({ id, box: seedBoxes[id], fixed: true })),
  ].sort((a, b) => compare(a.id, b.id));

  const g = new Graph();
  for (const entry of inserted) {
    g.addNode(entry.id, {
      x: (entry.box.x - cx) / UNIT,
      y: (entry.box.y - cy) / UNIT,
      fixed: entry.fixed,
    });
  }
  const reduced = reduceEdges(graph.edges, graph.interiorIds, graph.conclusionIds).sort(
    (a, b) => compare(a.source, b.source) || compare(a.target, b.target),
  );
  for (const e of reduced) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    if (!g.hasEdge(e.source, e.target)) g.addEdge(e.source, e.target);
  }

  for (let batch = 0; batch < BATCHES; batch++) {
    forceAtlas2.assign(g, { iterations: ITERATIONS_PER_BATCH, settings: FA2_SETTINGS });
    for (const band of bands) {
      for (const id of band.ids) {
        const box = placement.get(id)!;
        const y = (g.getNodeAttribute(id, "y") as number) * UNIT + cy;
        const half = box.height / 2;
        const clamped = clamp(y, band.top + half, band.bottom - half);
        if (clamped !== y) g.setNodeAttribute(id, "y", (clamped - cy) / UNIT);
      }
    }
  }

  for (const p of graph.premises) {
    const x = (g.getNodeAttribute(p.id, "x") as number) * UNIT + cx;
    const y = (g.getNodeAttribute(p.id, "y") as number) * UNIT + cy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const box = placement.get(p.id)!;
    box.x = x;
    box.y = y;
  }
  return true;
}

/** Clamp a card's BOX (not its centre) into its band. */
function project(band: RankBandBox, box: LayoutBox): void {
  const half = box.height / 2;
  box.y = clamp(box.y, band.top + half, band.bottom - half);
}

/** Round to whole pixels, keeping the box inside its band. */
function quantise(band: RankBandBox, box: LayoutBox): void {
  const half = box.height / 2;
  box.x = Math.round(box.x);
  box.y = clamp(
    Math.round(box.y),
    Math.ceil(band.top + half),
    Math.floor(band.bottom - half),
  );
}

/** One monotone pass by centre-x separates every pair, consecutive or not. */
function separate(ids: string[], placement: Placement): void {
  if (ids.length < 2) return;
  const ordered = [...ids].sort((a, b) => {
    const dx = placement.get(a)!.x - placement.get(b)!.x;
    return dx !== 0 ? dx : compare(a, b);
  });
  const before = centreOf(ordered, placement);
  for (let i = 1; i < ordered.length; i++) {
    const prev = placement.get(ordered[i - 1])!;
    const cur = placement.get(ordered[i])!;
    const gap = (prev.width + cur.width) / 2 + NODESEP;
    if (cur.x - prev.x < gap) cur.x = prev.x + gap;
  }
  const shift = before - centreOf(ordered, placement);
  if (shift === 0) return;
  for (const id of ordered) placement.get(id)!.x += shift;
}

function centreOf(ids: string[], placement: Placement): number {
  let left = Infinity;
  let right = -Infinity;
  for (const id of ids) {
    const box = placement.get(id)!;
    left = Math.min(left, box.x - box.width / 2);
    right = Math.max(right, box.x + box.width / 2);
  }
  return (left + right) / 2;
}

function bottomOf(
  nodes: RfFlowchartNode[],
  boxOf: (id: string) => LayoutBox,
): number {
  let bottom = -Infinity;
  for (const n of nodes) {
    const box = boxOf(n.id);
    bottom = Math.max(bottom, box.y + box.height / 2);
  }
  return bottom;
}

/** A table with any non-finite or non-positive measure is rejected whole. */
function finiteBoxes(boxes: BoxTable | undefined): BoxTable | undefined {
  if (boxes === undefined) return undefined;
  for (const size of Object.values(boxes)) {
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return undefined;
    if (size.width <= 0 || size.height <= 0) return undefined;
  }
  return boxes;
}

const encoder = new TextEncoder();

/** 32-bit FNV-1a over the id's UTF-8 bytes. */
function fnv1a(id: string): number {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(id)) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return hash >>> 0;
}

/** ±JITTER px, derived from the node id — never from an array index. */
function jitter(id: string): { x: number; y: number } {
  const hash = fnv1a(id);
  const span = JITTER * 2 + 1;
  return { x: (hash % span) - JITTER, y: ((hash >>> 16) % span) - JITTER };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
