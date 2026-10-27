"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import {
  TokenTreeView,
  notationNamesFromSourceTokens,
} from "@/components/lean-ui/token-tree";
import { ShikiSlice } from "@/components/lean-ui/shiki-slice";
import { byteLen } from "@/components/lean-ui/byte-len";
import { shouldShowPopover } from "@/components/lean-ui/identifier-popover";
import type { PopoverTarget } from "@/components/lean-ui/identifier-popover";
import {
  PREMISE_COLLAPSE_THRESHOLD,
  PREMISES_VISIBLE_WHEN_COLLAPSED,
  PROP_PANEL_ID,
  SIDE_PANEL_ID,
} from "@/components/lean-ui/types";
import type {
  Decl,
  TokenTree,
  TokenTag,
  ViewChoice,
  SourceToken,
} from "@/components/lean-ui/types";
import type { RfFlowchartNode } from "@/components/theorem-flowchart-rf/types";

import styles from "./theorem-syntax.module.css";

// Synthetic theorem signature, rendered as a piece of Lean syntax in the
// Theorem Page's left info panel. NOT `decl.type_tokens` (the flat
// `P → Q → R` form): we RECONSTRUCT a telescope-shaped declaration from the
// premise DAG so each hypothesis reads on its own `(name : type)` line, exactly
// as an author writes it:
//
//   theorem <name>                       ← author view: local_name; empty: FQN
//       (moral_duty : Obligatory eat_plants)
//       (…)
//       ⋯ N more                          ← > 4 premises collapse after the 3rd
//     : <conclusion>
//
// The premise binder name comes from the node's snake_case `name`, forwarded on
// the wire from the validator; the premise TYPE and the conclusion come from
// each node's own author/empty TokenTreePair, rendered through the
// SAME `TokenTreeView` the flowchart cards and the file page use — so every
// in-CE identifier inside a type stays clickable into the Lean side panel and
// hoverable for the inline popover (the must-preserve behaviour), identical to
// the CE file page's clickable syntax.

export interface TheoremSyntaxProps {
  decl: Decl;
  /** Premise nodes in declaration (telescope) order, with recovered `name`s. */
  premises: RfFlowchartNode[];
  /** The single conclusion node, or null (pre-backfill DAG). */
  conclusion: RfFlowchartNode | null;
  /** Page-level author/empty lens. */
  view: ViewChoice;
  /**
   * Full source file text. When present, each premise/conclusion whose node
   * carries an `author_byte_range` renders its TYPE from the VERBATIM authored
   * source bytes (author view only) — the same source-bytes render the
   * flowchart cards and side panel use — instead of the delaborated token tree.
   */
  fileContent?: string;
  /** The theorem decl's `source_tokens`, sliced + rebased by `ShikiSlice`. */
  sourceTokens?: SourceToken[];
  /**
   * Collapsed mode (mobile): render ONLY the first `theorem <name>` line,
   * truncated to one line — the premises/conclusion are omitted. The first line
   * is the SAME syntax-highlighted element shown when expanded (it just wraps vs.
   * truncates), so the collapsed bar and the expanded head don't duplicate.
   */
  collapsed?: boolean;
  /**
   * Optional control rendered at the trailing edge of the first line (the mobile
   * expand/collapse chevron). Lives on the first line so the toggle sits with the
   * `theorem <name>` head in both states.
   */
  toggleSlot?: React.ReactNode;
  onIdentifierClick: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  onSelectProp: (proposition_id: string) => void;
  onIdentifierHover: (target: PopoverTarget) => void;
  onIdentifierLeave: () => void;
}

// Same derivation the proposition cards use: null tokens → null tree (graceful
// fallback), else author view prefers `author ?? empty`, empty always `empty`.
function pickTree(
  node: RfFlowchartNode,
  view: "author" | "empty",
): TokenTree | null {
  if (node.tokens === null) return null;
  return view === "author"
    ? (node.tokens.author ?? node.tokens.empty)
    : node.tokens.empty;
}

