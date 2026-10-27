"use client";

// This shell must never reach `three`: the island is reached only through
// `next/dynamic`.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IslandErrorBoundary } from "@/components/island-error-boundary";
import { useTheme } from "@/components/theme/theme-provider";
import type { GraphNodeKind } from "@/lib/graph-kind-legend";

import type { GraphDegradedReason } from "./graph-degraded";
import type { GraphArrivalSkipReason } from "./graph-arrival";
import {
  fetchGraphGeometryRetrying429,
  fetchGraphLabels,
  scheduleGraphIdleTask,
  type GraphLabelsOutcome,
} from "./graph-artifacts";
import {
  buildGraphHighlight,
  buildGraphSceneModel,
  graphSceneColors,
} from "./graph-scene-model";
import type { GraphCanvasTap } from "./graph-picking";
import { detectWebGLSupport, type GraphCanvasRung } from "./graph-webgl";
import type { DecodedGraphGeometry, DecodedGraphLabels } from "./graph-wire";

// `ssr: false` is the only legal form: a WebGL renderer has no meaning on a server.
const GraphIsland = dynamic(() => import("./graph-island"), { ssr: false });

/** `kind` is what routes the selection to `?prop=` vs `?def=` — the two id namespaces share one alphabet. */
export type GraphNodeSelection = {
  index: number;
  id: string;
  kind: GraphNodeKind;
};

export type GraphDegradedReport = (reason: GraphDegradedReason) => void;

export type GraphCanvasProps = {
  /** Root-relative, same-origin (the manifest's `geometry_path`). */
  geometryUrl: string;
  labelsUrl: string;
  /** From the MANIFEST, not the geometry, so the labels length check still runs in rungs that fetched none. */
  nodeCount: number;
  ariaLabel: string;
  /** The Graph Manifest's `band_cut_points` — the arrival's stagger order. */
  bandCutPoints?: readonly number[];
  /** True only when the URL named a selection on ARRIVAL — not `selectedId != null`. */
  deepLink?: boolean;
  /** The poster was on screen when this canvas became ready; the arrival is skipped for that visitor. */
  posterShown?: boolean;
  onArrivalSkipped?: (reason: GraphArrivalSkipReason) => void;
  /** An id this Generation does not carry simply draws no highlight — the panel still opens. */
  selectedId?: string | null;
  /** A hit ALWAYS fires, even for the node already selected: re-tapping is how a dragged-away drawer comes back. */
  onSelect?: (node: GraphNodeSelection | null) => void;
  onLabels?: (outcome: GraphLabelsOutcome) => void;
  onGeometry?: (geometry: DecodedGraphGeometry) => void;
  searchMatchIndices?: ReadonlySet<number> | null;
  egoIndices?: ReadonlySet<number> | null;
  flyToSelection?: boolean;
  wireEdges?: { src: Uint32Array; dst: Uint32Array } | null;
  onDegraded: GraphDegradedReport;
  onFirstFrame?: () => void;
  onRungChange?: (rung: GraphCanvasRung) => void;
  /** Reaches BOTH the geometry fetch and the island's error boundary. */
  retryNonce?: number;
};

/** Matches the Tailwind `sm` breakpoint the stage uses, so the DPR ceiling and the layout agree. */
const MOBILE_MAX_WIDTH_PX = 639;

