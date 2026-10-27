"use client";

import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";

import {
  PanelShell,
  type PanelShellProps,
  type PanelState,
} from "./panel-shell";
import {
  EquivalencesSection,
  HoldersSection,
  SupportsSection,
} from "./proposition-sections";
import { RenderViewToggle } from "./render-view-toggle";
import { ShikiSlice } from "./shiki-slice";
import { TokenTreeView } from "./token-tree";
import { PROP_PANEL_ID } from "./types";
import type { PropData, ViewChoice } from "./types";
import styles from "./side-panel.module.css";

// Proposition inspection panel — the `?prop=` sibling of `SidePanel`. Both
// wrap the shared `PanelShell` (panel-shell.tsx) for the viewport-adaptive
// chrome (desktop docked pane vs mobile Sheet), focus management, the
// DrillDownNav strip, the Close button, and the skeleton / error / idle
// surfaces; this file owns only the PROPOSITION-specific body. The host page
// (the profile workbench, T16) owns URL state (`?prop=` via the unified
// `useSelection`), the `usePropData` fetch, the panel's author/empty view, and
// the searchable Holders/Rejecters modal — the panel is a pure renderer that
// surfaces selection / view-change / drill-in / close events.
//
// SECTIONS (per the internal user-profile-page doc § "Inspection panel"):
//   1. Identity      — proposition_id + earliest-occurrence provenance caption.
//                      NO local_name / qualified_name / publisher / file_id (a
//                      proposition is membership-level, not a file-resident def
//                      — § "Dropped vs the def panel").
//   2. Expression    — `p` via the representative occurrence's source slice in
//                      Author view when available, else the representative token
//                      tree. In-CE identifiers arrive with `def_id`s resolved
//                      server-side, so they render clickable (`?def=` pivots).
//                      Degrades to "(no rendered phrasing)" when the chosen
//                      view has no source slice or token tree.
//   3. Supports      — the arguments-for (supports[]); each row drills the DEF
//                      panel on the certificate's def_id. SHARED with the def
//                      panel (proposition-sections.tsx, D28).
//   4. Adoption      — the aggregate pro / con split via `HoldingBar`; clicking
//                      opens the host-owned searchable HoldersModal. SHARED.
//   5. Equivalences  — the Iff-linked propositions (equivalences[]); each row
//                      pivots the panel to that proposition (`?prop=`). SHARED.
//
// CROSS-TYPE PIVOT — identifiers inside `p` are DEF references: clicking one
// emits `onSelectDef` (a `?def=` pivot into the def panel). The proposition's
// own holder/rejecter/equivalence rows stay on the prop axis (profile / prop
// links). The `supports[].premise_axiom_ids` shown in a support row are
// PROPOSITION ids (per the frozen wire) — DISPLAY ONLY; they are NOT treated as
// def_ids and are not clickable as such.

