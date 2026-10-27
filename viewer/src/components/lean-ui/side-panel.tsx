"use client";

import { PublisherName } from "@/components/publisher-name";
import * as React from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";

import { byteLen } from "./byte-len";
import { cssAttrEscape } from "./dom-utils";
import inTextLinkStyles from "./in-text-link.module.css";
import {
  isConstructorMember,
  isDisplayableField,
} from "./member-classification";
import {
  PanelShell,
  type PanelShellProps,
  type PanelState,
} from "./panel-shell";
import { ViewTheoremPageLink } from "./view-theorem-page-link";
import { RenderViewToggle } from "./render-view-toggle";
import { ShikiSlice } from "./shiki-slice";
import { TokenTreeView } from "./token-tree";
import {
  PREMISE_COLLAPSE_THRESHOLD,
  PREMISES_VISIBLE_WHEN_COLLAPSED,
  PROP_PANEL_ID,
  SIDE_PANEL_ID,
} from "./types";
import type {
  Decl,
  DeclarationMember,
  DefData,
  TheoremStatement,
  TheoremStatementNode,
  TokenTree,
  ViewChoice,
} from "./types";
import {
  EquivalencesSection,
  HoldersSection,
  SupportsSection,
  type OnHoldersDrillIn,
  type OnSelectProp,
} from "./proposition-sections";
import type { IdentifierPopoverHandlers } from "./use-identifier-popover";
import { usePropData } from "./use-prop-data";
import { useReferencedBy } from "./use-referenced-by";
import styles from "./side-panel.module.css";

// The fetch-lifecycle state is owned by `PanelShell` (the shell branches on
// it to pick skeleton / error / body). Re-exported here so existing
// `import { ..., type PanelState } from ".../side-panel"` sites keep
// compiling.
export type { PanelState };

// Side panel for declaration inspection — the sibling of the Lean UI
// Component the design at the internal lean-ui-component doc § "Side
// panel component" specifies. The host page owns URL state (`?def=`) and
// fetching; the panel is a pure renderer with click / view-change /
// close / view-in-file events.
//
// CHROME — viewport-adaptive, two distinct mounts.
//
// Desktop & tablet (>= md / 768px): a DOCKED IDE-style pane. The panel
// renders as a plain div tree (header + scrollable body) inside the host
// shell's resizable column — no Radix Dialog, no overlay, no focus trap, no
// click-outside-to-close. The pane participates in the global tab order; X
// and `Esc` are the only close affordances; clicks anywhere outside the pane
// (including the file body, the page chrome, scrollbars) do NOT dismiss it.
// See the design doc § "Side panel as a docked IDE-style pane (not an
// overlay sheet)" and § "Web rendering > Side panel" for the rationale.
//
// Mobile (< md / 768px): the v1 BOTTOM SHEET. shadcn's `Sheet` (Radix
// Dialog) renders modal, with a dimmed overlay, focus trap, and click-
// outside-to-close — the expected gesture for a covering pane on a narrow
// viewport (a covered surface that you "click out of"). The mobile chrome
// is preserved verbatim from v1.
//
// HEADER OFFSET — on mobile the Sheet base is `fixed inset-x-0 bottom-0`;
// nothing to offset. The desktop docked pane lives INSIDE the host shell's
// `ResizablePanel` (it does not portal), so it composes with the page's
// existing header / layout naturally — no JS measurement, no portaled-
// surface positioning custom property.
//
// SECTIONS (per design § "Side panel component"):
//   1. Identity   — local_name (mono heading), qualified_name (caption),
//                   "Published in <file_id> by @<publisher>" row.
//   2. Type       — TokenTreeView for type_tokens[view.kind] with the
//                   panel's author/empty toggle.
//   3. Value      — Collapsible (expanded by default) wrapping
//                   TokenTreeView for value_tokens[view.kind]; "(no value)"
//                   line for axioms whose value_tokens === null.
//   4. Source loc — Lines <start>-<end> (or Line <n> when start === end),
//                   plain text.
//   5. Referenced by — reverse-reference list from the def's panel data
//                      (see `useReferencedBy`). Rows are buttons that drill the panel into the
//                      referencing decl via `onIdentifierClick`, mirroring
//                      the OutlineSection drill-down pattern.
//
// LOADING STATE — when `loading === true && def_data === null`, render a
// skeleton (no useful data to display yet). Parent should keep the panel
// open during the fetch so the slide-in animation isn't restarted on the
// data landing.
//
// VIEW-IN-FILE BUTTON — hidden when there is no `def_data` (still
// loading) OR when the def's home file IS the currently-displayed file
// (no navigation target). The parent computes the latter and passes it
// as `canViewInFile` so the panel does not need to learn the current
// `file_id` from props.

