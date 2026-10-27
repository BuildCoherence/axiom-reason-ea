"use client";

// The /graph page shell. `labels.json` is fetched once by the canvas shell and
// shared from here with the search overlay and the panel — one fetch, three
// consumers. Selections write `?prop=` / `?def=` with `replaceState`, never
// `pushState`: panel state is not page history.

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDefaultLayout } from "react-resizable-panels";

import {
  EMPTY_STACK,
  applyBack,
  applyForward,
  applyReplaceCurrent,
  applySelect,
  type Selection,
  type StackState,
} from "@/components/lean-ui/selection-stack";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { safeLayoutStorage } from "@/components/ui/resizable-storage";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { GraphNodeKind } from "@/lib/graph-kind-legend";
import { cn } from "@/lib/utils";

import {
  GRAPH_POSTER_MIN_VISIBLE_MS,
  graphPosterOnScreen,
  graphPosterState,
} from "./graph-arrival";
import type {
  GraphLabelsOutcome,
  GraphLabelsUnavailableReason,
} from "./graph-artifacts";
import {
  GraphCanvas,
  type GraphDegradedReport,
  type GraphNodeSelection,
} from "./graph-canvas";
import type { GraphDegradedReason } from "./graph-degraded";
import { GraphDegradedNotice } from "./graph-degraded-notice";
import { GraphControlsHint, GraphSearchOverlay } from "./graph-hud";
import {
  graphConnectedRows,
  graphEgoWalk,
  graphIndexById,
  graphSelectionForId,
  graphSelectionForNode,
  graphSelectionUrl,
  readGraphSelection,
  type GraphPanelSelection,
} from "./graph-panel-model";
import type { GraphCanvasRung } from "./graph-webgl";
import type { DecodedGraphGeometry, DecodedGraphLabels } from "./graph-wire";
import stageStyles from "./graph-stage.module.css";

// On its own chunk: the panel is not reachable until a node is chosen, and
// `ssr: false` costs nothing because its data is a client fetch anyway.
const GraphPanel = dynamic(
  () => import("./graph-panel").then((m) => m.GraphPanel),
  { ssr: false },
);

// ---- The desktop workspace split ------------------------------------------
//
// The stage and the docked panel are the two panes of one horizontal
// `react-resizable-panels` group, exactly as the Theorem Page splits its info
// panel from its flowchart canvas — so the panel is drag-adjustable and the
// stage narrows to make room, rather than being covered by an overlay.
//
// The persisted width is keyed on `GRAPH_SPLIT_ID`. Listing BOTH panel ids in
// `panelIds` is what keeps the storage key stable while the pane is shut: the
// hook reads `<id>:stage:panel` always, but writes under the ids that are
// actually mounted, so a closed-panel layout lands on `<id>:stage` and cannot
// overwrite the width the visitor chose.
const GRAPH_SPLIT_ID = "graph-panel-width";
const GRAPH_STAGE_PANEL_ID = "stage";
const GRAPH_SIDE_PANEL_ID = "panel";

// Width policy. The rem bounds are content-derived; the lib normalizes the
// mixed units against the group's pixel width.
//   - SIDE_DEFAULT = 24rem (384px) — the width the pane has always opened at
//     (`max-w-sm` on the old overlay), kept so nothing about the resting page
//     moves and no pixel baseline is disturbed by the split landing.
//   - SIDE_MIN = 20rem (320px) — the same content-derived floor `LeanUIShell`
//     documents for these exact panel bodies (a one-line Lean signature at the
//     panel's `.codeSurface` size plus its padding). One floor for one body.
//   - SIDE_MAX = 44rem (704px) — room to widen a long statement out, and still
//     under half of a 1440px stage.
//   - STAGE_MIN = 20rem (320px) — the canvas is the page's subject; a drag must
//     not be able to squeeze it to a sliver. Satisfiable at every viewport the
//     docked pane can appear at: the pane is desktop-only (>= 768px), so the
//     tightest case is 20rem + 20rem + the 1px handle against 768px.
const GRAPH_SIDE_DEFAULT_WIDTH = "24rem";
const GRAPH_SIDE_MIN_WIDTH = "20rem";
const GRAPH_SIDE_MAX_WIDTH = "44rem";
const GRAPH_STAGE_MIN_WIDTH = "20rem";

