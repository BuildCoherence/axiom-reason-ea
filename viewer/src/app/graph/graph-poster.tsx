import { cn } from "@/lib/utils";
import {
  GRAPH_POSTER_VIEWBOX,
  graphPosterScene,
  graphPosterSvgBody,
} from "@/lib/graph-poster";

import type { GraphManifest } from "./graph-manifest-types";

// Server-rendered inline SVG with no client counterpart: it must ship as markup
// in the first document, so it paints before any island JavaScript exists —
// which is also why the body arrives as one injected string (`graphPosterSvgBody`).

export function GraphPoster({
  manifest,
  className,
}: {
  manifest: GraphManifest;
  className?: string;
}) {
  const body = graphPosterSvgBody(graphPosterScene(manifest.poster), {
    // `var(--token)`, never a resolved literal: the poster follows the theme
    // with no client re-render and no hydration seam.
    node: (token) => `var(${token})`,
    edge: "currentColor",
  });

  return (
    <svg
      viewBox={`0 0 ${GRAPH_POSTER_VIEWBOX} ${GRAPH_POSTER_VIEWBOX}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Orthographic view of the most engaged region of the Knowledge Graph"
      className={cn("h-full w-full", className)}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
