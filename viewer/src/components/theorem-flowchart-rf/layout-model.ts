// Shared layout vocabulary for the theorem flowchart: the result shapes every
// consumer reads, the graph-preparation entry point, the rank-band partition,
// the fit-scale probe, and the content caps.
//
// Pure, DOM-free and Node-safe. The unit runner and the OG route import this
// module directly, so it must never reach a `"use client"` module and must use
// only exactly-rounded float ops — both are enforced by the server-safety spec.
// The layout ENGINE (dagre) stays in `layout.ts`; this module holds what the
// engine, the shell and the OG renderer all need to agree on.

import { disambiguateDuplicateNodes } from "./disambiguate-duplicate-nodes";
import { CONTAINER_NODE_ID, isInteriorKind } from "./types";
import type {
  ByteRange,
  FlowchartEdge,
  RfFlowchartNode,
  TokenTree,
  ViewerStance,
} from "./types";

// ---- Layout result shape ---------------------------------------------------

/**
 * A node's CENTER position with the box the layout reserved. All boxes —
 * interior children and the synthetic container alike — are in the SAME absolute
 * flow coordinate space and are CENTER-based (`x`/`y` is the box centre); the
 * React Flow shell converts to top-left via `topLeft()` and re-bases children
 * against the (also-center) container box.
 */
export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A waypoint polyline for one edge, in the same absolute coordinate space. */
export interface LayoutEdge {
  source: string;
  target: string;
  points: Array<{ x: number; y: number }>;
}

export interface LayoutResult {
  /**
   * Absolute, CENTER-based box per node id — INCLUDING the synthetic container
   * when present. Interior children boxes are in the same absolute space as the
   * container box (the shell re-bases them to parent-relative).
   */
  boxes: Record<string, LayoutBox>;
  /** Edge polylines (absolute flow coords), dagre-routed. */
  edges: LayoutEdge[];
  /**
   * Interior node ids that should render as CHILDREN of the container (only
   * populated when expanded). Empty when collapsed or when there is no interior.
   */
  containerChildren: string[];
  /** True iff a proof-group container exists (i.e. the graph has interior nodes). */
  hasContainer: boolean;
}

// ---- Box table -------------------------------------------------------------

/** The rendered size of one card. */
export interface BoxSize {
  width: number;
  height: number;
}

/**
 * Per-node-id card sizes. The page fills it from measured DOM boxes, the OG
 * route from its fixed presets; a MISSING entry falls back to the caller's fixed
 * default, so a partial (or absent) table lays out exactly as the uniform-card
 * layout always did.
 */
export type BoxTable = Record<string, BoxSize>;

/** Resolve one node's box, falling back to the caller's fixed default. */
export function boxSize(
  boxes: BoxTable | undefined,
  id: string,
  fallback: BoxSize,
): BoxSize {
  return boxes?.[id] ?? fallback;
}

// ---- Graph preparation -----------------------------------------------------

/** The kind partition every layout pass keys off. */
export interface NodePartition {
  premises: RfFlowchartNode[];
  interior: RfFlowchartNode[];
  conclusions: RfFlowchartNode[];
  interiorIds: Set<string>;
  conclusionIds: Set<string>;
}

/** The raw payload made layout-ready: ids disambiguated, nodes partitioned. */
export interface PreparedGraph extends NodePartition {
  nodes: RfFlowchartNode[];
  edges: FlowchartEdge[];
  stance: ViewerStance | undefined;
}

/** Split a node list into the three layout roles, preserving payload order. */
export function partitionNodes(nodes: RfFlowchartNode[]): NodePartition {
  const premises = nodes.filter((n) => n.kind === "premise");
  const conclusions = nodes.filter((n) => n.kind === "conclusion");
  const interior = nodes.filter((n) => isInteriorKind(n.kind));
  return {
    premises,
    interior,
    conclusions,
    interiorIds: new Set(interior.map((n) => n.id)),
    conclusionIds: new Set(conclusions.map((n) => n.id)),
  };
}

/**
 * The single graph-prep entry: resolve duplicate-hash node-id collisions, then
 * partition. Every surface that lays a theorem out — the page shell and the OG
 * route — starts here from the RAW payload, so page and card agree on node
 * identity, node order and roles before any geometry is computed.
 */
