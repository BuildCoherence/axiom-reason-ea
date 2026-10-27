// Duplicate-hash node-id disambiguation for the React-Flow theorem flowchart.
//
// Factored OUT of `theorem-flowchart-rf.tsx` (a `"use client"` component that
// pulls in `@xyflow/react`, `lucide-react`, and a CSS Module) so the pure
// transform is importable by the standalone unit runner
// (`node --import tsx --test`), which cannot load those. The component
// re-exports this symbol, so its public surface is unchanged. Same pattern the
// repo already uses for `token-tree-kind-class.ts`.
//
// This module imports ONLY TYPES from `./types` (erased at compile time), so it
// carries no runtime dependency on the React/xyflow/CSS modules `./types`
// transitively aliases through `@/…`.

import type {
  RfFlowchartNode,
  FlowchartEdge,
  FlowchartNodeKind,
  ViewerStance,
} from "./types";

// Make React Flow node ids unique when the wire keys two DIFFERENT-role nodes by
// the same proposition HASH — e.g. a peeled premise that equals the conclusion
// (`P → P`): both arrive with `id` == that hash, so React/dagre keep only one and
// the premise→conclusion edge collapses into a self-loop that mangles the layout.
// Split ONLY across kinds (`<hash>::<kind>`), leaving same-kind duplicates (two
// premises of one proposition) collapsed as before, and re-map each edge endpoint
// by role (source → a non-conclusion node, target → a non-premise node) so the
// self-loop becomes the real premise→conclusion edge. No-op when no hash carries
// more than one kind (the common case).
export function disambiguateDuplicateNodes(
  nodes: RfFlowchartNode[],
  edges: FlowchartEdge[],
  stance: ViewerStance | undefined,
): {
  nodes: RfFlowchartNode[];
  edges: FlowchartEdge[];
  stance: ViewerStance | undefined;
} {
  const byHash = new Map<string, RfFlowchartNode[]>();
  for (const n of nodes) {
    const g = byHash.get(n.id);
    if (g === undefined) byHash.set(n.id, [n]);
    else g.push(n);
  }
  const splitHashes = new Set<string>();
  for (const [hash, g] of byHash) {
    if (new Set(g.map((n) => n.kind)).size > 1) splitHashes.add(hash);
  }
  if (splitHashes.size === 0) return { nodes, edges, stance };

  const idFor = (n: RfFlowchartNode): string =>
    splitHashes.has(n.id) ? `${n.id}::${n.kind}` : n.id;
  // An edge SOURCE is a premise/interior node (never the conclusion); a TARGET is
  // the conclusion/interior (never a premise). Within a split hash, resolve the
  // endpoint to the matching-role node's new id.
  //
  // CORRECTNESS SCOPE: inferring an endpoint's role from "is it the
  // premise-or-conclusion that ISN'T `excludeKind`" is exact ONLY for the v1
  // bipartite DAG, whose only across-kind collision is a `P → P` premise that
  // equals the conclusion (exactly two kinds, premise + conclusion). There,
  // excluding the wrong end leaves a UNIQUE right end, so the `find` always hits.
  // If a future DAG lets a single hash carry >2 kinds (e.g. premise + bridge +
  // conclusion), `find(kind !== excludeKind)` can match more than one node and
  // the `?? g[0]` fallback could silently mis-route the edge to whichever node
  // happens to be first. The guard below makes that assumption fail loudly in
  // development rather than mis-routing in production.
  const resolveEndpoint = (
    hash: string,
    excludeKind: FlowchartNodeKind,
  ): string => {
    if (!splitHashes.has(hash)) return hash;
    const g = byHash.get(hash)!;
    // Assert the v1 bipartite invariant: a split hash carries exactly the two
    // kinds {premise, conclusion}. `process.env.NODE_ENV` is statically inlined,
    // so this whole block is dropped from the production bundle.
    if (process.env.NODE_ENV !== "production") {
      const kinds = new Set(g.map((n) => n.kind));
      if (kinds.size > 2) {
        // eslint-disable-next-line no-console
        console.error(
          `disambiguateDuplicateNodes: hash ${hash} collides across ${kinds.size} ` +
            `kinds (${[...kinds].join(", ")}); the premise/conclusion endpoint ` +
            `inference assumes a bipartite (premise→conclusion) DAG and may mis-route.`,
        );
      }
    }
    const pick = g.find((n) => n.kind !== excludeKind) ?? g[0];
    return `${hash}::${pick.kind}`;
  };

  const newNodes = nodes.map((n) => ({ ...n, id: idFor(n) }));
  const seenEdge = new Set<string>();
  const newEdges: FlowchartEdge[] = [];
  for (const e of edges) {
    const source = resolveEndpoint(e.source, "conclusion");
    const target = resolveEndpoint(e.target, "premise");
    if (source === target) continue; // drop residual self-loops
    const key = `${source} ${target}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    newEdges.push({ ...e, source, target });
  }

  // Stance is per-proposition (keyed by hash); copy each split node's stance onto
  // its new id so per-node stance still resolves.
  let newStance = stance;
  if (stance !== undefined) {
    const remapped: ViewerStance = { ...stance };
    for (const n of nodes) {
      const st = stance[n.id];
      if (st !== undefined) remapped[idFor(n)] = st;
    }
    newStance = remapped;
  }
  return { nodes: newNodes, edges: newEdges, stance: newStance };
}
