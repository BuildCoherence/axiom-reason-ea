"use client";

// The Sigma.js graph island (PROTOTYPE) — the above-the-fold hero (D5–D8).
//
// MUST be loaded via `dynamic(() => import("./profile-graph"), { ssr: false })`:
// `sigma` touches `WebGL2RenderingContext` at module-eval, so it throws if Next
// tries to render it on the server (confirmed). Everything WebGL lives here.
//
// Realizes: axioms ↔ held-proposition graph (D5), a scoped/ranked theorem slice
// passed in via `spec` (D7), neighbour-highlight on hover/selection that also
// drives the list binding (D7/D8), size-by-degree, and an eased (reduced-motion
// aware) camera fly-to when the selection changes from the list side.

import "@react-sigma/core/lib/style.css";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import {
  ControlsContainer,
  SigmaContainer,
  useLoadGraph,
  useRegisterEvents,
  useSetSettings,
  useSigma,
  ZoomControl,
} from "@react-sigma/core";
import { drawDiscNodeLabel } from "sigma/rendering";
import type { Settings } from "sigma/settings";
import type { NodeDisplayData, PartialButFor } from "sigma/types";
import { Type, TypeOutline } from "lucide-react";
import * as React from "react";

import { IslandErrorBoundary } from "@/components/island-error-boundary";
import type { GraphSpec } from "./graph-model";
import {
  applyAxiomPull,
  axiomSeedPosition,
  fa2Settings,
  heldSeedPosition,
  iterationsFor,
} from "./profile-graph-layout";
import styles from "./profile-graph.module.css";

export interface GraphColors {
  axiom: string;
  proof: string;
  projection: string;
  propositionOver: string; // over-determined held propositions
  faded: string;
  edge: string;
  /**
   * Base (non-highlighted) edge stroke width in px — theme-aware. Thin in dark
   * mode (the approved faint web); WIDER in light mode, because a thin
   * low-contrast line on the near-white background gets anti-aliased away at
   * 0.5px regardless of colour. Driven per-frame by the edge reducer so it
   * re-applies on a theme toggle.
   */
  edgeWidth: number;
  edgeHighlight: string;
  /**
   * The de-emphasised "droppable" edge colour. When the user selects an
   * OVER-DETERMINED theorem, its incident axiom edges split into essential
   * (`edgeHighlight`, the bright focus colour) and droppable (this) — droppable =
   * the axiom is absent from ≥1 of the theorem's premise-sets, so the theorem
   * still holds without it. A muted grey (`--base04`, the theme's comment/muted
   * token) so it reads as deliberately de-emphasised but stays clearly visible
   * over the dot-grid `--base00` background in both themes. Distinct from the
   * essential blue by HUE (grey vs blue) as well as by lower alpha + thinner
   * width — droppability is signalled on more than one channel (accessibility).
   * v1 stand-in for a literal dotted stroke (Sigma v3 has no dashed-edge support).
   */
  edgeDroppable: string;
  label: string;
  /**
   * Opaque fill for the pill drawn BEHIND a rendered label (`--base00`, the
   * theme background). The label text (`label`, `--base05`) is the theme
   * foreground, so the pair is the page's own fg-on-bg contrast (~13:1 both
   * modes) — the label reads against ITS OWN box, never the busy dot-grid or a
   * node behind it. Theme-aware: it flips with the rest of the tokens. Sigma's
   * stock hover renderer hardcodes a `#FFF` box, which left the (also
   * theme-foreground) text near-invisible on dark mode — the bug this fixes.
   */
  labelBg: string;
  /**
   * The distinct highlight-ring colour for axiom nodes that were premises of
   * the proof of False (`inconsistency.proof_premise_axiom_ids`, #4). The error
   * accent (`--base08`) — the same accent the inconsistency strip carries — so
   * the in-place ring reads as "premise used in the inconsistency".
   */
  ring: string;
}

export interface ProfileGraphProps {
  spec: GraphSpec;
  /** Selected node id (shared with the lists) — drives highlight + camera. */
  selectedId: string | null;
  colors: GraphColors;
  /** Animate the camera to the selection (mobile fly-to, D11). Desktop keeps the
   *  whole graph framed and dims-with-context instead, so a low-degree selection
   *  never lands on empty space. */
  flyTo: boolean;
  onNodeClick: (id: string) => void;
  onNodeHover: (id: string | null) => void;
  onBackgroundClick: () => void;
}

// Experiment (user request): hold node sizes UNIFORM per kind rather than scaling
// them by degree. Flip `SCALE_NODE_SIZE_BY_DEGREE` back to true to restore the
// hubs-grow-with-degree sizing.
const SCALE_NODE_SIZE_BY_DEGREE = false;
const sizeFor = (degree: number, kind: "axiom" | "proof" | "projection"): number => {
  if (!SCALE_NODE_SIZE_BY_DEGREE) {
    // Uniform sizes (user-tuned): axioms 12, theorem / proposition nodes 10.
    return kind === "axiom" ? 12 : 10;
  }
  // Degree scaling (disabled above): nodes grow ~sqrt(degree) off a per-kind floor
  // so high-degree hubs stand out (the `sqrt(degree)` multipliers set how steeply).
  const base = kind === "axiom" ? 8 : 5;
  return base + Math.sqrt(degree) * (kind === "axiom" ? 3.2 : 2.2);
};

