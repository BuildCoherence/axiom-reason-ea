import type { NodeTypes } from "@xyflow/react";

import { PremiseNode } from "./premise-node";
import { ConclusionNode } from "./conclusion-node";
import { InteriorStepNode } from "./interior-step-node";
import { ProofGroupNode } from "./proof-group-node";

// The React Flow `nodeTypes` registry for the theorem flowchart. Keys are the
// `type` strings the shell stamps on each node when building the graph. Defined
// OUTSIDE the component (a stable module-level object) so React Flow doesn't warn
// about a new nodeTypes identity every render.
export const nodeTypes: NodeTypes = {
  premise: PremiseNode,
  conclusion: ConclusionNode,
  interiorStep: InteriorStepNode,
  proofGroup: ProofGroupNode,
};

export type RfNodeType = keyof typeof nodeTypes;
