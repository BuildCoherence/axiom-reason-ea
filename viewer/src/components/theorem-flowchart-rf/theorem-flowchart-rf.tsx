"use client";

import * as React from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  MarkerType,
  useReactFlow,
  useStore,
  type Node,
  type Edge,
  type ReactFlowState,
} from "@xyflow/react";
import { Map as MapIcon } from "lucide-react";
import "@xyflow/react/dist/style.css";

import styles from "./flowchart-rf.module.css";

import type {
  RfFlowchartNode,
  FlowchartEdge,
  ViewChoice,
  ViewerStance,
  PopoverTarget,
  TokenTree,
} from "./types";
import { CONTAINER_NODE_ID, isInteriorKind } from "./types";
// Re-exported so the component's public surface (and the page that imports it)
// is unchanged after the pure transform moved to its own unit-testable module.
export { disambiguateDuplicateNodes } from "./disambiguate-duplicate-nodes";
import type { SourceToken } from "@/components/lean-ui/types";
import { byteLen } from "@/components/lean-ui/byte-len";
import { DEFAULT_PREMISE_COLUMNS } from "./layout";
import { outerLayout } from "./layout-force";
import {
  fitMinZoom,
  fitScaleColumns,
  fitScaleOf,
  measureRung,
  MEASURE_RUNGS,
  MIN_ZOOM_FLOOR,
  prepareGraph,
  readingOrder,
} from "./layout-model";
import type { BoxTable, LayoutBox, LayoutResult } from "./layout-model";
import {
  boxesFor,
  boxesFromLookup,
  commitBoxes,
  committable,
  echoMeasured,
  phase1Boxes,
  sameBoxes,
  NO_BOXES,
  PHASE1_ROW_PITCH,
  type LayoutPhase,
} from "./measure-phase";
import { usesSourceBytes } from "./nodes/uses-source-bytes";
import { nodeTypes } from "./nodes/node-types";
import { edgeTypes } from "./edges/edge-types";
import type { PropositionCardData } from "./nodes/proposition-card";
import type { InteriorStepData } from "./nodes/interior-step-node";
import type { ProofGroupData } from "./nodes/proof-group-node";
import type { EdgeFlowState, WaypointEdgeData } from "./edges/waypoint-edge";
import { bundleEdges } from "./edges/bundling";
import { strandStateFromStance, trunkState } from "./edges/flow-state";

// The React Flow shell — design contract § 1, 6, 7.
//
// PROP-DRIVEN: `{ nodes, edges, viewerStance, view }`. No fetching, no URL state,
// no router — mirrors the existing TheoremFlowchart's shape so the page can swap
// renderers. React Flow is ONLY the pan/zoom/fit shell; `outerLayout`
// (layout-force.ts) is the layout authority and we feed RF its precomputed
// positions. The premise grid is now the SEED and the fallback; dagre still owns
// the proof interior.
//
// FOLD: the proof fold is local view state, default COLLAPSED (design § 3). The
// toggle flips it → we re-solve → call fitView (design § 6: fit-to-view is
// authoritative). Empty interior ⇒ no container at all.
//
// TWO-PHASE SIZING (`data-layout`): cards are sized by the DOM, not estimated.
// `seeding` paints the seed grid with each card clamped to one phase-1 cell;
// once every node is measured, the fonts have loaded and every source-bytes card
// has hydrated, the shell flips to `measuring` (clamp off, observer re-reports)
// and commits the box table; a duration-matched timer then flips `settled`.

