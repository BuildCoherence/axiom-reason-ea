// Pure: the unit suite can import a `.ts` and cannot render the island's `.tsx`.

import type { GraphDegradedReason } from "./graph-degraded";

/** How long one band takes to bloom in, in milliseconds. */
export const GRAPH_ARRIVAL_BAND_MS = 420;
/** The gap between band starts. Shorter than the bloom, so bands overlap. */
export const GRAPH_ARRIVAL_BAND_STAGGER_MS = 260;
/** The poster → canvas crossfade, in milliseconds. */
export const GRAPH_ARRIVAL_CROSSFADE_MS = 320;

/** How long the stage may stay empty before the poster steps in. Measured against
 *  real first-frame times, and shared with the CSS reveal in
 *  `graph-stage.module.css`, which a unit case asserts agrees with it. */
export const GRAPH_POSTER_DELAY_MS = 1600;

/** Once the reveal starts it is committed to: a deadline alone only relocates
 *  the flash it exists to prevent. */
export const GRAPH_POSTER_MIN_VISIBLE_MS = 900;

/** Why the arrival did not play. */
export type GraphArrivalSkipReason =
  /** An inbound `?prop=` / `?def=`. */
  | "deep_link"
  /** `prefers-reduced-motion: reduce`. */
  | "reduced_motion"
  /** Any pointer or key input mid-arrival. */
  | "input"
  /** No geometry to reveal (the poster or degraded rungs). */
  | "no_canvas"
  /** The poster got there first — the visitor has already seen the whole graph. */
  | "poster_shown";

export type GraphArrivalConditions = {
  /** True when the URL named a selection on arrival. */
  deepLink: boolean;
  /** `matchMedia("(prefers-reduced-motion: reduce)").matches`. */
  reducedMotion: boolean;
  /** False on the poster / no-WebGL / degraded rungs. */
  canvasLive: boolean;
  /** The poster was already on screen when the canvas became ready. */
  posterShown?: boolean;
};

/** Whether to play the arrival, and if not, why. Order is the contract: a deep
 *  link that also has reduced motion must report `deep_link`. */
export function graphArrivalSkipReason(
  conditions: GraphArrivalConditions,
): GraphArrivalSkipReason | null {
  if (!conditions.canvasLive) return "no_canvas";
  if (conditions.deepLink) return "deep_link";
  if (conditions.reducedMotion) return "reduced_motion";
  // Last: a slow deep link must still report `deep_link`, not `poster_shown`.
  if (conditions.posterShown) return "poster_shown";
  return null;
}

/** Reduced motion is the FINAL STATE, rendered — never a shortened tween. */
export function graphArrivalRespectsReducedMotion(
  reducedMotion: boolean,
): boolean {
  return !reducedMotion;
}

// Both poster surfaces — /graph's stage and the landing hero — run these two rules.

/** Was the visitor shown the poster. React's pin is taken first: a pinned poster
 *  has no `animationstart` to observe, and `NaN > 0` is false. */
export function graphPosterOnScreen(input: {
  /** React's pin: a degraded rung on /graph, no canvas coming on the landing. */
  pinnedShown: boolean;
  /** `Number(getComputedStyle(layer).opacity)`. `NaN` is a legitimate reading. */
  layerOpacity: number;
}): boolean {
  return input.pinnedShown || input.layerOpacity > 0;
}

/** The `data-poster` / `data-landing-poster` attribute; `undefined` is a real answer. */
export type GraphPosterState = "shown" | "hidden" | undefined;

/** `undefined` on the server and the first client render, so hydration matches.
 *  The hold is an ABSENCE for an animation-revealed poster (the reveal is
 *  `forwards`) and an explicit "shown" for a React-pinned one, which has no
 *  fill to hold it. */
