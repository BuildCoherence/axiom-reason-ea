"use client";

// The docked lists pane (D8, D10) — the precise analytical surface beside the
// graph hero. Folds the prototype's `profile-lists.tsx` onto the REAL wire shape
// (the profile's Viewer Page Data).
//
// What it carries (per design § "Lists pane"):
//   - Identity header: `@username` with axiom + held counts.
//   - Controls: substring search, the shared author↔empty `RenderViewToggle`,
//     and the graph engagement slider. Ordering is FIXED (no select): axioms in
//     author order, held propositions by engagement (adopters + rejecters).
//   - Axioms list: `axiom <name> : <prop>` rows (T14 `AxiomDecl`) with the shared
//     aggregate-holdings `HoldingBar` (D14 — ⊢ holders / ¬ rejecters) as a
//     read-only row subtitle. All axioms are SSR'd whole (no pagination);
//     ordered/filtered client-side.
//   - Held-propositions list: `theorem <name> : <p>` rows (T14 `TheoremDecl`)
//     with the same read-only `HoldingBar` subtitle (⊢ adopters / ¬ negation
//     holders; the old over-determination "supports" chip is dropped). The
//     Viewer Page Data carries the whole list, so it renders unpaginated.
//
// SELECTION (the unified `?def=` / `?prop=` axes, T8 `useSelection`):
//   - An AXIOM row selects by `def_id` → `selectDef` (`?def=` → SidePanel). The
//     name + the proposition's own in-`p` identifiers are clickable defs too.
//   - A HELD-PROPOSITION row is FACED by its representative declaration (D26):
//     it selects by `representative.def_id` → `selectDef` (`?def=` → the def
//     SidePanel, grafted with the conclusion's adoption / supports / equivalences,
//     D28). The representative name + identifiers inside `p` are def references →
//     `selectDef`. The standalone proposition panel is reached from the graph's
//     proposition nodes / an Equivalences pivot, not the row.
//
// The freshness chip + `firstSeen` field the prototype carried are DROPPED
// (out of scope for the refresh).

