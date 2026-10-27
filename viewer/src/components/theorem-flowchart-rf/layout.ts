// The premise grid + the dagre proof interior for the React-Flow theorem-flowchart.
//
// THE SPINE (design contract § 1): this pure function takes the render graph +
// the current fold state and returns absolute node positions AND edge waypoints
// (`edge.points`). React Flow consumes these precomputed positions and is ONLY
// the pan/zoom/fit shell — it never lays out.
//
// Since the force-directed pass landed this is no longer the OUTER layout
// authority — `layout-force.ts` is, and it calls this for the seed it relaxes
// (the shell calls it again for the solver's throw-fallback). The INNER pass is
// unchanged and still dagre's alone.
//
// Kept a PURE function (no DOM, no React, no `getBoundingClientRect`) for
// testability + determinism: positions/waypoints are a deterministic function of
// (graph, fold state, columns, box table), so the same input always lays out the
// same way and the layout can be unit-tested in isolation. Card sizes arrive in
// that box table — measured by the shell, defaulted to NODE_WIDTH × NODE_HEIGHT
// for anything missing — so dagre's box IS the rendered box and React Flow gets
// the explicit per-node width/height it wants
// (the internal ssr-dag-flowchart-rendering doc § RF).
//
// PROOF FOLD (design contract § 3) is a VIEW-LAYER grouping handled here. The
// domain model is premises (sources) → a Proof Fold (one node) → conclusion
// (sink), where the fold holds a flat interior sub-DAG. We mirror that model with
// a TWO-LEVEL layout instead of running dagre over the flattened graph and
// bounding-boxing the children (which let premises drift into the container's
// vertical band):
//
//   1. OUTER placement (always): the premises are tiled into a centered GRID of
//      `premiseColumns` columns ABOVE the container (NOT one wide dagre rank —
//      that blew out to ~6000px at 20 premises and made fit-to-view illegible).
//      The container is then centered one rank BELOW the premise block, and the
//      conclusion one rank below the container. This is direct geometry (no dagre
//      out here): the strict premises→container→conclusion vertical order the
//      edge bundler relies on is preserved, while `premiseColumns` lets the shell
//      trade the premise block's WIDTH for HEIGHT to match the viewport so
//      fit-to-view scales the cards as large as possible. When expanded the
//      container carries the interior bounding box's size so the ranks separate
//      enough to clear the frame.
//   2. INNER pass (expanded only): dagre over just the interior sub-DAG in its
//      OWN coordinate space → its `graph().width/height` is the interior box.
//      Interior nodes are then offset into the container's absolute position.
//      This pass is UNCHANGED by the grid work.
//
// Inner-first (bottom-up) so the container is sized to the interior before the
// outer placement reserves vertical room below the premise block. We keep the
// container an ordinary node in the inner pass (vs dagre `compound:true`/
// `setParent` clustering, which is experimental and throws on edges touching a
// cluster node, dagre#238 — exactly our premise→container topology).

import dagre from "@dagrejs/dagre";

import { boxSize, partitionNodes, reduceEdges } from "./layout-model";
import type {
  BoxSize,
  BoxTable,
  LayoutBox,
  LayoutEdge,
  LayoutResult,
} from "./layout-model";
import type { FlowchartNode, FlowchartEdge } from "./types";
import { CONTAINER_NODE_ID } from "./types";

// ---- Layout constants (the agreed knobs the next round can re-tune) --------

/** The card's width floor — its CSS `min-width`, and the box width the layout
 *  falls back to for a card the box table has no measurement for. */
export const NODE_WIDTH = 190;

// ---- Card height terms -----------------------------------------------------
// nodes.module.css hard-codes these same px; change one, change both. A PAGE card
// is content-sized, so these sum to its FLOOR (`min-height`) — the exact box only
// on the surfaces that declare fixed boxes: the OG presets and the phase-1 seed.

