import type { Metadata } from "next";

import { loadCorpusIndex, loadGraphManifest } from "@/lib/page-data";
import { SITE_URL } from "@/lib/site";

import { GraphExplorer } from "./graph-explorer";
import { GraphPoster } from "./graph-poster";
import { GraphStatusBar } from "./graph-status-bar";
import { graphNodeKinds } from "./graph-panel-model";

const GRAPH_TITLE = "Knowledge Graph";
// Names the canvas for assistive technology.
const GRAPH_CANVAS_ARIA_LABEL =
  "Interactive 3D view of the Knowledge Graph. Use the search box to find a node by name.";
const GRAPH_DESCRIPTION =
  "Axiom's global knowledge graph of formally verified ideas. Every node is a user-published idea, and every connection is proven valid in Lean 4.";

export const metadata: Metadata = {
  title: GRAPH_TITLE,
  description: GRAPH_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/graph` },
};

// The frozen final Generation, prerendered. The selection (`?prop=` / `?def=`)
// is read by the explorer after hydration.
export default function GraphPage() {
  const index = loadCorpusIndex();
  const manifest = loadGraphManifest(index);

  // The workbench wrapper covers the marketing footer, which is why
  // `GraphStatusBar` carries the affordances it would otherwise hold.
  return (
    <div
      data-workbench="true"
      className="fixed inset-x-0 bottom-0 top-[var(--ce-nav-height)] flex flex-col overflow-hidden bg-background"
    >
      {/* `crossOrigin="anonymous"` means request mode "cors" and credentials
          mode "same-origin". The island's fetch must match both
          (`GRAPH_ARTIFACT_REQUEST_INIT` in `graph-artifacts.ts`) or the preload
          cache discards this response and the payload is fetched twice. */}
      <link
        rel="preload"
        as="fetch"
        href={manifest.geometry_path}
        crossOrigin="anonymous"
      />

      {/* The poster is passed as a NODE so it stays server work: it must ship as
          markup in the first document, before any island JavaScript exists. */}
      <GraphExplorer
        geometryUrl={manifest.geometry_path}
        labelsUrl={manifest.labels_path}
        nodeCount={manifest.counts.nodes}
        ariaLabel={GRAPH_CANVAS_ARIA_LABEL}
        bandCutPoints={manifest.band_cut_points}
        nodeKinds={graphNodeKinds(manifest)}
        poster={<GraphPoster manifest={manifest} />}
        search={{ bandCount: manifest.band_counts.length }}
      />

      <GraphStatusBar frozenAt={index.frozen_at} />
    </div>
  );
}
