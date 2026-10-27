// Prototype-local types for the React-Flow theorem flowchart.
//
// The DATA CONTRACT is the existing one: we re-export `FlowchartNode`,
// `FlowchartEdge`, `TheoremDag`, `FlowchartNodeKind` verbatim from the live
// component so the prototype consumes exactly what the API emits (no fork of the
// wire shape). This module only adds the prototype-only vocabulary: the viewer-
// stance map, the proof-fold container identity, and the kind partition helper.

export type {
  FlowchartNode,
  FlowchartEdge,
  FlowchartNodeKind,
  TheoremDag,
} from "@/components/theorem-flowchart/types";

export type {
  ByteRange,
  TokenTree,
  TokenTreePair,
  ViewChoice,
  TokenTag,
} from "@/components/lean-ui/types";
export type { PopoverTarget } from "@/components/lean-ui/identifier-popover";

import type {
  FlowchartNodeKind,
  FlowchartNode as WireFlowchartNode,
} from "@/components/theorem-flowchart/types";

/**
 * Prototype-local node = the wire {@link WireFlowchartNode} plus an optional
 * snake_case `name`. The wire shape has no human-facing name (premises are
 * keyed by hash); the prototype carries one so the premise card header can show
 * `moral_duty` instead of the literal word "PREMISE" (design change #3). Optional
 * because conclusion/interior cards don't show a name — only premises do.
 */
export interface RfFlowchartNode extends WireFlowchartNode {
  /**
   * Snake_case identifier shown as the premise card header (premises only).
   * The wire emits an explicit `null` for anonymous/unnamed binders (e.g. a
   * `variable [Inst]` instance), so guard with `!= null`, not `!== undefined`.
   */
  name?: string | null;
}

/**
 * Viewer-relative stance per node id (design § 5). Drives the five-state
 * edge-flow machine (held→flowing, undecided→dormant, rejected→severed; trunk
 * flows iff ALL premises held, else blocked at the bundle). Ships in v1 for
 * AUTHENTICATED viewers, built from the API's per-node `viewer_stance`;
 * anonymous requests carry no stance, so the canvas renders the neutral
 * canonical (all-undecided) flow. Edge state stays distinguishable WITHOUT
 * animation (color + dash/arrowhead) — animation is enhancement only.
 */
export type ViewerStanceValue =
  | "held"
  | "undecided"
  | "rejected"
  | "pending-held"
  | "pending-rejected"
  | "pending-undecided";
export type ViewerStance = Record<string, ViewerStanceValue>;

/**
 * Synthetic id of the proof-fold container (the collapsible group node). Not a
 * real DAG node — it never collides with a node hash (hashes are hex), and the
 * layout/shell treat it specially.
 */
export const CONTAINER_NODE_ID = "__proof_fold_container__";

/** The interior kinds the proof fold groups: everything NOT a premise/conclusion. */
export function isInteriorKind(kind: FlowchartNodeKind): boolean {
  return kind !== "premise" && kind !== "conclusion";
}
