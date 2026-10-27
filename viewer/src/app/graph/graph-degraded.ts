// Copy only: every reason is DETECTED elsewhere (`graph-webgl.ts`,
// `graph-artifacts.ts`, `graph-wire.ts`), and no detector may move in here. Pure — no React, no `window`, no `process.env` — so the
// server half and the client half read one table.
//
// Every rung lands on the same surface: the poster, pinned visible, with the
// search card over it. The copy may promise nothing else.

/** Why the canvas is not what renders. */
export type GraphDegradedReason =
  | "no_webgl"
  | "island_error"
  | "context_lost"
  | "rate_limited"
  | "format_version"
  | "artifact_unavailable";

export type GraphDegradedCopy = {
  headline: string;
  /** One sentence: what happened, and what still works. */
  detail: string;
  /** Whether to offer a "Try again" — false wherever a retry cannot change the
   *  answer: a deterministic re-probe, a race with the browser's own context
   *  restore, or a fact that cannot move within this page view. */
  restorable: boolean;
};

/** The rung catalogue. A total `Record` on purpose: a new reason must fail to
 *  typecheck here rather than fall through to generic copy. */
export const GRAPH_DEGRADED_COPY: Record<
  GraphDegradedReason,
  GraphDegradedCopy
> = {
  no_webgl: {
    headline: "Interactive view unavailable",
    detail:
      "This browser cannot run the 3D view. The still behind this shows the same graph, and search still works.",
    restorable: false,
  },
  island_error: {
    headline: "The interactive view stopped",
    detail:
      "Something went wrong drawing the graph. The still behind this shows the same nodes, and search still works.",
    restorable: true,
  },
  context_lost: {
    headline: "The interactive view was interrupted",
    detail:
      "The browser released the graphics context. It usually returns on its own; the still behind this and search are unaffected.",
    restorable: false,
  },
  rate_limited: {
    headline: "Too many requests",
    detail:
      "The view is being fetched too often right now. It will come back shortly; the still behind this and search are unaffected.",
    restorable: true,
  },
  format_version: {
    headline: "This view needs a newer page",
    detail:
      "This snapshot was built by a newer release than the one you have loaded. Reload in a little while; search is current either way.",
    restorable: false,
  },
  artifact_unavailable: {
    headline: "The view could not be loaded",
    detail:
      "The snapshot did not arrive. This is temporary — try again in a moment. The still behind this shows the same nodes, and search still works.",
    restorable: true,
  },
};

export function graphDegradedCopy(
  reason: GraphDegradedReason,
): GraphDegradedCopy {
  return GRAPH_DEGRADED_COPY[reason];
}