export interface PropositionPanelProps {
  /** Currently-selected proposition id, or null for the closed state. */
  prop_id: string | null;
  /**
   * Fetched proposition payload. Non-null only when `state === "loaded"`; the
   * panel renders the skeleton or error surface otherwise.
   */
  prop_data: PropData | null;
  /** Panel's own author/empty view (independent of any list view on the host). */
  view: ViewChoice;
  /** Fetch lifecycle — see `PanelState` for the four values. */
  state: PanelState;
  /**
   * HTTP status when the fetch landed on a non-OK response — surfaced in the
   * error state as muted "HTTP <n>" copy. Set only when `state === "error"`
   * AND the failure was a non-OK response (network / parse errors leave it
   * undefined). Threads through from `usePropData`'s `errorStatus`.
   */
  errorStatus?: number | null;
  /**
   * In-panel drill-down stack affordance state — the unified `useSelection`
   * stack the Back / Forward buttons walk (shared with the def panel). The
   * panel receives the boolean flags and emits `onBack` / `onForward`.
   */
  history: { can_back: boolean; can_forward: boolean };
  /** Host walks the drill-down stack back one step. */
  onBack: () => void;
  /** Host walks the drill-down stack forward one step. */
  onForward: () => void;
  /** Host clears `?prop=` from the URL (native replaceState per useSelection). */
  onClose: () => void;
  /** Host re-fires the in-flight fetch when the visitor clicks Retry. */
  onRetry: () => void;
  /** Host updates the panel's author/empty view. */
  onViewChange: (view: ViewChoice) => void;
  /**
   * Cross-type pivot — an identifier inside `p` (a DEF reference) was clicked,
   * OR a support row drilled into its certificate's def. Host calls
   * `selectDef(target.def_id)` (clears `?prop=`, sets `?def=`). The
   * `qualified_name` is the identifier's name for analytics / future titling.
   */
  onSelectDef: (target: { def_id: string; qualified_name: string }) => void;
  /**
   * Same-axis pivot — an Equivalences row was clicked. Host calls
   * `selectProp(proposition_id)` (re-points the panel at the Iff-linked prop).
   */
  onSelectProp: (proposition_id: string) => void;
  /**
   * Open the searchable Holders/Rejecters modal for the drilled proposition. The
   * shared Adoption section resolves the target proposition itself (the Con side
   * → the negation), passing `{ side, proposition_id, element }`; the host turns
   * that into a `DrillInRequest` and feeds its `HoldersModal` — the SAME drill-in
   * the Theorem Page uses.
   */
  onHoldersDrillIn: (args: {
    side: "pro" | "con";
    proposition_id: string;
    element: HTMLElement;
  }) => void;
  /**
   * (D33) The profile user's held axiom-proposition ids. When provided, the
   * Proofs section SPLITS into "Proofs from @username's axioms" (the covered
   * premise-sets) vs a collapsed "other known proofs". The split lives on the
   * proposition panel (the proposition is the subject — "which of MY axioms prove
   * this"); omitted off-profile → the plain global Proofs list.
   */
  coveredPropositionIds?: ReadonlySet<string> | null;
  /** (D33) Profile user's username — woven into the covered group's header. */
  username?: string | null;
  /** Forwarded verbatim to `PanelShell`, whose docs carry the focus contract a host container must honour. */
  renderMobileContainer?: PanelShellProps["renderMobileContainer"];
  /** Passed straight through; relevant only alongside `renderMobileContainer`. */
  hostSuppliesFocusMarker?: PanelShellProps["hostSuppliesFocusMarker"];
  /** Host-owned sections rendered inside the shell's loaded body — so they
   *  inherit its `hasData` gate rather than rendering over a skeleton or an
   *  error — placed ABOVE the Equivalences section. `/graph` passes its Graph
   *  Connections list. */
  bodyExtras?: React.ReactNode;
}

// Identity section — the proposition's stable id + a caption naming the
// provenance of the rendered phrasing. A proposition stores no token tree of
// its own; the design (§ "Held-proposition rendering — representative
// phrasing") resolves `p` as the EARLIEST-PUBLISHED occurrence's token tree, so
// the Identity section names that provenance rather than a publisher / file
// (which a proposition, being membership-level, does not have). The id renders
// in a mono chip selectable for copy/share.
function IdentitySection({ data }: { data: PropData }) {
  return (
    <section className={styles.section} aria-label="Identity">
      <h2 className={styles.propTitle}>Proposition</h2>
      <code className={styles.qualifiedName}>{data.proposition_id}</code>
      <p className={styles.attribution}>
        Rendered from the earliest-published occurrence of this proposition.
      </p>
    </section>
  );
}

// The author/empty toggle on the Expression section header — the shared
// RenderViewToggle (CO-3). Scope-explicit "Panel view" label matches the def
// panel's toggle so the two inspection surfaces read consistently.
function ViewToggle({
  view,
  onViewChange,
}: {
  view: ViewChoice;
  onViewChange: (next: ViewChoice) => void;
}) {
  return (
    <RenderViewToggle
      view={view}
      onViewChange={onViewChange}
      ariaLabel="Panel view"
      className={styles.viewToggle}
    />
  );
}

