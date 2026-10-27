"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "vaul";

import { useIsMobile } from "@/hooks/use-is-mobile";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SidePanel } from "@/components/lean-ui/side-panel";
import { PropositionPanel } from "@/components/lean-ui/proposition-panel";
import { useSelection } from "@/components/lean-ui/use-selection";
import { useDefData } from "@/components/lean-ui/use-def-data";
import { usePropData } from "@/components/lean-ui/use-prop-data";
import { useTheme } from "@/components/theme/theme-provider";
import { HoldersModal } from "@/components/theorem-flowchart/holders-modal";
import type { DrillInRequest } from "@/components/theorem-flowchart/types";
import type {
  Decl,
  TokenTreePair,
  ViewChoice,
} from "@/components/lean-ui/types";
import { Timestamp } from "@/components/ui/timestamp";

import { buildGraphSpec, isStructuralProjectionItem, sliceForGraphCount } from "./graph-model";
import type { GraphNode } from "./graph-model";
import { ProfileLists } from "./profile-lists";
import { useControlsSheetLock } from "./use-controls-sheet-lock";
import { FALLBACK_COLORS, graphColorsFor } from "./profile-graph-colors";
// Type-only — `GraphColors` lives in the ssr:false WebGL island; a type import
// is erased at compile time, so it never pulls `sigma` into the server bundle.
import type { GraphColors } from "./profile-graph";

// User profile page body — the assembled WORKBENCH (D8): one selection drives
// the docked lists, the force-directed graph hero, and the inspection panel
// together. Folds the prototype's `profile-prototype.tsx` onto the REAL route +
// the profile payload `data/u/<name>.json`. Mirrors the file page's
// `CeFileBody` machinery for the panel fetch, but composes a flat resizable
// group rather than nesting under `LeanUIShell` (D23: nesting collapsed the
// WebGL container's definite height).
//
// LAYOUT (user-profile-page.md § "The workbench surface"):
//   - Desktop — a single horizontal `ResizablePanelGroup`
//     `[ docked lists | graph hero | inspection panel ]`; the panel pane opens
//     on selection. The inconsistency strip (when present) is pinned full-width
//     ABOVE the graph (base08, non-dismissible).
//   - Mobile — the graph is the full-bleed hero; the lists live in a non-modal
//     `vaul` bottom sheet (D11) that peeks a summary and expands; the inspection
//     panel is the Lean-UI panel's OWN modal bottom sheet (rendered as a
//     sibling — it reads `useIsMobile` internally).
//
// SELECTION — the unified `?def=` / `?prop=` axes (`useSelection`, T8). A
// selection is mutually exclusive: `selectedDefId != null` renders the def
// `SidePanel`; `selectedPropId != null` renders the `PropositionPanel`. Both
// panels share ONE drill-down stack (Back / Forward walk it across both axes).
//
// THE GRAPH IS FED FROM `held_propositions.graph_slice` (top-1000 by engagement,
// INDEPENDENT of the paginated list), NOT the list items. The graph_slice item
// is a full held-proposition row (see `GraphSliceItem`), widened from the old
// minimal node+edge datum — not a frozen contract. The popularity slider scopes
// WITHIN that slice. The inconsistency's
// `proof_premise_axiom_ids` (DEF_IDS) are passed into the graph so the
// premise-of-False axiom nodes carry a distinct highlight ring — and those nodes
// render even if below the slice (axioms always render).

// --- Wire-shape types (mirrored from the API response) ---------------------
//
// The profile payload `data/u/<name>.json` shape (user-profile-page.md
// § "Public API > Response shape (200)"). The v1 `theorems[]` field +
// `ProfileTheorem` type are gone — replaced by the cursor-paginated
// `held_propositions` set (the `?prop=` unit); axioms gain per-axiom
// `holders`/`rejecters`; `inconsistency` gains `proof_premise_axiom_ids`.
// Field names are snake_case to match the backend contract (T7) 1:1.

/**
 * One axiom row — the real `Decl` envelope (clickable name + per-token
 * proposition) plus the refresh aggregate counts (D14): `holders` (the
 * Holding count) and `rejecters` (holders of its negation; emitted as `0`,
 * not null, on the axiom path — see the contract decision).
 */
export interface ProfileAxiom extends Decl {
  holders: number;
  rejecters: number;
  acknowledgements: { acknowledged_undecided: number };
  /**
   * (D28) The proposition this axiom asserts — an axiom IS a proposition, so the
   * def panel grafts its Adoption / Supports / Equivalences off this. An axiom has
   * no entailment certificate, so the generic defs read can't supply
   * `conclusion_prop`; the composer already resolves this id for the row's
   * holder/rejecter counts, so the profile passes it to the panel as a hint.
   */
  proposition_id: string;
}

export interface ProfileAxioms {
  def_id: string;
  file_id: string;
  timestamp: number;
  axioms: ProfileAxiom[];
  /**
   * Home-file source, keyed by `file_id` — one entry per distinct FILE (axioms
   * sharing a file share one entry, killing the prior per-`def_id`
   * duplication). Drives the author-view source-byte rendering (D1): each
   * axiom's value is sliced out of `file_content_by_file[axiom.file_id]`. Now
   * REQUIRED on the wire (the backend ships it — T5/T7); `AxiomRow` keeps its
   * defensive null-tolerance so a missing entry degrades to the delab path
   * rather than crashing.
   */
  file_content_by_file: Record<string, string>;
}

