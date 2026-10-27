"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { HoldingBar } from "@/components/theorem-flowchart-rf/nodes/holding-bar";
import { isFalseTokenPair } from "@/components/theorem-flowchart-rf/nodes/is-false-prop";

import { TokenTreeView } from "./token-tree";
import {
  buildEquivalenceGroups,
  coveredProofsEmptyText,
  equivalenceHeadline,
  HELD_DIRECTLY_EMPTY,
  premiseLabel,
  premisesCovered,
  supportDisplayName,
  type EquivalenceGroup,
} from "./equivalence-grouping";
import type { PropData, PropEquivalence, PropSupport, TokenTree } from "./types";
import styles from "./side-panel.module.css";

// Shared proposition section components — the **Supports**, **Adoption**, and
// **Equivalences** sections used by BOTH the proposition panel
// (proposition-panel.tsx, the `?prop=` surface) AND the def side panel
// (side-panel.tsx) when a declaration's conclusion is a proposition
// (user-profile-page.md D28). Extracted here so the def panel REUSES the real
// components rather than copying them (the internal best practice "real components, not
// one-offs"); the proposition panel renders these identically to before.
//
// Callback prop types are declared locally (not tied to PropositionPanelProps)
// so either panel can supply them.

/** Cross-type pivot — an identifier / certificate def was chosen → `?def=`. */
export type OnSelectDef = (target: {
  def_id: string;
  qualified_name: string;
}) => void;
/** Same-axis pivot — an Iff-equivalent proposition was chosen → `?prop=`. */
export type OnSelectProp = (proposition_id: string) => void;
/**
 * Open the searchable Holders/Rejecters modal. The Adoption section resolves the
 * target proposition itself (the Con side → the negation) and passes it, so the
 * host just opens its modal on `proposition_id`.
 */
export type OnHoldersDrillIn = (args: {
  side: "pro" | "con";
  proposition_id: string;
  element: HTMLElement;
}) => void;

// `theorem <name>` as a minimal token tree, rendered through the shared
// TokenTreeView so a proof row FACES its certificate with the real theorem name
// — Lean-keyword `theorem` + a clickable identifier carrying the cert's def_id
// (the click pivots the def panel to `?def=def_id`). `display` is the surface
// label (leaf or FQ, per `supportDisplayName`); `qualifiedName` stays the FULL
// `<file_id>.<localname>` so the click/hover pivot always carries the real name.
function theoremNameTree(
  display: string,
  qualifiedName: string,
  defId: string,
): TokenTree {
  return {
    node: "append",
    children: [
      {
        node: "tag",
        tag: {
          kind: "keyword",
          text: "theorem",
          qualified_name: null,
          def_id: null,
          token_id: `${defId}::support::kw`,
          hover_kind: null,
          binder_role: null,
          inlined_type_summary: null,
        },
        child: { node: "text", text: "theorem" },
      },
      { node: "text", text: " " },
      {
        node: "tag",
        tag: {
          kind: "identifier",
          text: display,
          qualified_name: qualifiedName,
          def_id: defId,
          token_id: `${defId}::support::name`,
          hover_kind: "term",
          binder_role: "def_site",
          inlined_type_summary: null,
        },
        child: { node: "text", text: display },
      },
    ],
  };
}