// Expression section — the clean conclusion `p`. Author view prefers the
// representative occurrence's source slice when the backend can provide one,
// preserving authored macro/notation syntax; otherwise it falls back to the
// token-tree phrasing. Identifiers inside `p` are DEF references (cross-type
// pivot via onSelectDef).
//
// SYNTAX HIGHLIGHTING — rendered through TokenTreeView's STANDARD default path,
// the SAME settings a theorem/axiom signature uses. The phrasing's in-CE
// identifiers arrive with their `def_id`s resolved server-side, so the default
// renderer paints them clickable (`?def=` pivots) and coloured — the focal
// phrasing reads as highlighted Lean exactly like a signature does. Genuine
// stdlib / prelude refs (null def_id) correctly grey out via the default
// use-site / unresolved dimming, the same de-emphasis dense source relies on.
function ExpressionSection({
  data,
  view,
  onViewChange,
  onSelectDef,
}: {
  data: PropData;
  view: ViewChoice;
  onViewChange: PropositionPanelProps["onViewChange"];
  onSelectDef: PropositionPanelProps["onSelectDef"];
}) {
  const source = data.p_author_source ?? null;
  // `p` is a TokenTreePair: `empty` is always present; `author` is null in the
  // common case. Fall back to `empty` when the visitor picked author but there
  // is no source slice / author tree, and to a bare caption when even `empty` is
  // missing (defensive — the wire always carries `empty`).
  const tree =
    view.kind === "author"
      ? (data.p?.author ?? data.p?.empty ?? null)
      : (data.p?.empty ?? null);
  return (
    <section className={styles.section} aria-label="Expression">
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Expression</h3>
        <ViewToggle view={view} onViewChange={onViewChange} />
      </header>
      {/* A <div>, not a <pre>: TokenTreeView emits inline spans. `.codeSurface`
       * (white-space: pre-wrap) preserves the rendered phrasing's layout —
       * same container the def panel uses for its tree path. */}
      <div className={styles.codeSurface}>
        {view.kind === "author" && source !== null ? (
          <ShikiSlice
            source={source.file_content}
            range={source.author_byte_range}
            tokens={source.source_tokens}
            onIdentifierClick={onSelectDef}
          />
        ) : tree !== null && tree !== undefined ? (
          <TokenTreeView tree={tree} onIdentifierClick={onSelectDef} />
        ) : (
          <span className={styles.noValue}>(no rendered phrasing)</span>
        )}
      </div>
    </section>
  );
}

// Skeleton state — shown while prop_data is null. Renders shadcn `Skeleton`
// rectangles in the rough shape of the loaded panel (Identity heading +
// Expression code block + a couple of section strips) so the visitor sees the
// right COMPOSITION before the data lands. Distinct from the def skeleton (no
// Value / Source-location blocks — the prop panel drops those sections).
function LoadingSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading">
      <span className={styles.srOnly}>Loading proposition</span>
      <section className={styles.section} aria-hidden="true">
        {/* Identity: heading + id caption + provenance line. */}
        <Skeleton className={styles.skeletonHeading} />
        <Skeleton className={styles.skeletonCaption} />
        <Skeleton className={styles.skeletonLine} />
      </section>
      <section className={styles.section} aria-hidden="true">
        {/* Expression: section title + code surface. */}
        <Skeleton className={styles.skeletonSectionTitle} />
        <Skeleton className={styles.skeletonCodeSurface} />
      </section>
      <section className={styles.section} aria-hidden="true">
        {/* Supports / Holders: section title + a row strip. */}
        <Skeleton className={styles.skeletonSectionTitle} />
        <Skeleton className={styles.skeletonLine} />
      </section>
    </div>
  );
}