import clsx from "clsx";
import * as React from "react";
import Link from "next/link";
import { Slider } from "radix-ui";
import { ChevronRight, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { RenderViewToggle } from "@/components/lean-ui/render-view-toggle";
import type { ViewChoice } from "@/components/lean-ui/types";

import { Timestamp } from "@/components/ui/timestamp";

import type {
  GraphPreview,
  HeldProposition,
  ProfileAxiom,
} from "./profile-body";
import {
  isOverDetermined,
  matchesAxiom,
  matchesTheorem,
  orderAxioms,
  orderTheorems,
} from "./graph-model";
import { AxiomDecl, TheoremDecl } from "./lean-rows";
import { HoldingBar } from "@/components/theorem-flowchart-rf/nodes/holding-bar";

type IdentifierClick = (target: {
  def_id: string;
  qualified_name: string;
}) => void;

export interface ProfileListsProps {
  // ---- Identity header ----------------------------------------------------
  username: string;

  // ---- Axioms (SSR'd whole — not paginated) -------------------------------
  axioms: ProfileAxiom[];
  /** Home-file source keyed by `file_id` (one entry per distinct FILE) for the
   *  author-view source-byte path (D1) — each axiom's value is sliced out of
   *  its file's content, looked up by the axiom's `file_id`. */
  fileContentByFile: Record<string, string>;
  /**
   * Whether the user has published an `Axioms.lean` at all. `false` → the
   * "No axioms yet" empty state; `true` with an empty `axioms` → the rarer
   * "declares no axiom defs" copy (matches profile-body's distinction).
   */
  hasAxiomsFile: boolean;

  // ---- Held propositions -----------------------------------------------------
  /** Every held proposition, in engagement order. */
  initialHeldProps: HeldProposition[];
  /** Graph-slice held rows a graph selection may reveal. */
  revealableHeldProps: HeldProposition[];
  /** The total held-proposition count (`held_propositions.total`) — drives
   *  the "Theorems" heading count and the "Show all N" label. */
  heldTotal: number;
  /** Slider max — the graph's ranked-slice cardinality (T16 passes
   *  `graph_slice.length`); the slider scopes the GRAPH, not the list (D7). */
  heldSliderMax: number;

  // ---- Controls (lifted to the workbench — T16 owns the state) ------------
  view: ViewChoice;
  setView: (v: ViewChoice) => void;
  sliceCount: number;
  setSliceCount: (n: number) => void;
  search: string;
  setSearch: (s: string) => void;

  // ---- Selection + hover (the unified ?def= / ?prop= axes, T8) ------------
  /** The selected `?def=` id, or null. Highlights the matching axiom row. */
  selectedDefId: string | null;
  /** The selected `?prop=` id, or null. Highlights the matching held-prop row. */
  selectedPropId: string | null;
  /** The hovered graph/list node id (def_id OR proposition_id). */
  hoveredId: string | null;
  /** Select a def → `?def=` (SidePanel). Axiom rows + in-`p` identifiers. */
  selectDef: (def_id: string) => void;
  /** Select a proposition → `?prop=` (PropositionPanel). Held-prop rows. */
  selectProp: (proposition_id: string) => void;
  onHover: (id: string | null) => void;

  // ---- Mobile two-stage node-tap flow (STAGE 1 preview) -------------------
  /**
   * Whether the viewport is mobile (the workbench's `useIsMobile`). Gates the
   * two-stage tap: on mobile a row tap is STAGE 2 (open the panel) and held rows
   * route ADAPTIVELY (over-determined → the proposition panel `?prop=`, else the
   * def panel `?def=`); on desktop a row ALWAYS opens the def panel (unchanged).
   */
  isMobile: boolean;
  /**
   * The previewed graph-node id (mobile STAGE 1), or null. Highlights AND
   * scrolls the matching row into view WITHOUT a URL selection — an axiom row
   * when it equals a `def_id`, a held row when it equals an owned representative
   * `def_id` OR the holding's `proposition_id` (the gap a `?prop=`-only selection
   * leaves on desktop is deliberately closed here for the mobile preview).
   * Always null on desktop.
   */
  previewId: string | null;
  /**
   * Record a STAGE-1 preview when a ROW is tapped on mobile, so the row stays
   * highlighted after the panel later closes back to the exploring state. Never
   * invoked on desktop (the row paths gate it on `isMobile`).
   */
  onPreview: (preview: GraphPreview) => void;

  // ---- Last-updated snapshot link (header subtitle) -----------------------
  /**
   * The Axioms.lean snapshot file id — the `/f/<file_id>` link target for the
   * header's "Updated …" date (the most-recent axiom snapshot file). `null`
   * when the user has no axioms file (the date is then omitted entirely).
   */
  lastUpdatedFileId: string | null;
  /**
   * The latest `UserAxioms` snapshot's publish time in **epoch SECONDS** (the
   * UserAxioms timestamp param — `time.Now().Unix()` at publish). Rendered as
   * the "Updated" date via `new Date(ts * 1000)`. `null` ⇒ no axioms file.
   */
  lastUpdatedTimestamp: number | null;

  // ---- Progressive reveal + expand (per list) -----------------------------
  //
  // Each list is COLLAPSED by default: it renders only its "revealed" rows (the
  // ones the user has selected so far via the graph or list). Selecting a node
  // accumulates more revealed rows; the heading's expand toggle shows the full
  // list. The hub (profile-body) owns these — it routes a selection to the
  // right list and accumulates the revealed id (an axiom def_id, or a held
  // row's representative def_id).
  /** Revealed axiom def_ids (the collapsed Axioms list renders only these). */
  revealedAxioms: ReadonlySet<string>;
  /** Revealed held-row keys = `representative.def_id` (collapsed Theorems list). */
  revealedTheorems: ReadonlySet<string>;
  /** Axioms list expanded → render the full list (else revealed-only). */
  axiomsExpanded: boolean;
  setAxiomsExpanded: (expanded: boolean) => void;
  /** Theorems list expanded → render the full list (else revealed-only). */
  theoremsExpanded: boolean;
  setTheoremsExpanded: (expanded: boolean) => void;
  /**
   * A list can also be fully COLLAPSED (hidden). Collapsing hides EVERY row —
   * including the ones revealed by clicking a node — a true accordion-collapse,
   * distinct from the revealed-subset view. Default open; a selection re-opens
   * the list it reveals into so the clicked row stays visible.
   */
  axiomsCollapsed: boolean;
  setAxiomsCollapsed: (collapsed: boolean) => void;
  theoremsCollapsed: boolean;
  setTheoremsCollapsed: (collapsed: boolean) => void;
}

// A row is a plain container (NOT a button): the rendered proposition contains
// its own clickable identifier spans (the name / in-`p` defs open the panel), so
// a wrapping button would nest interactive content. Clicking anywhere else on
// the row selects it (`onSelect`); the inner token clicks stopPropagation and
// select their own def. Hover drives the graph's neighbour-highlight.
function Row({
  id,
  selected,
  highlighted,
  onSelect,
  onHover,
  children,
}: {
  id: string;
  selected: boolean;
  highlighted: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!selected) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // `block: "nearest"` honours the row's `scroll-mt-12` below, so a row pulled
    // into view lands BELOW the sticky `<h2>` section header (~36px tall) rather
    // than tucked under it. (The search/order/slider toolbar is a `shrink-0`
    // sibling ABOVE this scroll viewport, not inside it, so it never overlaps.)
    ref.current?.scrollIntoView({
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [selected]);
  return (
    <div
      ref={ref}
      onClick={() => onSelect(id)}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      className={clsx(
        // `scroll-mt-12` (48px) clears the sticky `<h2>` section header (its
        // `py-2.5` button on a `text-xs`/16px line ≈ 36px) with breathing room,
        // so a selected row scrolled into view sits just below the pinned header.
        "w-full scroll-mt-12 cursor-pointer rounded-md border px-2.5 py-2 text-left transition-colors",
        highlighted
          ? "border-[var(--color-ring)] bg-accent"
          : "border-transparent hover:border-border hover:bg-accent/50",
      )}
    >
      {children}
    </div>
  );
}

export function ProfileLists(props: ProfileListsProps) {
  const {
    username,
    axioms,
    fileContentByFile,
    hasAxiomsFile,
    initialHeldProps,
    revealableHeldProps,
    heldTotal,
    heldSliderMax,
    view,
    search,
    selectedDefId,
    selectedPropId,
    hoveredId,
    selectDef,
    selectProp,
    onHover,
    isMobile,
    previewId,
    onPreview,
    lastUpdatedFileId,
    lastUpdatedTimestamp,
    revealedAxioms,
    revealedTheorems,
    axiomsExpanded,
    setAxiomsExpanded,
    theoremsExpanded,
    setTheoremsExpanded,
    axiomsCollapsed,
    setAxiomsCollapsed,
    theoremsCollapsed,
    setTheoremsCollapsed,
  } = props;
  const q = search.trim().toLowerCase();
  const viewKind = view.kind;

  // The header's "Updated" date — the snapshot timestamp is epoch SECONDS, so
  // scale to ms for `Date`. `<Timestamp>` takes an ISO string. Null ⇒ no axioms.
  const updatedIso =
    lastUpdatedTimestamp !== null
      ? new Date(lastUpdatedTimestamp * 1000).toISOString()
      : null;

  // Stable ids tying each list's `<section>` landmark to its `ListHeading`
  // label via `aria-labelledby` (the section's accessible name = the bare
  // label, so the region is named exactly "Axioms" / "Theorems").
  const baseId = React.useId();
  const axiomsHeadingId = `${baseId}-axioms`;
  const heldHeadingId = `${baseId}-held`;

  // Axiom rows + the identifiers inside a held proposition's `p` are def
  // references → `?def=` (SidePanel). Held-prop ROWS are `?prop=` (handled by
  // the row's onSelect below, not by this token-click path).
  const onIdentifierClick = React.useCallback<IdentifierClick>(
    (target) => selectDef(target.def_id),
    [selectDef],
  );
  const sourceFor = React.useCallback(
    (fileId: string): string | undefined => fileContentByFile[fileId],
    [fileContentByFile],
  );

  // Axioms are SSR'd whole, in author order; filter them client-side (no pagination).
  const visibleAxioms = React.useMemo(
    () => orderAxioms(axioms).filter((a) => matchesAxiom(a, q)),
    [axioms, q],
  );
  // Held propositions arrive ranked already; substring search filters them
  // client-side. `orderTheorems` is a stable re-rank.
  const visibleHeld = React.useMemo(
    () => orderTheorems(initialHeldProps).filter((t) => matchesTheorem(t, q)),
    [initialHeldProps, q],
  );
  const revealableHeld = React.useMemo(() => {
    const seen = new Set<string>();
    const out: HeldProposition[] = [];
    const add = (t: HeldProposition) => {
      if (seen.has(t.proposition_id)) return;
      seen.add(t.proposition_id);
      out.push(t);
    };
    for (const t of visibleHeld) add(t);
    for (const t of revealableHeldProps) add(t);
    return out;
  }, [visibleHeld, revealableHeldProps]);

  // Three display states per list:
  //   - HIDDEN (`!*Open`): the heading chevron collapsed it → render NO rows, not
  //     even the revealed ones (a true accordion-collapse).
  //   - revealed-subset (open, not "show all"): only the rows revealed via a
  //     graph/list selection.
  //   - full (`showAll*`): every row.
  // An active search OVERRIDES both collapse and revealed-subset — a query is an
  // explicit "show me matches", so it force-opens AND force-shows-all (and paging
  // continues so further matches surface). `*Open` folds collapse ∨ search;
  // `showAll*` folds expand ∨ search.
  const axiomsOpen = !axiomsCollapsed || q.length > 0;
  const theoremsOpen = !theoremsCollapsed || q.length > 0;
  const showAllAxioms = axiomsExpanded || q.length > 0;
  const showAllHeld = theoremsExpanded || q.length > 0;
  const shownAxioms = React.useMemo(
    () =>
      !axiomsOpen
        ? []
        : showAllAxioms
          ? visibleAxioms
          : visibleAxioms.filter((a) => revealedAxioms.has(a.def_id)),
    [axiomsOpen, visibleAxioms, showAllAxioms, revealedAxioms],
  );
  // Held rows are keyed by the holding's representative def_id (D26) — the
  // revealed set tracks those keys.
  const shownHeld = React.useMemo(
    () =>
      !theoremsOpen
        ? []
        : showAllHeld
          ? visibleHeld
          : revealableHeld.filter((t) =>
              revealedTheorems.has(t.representative.def_id),
            ),
    [theoremsOpen, visibleHeld, revealableHeld, showAllHeld, revealedTheorems],
  );

  const axiomRows = React.useMemo(
    () =>
      shownAxioms.map((a) => {
        const id = a.def_id;
        // STAGE-1 preview (mobile) highlights AND scrolls the row like a real
        // selection, without a URL selection. `previewId` is null on desktop →
        // this is exactly the prior `selectedDefId === id`.
        const selected = selectedDefId === id || previewId === id;
        // Mobile row tap = STAGE 2: open the def panel AND record the preview so
        // the row stays highlighted when the panel later closes. Desktop keeps
        // the stable `selectDef` ref (preserving the hover-driven memo split).
        const onSelect = isMobile
          ? () => {
              onPreview({ id, kind: "axiom" });
              selectDef(id);
            }
          : selectDef;
        return (
          <AxiomRow
            key={id}
            axiom={a}
            viewKind={viewKind}
            source={sourceFor(a.file_id)}
            selected={selected}
            highlighted={selected || hoveredId === id}
            onSelect={onSelect}
            onHover={onHover}
            onIdentifierClick={onIdentifierClick}
          />
        );
      }),
    [
      shownAxioms,
      viewKind,
      selectedDefId,
      previewId,
      isMobile,
      hoveredId,
      selectDef,
      onPreview,
      onHover,
      onIdentifierClick,
      sourceFor,
    ],
  );
  const heldRows = React.useMemo(
    () =>
      shownHeld.map((t) => {
        // D26: the row is faced + keyed by the representative declaration — it
        // opens `?def=`. It reads as SELECTED when the `?def=` selection is ANY
        // declaration this holding owns — its main representative, OR any
        // per-premise-set representative Proof Node (D29) — or when the
        // `?prop=` selection is this holding's proposition/projection-theorem
        // node. Hover by EITHER an owned def OR the proposition node still
        // highlights the row (a transient neighbour cue, not a selection).
        const repId = t.representative.def_id;
        const ownedDefIds = new Set<string>([
          repId,
          ...t.supports.map((s) => s.representative.def_id),
        ]);
        const defSelected = selectedDefId !== null && ownedDefIds.has(selectedDefId);
        const propSelected = selectedPropId === t.proposition_id;
        // CLOSING THE GAP (mobile STAGE-1 preview only): a proposition-node
        // preview highlights its held row by `proposition_id`; a theorem-node
        // preview by an owned def. `previewId` is null on desktop → unchanged.
        const previewMatch =
          previewId !== null &&
          (ownedDefIds.has(previewId) || previewId === t.proposition_id);
        const selected = defSelected || propSelected || previewMatch;
        // Mobile row tap = STAGE 2, ADAPTIVE: an over-determined holding opens the
        // proposition panel (`?prop=`), else the def panel (`?def=`); record the
        // matching preview so the row stays highlighted when the panel closes.
        // Desktop keeps the stable `selectDef` ref → always the def panel
        // (preserving both the routing AND the hover-driven memo split).
        const onSelect = isMobile
          ? () => {
              if (isOverDetermined(t)) {
                onPreview({ id: t.proposition_id, kind: "proposition" });
                selectProp(t.proposition_id);
              } else {
                onPreview({ id: repId, kind: "proof" });
                selectDef(repId);
              }
            }
          : selectDef;
        return (
          <HeldRow
            key={t.proposition_id}
            proposition={t}
            viewKind={viewKind}
            selected={selected}
            highlighted={
              selected ||
              (hoveredId !== null && ownedDefIds.has(hoveredId)) ||
              hoveredId === t.proposition_id
            }
            onSelect={onSelect}
            onHover={onHover}
            onIdentifierClick={onIdentifierClick}
          />
        );
      }),
    [
      shownHeld,
      viewKind,
      selectedDefId,
      selectedPropId,
      previewId,
      isMobile,
      hoveredId,
      selectDef,
      selectProp,
      onPreview,
      onHover,
      onIdentifierClick,
    ],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h1 className="truncate text-sm font-semibold text-foreground">
          @{username}
        </h1>
        {/* The snapshot "last updated" date links to the most-recent axiom
         * snapshot file (`/f/<file_id>`); omitted when the user has no axioms
         * file (lastUpdated* are then null). */}
        <div className="mt-2 flex items-center justify-end gap-x-3 text-[11px] text-muted-foreground tabular-nums">
          {lastUpdatedFileId !== null && updatedIso !== null ? (
            <Link
              href={`/f/${encodeURIComponent(lastUpdatedFileId)}`}
              // aria-label rather than title=: the inner <Timestamp> renders a
              // <time title=…> whose native tooltip would compete with a
              // title= on the outer link.
              aria-label="View the latest axiom snapshot"
              className="inline-flex items-center gap-1 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]"
            >
              Updated <Timestamp iso={updatedIso} />
            </Link>
          ) : null}
        </div>
      </header>

      {/* Controls */}
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => props.setSearch(e.target.value)}
              placeholder="Search"
              className="h-8 pl-7 text-xs"
              aria-label="Search axioms and theorems"
            />
          </div>
          <RenderViewToggle
            view={view}
            onViewChange={props.setView}
            ariaLabel="Rendering view"
            className="flex shrink-0 gap-1"
          />
        </div>
        <PopularitySlider
          value={props.sliceCount}
          max={heldSliderMax}
          capped={heldTotal > heldSliderMax}
          onChange={props.setSliceCount}
        />
      </div>

      {/* Scrollable lists. Each list is a `<section aria-labelledby>` landmark
       * named by its `ListHeading` (a crawlable Destination Page exposes the
       * two collections as named regions — "Axioms" / "Theorems"). Each list is
       * COLLAPSED by default — it renders only the rows the user has REVEALED
       * (via a graph/list selection); the heading toggles to the full list.
       *
       * NO top padding: the section `<h2>` is `sticky top-0`, so any top padding
       * on this scroll viewport would leave a strip ABOVE where the header pins
       * through which list rows scroll visibly (the header's translucent
       * background only covers its own box, not that strip). Dropping `pt`
       * pins the bar flush at the viewport's top edge; the heading's own `py-2.5`
       * supplies the breathing room, and rows scroll cleanly underneath it. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <section aria-labelledby={axiomsHeadingId}>
          <ListHeading
            labelId={axiomsHeadingId}
            label="Axioms"
            count={visibleAxioms.length}
            open={axiomsOpen}
            onToggleOpen={() => {
              // The chevron toggles the persistent collapse. Collapsing hides
              // every row (revealed ones included) and resets "show all", so a
              // later re-open returns to the revealed subset rather than the full
              // list.
              if (axiomsCollapsed) {
                setAxiomsCollapsed(false);
              } else {
                setAxiomsCollapsed(true);
                setAxiomsExpanded(false);
              }
            }}
            showAll={showAllAxioms}
            onToggleShowAll={() => setAxiomsExpanded(!axiomsExpanded)}
          />
          {axiomsOpen && (
            <div className="space-y-1 py-1.5">
              {visibleAxioms.length === 0 ? (
                <AxiomsEmpty
                  q={q}
                  username={username}
                  hasAxiomsFile={hasAxiomsFile}
                />
              ) : !showAllAxioms && shownAxioms.length === 0 ? (
                <CollapsedHint
                  noun="axioms"
                  total={visibleAxioms.length}
                  onShowAll={() => setAxiomsExpanded(true)}
                />
              ) : (
                axiomRows
              )}
            </div>
          )}
        </section>

        <section aria-labelledby={heldHeadingId}>
          <ListHeading
            labelId={heldHeadingId}
            label="Theorems"
            count={q.length > 0 ? visibleHeld.length : heldTotal}
            open={theoremsOpen}
            onToggleOpen={() => {
              if (theoremsCollapsed) {
                setTheoremsCollapsed(false);
              } else {
                setTheoremsCollapsed(true);
                setTheoremsExpanded(false);
              }
            }}
            showAll={showAllHeld}
            onToggleShowAll={() => setTheoremsExpanded(!theoremsExpanded)}
          />
          {theoremsOpen && (
            <div className="space-y-1 pb-6 pt-1.5">
              {visibleHeld.length === 0 ? (
                <HeldEmpty q={q} hasAxiomsFile={hasAxiomsFile} />
              ) : !showAllHeld && shownHeld.length === 0 ? (
                <CollapsedHint
                  noun="theorems"
                  total={q.length > 0 ? visibleHeld.length : heldTotal}
                  onShowAll={() => setTheoremsExpanded(true)}
                />
              ) : (
                heldRows
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// The section heading carries TWO independent controls on two axes:
//   - the main button (chevron + label + count) is the ACCORDION COLLAPSE toggle
//     — collapsing hides the WHOLE list, the revealed rows included; `open`
//     drives the chevron + `aria-expanded`.
//   - a separate right-aligned "Show all" / "Show less" button (rendered only
//     when the list is open) switches the open list between its revealed subset
//     and the full list.
// They are two sibling buttons, NOT nested (a button inside a button is invalid
// HTML), so visibility and extent stay independently operable + keyboard-
// reachable. `labelId` sits on the bare label span so the wrapping
// <section aria-labelledby> takes its accessible name from "Axioms"/"Theorems"
// alone (excluding the chevron, the volatile count, and the affordances). Each
// button is `py-2.5` (~36px) clearing WCAG 2.5.5 with a `focus-visible` ring;
// the <h2> keeps the sticky chrome and NO bottom margin so adjacent collapsed
// bars touch flush. `count` is the FULL filtered list size (the "Show all"
// target), independent of how many rows are currently revealed.
function ListHeading({
  labelId,
  label,
  count,
  open,
  onToggleOpen,
  showAll,
  onToggleShowAll,
}: {
  labelId: string;
  label: string;
  count: number;
  open: boolean;
  onToggleOpen: () => void;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  return (
    <h2 className="sticky top-0 z-10 -mx-3 flex items-center bg-background/95 backdrop-blur">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="group flex min-w-0 flex-1 items-center gap-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]"
      >
        <ChevronRight
          aria-hidden
          className={clsx(
            "size-3 shrink-0 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span id={labelId}>{label}</span>{" "}
        <span className="tabular-nums text-muted-foreground/70">
          ({count.toLocaleString()})
        </span>
      </button>
      {open && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="shrink-0 px-3 py-2.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          {showAll ? "Show less" : "Show all"}
        </button>
      )}
    </h2>
  );
}

// Shown beneath a COLLAPSED list whose revealed subset is empty (the user hasn't
// selected any node for this list yet, but rows DO exist). Points the user at
// the two ways to populate it: select a node, or expand to the full list. The
// inline "show all" button is the keyboard-accessible twin of the heading toggle.
function CollapsedHint({
  noun,
  total,
  onShowAll,
}: {
  noun: string;
  total: number;
  onShowAll: () => void;
}) {
  return (
    <p className="px-1 py-2 text-[11px] text-muted-foreground">
      Select a node to reveal {noun}, or{" "}
      <button
        type="button"
        onClick={onShowAll}
        className="underline underline-offset-2 hover:no-underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]"
      >
        show all {total.toLocaleString()}
      </button>
      .
    </p>
  );
}

function AxiomsEmpty({
  q,
  username,
  hasAxiomsFile,
}: {
  q: string;
  username: string;
  hasAxiomsFile: boolean;
}) {
  if (q) {
    return (
      <p className="px-1 py-2 text-[11px] text-muted-foreground">
        No axioms match “{q}”.
      </p>
    );
  }
  if (!hasAxiomsFile) {
    return (
      <p className="px-1 py-2 text-[11px] text-muted-foreground">
        No axioms yet — @{username} hasn’t published an <code>Axioms.lean</code>
        .
      </p>
    );
  }
  return (
    <p className="px-1 py-2 text-[11px] text-muted-foreground">
      This user’s latest <code>Axioms.lean</code> declares no axiom defs.
    </p>
  );
}

function HeldEmpty({
  q,
  hasAxiomsFile,
}: {
  q: string;
  hasAxiomsFile: boolean;
}) {
  if (q) {
    return (
      <p className="px-1 py-2 text-[11px] text-muted-foreground">
        No theorems match “{q}”.
      </p>
    );
  }
  return (
    <p className="px-1 py-2 text-[11px] text-muted-foreground">
      {hasAxiomsFile
        ? "No theorems from these axioms yet."
        : "No theorems yet."}
    </p>
  );
}

const AxiomRow = React.memo(function AxiomRow({
  axiom,
  viewKind,
  source,
  selected,
  highlighted,
  onSelect,
  onHover,
  onIdentifierClick,
}: {
  axiom: ProfileAxiom;
  viewKind: ViewChoice["kind"];
  source: string | undefined;
  selected: boolean;
  highlighted: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onIdentifierClick: IdentifierClick;
}) {
  return (
    <Row
      id={axiom.def_id}
      selected={selected}
      highlighted={highlighted}
      onSelect={onSelect}
      onHover={onHover}
    >
      <div className="font-mono text-[13px] leading-snug">
        <AxiomDecl
          decl={axiom}
          view={viewKind}
          source={source}
          onIdentifierClick={onIdentifierClick}
        />
      </div>
      {/* Subtitle: the aggregate-holdings proportion bar (⊢ held / ¬ rejected),
       * read-only so a click passes through to the row's open-panel handler.
       * `flex` parent — the bar's root is `flex: 1 1 auto`, so it spans the row. */}
      <div className="mt-1 flex w-full">
        <HoldingBar
          readOnly
          propositionId={axiom.proposition_id}
          holdings={{ pro: axiom.holders, con: axiom.rejecters }}
        />
      </div>
    </Row>
  );
});