function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function GraphCanvas(props: GraphCanvasProps) {
  const {
    geometryUrl,
    labelsUrl,
    nodeCount,
    selectedId = null,
    retryNonce = 0,
  } = props;
  const { resolvedMode } = useTheme();

  // Probed once, lazily: a browser with no WebGL must never download the island chunk.
  const [webglAvailable] = useState(() =>
    typeof document === "undefined" ? false : detectWebGLSupport(),
  );
  const [geometry, setGeometry] = useState<DecodedGraphGeometry | null>(null);
  // The geometry ATTEMPT finished, however it finished — the labels fetch waits
  // on this rather than on a payload, so a lost fetch does not strand search.
  const [geometryAttemptDone, setGeometryAttemptDone] = useState(false);

  const report = props.onDegraded;

  const onGeometryRef = useRef(props.onGeometry);
  onGeometryRef.current = props.onGeometry;

  useEffect(() => {
    if (!webglAvailable) report("no_webgl");
  }, [webglAvailable, report]);

  useEffect(() => {
    if (!webglAvailable) return;
    setGeometryAttemptDone(false);
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      const outcome = await fetchGraphGeometryRetrying429(geometryUrl, {
        signal: controller.signal,
      });
      if (cancelled) return;
      setGeometryAttemptDone(true);
      if (outcome.status !== "ok") {
        report(outcome.reason);
        return;
      }
      setGeometry(outcome.geometry);
      onGeometryRef.current?.(outcome.geometry);
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [geometryUrl, webglAvailable, report, retryNonce]);

  // Ref-held and kept out of the dependency array: an inline callback's identity
  // would cancel and re-issue the labels fetch on every parent render.
  const onLabelsRef = useRef(props.onLabels);
  onLabelsRef.current = props.onLabels;
  const [labels, setLabels] = useState<DecodedGraphLabels | null>(null);

  // NOT gated on WebGL and not on a geometry payload: search must survive every
  // rung the canvas does not.
  const labelsUnblocked = !webglAvailable || geometryAttemptDone;

  useEffect(() => {
    if (!labelsUnblocked) return;
    // A new Generation renumbers every node, so labels held from the last one
    // are not merely stale — they name different nodes.
    setLabels(null);
    const controller = new AbortController();
    let cancelled = false;
    const cancelIdle = scheduleGraphIdleTask(() => {
      void (async () => {
        const outcome = await fetchGraphLabels(labelsUrl, nodeCount, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (outcome.status === "ok") setLabels(outcome.labels);
        onLabelsRef.current?.(outcome);
      })();
    });
    return () => {
      cancelled = true;
      cancelIdle();
      controller.abort();
    };
  }, [labelsUnblocked, labelsUrl, nodeCount]);

  const colors = useMemo(() => graphSceneColors(resolvedMode), [resolvedMode]);
  const model = useMemo(
    () => (geometry ? buildGraphSceneModel(geometry, colors) : null),
    [geometry, colors],
  );
  // Rebuilt per GEOMETRY, never carried across one: a new Generation renumbers
  // every node, so an index from the last one names a different node.
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    if (!geometry) return map;
    for (let i = 0; i < geometry.ids.length; i++) {
      if (!map.has(geometry.ids[i])) map.set(geometry.ids[i], i);
    }
    return map;
  }, [geometry]);

  const selectedIndex = useMemo(
    () => (selectedId === null ? null : (indexById.get(selectedId) ?? null)),
    [selectedId, indexById],
  );

  const highlight = useMemo(
    () =>
      geometry && model
        ? buildGraphHighlight(geometry, model.basis, selectedIndex)
        : null,
    [geometry, model, selectedIndex],
  );

  // The URL clear on a background miss is applied here unconditionally: the
  // drawer is `modal={false}`, so vaul renders no overlay and never sees the tap.
  // `replaceState`, never `pushState` — dismissing a panel is not a navigation.
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const handleCanvasTap = useCallback((tap: GraphCanvasTap) => {
    if (tap.kind === "clear") {
      if (typeof window !== "undefined") {
        window.history.replaceState(window.history.state, "", tap.url);
      }
      onSelectRef.current?.(null);
      return;
    }
    const decoded = geometryRef.current;
    // An index the columns cannot name is not a selection — inventing one would
    // open a panel on a guess.
    if (!decoded || tap.index < 0 || tap.index >= decoded.ids.length) return;
    onSelectRef.current?.({
      index: tap.index,
      id: decoded.ids[tap.index],
      kind: decoded.kinds[tap.index],
    });
  }, []);

  const nodeLabel = useCallback(
    (index: number) => labels?.labels[index] ?? null,
    [labels],
  );

  if (!webglAvailable || !model) return null;

  return (
    // An island throw must degrade in place to the poster, never to the
    // route-level error.tsx.
    <IslandErrorBoundary
      // Remount-by-key IS the reset: the boundary latches `hasError` and offers
      // no reset of its own.
      key={retryNonce}
      logLabel="graph-island"
      fallback={<IslandFailed report={report} />}
    >
      <GraphIsland
        model={model}
        surface="graph"
        // Its OWN prop: a selection must change what is drawn, never the
        // renderer or the WebGL context.
        highlight={highlight}
        colors={colors}
        reducedMotion={prefersReducedMotion()}
        isMobile={
          typeof window !== "undefined" &&
          window.innerWidth <= MOBILE_MAX_WIDTH_PX
        }
        ariaLabel={props.ariaLabel}
        selectedIndex={selectedIndex}
        nodeLabel={nodeLabel}
        searchMatchIndices={props.searchMatchIndices}
        egoIndices={props.egoIndices}
        flyToSelection={props.flyToSelection}
        wireEdges={props.wireEdges}
        onCanvasTap={handleCanvasTap}
        bandCutPoints={props.bandCutPoints}
        deepLink={props.deepLink}
        posterShown={props.posterShown}
        onArrivalSkipped={props.onArrivalSkipped}
        onFirstFrame={props.onFirstFrame}
        onRungChange={props.onRungChange}
      />
    </IslandErrorBoundary>
  );
}

/** `report` must be a STABLE callback — an inline arrow would emit `island_error` on every parent render. */
function IslandFailed({ report }: { report: GraphDegradedReport }) {
  useEffect(() => {
    report("island_error");
  }, [report]);
  return null;
}

export default GraphCanvas;