export function graphPosterState(input: {
  /** The poster is pinned visible because no canvas is coming. */
  pinnedShown: boolean;
  /** The canvas has drawn at least one frame. */
  canvasLive: boolean;
  /** The LATCHED answer from `graphPosterOnScreen`: once true, never false again. */
  wasShown: boolean;
  /** Latched with it: the pin, not the CSS reveal, put the poster on screen. */
  wasPinned: boolean;
  /** The minimum has elapsed since the latch. */
  holdElapsed: boolean;
}): GraphPosterState {
  const held = input.wasShown && !input.holdElapsed;
  if (input.pinnedShown || (held && input.wasPinned)) return "shown";
  return input.canvasLive && !held ? "hidden" : undefined;
}

export type GraphArrivalStep = {
  /** Zero-based band index; band 0 is the highest-ranked slice. */
  band: number;
  /** Emitted node indices `[from, to)` this step reveals. */
  from: number;
  to: number;
  /** Milliseconds after the arrival starts. */
  startMs: number;
  endMs: number;
};

/** One reveal step per band. Keyed on band CUT-POINTS, not rank values: ranks
 *  tie constantly, so a rank-thresholded reveal would pop most of the graph in
 *  one frame. `bandCutPoints[b]` is the index of the first node of band b. */
export function graphArrivalPlan(
  bandCutPoints: readonly number[],
  nodeCount: number,
): GraphArrivalStep[] {
  if (nodeCount <= 0 || bandCutPoints.length === 0) return [];
  const steps: GraphArrivalStep[] = [];
  for (let b = 0; b < bandCutPoints.length; b++) {
    const from = clampIndex(bandCutPoints[b], nodeCount);
    const to =
      b + 1 < bandCutPoints.length
        ? clampIndex(bandCutPoints[b + 1], nodeCount)
        : nodeCount;
    // An empty band is skipped: a step revealing nothing still owns a beat of
    // the stagger, which reads as a stall.
    if (to <= from) continue;
    const startMs = steps.length * GRAPH_ARRIVAL_BAND_STAGGER_MS;
    steps.push({
      band: b,
      from,
      to,
      startMs,
      endMs: startMs + GRAPH_ARRIVAL_BAND_MS,
    });
  }
  return steps;
}

function clampIndex(value: number, nodeCount: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), nodeCount);
}

/** The NODE timeline's duration; "is the arrival over" must use `graphArrivalTotalMs`. */
export function graphArrivalDurationMs(
  steps: readonly GraphArrivalStep[],
): number {
  return steps.length === 0 ? 0 : steps[steps.length - 1].endMs;
}

/** When the edges start, as a fraction of the node reveal. Below 1, so the two
 *  phases overlap rather than reading as two queued animations. */
export const GRAPH_ARRIVAL_EDGE_START_FRACTION = 0.45;

/** How long the edges take to finish after the last node has landed. */
export const GRAPH_ARRIVAL_EDGE_FADE_MS = 420;

/** The whole sequence, nodes and edges. What "the arrival is over" means. */
export function graphArrivalTotalMs(
  steps: readonly GraphArrivalStep[],
): number {
  const nodes = graphArrivalDurationMs(steps);
  return nodes === 0 ? 0 : nodes + GRAPH_ARRIVAL_EDGE_FADE_MS;
}

/** Edge opacity multiplier at `elapsed` ms: 0 before the edges start, 1 at the end. */
export function graphArrivalEdgeOpacity(
  steps: readonly GraphArrivalStep[],
  elapsedMs: number,
): number {
  const total = graphArrivalTotalMs(steps);
  if (total <= 0) return 1;
  const start =
    graphArrivalDurationMs(steps) * GRAPH_ARRIVAL_EDGE_START_FRACTION;
  if (elapsedMs <= start) return 0;
  if (elapsedMs >= total) return 1;
  const t = (elapsedMs - start) / (total - start);
  return t * t * (3 - 2 * t);
}