// One proof row — a distinct argument-for, FACED by the certificate's theorem.
// The theorem NAME is the clickable affordance (pivots the DEF panel to the
// certificate, whose Identity section gates the "View theorem page" link on
// `decl.kind === "theorem"`, so a theorem-backed cert reaches its Theorem Page
// one drill in and a `user_theorem` wrapper correctly shows none). The subline
// carries only the premise count; `concludes_false` is a small lockout marker.
// `premise_axiom_ids` (PROPOSITION ids, per the propositions-endpoint wire) drive
// the covered/uncovered split — never shown directly, never treated as def_ids.
function SupportRow({
  support,
  onSelectDef,
  activeFileId,
}: {
  support: PropSupport;
  onSelectDef: OnSelectDef;
  activeFileId?: string | null;
}) {
  const premiseLabel =
    support.premise_count === 1
      ? "1 premise"
      : `${support.premise_count} premises`;
  // The cert name should always resolve; fall back to the bare def_id so a row
  // is never empty — AND never throws — if the wire omitted `name` (a stale
  // cached response from before the field shipped, or a cert with no def row).
  const fqName =
    support.name && support.name.length > 0 ? support.name : support.def_id;
  const display = supportDisplayName(fqName, activeFileId);
  return (
    <li className="flex flex-col gap-1 px-2.5 py-2">
      {/* The certificate's theorem, faced by its name — clickable (→ `?def=`) and
       * syntax-highlighted via the shared token renderer. Leaf vs FQ per
       * `supportDisplayName`; the pivot always carries the full name. */}
      {/* `break-words` + `min-w-0`: a fully-qualified certificate name is ONE
       * unbreakable word — `x7n6za4d.rejecting_atomism_blocks_the_atomic_…` —
       * and the token renderer emits bare inline spans with no wrapping rules
       * of its own (deliberately: it preserves the source-shaped wrapping of
       * whatever contains it). With nothing to break on, the row ran straight
       * out past the card's right edge and the tail was unreadable. `min-w-0`
       * is the other half — a flex item's default `min-width: auto` refuses to
       * shrink below its content, so the break rule alone would not bind. */}
      <div className="min-w-0 break-words text-[13px] leading-snug">
        <TokenTreeView
          tree={theoremNameTree(display, fqName, support.def_id)}
          onIdentifierClick={onSelectDef}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
        <span>{premiseLabel}</span>
        {support.concludes_false ? (
          <span className="rounded bg-[var(--base08)]/10 px-1 py-px font-medium text-[var(--base08)]">
            concludes False
          </span>
        ) : null}
      </div>
    </li>
  );
}