/** Top accent rail (.card::before). */
const CARD_RAIL_HEIGHT = 3;
/** Header row (kind label + stance chip) — fixed so font metrics can't grow it. */
const CARD_HEADER_HEIGHT = 30;
/** Proposition lines the floor reserves room for. */
const CARD_FLOOR_LINES = 1;
/** Proposition line box height (px). CSS sets `line-height` to this exact px. */
const CARD_LINE_HEIGHT = 18;
/** Vertical padding (top+bottom, px) around the proposition body. */
const CARD_BODY_PAD_Y = 12;
/** Proposition body floor = 1 line box + its vertical padding. */
const CARD_BODY_HEIGHT = CARD_FLOOR_LINES * CARD_LINE_HEIGHT + CARD_BODY_PAD_Y;
/** Footer row (Holding badges / "settled") — fixed height incl. its padding. */
const CARD_FOOTER_HEIGHT = 35;

/** The card height the layout boxes with when the box table has no entry. */
export const NODE_HEIGHT =
  CARD_RAIL_HEIGHT + CARD_HEADER_HEIGHT + CARD_BODY_HEIGHT + CARD_FOOTER_HEIGHT;

/** Padding inside the collapsible proof-group container (around interior). */
export const GROUP_PADDING = 24;
/** Extra top room inside the container for its header/toggle row. */
export const GROUP_HEADER_HEIGHT = 36;
/** Collapsed container pill height (compact, content-independent) — matches the
 *  rendered pill (nodes.module.css .groupCollapsed) EXACTLY so the conduit
 *  attaches flush to its top and bottom borders. */
export const CONTAINER_COLLAPSED_HEIGHT = 48;

/** Rank/node separations. Heights are now EXACT (no estimate error to absorb),
 *  so these are purely the desired visual breathing room between ranks/cards. */
const RANKSEP = 90;
const NODESEP = 48;

/**
 * Post-relaxation y-freedom a band-tallest card holds from its band centre.
 * The force solver's knob (re-exported as `WOBBLE` from layout-force.ts, which
 * is where it is spent), stated HERE because the premise row pitch has to
 * reserve BOTH adjacent rows' freedom on top of {@link BAND_CLEARANCE}.
 */
export const WOBBLE = 16;

/**
 * Minimum REALISED vertical gap (px) between any two cards in adjacent rank
 * bands — the room a premise strand needs to read as an edge flowing off a card
 * rather than as two cards touching. Structural, not advisory: the row pitch
 * below is derived from it, so the disjoint band intervals the solver clamps
 * into are separated by exactly this much however the cards wobble inside them.
 *
 * 32px, eyeballed on the live theorem page. Before the clearance the intervals
 * were free to ABUT, and the realised worst case there measured 8px — two rows
 * reading as one block with the strands pinched out of sight. 24 and 28 both
 * clear the contact but the strand's descent still reads clipped between the
 * tightest pair at the zoom the page fits to; at 32 it reads as a run. The
 * ceiling is fit-to-view, and there is none to pay for here: the theorem page's
 * fit is width-bound (identical scale at 24 and at 32), and even at the
 * 20-premise extreme this is 24px of extra premise-block height.
 */
export const BAND_CLEARANCE = 32;

/** Horizontal gap between premise grid cells (matches dagre's NODESEP feel). */
const PREMISE_COL_GAP = NODESEP;
/**
 * Vertical gap between premise grid rows. Exported because the phase-1 seed cell
 * is a box PLUS this gap, and the CSS clamp is stated per cell.
 *
 * DERIVED, not chosen: the solver reads its rank bands off this grid as
 * intervals reaching {@link WOBBLE} past each row's extent, so the pitch has to
 * carry both rows' freedom before it can guarantee {@link BAND_CLEARANCE}
 * between the cards that land in them.
 */
export const PREMISE_ROW_GAP = BAND_CLEARANCE + 2 * WOBBLE;
/**
 * Vertical gap below the premise block before the container rank. Measured from
 * the block's own bottom, and the solver re-bases the container onto the
 * REALISED premise bottom, so the wobble is already spent when this gap is laid
 * — it survives to the render whole, and RANKSEP clears {@link BAND_CLEARANCE}
 * with room to spare.
 */