export interface TheoremFlowchartRfProps {
  nodes: RfFlowchartNode[];
  edges: FlowchartEdge[];
  /** Active page-level view (author/empty), as the live component takes. */
  view: ViewChoice;
  /**
   * The theorem's whole home-file verbatim source. Threaded to the
   * premise/conclusion cards so the AUTHOR view renders each aligned node's
   * proposition from VERBATIM source bytes (via `ShikiSlice`), preserving the
   * authored surface syntax. Optional — absent ⇒ every card uses the delab
   * token-tree path. (PROTOTYPE.)
   */
  fileContent?: string;
  /**
   * The theorem decl's UNsliced `source_tokens` — handed down to each card's
   * `ShikiSlice` (which slices + rebases them onto the node's span). Paired with
   * {@link fileContent}. (PROTOTYPE.)
   */
  sourceTokens?: SourceToken[];
  // --- PRODUCTION CONTRACT — these four MATCH the live `TheoremFlowchart` 1:1 so
  // this component is a drop-in replacement (the page passes the same props). ---
  /** Identifier click inside a proposition → host opens the Lean side panel. */
  onIdentifierClick?: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  /** Premise/conclusion header click → host opens the proposition panel. */
  onSelectProp?: (proposition_id: string) => void;
  /** Identifier hover/focus → host opens the standard identifier popover. */
  onIdentifierHover?: (target: PopoverTarget) => void;
  /** Identifier leave/blur → host schedules the popover close. */
  onIdentifierLeave?: () => void;
  /**
   * A Holding bar was activated → host opens the provenance drill-in anchored to
   * `element`. Same shape as the live component's `onBadgeActivate`.
   */
  onBadgeActivate?: (args: {
    side: "pro" | "con";
    proposition_id: string;
    count: number;
    element: HTMLElement;
  }) => void;
  /**
   * Viewer-relative stance per node id (design § 5) — ships in v1 for
   * AUTHENTICATED viewers (built from the API's per-node `viewer_stance`).
   * Present ⇒ edges + top bars personalize (held green-flow, rejected severed
   * strands). ABSENT (anonymous request) ⇒ the neutral canonical render: no
   * green-flow, no severed strands.
   */
  viewerStance?: ViewerStance;
  /**
   * Premise-grid column count. `"auto"` (default) makes the shell derive a
   * viewport-responsive count after mount and on resize; a number pins a fixed
   * count (used for canonical/server-style renders and the preview overrides).
   * The canonical fixed default is {@link DEFAULT_PREMISE_COLUMNS}.
   */
  premiseColumns?: number | "auto";
  /**
   * Human-facing theorem name (snake_case) shown as the proof-fold container
   * header (design change #3). Falls back to the step-count label when absent.
   */
  theoremName?: string;
  /**
   * The theorem's own def id (design fix #5). When set, the proof-group's theorem
   * NAME becomes a clickable identifier: clicking it calls {@link onIdentifierClick}
   * with this id, opening the Lean side panel for the theorem itself. Absent ⇒
   * the name stays plain, non-interactive text.
   */
  theoremDefId?: string;
  /**
   * The theorem's fully-qualified name (design fix #5) — passed as the
   * `qualified_name` of the {@link onIdentifierClick} target when the name is
   * clicked. Falls back to {@link theoremName} (then "") when absent.
   */
  theoremQualifiedName?: string;
  /**
   * The theorem's adopter count — the number of users who adopt the whole
   * argument — shown as a `⊢ N` turnstile chip ON the proof-fold (theorem)
   * node (the redesign moves it off the page header). Present only for a
   * premise-bearing theorem; absent (premise-free / pre-backfill) ⇒ no chip.
   */
  adopterCount?: number;
  /**
   * The adopter chip on the theorem node was activated → host opens the
   * adopters drill-in anchored to `element`. Paired with {@link adopterCount}.
   */
  onAdoptersActivate?: (element: HTMLElement) => void;
  /**
   * Minimum zoom to enforce after the initial fit (e.g. the feed preview passes
   * ~0.7). When fit-to-view would shrink a multi-node graph below this, we zoom
   * IN to this floor instead so node text is legible on first paint — the graph
   * stays pannable to see the rest. Absent (the theorem page) ⇒ plain fit-to-view.
   */
  minFitZoom?: number;
  /**
   * Padding used by the production fit-to-view path. The theorem page keeps the
   * roomy default; showcase surfaces can tighten it so the graph fills its slot.
   */
  fitViewPadding?: number;
  /**
   * Embedded-in-a-scroll-feed interaction (the explore feed preview). When set,
   * a PLAIN wheel / one-finger touch-scroll passes through to the surrounding
   * scroller (so the feed scrolls instead of the graph zooming/panning), while
   * zoom is KEPT but gated: ⌘/Ctrl + wheel zooms (a native non-passive handler),
   * and two-finger pinch zooms on touch (the pane gets `touch-action: pan-y`, so
   * one-finger vertical scrolls the feed and pinch still reaches React Flow).
   * The +/- controls also zoom. Absent (the theorem page) ⇒ full pan/zoom, wheel
   * zooms directly.
   */
  embeddedScroll?: boolean;
  /**
   * Interactivity switch. `true` (default) is the production theorem-page and
   * feed-preview behavior. `false` is showcase mode for the landing hero: fit
   * the graph, but disable pan/zoom, controls, focusable nodes, and scroll
   * capture so the diagram reads as a static document.
   */
  interactive?: boolean;
  /**
   * Fade only the React Flow background grid at the edges. Used by the landing
   * hero so the dot field dissolves into the page while nodes stay crisp.
   */
  fadeBackground?: boolean;
}

/** Resize-observer debounce (ms): a solve on ≤35 nodes is sub-millisecond, so this is cheap. */
const RESIZE_DEBOUNCE_MS = 150;

/**
 * Floor (ms) on the settle timer: the measurement must be QUIET, not merely
 * committed. Two resizes land on a card just after `measuring` begins — the
 * seeding clamp releasing, and React Flow dropping the seed dimensions at first
 * measure — and the observer reports each a frame later. Every report re-arms
 * this window, so the settle lands after the last one. Without the floor an
 * environment that suppresses the transition (reduced motion, the @visual runs'
 * blanket `transition: none`) settles on the CLAMPED, SEED-SIZED reading — the
 * very reading `measuring` exists to replace.
 */
const MEASURE_QUIESCE_MS = 120;

/**
 * Fractional fit-scale improvement a candidate column count must beat the held
 * one by. Without it a drag that keeps crossing a tie re-lays the graph on every
 * frame; with it the count is hysteretic across a resize session (a COLD load is
 * still a pure function of the viewport, which is what the e2e pins).
 */
const COLUMN_DEADBAND = 0.1;

/** The layout stores box centers; React Flow positions by top-left. */
function topLeft(box: LayoutBox): { x: number; y: number } {
  return { x: box.x - box.width / 2, y: box.y - box.height / 2 };
}

/** id → position, so a comparator can rank by a precomputed order. */
function rankOf(ids: string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, index]));
}

/**
 * The rung a card measures at before the wrapper has been observed — the
 * narrowest, so a first paint can only ever be narrower than what follows.
 */
const SEED_RUNG = MEASURE_RUNGS[MEASURE_RUNGS.length - 1].rung;

/**
 * The phase-1 grid cell, published to the card CSS. `--card-measure` is the
 * active Measure Rung, i.e. the widest a card may measure; `--phase1-cell-h` is
 * the cell height the `seeding` clamp holds cards to.
 */
function phaseCellVars(rung: number): React.CSSProperties {
  return {
    "--card-measure": `${rung}px`,
    "--phase1-cell-h": `${PHASE1_ROW_PITCH}px`,
  } as React.CSSProperties;
}

/** Stable empty set so the pre-hydration render never re-arms the gate. */
const EMPTY_SLICE_SET: ReadonlySet<string> = new Set<string>();

/** Measured card boxes, plus whether React Flow has sized every node it holds. */
interface Measurement {
  boxes: BoxTable;
  complete: boolean;
}

// `s.nodeLookup` is the ONLY record of measured dimensions here: the flow is
// controlled with no `onNodesChange`, so measurements never reach the user nodes
// (which is also why `useNodesInitialized()` can never flip). Every measurement
// runs `set({})`, so this selector re-evaluates; the equality below keeps a
// re-measure that changed nothing from re-rendering the shell.
function selectMeasurement(s: ReactFlowState): Measurement {
  const boxes = boxesFromLookup(s.nodeLookup);
  return {
    boxes,
    complete:
      s.nodeLookup.size > 0 && Object.keys(boxes).length === s.nodeLookup.size,
  };
}