export function TheoremSyntax({
  decl,
  premises,
  conclusion,
  view,
  fileContent,
  sourceTokens,
  collapsed = false,
  toggleSlot,
  onIdentifierClick,
  onSelectProp,
  onIdentifierHover,
  onIdentifierLeave,
}: TheoremSyntaxProps) {
  const viewKind = view.kind === "author" ? "author" : "empty";
  const [expanded, setExpanded] = React.useState(false);

  const activateName = React.useCallback(
    () =>
      onIdentifierClick({
        def_id: decl.def_id,
        qualified_name: decl.qualified_name,
      }),
    [onIdentifierClick, decl.def_id, decl.qualified_name],
  );

  const activateProposition = React.useCallback(
    (node: RfFlowchartNode) => {
      if (node.proposition_id === undefined) return;
      onSelectProp(node.proposition_id);
    },
    [onSelectProp],
  );

  // Adapt TokenTreeView's hover shape ({ tag, element }) to the popover host's
  // shape ({ tag, element, rect }), capturing the rect at hover time — the SAME
  // adapter the flowchart cards + header signature use.
  const handleHover = React.useCallback(
    ({ tag, element }: { tag: TokenTag; element: HTMLElement }) => {
      if (!shouldShowPopover(tag)) return;
      const r = element.getBoundingClientRect();
      onIdentifierHover({
        tag,
        element,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      });
    },
    [onIdentifierHover],
  );

  // Notation heads from source_tokens — a node rendered from its delab tree
  // (universal view, or a node with no author_byte_range) colours its notation
  // atoms through --ce-token-notation, IDENTICALLY to the source-bytes ShikiSlice
  // render, so the signature can't mix cyan sliced nodes with muted tree nodes.
  const notationNames = React.useMemo(
    () => notationNamesFromSourceTokens(sourceTokens),
    [sourceTokens],
  );

  const renderTree = (tree: TokenTree | null): React.ReactNode =>
    tree !== null ? (
      <TokenTreeView
        tree={tree}
        notationNames={notationNames}
        onIdentifierClick={onIdentifierClick}
        onIdentifierHover={handleHover}
        onIdentifierLeave={onIdentifierLeave}
      />
    ) : (
      <span className={styles.unavailable}>⋯</span>
    );

  // Render one node's TYPE. In author view, when the node carries an aligned
  // `author_byte_range` and we have the source bytes, render the VERBATIM
  // authored source — identical to the flowchart cards / side panel — so the
  // synthetic signature shows exactly what the author wrote (e.g. a
  // `syntax`+`macro_rules` notation that does NOT round-trip on delaboration).
  // ShikiSlice renders inline `<span>`s (fits the `( name : … )` line) and
  // forwards hover/leave, so a source-sliced node shows the SAME identifier
  // popover the delab-tree branch shows — render-hast surfaces a complete
  // `PopoverTarget`, so no rect adapter is needed on this path.
  const renderNodeType = (node: RfFlowchartNode): React.ReactNode => {
    const abr = node.author_byte_range;
    // Same in-bounds guard the flowchart cards / statement panel apply (mirrors
    // the highlight-slice route's bound): a null / out-of-bounds / inverted range
    // falls back to the delab tree instead of rendering a blank slice.
    const useSourceBytes =
      viewKind === "author" &&
      abr != null &&
      fileContent != null &&
      sourceTokens !== undefined &&
      abr.start >= 0 &&
      abr.end > abr.start &&
      abr.end <= byteLen(fileContent);
    return useSourceBytes ? (
      <ShikiSlice
        source={fileContent!}
        range={abr!}
        tokens={sourceTokens!}
        onIdentifierClick={onIdentifierClick}
        onIdentifierHover={onIdentifierHover}
        onIdentifierLeave={onIdentifierLeave}
      />
    ) : (
      renderTree(pickTree(node, viewKind))
    );
  };

  // Theorem name: author view shows the bare `local_name`; empty view shows the
  // fully-qualified `<namespace>.<name>` (matching the node + signature policy).
  // The name itself opens the side panel for the theorem (its own def_id) — the
  // "click the syntax to open the panel" affordance applied to the head.
  const name = viewKind === "author" ? decl.local_name : decl.qualified_name;

  // > 4 premises ⇒ collapse everything after the first 3 into one expandable
  // line; ≤ 4 always show in full. `hiddenCount` is 0 unless collapsed-and-shut.
  const collapses = premises.length > PREMISE_COLLAPSE_THRESHOLD;
  const showAll = !collapses || expanded;
  const visiblePremises = showAll
    ? premises
    : premises.slice(0, PREMISES_VISIBLE_WHEN_COLLAPSED);
  const hiddenCount = showAll
    ? 0
    : premises.length - PREMISES_VISIBLE_WHEN_COLLAPSED;

  return (
    <pre
      className={styles.syntax}
      aria-label={`theorem ${decl.local_name} signature`}
    >
      {/* Real page heading for the theorem identity: the canvas-first
       * redesign left the page with no <h1>, so a screen-reader user had no
       * top-level landmark naming the theorem. A visually-hidden <h1> supplies
       * one without disturbing the synthetic `theorem <name>` syntax line below
       * (which stays the visible identity). `name` is the author/empty-view name. */}
      <h1 className="sr-only">theorem {name}</h1>

      {/* Line 1 — `theorem <name>` + optional toggle. A flex row so the toggle
       * (mobile chevron) sits at the trailing edge in BOTH states; when collapsed
       * the name text truncates to one line rather than wrapping. */}
      <div className={`${styles.line} ${styles.firstLine}`}>
        <span
          className={`${styles.firstLineText}${collapsed ? ` ${styles.firstLineTruncate}` : ""}`}
        >
          <span className={styles.keyword}>theorem</span>{" "}
          <span
            className={styles.name}
            role="button"
            tabIndex={0}
            // Unify the "open the Lean side panel" affordance — this and
            // the proof-group theorem name now both use button + haspopup=dialog +
            // aria-controls pointing at the real side-panel id (SIDE_PANEL_ID).
            aria-haspopup="dialog"
            aria-controls={SIDE_PANEL_ID}
            onClick={activateName}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activateName();
              }
            }}
          >
            {name}
          </span>
        </span>
        {toggleSlot}
      </div>

      {/* Collapsed (mobile): stop at the first line. */}
      {collapsed ? null : (
        <>
          {/* Premise lines — 4-space indent, `(name : type)`, wrapping. */}
          {visiblePremises.map((p) => (
            <div key={p.id} className={`${styles.line} ${styles.premise}`}>
              <span className={styles.punct}>(</span>
              {/* The wire emits `null` (not `undefined`) for an anonymous binder —
               * e.g. a `variable [Inst]` instance the elaborator names `inst✝`.
               * Guard with `!= null` so those render as `(Type)` without a stray
               * leading `: ` instead of the malformed `( : Type)`. */}
              {p.name != null ? (
                <>
                  {p.proposition_id !== undefined ? (
                    <span
                      className={`${styles.binder} ${styles.propLink}`}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="true"
                      aria-controls={PROP_PANEL_ID}
                      aria-label={`Open premise proposition ${p.name}`}
                      onClick={() => activateProposition(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          activateProposition(p);
                        }
                      }}
                    >
                      {p.name}
                    </span>
                  ) : (
                    <span className={styles.binder}>{p.name}</span>
                  )}
                  <span className={styles.punct}> : </span>
                </>
              ) : null}
              {renderNodeType(p)}
              <span className={styles.punct}>)</span>
            </div>
          ))}

          {/* Collapsed-premises affordance (> 4): a distinct CHIP (not source-styled
           * text) so it clearly reads as a control, not another binder line. Expanded,
           * it flips to a "show fewer" chip so the panel recovers the compact view. */}
          {hiddenCount > 0 ? (
            <div className={styles.moreRow}>
              <button
                type="button"
                className={styles.moreChip}
                onClick={() => setExpanded(true)}
                aria-expanded={false}
              >
                <span aria-hidden="true">⋯</span>
                {hiddenCount} more {hiddenCount === 1 ? "premise" : "premises"}
                <ChevronDown size={13} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {collapses && expanded ? (
            <div className={styles.moreRow}>
              <button
                type="button"
                className={styles.moreChip}
                onClick={() => setExpanded(false)}
                aria-expanded={true}
              >
                show fewer
                <ChevronUp size={13} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {/* Conclusion line — 2-space indent, `: <conclusion>`. */}
          {conclusion !== null ? (
            <div className={`${styles.line} ${styles.conclusion}`}>
              {conclusion.proposition_id !== undefined ? (
                <span
                  className={`${styles.punct} ${styles.conclusionLink}`}
                  role="button"
                  tabIndex={0}
                  aria-haspopup="true"
                  aria-controls={PROP_PANEL_ID}
                  onClick={() => activateProposition(conclusion)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      activateProposition(conclusion);
                    }
                  }}
                  aria-label="Open conclusion proposition"
                >
                  :{" "}
                </span>
              ) : (
                <span className={styles.punct}>: </span>
              )}
              {renderNodeType(conclusion)}
            </div>
          ) : null}
        </>
      )}
    </pre>
  );
}