// --- Theme-aware, high-contrast label rendering ----------------------------
//
// WHY custom renderers: Sigma's stock `drawDiscNodeHover` paints the label box
// hardcoded `#FFF` and only on the *hovered* node, while every other rendered
// label (the `forceLabel` neighbours/axioms from the reducer) gets NO box and
// sits raw on the dot-grid. With our `labelColor` = `--base05` (the theme
// foreground), the hover box was white-on-near-white in light mode and the
// dark-mode label was near-white text on that same white box → both failed
// WCAG AA. The fix: draw EVERY label inside an opaque rounded pill filled with
// `--base00` (theme background) behind `--base05` text — the page's own
// fg-on-bg pairing (~13:1 both modes) — so legibility never depends on what is
// behind the node. Theme-aware because both colours come from `useGraphColors`.

const LABEL_BOX_PADDING_X = 4;
const LABEL_BOX_PADDING_Y = 2;
const LABEL_BOX_RADIUS = 3;

// Draw a rounded, opaque pill behind a node label so the text reads against its
// own background. Mirrors stock `drawDiscNodeLabel`'s text placement (anchored
// to the right of the node disc) so positions are unchanged — we only add a box.
function drawLabelBox(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, "x" | "y" | "size" | "label" | "color">,
  settings: Settings,
  bg: string,
): void {
  if (typeof data.label !== "string" || data.label === "") return;
  const size = settings.labelSize;
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  const textWidth = context.measureText(data.label).width;
  // Stock text origin: (x + size + 3, y + size/3). Box wraps that text.
  const textX = data.x + data.size + 3;
  const boxX = textX - LABEL_BOX_PADDING_X;
  const boxY = data.y - size / 2 - LABEL_BOX_PADDING_Y;
  const boxW = textWidth + LABEL_BOX_PADDING_X * 2;
  const boxH = size + LABEL_BOX_PADDING_Y * 2;
  context.fillStyle = bg;
  context.beginPath();
  // roundRect is supported in all browsers we target; guard anyway so a missing
  // impl degrades to a square box rather than throwing.
  if (typeof context.roundRect === "function") {
    context.roundRect(boxX, boxY, boxW, boxH, LABEL_BOX_RADIUS);
  } else {
    context.rect(boxX, boxY, boxW, boxH);
  }
  context.fill();
}

// Factory: a label renderer that paints the opaque `--base00` pill, then defers
// to stock text drawing (which uses `settings.labelColor` = `--base05`). Used
// for BOTH `defaultDrawNodeLabel` (forced neighbour/axiom labels) and
// `defaultDrawNodeHover` (the hovered node) so every visible label looks the
// same and stays high-contrast — replacing the stock hover's white box + shadow.
function makeDrawLabel(
  colors: GraphColors,
): Settings["defaultDrawNodeLabel"] {
  return (context, data, settings) => {
    drawLabelBox(context, data, settings, colors.labelBg);
    drawDiscNodeLabel(context, data, settings);
  };
}