const HeldRow = React.memo(function HeldRow({
  proposition,
  viewKind,
  selected,
  highlighted,
  onSelect,
  onHover,
  onIdentifierClick,
}: {
  proposition: HeldProposition;
  viewKind: ViewChoice["kind"];
  selected: boolean;
  highlighted: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onIdentifierClick: IdentifierClick;
}) {
  return (
    <Row
      id={proposition.representative.def_id}
      selected={selected}
      highlighted={highlighted}
      onSelect={onSelect}
      onHover={onHover}
    >
      <div className="min-w-0 font-mono text-[13px] leading-snug">
        <TheoremDecl
          proposition={proposition}
          view={viewKind}
          onIdentifierClick={onIdentifierClick}
        />
      </div>
      {/* Subtitle: the aggregate-holdings proportion bar (⊢ adopters / ¬ holders
       * of the negation), read-only so a click passes through to the row's
       * open-panel handler. `rejecters === null` ⇒ con 0 (the bar's neutral/empty
       * affordance). Left-aligned flush with the decl (same as axiom rows). */}
      <div className="mt-1 flex w-full">
        <HoldingBar
          readOnly
          propositionId={proposition.proposition_id}
          holdings={{
            pro: proposition.adopters,
            con: proposition.rejecters ?? 0,
          }}
        />
      </div>
    </Row>
  );
});

function PopularitySlider({
  value,
  max,
  capped,
  onChange,
}: {
  value: number;
  max: number;
  // `true` when the profile holds MORE propositions than the slider can reach
  // (the ranked graph slice is hard-capped at 1000). The slider's `max` is then
  // not the true ceiling, so the label shows a "+" on it (e.g. `120 / 1000+`).
  capped?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Graph: top theorems by engagement</span>
        <span className="tabular-nums">
          {value.toLocaleString()} / {max.toLocaleString()}
          {capped ? "+" : ""}
        </span>
      </div>
      <Slider.Root
        className="relative flex h-4 w-full touch-none select-none items-center"
        min={0}
        max={max}
        step={Math.max(1, Math.round(max / 100))}
        value={[value]}
        onValueChange={([v]) => onChange(v ?? 0)}
        aria-label="Number of theorem and projection theorem rows shown in the graph"
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-muted">
          <Slider.Range className="absolute h-full rounded-full bg-primary" />
        </Slider.Track>
        <Slider.Thumb className="block size-3.5 rounded-full border-2 border-primary bg-background shadow focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]" />
      </Slider.Root>
    </div>
  );
}