export interface SidePanelProps {
  /** Currently-selected declaration's UUID, or null for the closed state. */
  def_id: string | null;
  /**
   * Fetched declaration data. Non-null only when `state === "loaded"`;
   * the panel renders the skeleton or error surface otherwise.
   */
  def_data: DefData | null;
  /** Panel's own view (independent of any list view on the host page). */
  view: ViewChoice;
  /** Fetch lifecycle state — see `PanelState` for the four values. */
  state: PanelState;
  /**
   * HTTP status code when the fetch landed on a non-OK response. Surfaced
   * in the error state as muted "HTTP <n>" copy so a developer (or a
   * curious visitor) sees what failed without opening DevTools. Only set
   * when `state === "error"` AND the failure was a non-OK response (not a
   * network throw / parse error — those leave it undefined).
   */
  errorStatus?: number | null;
  /**
   * Whether the "View in file" affordance should show — true iff
   * `def_data.decl.file_id !== currentlyDisplayedFileId`. Computed by
   * the host so the panel does not need to learn the current file id.
   */
  canViewInFile?: boolean;
  /**
   * In-panel drill-down stack affordance state. The host's
   * `useDefSelection` hook owns the stack; the panel just receives the
   * boolean flags and emits the events below when the chrome buttons
   * are pressed. See the design doc § "In-panel drill-down history".
   */
  history: {
    can_back: boolean;
    can_forward: boolean;
  };
  /** Host walks the drill-down stack back one step. */
  onBack: () => void;
  /** Host walks the drill-down stack forward one step. */
  onForward: () => void;
  /**
   * The `def_id` of the theorem whose page currently hosts the panel, when on
   * a Theorem Page. The Identity section's "View theorem page" link is
   * suppressed for that def (navigate-to-theorem-page flow: "suppressed when
   * already on that page"). Undefined on the file / profile pages.
   */
  currentTheoremDefId?: string;
  /** Host clears `?def=` from the URL (using router.replace per the spec). */
  onClose: () => void;
  /**
   * Host re-fires the in-flight fetch when the visitor clicks "Retry"
   * on the error surface. Pass a callback that bumps a nonce in the
   * fetch effect's dependency list.
   */
  onRetry: () => void;
  /**
   * Identifier click inside panel content — host typically pushes a new
   * `?def=` to the URL.
   */
  onIdentifierClick: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  /**
   * OPTIONAL identifier hover/focus popover handlers — the bundle
   * `useIdentifierPopover()` returns (a host owning its own popover state
   * passes an equivalent). Wired ⇒ identifiers inside the panel's rendered
   * Signature / Value / Conclusion / Premises show the same popover the file
   * body shows, in BOTH views (`onSliceHover` for the source-bytes
   * `ShikiSlice`, `onTreeHover` for the delab `TokenTreeView`). Absent ⇒ hover
   * is a no-op and the rendered DOM is unchanged — the click-only behaviour
   * every host had. `/search` wires none.
   */
  popover?: IdentifierPopoverHandlers;
  /** Host updates the panel's view-prop URL param (or local state). */
  onViewChange: (view: ViewChoice) => void;
  /**
   * Host decides: if on the file page and the def lives in a different
   * file, navigate to that file's page with `?def=<def_id>`.
   */
  onViewInFile: (def_id: string, file_id: string) => void;
  /**
   * "In this file" outline — the file-page's full `decls` array, threaded
   * in by `CeFileBody`. When provided (non-null, non-empty), the panel
   * renders an outline section between Identity and Type listing every
   * decl as a clickable row. `null` / `undefined` / `[]` suppresses the
   * section entirely (e.g. on the profile page, where the panel is not
   * anchored to a file).
   */
  fileOutline?: Decl[] | null;
  /**
   * Outline row click — host appends the picked decl onto the unified
   * drill-down stack (same call shape and semantics as every other
   * panel-changing selection; see `useDefSelection`). Only invoked when
   * `fileOutline` is non-empty.
   */
  onOutlineSelect?: (def_id: string) => void;
  /**
   * (D33) Same-axis pivot for the grafted Equivalences section — host calls
   * `selectProp(proposition_id)`. When omitted the Equivalences graft is
   * suppressed (the host has no proposition-panel surface to pivot to).
   */
  onSelectProp?: (proposition_id: string) => void;
  /**
   * (D28) Opens the searchable Holders/Rejecters modal for the grafted Adoption
   * section (the section resolves the target proposition itself — Con → the
   * negation). When omitted the Adoption graft is suppressed (no host modal).
   */
  onHoldersDrillIn?: (args: {
    side: "pro" | "con";
    proposition_id: string;
    element: HTMLElement;
  }) => void;
  /**
   * (D28) Fallback proposition id for the graft when the def is Prop-typed but
   * carries no wire `conclusion_prop` — e.g. an AXIOM (no entailment certificate).
   * The host (the profile) supplies the axiom's asserted proposition; the panel
   * grafts Adoption / Supports / Equivalences off it. The covered/uncovered split
   * stays theorem-only, so axioms show the plain global Supports.
   */
  conclusionPropHint?: string | null;
  /**
   * (D34) Profile user's coverage set + username — threaded to the grafted
   * Equivalences section so a profile's def panel splits "Equivalences from
   * @username's axioms" (≥1 witness whose premises ⊆ the user's axioms) vs the
   * rest, mirroring the proposition panel. Both null off-profile (theorem page /
   * search) ⇒ the graft renders the plain global Equivalences list.
   */
  coveredPropositionIds?: ReadonlySet<string> | null;
  username?: string | null;
  /**
   * Whether a theorem panel renders its Conclusion + Premises sections.
   * Defaults to true. The Theorem Page passes `false`: that page already
   * renders the theorem's full synthetic signature (premises + conclusion) as
   * its own primary surface, so the panel repeating it beside the flowchart is
   * duplication. Non-theorem panels are unaffected either way.
   */
  showTheoremStatement?: boolean;
  /** Forwarded verbatim to `PanelShell`, whose docs carry the focus contract a host container must honour. */
  renderMobileContainer?: PanelShellProps["renderMobileContainer"];
  /** Passed straight through; relevant only alongside `renderMobileContainer`. */
  hostSuppliesFocusMarker?: PanelShellProps["hostSuppliesFocusMarker"];
  /** Host-owned sections rendered inside the shell's loaded body — so they
   *  inherit its `hasData` gate rather than rendering over a skeleton or an
   *  error — placed ABOVE the Equivalences graft and the Referenced-by section.
   *  `/graph` passes its Graph Connections list. */
  bodyExtras?: React.ReactNode;
}

// Identity section — local_name as a large mono heading, qualified_name
// as a smaller caption, publisher attribution per design § "Publication,
// not authorship".
function IdentitySection({
  data,
  currentTheoremDefId,
}: {
  data: DefData;
  currentTheoremDefId?: string;
}) {
  const { decl } = data;
  // When the anchored decl is `theorem`-kind, the Identity section shows a
  // "View theorem page" link (navigate-to-theorem-page flow), suppressed when
  // the panel is anchored to the theorem whose page we're already on.
  const showTheoremLink =
    (decl.display_kind ?? decl.kind) === "theorem" &&
    decl.def_id !== currentTheoremDefId;
  // Publisher may be null when the publisher's user account has been
  // deleted (the API's LEFT JOIN ... ON DELETE SET NULL surfaces this).
  return (
    <section className={styles.section} aria-label="Identity">
      <h2 className={styles.localName}>{decl.local_name}</h2>
      <code className={styles.qualifiedName}>{decl.qualified_name}</code>
      <p className={styles.attribution}>
        Published in <code className={styles.fileChip}>{decl.file_id}</code>
        {" "}
        by{" "}
        <PublisherName
          publisher={decl.publisher}
          className={inTextLinkStyles.link}
        />
      </p>
      {showTheoremLink ? (
        <p className={styles.theoremLink}>
          <ViewTheoremPageLink defId={decl.def_id} showLabel />
        </p>
      ) : null}
    </section>
  );
}

// The author/empty syntax toggle on the Signature section header is the shared
// RenderViewToggle (CO-3). Scope-explicit "Panel syntax" accessible name so the
// panel-local toggle is distinguishable from the page-level toggle when the
// panel sits alongside a Theorem Page (CO-9).
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
      ariaLabel="Panel syntax"
      className={styles.viewToggle}
    />
  );
}

// "(inferred)" marker for the Signature section's delab fallback. The design §
// "Author-view extraction" requires the marker whenever the type was NOT
// written in source (`def foo := 42`): there are no source bytes for the type,
// so we render the `type_tokens.author` delab tree under this caption.
function InferredBadge() {
  return <span className={styles.inferredBadge}>(inferred)</span>;
}