const PREMISE_TO_CONTAINER_GAP = RANKSEP;
/** Vertical gap below the container before the conclusion rank. Neither rank
 *  wobbles, so this too reaches the render whole (and clears
 *  {@link BAND_CLEARANCE}). */
const CONTAINER_TO_CONCLUSION_GAP = RANKSEP;

/**
 * Canonical default premise-grid column count for the initial/server render —
 * the OG-image canonical count. The client re-derives a viewport-responsive
 * count after mount (see the shell), but server HTML and any non-responsive
 * caller get this stable default.
 */
export const DEFAULT_PREMISE_COLUMNS = 6;


// ---- The layout function ---------------------------------------------------

/** The card box every node gets when the caller supplies no measured size. */
const DEFAULT_BOX: BoxSize = { width: NODE_WIDTH, height: NODE_HEIGHT };

export interface LayoutInput {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  /**
   * Active page view (author/empty). Threaded for parity with the renderer's
   * prop, but it does not affect LAYOUT: a card's box comes from {@link boxes}
   * (or the fixed default), never from which token tree it shows.
   */
  view: "author" | "empty";
  /** Fold state: collapsed groups the interior into the container node. */
  collapsed: boolean;
  /**
   * Number of columns the premise nodes are arranged into (a centered grid block
   * ABOVE the container). The premise band's aspect ratio is the lever the shell
   * tunes to keep fit-to-view legible: more columns ⇒ shorter/wider block, fewer
   * ⇒ taller/narrower. Canonical/server default is {@link DEFAULT_PREMISE_COLUMNS};
   * the client overrides it from the live viewport aspect ratio. Clamped to
   * `[1, nPremises]` internally, so any positive integer is safe to pass.
   */
  premiseColumns?: number;
  /**
   * Per-node card sizes. Omitted (or missing an id) ⇒ that card is the fixed
   * {@link NODE_WIDTH} × {@link NODE_HEIGHT} box, which is exactly the geometry
   * the uniform-card layout has always produced. The page fills this from
   * measured DOM boxes; the OG route from its fixed presets.
   */
  boxes?: BoxTable;
}

/**
 * Lay out the graph with dagre. Pure: same input ⇒ same output. Returns absolute
 * center-based boxes for every visible node (plus the synthetic container) and
 * dagre-routed edge polylines. See the module header for the two-level model.
 */
