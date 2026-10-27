import * as React from "react";
import type { NodeProps } from "@xyflow/react";

import { PropositionCard, type PropositionCardData } from "./proposition-card";

// Conclusion custom node — thin wrapper over the shared card (see PremiseNode).
export function ConclusionNode({ data }: NodeProps) {
  return <PropositionCard data={data as PropositionCardData} />;
}
