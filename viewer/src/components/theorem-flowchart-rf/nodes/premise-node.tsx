import * as React from "react";
import type { NodeProps } from "@xyflow/react";

import { PropositionCard, type PropositionCardData } from "./proposition-card";

// Premise custom node — a thin React Flow wrapper over the shared card. All the
// rendering lives in PropositionCard; this exists so the shell can register a
// distinct `nodeType` and the next round can diverge premise chrome if needed.
export function PremiseNode({ data }: NodeProps) {
  return <PropositionCard data={data as PropositionCardData} />;
}