/** How many emitted nodes are visible at `elapsed` ms. A PREFIX count — emission
 *  is rank-ordered and bands are index cuts of it — so the shader needs one
 *  uniform rather than a per-instance visibility attribute. */
export function graphArrivalRevealedCount(
  steps: readonly GraphArrivalStep[],
  elapsedMs: number,
  nodeCount: number,
): number {
  if (steps.length === 0) return nodeCount;
  if (elapsedMs >= graphArrivalDurationMs(steps)) return nodeCount;
  let revealed = 0;
  for (const step of steps) {
    if (elapsedMs <= step.startMs) break;
    const progress = Math.min(
      1,
      (elapsedMs - step.startMs) / Math.max(1, step.endMs - step.startMs),
    );
    revealed = step.from + Math.round((step.to - step.from) * progress);
  }
  return Math.max(0, Math.min(revealed, nodeCount));
}

/** The scene's scale when the arrival starts. Not 0: a zero scale hands the
 *  driver a degenerate model matrix. */
export const GRAPH_ARRIVAL_BURST_START_SCALE = 0.02;

/** The scene's scale multiplier at `elapsed` ms, ease-out cubic. */
export function graphArrivalBurstScale(
  steps: readonly GraphArrivalStep[],
  elapsedMs: number,
): number {
  const duration = graphArrivalDurationMs(steps);
  if (duration <= 0) return 1;
  const t = Math.max(0, Math.min(1, elapsedMs / duration));
  const eased = 1 - Math.pow(1 - t, 3);
  return (
    GRAPH_ARRIVAL_BURST_START_SCALE +
    (1 - GRAPH_ARRIVAL_BURST_START_SCALE) * eased
  );
}

/** The arrival plays once per MOUNT, not per scene build: the scene model carries
 *  resolved theme colours, so a theme toggle rebuilds it. */
export type GraphArrivalOpening = {
  /** EMPTY means "draw the settled state immediately". */
  steps: GraphArrivalStep[];
  /** Why the arrival was skipped. Non-null at most once per mount. */
  skipped: GraphArrivalSkipReason | null;
};

export type GraphArrivalGateInput = GraphArrivalConditions & {
  /** The Graph Manifest's band cut-points — the stagger order. */
  bandCutPoints: readonly number[];
  nodeCount: number;
};

export type GraphArrivalGate = {
  /** Decide this scene build's arrival, and spend the gate. */
  open: (input: GraphArrivalGateInput) => GraphArrivalOpening;
  /** Hand the gate back: the scene was torn down before it drew a single frame,
   *  so the visit's one arrival has not been spent. */
  rescind: () => void;
};

/** INJECTED so a spec can assert the two decisions are consulted exactly once. */
export type GraphArrivalGateDeps = {
  skipReason?: (
    conditions: GraphArrivalConditions,
  ) => GraphArrivalSkipReason | null;
  plan?: (
    bandCutPoints: readonly number[],
    nodeCount: number,
  ) => GraphArrivalStep[];
};

export function createGraphArrivalGate(
  deps: GraphArrivalGateDeps = {},
): GraphArrivalGate {
  const skipReason = deps.skipReason ?? graphArrivalSkipReason;
  const plan = deps.plan ?? graphArrivalPlan;
  let spent = false;
  return {
    open(input) {
      // Spent before the helpers are reached: the inputs answer about THIS
      // VISIT, and a rebuild must not get a second, contradictory answer.
      if (spent) return { steps: [], skipped: null };
      spent = true;
      const reason = skipReason(input);
      if (reason !== null) return { steps: [], skipped: reason };
      return {
        steps: plan(input.bandCutPoints, input.nodeCount),
        skipped: null,
      };
    },
    rescind() {
      spent = false;
    },
  };
}

/** Compile-time proof that a skip reason is not silently a degraded reason. */
export type GraphArrivalSkipIsNotDegraded =
  GraphArrivalSkipReason extends GraphDegradedReason ? never : true;