// Panel body — the proposition-specific section tree. Rendered by `PanelShell`
// only in the "loaded" branch (the shell owns the skeleton / error / idle
// surfaces), so `prop_data` is always non-null here. The Proofs / Adoption /
// Equivalences sections are the SHARED components (proposition-sections.tsx) the
// def panel also grafts; here (D33) `coveredPropositionIds` drives the
// covered/uncovered "Proofs from @username's axioms" split — the proposition IS
// the subject, so this is where the split is useful. `activeFileId={null}` ⇒
// proof names are always fully qualified (no active file on a prop panel).
function PanelBody({
  prop_data,
  view,
  coveredPropositionIds,
  username,
  onViewChange,
  onSelectDef,
  onSelectProp,
  onHoldersDrillIn,
  bodyExtras,
}: {
  prop_data: PropData;
  view: ViewChoice;
  coveredPropositionIds?: ReadonlySet<string> | null;
  username?: string | null;
  onViewChange: PropositionPanelProps["onViewChange"];
  onSelectDef: PropositionPanelProps["onSelectDef"];
  onSelectProp: PropositionPanelProps["onSelectProp"];
  onHoldersDrillIn: PropositionPanelProps["onHoldersDrillIn"];
  bodyExtras: React.ReactNode;
}) {
  return (
    <>
      <IdentitySection data={prop_data} />
      <ExpressionSection
        data={prop_data}
        view={view}
        onViewChange={onViewChange}
        onSelectDef={onSelectDef}
      />
      <SupportsSection
        supports={prop_data.supports}
        onSelectDef={onSelectDef}
        coveredPropositionIds={coveredPropositionIds ?? null}
        propositionId={prop_data.proposition_id}
        username={username ?? null}
        activeFileId={null}
      />
      <HoldersSection data={prop_data} onHoldersDrillIn={onHoldersDrillIn} />
      {bodyExtras}
      <EquivalencesSection
        equivalences={prop_data.equivalences}
        onSelectDef={onSelectDef}
        onSelectProp={onSelectProp}
        coveredPropositionIds={coveredPropositionIds ?? null}
        username={username ?? null}
        activeFileId={null}
      />
    </>
  );
}

export function PropositionPanel({
  prop_id,
  prop_data,
  view,
  state,
  errorStatus = null,
  history,
  onBack,
  onForward,
  onClose,
  onRetry,
  onViewChange,
  onSelectDef,
  onSelectProp,
  onHoldersDrillIn,
  coveredPropositionIds = null,
  username = null,
  renderMobileContainer,
  hostSuppliesFocusMarker,
  bodyExtras = null,
}: PropositionPanelProps) {
  const open = prop_id !== null;

  // PanelShell owns ALL shared chrome — the viewport-adaptive container
  // (desktop docked pane vs mobile Sheet), focus capture/restore, the desktop
  // Esc handler, the DrillDownNav strip, the Close button, and the skeleton /
  // error / idle surfaces. PropositionPanel supplies only the prop-specific
  // body, the prop skeleton, and its surface metadata. No header extras (the
  // prop panel has no "View in file" affordance — a proposition is not a
  // file-resident def).
  return (
    <PanelShell
      open={open}
      state={state}
      hasData={prop_data !== null}
      errorStatus={errorStatus}
      history={history}
      onBack={onBack}
      onForward={onForward}
      onClose={onClose}
      onRetry={onRetry}
      ariaLabel="Proposition inspection"
      surfaceId={PROP_PANEL_ID}
      focusKey={prop_id}
      sheetTitle={state === "loading" ? "Loading proposition" : "Proposition"}
      headerExtras={null}
      loadingSkeleton={<LoadingSkeleton />}
      renderMobileContainer={renderMobileContainer}
      hostSuppliesFocusMarker={hostSuppliesFocusMarker}
    >
      {/* Rendered only in the shell's "loaded" branch, so `prop_data` is
       * non-null here. */}
      {prop_data !== null ? (
        <>
          <PanelBody
            prop_data={prop_data}
            view={view}
            coveredPropositionIds={coveredPropositionIds}
            username={username}
            onViewChange={onViewChange}
            onSelectDef={onSelectDef}
            onSelectProp={onSelectProp}
            onHoldersDrillIn={onHoldersDrillIn}
            bodyExtras={bodyExtras}
          />
        </>
      ) : null}
    </PanelShell>
  );
}