// "(universal)" marker for the author view's LAST-RESORT fallback: no source
// bytes AND no author delab tree, so the universal (empty-view) tree renders
// instead — named with the Syntax toggle's own display copy for that view
// ("Universal", render-view-toggle.tsx). This is a REAL steady-state class,
// not transient skew: generated declarations (structure field projections,
// macro-minted members — spec-extract-emission-completion.md §3.4) never
// carry authored sub-spans, and pre-backfill decls may lack them too
// (issue #1154 bug #2). Same muted caption styling as InferredBadge.
function UniversalBadge() {
  return <span className={styles.inferredBadge}>(universal)</span>;
}

// Signature section — author view renders from VERBATIM source bytes via
// `decl_sig_byte_range` (the common case), falling back to the delab
// `type_tokens.author` tree marked "(inferred)" when the type was not written
// in source (`decl_sig_byte_range === null`), and to the universal
// `type_tokens.empty` tree marked "(universal)" when the author tree is
// missing too (generated / pre-backfill decls). Empty view stays tree-based.
// Design migration step 7.
function SignatureSection({
  data,
  view,
  onViewChange,
  onIdentifierClick,
  popover,
}: {
  data: DefData;
  view: ViewChoice;
  onViewChange: SidePanelProps["onViewChange"];
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
  popover?: IdentifierPopoverHandlers;
}) {
  return (
    <section className={styles.section} aria-label="Signature">
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Signature</h3>
        <ViewToggle view={view} onViewChange={onViewChange} />
      </header>
      {/* A <div>, NOT a <pre>: ShikiSlice's returned hast carries Shiki's own
       * block-level `pre.shiki` element, so wrapping it in a <pre> here would
       * nest <pre> inside <pre> (invalid HTML) and leak the UA <pre> margin,
       * shifting the box when each highlight lands. The `.codeSurface` rule
       * already sets `white-space: pre-wrap`, so a <div> preserves the source's
       * whitespace; the `.codeSurface :global(pre.shiki)` reset neutralises the
       * inner pre's chrome. Mirrors ce-file-body.tsx's <div> container. */}
      <div className={styles.codeSurface}>
        <SignatureBody
          data={data}
          view={view}
          onIdentifierClick={onIdentifierClick}
          popover={popover}
        />
      </div>
    </section>
  );
}

// The signature's rendered content, without the section chrome. Shared with the
// theorem Conclusion section, which renders it as the byte-range FALLBACK when
// the decl carries no premise-DAG row.
function SignatureBody({
  data,
  view,
  onIdentifierClick,
  popover,
}: {
  data: DefData;
  view: ViewChoice;
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
  popover?: IdentifierPopoverHandlers;
}) {
  const { decl } = data;
  return (
    <>
      {view.kind === "author" ? (
        decl.decl_sig_byte_range !== null ? (
          // Common case — author view from source bytes.
          <ShikiSlice
            source={data.file_content}
            range={decl.decl_sig_byte_range}
            tokens={decl.source_tokens}
            onIdentifierClick={onIdentifierClick}
            onIdentifierHover={popover?.onSliceHover}
            onIdentifierLeave={popover?.onIdentifierLeave}
          />
        ) : decl.type_tokens.author !== null ? (
          // Inferred type — delab fallback with the "(inferred)" badge.
          <>
            <InferredBadge />
            <TokenTreeView
              tree={decl.type_tokens.author}
              onIdentifierClick={onIdentifierClick}
              onIdentifierHover={popover?.onTreeHover}
              onIdentifierLeave={popover?.onIdentifierLeave}
            />
          </>
        ) : (
          // No source bytes AND no author tree — a generated decl (structure
          // field projections and other compiler-minted members never carry
          // authored sub-spans) or a pre-backfill decl. The universal tree is
          // never null, so render IT under the "(universal)" badge rather
          // than a dead "(type unavailable)" placeholder that hides a
          // statement we hold (issue #1154 bug #2).
          <>
            <UniversalBadge />
            <TokenTreeView
              tree={decl.type_tokens.empty}
              onIdentifierClick={onIdentifierClick}
              onIdentifierHover={popover?.onTreeHover}
              onIdentifierLeave={popover?.onIdentifierLeave}
            />
          </>
        )
      ) : (
        // Empty view — unchanged tree path (empty is never null).
        <TokenTreeView
          tree={decl.type_tokens.empty}
          onIdentifierClick={onIdentifierClick}
          onIdentifierHover={popover?.onTreeHover}
          onIdentifierLeave={popover?.onIdentifierLeave}
        />
      )}
    </>
  );
}

// One statement node's TYPE — the same two-path render the Theorem Page's
// synthetic signature uses (theorem-syntax.tsx § renderNodeType): in the author
// view a node with an in-bounds `author_byte_range` renders its VERBATIM
// authored source (so notation that doesn't round-trip through delaboration
// still reads as written); otherwise its own token tree. `⋯` when the node
// predates the token backfill — a graceful blank, never a crash.
function StatementNodeType({
  node,
  data,
  view,
  onIdentifierClick,
  popover,
}: {
  node: TheoremStatementNode;
  data: DefData;
  view: ViewChoice;
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
  popover?: IdentifierPopoverHandlers;
}) {
  const range = node.author_byte_range;
  const useSourceBytes =
    view.kind === "author" &&
    range != null &&
    range.start >= 0 &&
    range.end > range.start &&
    range.end <= byteLen(data.file_content);
  if (useSourceBytes) {
    return (
      <ShikiSlice
        source={data.file_content}
        range={range}
        tokens={data.decl.source_tokens}
        onIdentifierClick={onIdentifierClick}
        onIdentifierHover={popover?.onSliceHover}
        onIdentifierLeave={popover?.onIdentifierLeave}
      />
    );
  }
  const tree =
    node.tokens === null
      ? null
      : view.kind === "author"
        ? (node.tokens.author ?? node.tokens.empty)
        : node.tokens.empty;
  return tree !== null ? (
    <TokenTreeView
      tree={tree}
      onIdentifierClick={onIdentifierClick}
      onIdentifierHover={popover?.onTreeHover}
      onIdentifierLeave={popover?.onIdentifierLeave}
    />
  ) : (
    <span className={styles.statementUnavailable}>⋯</span>
  );
}

// Conclusion section — the theorem-kind replacement for Signature. The content
// is the premise DAG's CONCLUSION NODE, never the declaration's signature byte
// range: the two coincide only for a binder-style theorem in the author view;
// for `theorem f : P → R`, in the universal view, and in the
// (inferred)/(universal) fallbacks the byte range spans the full type, premises
// included, so a section labelled Conclusion would show premises. A theorem with
// no DAG row (or a malformed blob) has no conclusion node; it degrades to the
// signature render under the same heading.
//
// This section owns the panel's ONE syntax toggle: it governs the Conclusion AND
// the Premises below, which read the same `view`.
function ConclusionSection({
  data,
  statement,
  view,
  onViewChange,
  onIdentifierClick,
  popover,
}: {
  data: DefData;
  statement: TheoremStatement | null;
  view: ViewChoice;
  onViewChange: SidePanelProps["onViewChange"];
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
  popover?: IdentifierPopoverHandlers;
}) {
  return (
    <section className={styles.section} aria-label="Conclusion">
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Conclusion</h3>
        <ViewToggle view={view} onViewChange={onViewChange} />
      </header>
      <div className={styles.codeSurface}>
        {statement !== null ? (
          <StatementNodeType
            node={statement.conclusion}
            data={data}
            view={view}
            onIdentifierClick={onIdentifierClick}
            popover={popover}
          />
        ) : (
          <SignatureBody
            data={data}
            view={view}
            onIdentifierClick={onIdentifierClick}
            popover={popover}
          />
        )}
      </div>
    </section>
  );
}