/**
 * One held proposition — the `?prop=` unit. Premise-sets are resolved to the
 * user's axiom def_ids (the graph edges = the union across `supports[]`; ≥2
 * distinct sets ⇒ `over_determined`). The full panel payload lives behind
 * the `proposition` payload of `data/prop/<id>.json`; this row carries only what the list +
 * graph render.
 */
/**
 * A representative declaration (D26/D27) — the published theorem chosen to FACE a
 * held proposition (or a single premise-set): the most-recent self-authored
 * covered certificate, else the first-by-anyone. `name` is the FQ
 * `axiom_defs.name` (the row label leaf-extracts it); `def_id` is the `?def=`
 * target; `source` (`theorem` | `user_theorem`) gates the Theorem-Page link.
 */
export interface Representative {
  def_id: string;
  name: string;
  source: string;
}

export interface ProfileSupportPremise {
  axiom_def_id: string;
  field_path: string;
  proposition_id: string;
  label: string;
}

export interface ProfileSupport {
  premise_axiom_ids: string[];
  premises?: ProfileSupportPremise[];
  representative: Representative;
}

export interface HeldProposition {
  proposition_id: string;
  /**
   * The declaration that FACES this holding (D26) — its name labels the row and
   * `?def=<representative.def_id>` is the row's link. The global winner among the
   * per-premise-set representatives.
   */
  representative: Representative;
  /**
   * Representative phrasing of the clean conclusion `p` (#2). `author` may be
   * null (rendered from a delab token tree); the WHOLE pair may carry an
   * absent signal → the row degrades to a bare `theorem <name>` (T14).
   */
  p: TokenTreePair;
  /**
   * Distinct covered premise-sets resolved to axiom def_ids (≥2 ⇒
   * over-determined). Each carries its OWN per-premise-set representative (D29) —
   * the declaration facing that set's Proof Node in the graph split.
   */
  supports: ProfileSupport[];
  axiom_premise?: ProfileSupportPremise | null;
  /** Adopter count (users whose snapshot CXI-covers an argument). */
  adopters: number;
  /**
   * Holders of the conclusion's negation. `null` when no
   * `proposition_negations` row exists (the FE omits the rejecter chip).
   */
  rejecters: number | null;
  acknowledgements: { acknowledged_undecided: number };
  /** ≥2 distinct premise-sets (D4) — the backend computes it (source of truth). */
  over_determined: boolean;
  /**
   * A theorem-kind certificate backs it → its Theorem Page is linkable (else
   * the row links only to the Proposition Page).
   */
  has_theorem_page: boolean;
  created_at: string;
}

/**
 * One graph-slice datum — the wire's `held_propositions.graph_slice[]` element.
 * The graph is fed from this top-1000-by-engagement slice, INDEPENDENT of the
 * paginated list. This is now a FULL held-proposition row (the SAME field set
 * as `HeldProposition`), not the old minimal `{ proposition_id, supports,
 * over_determined }` node+edge datum: it also carries `representative`, `p`,
 * `adopters`, `rejecters`, `has_theorem_page`, and `created_at`. The widening
 * exists for ROW-REVEAL — the held list's first page is only 50 rows
 * (`heldPageSize`), so a graph-node click can select a holding beyond that
 * page; the workbench passes the whole slice as `revealableHeldProps` so the
 * clicked row renders (label, counts, links) without waiting on a cursor fetch.
 * NOT a frozen contract — it was just widened; treat this as the current shape.
 */
export interface GraphSliceItem {
  proposition_id: string;
  /** The holding's representative declaration (D26) — node label + def-keyed id
   *  for the single-proof case, and the row-highlight target. */
  representative: Representative;
  p: TokenTreePair;
  supports: ProfileSupport[];
  axiom_premise?: ProfileSupportPremise | null;
  adopters: number;
  rejecters: number | null;
  acknowledgements: { acknowledged_undecided: number };
  over_determined: boolean;
  has_theorem_page: boolean;
  created_at: string;
}

export interface HeldPropositions {
  items: HeldProposition[];
  /**
   * The graph's OWN ranked feed (top-1000 by adopters), independent of the
   * list. The GRAPH is built from this — NOT the paginated
   * `items`. See `GraphSliceItem`.
   */
  graph_slice: GraphSliceItem[];
  /**
   * The full derived-held count (the true theorem count), independent of the
   * page size and the graph_slice top-N cap. Drives the honest "N theorems" /
   * "Show all N" labels and the graph legend's hidden count — the cursor wire
   * carries no count otherwise.
   */
  total: number;
}

export interface ProvingTheorem {
  def_id: string;
  file_id: string;
  qualified_name: string;
  created_at: string;
}