export function prepareGraph(
  nodes: RfFlowchartNode[],
  edges: FlowchartEdge[],
  stance?: ViewerStance,
): PreparedGraph {
  const resolved = disambiguateDuplicateNodes(nodes, edges, stance);
  return { ...resolved, ...partitionNodes(resolved.nodes) };
}

// ---- Rank bands ------------------------------------------------------------

export type RankBandKind = "premise" | "container" | "conclusion";

/** One rank band: a disjoint horizontal row of the layout, top to bottom. */
export interface RankBand {
  kind: RankBandKind;
  ids: string[];
}

/**
 * The graph's rank bands, top to bottom: one band per premise GRID ROW, then the
 * proof-fold container, then the conclusion row. Bands are disjoint by
 * construction, which is what lets a solver clamp each node into a y-interval
 * without ever inverting the premises → proof → conclusion reading order.
 * `columns` is clamped to `[1, premiseCount]`, matching the premise grid.
 */
export function assignBands(graph: NodePartition, columns: number): RankBand[] {
  const bands: RankBand[] = [];
  const n = graph.premises.length;
  if (n > 0) {
    const cols = Math.max(1, Math.min(Math.round(columns), n));
    for (let i = 0; i < n; i += cols) {
      bands.push({
        kind: "premise",
        ids: graph.premises.slice(i, i + cols).map((p) => p.id),
      });
    }
  }
  bands.push({ kind: "container", ids: [CONTAINER_NODE_ID] });
  if (graph.conclusions.length > 0) {
    bands.push({
      kind: "conclusion",
      ids: graph.conclusions.map((c) => c.id),
    });
  }
  return bands;
}

/**
 * The ids in READING ORDER: band top-to-bottom, then left-to-right, id last.
 * Bands are recovered from the realised boxes by a top-sorted sweep rather than
 * from {@link assignBands}, so the order tracks where the cards actually LANDED
 * — which is what a tab sequence has to follow (WCAG 2.4.3), and which holds for
 * the grid fallback as much as for a relaxed layout. Ids with no box are dropped.
 */