export function layoutTheorem(input: LayoutInput): LayoutResult {
  const { nodes, edges, collapsed } = input;
  const premiseColumns = input.premiseColumns ?? DEFAULT_PREMISE_COLUMNS;
  const sizeOf = (id: string): BoxSize => boxSize(input.boxes, id, DEFAULT_BOX);

  const { premises, conclusions, interior, interiorIds, conclusionIds } =
    partitionNodes(nodes);
  // A proof-group container ALWAYS exists (design fix #4): premises route through
  // it to the conclusion even when the proof interior is EMPTY (no bridge /
  // intermediate steps). `hasInterior` tracks whether there's anything to expand
  // INTO — only then is the fold toggle / interior pass meaningful.
  const hasInterior = interior.length > 0;
  const hasContainer = true;

  // ---- INNER pass (expanded only): lay out the interior sub-DAG -------------
  // Done first (bottom-up) so the container can be sized to it before we reserve
  // vertical room below the premise block. Produces a local-coordinate box per
  // child, the interior bounding box, and the inner edge waypoints (also local).
  // An EMPTY interior is never "expanded" — there's nothing to lay out — so the
  // container stays the collapsed pill size.
  const expanded = collapsed === false && hasInterior;
  const inner = expanded
    ? layoutInterior(interior, edges, interiorIds, sizeOf)
    : null;

  // ---- OUTER layout: premise GRID → CONTAINER → conclusion ------------------
  // Premises are no longer one wide dagre rank (which blew out to ~6000px at 20
  // premises and made fit-to-view illegible). Instead they tile into a centered
  // grid of `premiseColumns` columns ABOVE the container; the container is then
  // centered below the block and the conclusion below the container. This keeps
  // the strict premises→container→conclusion vertical order the bundler relies on
  // while letting the shell trade the block's width for height to suit the
  // viewport. The interior sub-DAG (inner pass) is untouched.
  const boxes: Record<string, LayoutBox> = {};
  const layoutEdges: LayoutEdge[] = [];

  // Expanded, the container's box is the interior it frames. COLLAPSED, it is a
  // CONTENT-SIZED pill as wide as the theorem name it shows, so its width comes
  // off the same box table the cards' do: the reserved box is then the RENDERED
  // pill, which is what keeps the conduit flush to its borders. Unmeasured it
  // falls back to NODE_WIDTH like any other card the table has no entry for. The
  // pill's HEIGHT is a constant on both sides of the contract (the CSS pins it),
  // so it is never read from the table.
  const containerWidth =
    inner !== null ? inner.width : sizeOf(CONTAINER_NODE_ID).width;
  const containerHeight =
    inner !== null ? inner.height : CONTAINER_COLLAPSED_HEIGHT;

  const grid = layoutPremiseGrid(premises, premiseColumns, sizeOf);

  // Center everything on a shared vertical centre line. The premise block, the
  // container, and the conclusion all centre on x = 0; the whole layout is in an
  // arbitrary absolute space (the shell fits-to-view), so the origin is free.
  const centerX = 0;
  for (const cell of grid.cells) {
    boxes[cell.id] = {
      x: centerX + cell.cx,
      y: cell.cy,
      width: cell.width,
      height: cell.height,
    };
  }

  let containerBox: LayoutBox | null = null;
  if (hasContainer) {
    const cy = grid.height + PREMISE_TO_CONTAINER_GAP + containerHeight / 2;
    containerBox = {
      x: centerX,
      y: cy,
      width: containerWidth,
      height: containerHeight,
    };
    boxes[CONTAINER_NODE_ID] = containerBox;
  }

  // The conclusion(s) sit one rank below the container (or below the premise
  // block when there is no interior at all). Multiple conclusions tile in a row.
  const conclusionTopY =
    containerBox !== null
      ? containerBox.y + containerBox.height / 2 + CONTAINER_TO_CONCLUSION_GAP
      : grid.height + PREMISE_TO_CONTAINER_GAP;
  layoutConclusions(conclusions, centerX, conclusionTopY, boxes, sizeOf);

  // ---- OUTER edges: premise→container, container→conclusion (or premise→…) --
  // Straight centre-to-centre polylines. The bundler reshapes premise→container
  // into per-premise strands + a trunk from the boxes, and routes the trunk-out
  // from the container bottom — so two-point straight lines are all it needs. The
  // interior edges come from the inner pass below, unchanged.
  const outerEdges = reduceEdges(edges, interiorIds, conclusionIds);
  for (const e of outerEdges) {
    const s = boxes[e.source];
    const t = boxes[e.target];
    if (s === undefined || t === undefined) continue;
    layoutEdges.push({
      source: e.source,
      target: e.target,
      points: [
        { x: s.x, y: s.y + s.height / 2 },
        { x: t.x, y: t.y - t.height / 2 },
      ],
    });
  }

  if (inner === null) {
    // Collapsed (or no interior): the grid placement is the whole layout.
    return { boxes, edges: layoutEdges, containerChildren: [], hasContainer };
  }

  // ---- RECONCILE: place the interior inside the (now positioned) container --
  // The container box we placed is center-based and sized to the interior box.
  // Its top-left in absolute coords is the origin of the interior's local space,
  // shifted down past the header band. Offset every inner child + inner edge by
  // that origin so children share the container's absolute coordinate space (the
  // shell re-bases them to parent-relative against the same container box).
  // (inner !== null ⇒ hasContainer ⇒ containerBox was set above.)
  const reconcileBox = containerBox ?? boxes[CONTAINER_NODE_ID];
  const originX = reconcileBox.x - reconcileBox.width / 2;
  const originY = reconcileBox.y - reconcileBox.height / 2;
  const shift = (p: { x: number; y: number }) => ({
    x: p.x + originX,
    y: p.y + originY,
  });

  for (const [id, box] of Object.entries(inner.boxes)) {
    boxes[id] = { ...box, x: box.x + originX, y: box.y + originY };
  }
  for (const e of inner.edges) {
    layoutEdges.push({
      source: e.source,
      target: e.target,
      points: e.points.map(shift),
    });
  }

  return {
    boxes,
    edges: layoutEdges,
    containerChildren: interior.map((n) => n.id),
    hasContainer,
  };
}