/** A stored layout is only honoured whole: a degenerate 0/100 pair would push
 *  the pane onto its `minSize` clamp on every open, quietly discarding a width
 *  the visitor actually set. */
function validGraphSplitLayout(
  layout: Record<string, number> | undefined,
): layout is Record<string, number> {
  return [GRAPH_STAGE_PANEL_ID, GRAPH_SIDE_PANEL_ID].every((id) => {
    const size = layout?.[id];
    return (
      typeof size === "number" &&
      Number.isFinite(size) &&
      size > 0 &&
      size < 100
    );
  });
}

/** The one fact the search overlay cannot compute for itself. */
export type GraphExplorerSearchProps = {
  /** `band_counts.length`. Never a literal 5: the band count is a build parameter. */
  bandCount: number;
};

export type GraphExplorerProps = {
  geometryUrl: string;
  labelsUrl: string;
  /** Graph Manifest `counts.nodes` — the labels join-key length. */
  nodeCount: number;
  ariaLabel: string;
  /** The server-rendered poster, passed as a node so it stays a Server Component. */
  poster: ReactNode;
  search: GraphExplorerSearchProps;
  /** Graph Manifest `band_cut_points` — the arrival's stagger order. */
  bandCutPoints: readonly number[];
  /** `kind` per id for the manifest's ranked `top_nodes`: a deep link resolves
   *  BEFORE the idle `labels.json` fetch lands, and covers exactly that window. */
  nodeKinds: Readonly<Record<string, GraphNodeKind>>;
};

/** The in-memory stack's entry shape, shared with the shipped panels' drill-down stack. */
function toStackEntry(selection: GraphPanelSelection): Selection {
  return selection.kind === "def"
    ? { kind: "def", id: selection.id }
    : { kind: "prop", id: selection.id };
}

function fromStackEntry(entry: Selection): GraphPanelSelection {
  return { kind: entry.kind, id: entry.id };
}