// Premises section — the theorem's hypotheses as telescope lines, `(name :
// type)` per line in declaration order, mirroring the Theorem Page's synthetic
// signature (theorem-syntax.tsx) including its collapse-past-4 chip. A premise
// NAME opens the proposition panel where the host wired `onSelectProp`; on a
// host that wired none (search) it renders as plain text rather than a dead
// control. A premise-free theorem renders an explicit empty line — the section
// is never silently absent when we know the answer is zero.
function PremisesSection({
  data,
  premises,
  view,
  onIdentifierClick,
  onSelectProp,
  popover,
}: {
  data: DefData;
  premises: TheoremStatementNode[];
  view: ViewChoice;
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
  onSelectProp?: SidePanelProps["onSelectProp"];
  popover?: IdentifierPopoverHandlers;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const collapses = premises.length > PREMISE_COLLAPSE_THRESHOLD;
  const showAll = !collapses || expanded;
  const visible = showAll
    ? premises
    : premises.slice(0, PREMISES_VISIBLE_WHEN_COLLAPSED);
  const hiddenCount = showAll
    ? 0
    : premises.length - PREMISES_VISIBLE_WHEN_COLLAPSED;

  return (
    <section className={styles.section} aria-label="Premises">
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Premises</h3>
      </header>
      {premises.length === 0 ? (
        <p className={styles.sectionEmpty}>
          This theorem rests on no premises.
        </p>
      ) : (
        <div className={styles.telescope}>
          {visible.map((premise, index) => {
            const propId = premise.proposition_id;
            // The wire emits `null` (not `undefined`) for an anonymous binder —
            // a `variable [Inst]` instance the elaborator names `inst✝` — so the
            // guard is `!= null` and such a premise renders as `(Type)` rather
            // than a malformed `( : Type)`.
            const binder =
              premise.name == null ? null : propId !== undefined &&
                onSelectProp !== undefined ? (
                <button
                  type="button"
                  className={styles.premiseBinderLink}
                  aria-haspopup="dialog"
                  aria-controls={PROP_PANEL_ID}
                  aria-label={`Open premise proposition ${premise.name}`}
                  onClick={() => onSelectProp(propId)}
                >
                  {premise.name}
                </button>
              ) : (
                <span className={styles.premiseBinder}>{premise.name}</span>
              );
            return (
              <div key={index} className={styles.premiseLine}>
                <span className={styles.punct}>(</span>
                {binder !== null ? (
                  <>
                    {binder}
                    <span className={styles.punct}> : </span>
                  </>
                ) : null}
                <StatementNodeType
                  node={premise}
                  data={data}
                  view={view}
                  onIdentifierClick={onIdentifierClick}
                  popover={popover}
                />
                <span className={styles.punct}>)</span>
              </div>
            );
          })}
          {hiddenCount > 0 ? (
            <button
              type="button"
              className={styles.premiseMoreChip}
              onClick={() => setExpanded(true)}
              aria-expanded={false}
            >
              <span aria-hidden="true">⋯</span>
              {hiddenCount} more {hiddenCount === 1 ? "premise" : "premises"}
            </button>
          ) : null}
          {collapses && expanded ? (
            <button
              type="button"
              className={styles.premiseMoreChip}
              onClick={() => setExpanded(false)}
              aria-expanded
            >
              show fewer
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function memberLeafName(ownerQualifiedName: string, member: DeclarationMember) {
  const prefix = `${ownerQualifiedName}.`;
  return member.qualified_name.startsWith(prefix)
    ? member.qualified_name.slice(prefix.length)
    : member.local_name;
}

function MemberListSection({
  title,
  members,
  ownerQualifiedName,
  onSelectProp,
}: {
  title: "Fields" | "Constructors";
  members: DeclarationMember[];
  ownerQualifiedName: string;
  onSelectProp?: SidePanelProps["onSelectProp"];
}) {
  if (members.length === 0) return null;
  return (
    <section className={styles.section} aria-label={title}>
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
      </header>
      <ul className={styles.memberList}>
        {members.map((member) => (
          <li key={member.def_id} className={styles.memberRow}>
            {member.conclusion_prop !== null &&
            member.conclusion_prop !== undefined &&
            onSelectProp !== undefined ? (
              <button
                type="button"
                className={styles.memberName}
                onClick={() => onSelectProp(member.conclusion_prop!)}
              >
                {memberLeafName(ownerQualifiedName, member)}
              </button>
            ) : (
              <span className={styles.memberName}>
                {memberLeafName(ownerQualifiedName, member)}
              </span>
            )}
            <span className={styles.memberKind} aria-hidden="true">
              {member.display_kind ?? member.kind}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The Value-section collapsible body. Lifted out of ValueSection so the
// `open` state hook lives in a component scope (hooks may not run inside
// the conditional branch ValueSection takes for axioms). The trigger
// renders the accessible label as real text — "Expand" / "Collapse" —
// keyed off the controlled `open` state, not CSS ::before content
// (SR support for generated content is inconsistent).
//
// Author view renders from VERBATIM source bytes via `decl_val_byte_range`;
// empty view stays tree-based. There is NO inferred fallback on the value side
// (the `null` case is `axiom`, handled by ValueSection before this renders);
// when the byte range is missing (generated / pre-backfill decls) the author
// view falls back to the universal tree under "(universal)". `empty` is never
// null. Design migration step 7.
function CollapsibleValue({
  data,
  view,
  empty,
  onIdentifierClick,
  popover,
}: {
  data: DefData;
  view: ViewChoice;
  empty: TokenTree;
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
  popover?: IdentifierPopoverHandlers;
}) {
  const [open, setOpen] = React.useState(true);
  const { decl } = data;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Value</h3>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.collapseTrigger}
          >
            <span className={styles.chevron} aria-hidden="true">
              ▸
            </span>
            <span className={styles.collapseLabel}>
              {open ? "Collapse" : "Expand"}
            </span>
          </Button>
        </CollapsibleTrigger>
      </header>
      <CollapsibleContent>
        {/* <div>, NOT <pre> — see TypeSection's codeSurface note: ShikiSlice
         * emits its own block-level `pre.shiki`, so a wrapping <pre> would nest
         * <pre> and box-shift on highlight. `.codeSurface` keeps the whitespace
         * via `white-space: pre-wrap`. */}
        <div className={styles.codeSurface}>
          {view.kind === "author" ? (
            decl.decl_val_byte_range !== null ? (
              // Common case — author view from source bytes. (No inferred
              // fallback: value bytes always exist when value_tokens !== null.)
              <ShikiSlice
                source={data.file_content}
                range={decl.decl_val_byte_range}
                tokens={decl.source_tokens}
                onIdentifierClick={onIdentifierClick}
                onIdentifierHover={popover?.onSliceHover}
                onIdentifierLeave={popover?.onIdentifierLeave}
              />
            ) : (
              // Value present but no byte range — generated / pre-backfill
              // decls (the validator's pairing invariant never produces this
              // for authored decls). Render the universal tree under the
              // "(universal)" badge — `empty` is never null — instead of a
              // dead "(value unavailable)" placeholder (issue #1154 bug #2).
              <>
                <UniversalBadge />
                <TokenTreeView
                  tree={empty}
                  onIdentifierClick={onIdentifierClick}
                  onIdentifierHover={popover?.onTreeHover}
                  onIdentifierLeave={popover?.onIdentifierLeave}
                />
              </>
            )
          ) : (
            // Empty view — unchanged tree path (empty is never null).
            <TokenTreeView
              tree={empty}
              onIdentifierClick={onIdentifierClick}
              onIdentifierHover={popover?.onTreeHover}
              onIdentifierLeave={popover?.onIdentifierLeave}
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ValueSection({
  data,
  view,
  onIdentifierClick,
  onSelectProp,
  popover,
}: {
  data: DefData;
  view: ViewChoice;
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
  onSelectProp?: SidePanelProps["onSelectProp"];
  popover?: IdentifierPopoverHandlers;
}) {
  const pair = data.decl.value_tokens;
  const displayKind = data.decl.display_kind ?? data.decl.kind;

  // Axiom — no value to render. Show a flat "(no value)" line per the
  // design (no misleading collapsible toggle). UNCHANGED branch.
  if (pair === null) {
    const members = data.members ?? [];
    if (displayKind === "inductive_type" && members.length > 0) {
      const fields = members.filter(isDisplayableField);
      const constructors = members.filter(isConstructorMember);
      if (fields.length > 0) {
        return (
          <MemberListSection
            title="Fields"
            members={fields}
            ownerQualifiedName={data.decl.qualified_name}
            onSelectProp={onSelectProp}
          />
        );
      }
      if (constructors.length > 0) {
        return (
          <MemberListSection
            title="Constructors"
            members={constructors}
            ownerQualifiedName={data.decl.qualified_name}
            onSelectProp={onSelectProp}
          />
        );
      }
    }
    return (
      <section className={styles.section} aria-label="Value">
        <header className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Value</h3>
        </header>
        <p className={styles.noValue}>(no value)</p>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-label="Value">
      {/* Track open state in React so the trigger label can render as
       * real text ("Expand" / "Collapse") instead of CSS ::before
       * content — screen-reader behaviour on generated content is
       * inconsistent across the AT matrix, and the accessible name
       * needs to be reliably exposed. Radix's Collapsible
       * exposes controlled open via `open` + `onOpenChange`. */}
      <CollapsibleValue
        data={data}
        view={view}
        empty={pair.empty}
        onIdentifierClick={onIdentifierClick}
        popover={popover}
      />
    </section>
  );
}

// "In this file" outline — a flat list of every decl in the file the panel
// is anchored to. Renders between Identity and Type so visitors landing on
// a decl can quickly see what else is in the file and jump to it without
// returning to the source body. The currently-selected decl row is marked
// `aria-current="true"` and styled distinctly so the visitor sees their
// place in the file.
//
// SCROLL TARGET — the outline scrolls the SELECTED (anchored) row into view
// on every change of `currentDefId`. No body-scroll tracking — the visitor
// owns "which decl is open"; the outline follows their CLICKS, not their
// scroll position. Honours `prefers-reduced-motion`.
function OutlineSection({
  outline,
  currentDefId,
  onSelect,
}: {
  outline: Decl[];
  currentDefId: string | null;
  onSelect: (def_id: string) => void;
}) {
  const listRef = React.useRef<HTMLUListElement | null>(null);

  // Scroll the SELECTED row into view inside the outline scroller (the
  // outline has `max-height: 12rem; overflow-y: auto`). `block: "nearest"`
  // avoids the unnecessary recentre when the row is already in view.
  // `behavior: "auto"` honours reduced-motion; otherwise smooth.
  //
  // No body-scroll tracking — the outline used to auto-scroll the
  // topmost-visible-in-body row into view, but that competed with the
  // panel's primary "follow the user's clicks" affordance. The outline
  // now only tracks SELECTION: when you click decl A in the body or pivot
  // to it inside the panel, the outline scrolls to A.
  React.useEffect(() => {
    if (currentDefId === null) return;
    const list = listRef.current;
    if (list === null) return;
    const row = list.querySelector<HTMLElement>(
      `[data-row-def-id="${cssAttrEscape(currentDefId)}"]`,
    );
    if (row === null) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({
      block: "nearest",
      behavior: prefersReduced ? "auto" : "smooth",
    });
  }, [currentDefId]);

  return (
    <section className={styles.section} aria-label="In this file">
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>In this file</h3>
      </header>
      <ul className={styles.outlineList} ref={listRef}>
        {outline.map((decl) => {
          const current = decl.def_id === currentDefId;
          return (
            <li key={decl.def_id}>
              <button
                type="button"
                className={styles.outlineRow}
                aria-current={current ? "true" : undefined}
                data-row-def-id={decl.def_id}
                onClick={() => onSelect(decl.def_id)}
              >
                <span className={styles.outlineLocalName}>
                  {decl.local_name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Referenced by — the reverse-reference list. Rows are buttons that drill the
// panel into the referencing decl via the same `onIdentifierClick` callback
// every other in-panel link uses — keeping the drill-down history shape
// uniform.
//
// ROW SHAPE — stacked two-line richer rows (NOT the single-line
// `.outlineRow` the file outline uses): `local_name` on top as the
// primary mono label, `qualified_name` underneath muted + smaller for
// disambiguation, plus a small uppercase muted `kind` chip on the
// trailing edge (`def` / `theorem` / `instance` / …). Pulled out of
// `.outlineRow` because the file-outline rows are single-token labels
// (no qualifier to surface, no kind to display) and polluting the
// outline-row vocabulary with referenced-by-shaped chrome would make
// future outline-row tweaks reverberate into a section they don't
// concern. The new class is `.referencedByRow`.
//
// States mirror the panel's primary fetch lifecycle:
//   - loading                 — three stacked skeleton strips telegraphing
//                               the list shape, wrapped in role="status"
//                               so AT users hear "Loading references"
//                               (CO-8, CO-13).
//   - error                   — an inline apology line + a Retry button
//                               wired to the hook's retry() (CO-2, CO-12).
//   - populated, items.length === 0 — "Nothing references this declaration."
//                                     muted line (CO-11).
//   - populated, items.length  > 0 — a ul/li list of .referencedByRow
//                                    rows.
//
// The body wrapper is `aria-live="polite"` so transitions between the
// loading skeleton and the resolved surface (list / empty / error) are
// announced to AT users instead of swapping silently (CO-10).
function ReferencedBySection({
  defId,
  onIdentifierClick,
}: {
  defId: string;
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
}) {
  const { data: items, state, retry } = useReferencedBy(defId);

  let body: React.ReactNode;
  if (state === "error") {
    // Align with the parent ErrorSection's tone — same .errorMessage
    // tokens, same AlertCircle icon (smaller — secondary section), plus
    // a Retry button wired to the hook's retry() so a transient failure
    // doesn't trap the visitor on the error surface for the panel's
    // lifetime (CO-2, CO-12).
    body = (
      <>
        <p className={styles.errorMessage} role="alert">
          <AlertCircle
            className={styles.errorIcon}
            aria-hidden="true"
            size={14}
          />
          <span>Couldn&apos;t load references.</span>
        </p>
        <p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </p>
      </>
    );
  } else if (state === "loading") {
    // Three stacked skeleton strips telegraph "list of rows incoming"
    // rather than the single 2.5rem strip that read as a summary line
    // (CO-13). Wrapped in role="status" + sr-only label so AT users hear
    // "Loading references" instead of silence (CO-8).
    body = (
      <div
        className={styles.referencedBySkeletonStack}
        role="status"
        aria-label="Loading references"
      >
        <span className={styles.srOnly}>Loading references</span>
        <Skeleton
          className={styles.referencedBySkeletonRow}
          aria-hidden="true"
        />
        <Skeleton
          className={styles.referencedBySkeletonRow}
          aria-hidden="true"
        />
        <Skeleton
          className={styles.referencedBySkeletonRow}
          aria-hidden="true"
        />
      </div>
    );
  } else if (items === null) {
    body = null;
  } else if (items.length === 0) {
    // Use `.sectionEmpty` (sans-serif, italic muted) rather than `.noValue`
    // — the latter is monospaced for "(no value)" in the axiom Value
    // section and reads wrong on a prose line (CO-7). Copy disambiguates
    // "we couldn't compute" from "the answer is zero" (CO-11).
    body = (
      <p className={styles.sectionEmpty}>
        Nothing references this declaration.
      </p>
    );
  } else {
    body = (
      <>
        <ul className={styles.referencedByList}>
          {items.map((item) => (
            <li key={item.def_id}>
              <button
                type="button"
                className={styles.referencedByRow}
                // `title` for sighted hover (mobile: no hover, but harmless
                // and matches the file-outline pattern). `aria-label` is the
                // load-bearing AT exposure: `title` is unreliable on mobile,
                // inconsistent across NVDA/JAWS/VoiceOver, and frequently
                // missing on keyboard focus — when two referenced decls
                // share local_name, AT users need the qualifier to tell
                // them apart (CO-9). The qualified_name is ALSO rendered as
                // a visible muted second line below — the aria-label is
                // still required (the visible second line is plain text,
                // not part of the button's accessible name in the
                // computed-accessible-name algorithm Chrome / Firefox / WK
                // use without explicit aria-label).
                title={item.qualified_name}
                aria-label={item.qualified_name}
                onClick={() =>
                  onIdentifierClick({
                    def_id: item.def_id,
                    qualified_name: item.qualified_name,
                  })
                }
              >
                <span className={styles.referencedByRowLabels}>
                  <span className={styles.referencedByLocalName}>
                    {item.local_name}
                  </span>
                  <span className={styles.referencedByQualifiedName}>
                    {item.qualified_name}
                  </span>
                </span>
                {/* Kind chip — small uppercase muted tag (`def`, `theorem`,
                 * `instance`, …). aria-hidden because the kind value is
                 * already in the row's title/aria-label context via the
                 * qualified_name's namespace, and a screen reader announcing
                 * every row's kind on top of the qualified name reads as
                 * noise. The visible chip is sighted-only disambiguation. */}
                <span
                  className={styles.referencedByKindChip}
                  aria-hidden="true"
                >
                  {item.display_kind ?? item.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <section
      className={styles.section}
      aria-label="Referenced by"
    >
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Referenced by</h3>
      </header>
      {/* aria-live="polite" wraps the resolved body so the loading →
       * list / loading → empty / loading → error transition announces to
       * AT users instead of swapping silently (CO-10). aria-atomic="false"
       * so only the changed substring is read — the section heading is
       * stable and shouldn't re-read on every transition. */}
      <div aria-live="polite" aria-atomic="false">
        {body}
      </div>
    </section>
  );
}

// Skeleton state — shown while def_data is null. Renders shadcn `Skeleton`
// rectangles matching the panel's section layout (Identity heading,
// Type code block, Value code block) so the visitor sees the right
// COMPOSITION before the data lands — the standard "skeleton screen"
// idiom (Facebook, GitHub, Vercel dashboard). The `Skeleton` primitive
// gates its `animate-pulse` on `motion-safe:` so prefers-reduced-motion
// users get a still surface. The `role="status"` + sr-only "Loading"
// text keeps AT users informed; the rectangles themselves are
// `aria-hidden`.
function LoadingSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading">
      <span className={styles.srOnly}>Loading declaration</span>
      <section className={styles.section} aria-hidden="true">
        {/* Identity: local_name + qualified_name + publication line. */}
        <Skeleton className={styles.skeletonHeading} />
        <Skeleton className={styles.skeletonCaption} />
        <Skeleton className={styles.skeletonLine} />
      </section>
      <section className={styles.section} aria-hidden="true">
        {/* Type: section title + code surface (multiple lines). */}
        <Skeleton className={styles.skeletonSectionTitle} />
        <Skeleton className={styles.skeletonCodeSurface} />
      </section>
      <section className={styles.section} aria-hidden="true">
        {/* Value: section title + code surface. */}
        <Skeleton className={styles.skeletonSectionTitle} />
        <Skeleton className={styles.skeletonCodeSurface} />
      </section>
    </div>
  );
}

// "View in file" affordance. Hidden when there is no def_data (still
// loading) OR when the def's home file IS the currently-displayed file
// (canViewInFile is false). Shared by both the desktop docked chrome and
// the mobile Sheet chrome.
//
// Rendered as a REAL anchor (styled with `Button asChild`) so the browser's
// right-click context menu ("Open Link in New Tab"), middle-click, and
// ⌘/Ctrl-click all work for free.
// Plain primary click is intercepted for SPA navigation via the host's
// `onViewInFile` callback — modifier / non-primary clicks fall through to
// the browser. Mirrors the FileRefLink pattern in
// render-hast.tsx; the URL shape (`/f/<file>?def=<def>`) is the same one
// all three hosts (CE file page, profile page, theorem page) push via
// router.push.
function ViewInFileButton({
  data,
  onViewInFile,
}: {
  data: DefData;
  onViewInFile: SidePanelProps["onViewInFile"];
}) {
  const href = `/f/${encodeURIComponent(data.decl.file_id)}?def=${encodeURIComponent(data.decl.def_id)}`;
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    onViewInFile(data.decl.def_id, data.decl.file_id);
  };
  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className={styles.viewInFileButton}
    >
      <a href={href} onClick={onClick}>
        View in file
      </a>
    </Button>
  );
}

// Proposition social sections (D28) — when the inspected declaration is
// Prop-typed (it DENOTES a proposition, `def_data.conclusion_prop` — a theorem's
// conclusion OR an axiom / `def … : Prop`'s asserted proposition), graft the
// proposition's Supports / Adoption / Equivalences, REUSING the shared
// proposition-section components (proposition-sections.tsx) rather than copying
// them. Self-fetches the proposition payload via `usePropData` — the same
// self-fetching-section pattern `ReferencedBySection` uses — so the host need
// not thread a second fetch through. A secondary enhancement: while the fetch is
// loading or on error it renders nothing (the def's own sections stand alone).
//
// Adoption / Equivalences render only when the host wired their callbacks (the
// profile workbench does). The def panel always shows the PLAIN global Proofs
// list — the covered/uncovered "proofs from your axioms" split (D33) now lives
// only on the proposition panel, where it answers "which of my axioms prove THIS
// proposition" (on a theorem panel the proving theorem is already the subject).
// `activeFileId` is this def's home file, so cross-file proof names render FQ.
function ConclusionSections({
  conclusionProp,
  activeFileId,
  onSelectDef,
  onSelectProp,
  onHoldersDrillIn,
  coveredPropositionIds,
  username,
  preEquivalences = null,
}: {
  conclusionProp: string;
  activeFileId: string;
  /** Host slot rendered immediately above the Equivalences graft. */
  preEquivalences?: React.ReactNode;
  onSelectDef: SidePanelProps["onIdentifierClick"];
  onSelectProp?: OnSelectProp;
  onHoldersDrillIn?: OnHoldersDrillIn;
  coveredPropositionIds?: ReadonlySet<string> | null;
  username?: string | null;
}) {
  const { propData, state } = usePropData(conclusionProp);
  // The graft fetches the conclusion proposition SEPARATELY from the def, so it
  // resolves a beat after the rest of the panel. Hold the space with section
  // skeletons during that window (instead of nothing) so the Proofs / Adoption /
  // Equivalences sections don't pop in disruptively later.
  if (state === "loading") {
    return (
      <ConclusionSectionsSkeleton
        showHolders={onHoldersDrillIn !== undefined}
        showEquivalences={onSelectProp !== undefined}
      />
    );
  }
  if (propData === null) {
    // Idle / error — the graft is a secondary enhancement; stay silent rather
    // than push an error surface into the def's own sections.
    return null;
  }
  return (
    <>
      <SupportsSection
        supports={propData.supports}
        onSelectDef={onSelectDef}
        activeFileId={activeFileId}
      />
      {onHoldersDrillIn !== undefined ? (
        <HoldersSection data={propData} onHoldersDrillIn={onHoldersDrillIn} />
      ) : null}
      {preEquivalences}
      {onSelectProp !== undefined ? (
        <EquivalencesSection
          equivalences={propData.equivalences}
          onSelectDef={onSelectDef}
          onSelectProp={onSelectProp}
          coveredPropositionIds={coveredPropositionIds ?? null}
          username={username ?? null}
          activeFileId={activeFileId}
        />
      ) : null}
    </>
  );
}

// Section-shaped placeholders for the grafted proposition sections — mirrors
// `LoadingSkeleton`'s vocabulary (a `.sectionTitle`-height strip over a content
// block) so Proofs / Adoption / Equivalences hold their space while the
// conclusion-proposition fetch is in flight. Purely visual (`aria-hidden`).
function ConclusionSectionsSkeleton({
  showHolders,
  showEquivalences,
}: {
  showHolders: boolean;
  showEquivalences: boolean;
}) {
  return (
    <div aria-hidden="true">
      <section className={styles.section}>
        <Skeleton className={styles.skeletonSectionTitle} />
        <Skeleton className={styles.skeletonCodeSurface} />
      </section>
      {showHolders ? (
        <section className={styles.section}>
          <Skeleton className={styles.skeletonSectionTitle} />
          <Skeleton className={styles.skeletonLine} />
        </section>
      ) : null}
      {showEquivalences ? (
        <section className={styles.section}>
          <Skeleton className={styles.skeletonSectionTitle} />
          <Skeleton className={styles.skeletonLine} />
        </section>
      ) : null}
    </div>
  );
}

// Panel body — the def-specific section tree (Identity / outline / Type /
// Value / Referenced-by). Rendered by `PanelShell` only in the "loaded" branch
// (the shell owns the skeleton / error / idle surfaces), so `def_data` is always
// non-null here.
function PanelBody({
  def_data,
  view,
  fileOutline,
  currentDefId,
  onViewChange,
  onIdentifierClick,
  onOutlineSelect,
  currentTheoremDefId,
  onSelectProp,
  onHoldersDrillIn,
  conclusionPropHint,
  coveredPropositionIds,
  username,
  showTheoremStatement,
  popover,
  bodyExtras,
}: {
  bodyExtras: React.ReactNode;
  def_data: DefData;
  view: ViewChoice;
  fileOutline: Decl[] | null;
  currentDefId: string | null;
  showTheoremStatement: boolean;
  popover?: IdentifierPopoverHandlers;
  onViewChange: SidePanelProps["onViewChange"];
  onIdentifierClick: SidePanelProps["onIdentifierClick"];
  onOutlineSelect: (def_id: string) => void;
  currentTheoremDefId?: string;
  onSelectProp?: SidePanelProps["onSelectProp"];
  onHoldersDrillIn?: SidePanelProps["onHoldersDrillIn"];
  conclusionPropHint?: string | null;
  coveredPropositionIds?: ReadonlySet<string> | null;
  username?: string | null;
}) {
  // (D28) Prop-typed defs without a wire `conclusion_prop` (axioms) graft off the
  // host-supplied hint; theorems use the wire value.
  const conclusionProp =
    typeof def_data.conclusion_prop === "string" &&
    def_data.conclusion_prop.length > 0
      ? def_data.conclusion_prop
      : (conclusionPropHint ?? null);
  // Same predicate the Identity section's "View theorem page" link gates on:
  // `display_kind ?? kind`, which resolves a projection field to "field".
  const isTheorem =
    (def_data.decl.display_kind ?? def_data.decl.kind) === "theorem";
  const statement = def_data.theorem_statement ?? null;
  return (
    <>
      <IdentitySection
        data={def_data}
        currentTheoremDefId={currentTheoremDefId}
      />
      {/* "In this file" outline — rendered between Identity and Type so the
       * visitor sees the file's table of contents right after the identity
       * heading. Suppressed when no outline was passed (profile-page mount)
       * or when the file has zero decls. */}
      {fileOutline !== null && fileOutline.length > 0 ? (
        <OutlineSection
          outline={fileOutline}
          currentDefId={currentDefId}
          onSelect={onOutlineSelect}
        />
      ) : null}
      {/* A theorem's statement replaces the Signature / Value pair: Conclusion
       * (the DAG conclusion node) over Premises (its telescope). No Value — a
       * proof body is type-checked, and "View in file" reaches the source. On
       * the Theorem Page the sections are suppressed: that page renders the
       * whole synthetic signature itself, and duplicating it in the panel
       * beside it reads as noise. Projection fields are theorem-kind on the
       * wire but carry `display_kind: "field"`, so they take the non-theorem
       * branch unchanged. */}
      {isTheorem ? (
        showTheoremStatement ? (
          <>
            <ConclusionSection
              data={def_data}
              statement={statement}
              view={view}
              onViewChange={onViewChange}
              onIdentifierClick={onIdentifierClick}
              popover={popover}
            />
            {/* Suppressed only when there is no statement at all: a no-DAG
             * theorem's premises are unknown, and an empty-state line would
             * assert a zero we haven't established. */}
            {statement !== null ? (
              <PremisesSection
                data={def_data}
                premises={statement.premises}
                view={view}
                onIdentifierClick={onIdentifierClick}
                onSelectProp={onSelectProp}
                popover={popover}
              />
            ) : null}
          </>
        ) : null
      ) : (
        <>
          <SignatureSection
            data={def_data}
            view={view}
            onViewChange={onViewChange}
            onIdentifierClick={onIdentifierClick}
            popover={popover}
          />
          <ValueSection
            data={def_data}
            view={view}
            onIdentifierClick={onIdentifierClick}
            onSelectProp={onSelectProp}
            popover={popover}
          />
        </>
      )}
      {conclusionProp !== null &&
      (def_data.decl.display_kind ?? def_data.decl.kind) !== "field" ? (
        <ConclusionSections
          conclusionProp={conclusionProp}
          // (D33) Proofs render FQ when the cert lives in a different file. The
          // Proofs list stays the plain global list; (D34) Equivalences split
          // "from @username's axioms" when the profile coverage set is threaded.
          activeFileId={def_data.decl.file_id}
          onSelectDef={onIdentifierClick}
          onSelectProp={onSelectProp}
          onHoldersDrillIn={onHoldersDrillIn}
          coveredPropositionIds={coveredPropositionIds}
          username={username}
          preEquivalences={bodyExtras}
        />
      ) : (
        bodyExtras
      )}
      <ReferencedBySection
        defId={def_data.decl.def_id}
        onIdentifierClick={onIdentifierClick}
      />
    </>
  );
}

export function SidePanel({
  def_id,
  def_data,
  view,
  state,
  canViewInFile = false,
  history,
  onBack,
  onForward,
  currentTheoremDefId,
  onClose,
  onRetry,
  onIdentifierClick,
  popover,
  onViewChange,
  onViewInFile,
  fileOutline = null,
  onOutlineSelect,
  errorStatus = null,
  onSelectProp,
  onHoldersDrillIn,
  conclusionPropHint = null,
  coveredPropositionIds = null,
  username = null,
  showTheoremStatement = true,
  renderMobileContainer,
  hostSuppliesFocusMarker,
  bodyExtras = null,
}: SidePanelProps) {
  // Outline section is only rendered when the host wired both an outline AND
  // a select handler. Default-no-op the handler when only one is set so the
  // section's call site doesn't need null-check.
  const handleOutlineSelect = React.useCallback(
    (target_def_id: string) => {
      onOutlineSelect?.(target_def_id);
    },
    [onOutlineSelect],
  );
  const open = def_id !== null;
  // The "View in file" affordance only matters when the host says it
  // would be useful (def_data is present AND the def's home file is not
  // the currently-displayed one). The button is otherwise hidden — not
  // disabled — so the chrome stays uncluttered. Passed to PanelShell as
  // `headerExtras` (the def-panel's trailing-edge header control); the prop
  // panel passes none.
  const showViewInFile = canViewInFile && def_data !== null;

  // PanelShell owns ALL shared chrome — the viewport-adaptive container
  // (desktop docked pane vs mobile Sheet), focus capture/restore, the
  // desktop Esc handler, the DrillDownNav strip, the Close button, and the
  // skeleton / error / idle surfaces. SidePanel supplies only the
  // def-specific body, the def skeleton, and the `View in file` header extra.
  // The shell's render is a pure extraction of the previous inline chrome —
  // same DOM id, role, aria-label, Sheet markup, focus selectors, and
  // `data-side-panel-body` scroll-root marker.
  return (
    <PanelShell
      open={open}
      state={state}
      hasData={def_data !== null}
      errorStatus={errorStatus}
      history={history}
      onBack={onBack}
      onForward={onForward}
      onClose={onClose}
      onRetry={onRetry}
      ariaLabel="Declaration inspection"
      surfaceId={SIDE_PANEL_ID}
      focusKey={def_id}
      sheetTitle={
        def_data?.decl.local_name ??
        (state === "loading" ? "Loading declaration" : "Declaration")
      }
      headerExtras={
        showViewInFile ? (
          <ViewInFileButton data={def_data!} onViewInFile={onViewInFile} />
        ) : null
      }
      loadingSkeleton={<LoadingSkeleton />}
      renderMobileContainer={renderMobileContainer}
      hostSuppliesFocusMarker={hostSuppliesFocusMarker}
    >
      {/* Rendered only in the shell's "loaded" branch, so `def_data` is
       * non-null here. The non-null assertion mirrors the previous code path
       * (PanelBody was unreachable with null def_data once the skeleton /
       * error branches were taken). */}
      {def_data !== null ? (
        <>
          <PanelBody
            def_data={def_data}
            view={view}
            fileOutline={onOutlineSelect !== undefined ? fileOutline : null}
            currentDefId={def_id}
            onViewChange={onViewChange}
            onIdentifierClick={onIdentifierClick}
            onOutlineSelect={handleOutlineSelect}
            currentTheoremDefId={currentTheoremDefId}
            onSelectProp={onSelectProp}
            onHoldersDrillIn={onHoldersDrillIn}
            conclusionPropHint={conclusionPropHint}
            coveredPropositionIds={coveredPropositionIds}
            username={username}
            showTheoremStatement={showTheoremStatement}
            popover={popover}
            bodyExtras={bodyExtras}
          />
        </>
      ) : null}
    </PanelShell>
  );
}
