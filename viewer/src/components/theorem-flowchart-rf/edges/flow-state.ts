// Stance → resolved edge-flow state (design contract: five-state flow machine).
//
// Pure and view-free, in its own module — factored out of the `"use client"`
// shell so the standalone runner (`node --import tsx --test`) can import it
// WITHOUT pulling `@xyflow/react`, a CSS Module, or React (the same factoring
// `disambiguate-duplicate-nodes.ts` uses).

import type { ViewerStance } from "../types";
import type { EdgeFlowState } from "./waypoint-edge";

/**
 * Map a single PREMISE's viewer stance to the strand's resolved flow state:
 *   held → flowing, undecided → dormant, rejected → severed.
 *
 * NO viewer stance at all (an anonymous request — no node carries a stance) maps
 * to DORMANT, NOT a bespoke "neutral" variant (design fixes #2/#3): with no
 * per-viewer reckoning every premise reads as "undecided/anonymous", so the
 * strands render EXACTLY like the all-undecided ("anonymous") canonical preset —
 * gray DOTTED, the conduit beads + the trunk stub/cross marks. (A per-node id
 * MISSING from an OTHERWISE-PRESENT stance map is a different, real edge case —
 * it stays `neutral` via the inner default — so an authed viewer's stance keeps
 * the five-state behaviour unchanged.)
 */
export function strandStateFromStance(
  stance: ViewerStance | undefined,
  premiseId: string,
): EdgeFlowState {
  // No stance map at all ⇒ the anonymous/all-undecided render: dormant strands.
  if (stance === undefined) return "dormant";
  switch (stance[premiseId]) {
    case "held":
      return "flowing";
    case "pending-held":
      return "pending-flowing";
    case "undecided":
      return "dormant";
    case "rejected":
      return "severed";
    case "pending-rejected":
      return "pending-severed";
    case "pending-undecided":
      return "pending-dormant";
    default:
      return "neutral";
  }
}

/**
 * Resolve the TRUNK state — a GRAPH-LEVEL computation: the conduit flows iff
 * EVERY premise is held; otherwise it is blocked at the bundle. This can't be
 * derived per-edge (it depends on all premises), so the shell computes it once
 * and stamps the same value on every trunk segment. `feedingPremiseIds` is the
 * set of premises that actually feed the proof (the strands' sources);
 * `premiseCount` is how many premise NODES the graph has at all.
 */
export function trunkState(
  stance: ViewerStance | undefined,
  feedingPremiseIds: string[],
  premiseCount: number,
): EdgeFlowState {
  // Vacuous truth: a premise-free theorem has nothing left to hold, so its
  // conclusion is proven for EVERY viewer, signed in or not. Keyed on premise
  // NODES, never on `settled` — a `concludes_false` conclusion is settled too.
  if (premiseCount === 0) return "flowing";
  // No per-viewer stance at all (an anonymous request): render EXACTLY like the
  // all-undecided ("anonymous") canonical preset, where the conduit is NOT
  // delivering — i.e. BLOCKED (dotted grey conduit + the apex stop-bar / trunk
  // stub marks above & below the proof node). Deriving this from the anonymous
  // case (all premises undecided ⇒ not-all-held ⇒ blocked) keeps the no-stance
  // and all-undecided renders identical (design fixes #2/#3).
  if (stance === undefined) return "blocked";
  if (feedingPremiseIds.length === 0) return "neutral";
  const allHeld = feedingPremiseIds.every((id) =>
    stance[id] === "held" || stance[id] === "pending-held"
  );
  if (!allHeld) return "blocked";
  return feedingPremiseIds.some((id) => stance[id] === "pending-held")
    ? "pending-flowing"
    : "flowing";
}