export function GraphExplorer({
  geometryUrl,
  labelsUrl,
  nodeCount,
  ariaLabel,
  poster,
  search,
  bandCutPoints,
  nodeKinds,
}: GraphExplorerProps) {
  const [labels, setLabels] = useState<DecodedGraphLabels | null>(null);
  const [searchUnavailableReason, setSearchUnavailableReason] =
    useState<GraphLabelsUnavailableReason | null>(null);
  // Held for the canvas emphasis channels below, which need the wire columns.
  const [geometry, setGeometry] = useState<DecodedGraphGeometry | null>(null);
  /** The indices the overlay matched, handed down so one search drives both the
   *  dropdown and the canvas. `null` while the box is empty — the island treats
   *  that and "a query matching nothing" as different states. */
  const [searchMatchIndices, setSearchMatchIndices] =
    useState<ReadonlySet<number> | null>(null);
  /** Whether this selection moves the camera. State rather than a literal, so a
   *  rung that must not fly stays expressible. */
  const [flyToSelection, setFlyToSelection] = useState(false);
  /** The URL named a selection on arrival. Read after hydration: the page is
   *  prerendered, so the first render cannot know the query. */
  const [deepLink, setDeepLink] = useState(false);

  /** Has the canvas drawn at least one frame? */
  const [canvasLive, setCanvasLive] = useState(false);
  /** Latched: the answer must not flip back to false when the poster fades out. */
  const posterWasShownRef = useRef(false);
  /** Latched with it: React's pin, not the CSS reveal, put the poster on screen. */
  const posterWasPinnedRef = useRef(false);
  /** Pushes the latch down as a prop and starts the hold; the reveal itself is CSS. */
  const [posterLatch, setPosterLatch] = useState(0);
  /** The poster layer, so the reveal can be observed rather than re-predicted. */
  const posterLayerRef = useRef<HTMLDivElement | null>(null);
  /** False until the revealed poster has served `GRAPH_POSTER_MIN_VISIBLE_MS`. */
  const [posterHoldElapsed, setPosterHoldElapsed] = useState(false);
  const handleFirstFrame = useCallback(() => setCanvasLive(true), []);

  const [selection, setSelection] = useState<GraphPanelSelection | null>(null);
  const [stack, setStack] = useState<StackState>(EMPTY_STACK);
  // Bumped on EVERY select, deduped or not: re-selecting the open node is a real
  // gesture on mobile, and the drawer's open-at-peek effect keys on this.
  const [openNonce, setOpenNonce] = useState(0);
  // Read synchronously rather than through a setState updater: React may invoke
  // updaters during render, and a `replaceState` from inside one updates the
  // router mid-render.
  const stackRef = useRef(stack);
  stackRef.current = stack;

  /** Write the selection to the address bar. */
  const writeUrl = useCallback((next: GraphPanelSelection | null) => {
    if (typeof window === "undefined") return;
    const url = graphSelectionUrl(window.location.search, next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const select = useCallback(
    (next: GraphPanelSelection) => {
      const advanced = applySelect(stackRef.current, toStackEntry(next));
      if (advanced !== null) {
        stackRef.current = advanced;
        setStack(advanced);
      }
      setSelection(next);
      setOpenNonce((n) => n + 1);
      setFlyToSelection(true);
      writeUrl(next);
    },
    [writeUrl],
  );

  const indexById = useMemo(() => graphIndexById(labels), [labels]);

  /** Select by id alone. An id whose axis neither `labels.kinds` nor the
   *  server-rendered kinds know is NOT selected: guessing opens the wrong panel
   *  against the wrong endpoint. */
  const selectId = useCallback(
    (id: string) => {
      const next = graphSelectionForId(id, labels, indexById, nodeKinds);
      if (next !== null) select(next);
    },
    [labels, indexById, nodeKinds, select],
  );

  const clear = useCallback(
    (options: { writeUrl: boolean }) => {
      setSelection(null);
      stackRef.current = EMPTY_STACK;
      setStack(EMPTY_STACK);
      if (options.writeUrl) writeUrl(null);
    },
    [writeUrl],
  );

  /** Close and the drawer's drag-dismiss both take `?prop=` out of the URL with
   *  the panel, or a reload re-opens what was just dismissed. */
  const closePanel = useCallback(() => clear({ writeUrl: true }), [clear]);

  /** A tap on the canvas. A MISS clears the selection; its URL was already
   *  written by the canvas, so this path must not write it a second time. */
  const handleCanvasSelect = useCallback(
    (node: GraphNodeSelection | null) => {
      if (node === null) {
        clear({ writeUrl: false });
        return;
      }
      select(graphSelectionForNode(node.kind, node.id));
    },
    [clear, select],
  );

  const back = useCallback(() => {
    const next = applyBack(stackRef.current);
    if (next === null) return;
    stackRef.current = next;
    setStack(next);
    const target = fromStackEntry(next.stack[next.cursor]);
    setSelection(target);
    setOpenNonce((n) => n + 1);
    writeUrl(target);
  }, [writeUrl]);

  const forward = useCallback(() => {
    const next = applyForward(stackRef.current);
    if (next === null) return;
    stackRef.current = next;
    setStack(next);
    const target = fromStackEntry(next.stack[next.cursor]);
    setSelection(target);
    setOpenNonce((n) => n + 1);
    writeUrl(target);
  }, [writeUrl]);

  /** A merged proposition re-selects the canonical node. `applyReplaceCurrent`,
   *  not `applySelect`: resolving an id is not a drill-down step to walk Back into. */
  const handleCanonicalId = useCallback(
    (id: string) => {
      const next: GraphPanelSelection = { kind: "prop", id };
      const replaced = applyReplaceCurrent(
        stackRef.current,
        toStackEntry(next),
      );
      if (replaced !== null) {
        stackRef.current = replaced;
        setStack(replaced);
      }
      setSelection(next);
      writeUrl(next);
    },
    [writeUrl],
  );

  // Stable identity: a new function per render must not be able to re-issue the fetch.
  const handleLabels = useCallback((outcome: GraphLabelsOutcome) => {
    if (outcome.status === "ok") {
      setLabels(outcome.labels);
      setSearchUnavailableReason(null);
      return;
    }
    // A labels failure costs SEARCH and nothing else: no rung change, and the
    // canvas below is untouched.
    setLabels(null);
    setSearchUnavailableReason(outcome.reason);
  }, []);

  // A single slot, last-writer-wins: the reasons are not additive, and a queue
  // of notices would stack over the poster.
  const [degraded, setDegraded] = useState<GraphDegradedReason | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  /** Stable identity: the canvas memoises its geometry effect on this prop. */
  const report = useCallback<GraphDegradedReport>(
    (reason) => setDegraded(reason),
    [],
  );

  /** Context loss and its automatic restore, read off the rung. */
  const handleRungChange = useCallback((rung: GraphCanvasRung) => {
    setDegraded(rung === "canvas" ? null : "context_lost");
  }, []);

  /** Clearing the notice first is deliberate: a retry that fails re-reports
   *  through `report`, so the visitor sees the notice come back. */
  const handleRetry = useCallback(() => {
    setDegraded(null);
    setRetryNonce((n) => n + 1);
  }, []);

  /** A `?prop=` / `?def=` deep link seeds the selection and the stack once. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = readGraphSelection({
      prop: params.get("prop"),
      def: params.get("def"),
    });
    if (initial === null) return;
    const seeded: StackState = { stack: [toStackEntry(initial)], cursor: 0 };
    stackRef.current = seeded;
    setStack(seeded);
    setSelection(initial);
    setFlyToSelection(true);
    setDeepLink(true);
  }, []);

  /** The poster hides ONLY while a live canvas is showing the graph; any degraded
   *  state pins it back on immediately rather than behind the delayed reveal. */
  const posterPinnedShown = degraded !== null;

  /** Did the visitor see the poster — asked of the poster, not of a clock. The
   *  CSS delay runs from the ELEMENT rendering and `performance.now()` from
   *  navigation start, so re-running the delay here latches early. `animationstart`
   *  covers the reveal; the pin is a DEPENDENCY because a pinned poster
   *  (`animation: none`) never fires it. */
  useEffect(() => {
    if (canvasLive || posterWasShownRef.current) return;
    const layer = posterLayerRef.current;
    if (!layer) return;
    const latch = () => {
      if (posterWasShownRef.current) return;
      posterWasShownRef.current = true;
      setPosterLatch((n) => n + 1);
    };
    // Already on screen, so the event is in the past or never fires. WHICH it
    // was is recorded: the hold renders differently for a pin than for a reveal.
    if (
      graphPosterOnScreen({
        pinnedShown: posterPinnedShown,
        layerOpacity: Number(window.getComputedStyle(layer).opacity),
      })
    ) {
      posterWasPinnedRef.current = posterPinnedShown;
      latch();
      return;
    }
    layer.addEventListener("animationstart", latch);
    return () => layer.removeEventListener("animationstart", latch);
  }, [canvasLive, posterPinnedShown]);

  /** The hold, in its OWN effect: the latch effect re-runs exactly when the hold
   *  matters, so a timer it owned would be cleared by its own cleanup. */
  useEffect(() => {
    if (posterLatch === 0) return;
    const timer = window.setTimeout(
      () => setPosterHoldElapsed(true),
      GRAPH_POSTER_MIN_VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [posterLatch]);

  /** The rendered attribute; the rule lives in `graph-arrival.ts` so the landing
   *  hero's mirror of it cannot drift. */
  const posterState = graphPosterState({
    pinnedShown: posterPinnedShown,
    canvasLive,
    wasShown: posterWasShownRef.current,
    wasPinned: posterWasPinnedRef.current,
    holdElapsed: posterHoldElapsed,
  });

  const selectedIndex =
    selection === null ? null : (indexById.get(selection.id) ?? null);

  // Computed here rather than in the island because they need the wire columns.
  // Each is `null` when it has nothing to say, which is what lets the island
  // treat "no filter" and "filter matching everything" as different states.

  /** The selection plus everything one edge away; null for a node the Generation
   *  does not carry. The canvas emphasises the set, the panel lists the
   *  neighbours — one walk of the edge columns answers both. */
  const ego = useMemo(
    () => graphEgoWalk(geometry, selectedIndex),
    [geometry, selectedIndex],
  );

  const connected = useMemo(
    () => graphConnectedRows(ego, labels),
    [ego, labels],
  );

  const wireEdges = useMemo(
    () => (geometry ? { src: geometry.edgeSrc, dst: geometry.edgeDst } : null),
    [geometry],
  );

  // ---- Which container the panel docks into ------------------------------
  //
  // `hasMounted` is what makes the whole restore path trivial. The docked pane
  // is never in the server markup and never in the first client render, so:
  //   - `defaultSize` may be read straight from the persisted layout — there is
  //     no SSR-vs-hydration attribute to mismatch, and none of the imperative
  //     rAF `setLayout` restoration `LeanUIShell` needs for its deep-linked,
  //     already-mounted pane. The lib reads `defaultSize` at the Panel's mount,
  //     which on this page is always the click-from-closed moment.
  //   - `useIsMobile()` has already settled by then (it publishes from a mount
  //     effect, batched with this one), so the mobile visitor never sees a
  //     desktop-width pane land on a phone — the job the old overlay's
  //     `hidden md:flex` did.
  const isMobile = useIsMobile();
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => setHasMounted(true), []);
  const dockedPanelOpen = hasMounted && !isMobile && selection !== null;

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: GRAPH_SPLIT_ID,
    panelIds: [GRAPH_STAGE_PANEL_ID, GRAPH_SIDE_PANEL_ID],
    storage: safeLayoutStorage,
  });
  const sidePanelDefaultSize = validGraphSplitLayout(defaultLayout)
    ? `${defaultLayout[GRAPH_SIDE_PANEL_ID]}%`
    : GRAPH_SIDE_DEFAULT_WIDTH;

  // ONE PANEL INSTANCE PER SELECTION: the panel's data hooks keep the previous
  // node's payload until their own effect clears it, and a render-phase guard is
  // not enough because React re-invokes render in development.
  //
  // Built once and placed in exactly ONE of the two containers below — it must
  // never move between them, or the move would remount it and re-issue its
  // fetch. `hasMounted` is what makes that reachable: the panel first renders
  // when the viewport branch is already known.
  const panelNode =
    selection === null || !hasMounted ? null : (
      <GraphPanel
        key={selection.kind + ":" + selection.id}
        selection={selection}
        openNonce={openNonce}
        isMobile={isMobile}
        history={{
          can_back: stack.cursor > 0,
          can_forward: stack.cursor < stack.stack.length - 1,
        }}
        onBack={back}
        onForward={forward}
        onClose={closePanel}
        onSelectId={selectId}
        onSelectSelection={select}
        onCanonicalId={handleCanonicalId}
        connected={connected}
      />
    );

  return (
    <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-background">
      {/* ALWAYS MOUNTED, with or without a panel beside it: a group that came
          and went with the selection would take the stage's DOM subtree with it
          and destroy the WebGL context on every open. With one pane it lays out
          exactly as the plain container it replaced. */}
      <ResizablePanelGroup
        id={GRAPH_SPLIT_ID}
        orientation="horizontal"
        onLayoutChanged={onLayoutChanged}
      >
        <ResizablePanel
          id={GRAPH_STAGE_PANEL_ID}
          minSize={GRAPH_STAGE_MIN_WIDTH}
        >
          {/* The island mounts OVER the poster and never replaces it: a no-WebGL
              browser, an island throw and a lost context all leave a real picture
              on screen with no layout change. The island sizes itself from this
              box through a `ResizeObserver`, so a drag on the handle re-fits the
              renderer and the camera the same way a window resize does. */}
          <div className="relative size-full p-4">
            {/* ALWAYS IN THE DOM, never conditionally rendered: it is markup in
                the first document, which is what lets a no-JS visitor and a
                no-WebGL browser see the graph. Only its opacity moves, so
                appearing and disappearing never costs a layout change. */}
            <div
              ref={posterLayerRef}
              data-poster={posterState}
              // Not keyed on `posterState`: a decorative picture a screen reader
              // is told about only sometimes is worse than one it never hears.
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 p-4",
                stageStyles.posterLayer,
              )}
            >
              {poster}
            </div>
            <GraphCanvas
              geometryUrl={geometryUrl}
              labelsUrl={labelsUrl}
              nodeCount={nodeCount}
              ariaLabel={ariaLabel}
              selectedId={selection?.id ?? null}
              bandCutPoints={bandCutPoints}
              // NOT the live `selection`: a deep link is a fact about how the
              // page was ENTERED.
              deepLink={deepLink}
              // Latched, so a poster that has begun fading out still counts as shown.
              posterShown={posterWasShownRef.current}
              onSelect={handleCanvasSelect}
              onLabels={handleLabels}
              onGeometry={setGeometry}
              searchMatchIndices={searchMatchIndices}
              egoIndices={ego?.indices ?? null}
              flyToSelection={flyToSelection}
              wireEdges={wireEdges}
              onDegraded={report}
              onFirstFrame={handleFirstFrame}
              onRungChange={handleRungChange}
              retryNonce={retryNonce}
            />
            {/* Each HUD layer is a flex COLUMN whose children stack in normal
                flow, so an overlap between HUD surfaces is unrepresentable rather
                than merely unlikely — `toBeVisible()` asks about layout, not
                occlusion, so a baseline cannot catch one. `pointer-events-none`
                on the LAYERS and `auto` on each card: without it the empty space
                beside a card swallows drags meant for the graph underneath. */}
            <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col gap-2 px-3">
              {/* Rendered in EVERY rung, including the ones with no canvas: the
                  labels artifact is fetched independently of the geometry so
                  search survives a dead canvas. */}
              <GraphSearchOverlay
                bandCount={search.bandCount}
                labels={labels}
                searchUnavailableReason={searchUnavailableReason}
                onSelect={selectId}
                onMatchesChange={setSearchMatchIndices}
              />
            </div>

            {/* Order is the priority: the legend is decorative and
                `aria-hidden`, while the notice is the only thing on screen that
                says why the canvas is not drawing, so the notice never yields. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex flex-col gap-2 px-3">
              {degraded ? (
                <GraphDegradedNotice reason={degraded} onRetry={handleRetry} />
              ) : null}
              <GraphControlsHint className={stageStyles.controlsHint} />
            </div>
          </div>
        </ResizablePanel>
        {/* The handle and the pane mount TOGETHER, so closing the panel gives
            the stage the whole width back. The panel is a leaf of this subtree
            with its own error boundary, so the canvas is not downstream of a
            panel failure. CLOSING UNMOUNTS IT — no effect BODY ever observes
            `open === false`, which is why `PanelShell` restores focus from an
            effect CLEANUP (panel-shell.tsx branch 2/4). */}
        {dockedPanelOpen ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id={GRAPH_SIDE_PANEL_ID}
              defaultSize={sidePanelDefaultSize}
              minSize={GRAPH_SIDE_MIN_WIDTH}
              maxSize={GRAPH_SIDE_MAX_WIDTH}
            >
              {panelNode}
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      {/* Mobile: no pane and no handle — the drawer portals out of this subtree
          anyway, so it sits beside the group rather than inside it. */}
      {dockedPanelOpen ? null : panelNode}
    </div>
  );
}

export default GraphExplorer;