function sameMeasurement(a: Measurement, b: Measurement): boolean {
  return a.complete === b.complete && sameBoxes(a.boxes, b.boxes);
}

/**
 * The settle transition's own duration (ms), read off a live node. Zero when the
 * environment suppressed it — `prefers-reduced-motion`, or the @visual runs'
 * blanket `transition: none` — so the commit flips `settled` immediately rather
 * than waiting on a transition that will never run.
 */
function settleDurationMs(wrapper: HTMLDivElement | null): number {
  const node = wrapper?.querySelector(".react-flow__node");
  if (!(node instanceof HTMLElement)) return 0;
  const raw = window.getComputedStyle(node).transitionDuration.split(",")[0];
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.trim().endsWith("ms") ? value : value * 1000;
}

// --- AT names for nodes ----------------------------------------------
// Every RF node is tab-focusable, so each must carry a meaningful `ariaLabel` —
// otherwise a focused card announces only its opaque hash id. We name each node
// "<kind>: <flattened proposition text>" so a screen-reader user hears the
// actual proposition, not the node hash.

/** Flatten a TokenTree to its surface text (same recursion the OG/metadata route
 *  uses) so a node's proposition can be spoken as plain text. */
function flattenTokenTree(tree: TokenTree): string {
  if (tree.node === "text") return tree.text;
  if (tree.node === "append")
    return tree.children.map(flattenTokenTree).join("");
  return flattenTokenTree(tree.child);
}

/** Human-facing kind word for a node's AT name. */
function kindWord(kind: string): string {
  switch (kind) {
    case "premise":
      return "Premise";
    case "conclusion":
      return "Conclusion";
    case "bridge":
      return "Bridge";
    case "restatement":
      return "Restatement";
    case "intermediate":
      return "Intermediate step";
    default:
      return "Step";
  }
}

/**
 * Accessible name for a single node: "<kind>: <proposition text>". Prefers the
 * author tree (falling back to empty), then the recovered binder `name`;
 * degrades to the bare kind word when no text is available (never an opaque
 * hash).
 */
function nodeAriaLabel(node: RfFlowchartNode): string {
  const kind = kindWord(node.kind);
  let text = "";
  if (node.tokens !== null) {
    const tree = node.tokens.author ?? node.tokens.empty;
    text = flattenTokenTree(tree).trim();
  }
  if (text === "" && typeof node.name === "string") text = node.name.trim();
  return text === "" ? kind : `${kind}: ${text}`;
}

// --- MiniMap node tinting ---------------------------------------------------
// The minimap reads as two regions (design changes #4, #5, #7):
//   premise + conclusion → the viewer's STANCE color (matching each other and the
//     card's adoption rail): held → base0B (green), rejected → base08 (red),
//     undecided / none → base04 (gray). They share one scheme — kind is read from
//     the glyph on the card, not the minimap hue.
//   proof-group container + every interior step (bridge / intermediate /
//     restatement) → base0D (the Axiom purple), one coherent "proof" purple.
// (Interior steps carry no stance, so they always paint purple.)
function kindAccentVar(kind: string): string {
  switch (kind) {
    case "premise":
    case "conclusion":
      // No resolved stance → neutral gray (matches the card's undecided rail).
      return "var(--base04)";
    case "bridge":
    case "restatement":
    case "intermediate":
      return "var(--base0D)";
    default:
      return "var(--base04)";
  }
}

/**
 * MiniMap `nodeColor`: resolve a node back to its kind (and, for premises +
 * conclusion, the viewer stance) and return the matching base16 CSS var. Premise
 * + conclusion fold in stance (held → green, rejected → red, else gray via
 * kindAccentVar); interior steps + the synthetic container node (not in
 * `nodeById`) are the proof purple (--base0D). Returns a `var(--baseNN)` string,
 * so the swatch tracks data-mode + palette swap.
 */
function makeMiniMapNodeColor(
  nodeById: Map<string, RfFlowchartNode>,
  viewerStance: ViewerStance | undefined,
): (node: Node) => string {
  return (node) => {
    if (node.id === CONTAINER_NODE_ID) return "var(--base0D)";
    const src = nodeById.get(node.id);
    if (src === undefined) return "var(--base04)";
    if (src.kind === "premise" || src.kind === "conclusion") {
      const stance = viewerStance?.[src.id];
      if (stance === "held") return "var(--base0B)";
      if (stance === "rejected") return "var(--base08)";
    }
    return kindAccentVar(src.kind);
  };
}

