import type { EdgeTypes } from "@xyflow/react";

import { WaypointEdge } from "./waypoint-edge";

// React Flow `edgeTypes` registry. One custom edge for the foundation — the
// dagre-waypoint edge. Defined at module level so the identity is stable across
// renders (React Flow warns otherwise).
export const edgeTypes: EdgeTypes = {
  waypoint: WaypointEdge,
};