export function readingOrder(
  ids: Iterable<string>,
  boxes: Record<string, LayoutBox>,
): string[] {
  const present = [...ids].filter((id) => boxes[id] !== undefined);
  const top = (id: string) => boxes[id].y - boxes[id].height / 2;
  const bottom = (id: string) => boxes[id].y + boxes[id].height / 2;
  const swept = [...present].sort(
    (a, b) => top(a) - top(b) || boxes[a].x - boxes[b].x || compareIds(a, b),
  );

  const band = new Map<string, number>();
  let index = 0;
  let floor = -Infinity;
  for (const id of swept) {
    // A card whose top clears every card so far starts the next band; the
    // solver's bands are disjoint, so this recovers exactly them.
    if (top(id) >= floor) {
      if (floor !== -Infinity) index++;
      floor = bottom(id);
    } else {
      floor = Math.max(floor, bottom(id));
    }
    band.set(id, index);
  }

  return present.sort(
    (a, b) =>
      band.get(a)! - band.get(b)! ||
      boxes[a].x - boxes[b].x ||
      compareIds(a, b),
  );
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---- Edge reduction onto the container boundary ----------------------------

/**
 * Re-route edges for the OUTER graph onto the collapsed/container view.
 *
 * The proof fold is a BLACK BOX and we enforce the invariant (design contract
 * § 3): EVERY premise feeds the container, and the conclusion's ONLY parent is
 * the container. Concretely we map each domain edge onto the container boundary:
 *   - interior↔interior  → dropped (the inner pass lays these out)
 *   - premise → interior → `premise → container`   (premise feeds the proof)
 *   - premise → conclusion (DIRECT) → `premise → container`  ← the fix: the
 *       proof's FINAL derivation step consumes some premises straight into the
 *       conclusion; those premises are still feeding the PROOF, so the strand
 *       must enter the container, not bypass it to the conclusion.
 *   - interior → conclusion → `container → conclusion`  (the trunk out)
 * A direct premise→conclusion edge therefore SPLITS into two reduced edges (the
 * strand in + the trunk out). Deduplicated, so the N premises collapse to N
 * strands into the container and the conclusion gets exactly ONE
 * `container → conclusion` no matter how many proof steps produced it.
 *
 * Finally, a conclusion left with NO reduced in-edge is joined to the container
 * anyway: a premise-free certificate's wire DAG is one settled conclusion node
 * and an EMPTY edge array, and the container is synthesized unconditionally, so
 * without this the two boxes would never join.
 */
export function reduceEdges(
  edges: FlowchartEdge[],
  interiorIds: Set<string>,
  conclusionIds: Set<string>,
): FlowchartEdge[] {
  const seen = new Set<string>();
  const targets = new Set<string>();
  const out: FlowchartEdge[] = [];
  const push = (source: string, target: string) => {
    if (source === target) return;
    const key = `${source}->${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.add(target);
    out.push({ source, target });
  };
  for (const e of edges) {
    if (conclusionIds.has(e.source)) {
      if (process.env.NODE_ENV !== "production") {
        console.error(
          `reduceEdges: dropped conclusion-sourced edge ${e.source} -> ${e.target}`,
        );
      }
      continue;
    }
    const srcIn = interiorIds.has(e.source);
    const tgtIn = interiorIds.has(e.target);
    if (srcIn && tgtIn) continue; // wholly interior — laid out in the inner pass
    // Map this domain edge onto the black-box boundary.
    if (conclusionIds.has(e.target) && !srcIn) {
      // DIRECT premise→conclusion (the proof's final step). The premise still
      // feeds the PROOF, so split it into the strand IN (premise → container)
      // and the trunk OUT (container → conclusion). The trunk-out dedupes
      // against the interior→conclusion edge, so the conclusion keeps a single
      // incoming edge while the premise joins the fan into the container.
      push(e.source, CONTAINER_NODE_ID);
      push(CONTAINER_NODE_ID, e.target);
      continue;
    }
    // Any endpoint touching the interior maps to the container; everything else
    // (incl. interior→conclusion → container→conclusion) passes through.
    push(
      srcIn ? CONTAINER_NODE_ID : e.source,
      tgtIn ? CONTAINER_NODE_ID : e.target,
    );
  }
  for (const id of conclusionIds) {
    if (!targets.has(id)) push(CONTAINER_NODE_ID, id);
  }
  return out;
}

// ---- Fit-scale probe -------------------------------------------------------

/** Clamp range for the responsive column count — a sane band the human eyeballs. */
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 8;

export interface ColumnFit {
  /** The chosen premise-grid column count. */
  columns: number;
  /** Unpadded `min(vw/w, vh/h)` the chosen count achieves; 0 when undefined. */
  fitScale: number;
}

/** Unpadded fit scale of a laid-out box set inside a viewport; 0 if degenerate. */
export function fitScaleOf(
  boxes: Record<string, LayoutBox>,
  viewportW: number,
  viewportH: number,
): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of Object.values(boxes)) {
    minX = Math.min(minX, b.x - b.width / 2);
    maxX = Math.max(maxX, b.x + b.width / 2);
    minY = Math.min(minY, b.y - b.height / 2);
    maxY = Math.max(maxY, b.y + b.height / 2);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return 0;
  return Math.min(viewportW / w, viewportH / h);
}

/**
 * The zoom floor a canvas may never clamp ABOVE. Below it the graph is unreadable
 * anyway, so it is where the zoom-out affordance stops for an ordinary graph.
 */
export const MIN_ZOOM_FLOOR = 0.2;

/**
 * The `minZoom` a laid-out graph needs in a viewport it will be `fitView`n into.
 * Cards size to content, so a tall graph's fit can land BELOW the floor — and
 * React Flow clamps the fit against `minZoom`, so a fixed floor would silently
 * zoom the fit back IN and crop the graph. Taking the smaller of the two keeps
 * the fit exact and still stops an ordinary graph at the floor.
 *
 * The divisor is not slack: {@link fitScaleOf} is the UNPADDED `min(vw/w, vh/h)`
 * while `fitView` targets `fitScale / (1 + padding)` (`@xyflow/system`
 * `getViewportForBounds`), so comparing against the unpadded scale would consume
 * the padding box exactly in the regime the floor exists for.
 */
export function fitMinZoom(
  boxes: Record<string, LayoutBox>,
  viewportW: number,
  viewportH: number,
  padding: number,
): number {
  const scale = fitScaleOf(boxes, viewportW, viewportH);
  if (scale <= 0) return MIN_ZOOM_FLOOR;
  return Math.min(MIN_ZOOM_FLOOR, scale / (1 + padding));
}

/**
 * Pick the premise-column count whose resulting layout fits the viewport with the
 * LARGEST scale — i.e. whose diagram bounding box best matches the viewport's
 * aspect ratio, so `fitView` blows the cards up as large as possible. We run the
 * (cheap, pure) layout for each candidate count and keep the one with the highest
 * fit-scale `min(vw/w, vh/h)`. Wide viewport ⇒ more columns / shorter block;
 * narrow ⇒ fewer columns / taller block. Clamped to `[MIN_COLUMNS, MAX_COLUMNS]`
 * and never more columns than premises.
 *
 * The winning SCALE is returned alongside the count: the resize deadband decides
 * on the scale delta, and the OG fit pipeline seeds its aspect from it.
 */
export function fitScaleColumns(
  layoutFor: (cols: number) => LayoutResult,
  premiseCount: number,
  viewportW: number,
  viewportH: number,
): ColumnFit {
  if (premiseCount <= 1 || viewportW <= 0 || viewportH <= 0) {
    const columns = Math.max(1, premiseCount);
    const fitScale =
      viewportW > 0 && viewportH > 0
        ? fitScaleOf(layoutFor(columns).boxes, viewportW, viewportH)
        : 0;
    return { columns, fitScale };
  }
  const maxCols = Math.min(MAX_COLUMNS, premiseCount);
  let best = MIN_COLUMNS;
  let bestScale = -Infinity;
  for (let cols = MIN_COLUMNS; cols <= maxCols; cols++) {
    const scale = fitScaleOf(layoutFor(cols).boxes, viewportW, viewportH);
    if (scale === 0) continue;
    // Prefer more columns on ties (shorter blocks read better at the same scale).
    if (scale >= bestScale) {
      bestScale = scale;
      best = cols;
    }
  }
  return { columns: best, fitScale: bestScale > 0 ? bestScale : 0 };
}

// ---- Measure Rungs ---------------------------------------------------------

/**
 * The named card measures (px) a page card may be laid out at, widest first,
 * each paired with the container width that selects it. Enumerable BY DESIGN:
 * the arrangement space is {rung} × {column count}, so the same theorem at the
 * same rung and column count lays out identically on every load.
 */
export const MEASURE_RUNGS: ReadonlyArray<{
  minContainerWidth: number;
  rung: number;
}> = [
  { minContainerWidth: 1024, rung: 320 },
  { minContainerWidth: 720, rung: 240 },
  { minContainerWidth: 0, rung: 190 },
];

/** The Measure Rung a container of this width renders at. */
export function measureRung(containerWidth: number): number {
  for (const step of MEASURE_RUNGS) {
    if (containerWidth >= step.minContainerWidth) return step.rung;
  }
  return MEASURE_RUNGS[MEASURE_RUNGS.length - 1].rung;
}

// ---- Content caps ----------------------------------------------------------

/**
 * Anti-abuse cap on a rendered proposition, in UTF-8 bytes. Binds BOTH page
 * render paths identically — {@link capProposition} for the delaborated token
 * tree and {@link capAuthorRange} for the author-view source slice — so the same
 * proposition truncates to the same byte prefix whichever path renders it.
 */
export const MAX_PROP_BYTES = 8000;

/** Cap on a rendered binder name, in code points ({@link capName}). */
export const NAME_CAP = 48;

/**
 * The token appended to (or inserted into) anything the caps truncated. Exported
 * for the author-view card: {@link capAuthorRange} moves a byte offset, so that
 * path has no token to carry the mark and the card appends it itself.
 */
export const CAP_ELLIPSIS = "⋯";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Longest prefix of `text` within `maxBytes` UTF-8 bytes, cut on a code point. */
function utf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // 10xxxxxx is a continuation byte: walk back to the sequence's lead byte.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return decoder.decode(bytes.subarray(0, end));
}

/** Surface text of a token tree — what a tag advertises, and what a surface with
 *  no styling (the OG card's fixed boxes) renders. */
export function tokenText(tree: TokenTree): string {
  if (tree.node === "text") return tree.text;
  if (tree.node === "append") return tree.children.map(tokenText).join("");
  return tokenText(tree.child);
}

interface CapBudget {
  left: number;
  truncated: boolean;
}

/** Prune a subtree to the remaining budget; null when nothing of it survives. */
function capSubtree(tree: TokenTree, budget: CapBudget): TokenTree | null {
  if (tree.node === "text") {
    const bytes = encoder.encode(tree.text);
    if (bytes.length <= budget.left) {
      budget.left -= bytes.length;
      return tree;
    }
    const kept = utf8Prefix(tree.text, budget.left);
    budget.left = 0;
    budget.truncated = true;
    return kept === "" ? null : { node: "text", text: kept };
  }
  if (tree.node === "append") {
    const children: TokenTree[] = [];
    let changed = false;
    for (const child of tree.children) {
      const capped = capSubtree(child, budget);
      if (capped === null) {
        changed = true;
        continue;
      }
      if (capped !== child) changed = true;
      children.push(capped);
    }
    if (!changed) return tree;
    return children.length === 0 ? null : { node: "append", children };
  }
  const child = capSubtree(tree.child, budget);
  if (child === null) return null;
  if (child === tree.child) return tree;
  // The tag's `text` is the surface text of its subtree — re-derive it so a
  // truncated tag never advertises text it no longer renders.
  return { node: "tag", tag: { ...tree.tag, text: tokenText(child) }, child };
}

/**
 * Cap a proposition's token tree at {@link MAX_PROP_BYTES}: whole tokens are kept
 * by encoded byte length, the token straddling the budget is split on a UTF-8
 * code-point boundary, and a `⋯` token is appended. Tree in, tree out — the
 * renderer is unchanged and the tags (identifier links, kinds) survive intact.
 */
export function capProposition(tree: TokenTree): TokenTree {
  const budget: CapBudget = { left: MAX_PROP_BYTES, truncated: false };
  const capped = capSubtree(tree, budget);
  if (!budget.truncated) return tree;
  const ellipsis: TokenTree = { node: "text", text: CAP_ELLIPSIS };
  if (capped === null) return ellipsis;
  return { node: "append", children: [capped, ellipsis] };
}

/**
 * The capped token tree a card renders for `node` in `view` — the delaborated
 * render path, shared by the premise/conclusion card and the interior step so a
 * proposition cannot escape the cap by sitting inside the proof. Which tree wins
 * is derived EXACTLY as the production `flowchart-node.tsx` derives it.
 */
export function pickTree(
  node: RfFlowchartNode,
  view: "author" | "empty",
): TokenTree | null {
  if (node.tokens === null) return null;
  const tree =
    view === "author"
      ? (node.tokens.author ?? node.tokens.empty)
      : node.tokens.empty;
  return capProposition(tree);
}

/**
 * Clamp an author-view source span to {@link MAX_PROP_BYTES}, landing the new end
 * on a code-point boundary of `source`'s UTF-8 encoding. Paired with
 * {@link capProposition}: the same proposition capped through either path yields
 * the same byte prefix.
 */
export function capAuthorRange(range: ByteRange, source: string): ByteRange {
  if (range.end - range.start <= MAX_PROP_BYTES) return range;
  const bytes = encoder.encode(source);
  let end = Math.min(range.start + MAX_PROP_BYTES, bytes.length);
  while (end > range.start && (bytes[end] & 0xc0) === 0x80) end--;
  return { start: range.start, end };
}

/**
 * Cap a binder name at {@link NAME_CAP} code points with a middle ellipsis, so
 * the distinguishing tail of a long generated name survives. The result is
 * exactly {@link NAME_CAP} code points including the ellipsis.
 */
export function capName(name: string): string {
  const points = [...name];
  if (points.length <= NAME_CAP) return name;
  const head = Math.ceil((NAME_CAP - 1) / 2);
  const tail = NAME_CAP - 1 - head;
  return (
    points.slice(0, head).join("") +
    CAP_ELLIPSIS +
    points.slice(points.length - tail).join("")
  );
}

/**
 * A binder name as a card header renders it. Returned as a PAIR so no call site
 * can show the capped label without the `title` that recovers what it dropped —
 * a middle-ellipsised name is the only place the full name is still reachable.
 */
export function nameHeader(name: string): { label: string; title: string } {
  return { label: capName(name), title: name };
}