export interface UserProfileBodyData {
  username: string;
  latest_user_axioms: ProfileAxioms | null;
  held_propositions: HeldPropositions;
  /**
   * (D28) The proposition ids the user holds via membership (their axiom snapshot
   * + projection closure) — the set the def panel uses to split a theorem's
   * Supports into "provable from your axioms" (covered) vs "other known proofs".
   * Optional for forward-compat; absent ⇒ the panel shows the plain global list.
   */
  coverage_proposition_ids?: string[];
  inconsistency: {
    proving_theorem: ProvingTheorem;
    /** (#4) the user's axioms that were premises of the proof of False. */
    proof_premise_axiom_ids: string[];
  } | null;
}

export interface ProfileBodyProps {
  data: UserProfileBodyData;
}

// --- Graph island (ssr:false) ----------------------------------------------
//
// `sigma` touches `WebGL2RenderingContext` at module-eval, so the graph MUST be
// dynamically imported with `ssr:false` (it throws if Next renders it on the
// server; D6/D23). The skeleton holds the hero's space while the chunk loads.
const ProfileGraph = dynamic(() => import("./profile-graph"), {
  ssr: false,
  loading: () => <GraphSkeleton />,
});

function GraphSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--base00)]">
      <div className="animate-pulse text-sm text-muted-foreground">
        Laying out the graph…
      </div>
    </div>
  );
}

// Resolve the Base16 design tokens to the concrete rgb() strings sigma's WebGL
// parser accepts; the palette itself lives in `profile-graph-colors.ts`.
function useGraphColors(): GraphColors {
  const { resolvedMode } = useTheme();
  const [colors, setColors] = React.useState<GraphColors>(FALLBACK_COLORS);
  // Resolution is pure but must stay in an effect: `resolvedMode` is the
  // SSR-stable `"light"` placeholder until the ThemeProvider's post-hydration
  // sync, so resolving during render paints a wrong-theme frame.
  React.useEffect(() => {
    setColors(graphColorsFor(resolvedMode));
    // Re-resolve when the effective theme flips (light ↔ dark) so the graph
    // recolours live on toggle instead of keeping the mount-time palette.
  }, [resolvedMode]);
  return colors;
}

// Debounce a value by `ms` — used for the popularity slider so dragging it
// doesn't rebuild + relayout the graph on every tick (D7: filter before layout).
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// The graph legend — an at-a-glance key over the hero (D5). The theorem line reads
// "<shown> theorems · <hidden> more" — `hidden` is derived from the TRUE held count
// (held_propositions.total, fed via buildGraphSpec's totalHeldCount), so it spans
// both slider-scoped-out nodes AND held propositions beyond the top-1000 graph_slice
// the graph can't show. (`shown` is the theorem-NODE count for the dot legend;
// kept as a separate number from `hidden` since nodes ≠ props under over-determination.)
function GraphLegend({
  username,
  axiomCount,
  shown,
  projectionCount,
  projectionAvailable,
  overCount,
  hidden,
  colors,
  showProjections,
  onShowProjectionsChange,
}: {
  username: string;
  axiomCount: number;
  shown: number;
  /** Projection nodes currently VISIBLE in the built spec (0 when the toggle is
   *  off). Drives the count line. */
  projectionCount: number;
  /** Projection rows AVAILABLE in the raw graph slice, regardless of the toggle
   *  (`graphSlice.filter(isStructuralProjectionItem).length`). Gates the toggle:
   *  a zero-projection profile hides the checkbox entirely (a toggle that could
   *  never reveal anything), matching the count line's `> 0` gate. */
  projectionAvailable: number;
  overCount: number;
  hidden: number;
  colors: GraphColors;
  showProjections: boolean;
  onShowProjectionsChange: (show: boolean) => void;
}) {
  return (
    <div className="absolute right-3 top-3 z-10 rounded-md border border-border bg-background/80 px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
      {/* Legend title — names the graph as this user's held knowledge. */}
      <div className="mb-1 text-xs font-semibold text-foreground">
        Propositions held by @{username}
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ background: colors.axiom }}
        />
        {axiomCount} axioms
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ background: colors.proof }}
        />
        {shown.toLocaleString()} theorems (top by engagement)
        {hidden > 0 && (
          <span className="text-muted-foreground/60">
            {" "}
            · {hidden.toLocaleString()} more
          </span>
        )}
      </div>
      {projectionCount > 0 && (
        <div className="mt-0.5 flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ background: colors.projection }}
          />
          {projectionCount.toLocaleString()} projection theorems
        </div>
      )}
      {overCount > 0 && (
        <div className="mt-0.5 flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ background: colors.propositionOver }}
          />
          {overCount.toLocaleString()} over-determined (≥2 proofs)
        </div>
      )}
      {/* Only offer the toggle when the raw slice actually has projection rows
          to reveal — otherwise it's a no-op control. Mirrors the count line's
          `> 0` gate above (hide, don't disable). The muted "· N available"
          count tells the user what toggling reveals, matching the "· N more"
          style used on the theorem line. */}
      {projectionAvailable > 0 && (
        <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-foreground">
          <input
            type="checkbox"
            className="size-3 accent-[var(--primary)]"
            checked={showProjections}
            onChange={(e) => onShowProjectionsChange(e.currentTarget.checked)}
          />
          Show projection theorems
          <span className="text-muted-foreground/60">
            · {projectionAvailable.toLocaleString()} available
          </span>
        </label>
      )}
    </div>
  );
}