// A titled group of proof rows — the section chrome shared by the single
// (no-split) Proofs list and the covered group of the split. `header` lets the
// split's covered group pass a "Proofs from @username's axioms" heading that
// still uses `.sectionTitle` but inlines the profile user's highlighted
// `@handle` (a `text-primary` span); `title` is always the aria-label.
function SupportsGroup({
  title,
  header,
  supports,
  onSelectDef,
  emptyText,
  activeFileId,
}: {
  title: string;
  header?: React.ReactNode;
  supports: PropSupport[];
  onSelectDef: OnSelectDef;
  emptyText: string;
  activeFileId?: string | null;
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <header className={styles.sectionHeader}>
        {header ?? <h3 className={styles.sectionTitle}>{title}</h3>}
      </header>
      {supports.length === 0 ? (
        <p className={styles.sectionEmpty}>{emptyText}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col rounded-md border border-border p-0 [&>li+li]:border-t [&>li+li]:border-border">
          {supports.map((support) => (
            <SupportRow
              key={support.def_id}
              support={support}
              onSelectDef={onSelectDef}
              activeFileId={activeFileId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// The collapsed "Other known proofs" disclosure — the uncovered supports on a
// profile (proofs of this conclusion that the profile user's axioms do NOT
// cover). Collapsed by default: on a profile the covered set is what matters;
// the global landscape is one click away.
function OtherProofsDisclosure({
  supports,
  onSelectDef,
  activeFileId,
}: {
  supports: PropSupport[];
  onSelectDef: OnSelectDef;
  activeFileId?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const label =
    supports.length === 1
      ? "1 other known proof"
      : `${supports.length} other known proofs`;
  return (
    <section className={styles.section} aria-label="Other known proofs">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto justify-start px-2 py-1 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} Show {label}
      </Button>
      {open ? (
        <ul className="m-0 mt-1 flex list-none flex-col rounded-md border border-border p-0 [&>li+li]:border-t [&>li+li]:border-border">
          {supports.map((support) => (
            <SupportRow
              key={support.def_id}
              support={support}
              onSelectDef={onSelectDef}
              activeFileId={activeFileId}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// Proofs section — the distinct arguments-for, each FACED by its certificate's
// theorem.
//
// `coveredPropositionIds` is the D33 covered/uncovered overlay: when the host
// (the proposition panel on a profile) supplies the profile user's held
// axiom-proposition ids, the global proofs are partitioned into the user-relative
// COVERED set ("Proofs from @username's axioms" — a premise-set is covered iff
// every premise proposition is held) plus a collapsed "other known proofs" group.
// When it is null/undefined (the def panel, or any off-profile surface) the single
// user-independent "Proofs" list renders — proofs are global; only the split is
// user-relative, and it's useful on a PROPOSITION (which of my axioms prove this),
// not a theorem (whose proving theorem is already the subject).
export function SupportsSection({
  supports,
  onSelectDef,
  coveredPropositionIds = null,
  propositionId = null,
  username = null,
  activeFileId = null,
}: {
  supports: PropSupport[];
  onSelectDef: OnSelectDef;
  coveredPropositionIds?: ReadonlySet<string> | null;
  /** The inspected proposition's id (the proposition panel supplies it). Drives
   *  the covered-group empty state: a proposition held by MEMBERSHIP (its id is in
   *  `coveredPropositionIds`) is held without a derived proof, so the empty copy
   *  must say so rather than "no proof yet" — otherwise it contradicts the
   *  Adoption section, which counts the user as a holder of exactly this
   *  proposition. Only read when the split is active. */
  propositionId?: string | null;
  /** Profile user's username — woven into the covered group's sentence-case
   *  "Proofs from @username's axioms" header. Only used when the split is active
   *  (the proposition panel on a profile). */
  username?: string | null;
  /** File the inspected DECLARATION lives in (a def panel) — proof rows show the
   *  bare leaf for same-file certs, FQ for cross-file. `null` (proposition panel)
   *  ⇒ always FQ. */
  activeFileId?: string | null;
}) {
  if (coveredPropositionIds === null || coveredPropositionIds === undefined) {
    return (
      <SupportsGroup
        title="Proofs"
        supports={supports}
        onSelectDef={onSelectDef}
        emptyText={HELD_DIRECTLY_EMPTY}
        activeFileId={activeFileId}
      />
    );
  }
  // A premise-set is covered iff every premise proposition is held by the user
  // ([].every === true ⇒ a premise-free settled fact is covered for everyone).
  // The SAME `premisesCovered` predicate the Equivalences split applies.
  const covered = supports.filter((s) =>
    premisesCovered(s.premise_axiom_ids, coveredPropositionIds),
  );
  const other = supports.filter((s) => !covered.includes(s));
  // The covered group's header uses `.sectionTitle` (now title-case, not
  // uppercase) and inlines the profile user's highlighted `@handle` so it reads
  // naturally — "Proofs from @alice's axioms".
  const coveredTitle = username
    ? `Proofs from @${username}'s axioms`
    : "Proofs from your axioms";
  return (
    <>
      <SupportsGroup
        title={coveredTitle}
        header={
          username ? (
            <h3 className={styles.sectionTitle}>
              Proofs from{" "}
              <span className="text-primary">@{username}</span>
              {"'s axioms"}
            </h3>
          ) : (
            <h3 className={styles.sectionTitle}>Proofs from your axioms</h3>
          )
        }
        supports={covered}
        onSelectDef={onSelectDef}
        emptyText={coveredProofsEmptyText(propositionId, coveredPropositionIds)}
        activeFileId={activeFileId}
      />
      {other.length > 0 ? (
        <OtherProofsDisclosure
          supports={other}
          onSelectDef={onSelectDef}
          activeFileId={activeFileId}
        />
      ) : null}
    </>
  );
}

// Adoption section — the aggregate pro / con split, rendered with the SAME
// `HoldingBar` the Theorem Page premise/conclusion nodes show. Clicking the bar
// opens the host-owned searchable HoldersModal. `rejecters === null` is passed as
// con 0 (the bar's neutral/empty affordance), NOT a hidden con side.
//
// A bare `False` proposition has no Adoption section at all — the same rule the
// theorem-page card applies by dropping its footer. A contradiction is not a
// claim a reader can take a side on, so the panel must not offer one.
export function HoldersSection({
  data,
  onHoldersDrillIn,
}: {
  data: PropData;
  onHoldersDrillIn: OnHoldersDrillIn;
}) {
  if (isFalseTokenPair(data.p)) return null;
  return (
    <section className={styles.section} aria-label="Adoption">
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Adoption</h3>
      </header>
      {/* Full-width wrapper: `HoldingBar`'s root is `flex: 1 1 auto`, so it needs
       * a flex parent to span the section width like it spans a node footer. */}
      <div className="flex w-full">
        {<HoldingBar
          propositionId={data.proposition_id}
          holdings={{ pro: data.holders, con: data.rejecters ?? 0 }}
          onBadgeActivate={(args) => {
            // The Con side drills the NEGATION's holders, the Pro side this
            // proposition's. Resolve the target here (the section owns the data)
            // so the host just opens its modal on it. Con with no negation row →
            // nothing to drill.
            const target =
              args.side === "con"
                ? data.negation_proposition_id
                : data.proposition_id;
            if (target === null) return;
            onHoldersDrillIn({
              side: args.side,
              proposition_id: target,
              element: args.element,
            });
          }}
        />}
      </div>
    </section>
  );
}

// The proof subline — "via <witness theorem name> · N premises". The witness IS
// the PROOF of the equivalence, DEMOTED below the equivalent proposition's
// statement headline (the re-faced row): its `name` is rendered as a clickable
// `theorem <name>` via the shared token renderer (→ `?def=witness.def_id`, where
// the witness's premises live), the SAME face a Proofs row shows. `name` guarded
// to the bare def_id; `premise_count` guarded to 0. Shared by the primary row's
// subline AND the "other proofs of this equivalence" disclosure rows so the
// witness reads identically whichever surface it faces.
function WitnessViaLine({
  witness,
  onSelectDef,
  activeFileId,
}: {
  witness: PropEquivalence;
  onSelectDef: OnSelectDef;
  activeFileId?: string | null;
}) {
  // Guard `name`: an absent/empty witness name falls back to the bare def_id so
  // the row is never empty (and `.length` never throws on a stale element).
  const fqName =
    witness.name && witness.name.length > 0 ? witness.name : witness.def_id;
  const display = supportDisplayName(fqName, activeFileId);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
      <span>via</span>
      {/* The witnessing Iff theorem, faced by its name — clickable (→ `?def=`)
       * and syntax-highlighted via the shared token renderer. */}
      <span className="leading-snug">
        <TokenTreeView
          tree={theoremNameTree(display, fqName, witness.def_id)}
          onIdentifierClick={onSelectDef}
        />
      </span>
      <span aria-hidden="true">·</span>
      <span>{premiseLabel(witness.premise_count ?? 0)}</span>
    </div>
  );
}

// A bare witness row — an extra Iff witness of the SAME equivalence, faced by the
// shared "via <name> · N premises" proof line (clickable → its DEF panel, where
// the premises live). Used inside the "other proofs of this equivalence"
// disclosure (the primary witness already faces the group's row subline).
function EquivalenceWitnessRow({
  witness,
  onSelectDef,
  activeFileId,
}: {
  witness: PropEquivalence;
  onSelectDef: OnSelectDef;
  activeFileId?: string | null;
}) {
  return (
    <li className="px-2.5 py-2">
      <WitnessViaLine
        witness={witness}
        onSelectDef={onSelectDef}
        activeFileId={activeFileId}
      />
    </li>
  );
}

// The collapsed "other proofs of this equivalence" disclosure — the EXTRA Iff
// witnesses of one equivalence (the primary already faces the group's row).
// Mirrors `OtherProofsDisclosure`, but nests INSIDE the primary row's <li> (a
// <div>, not a <section>) since these witnesses belong to that single
// equivalence. Collapsed by default: the chosen face is what matters.
function OtherEquivalenceWitnessesDisclosure({
  witnesses,
  onSelectDef,
  activeFileId,
}: {
  witnesses: PropEquivalence[];
  onSelectDef: OnSelectDef;
  activeFileId?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const label =
    witnesses.length === 1
      ? "1 other proof of this equivalence"
      : `${witnesses.length} other proofs of this equivalence`;
  return (
    <div className="mt-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto justify-start px-2 py-1 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} Show {label}
      </Button>
      {open ? (
        <ul className="m-0 mt-1 flex list-none flex-col rounded-md border border-border p-0 [&>li+li]:border-t [&>li+li]:border-border">
          {witnesses.map((w) => (
            <EquivalenceWitnessRow
              key={w.def_id}
              witness={w}
              onSelectDef={onSelectDef}
              activeFileId={activeFileId}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// One equivalence row — a logical `P ↔ Q` equivalence, RE-FACED (frontend
// redesign) by the equivalent proposition Q's STATEMENT. Propositions have no
// names — only ids + statements — so the prominent HEADLINE renders Q's statement
// (`equivalent_phrasing.empty`) via the shared token renderer, prefixed with a
// "≡ " marker; the WHOLE headline opens Q's proposition panel
// (`onSelectProp(equivalent_proposition_id)`). The witnessing Iff theorem (the
// PROOF) is DEMOTED to the secondary "via <name> · N premises" subline (click →
// the theorem's def panel, where its premises live). A group with >1 witness
// appends the "other proofs of this equivalence" disclosure.
//
// HEADLINE INTERACTIVITY — the statement is rendered NON-interactively (no
// `onIdentifierClick`), but `TokenTreeView` still stamps `role="button"` /
// `tabIndex={0}` on every in-CE identifier span (def_ids resolved server-side),
// so the headline CANNOT be a `<button>` (interactive descendants are invalid
// inside a native button). It is a `<div role="button" tabIndex={0}>` with a
// keyboard handler instead. The click handler is `onClickCapture` (capture phase)
// so a click landing on one of those identifier spans — whose own bubble-phase
// `event.stopPropagation()` would otherwise swallow it — still opens Q: the
// capture handler fires on the way DOWN, before the span's bubble handler runs.
// The whole statement opening Q's panel is the point.
function EquivalenceRow({
  group,
  onSelectDef,
  onSelectProp,
  activeFileId,
}: {
  group: EquivalenceGroup;
  onSelectDef: OnSelectDef;
  onSelectProp: OnSelectProp;
  activeFileId?: string | null;
}) {
  const primary = group.primary;
  // HEADLINE FACE, chosen by `equivalenceHeadline`'s fallback chain (Q's
  // STATEMENT → REPRESENTATIVE declaration name → bare `equivalent_proposition_id`
  // — each wire field guarded, since a stale air/next-rebuild response may omit
  // them and an unguarded read crashed the panel). Every face is rendered
  // NON-interactively and sits inside the one clickable headline that opens Q's
  // prop panel (so the rep face pivots `?prop=`, NOT `?def=` — the headline is Q,
  // not the rep def).
  const headline = equivalenceHeadline(group);
  const openProp = () => onSelectProp(group.propId);
  return (
    <li className="flex flex-col gap-1.5 px-2.5 py-2">
      {/* HEADLINE — Q's statement (or rep name / bare id), the whole thing opens
       * Q's proposition panel. A <div role="button"> (NOT <button>) because the
       * rendered statement contains interactive identifier spans; `onClickCapture`
       * beats those spans' bubble-phase stopPropagation so identifier hits open Q
       * too. */}
      <div
        role="button"
        tabIndex={0}
        className={`${styles.codeSurface} cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
        onClickCapture={openProp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openProp();
          }
        }}
        title="Open the equivalent proposition"
      >
        <span aria-hidden="true" className="mr-1 select-none text-muted-foreground">
          ≡
        </span>
        {headline.kind === "statement" ? (
          // Non-interactive: NO onIdentifierClick (the whole headline → `?prop=`).
          <TokenTreeView tree={headline.statement} />
        ) : headline.kind === "representative" ? (
          // Statement absent → face Q by its representative's `theorem <name>`,
          // still non-interactive (the headline pivots to Q, not the rep def).
          <TokenTreeView
            tree={theoremNameTree(
              supportDisplayName(headline.name, activeFileId),
              headline.name,
              headline.defId,
            )}
          />
        ) : (
          // Last resort → the bare proposition id (mono), still opens Q.
          <span className="font-mono">{headline.propId}</span>
        )}
      </div>
      {/* SUBLINE — the PROOF, demoted: "via <witness name> · N premises". */}
      <WitnessViaLine
        witness={primary}
        onSelectDef={onSelectDef}
        activeFileId={activeFileId}
      />
      {group.others.length > 0 ? (
        <OtherEquivalenceWitnessesDisclosure
          witnesses={group.others}
          onSelectDef={onSelectDef}
          activeFileId={activeFileId}
        />
      ) : null}
    </li>
  );
}

// A titled group of equivalence rows — the section chrome shared by the single
// (no-split) Equivalences list and the covered group of the split. Mirrors
// `SupportsGroup`: `header` lets the split's covered group pass an "Equivalences
// from @username's axioms" heading with the profile user's highlighted `@handle`;
// `title` is always the aria-label.
function EquivalencesGroupSection({
  title,
  header,
  groups,
  onSelectDef,
  onSelectProp,
  emptyText,
  activeFileId,
}: {
  title: string;
  header?: React.ReactNode;
  groups: EquivalenceGroup[];
  onSelectDef: OnSelectDef;
  onSelectProp: OnSelectProp;
  emptyText: string;
  activeFileId?: string | null;
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <header className={styles.sectionHeader}>
        {header ?? <h3 className={styles.sectionTitle}>{title}</h3>}
      </header>
      {groups.length === 0 ? (
        <p className={styles.sectionEmpty}>{emptyText}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col rounded-md border border-border p-0 [&>li+li]:border-t [&>li+li]:border-border">
          {groups.map((g) => (
            <EquivalenceRow
              key={g.propId}
              group={g}
              onSelectDef={onSelectDef}
              onSelectProp={onSelectProp}
              activeFileId={activeFileId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// The collapsed "other known equivalences" disclosure — the UNCOVERED equivalence
// groups on a profile (equivalences none of whose witnesses the profile user's
// axioms cover). Mirrors `OtherProofsDisclosure`, operating on GROUPS rather than
// individual rows: collapsed by default, the global landscape one click away.
function OtherEquivalencesDisclosure({
  groups,
  onSelectDef,
  onSelectProp,
  activeFileId,
}: {
  groups: EquivalenceGroup[];
  onSelectDef: OnSelectDef;
  onSelectProp: OnSelectProp;
  activeFileId?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const label =
    groups.length === 1
      ? "1 other known equivalence"
      : `${groups.length} other known equivalences`;
  return (
    <section className={styles.section} aria-label="Other known equivalences">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto justify-start px-2 py-1 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} Show {label}
      </Button>
      {open ? (
        <ul className="m-0 mt-1 flex list-none flex-col rounded-md border border-border p-0 [&>li+li]:border-t [&>li+li]:border-border">
          {groups.map((g) => (
            <EquivalenceRow
              key={g.propId}
              group={g}
              onSelectDef={onSelectDef}
              onSelectProp={onSelectProp}
              activeFileId={activeFileId}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// Equivalences section — the Iff-linked propositions, each logical equivalence
// RE-FACED by the equivalent proposition Q's STATEMENT (the prominent headline,
// "≡ <statement>", click → Q's proposition panel) with the witnessing Iff theorem
// DEMOTED to the row's "via <name> · N premises" proof subline (click → the
// theorem's def panel). Mirrors the Proofs section (SupportsSection): distinct
// wire elements sharing a partner proposition are GROUPED into one row, and when
// the host supplies the profile context the groups SPLIT into covered/uncovered.
//
// `coveredPropositionIds` + `username` are the D33 covered/uncovered overlay,
// gated on BOTH being present (the proposition panel on a profile): the groups
// partition into the user-relative COVERED set ("Equivalences from @username's
// axioms" — a group is covered iff ≥1 witness's premise propositions are all
// held) plus a collapsed "other known equivalences" disclosure. When either is
// absent (the def-panel graft, or any off-profile surface) the single
// user-independent "Equivalences" list renders — the split is user-relative.
// `activeFileId` mirrors SupportsSection: the inspected def's home file (a def
// panel) shows bare-leaf witness names for same-file theorems, FQ for cross-file;
// `null` (the proposition panel) ⇒ always FQ.
export function EquivalencesSection({
  equivalences,
  onSelectDef,
  onSelectProp,
  coveredPropositionIds = null,
  username = null,
  activeFileId = null,
}: {
  equivalences: PropEquivalence[];
  onSelectDef: OnSelectDef;
  onSelectProp: OnSelectProp;
  coveredPropositionIds?: ReadonlySet<string> | null;
  /** Profile user's username — woven into the covered group's "Equivalences from
   *  @username's axioms" header. Only used when the split is active (the
   *  proposition panel on a profile). */
  username?: string | null;
  /** File the inspected DECLARATION lives in (a def panel) — witness names show
   *  the bare leaf for same-file theorems, FQ for cross-file. `null` (proposition
   *  panel) ⇒ always FQ. */
  activeFileId?: string | null;
}) {
  const coveredSet = coveredPropositionIds ?? null;
  // Group distinct wire elements that prove the SAME `P ↔ Q` into one logical
  // equivalence (one row per partner proposition); primary witness chosen
  // covered-first, then fewest premises, then smallest def_id.
  const groups = React.useMemo(
    () => buildEquivalenceGroups(equivalences, coveredSet),
    [equivalences, coveredSet],
  );

  // No equivalences at all → calm-absence copy (no split chrome).
  if (groups.length === 0) {
    return (
      <section className={styles.section} aria-label="Equivalences">
        <header className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Equivalences</h3>
        </header>
        <p className={styles.sectionEmpty}>
          No equivalent propositions recorded.
        </p>
      </section>
    );
  }

  // Off-profile (or missing username) → a single flat list, no covered split.
  if (coveredSet === null || !username) {
    return (
      <EquivalencesGroupSection
        title="Equivalences"
        groups={groups}
        onSelectDef={onSelectDef}
        onSelectProp={onSelectProp}
        emptyText="No equivalent propositions recorded."
        activeFileId={activeFileId}
      />
    );
  }

  // Profile split — covered groups (≥1 witness covered by the user's axioms) under
  // the highlighted header, the rest in a collapsed disclosure below. Mirrors the
  // Proofs split's covered group + "other known proofs" disclosure.
  const covered = groups.filter((g) => g.covered);
  const other = groups.filter((g) => !g.covered);
  return (
    <>
      <EquivalencesGroupSection
        title={`Equivalences from @${username}'s axioms`}
        header={
          <h3 className={styles.sectionTitle}>
            Equivalences from <span className="text-primary">@{username}</span>
            {"'s axioms"}
          </h3>
        }
        groups={covered}
        onSelectDef={onSelectDef}
        onSelectProp={onSelectProp}
        emptyText="No equivalence from these axioms yet."
        activeFileId={activeFileId}
      />
      {other.length > 0 ? (
        <OtherEquivalencesDisclosure
          groups={other}
          onSelectDef={onSelectDef}
          onSelectProp={onSelectProp}
          activeFileId={activeFileId}
        />
      ) : null}
    </>
  );
}