// ---- Inner-pass layout -----------------------------------------------------

interface InteriorLayout {
  /** Local-coordinate (interior origin), center-based box per interior node. */
  boxes: Record<string, LayoutBox>;
  /** Inner edge waypoints in the same local coordinate space. */
  edges: LayoutEdge[];
  /** Container size = interior bounding box + padding (+ header band on top). */
  width: number;
  height: number;
}

/**
 * Lay out just the interior sub-DAG in its own coordinate space. dagre lays the
 * interior out from its own origin; we then shift everything DOWN by the header
 * band and right/down by the padding so the interior sits inside the container
 * frame. The returned `width`/`height` is what the outer pass uses for the
 * container node so it reserves matching space.
 */
function layoutInterior(
  interior: FlowchartNode[],
  edges: FlowchartEdge[],
  interiorIds: Set<string>,
  sizeOf: (id: string) => BoxSize,
): InteriorLayout {
  const g = newGraph();
  for (const n of interior) {
    // Interior step cards are the SAME proposition card as premises/conclusions,
    // so dagre boxes them at the card's exact rendered size — which is why the
    // plain interior edges hit the real card borders (bug #3).
    const size = sizeOf(n.id);
    g.setNode(n.id, { width: size.width, height: size.height });
  }
  const innerEdges: FlowchartEdge[] = [];
  for (const e of edges) {
    if (interiorIds.has(e.source) && interiorIds.has(e.target)) {
      g.setEdge(e.source, e.target);
      innerEdges.push(e);
    }
  }
  dagre.layout(g);

  // dagre lays the interior out starting at its own (0,0)-ish origin with its
  // graph margins. Translate it so (0,0) of OUR local space is the container's
  // outer top-left: interior shifts right by GROUP_PADDING and down by the
  // header band + GROUP_PADDING. The container size is the interior extent plus
  // padding on all sides and the header band on top.
  const raw = g.graph();
  const rawW = raw.width ?? NODE_WIDTH;
  const rawH = raw.height ?? CONTAINER_COLLAPSED_HEIGHT;
  const offsetX = GROUP_PADDING;
  const offsetY = GROUP_HEADER_HEIGHT + GROUP_PADDING;

  const boxes: Record<string, LayoutBox> = {};
  for (const n of interior) {
    const box = nodeBox(g, n.id);
    boxes[n.id] = { ...box, x: box.x + offsetX, y: box.y + offsetY };
  }

  // dagre OWNS the node positions (its ranking). It also returns a routed
  // polyline per edge, but we DON'T use it: dagre clips that polyline to each
  // box border at the edge's approach ANGLE, so a node with several in/out edges
  // gets them fanned off-centre across its border (and a long diagonal lands on
  // the card's SIDE, below the top), plus dog-leg mid-waypoints through its dummy
  // ranks — the "wonky interior edges". The boxes here are the MEASURED ones, so
  // they are exact, and we emit a CLEAN 2-point run per edge from the real face centres
  // (source bottom-centre → target top-centre), exactly like the outer pass does
  // for premise→container / container→conclusion. The edge renderer eases a
  // vertical-tangent curve between them (waypoint-edge.tsx plainPath); the
  // bundler re-derives the same endpoints from the boxes, so the two agree.
  const innerLayoutEdges: LayoutEdge[] = innerEdges.map((e) => {
    const s = boxes[e.source];
    const t = boxes[e.target];
    return {
      source: e.source,
      target: e.target,
      points: [
        { x: s.x, y: s.y + s.height / 2 },
        { x: t.x, y: t.y - t.height / 2 },
      ],
    };
  });

  return {
    boxes,
    edges: innerLayoutEdges,
    width: rawW + GROUP_PADDING * 2,
    height: rawH + GROUP_HEADER_HEIGHT + GROUP_PADDING * 2,
  };
}