function GraphLoader({ spec, colors }: { spec: GraphSpec; colors: GraphColors }) {
  const loadGraph = useLoadGraph();
  const sigma = useSigma();

  React.useEffect(() => {
    const graph = new Graph();

    const axioms = spec.nodes.filter((n) => n.kind === "axiom");
    // Held nodes = theorem (proof) + proposition (over-determined holding) nodes
    // (D29) — both laid out on the outer annulus; proposition nodes take the third
    // (propositionOver) colour via their `overDetermined` flag.
    const held = spec.nodes.filter((n) => n.kind !== "axiom");

    // Seed positions: axioms in a small CENTRAL disk (they're the roots the
    // theorems hang off — central reads as "everything derives from these"),
    // theorems on an outer annulus so their edges pull them inward toward their
    // axioms. The force layout relaxes from this; axioms are high-degree, so they
    // carry more FA2 gravity mass and `outboundAttractionDistribution` favours
    // authorities centrally — the forces keep them central rather than drifting
    // back out to a ring.
    axioms.forEach((node, i) => {
      const seed = axiomSeedPosition(i);
      graph.addNode(node.id, {
        x: seed.x,
        y: seed.y,
        size: sizeFor(node.degree, "axiom"),
        color: colors.axiom, // base colour is (re)applied by the reducer
        label: node.label,
        kind: "axiom",
        overDetermined: false,
        // #4: premise-of-False axioms carry a distinct highlight ring (applied
        // by the reducer as a coloured halo). Threaded from the GraphSpec node.
        proofPremise: node.proofPremise,
      });
    });
    held.forEach((node, i) => {
      const seed = heldSeedPosition(i);
      graph.addNode(node.id, {
        x: seed.x,
        y: seed.y,
        size: sizeFor(node.degree, "proof"),
        // Proposition nodes (over-determined holdings) take the third colour;
        // virtual projection nodes take the projection colour.
        color: node.kind === "projection" ? colors.projection : node.overDetermined ? colors.propositionOver : colors.proof,
        label: node.label,
        kind: node.kind,
        overDetermined: node.overDetermined,
        proofPremise: false, // proof-premise ring is axiom-only (#4)
      });
    });
    spec.edges.forEach((e) => {
      if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.id)) {
        // `droppable` is the STATIC per-edge attribute (graph-model.ts): the axiom
        // is absent from ≥1 of the theorem's premise-sets. The edge reducer reads
        // it to split essential vs droppable when the theorem is selected.
        graph.addEdgeWithKey(e.id, e.source, e.target, {
          color: colors.edge,
          size: colors.edgeWidth,
          droppable: e.droppable,
        });
      }
    });

    // Show the seed immediately, then run ForceAtlas2 in animation-frame BATCHES
    // rather than one synchronous pass. The dev bundle's FA2 is ~20× slower than
    // prod, so a blocking full layout freezes the tab for seconds; batching keeps
    // the UI responsive and the graph visibly settles. loadGraph imports a COPY
    // into sigma, so we lay out on sigma's own graph and refresh each batch.
    loadGraph(graph);
    if (graph.order === 0) return;

    const g = sigma.getGraph();
    // Shared FA2 settings (profile-graph-layout) so the OG card lays out the same
    // graph; see that module for the tuning rationale (central axioms, clean
    // convergence).
    const settings = fa2Settings(g);
    // `total` is now only a SAFETY cap — we stop early on convergence (below), so
    // a settled graph doesn't keep jiggling through its whole iteration budget.
    const total = iterationsFor(g.order);
    const batch = 2;
    const minIterations = 16; // let the seed expand before judging convergence
    let done = 0;
    let raf = 0;
    let cancelled = false;
    let peakMovement = 0;
    // Mean per-node displacement over the last batch, in layout units.
    const meanMovement = (prev: Record<string, { x: number; y: number }>): number => {
      let sum = 0;
      let n = 0;
      g.forEachNode((node, attrs) => {
        const p = prev[node];
        if (p) {
          sum += Math.hypot((attrs.x as number) - p.x, (attrs.y as number) - p.y);
          n += 1;
        }
      });
      return n ? sum / n : 0;
    };
    const tick = () => {
      if (cancelled) return;
      const prev: Record<string, { x: number; y: number }> = Object.create(null);
      g.forEachNode((node, attrs) => {
        prev[node] = { x: attrs.x as number, y: attrs.y as number };
      });
      forceAtlas2.assign(g, { iterations: batch, settings });
      // Radial bias toward the centre for AXIOMS only — pure FA2 can't centralise
      // hubs, so each batch nudges every axiom a fixed fraction toward the origin
      // (shared with the OG card; see profile-graph-layout for the full rationale).
      applyAxiomPull(g);
      sigma.refresh();
      done += batch;
      // Stop once the layout has SETTLED: mean motion has decayed to a small
      // fraction of its peak. This ends the animation when nodes effectively
      // stop moving, rather than burning the full budget on invisible nudges.
      const moved = meanMovement(prev);
      peakMovement = Math.max(peakMovement, moved);
      const settled = done >= minIterations && moved < peakMovement * 0.04;
      if (done < total && !settled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // `colors` excluded: layout is colour-independent; the reducer recolours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, loadGraph, sigma]);

  return null;
}

function GraphController({
  selectedId,
  colors,
  flyTo,
  graphEpoch,
  showLabels,
  onNodeClick,
  onNodeHover,
  onBackgroundClick,
}: Omit<ProfileGraphProps, "spec"> & { graphEpoch: number; showLabels: boolean }) {
  const sigma = useSigma();
  const registerEvents = useRegisterEvents();
  const setSettings = useSetSettings();
  const [hovered, setHovered] = React.useState<string | null>(null);

  React.useEffect(() => {
    registerEvents({
      clickNode: (e) => onNodeClick(e.node),
      enterNode: (e) => {
        setHovered(e.node);
        onNodeHover(e.node);
      },
      leaveNode: () => {
        setHovered(null);
        onNodeHover(null);
      },
      clickStage: () => onBackgroundClick(),
    });
  }, [registerEvents, onNodeClick, onNodeHover, onBackgroundClick]);

  // Reset a stale hover when the graph is rebuilt (slider): leaveNode never
  // fires for a node that was just removed, so the old hovered id would linger
  // and (without the activeFocus guard below) blank the new graph.
  React.useEffect(() => {
    setHovered(null);
  }, [graphEpoch]);

  // Neighbour-highlight (D7): dim everything not adjacent to the focus node, and
  // apply base colours here (so a colour change needs no relayout). `activeFocus`
  // GUARDS against a focus id absent from the current graph slice (selecting a
  // below-the-slider theorem from the list) — without it the reducers would fade
  // EVERY node and hide EVERY edge, blanking the hero.
  const focus = hovered ?? selectedId;
  React.useEffect(() => {
    const graph = sigma.getGraph();
    const activeFocus = focus && graph.hasNode(focus) ? focus : null;
    // The node actually under the MOUSE this frame, guarded to the current
    // slice. DISTINCT from `activeFocus`, which falls back to the pinned
    // `selectedId`: the labels-off gate (below) must follow the live hover, not
    // a selection, so pointing away hides the label even while a list item stays
    // selected. (When the user IS hovering, `focus === hovered` so the two
    // coincide; they only diverge when nothing is hovered.)
    const activeHovered = hovered && graph.hasNode(hovered) ? hovered : null;
    // A focus node with NO neighbours in the current slice STILL focuses: its
    // `highlightSet` is just {itself}, so every other node fades and (since no
    // edge is incident to it) every edge hides — the focused node alone stays
    // bright. Only an ABSENT focus id leaves the whole graph bright, and that is
    // guarded by `activeFocus` above (a focus not in the slice → `activeFocus`
    // is null → this block is skipped). So "nothing hovered/selected" (default,
    // everything bright) is distinguished from "focus on an unconnected node"
    // (dim everything but the focus) purely by whether `activeFocus` is set.
    // 2-HOP highlight for a PROPOSITION focus (D29): a proposition node connects
    // only to its theorem (proof) nodes, so a 1-hop highlight stops there — hiding
    // the axioms each proof rests on. When the focus is a proposition, extend the
    // highlighted set a second hop (through the theorems to their premise axioms),
    // so selecting an over-determined holding lights up its whole proof forest.
    // Other node kinds keep the 1-hop highlight (`highlightSet === neighbors + self`).
    const focusIsProp =
      activeFocus != null &&
      graph.getNodeAttribute(activeFocus, "kind") === "proposition";
    const highlightSet = activeFocus
      ? new Set<string>([activeFocus, ...graph.neighbors(activeFocus)])
      : null;
    if (focusIsProp && highlightSet) {
      for (const thm of graph.neighbors(activeFocus)) {
        for (const ax of graph.neighbors(thm)) highlightSet.add(ax);
      }
    }
    const baseColor = (d: { kind?: string; overDetermined?: boolean }): string =>
      d.kind === "axiom"
        ? colors.axiom
        : d.kind === "projection"
          ? colors.projection
          : d.overDetermined
            ? colors.propositionOver
            : colors.proof;
    setSettings({
      nodeReducer: (node, data) => {
        const d = data as {
          kind?: string;
          overDetermined?: boolean;
          proofPremise?: boolean;
          label?: string;
        };
        const res = { ...data } as typeof data & {
          color?: string;
          label?: string;
          highlighted?: boolean;
          forceLabel?: boolean;
          zIndex?: number;
        };
        res.color = baseColor(d);
        // #4: premise-of-False ring. Sigma draws a coloured halo behind a
        // `highlighted` node; colouring it with the error accent reads as a
        // distinct ring. This is a persistent STATE (the inconsistency strip is
        // non-dismissible), so it takes precedence over both the focus-fade and
        // the base colour: a proof-premise axiom keeps its ring even when it is
        // not adjacent to the current focus node, and renders even when it sits
        // below the slice (axioms always render — graph-model.ts).
        const ringed = d.proofPremise === true;
        if (ringed) {
          res.color = colors.ring;
          res.highlighted = true;
          res.zIndex = 2;
        }
        // Focus highlight / fade. Rewritten from early-returns to a single
        // fall-through (one exit) so the labels gate below can post-process
        // EVERY node's label uniformly without being skipped by an early return.
        if (activeFocus) {
          if (node === activeFocus) {
            res.highlighted = true;
            res.forceLabel = true;
            res.zIndex = 2;
          } else if (highlightSet?.has(node)) {
            res.forceLabel = d.kind === "axiom";
            res.zIndex = 1;
          } else if (!ringed) {
            // Non-neighbours fade — EXCEPT a ringed proof-premise node, which
            // keeps its ring as a persistent in-place marker. An unconnected
            // focus has only itself in `highlightSet`, so EVERY other node lands
            // here and fades, leaving the focus node alone bright.
            res.color = colors.faded;
            res.label = "";
            res.zIndex = 0;
          }
        }
        // --- LABELS ON/OFF gate -------------------------------------------------
        // `showLabels === false` hides EVERY node label except the one under the
        // mouse. We gate HERE in the reducer rather than flipping the global
        // `renderLabels` for a concrete reason: the hovered node's label box is
        // painted by `defaultDrawNodeHover` from this node's POST-reducer display
        // data, on a SEPARATE (hover) canvas — drawing whatever `label` we emit
        // here. So keeping the hovered node's `label` keeps its hover label alive,
        // while every other node's label (the forced neighbour/axiom labels above
        // AND Sigma's density-driven auto-labels) is suppressed by emitting an
        // empty `label` + `forceLabel: false`. We key on the live mouse-HOVER
        // (`activeHovered`), NOT the pinned `selectedId`/`focus`: in labels-off
        // mode a list selection alone shows no label — only the node you point at.
        // (`renderLabels` stays true so the labels-ON branch keeps its current
        // density-driven + forced labels exactly as before.)
        if (!showLabels) {
          if (node === activeHovered) {
            res.label = d.label ?? "";
            res.forceLabel = true;
          } else {
            res.label = "";
            res.forceLabel = false;
          }
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const res = { ...data } as typeof data & {
          color?: string;
          size?: number;
          hidden?: boolean;
          zIndex?: number;
        };
        res.color = colors.edge;
        // Theme-aware base width (wider in light so the lines read on white);
        // re-applies every frame, so it tracks a light↔dark toggle. The highlight
        // branches below override it for focused edges.
        res.size = colors.edgeWidth;
        if (!activeFocus) return res;
        const [s, t] = graph.extremities(edge); // s = theorem (source), t = axiom/prop
        // Show edges incident to the focus, AND — for a proposition focus — the
        // second-hop proof→axiom edges (both endpoints in the 2-hop set).
        const incidentToFocus = s === activeFocus || t === activeFocus;
        const inTwoHop =
          focusIsProp &&
          highlightSet !== null &&
          highlightSet.has(s) &&
          highlightSet.has(t);
        if (incidentToFocus || inTwoHop) {
          // Essential vs droppable split — ONLY when the focus node is BOTH the
          // SELECTED node (not a transient hover) AND the THEOREM end of this
          // edge (`s`, the source). Droppability is a theorem-relative judgement:
          // muting an axiom's own edges when an axiom is selected would miscue
          // "this axiom is weak", so we never mute on an axiom selection or hover.
          // `droppable` is precomputed per edge (graph-model.ts buildGraphSpec).
          const droppableEdge =
            (data as { droppable?: boolean }).droppable === true;
          const theoremSelected = activeFocus === selectedId && s === selectedId;
          if (theoremSelected) {
            // Essential vs droppable split view. The two have to read apart at a
            // glance, so push the contrast HARD on WIDTH (the dominant cue) plus
            // alpha + hue: essential edges go thick + bright blue, droppable go
            // thin + faint grey. (A grey-at-mid-alpha vs the muted-blue highlight
            // was imperceptible at near-equal thin widths — base0D and base04 sit
            // at almost the same luminance.) The thick essential is scoped to
            // THIS view only; the general hover/axiom-select highlight below
            // stays at the normal 1.4 so ordinary highlights aren't chunky.
            if (droppableEdge) {
              res.color = colors.edgeDroppable;
              res.size = 0.8;
            } else {
              res.color = colors.edgeHighlight;
              res.size = 2.8;
            }
            res.zIndex = 1;
          } else {
            // General highlight (axiom-end focus or a transient hover): the
            // existing bright focus at the standard width.
            res.color = colors.edgeHighlight;
            res.size = 1.4;
            res.zIndex = 1;
          }
        } else {
          res.hidden = true;
        }
        return res;
      },
      // labelColor + the custom label/hover renderers live here (not in the
      // static SigmaContainer settings) so a colour change re-applies via
      // setSettings without recreating the instance. The renderers draw an
      // opaque `--base00` pill behind the `--base05` text, so every rendered
      // label (forced neighbours/axioms AND the hovered node) is legible
      // against its own box in both themes — see makeDrawNodeLabel.
      labelColor: { color: colors.label },
      defaultDrawNodeLabel: makeDrawLabel(colors),
      defaultDrawNodeHover: makeDrawLabel(colors),
    });
    // graphEpoch: re-register the reducers against the rebuilt graph after a
    // slider change, so a held selection's neighbour Set isn't stale.
    // selectedId: the edge reducer's essential/droppable split keys off the
    // SELECTED node (vs a transient hover), so it must re-apply on a selection
    // change even when `focus` is pinned to an active hover.
    // hovered: read directly by the labels-off gate (`activeHovered`) so the
    // hovered node's label is the only one kept; re-apply as the hover moves.
    // showLabels: toggling it must re-apply the reducer so the label gate flips
    // (same re-apply-via-setSettings pattern the colour change above relies on).
  }, [focus, hovered, selectedId, sigma, setSettings, colors, graphEpoch, showLabels]);

  // Eased camera fly-to — mobile only (D11). On desktop the whole graph stays
  // framed (dim-with-context), so a low-degree selection never blanks. Keyed on
  // graphEpoch too, so when the slider brings a list-selected node into the
  // slice the camera flies to it then.
  React.useEffect(() => {
    if (!selectedId || !flyTo) return;
    const graph = sigma.getGraph();
    if (!graph.hasNode(selectedId)) return;
    const display = sigma.getNodeDisplayData(selectedId);
    if (!display) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ratio = Math.min(sigma.getCamera().getState().ratio, 0.8);
    sigma.getCamera().animate(
      { x: display.x, y: display.y, ratio },
      { duration: reduce ? 0 : 450 },
    );
  }, [selectedId, sigma, flyTo, graphEpoch]);

  return null;
}

// --- Camera-coupled dot-grid background ------------------------------------
//
// The hero's dot grid must PAN AND ZOOM WITH THE GRAPH — a fixed scale relative
// to the nodes — mirroring the theorem page, where the grid is React Flow's
// <Background>. We render the SAME primitive React Flow uses: an SVG <pattern>
// of one vector dot, tiled by the browser. Sigma draws nodes on a transparent
// WebGL canvas, so the SVG sits on a layer behind it and DotGridLayer drives the
// pattern's tile size + offset and the dot radius from the camera every frame
// (the infinite-canvas trick — React Flow / Figma / tldraw — of a screen
// `gap = base / cameraRatio` ≡ a constant graph-space spacing × zoom, plus an
// origin-anchored modulo offset so the dots stay pinned to graph coords as you
// pan). A vector circle antialiases cleanly at any sub-pixel radius, so the dots
// scale and fade smoothly with NO raster-tiling moiré — the failure of the first
// CSS `radial-gradient` + `background-size` version, whose sub-pixel tiles made
// the dot-to-gap ratio wander as you zoomed out. (The ORIGINAL static `.dot-grid`
// was worse: a fixed SCREEN-space pattern that neither scaled nor panned, reading
// as a too-prominent overlay the graph slid across.)

// On-screen dot spacing at the framed default (camera ratio 1), in px — the
// theorem page's React Flow <Background> uses 20. The grid scales as
// gap = GRID_GAP_PX / ratio (ratio is Sigma's INVERSE zoom): a constant
// graph-space lattice (so the dots stay fixed relative to the nodes), derived
// from the camera ratio rather than the graph's coordinate span so it's strictly
// monotonic in zoom and can't flicker as ForceAtlas2's coordinate scale jitters.
const GRID_GAP_PX = 20;
// Dot radius as a fraction of the on-screen gap, so the pattern scales uniformly
// with zoom (the theorem page's 1px dot / 20px gap = 0.05) ...
const GRID_DOT_RADIUS_RATIO = 0.05;
// ... but capped so the dot can't balloon to node-size when zoomed far in. The
// theorem page tops out near 2px because its zoom-in is capped at 2×; we keep
// deep zoom-in but bound the dot instead. (No floor — far out it shrinks toward
// zero so the grid simply fades, as on the theorem page.)
const GRID_DOT_MAX_PX = 2;

// Drives the SVG dot <pattern> in lockstep with the Sigma camera. Renders
// nothing; it only writes geometry attributes onto the <pattern> and its <circle>
// (the tile size/offset and the dot radius) behind the canvas.
function DotGridLayer({
  patternRef,
  circleRef,
  graphEpoch,
}: {
  patternRef: React.RefObject<SVGPatternElement | null>;
  circleRef: React.RefObject<SVGCircleElement | null>;
  graphEpoch: number;
}) {
  const sigma = useSigma();
  React.useEffect(() => {
    const pattern = patternRef.current;
    const circle = circleRef.current;
    if (!pattern || !circle) return;
    const camera = sigma.getCamera();
    // JS `%` is remainder, not modulo: anchor offsets need a non-negative result
    // or the grid jumps a tile when the origin sits at negative screen coords.
    const mod = (a: number, n: number) => ((a % n) + n) % n;
    let raf = 0;
    const paint = () => {
      raf = 0;
      // Inverse zoom: ratio 1 = framed default, >1 zoomed out, <1 zoomed in.
      const ratio = camera.getState().ratio;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      // Screen gap = base / ratio — a fixed graph-space lattice (dots fixed
      // relative to the nodes) that scales like React Flow's <Background>
      // (gap × zoom). Computed from the camera ratio, NOT the graph's coordinate
      // span, so it's strictly monotonic in zoom and immune to the ForceAtlas2
      // scale jitter that made the span-based version flicker dense/blank between
      // adjacent zoom levels.
      const gap = GRID_GAP_PX / ratio;
      if (!Number.isFinite(gap) || gap <= 0) return;
      // Dot radius tracks the gap (uniform zoom → constant dot:gap ratio) but is
      // capped so it can't grow to node-size when zoomed far in; far out it
      // shrinks toward zero and the grid fades out smoothly. SVG draws fractional
      // radii cleanly, so no raster floor/moiré on the way down.
      const r = Math.min(gap * GRID_DOT_RADIUS_RATIO, GRID_DOT_MAX_PX);
      // Tile = the screen gap; offset the pattern's tiling origin to the graph
      // origin so the dots pan with the graph (no rounding needed — SVG handles
      // fractional coordinates without shimmer).
      const origin = sigma.graphToViewport({ x: 0, y: 0 });
      pattern.setAttribute("width", `${gap}`);
      pattern.setAttribute("height", `${gap}`);
      pattern.setAttribute("x", `${mod(origin.x, gap)}`);
      pattern.setAttribute("y", `${mod(origin.y, gap)}`);
      circle.setAttribute("cx", `${gap / 2}`);
      circle.setAttribute("cy", `${gap / 2}`);
      circle.setAttribute("r", `${r}`);
    };
    // The camera emits "updated" on every pan/zoom frame; afterRender also covers
    // layout-driven node motion (FA2 settling). Coalesce all triggers into one
    // rAF so we touch the DOM at most once per displayed frame.
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    camera.on("updated", schedule);
    sigma.on("afterRender", schedule);
    sigma.on("resize", schedule);
    schedule();
    return () => {
      camera.off("updated", schedule);
      sigma.off("afterRender", schedule);
      sigma.off("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sigma, patternRef, circleRef, graphEpoch]);
  return null;
}

// The three shared zoom controls reuse the THEOREM page's icons verbatim — the
// exact `@xyflow/react` Controls glyphs (Plus / Minus / FitView, copied from
// `@xyflow/react/dist/esm/.../Controls/Icons`) — so the profile graph's
// zoom-in / zoom-out / center buttons render identically to the theorem-page
// flowchart. They're passed as `ZoomControl`'s children, which keeps @react-
// sigma's camera wiring (zoomIn / zoomOut / reset). `fill="currentColor"` lets
// them inherit the `.react-sigma-control` button colour; `width:1em` (no height)
// preserves each glyph's native aspect ratio (the minus is a wide, short bar).
const rfIconStyle: React.CSSProperties = { width: "1em", fill: "currentColor" };
const RfZoomInIcon = () => (
  <svg viewBox="0 0 32 32" style={rfIconStyle} aria-hidden>
    <path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" />
  </svg>
);
const RfZoomOutIcon = () => (
  <svg viewBox="0 0 32 5" style={rfIconStyle} aria-hidden>
    <path d="M0 0h32v4.2H0z" />
  </svg>
);
const RfFitViewIcon = () => (
  <svg viewBox="0 0 32 30" style={rfIconStyle} aria-hidden>
    <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
  </svg>
);

// --- WebGL availability + graceful degradation ------------------------------
//
// Sigma v3 does NOT null-check the context it acquires: `createWebGLContext`
// tries webgl2 → webgl → experimental-webgl and then unconditionally calls
// `gl.blendFunc(...)`, so when every `canvas.getContext()` attempt returns
// null (hardware acceleration off, GPU driver blocklist, remote-desktop/VDI
// sessions, per-page WebGL context exhaustion) the `Sigma` constructor throws
// `TypeError: Cannot read properties of null (reading 'blendFunc')`. Left
// unhandled, that bubbles into the route-level error.tsx and blanks the WHOLE
// profile page — for a hero whose data the lists already cover ("the lists are
// the keyboard-operable equivalent"). So: probe WebGL BEFORE mounting
// SigmaContainer and degrade to <GraphUnavailable>, and wrap the island in its
// own error boundary as a backstop for any other renderer crash (e.g. the
// probe context succeeding but Sigma's later per-layer contexts failing).
function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    // Mirror Sigma's own acquisition order so the probe answers the exact
    // question "would Sigma get a context?".
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    // Release the probe context immediately: Sigma is about to create several
    // real contexts and browsers cap live WebGL contexts per page (~16).
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    // Some browsers/policies throw from getContext instead of returning null.
    return false;
  }
}

// Static hero fallback when the WebGL graph can't render. The workbench stays
// fully usable — the lists and panels carry everything the graph shows — so
// this only has to hold the hero space and say why the graph is absent.
function GraphUnavailable() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[var(--base00)] px-6 text-center">
      <p className="text-sm font-medium text-foreground">
        The interactive graph isn&apos;t available in this browser.
      </p>
      <p className="text-sm text-muted-foreground">
        It needs WebGL, which appears to be disabled or unsupported here. The
        axiom and theorem lists cover everything the graph shows.
      </p>
    </div>
  );
}

export default function ProfileGraph(props: ProfileGraphProps) {
  const { spec, colors, ...controller } = props;
  const patternRef = React.useRef<SVGPatternElement | null>(null);
  const circleRef = React.useRef<SVGCircleElement | null>(null);
  // Labels on/off — LOCAL to the graph (default ON). When OFF, GraphController's
  // nodeReducer keeps only the HOVERED node's label (the label gate); flipping
  // this re-applies the reducer via that effect's dependency. Kept here (not in
  // GraphController) because the toggle button lives in the controls card below,
  // so both the button and the reducer read the same single source of truth.
  const [showLabels, setShowLabels] = React.useState(true);
  // useId can contain ":" — invalid in an SVG id / url(#…) — so strip to alnum.
  const patternId = `dotgrid-${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const graphEpoch = spec.nodes.length + spec.edges.length;
  // Probed once on mount (lazy initializer; this island is ssr:false so the
  // DOM is always present). AFTER the hooks above — rules of hooks — and
  // before any Sigma code runs, so an unsupported browser never constructs a
  // Sigma instance at all.
  const [webglAvailable] = React.useState(isWebGLAvailable);
  if (!webglAvailable) return <GraphUnavailable />;
  return (
    // Backstop boundary: the probe above covers the known null-context crash,
    // but any OTHER throw during Sigma setup/render (per-layer context loss,
    // shader compile failure) must also degrade in place, never to error.tsx.
    <IslandErrorBoundary fallback={<GraphUnavailable />} logLabel="profile-graph">
    {/* Opaque `--base00` covers the parent container's static `.dot-grid`
        (loading-state backdrop). The SVG dot grid sits behind the transparent
        Sigma canvas; pointer-events-none keeps every click going to the canvas. */}
    <div className="relative h-full w-full bg-[var(--base00)]">
      {/* Camera-coupled dot grid as an SVG <pattern> — the primitive React
          Flow's <Background> uses: one vector dot tiled by the browser (clean
          sub-pixel antialiasing, no raster moiré). DotGridLayer drives the tile
          size/offset + dot radius to pan + zoom with the camera. */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <pattern
            ref={patternRef}
            id={patternId}
            patternUnits="userSpaceOnUse"
            width={GRID_GAP_PX}
            height={GRID_GAP_PX}
          >
            <circle
              ref={circleRef}
              cx={GRID_GAP_PX / 2}
              cy={GRID_GAP_PX / 2}
              r={GRID_GAP_PX * GRID_DOT_RADIUS_RATIO}
              style={{ fill: "var(--dot-color)" }}
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <SigmaContainer
        className="relative h-full w-full"
        style={{ height: "100%", width: "100%", background: "transparent" }}
        settings={{
        // Colour-INDEPENDENT so a colour change (fallback → resolved tokens on
        // mount) doesn't deep-compare-unequal and force @react-sigma to kill +
        // recreate the Sigma instance (which would re-run the layout). All real
        // colours are applied per-node/edge by the reducers (+ labelColor via
        // setSettings); these defaults only colour the first frame.
        // Tolerate a momentarily 0-height container during mount (the workbench
        // flex + dynamic-import + mounted-gate can race a frame). Without this,
        // Sigma THROWS on a 0-height container, which trips the route error
        // boundary and permanently blanks the page; with it, Sigma warns and
        // renders once the container resolves its height.
        allowInvalidContainer: true,
        renderLabels: true,
        labelRenderedSizeThreshold: 9,
        labelDensity: 0.6,
        labelGridCellSize: 70,
        defaultNodeColor: "#9aa0ad",
        defaultEdgeColor: "#434c5e",
        zIndex: true,
        minCameraRatio: 0.05,
        // Allow zooming WAY out (the graph can shrink to a tiny cluster, like the
        // theorem page's minZoom 0.2 ≈ 5× out); the camera-coupled dot grid scales
        // uniformly with the camera and simply fades out as it recedes.
        maxCameraRatio: 10,
      }}
    >
      <GraphLoader spec={spec} colors={colors} />
      <GraphController
        {...controller}
        colors={colors}
        graphEpoch={graphEpoch}
        showLabels={showLabels}
      />
      <DotGridLayer patternRef={patternRef} circleRef={circleRef} graphEpoch={graphEpoch} />
      {/* Graph controls — zoom in / zoom out / center (@react-sigma's ZoomControl,
          its icons overridden with the theorem page's @xyflow Controls glyphs)
          plus a LABELS on/off toggle, mirroring the theorem page's flowchart
          controls: a BOTTOM-LEFT card of evenly-gapped rounded squares (same
          corner as the theorem-page Controls). Themed from base16 tokens in
          profile-graph.module.css. Must be a child of SigmaContainer so
          ZoomControl reaches the Sigma camera. */}
      <ControlsContainer position="bottom-left" className={styles.controls}>
        {/* Pass the theorem page's Plus / Minus / FitView icons as ZoomControl's
            three children (zoom-in, zoom-out, center) so the shared controls match
            it exactly; ZoomControl still drives the Sigma camera. */}
        <ZoomControl labels={{ zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Center" }}>
          <RfZoomInIcon />
          <RfZoomOutIcon />
          <RfFitViewIcon />
        </ZoomControl>
        {/* Labels toggle (replaces the theorem page's minimap button). Default ON;
            OFF hands the work to the reducer's label gate (only the hovered node
            keeps its label). Wrapped in the same `.react-sigma-control` cell the
            ZoomControl uses so it inherits the identical button styling. `Type`
            (solid) = labels visible, `TypeOutline` (hollow) = hidden; the title +
            aria-pressed carry the state for assistive tech. */}
        <div className="react-sigma-control">
          <button
            type="button"
            onClick={() => setShowLabels((v) => !v)}
            title={showLabels ? "Hide labels" : "Show labels"}
            aria-label={showLabels ? "Hide labels" : "Show labels"}
            aria-pressed={showLabels}
          >
            {showLabels ? <Type size={14} /> : <TypeOutline size={14} />}
          </button>
        </div>
      </ControlsContainer>
    </SigmaContainer>
    </div>
    </IslandErrorBoundary>
  );
}