/**
 * MOBILE-ONLY "previewed selection" — the STAGE 1 unit of the two-stage
 * node-tap flow (mobile). A graph-node tap on mobile sets this; it drives the
 * graph node-highlight (via `selectedId`), the bottom-sheet row highlight +
 * scroll-into-view, the sheet expand to 0.55, and the row reveal — WITHOUT
 * opening the lean panel or moving the camera. Tapping the highlighted row then
 * opens the panel (STAGE 2). `kind` is the node's `GraphNode.kind` so the row
 * predicates can route a `proposition` preview to the held row by its
 * `proposition_id`. Desktop NEVER sets this (a node tap opens the panel
 * directly), so every preview-aware branch below is inert on desktop.
 */
export type GraphPreview = { id: string; kind: GraphNode["kind"] };

export function ProfileBody({ data }: ProfileBodyProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const colors = useGraphColors();

  // MOBILE: keep the Sigma zoom/center control card docked just above the live
  // top edge of the bottom sheet (Google-Maps style). No-op on desktop. Another
  // agent owns the hook + the CSS var it publishes; this is only the call site.
  useControlsSheetLock(isMobile);

  // ---- Unified selection (the ?def= / ?prop= axes; one drill-down stack) ---
  const {
    selectedDefId,
    selectedPropId,
    selectDef,
    selectProp,
    back,
    forward,
    close,
    canBack,
    canForward,
    urlReader,
  } = useSelection();

  // ---- Lists controls (lifted here so the workbench owns the state) --------
  const [view, setView] = React.useState<ViewChoice>({ kind: "author" });
  const [search, setSearch] = React.useState("");
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  const axioms = data.latest_user_axioms;
  const graphSlice = data.held_propositions.graph_slice;
  const proofPremiseAxiomIds = data.inconsistency?.proof_premise_axiom_ids;
  const [showProjections, setShowProjections] = React.useState(false);

  // ---- Progressive reveal (collapsed lists) --------------------------------
  //
  // Each left-list section is COLLAPSED by default and renders only the rows the
  // user has REVEALED via a selection (the `revealed*` sets, initially empty);
  // the `*Expanded` flags show the full list. A selection's node id routes to a
  // list:
  //   - an axiom def_id → reveal it in the Axioms list;
  //   - a held representative def_id (the holding's face OR any per-premise-set
  //     representative Proof Node, D29) → reveal that holding's Theorems row;
  //   - an over-determined holding's proposition_id (its `?prop=` node, D29) →
  //     map to the holding's row key (its main representative def_id).
  const [axiomsExpanded, setAxiomsExpanded] = React.useState(false);
  const [theoremsExpanded, setTheoremsExpanded] = React.useState(false);
  const [revealedAxioms, setRevealedAxioms] = React.useState<
    ReadonlySet<string>
  >(() => new Set());
  const [revealedTheorems, setRevealedTheorems] = React.useState<
    ReadonlySet<string>
  >(() => new Set());
  // A list can also be fully COLLAPSED (hidden) via its heading chevron —
  // collapsing hides EVERY row, the revealed ones included (a true accordion-
  // collapse, distinct from the revealed-subset view). Default open; a selection
  // re-opens the list it reveals into (below) so the clicked row stays visible.
  const [axiomsCollapsed, setAxiomsCollapsed] = React.useState(false);
  const [theoremsCollapsed, setTheoremsCollapsed] = React.useState(false);

  const axiomDefIdSet = React.useMemo(
    () => new Set((axioms?.axioms ?? []).map((a) => a.def_id)),
    [axioms],
  );
  // Map every held-related id → the holding's row key (= its main
  // `representative.def_id`, the key the left list renders the row under). Covers
  // the proposition_id, the main representative def_id, and each per-premise-set
  // representative def_id (the over-determined Proof Nodes). Built from the
  // first list page AND the graph_slice (top-1000), so both list-row and
  // graph-node selections resolve.
  const heldRowKeyByNodeId = React.useMemo(() => {
    const m = new Map<string, string>();
    const add = (h: {
      proposition_id: string;
      representative: { def_id: string };
      supports: Array<{ representative: { def_id: string } }>;
    }) => {
      const rowKey = h.representative.def_id;
      m.set(h.proposition_id, rowKey);
      m.set(rowKey, rowKey);
      for (const s of h.supports) m.set(s.representative.def_id, rowKey);
    };
    for (const it of data.held_propositions.items) add(it);
    for (const g of graphSlice) add(g);
    return m;
  }, [data.held_propositions.items, graphSlice]);

  // MOBILE STAGE 1 — the previewed graph selection (see `GraphPreview`). Set by
  // a node tap (and by a direct row tap, so the close-to-exploring state still
  // shows a highlighted row); cleared by a background tap. Drives the graph
  // node-highlight, the row highlight + scroll, the row reveal (below), and the
  // sheet expand — never the lean panel and never the camera. Null on desktop.
  const [preview, setPreview] = React.useState<GraphPreview | null>(null);

  // Accumulate the revealed row on every selection (a graph click, a list-row
  // click, an in-`p` identifier, the inconsistency strip, or a Back/Forward
  // walk — all land here via the unified `?def=`/`?prop=` selection), PLUS the
  // mobile STAGE-1 preview. An axiom def_id reveals its Axioms row; any
  // held-related id reveals its Theorems row; an off-list def (e.g. the
  // proof-of-False certificate) reveals nothing.
  React.useEffect(() => {
    // The previewed node (mobile STAGE 1) reveals its row too — a node tap that
    // doesn't open the panel still has to surface the row it highlights. On
    // desktop `preview` is always null, so this falls back to the URL selection.
    const id = selectedDefId ?? selectedPropId ?? preview?.id ?? null;
    if (id === null) return;
    if (axiomDefIdSet.has(id)) {
      setRevealedAxioms((prev) =>
        prev.has(id) ? prev : new Set(prev).add(id),
      );
      setAxiomsCollapsed(false); // re-open the list so the revealed row is visible
    }
    const rowKey = heldRowKeyByNodeId.get(id);
    if (rowKey !== undefined) {
      setRevealedTheorems((prev) =>
        prev.has(rowKey) ? prev : new Set(prev).add(rowKey),
      );
      setTheoremsCollapsed(false);
    }
  }, [
    selectedDefId,
    selectedPropId,
    preview,
    axiomDefIdSet,
    heldRowKeyByNodeId,
  ]);

  // The popularity slider scopes the GRAPH within its own ranked slice (D7),
  // NOT the list. The slider max is the graph_slice cardinality. The default is
  // a flat Math.min(1000, …) — the ENTIRE wire slice — INTENTIONALLY (owner
  // confirmed), not the old breakpoint-scoped count (desktop 120 / mobile 40):
  // it matches the raised graph_slice wire cap (graphSliceN = 1000,
  // profile_query.go), and because structural-projection rows are filtered out
  // client-side (sliceForGraphCount), a smaller default could leave the graph
  // projection-starved — a low slice consumed by rows the legend then
  // classifies out. `graphSlice` is SSR prop data and never changes after
  // mount, so this initializer is the final value (no pin-once effect needed).
  const [sliceCount, setSliceCount] = React.useState(() =>
    Math.min(1000, graphSlice.length),
  );

  // Mount gate for the layout shell (below): useIsMobile is false on the server
  // / first client render, so we must not paint the desktop group on phones and
  // then tear it down. Read by the `if (!mounted)` return near the end.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Mobile bottom-sheet snap position (lists peek → expand). Reset to the peek
  // snap when a selection closes so the lists don't stay fully expanded.
  const [sheetSnap, setSheetSnap] = React.useState<number | string | null>(
    0.27,
  );

  // ---- Side panel (?def=) data ----------------------------------------------
  const {
    defData,
    state: defState,
    retry: retryDef,
  } = useDefData(selectedDefId);

  // ---- Proposition panel (?prop=) data fetch -------------------------------
  // The prop-axis sibling of the def fetch, packaged as `usePropData` so the
  // workbench keeps both fetch states side by side.
  const {
    propData,
    state: propState,
    errorStatus: propErrorStatus,
    retry: retryProp,
  } = usePropData(selectedPropId);

  // ---- Panel view (independent of the lists' view toggle) ------------------
  const [panelView, setPanelView] = React.useState<ViewChoice>({
    kind: "author",
  });

  // ---- Cross-file "View in file" navigation --------------------------------
  // The profile page never IS the def's home file, so canViewInFile is always
  // true once def_data lands (the panel hides the affordance when def_data is
  // null). `select()` pivots within the page (native replaceState); only the
  // cross-file jump uses the router.
  const navigateToFile = React.useCallback(
    (def_id: string, target_file_id: string) => {
      router.push(
        `/f/${encodeURIComponent(target_file_id)}?def=${encodeURIComponent(def_id)}`,
      );
    },
    [router],
  );
  const canViewInFile = defData !== null;

  // ---- Holders/Rejecters drill-in (the prop panel's count chips) -----------
  // The PropositionPanel emits `(side, element)`; the workbench resolves the
  // proposition the modal lists: the Pro leg drills the selected proposition,
  // the Con leg drills its negation (`negation_proposition_id`). Same
  // host-owned `HoldersModal` the Theorem Page uses.
  const [drillIn, setDrillIn] = React.useState<DrillInRequest | null>(null);
  // Shared by the proposition panel AND the def panel's grafted Adoption (D28).
  // The Adoption section resolves the target proposition itself (con → the
  // negation), so the workbench just opens the host-owned modal on it.
  const onHoldersDrillIn = React.useCallback(
    (args: {
      side: "pro" | "con";
      proposition_id: string;
      element: HTMLElement;
    }) => {
      setDrillIn({
        kind: "holders",
        side: args.side,
        proposition_id: args.proposition_id,
        element: args.element,
      });
    },
    [],
  );
  const closeDrillIn = React.useCallback(() => setDrillIn(null), []);

  // ---- Selection / background handlers -------------------------------------
  // Background (stage) tap — a full deselect: drop the panel selection AND, on
  // mobile, the STAGE-1 preview, and collapse the sheet back to the peek snap.
  const clearSelection = React.useCallback(() => {
    close();
    if (isMobile) {
      setPreview(null);
      setSheetSnap(0.27);
    }
  }, [close, isMobile]);

  // Panel close (the X / overlay dismiss). On mobile the lean panel is a
  // full-screen modal; closing it returns the user to the STAGE-1 "exploring"
  // state — the bottom sheet expanded to 0.55 with the previewed row still
  // highlighted (the preview is intentionally KEPT) — rather than collapsing to
  // the peek snap. On desktop `isMobile` is false, so this is exactly `close()`
  // (unchanged behaviour).
  const closePanel = React.useCallback(() => {
    close();
    if (isMobile) setSheetSnap(0.55);
  }, [close, isMobile]);

  // STAGE-1 preview setter handed to the lists: a direct row tap on mobile
  // records the previewed node too, so when the panel later closes the sheet
  // lands on a still-highlighted row. The lists only invoke this on the mobile
  // path, so it never runs on desktop.
  const onPreview = React.useCallback((p: GraphPreview) => setPreview(p), []);

  // ---- Graph spec ----------------------------------------------------------
  // Rebuilding the graph + re-running the force layout is the expensive op, so
  // debounce the slider (D7). The graph is fed from `graph_slice` (top-1000 by
  // adopters, INDEPENDENT of the paginated list), scoped to the slider count;
  // proof-premise axiom nodes get a distinct ring and render even if isolated.
  const debouncedSlice = useDebounced(sliceCount, 200);
  const graphTheoremTotal = React.useMemo(
    () => graphSlice.filter((g) => !isStructuralProjectionItem(g)).length,
    [graphSlice],
  );
  // Projection rows available to reveal, computed from the RAW slice (NOT
  // spec.nodes, which only contains projection nodes when the toggle is already
  // on — a circular source). Gates the legend's projection toggle (CO-25).
  const graphProjectionTotal = React.useMemo(
    () => graphSlice.filter(isStructuralProjectionItem).length,
    [graphSlice],
  );
  const visibleGraphSlice = React.useMemo(
    () =>
      sliceForGraphCount(graphSlice, debouncedSlice, {
        showProjections,
      }),
    [graphSlice, debouncedSlice, showProjections],
  );
  const spec = React.useMemo(
    () =>
      buildGraphSpec(axioms?.axioms ?? [], visibleGraphSlice, {
        // The theorem-row total after structural projection rows are classified
        // out. Projection rows are an optional overlay and should not consume or
        // inflate the theorem hidden-count.
        totalHeldCount: graphTheoremTotal,
        proofPremiseAxiomIds,
        showProjections,
      }),
    [axioms, visibleGraphSlice, graphTheoremTotal, proofPremiseAxiomIds, showProjections],
  );

  // The currently-selected node id (def OR prop) — drives the graph highlight +
  // the list binding. Mutually exclusive by construction (useSelection). A
  // list-row or representative-theorem-node selection is the representative's
  // def_id; a proposition-node selection is the proposition_id.
  const selectionNodeByPropId = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const n of spec.nodes) {
      if (n.kind === "projection" && n.propositionId) m.set(n.propositionId, n.id);
      if (n.kind === "proposition") m.set(n.id, n.id);
    }
    return m;
  }, [spec]);
  const selectedNodeId =
    selectedDefId ?? (selectedPropId ? (selectionNodeByPropId.get(selectedPropId) ?? selectedPropId) : null);

  // The id that drives the GRAPH's node-highlight + dim-others. On mobile this
  // follows the STAGE-1 preview (a node tap highlights without opening the
  // panel), falling back to the URL selection (a deep link). On desktop
  // `preview` is null, so this is exactly `selectedNodeId` — unchanged.
  const graphSelectedId = isMobile
    ? (preview?.id ?? selectedNodeId)
    : selectedNodeId;

  // A graph node id is a def_id (axiom OR a representative Proof Node, D26) or a
  // proposition_id (an over-determined holding's proposition node, D29). Route by
  // node KIND from the built spec: a proposition node opens `?prop=`; every other
  // node (axiom / theorem) opens `?def=` (design § graph "node click →
  // select(node)").
  const nodeById = React.useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of spec.nodes) m.set(n.id, n);
    return m;
  }, [spec]);
  const onNodeSelect = React.useCallback(
    (id: string) => {
      const node = nodeById.get(id);
      const kind = node?.kind;
      if (node?.kind === "projection") {
        if (node.propositionId) selectProp(node.propositionId);
        return;
      }
      if (isMobile) {
        // STAGE 1 (mobile) — preview only. Highlight this node + its bottom-sheet
        // row, expand the sheet to reveal the row, and scroll it into view (the
        // reveal effect + the row's `selected`-driven scrollIntoView do the
        // latter two). DO NOT open the lean panel and DO NOT move the camera —
        // the row tap (STAGE 2) opens the panel. Applies to the axiom / theorem /
        // proposition kinds — THREE of the four node kinds. The fourth,
        // `projection`, is handled ABOVE (it opens `?prop=` directly, bypassing
        // this two-stage preview) because a projection graph id matches no
        // bottom-sheet list row, so there is no row to preview or reveal.
        if (kind !== undefined) setPreview({ id, kind });
        // Expand enough to reveal the row, but never SHRINK the sheet if the
        // user has already dragged it higher (0.95).
        setSheetSnap((prev) =>
          typeof prev === "number" && prev >= 0.55 ? prev : 0.55,
        );
        return;
      }
      // DESKTOP — unchanged: a node tap opens the panel directly (a proposition
      // node → ?prop=, every other kind → ?def=).
      if (kind === "proposition") selectProp(id);
      else selectDef(id);
    },
    [nodeById, selectDef, selectProp, isMobile],
  );

  // (D28) The profile user's held axiom-proposition ids → the def panel's grafted
  // Supports covered/uncovered split. null ⇒ the panel shows the plain global list.
  const coveredPropositionIds = React.useMemo(
    () =>
      data.coverage_proposition_ids
        ? new Set(data.coverage_proposition_ids)
        : null,
    [data.coverage_proposition_ids],
  );

  // (D28) Each axiom's asserted proposition, keyed by the axiom's def_id — the
  // def panel grafts an axiom's Adoption / Supports / Equivalences off this hint
  // (an axiom has no entailment certificate, so the generic defs read returns no
  // `conclusion_prop`). The covered/uncovered split stays theorem-only.
  const axiomPropById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const a of axioms?.axioms ?? []) m.set(a.def_id, a.proposition_id);
    return m;
  }, [axioms]);

  // ---- Lists pane ----------------------------------------------------------
  const lists = (
    <ProfileLists
      username={data.username}
      axioms={axioms?.axioms ?? []}
      fileContentByFile={axioms?.file_content_by_file ?? {}}
      hasAxiomsFile={axioms !== null}
      initialHeldProps={data.held_propositions.items}
      revealableHeldProps={graphSlice}
      heldTotal={data.held_propositions.total}
      heldSliderMax={graphSlice.length}
      view={view}
      setView={setView}
      sliceCount={sliceCount}
      setSliceCount={setSliceCount}
      search={search}
      setSearch={setSearch}
      selectedDefId={selectedDefId}
      selectedPropId={selectedPropId}
      hoveredId={hoveredId}
      selectDef={selectDef}
      selectProp={selectProp}
      onHover={setHoveredId}
      isMobile={isMobile}
      previewId={preview?.id ?? null}
      onPreview={onPreview}
      lastUpdatedFileId={axioms?.file_id ?? null}
      lastUpdatedTimestamp={axioms?.timestamp ?? null}
      revealedAxioms={revealedAxioms}
      revealedTheorems={revealedTheorems}
      axiomsExpanded={axiomsExpanded || !mounted}
      setAxiomsExpanded={setAxiomsExpanded}
      theoremsExpanded={theoremsExpanded || !mounted}
      setTheoremsExpanded={setTheoremsExpanded}
      axiomsCollapsed={axiomsCollapsed}
      setAxiomsCollapsed={setAxiomsCollapsed}
      theoremsCollapsed={theoremsCollapsed}
      setTheoremsCollapsed={setTheoremsCollapsed}
    />
  );

  // ---- Graph hero (+ inconsistency strip pinned full-width above it) -------
  const inconsistency = data.inconsistency;
  const graph = (
    <div className="relative flex h-full w-full flex-col">
      {inconsistency !== null ? (
        // Inconsistency strip — pinned full-width above the graph, Base16 error
        // accent (--base08), NON-DISMISSIBLE (it is a state, not a
        // notification). Per platform-inference § soundness asymmetry, the
        // ABSENCE of this strip is never rendered as "axioms verified
        // consistent". "View the proof" opens the def side panel anchored to the
        // proving certificate (native replaceState via `selectDef`, so the
        // force-dynamic route does not re-run).
        <section
          aria-label="Axioms inconsistent"
          className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 bg-[var(--base08)] px-4 py-2 text-sm text-[var(--base00)]"
        >
          <span>
            This user&apos;s axioms have been shown to imply False (proof
            submitted{" "}
            <Timestamp iso={inconsistency.proving_theorem.created_at} />
            ).
          </span>
          <button
            type="button"
            onClick={() => selectDef(inconsistency.proving_theorem.def_id)}
            className="font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            View the proof.
          </button>
        </section>
      ) : null}
      <div
        className="dot-grid relative min-h-0 flex-1 bg-[var(--base00)]"
        role="img"
        aria-label="Force-directed graph of this user's axioms and theorems. The lists are the keyboard-operable equivalent for browsing and selecting."
      >
        <ProfileGraph
          spec={spec}
          selectedId={graphSelectedId}
          colors={colors}
          // CAMERA BUG FIX: never animate the camera on a selection. The mobile
          // fly-to (the old `flyTo={isMobile}`) recentred + zoomed the camera onto
          // the tapped node, pushing the rest of the graph out of the viewport so
          // the user had to hit "Center" to recover. With the two-stage flow the
          // graph stays a persistent exploration surface, so the camera must stay
          // put across node tap, panel open/close, and the sheet expansion. Desktop
          // was already `false` (dim-with-context), so this is unchanged there.
          flyTo={false}
          onNodeClick={onNodeSelect}
          onNodeHover={setHoveredId}
          onBackgroundClick={clearSelection}
        />
        <GraphLegend
          username={data.username}
          axiomCount={axioms?.axioms.length ?? 0}
          shown={spec.nodes.filter((n) => n.kind === "proof").length}
          projectionCount={spec.nodes.filter((n) => n.kind === "projection").length}
          projectionAvailable={graphProjectionTotal}
          overCount={spec.nodes.filter((n) => n.kind === "proposition").length}
          hidden={spec.hiddenTheoremCount}
          colors={colors}
          showProjections={showProjections}
          onShowProjectionsChange={setShowProjections}
        />
      </div>
    </div>
  );

  // ---- Inspection panel (mutually exclusive ?def= / ?prop=) ----------------
  // The def SidePanel and the PropositionPanel are never both open
  // (useSelection enforces mutual exclusion). Both share ONE drill-down stack:
  // Back / Forward walk the unified stack across both axes.
  const panel =
    selectedDefId !== null ? (
      <SidePanel
        def_id={selectedDefId}
        def_data={defData}
        view={panelView}
        state={defState}
        canViewInFile={canViewInFile}
        history={{ can_back: canBack, can_forward: canForward }}
        onBack={back}
        onForward={forward}
        onClose={closePanel}
        onRetry={retryDef}
        onIdentifierClick={(t) => selectDef(t.def_id)}
        onViewChange={setPanelView}
        onViewInFile={navigateToFile}
        onSelectProp={selectProp}
        onHoldersDrillIn={onHoldersDrillIn}
        conclusionPropHint={
          selectedDefId !== null
            ? (axiomPropById.get(selectedDefId) ?? null)
            : null
        }
        // (D34) The grafted Equivalences split "from @username's axioms" — same
        // coverage set the proposition panel uses.
        coveredPropositionIds={coveredPropositionIds}
        username={data.username}
      />
    ) : selectedPropId !== null ? (
      <PropositionPanel
        prop_id={selectedPropId}
        prop_data={propData}
        view={panelView}
        state={propState}
        errorStatus={propErrorStatus}
        history={{ can_back: canBack, can_forward: canForward }}
        onBack={back}
        onForward={forward}
        onClose={closePanel}
        onRetry={retryProp}
        onViewChange={setPanelView}
        // An identifier inside `p` is a DEF reference → cross-type pivot.
        onSelectDef={(t) => selectDef(t.def_id)}
        onSelectProp={selectProp}
        onHoldersDrillIn={onHoldersDrillIn}
        // (D33) The covered/uncovered "Proofs from @username's axioms" split lives
        // on the proposition panel — the proposition is the subject.
        coveredPropositionIds={coveredPropositionIds}
        username={data.username}
      />
    ) : null;

  // Don't paint a layout-specific shell until the breakpoint resolves
  // (useIsMobile is false on the server / first client render) — otherwise we'd
  // paint the desktop group on phones then tear it down.
  // The prerendered (pre-mount) body is the lists pane with every section
  // expanded, so the exported HTML carries the profile's full content.
  if (!mounted) {
    return (
      <div className="h-full w-full overflow-y-auto">
        {lists}
        {urlReader}
      </div>
    );
  }

  // MOBILE — graph hero + non-modal vaul bottom sheet for the lists; the
  // inspection panel renders its OWN modal bottom sheet (a sibling — it reads
  // useIsMobile internally). The HoldersModal is a sibling too.
  if (isMobile) {
    return (
      <div className="relative h-full w-full">
        {graph}
        <Drawer.Root
          open
          snapPoints={[0.27, 0.55, 0.95]}
          activeSnapPoint={sheetSnap}
          setActiveSnapPoint={setSheetSnap}
          modal={false}
          dismissible={false}
        >
          <Drawer.Portal>
            <Drawer.Content
              aria-describedby={undefined}
              className="fixed inset-x-0 bottom-0 z-30 flex h-[92%] flex-col rounded-t-xl border-t border-border bg-background shadow-2xl outline-none"
            >
              <div className="relative flex items-center justify-center py-1">
                <Drawer.Handle className="!bg-border" />
              </div>
              <Drawer.Title className="sr-only">
                Axioms and theorems
              </Drawer.Title>
              <div className="min-h-0 flex-1">{lists}</div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
        {panel}
        <HoldersModal request={drillIn} onClose={closeDrillIn} />
        {urlReader}
      </div>
    );
  }

  // DESKTOP — a single FLAT horizontal group [ lists | graph | panel ] (NOT
  // nested under LeanUIShell, D23: nesting collapsed the WebGL container's
  // definite height). The panel pane mounts only on selection. The inspection
  // panel renders its docked-pane variant inside the third pane.
  return (
    <>
      <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
        <ResizablePanel
          id="profile-lists"
          defaultSize="24rem"
          minSize="20rem"
          maxSize="34rem"
        >
          {lists}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="profile-graph">{graph}</ResizablePanel>
        {panel !== null && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="profile-detail"
              defaultSize="24rem"
              minSize="20rem"
              maxSize="34rem"
            >
              {panel}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <HoldersModal request={drillIn} onClose={closeDrillIn} />
      {urlReader}
    </>
  );
}
