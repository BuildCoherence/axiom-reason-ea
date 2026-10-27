// Shared, framework-free force-directed layout for the profile graph.
//
// WHY this exists: the live hero (profile-graph.tsx) lays the graph out CLIENT-
// side with `graphology` + ForceAtlas2 inside a Sigma/WebGL island, animating
// the settle over requestAnimationFrame batches. The Open Graph card
// (opengraph-image.tsx) must draw the SAME graph SERVER-side, where there is no
// browser, no WebGL, and no animation — only Satori turning flat markup into a
// PNG. The layout MATH (the deterministic seed, the FA2 settings, the per-batch
// axiom pull, the iteration budget) is pure JS and runs fine in Node; only the
// rAF batching + `sigma.refresh()` are browser-specific (they exist to animate
// the settle on screen). Factoring the math here lets BOTH callers share one
// source of truth so the card can't drift from what users actually see — the
// live component imports the primitives and keeps its animation loop; the OG
// route calls `computeProfileLayout()` and runs the same settle synchronously.
//
// Keep this file free of React, sigma, and the DOM so it stays Node-safe.

import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

import type { GraphSpec } from "./graph-model";

// Deterministic seed so the layout (and the OG card it feeds) are stable across
// reloads and identical between the client island and the server route.
export function pseudo(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Seed positions: axioms in a small CENTRAL disk (the roots theorems hang off),
// held nodes on an outer annulus so their edges pull them inward toward their
// axioms. strongGravityMode + the per-batch axiom pull keep the heavy axioms
// central while theorems splay outward. Both seed formulas are deterministic in
// the node's index so the same data lays out the same way everywhere.
export function axiomSeedPosition(i: number): { x: number; y: number } {
  const r = 3 * Math.sqrt(pseudo(i * 3.1 + 5)); // fill a small disk, denser at centre
  const a = pseudo(i * 5.3 + 2) * 2 * Math.PI;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export function heldSeedPosition(i: number): { x: number; y: number } {
  const r = 8 + 6 * pseudo(i * 2.3 + 1); // outer annulus (8..14)
  const a = pseudo(i * 7.7 + 3) * 2 * Math.PI;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

// Iteration budget by graph order — fewer passes on big graphs so a settle stays
// bounded. On the client this is the SAFETY cap (it stops early on convergence);
// server-side we run the whole budget (no animation to make convergence visible).
export const iterationsFor = (order: number): number =>
  order > 1200 ? 80 : order > 500 ? 100 : 140;

// Radial bias toward the centre for AXIOMS only — pure FA2 can't centralise hubs
// (a node's equilibrium radius is mass-independent), so each batch nudges every
// axiom a fixed fraction toward the origin. See profile-graph.tsx for the full
// rationale; the fraction lives here so client + server pull identically.
export const AXIOM_PULL = 0.18;

// FA2 settings shared by the live island and the OG route. `inferSettings`
// adapts a couple of values to the graph's order; the explicit overrides encode
// the tuned look (central axioms, clean convergence). Kept in one place so the
// two renderers can't diverge on a setting.
export function fa2Settings(g: Graph) {
  return {
    ...forceAtlas2.inferSettings(g),
    barnesHutOptimize: true,
    // Keep the high-degree AXIOMS central (distance-independent pull ∝ mass).
    strongGravityMode: true,
    outboundAttractionDistribution: false,
    gravity: 0.9,
    scalingRatio: 24,
    // Damp late-stage overshoot so motion decays cleanly.
    slowDown: 6,
  };
}

// Nudge every axiom node a fixed fraction toward the origin (the gravity centre).
// Run once per FA2 batch on both client and server.
export function applyAxiomPull(g: Graph): void {
  g.forEachNode((node, a) => {
    if (a.kind === "axiom") {
      g.setNodeAttribute(node, "x", (a.x as number) * (1 - AXIOM_PULL));
      g.setNodeAttribute(node, "y", (a.y as number) * (1 - AXIOM_PULL));
    }
  });
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  kind: "axiom" | "proof" | "proposition" | "projection";
  /** True on an over-determined proposition node — drives the third node colour. */
  overDetermined: boolean;
}

// Compute final node positions for a GraphSpec, synchronously, with no browser.
// Builds a graphology Graph from the spec, seeds it deterministically, then runs
// the SAME FA2 settle the live island animates (seed → batched assign → axiom
// pull) to its full iteration budget and returns each node's resting position.
// Used by the OG card; the live component reuses the primitives above directly.
export function computeProfileLayout(spec: GraphSpec): LayoutNode[] {
  const graph = new Graph();

  const axioms = spec.nodes.filter((n) => n.kind === "axiom");
  const held = spec.nodes.filter((n) => n.kind !== "axiom");

  axioms.forEach((node, i) => {
    const { x, y } = axiomSeedPosition(i);
    graph.addNode(node.id, { x, y, kind: "axiom" });
  });
  held.forEach((node, i) => {
    const { x, y } = heldSeedPosition(i);
    graph.addNode(node.id, { x, y, kind: node.kind });
  });
  spec.edges.forEach((e) => {
    if (
      graph.hasNode(e.source) &&
      graph.hasNode(e.target) &&
      !graph.hasEdge(e.id)
    ) {
      graph.addEdgeWithKey(e.id, e.source, e.target);
    }
  });

  if (graph.order === 0) return [];

  const settings = fa2Settings(graph);
  const total = iterationsFor(graph.order);
  const batch = 2;
  for (let done = 0; done < total; done += batch) {
    forceAtlas2.assign(graph, { iterations: batch, settings });
    applyAxiomPull(graph);
  }

  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const out: LayoutNode[] = [];
  graph.forEachNode((id, attrs) => {
    const n = byId.get(id);
    if (!n) return;
    out.push({
      id,
      x: attrs.x as number,
      y: attrs.y as number,
      kind: n.kind,
      overDetermined: n.overDetermined,
    });
  });
  return out;
}