function InnerFlowchart({
  nodes: rawNodes,
  edges: rawEdges,
  viewerStance: rawViewerStance,
  view,
  fileContent,
  sourceTokens,
  premiseColumns = "auto",
  theoremName,
  theoremDefId,
  theoremQualifiedName,
  adopterCount,
  onAdoptersActivate,
  onIdentifierClick,
  onSelectProp,
  onIdentifierHover,
  onIdentifierLeave,
  onBadgeActivate,
  minFitZoom,
  fitViewPadding = 0.15,
  embeddedScroll = false,
  interactive = true,
  fadeBackground = false,
}: TheoremFlowchartRfProps) {
  const [collapsed, setCollapsed] = React.useState(true);
  // MiniMap is opt-in (design: off by default) — a toggle in the controls reveals
  // it. Keeping it off keeps the canvas uncluttered for the common single-screen
  // theorem.
  const [showMiniMap, setShowMiniMap] = React.useState(false);
  // Embedded mode only: a transient "Ctrl/⌘ + scroll to zoom" hint that flashes
  // when the user plain-scrolls over the graph (the Google-Maps affordance), so
  // the gated zoom gesture is discoverable at the moment of confusion.
  const [showZoomHint, setShowZoomHint] = React.useState(false);
  const zoomHintTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Touch-capable detection. `any-pointer: coarse` catches phones, tablets, AND
  // 2-in-1s with a touchscreen even when a mouse is also attached. On a touch
  // device the embedded graph is GESTURE-SHIELDED: React Flow's pan/zoom filter
  // is all-or-nothing on touch — with `panOnDrag` off it rejects EVERY
  // touchstart (so two-finger pinch is dead too), and with it on a one-finger
  // swipe pans instead of scrolling the feed (xyflow #5341). The fix is the
  // Google-Maps / Mapbox "cooperative" pattern: one finger scrolls the feed
  // until a deliberate TAP activates pan/zoom. Client-only (SSR default false
  // so first paint is stable). The graph carries no clickable identifiers in the
  // feed, so the shield swallows nothing of value.
  const [touchCapable, setTouchCapable] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(any-pointer: coarse)");
    const apply = () => setTouchCapable(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  // Whether the touch graph is currently activated for pan/zoom. Only meaningful
  // while shielded; each card is its own component instance, so it resets per
  // card. The shield is live ONLY for the embedded touch preview.
  const [graphActive, setGraphActive] = React.useState(false);
  const gestureShielded = interactive && embeddedScroll && touchCapable;
  const { fitView, getZoom, zoomTo } = useReactFlow();
  const measurement = useStore(selectMeasurement, sameMeasurement);
  const [phase, setPhase] = React.useState<LayoutPhase>("seeding");
  const [committed, setCommitted] = React.useState(NO_BOXES);

  const viewKind = view.kind === "author" ? "author" : "empty";

  const onToggle = React.useCallback(() => setCollapsed((c) => !c), []);

  // The single graph-prep entry: resolve duplicate-hash node-id collisions (e.g. a
  // `P → P` peeled premise that shares the conclusion's hash) and partition the
  // nodes by role, before anything downstream keys off node ids.
  const prepared = React.useMemo(
    () => prepareGraph(rawNodes, rawEdges, rawViewerStance),
    [rawNodes, rawEdges, rawViewerStance],
  );
  const { nodes, edges, stance: viewerStance } = prepared;
  const premiseCount = prepared.premises.length;

  // The live column count actually fed to the layout. When `premiseColumns` is a
  // number it's pinned to it; in "auto" it starts at the canonical default (so
  // server HTML and first paint are stable / deterministic) and is replaced after
  // mount + on resize by the viewport-responsive count.
  const [autoColumns, setAutoColumns] = React.useState<number>(
    DEFAULT_PREMISE_COLUMNS,
  );
  const activeColumns =
    premiseColumns === "auto" ? autoColumns : premiseColumns;

  // The flow viewport element — measured to derive the responsive column count.
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  // The Measure Rung the wrapper's width selects — the card CSS's max-width and
  // a box-table key. Null until the first observation.
  const [rung, setRung] = React.useState<number | null>(null);
  const activeRung = rung ?? SEED_RUNG;

  // The wrapper's own box — the viewport `fitView` fits into. Null until observed.
  const [viewport, setViewport] = React.useState<{
    width: number;
    height: number;
  } | null>(null);

  // The box table's content identity. A column change WITHIN a rung re-lays the
  // same cards, so it reuses the committed table rather than re-measuring.
  const nodeIdsKey = React.useMemo(
    () => nodes.map((n) => n.id).join("\0"),
    [nodes],
  );
  const contentKey = `${activeRung}|${viewKind}|${collapsed ? "collapsed" : "expanded"}|${nodeIdsKey}`;
  // Empty until this identity's commit lands.
  const measuredBoxes = boxesFor(committed, contentKey);

  // Until it does, the cards are laid out on the PHASE-1 SEED GRID: a rung-wide
  // cell (the widest a card may measure) three fixed cards tall, so an unmeasured
  // card cannot overlap its neighbours in the frames before the solver has real
  // boxes. The `seeding` clamp holds the cell in the other direction.
  const seedBoxes = React.useMemo(
    () =>
      phase1Boxes(
        nodes.map((n) => n.id),
        activeRung,
      ),
    [nodes, activeRung],
  );
  const layoutBoxes =
    Object.keys(measuredBoxes).length > 0 ? measuredBoxes : seedBoxes;

  // Solve the outer placement for the current fold state, column count and box
  // table. Pure + memoized; `mode` is the path it took, which the settle
  // telemetry reports.
  const solved = React.useMemo(
    () =>
      outerLayout({
        nodes,
        edges,
        collapsed,
        premiseColumns: activeColumns,
        boxes: layoutBoxes,
      }),
    [nodes, edges, collapsed, activeColumns, layoutBoxes],
  );
  const layout: LayoutResult = solved.result;

  // React Flow clamps `fitView`'s target against `minZoom`, so a graph whose fit
  // lands below the ordinary floor needs the floor lowered to that fit —
  // otherwise the fit silently zooms back IN and crops. Keyed on the layout, and
  // React Flow's own store updater is a child effect, so the store carries this
  // before the fit effect below runs.
  const minZoom =
    viewport === null
      ? MIN_ZOOM_FLOOR
      : fitMinZoom(
          layout.boxes,
          viewport.width,
          viewport.height,
          fitViewPadding,
        );

  // --- Wrapper observation: Measure Rung + responsive columns ----------------
  // A ResizeObserver on the wrapper, NOT a window `resize` listener: docking the
  // side panel and dragging the TheoremSplit both change this element's width
  // and fire no window resize. Columns are only re-derived in "auto" mode; the
  // layout is pure, so the fit probe can dry-run it per candidate count.
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (el === null) return;

    // The deadband damps a live DRAG, so it starts disarmed: a fresh layout
    // problem (new boxes, fold state or node set re-runs this effect) picks the
    // outright best count, which is what makes a cold load a pure function of
    // the viewport rather than of the arbitrary starting count.
    let dragging = false;

    const recompute = () => {
      const rect = el.getBoundingClientRect();
      const nextRung = measureRung(rect.width);
      setRung((prev) => (prev === nextRung ? prev : nextRung));
      setViewport((prev) =>
        prev !== null &&
        prev.width === rect.width &&
        prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
      if (premiseColumns !== "auto") return;
      // The probe runs the FULL solver per candidate — at most eight
      // sub-millisecond runs (`MIN_COLUMNS`…`min(MAX_COLUMNS, premiseCount)`).
      // The seed grid's fit is not the relaxed layout's fit, and it is the
      // relaxed one the visitor sees.
      const solveFor = (cols: number) =>
        outerLayout({
          nodes,
          edges,
          collapsed,
          premiseColumns: cols,
          boxes: layoutBoxes,
        }).result;
      const { columns, fitScale } = fitScaleColumns(
        solveFor,
        premiseCount,
        rect.width,
        rect.height,
      );
      setAutoColumns((prev) => {
        if (prev === columns || !dragging) return columns;
        const held = fitScaleOf(solveFor(prev).boxes, rect.width, rect.height);
        return fitScale > held * (1 + COLUMN_DEADBAND) ? columns : prev;
      });
    };

    recompute();
    dragging = true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(recompute, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [premiseColumns, nodes, edges, collapsed, premiseCount, layoutBoxes]);

  const nodeById = React.useMemo(() => {
    const m = new Map<string, RfFlowchartNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const stepCount = prepared.interior.length;

  // --- Two-phase sizing: gate, commit, settle --------------------------------
  const fileContentByteLen = React.useMemo(
    () => (fileContent != null ? byteLen(fileContent) : 0),
    [fileContent],
  );
  // The settle counter's DENOMINATOR: cards that actually mount a `ShikiSlice`.
  // Interior steps are derived and the Syntax view renders none, so counting
  // every card would deadlock the gate.
  const sliceCardCount = React.useMemo(
    () =>
      nodes.filter(
        (n) =>
          !isInteriorKind(n.kind) &&
          usesSourceBytes({
            node: n,
            view: viewKind,
            fileContent,
            sourceTokens,
            fileContentByteLen,
          }),
      ).length,
    [nodes, viewKind, fileContent, sourceTokens, fileContentByteLen],
  );
  // Settled slice ids rather than a counter: `onSettled` fires once per terminal
  // state per card, and a set makes a repeat report idempotent.
  const [settledSlices, setSettledSlices] =
    React.useState<ReadonlySet<string>>(EMPTY_SLICE_SET);
  const onSliceSettled = React.useCallback((id: string) => {
    setSettledSlices((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const [fontsReady, setFontsReady] = React.useState(false);
  React.useEffect(() => {
    if (document.fonts === undefined) {
      setFontsReady(true);
      return;
    }
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) setFontsReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  // Re-entry. A rung change invalidates the seed grid itself, so it drops all
  // the way back to `seeding`; a view / fold / slice-hydration change keeps the
  // seed and only re-measures.
  React.useEffect(() => {
    setPhase("seeding");
  }, [rung]);
  React.useEffect(() => {
    setPhase((prev) => (prev === "settled" ? "measuring" : prev));
  }, [viewKind, collapsed, nodeIdsKey, settledSlices]);

  // Leaving `seeding` needs all three: every node measured (a degenerate box is
  // reported as unmeasured, so it holds us here and re-arms), the fonts loaded,
  // and every source-bytes card past its raw-text → hast swap.
  const measurementComplete = measurement.complete;
  const slicesSettled = settledSlices.size >= sliceCardCount;
  React.useEffect(() => {
    if (!measurementComplete || !fontsReady || !slicesSettled) return;
    setPhase((prev) => (prev === "seeding" ? "measuring" : prev));
  }, [measurementComplete, fontsReady, slicesSettled]);

  // Commit: in `measuring` the clamp is off, so the observer's report converges
  // on the true card size. The write is deep-compared, and the settle flip rides
  // a timer matched to the transition's own duration but floored at the
  // measurement quiesce — a bare `transitionend` never fires when nothing moved,
  // so the event is an early-out only. Every fresh report re-runs this effect,
  // clearing the pending timer, so `settled` means "measured, laid out, and
  // still".
  React.useEffect(() => {
    if (phase !== "measuring") return;
    if (!committable(measurement.boxes)) return;
    setCommitted((prev) => commitBoxes(prev, contentKey, measurement.boxes));

    const el = wrapperRef.current;
    const settle = () => setPhase("settled");
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform") settle();
    };
    const timer = setTimeout(
      settle,
      Math.max(settleDurationMs(el), MEASURE_QUIESCE_MS),
    );
    el?.addEventListener("transitionend", onTransitionEnd);
    return () => {
      clearTimeout(timer);
      el?.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [phase, measurement.boxes, contentKey]);

  // --- Build React Flow nodes from the layout result -------------------------
  const rfNodes: Node[] = React.useMemo(() => {
    const out: Node[] = [];
    const containerBox = layout.boxes[CONTAINER_NODE_ID];
    const interiorSet = new Set(layout.containerChildren);

    // The proof-group container node (collapsed pill OR expanded parent region).
    if (layout.hasContainer && containerBox !== undefined) {
      const pos = topLeft(containerBox);
      const data: ProofGroupData = {
        collapsed,
        stepCount,
        theoremName,
        theoremDefId,
        theoremQualifiedName,
        adopterCount,
        onAdoptersActivate,
        width: containerBox.width,
        height: containerBox.height,
        onToggle,
        onIdentifierClick,
      };
      out.push({
        id: CONTAINER_NODE_ID,
        type: "proofGroup",
        position: pos,
        // AT name: the proof-fold container announces "<theorem> proof —
        // N steps" rather than its synthetic hash id.
        ariaLabel: `${theoremName ?? "Proof"} — ${stepCount} ${stepCount === 1 ? "step" : "steps"}`,
        // EXPANDED, the container's box is a layout OUTPUT, not a measurement,
        // so it seeds the wrapper rather than pinning it: `initialWidth`/
        // `initialHeight` satisfy `nodeHasDimensions` (so the MiniMap renders
        // this node immediately) and React Flow drops them at first measure.
        // COLLAPSED, the pill is CONTENT-SIZED, so it carries no dimensions at
        // all — exactly like a card, and for the same reason: React Flow
        // re-applies a seeded dimension on any rebuild that drops `measured`,
        // and the wrapper would then report the RESERVED box instead of the
        // pill, which is what squished the theorem name to an ellipsis. The
        // price is the card's price — hidden until first measure, inside
        // `seeding`, which nothing captures.
        ...(collapsed
          ? {}
          : {
              initialWidth: containerBox.width,
              initialHeight: containerBox.height,
            }),
        data: data as unknown as Record<string, unknown>,
        draggable: false,
        // NOT selectable:false — React Flow sets pointer-events:none on a node
        // that is BOTH non-draggable and non-selectable, which would make the
        // "Show steps"/"Hide steps" toggle inert (the pane intercepts the click).
        // Keeping it selectable preserves pointer-events on the toggle button;
        // the button's `nodrag` class still prevents pan-on-drag.
        selectable: true,
        // Expanded container is the parent; give it a real size so children clip.
        style: collapsed
          ? undefined
          : { width: containerBox.width, height: containerBox.height },
      });
    }

    for (const n of nodes) {
      const box = layout.boxes[n.id];
      if (box === undefined) continue; // interior nodes are absent when collapsed
      const interior = isInteriorKind(n.kind);

      if (interior) {
        // Only expanded interior nodes get a box; nest them under the container
        // by re-basing their absolute position to be container-relative.
        if (!interiorSet.has(n.id) || containerBox === undefined) continue;
        const abs = topLeft(box);
        const parentPos = topLeft(containerBox);
        const data: InteriorStepData = {
          node: n,
          view: viewKind,
          sourceTokens,
          onIdentifierClick,
          onIdentifierHover,
          onIdentifierLeave,
          onBadgeActivate,
        };
        out.push({
          id: n.id,
          type: "interiorStep",
          // AT name: "<kind>: <proposition>" so a focused interior step
          // announces its proposition, not its hash id.
          ariaLabel: nodeAriaLabel(n),
          parentId: CONTAINER_NODE_ID,
          extent: "parent",
          position: { x: abs.x - parentPos.x, y: abs.y - parentPos.y },
          // NO dimensions of any kind — see the proposition card below.
          data: data as unknown as Record<string, unknown>,
          draggable: false,
        });
        continue;
      }

      const role: "premise" | "conclusion" =
        n.kind === "conclusion" ? "conclusion" : "premise";
      const data: PropositionCardData = {
        node: n,
        view: viewKind,
        stance: viewerStance?.[n.id],
        role,
        fileContent,
        sourceTokens,
        onIdentifierClick,
        onSelectProp,
        onIdentifierHover,
        onIdentifierLeave,
        onBadgeActivate,
        onSliceSettled,
      };
      out.push({
        id: n.id,
        type: role,
        // AT name: "<kind>: <proposition>" so a focused premise/conclusion
        // card announces its proposition, not its hash id.
        ariaLabel: nodeAriaLabel(n),
        position: topLeft(box),
        // A CARD CARRIES NO DIMENSIONS AT ALL. Explicit `width`/`height` pin the
        // React Flow wrapper forever, leaving nothing to measure — and now that
        // the card sizes to its content, `initialWidth`/`initialHeight` are just
        // as wrong: React Flow re-applies them whenever a node object is rebuilt
        // without `measured` (it resets handle bounds), so the wrapper snaps back
        // to the seed box and the observer reports the SEED size. The card's true
        // size follows, the next rebuild reports the seed again, and the pair
        // never converges — the shell hangs before `settled`. With no dimensions
        // the wrapper always shrink-wraps the card, so every report is the card,
        // and a rebuild costs one identical re-report instead of a cycle. The
        // price is that a card is `visibility: hidden` until its first measure —
        // one frame, inside `seeding`, which nothing captures.
        data: data as unknown as Record<string, unknown>,
        draggable: false,
      });
    }
    // TAB ORDER FOLLOWS READING ORDER (WCAG 2.4.3). Every card is focusable and
    // React Flow focuses them in ARRAY order, which is the wire's order, not the
    // canvas's — so rank the outer nodes by (band, centre-x, id) off the SOLVED
    // boxes. An interior step ranks at its container's place, just behind it:
    // React Flow requires a parent to precede its children, and the fold reads
    // as one block.
    const outerRank = rankOf(
      readingOrder(
        out.filter((n) => n.parentId === undefined).map((n) => n.id),
        layout.boxes,
      ),
    );
    const interiorRank = rankOf(
      readingOrder(layout.containerChildren, layout.boxes),
    );
    const containerRank = outerRank.get(CONTAINER_NODE_ID) ?? 0;
    const rank = (n: Node) =>
      n.parentId === undefined ? (outerRank.get(n.id) ?? 0) : containerRank;
    out.sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.parentId === undefined) return -1;
      if (b.parentId === undefined) return 1;
      return (interiorRank.get(a.id) ?? 0) - (interiorRank.get(b.id) ?? 0);
    });

    // Echo the LAST OBSERVED dimensions onto EVERY emitted node. A node object
    // rebuilt without `measured` makes React Flow reset its handle bounds, which
    // re-applies the seed `initialWidth`/`initialHeight` — so the next report is
    // the SEED size, not the card's, and with content-sized cards that never
    // converges. The COMMITTED table would leave the pre-commit window (where
    // every first measurement happens) unprotected, so the echo reads what React
    // Flow itself last reported. That is inert for React Flow — it is being
    // handed back its own numbers.
    return out.map((n) => echoMeasured(n, measuredBoxes));
  }, [
    nodes,
    layout,
    collapsed,
    stepCount,
    onToggle,
    viewKind,
    viewerStance,
    fileContent,
    sourceTokens,
    theoremName,
    theoremDefId,
    theoremQualifiedName,
    adopterCount,
    onAdoptersActivate,
    onIdentifierClick,
    onSelectProp,
    onIdentifierHover,
    onIdentifierLeave,
    onBadgeActivate,
    onSliceSettled,
    measuredBoxes,
  ]);

  // --- Build React Flow edges: bundle, then resolve the five-state flow -------
  // 1. BUNDLE: re-shape dagre's premise→container fan-in into individual strands
  //    that merge at a shared bundle point, plus a single trunk into/out of the
  //    proof (the conduit). Interior edges pass through unchanged. Pure geometry
  //    derived from the layout boxes — the layout itself is untouched.
  // 2. FLOW STATE: each strand inherits its premise's stance (held→flowing,
  //    undecided→dormant, rejected→severed). The trunk's state is GRAPH-LEVEL
  //    (flows iff ALL premises held — vacuously so at zero premises — else
  //    blocked at the bundle) — computed once here and stamped on every trunk
  //    segment, since it can't be derived edge-locally. Plain edges stay neutral.
  const rfEdges: Edge[] = React.useMemo(() => {
    const bundled = bundleEdges({
      boxes: layout.boxes,
      edges: layout.edges,
      hasContainer: layout.hasContainer,
    });

    // Premises feeding the proof = the strands' sources. Drives the trunk's
    // all-held check, so the trunk reflects exactly the premises shown merging.
    const feedingPremises = bundled.edges
      .filter((e) => e.role === "strand" && e.premiseId !== undefined)
      .map((e) => e.premiseId as string);
    const resolvedTrunk = trunkState(
      viewerStance,
      feedingPremises,
      premiseCount,
    );

    return bundled.edges.map((e) => {
      let state: EdgeFlowState;
      if (e.role === "strand" && e.premiseId !== undefined) {
        state = strandStateFromStance(viewerStance, e.premiseId);
      } else if (e.role === "trunk") {
        state = resolvedTrunk;
      } else {
        // Plain interior edge (no container case, or interior↔interior). When
        // there's no proof fold, a premise→target edge still colours by stance.
        const src = nodeById.get(e.source);
        state =
          src !== undefined && src.kind === "premise"
            ? strandStateFromStance(viewerStance, e.source)
            : "neutral";
      }

      const data: WaypointEdgeData = { points: e.points, role: e.role, state };
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "waypoint",
        data: data as unknown as Record<string, unknown>,
        // No arrowhead on strands (they end at the merge, not a node); the
        // trunk/plain edges carry the arrow into their target.
        markerEnd:
          e.role === "strand"
            ? undefined
            : { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      };
    });
  }, [
    layout.boxes,
    layout.edges,
    layout.hasContainer,
    nodeById,
    viewerStance,
    premiseCount,
  ]);

  // MiniMap node tint — stable per (nodes, stance). Tints each blob by its kind's
  // base16 accent (premises fold in viewer stance), so the minimap is a kind map.
  const miniMapNodeColor = React.useMemo(
    () => makeMiniMapNodeColor(nodeById, viewerStance),
    [nodeById, viewerStance],
  );

  // --- Fit-to-view is authoritative (design § 6): on mount + every relayout ---
  // Gate the fit on the SETTLED phase, so it is computed from committed card
  // sizes rather than racing measurement — `useNodesInitialized()` can never
  // flip in a controlled flow with no `onNodesChange`, so it cannot serve here.
  // Depend on `layout`, not `rfNodes`: viewer-relative stance changes rebuild
  // node data without changing geometry and must not repeatedly ease the
  // viewport while edge flow updates.
  React.useEffect(() => {
    if (phase !== "settled") return;
    if (minFitZoom !== undefined) {
      // Preview mode (e.g. the feed): fit instantly, then enforce a legible
      // zoom floor so node text is readable on first paint — when fit-to-view
      // would shrink below the floor we zoom IN to it (the graph stays
      // pannable to reach the rest).
      void fitView({ padding: 0.08, duration: 0 });
      if (getZoom() < minFitZoom) void zoomTo(minFitZoom, { duration: 0 });
    } else {
      // The ease is enhancement: under reduced motion the fit jumps straight to
      // its final viewport.
      const reducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false;
      void fitView({
        padding: fitViewPadding,
        duration: reducedMotion ? 0 : 200,
      });
    }
  }, [phase, fitView, getZoom, zoomTo, layout, minFitZoom, fitViewPadding]);

  // Embedded (feed) wheel zoom: keep scroll-to-zoom but gate it behind ⌘/Ctrl so
  // a PLAIN wheel bubbles to the surrounding scroller (the feed scrolls). A
  // NATIVE non-passive listener is required — React's synthetic onWheel can be
  // passive, so preventDefault (to stop the browser's own ⌘/Ctrl page-zoom)
  // wouldn't fire. No-op unless embeddedScroll in an interactive graph.
  React.useEffect(() => {
    if (!interactive || !embeddedScroll) return;
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        // Plain wheel → let the feed scroll, and flash the "how to zoom" hint.
        setShowZoomHint(true);
        if (zoomHintTimer.current) clearTimeout(zoomHintTimer.current);
        zoomHintTimer.current = setTimeout(() => setShowZoomHint(false), 1400);
        return;
      }
      e.preventDefault();
      setShowZoomHint(false);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.min(2, Math.max(minZoom, getZoom() * factor));
      void zoomTo(next, { duration: 0 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (zoomHintTimer.current) clearTimeout(zoomHintTimer.current);
    };
  }, [interactive, embeddedScroll, getZoom, zoomTo, minZoom]);

  // Touch shield release: once the graph is activated for touch pan/zoom, return
  // it to feed-scroll mode when the user scrolls the feed OR taps/clicks outside
  // the graph — the "click out to release" embedded maps use. capture:true so a
  // scroll on the inner feed scroller (scroll doesn't bubble) still reaches us;
  // passive so we never block it. Attached only while active.
  React.useEffect(() => {
    if (!gestureShielded || !graphActive) return;
    const release = () => setGraphActive(false);
    const onOutside = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && wrapperRef.current?.contains(target))
        return;
      release();
    };
    window.addEventListener("scroll", release, {
      capture: true,
      passive: true,
    });
    document.addEventListener("pointerdown", onOutside, true);
    return () => {
      window.removeEventListener("scroll", release, true);
      document.removeEventListener("pointerdown", onOutside, true);
    };
  }, [gestureShielded, graphActive]);

  return (
    <div
      ref={wrapperRef}
      className={`${styles.shell} ${embeddedScroll ? styles.embeddedScroll : ""} ${
        fadeBackground ? styles.fadeBackground : ""
      }`}
      data-layout={phase}
      style={phaseCellVars(activeRung)}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: fitViewPadding }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        // React Flow's root carries role="application"; an UNNAMED
        // application role is an AT trap. Name the region after the theorem so a
        // screen-reader user knows what they entered.
        aria-label={`${theoremName ?? "Theorem"} premise flowchart`}
        // Edges expose only opaque "Edge from <hash> to <hash>" names, so
        // suppress edge focusability — the relations are conveyed by the named
        // nodes and the visual flow, not by tabbing through edges.
        edgesFocusable={false}
        // Pan/zoom only — the shell's whole job (design § 1). The floor is
        // DERIVED: a tall graph's own fit is lower than 0.2 (see `minZoom`).
        minZoom={minZoom}
        maxZoom={2}
        // Embedded in the scroll feed: a plain wheel must NOT zoom (it scrolls
        // the feed), and React Flow must not swallow the scroll. zoom is kept via
        // the ⌘/Ctrl-wheel handler above, pinch (zoomOnPinch, default on), and the
        // +/- controls. On the theorem page (embeddedScroll false) the wheel
        // zooms directly, as before.
        zoomOnScroll={interactive && !embeddedScroll}
        panOnScroll={false}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={interactive}
        preventScrolling={interactive && !embeddedScroll}
        nodesFocusable={interactive}
        elementsSelectable={interactive}
        // Touch gesture shield: while shielded-and-inactive, panOnDrag is OFF so
        // a one-finger swipe scrolls the feed (and React Flow's filter, being
        // all-or-nothing on touch, leaves zoom inert too); a deliberate TAP on
        // the shield overlay sets graphActive, flipping panOnDrag ON so the user
        // gets full one-finger pan + pinch-zoom. Desktop (no touch) and the
        // theorem page are never shielded, so mouse drag-to-pan is unchanged.
        panOnDrag={interactive && (!gestureShielded || graphActive)}
      >
        <Background gap={20} color="var(--base02)" />
        {/* Controls (design change #2): a compact single-column stack — React
         * Flow's default zoom-in / zoom-out / fit-view (the interactivity lock is
         * dropped: the diagram is a non-draggable document) plus a fourth button
         * that toggles the MiniMap (off by default). Pan arrows were dropped —
         * drag-to-pan + the minimap cover navigation. Theming lives in .controls*
         * in flowchart-rf.module.css. */}
        {interactive ? (
          <Controls showInteractive={false} className={styles.controls}>
            <ControlButton
              onClick={() => setShowMiniMap((v) => !v)}
              title={showMiniMap ? "Hide minimap" : "Show minimap"}
              aria-label={showMiniMap ? "Hide minimap" : "Show minimap"}
              aria-pressed={showMiniMap}
              className={showMiniMap ? styles.controlActive : undefined}
            >
              <MapIcon size={14} strokeWidth={2.5} />
            </ControlButton>
          </Controls>
        ) : null}
        {/* Kind-tinted minimap (see makeMiniMapNodeColor): each blob carries its
         * card's base16 accent — premises fold in viewer stance. OFF by default;
         * revealed by the controls toggle. Background/mask themed via the CSS
         * module; node fill/stroke via these props. */}
        {showMiniMap ? (
          <MiniMap
            nodeColor={miniMapNodeColor}
            nodeStrokeColor={miniMapNodeColor}
            nodeStrokeWidth={2}
            pannable
            zoomable
            ariaLabel="Theorem flowchart minimap"
          />
        ) : null}
      </ReactFlow>
      {/* Desktop zoom affordance: flashes when the user plain-scrolls over the
          graph (which scrolls the feed), teaching the ⌘/Ctrl-scroll zoom. Inert
          (pointer-events: none). Touch gets the tap-to-activate shield instead
          (below), so this only ever surfaces for a wheel — i.e. on desktop. */}
      {interactive && embeddedScroll ? (
        <div
          className={`${styles.zoomHint} ${showZoomHint ? styles.zoomHintVisible : ""}`}
          aria-hidden="true"
        >
          Hold Ctrl / ⌘ and scroll to zoom
        </div>
      ) : null}

      {/* Touch gesture shield. Transparent overlay over the embedded graph while
          inactive: `touch-action: pan-y` lets a one-finger vertical swipe scroll
          the feed, while a TAP activates pan/zoom (flips panOnDrag on) and
          removes the overlay. A subtle pill advertises the gesture. Released by
          the scroll / outside-tap effect above. Touch devices only. */}
      {gestureShielded && !graphActive ? (
        <button
          type="button"
          className={styles.tapShield}
          onClick={() => setGraphActive(true)}
          aria-label="Activate graph to pan and zoom"
        >
          <span className={styles.tapShieldLabel} aria-hidden="true">
            Tap to pan &amp; zoom
          </span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * Theorem flowchart, React Flow + dagre prototype. Prop-driven and
 * fetch/URL-unaware, mirroring the live `TheoremFlowchart` contract so the page
 * can swap renderers. Wrap in the provider so `useReactFlow` (fitView) works.
 */
export function TheoremFlowchartRf(props: TheoremFlowchartRfProps) {
  return (
    <ReactFlowProvider>
      <InnerFlowchart {...props} />
    </ReactFlowProvider>
  );
}
