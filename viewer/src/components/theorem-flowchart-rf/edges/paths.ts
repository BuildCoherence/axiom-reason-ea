// SVG path emission for the theorem flowchart's edges — pure, DOM-free, and
// Node-safe so the page renderer and the OG route emit the SAME markup from the
// same geometry.
//
// Extracted verbatim from `waypoint-edge.tsx` (a `"use client"` component that
// pulls in `@xyflow/react` and a CSS Module). The one substantive change is
// `Math.hypot` → `Math.sqrt(dx*dx + dy*dy)`: hypot is a transcendental-adjacent
// library call whose result may differ across runtimes, while sqrt is
// exactly-rounded by IEEE 754 — the server-safety spec bans the former in every
// module the OG route shares with the page.

/** Vertical-tangent cubic between two face centres (source bottom → target top). */
export function plainPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return pathFromPoints(points);
  if (points.length > 2) return pathFromPoints(points, 10); // lane-dodge polyline
  const a = points[0];
  const b = points[points.length - 1];
  // Tangent length ~45% of the vertical span: enough lazy S to read smooth when
  // the cards are offset horizontally, collapsing to a straight drop when aligned.
  const k = Math.max(1, (b.y - a.y) * 0.45);
  return (
    `M ${round(a.x)},${round(a.y)} ` +
    `C ${round(a.x)},${round(a.y + k)} ` +
    `${round(b.x)},${round(b.y - k)} ` +
    `${round(b.x)},${round(b.y)}`
  );
}

/** Build a rounded-corner SVG path through plain waypoints (interior DAG). */
export function pathFromPoints(
  points: Array<{ x: number; y: number }>,
  radius = 8,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let d = `M ${round(points[0].x)},${round(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const p1 = shorten(cur, prev, radius);
    const p2 = shorten(cur, next, radius);
    d += ` L ${round(p1.x)},${round(p1.y)}`;
    d += ` Q ${round(cur.x)},${round(cur.y)} ${round(p2.x)},${round(p2.y)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${round(last.x)},${round(last.y)}`;
  return d;
}

// --- Strand bundle curve ----------------------------------------------------
// A strand descends from its premise (threading a clear lane between cards, the
// bundling helper having chosen the lane) down to the gather band, then a cubic
// bezier eases onto the apex with a VERTICAL tangent at BOTH ends:
//   - leave the gather point going straight down  (control 1 below it)
//   - arrive at the apex going straight up         (control 2 above apex, on spine)
// so every strand merges into the spine tangentially — no hard vertex. The
// strand polyline is [premise bottom, …lane waypoints…, gather point, apex];
// the LAST point is the apex and the second-to-last is where the cubic starts.

export interface Cubic {
  p0: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  p1: { x: number; y: number };
}

/** The cubic that eases a strand from its gather point onto the apex. */
export function strandCubic(
  gather: { x: number; y: number },
  apex: { x: number; y: number },
): Cubic {
  // Tangent length: a fraction of the vertical span (HEB-style laziness ~0.55).
  const span = Math.max(1, apex.y - gather.y);
  const k = span * 0.55;
  return {
    p0: gather,
    c1: { x: gather.x, y: gather.y + k }, // straight down out of the gather pt
    c2: { x: apex.x, y: apex.y - k }, // straight up into the apex (on the spine)
    p1: apex,
  };
}

/** Full strand path: rounded lane polyline down to the gather point, then the
 *  easing cubic onto the apex. */
export function strandPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 3) {
    return pathFromPoints(points); // fallback: plain rounded polyline
  }
  const apex = points[points.length - 1];
  const gather = points[points.length - 2];
  // Lead-in: every point up to and including the gather point, rounded.
  const lead = points.slice(0, points.length - 1);
  const leadPath = pathFromPoints(lead, 6);
  const c = strandCubic(gather, apex);
  return (
    `${leadPath} ` +
    `C ${round(c.c1.x)},${round(c.c1.y)} ` +
    `${round(c.c2.x)},${round(c.c2.y)} ` +
    `${round(c.p1.x)},${round(c.p1.y)}`
  );
}

/** Point on a cubic at parameter t (de Casteljau). */
export function cubicAt(c: Cubic, t: number): { x: number; y: number } {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p1.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p1.y,
  };
}

/** Euclidean distance between two points. */
export function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function shorten(
  from: { x: number; y: number },
  toward: { x: number; y: number },
  by: number,
): { x: number; y: number } {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const t = Math.min(by, len / 2) / len;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

// Round endpoint coords to integer px so thin diagonal connectors rasterize
// deterministically (ssr-dag-flowchart-rendering.md § 3 — avoids @visual flake).
export function round(n: number): number {
  return Math.round(n);
}