// ---- Premise grid + conclusion placement -----------------------------------

interface GridCell {
  id: string;
  /** Cell-centre offset from the block's horizontal centre (centerX is added). */
  cx: number;
  /** Cell-centre absolute y (the block starts at y = 0, grows downward). */
  cy: number;
  width: number;
  height: number;
}

interface PremiseGrid {
  cells: GridCell[];
  /** Total block height (0 when there are no premises). */
  height: number;
}

/**
 * Tile the premises into a centered grid of `columns` columns, rows top-to-bottom,
 * with consistent gaps. A column is as wide as its widest card and a row as tall
 * as its tallest, which collapses to a uniform {@link NODE_WIDTH} × {@link NODE_HEIGHT}
 * lattice when no measured boxes are supplied. The block is horizontally centred
 * on x = 0 and its top is y = 0; callers add their own `centerX`. `columns` is
 * clamped to `[1, nPremises]`.
 */
function layoutPremiseGrid(
  premises: FlowchartNode[],
  columns: number,
  sizeOf: (id: string) => BoxSize,
): PremiseGrid {
  const n = premises.length;
  if (n === 0) return { cells: [], height: 0 };

  const cols = Math.max(1, Math.min(Math.round(columns), n));
  const rows = Math.ceil(n / cols);

  const sizes = premises.map((p) => sizeOf(p.id));
  const colWidths = new Array<number>(cols).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colWidths[c] = Math.max(colWidths[c], sizes[i].width);
    rowHeights[r] = Math.max(rowHeights[r], sizes[i].height);
  }

  // Column centre x-offsets for a `cols`-wide, centred block.
  const blockWidth =
    colWidths.reduce((a, w) => a + w, 0) + (cols - 1) * PREMISE_COL_GAP;
  const colCenterX: number[] = [];
  let x = -blockWidth / 2;
  for (let c = 0; c < cols; c++) {
    colCenterX.push(x + colWidths[c] / 2);
    x += colWidths[c] + PREMISE_COL_GAP;
  }
  const rowCenterY: number[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    rowCenterY.push(y + rowHeights[r] / 2);
    y += rowHeights[r] + PREMISE_ROW_GAP;
  }

  const cells: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= n) break;
      cells.push({
        id: premises[idx].id,
        cx: colCenterX[c],
        cy: rowCenterY[r],
        width: sizes[idx].width,
        height: sizes[idx].height,
      });
    }
  }

  return { cells, height: y - PREMISE_ROW_GAP };
}

/**
 * Place the conclusion node(s) centred in a single row, with their TOP at
 * `topY`. Writes absolute center-based boxes into `boxes`. Almost always one
 * conclusion, but tile defensively in case a theorem ever has several sinks.
 */
function layoutConclusions(
  conclusions: FlowchartNode[],
  centerX: number,
  topY: number,
  boxes: Record<string, LayoutBox>,
  sizeOf: (id: string) => BoxSize,
): void {
  const n = conclusions.length;
  if (n === 0) return;
  const sizes = conclusions.map((c) => sizeOf(c.id));
  const rowWidth =
    sizes.reduce((a, s) => a + s.width, 0) + (n - 1) * PREMISE_COL_GAP;
  let x = centerX - rowWidth / 2;
  for (let i = 0; i < n; i++) {
    const size = sizes[i];
    boxes[conclusions[i].id] = {
      x: x + size.width / 2,
      y: topY + size.height / 2,
      width: size.width,
      height: size.height,
    };
    x += size.width + PREMISE_COL_GAP;
  }
}

// ---- Internals -------------------------------------------------------------

function newGraph(): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  g.setGraph({ rankdir: "TB", ranksep: RANKSEP, nodesep: NODESEP, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  return g;
}

/** dagre stores node center + size; expose that center box (LayoutBox). */
function nodeBox(g: dagre.graphlib.Graph, id: string): LayoutBox {
  const n = g.node(id);
  return { x: n.x, y: n.y, width: n.width, height: n.height };
}
