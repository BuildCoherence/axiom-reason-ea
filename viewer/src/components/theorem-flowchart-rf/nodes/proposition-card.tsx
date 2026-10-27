import * as React from "react";
import { Handle, Position } from "@xyflow/react";

import {
  TokenTreeView,
  notationNamesFromSourceTokens,
} from "@/components/lean-ui/token-tree";
import { ShikiSlice } from "@/components/lean-ui/shiki-slice";
import { byteLen } from "@/components/lean-ui/byte-len";
import { shouldShowPopover } from "@/components/lean-ui/identifier-popover";
import type { SourceToken } from "@/components/lean-ui/types";
import { FORMAL_STANCE_GLYPHS } from "@/lib/formal-stance-glyphs";

import type {
  RfFlowchartNode,
  TokenTag,
  PopoverTarget,
  ViewerStanceValue,
} from "../types";
import {
  capAuthorRange,
  CAP_ELLIPSIS,
  nameHeader,
  pickTree,
} from "../layout-model";
import { HoldingBar } from "./holding-bar";
import { cardRailStance, isFalseConclusion } from "./settled-treatment";
import { usesSourceBytes } from "./uses-source-bytes";
import styles from "./nodes.module.css";

// Shared content for the premise & conclusion custom nodes. The card box is the
// CSS's (nodes.module.css, whose px track layout.ts): a kind header (icon
// + label / premise name), a proposition body that grows to fit its full syntax
// (rendered via the REUSED `TokenTreeView`, the real renderer), a footer holding
// the aggregate Holding proportion bar, and the React Flow connection Handles the
// shell wires edges to (visually hidden — edges are drawn through waypoints, not
// handles). A `False` conclusion drops the footer entirely — a contradiction has
// nothing to adopt or reject — and uses a red proposition body (see
// settled-treatment).
//
// The VIEWER's own ADOPTION STATUS (design changes #2/#3) is shown as the THIN
// TOP RAIL of the card AND the ∵/∴ kind-glyph color (held → green, rejected →
// red, undecided/none → neutral gray) — NOT a full card outline — plus a single
// corner SYMBOL (⊢ held / ¬ rejected; nothing for undecided) the same glyphs the
// holding bar uses. Meaning rides on the symbol + its aria-label, never color
// alone (WCAG 1.4.1). Premise and conclusion share identical "proposition" chrome
// (design change #4) — same header tint/border — distinguished only by the glyph.
//
// There is NO line clamp: a card renders its proposition's full syntax and grows
// to fit it, up to the active Measure Rung's width. The byte caps applied below
// are the only truncation — the anti-abuse bound on the DOM a hostile proposition
// can build.

export interface PropositionCardData {
  node: RfFlowchartNode;
  view: "author" | "empty";
  stance?: ViewerStanceValue;
  /** "premise" tints + drops the target handle; "conclusion" drops the source. */
  role: "premise" | "conclusion";
  /**
   * The theorem's whole home-file verbatim source — backs the AUTHOR-view
   * source-bytes render via `ShikiSlice` (mirrors the side panel / profile axiom
   * rows). Undefined ⇒ the source-bytes path is disabled (delab fallback).
   */
  fileContent?: string;
  /**
   * The theorem decl's UNsliced source tokens (`Decl.source_tokens`) — handed to
   * `ShikiSlice`, which slices + rebases them onto the node's `author_byte_range`
   * span. Same `tokens` prop the side panel's `ShikiSlice` takes.
   */
  sourceTokens?: SourceToken[];
  /** Identifier click inside the proposition → host opens the side panel. */
  onIdentifierClick?: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  /** Header click opens the proposition panel for this node's proposition. */
  onSelectProp?: (proposition_id: string) => void;
  /** Identifier hover/focus → host opens the standard popover. */
  onIdentifierHover?: (target: PopoverTarget) => void;
  /** Identifier leave/blur → host schedules popover close. */
  onIdentifierLeave?: () => void;
  /**
   * A Holding bar was activated → host opens the provenance drill-in anchored to
   * `element`. Matches the production `flowchart-node.tsx` `onBadgeActivate`.
   */
  onBadgeActivate?: (args: {
    side: "pro" | "con";
    proposition_id: string;
    count: number;
    element: HTMLElement;
  }) => void;
  /**
   * The card's `ShikiSlice` reached a terminal state — the shell's measurement
   * gate waits on it, because the raw-text → hast swap resizes the card after
   * first paint. Only fires on a card that renders from source bytes.
   */
  onSliceSettled?: (nodeId: string) => void;
  [key: string]: unknown;
}

// The viewer-stance → ADOPTION-STATUS rail class (held green / rejected red /
// undecided neutral gray). Sets `--rail-color`, driving BOTH the thin top rail
// (.stanceBar*::after) and the ∵/∴ kind-glyph color (.card .kindGlyph) in
// nodes.module.css. No-stance falls back to the neutral (undecided) gray rail.
const STANCE_BAR_CLASS: Record<ViewerStanceValue, string> = {
  held: styles.stanceBarHeld,
  undecided: styles.stanceBarUndecided,
  rejected: styles.stanceBarRejected,
  "pending-held": styles.stanceBarPendingHeld,
  "pending-rejected": styles.stanceBarPendingRejected,
  "pending-undecided": styles.stanceBarPendingUndecided,
};

// The corner symbol per stance: ⊢ held, ¬ rejected — matching the holding glyphs.
// Undecided gets no symbol (the neutral outline carries the "not reckoned with"
// reading). The glyph is aria-hidden; the wrapper carries a descriptive label.
const STANCE_SYMBOL: Record<ViewerStanceValue, string | null> = {
  held: FORMAL_STANCE_GLYPHS.follows,
  undecided: null,
  rejected: FORMAL_STANCE_GLYPHS.negation,
  "pending-held": FORMAL_STANCE_GLYPHS.follows,
  "pending-rejected": FORMAL_STANCE_GLYPHS.negation,
  "pending-undecided": null,
};
const STANCE_SYMBOL_LABEL: Record<ViewerStanceValue, string> = {
  held: "You hold this",
  undecided: "You haven't taken a side on this",
  rejected: "You reject this",
  "pending-held": "Your unpublished amendments make this follow",
  "pending-rejected": "Your unpublished amendments reject this",
  "pending-undecided": "Your unpublished amendments remove this holding",
};
const STANCE_SYMBOL_CLASS: Record<ViewerStanceValue, string> = {
  held: styles.stanceSymbolHeld,
  undecided: styles.stanceSymbolUndecided,
  rejected: styles.stanceSymbolRejected,
  "pending-held": styles.stanceSymbolHeld,
  "pending-rejected": styles.stanceSymbolRejected,
  "pending-undecided": styles.stanceSymbolUndecided,
};

const INTERACTIVE_CARD_TARGETS =
  'a, button, input, textarea, select, summary, [role="button"], [role="link"], [contenteditable="true"]';

export function PropositionCard({ data }: { data: PropositionCardData }) {
  const {
    node,
    view,
    stance,
    role,
    fileContent,
    sourceTokens,
    onIdentifierClick,
    onSelectProp,
    onIdentifierHover,
    onIdentifierLeave,
    onBadgeActivate,
    onSliceSettled,
  } = data;
  const propositionTree = React.useMemo(
    () => pickTree(node, view),
    [node, view],
  );
  // AUTHOR-view source-bytes path (mirrors profile-body's `AxiomRow` /
  // side-panel's TypeSection): when this node aligned to a verbatim source span
  // AND the home-file source + decl tokens are threaded, render the proposition
  // from the source bytes so the AUTHORED surface syntax (`Sam thinks about
  // Kristie`) survives instead of the delaborated trust-root form. The EMPTY
  // view is unchanged (always the trust-root token tree). Derived/non-firing
  // nodes carry no `author_byte_range` → they keep the delab `pickTree` path.
  // UTF-8 byte length of file_content — the node's author_byte_range is only
  // sliceable when it lies within it (mirrors the highlight-slice route's bound).
  const fileContentByteLen = React.useMemo(
    () => (fileContent != null ? byteLen(fileContent) : 0),
    [fileContent],
  );
  const useSourceBytes = usesSourceBytes({
    node,
    view,
    fileContent,
    sourceTokens,
    fileContentByteLen,
  });
  // The anti-abuse cap on THIS path (`pickTree` carries it on the tree path).
  // Clamping moves a byte offset rather than dropping a token, so the card
  // appends the mark itself. The RAW range still decides `useSourceBytes` — the
  // clamp only ever shortens it.
  const cappedRange = React.useMemo(
    () =>
      node.author_byte_range != null && fileContent != null
        ? capAuthorRange(node.author_byte_range, fileContent)
        : null,
    [node.author_byte_range, fileContent],
  );
  const rangeCapped =
    cappedRange !== null &&
    node.author_byte_range != null &&
    cappedRange.end < node.author_byte_range.end;

  // Notation heads from source_tokens — when this node renders from its delab
  // tree (empty view, or no source range), its notation atoms still colour
  // through --ce-token-notation, matching a source-bytes ShikiSlice node. One
  // classification source across both renderers, so the graph can't show a cyan
  // premise next to a muted intermediate.
  const notationNames = React.useMemo(
    () => notationNamesFromSourceTokens(sourceTokens),
    [sourceTokens],
  );
  // Adapt TokenTreeView's hover shape ({ tag, element }) to the popover host's
  // shape ({ tag, element, rect }), capturing the rect at hover time — the SAME
  // adapter `flowchart-node.tsx` uses (immune to subtree re-commit).
  const handleHover = React.useCallback(
    ({ tag, element }: { tag: TokenTag; element: HTMLElement }) => {
      if (onIdentifierHover === undefined) return;
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
  // Drill-in key; absent (unresolved-hash node) ⇒ no Holding bar (settled
  // treatment), matching the production card's `proposition_id === undefined`
  // guard.
  const propositionId = node.proposition_id;
  const nodeId = node.id;
  const handleSliceSettled = React.useCallback(
    () => onSliceSettled?.(nodeId),
    [onSliceSettled, nodeId],
  );
  const isPremise = role === "premise";
  // Kind glyph (design change #3): ∵ "because" for a premise (an input ground),
  // ∴ "therefore" for the conclusion (what follows). Rendered as styled text in
  // the icon slot — see KIND_GLYPH and `.kindGlyph` in nodes.module.css.
  const kindGlyph = isPremise ? "∵" : "∴";
  // Premise header shows the real snake_case name (design change #3); fall back
  // to the kind word when a name is absent. Conclusion keeps its kind label.
  const premiseHeader =
    isPremise && node.name != null ? nameHeader(node.name) : null;
  const headerLabel =
    premiseHeader?.label ?? (isPremise ? "Premise" : "Conclusion");
  const stanceSymbol = stance !== undefined ? STANCE_SYMBOL[stance] : null;
  const headerClickable =
    propositionId !== undefined && onSelectProp !== undefined;
  const activateHeader = React.useCallback(() => {
    if (propositionId === undefined) return;
    onSelectProp?.(propositionId);
  }, [onSelectProp, propositionId]);
  const activateCard = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!headerClickable) return;
      if ((window.getSelection()?.toString().length ?? 0) > 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest(INTERACTIVE_CARD_TARGETS) !== null
      ) {
        return;
      }
      activateHeader();
    },
    [activateHeader, headerClickable],
  );

  // Adoption-status top bar: the viewer's stance, except on a definitional node
  // — proven for everyone, so it paints held whether or not there is a viewer.
  const stanceBar = STANCE_BAR_CLASS[cardRailStance(node, stance)];
  // A `False` conclusion is red, never gets the definitional held rail, and
  // carries no stance footer.
  const falseConclusion = isFalseConclusion(node);

  return (
    <div
      className={`${styles.card} ${isPremise ? styles.premise : styles.conclusion} ${stanceBar} ${falseConclusion ? styles.footerless : ""}`}
      data-node-id={node.id}
      data-kind={node.kind}
      data-stance={stance ?? "undecided"}
      onClick={activateCard}
    >
      {/* Premises emit edges downward; the conclusion only receives. */}
      {role === "conclusion" ? (
        <Handle type="target" position={Position.Top} isConnectable={false} />
      ) : null}

      <div className={styles.header}>
        <span
          className={`${styles.kindIcon} ${styles.kindGlyph}`}
          aria-hidden="true"
        >
          {kindGlyph}
        </span>
        <span
          className={`${styles.kindLabel} ${styles.selectableText} nodrag nopan ${premiseHeader !== null ? styles.premiseName : ""} ${headerClickable ? styles.headerPropLink : ""}`}
          title={premiseHeader?.title}
          role={headerClickable ? "button" : undefined}
          tabIndex={headerClickable ? 0 : undefined}
          onClick={headerClickable ? activateHeader : undefined}
          onKeyDown={
            headerClickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activateHeader();
                  }
                }
              : undefined
          }
        >
          {headerLabel}
        </span>
        {/* Viewer-stance corner symbol (held ⊢ / rejected ¬) — the non-color a11y
         * cue for the top bar. Undecided shows no glyph (gray bar carries it),
         * but its BOX is reserved unconditionally: under `width: max-content` a
         * conditional glyph would make a held/rejected flip a ~24px geometry
         * change, re-running the solver on a re-colour and breaking both the
         * stance-independence of the box table and the ≤2-writes budget. */}
        {stance !== undefined && stanceSymbol !== null ? (
          <span
            className={`${styles.stanceSymbol} ${STANCE_SYMBOL_CLASS[stance]}`}
            role="img"
            aria-label={STANCE_SYMBOL_LABEL[stance]}
          >
            <span aria-hidden="true">{stanceSymbol}</span>
          </span>
        ) : (
          <span className={styles.stanceSymbol} aria-hidden="true" />
        )}
      </div>

      <div className={styles.proposition}>
        {/* The padding lives on `.proposition`; the text box inside carries none,
         * so its height is a whole number of line boxes. */}
        <div
          className={`${styles.propositionClamp} ${styles.selectableText} nodrag nopan ${falseConclusion ? styles.falseBody : ""}`}
        >
          {useSourceBytes ? (
            // AUTHOR view from VERBATIM source bytes — the authored surface
            // syntax, identical to the side panel / profile axiom rows. Click
            // pivots the side panel and hover/leave drive the popover, the same
            // affordances the delab-tree branch below carries; render-hast
            // surfaces a complete `PopoverTarget`, so the `handleHover` rect
            // adapter is only needed on the tree path.
            <>
              <ShikiSlice
                source={fileContent!}
                range={cappedRange!}
                tokens={sourceTokens!}
                onIdentifierClick={onIdentifierClick ?? (() => {})}
                onIdentifierHover={onIdentifierHover}
                onIdentifierLeave={onIdentifierLeave}
                onSettled={
                  onSliceSettled !== undefined ? handleSliceSettled : undefined
                }
              />
              {rangeCapped ? CAP_ELLIPSIS : null}
            </>
          ) : propositionTree !== null ? (
            // The REAL renderer — identifier clicks open the Lean side panel and
            // hovers open the popover (the must-preserve behaviour). Same wiring
            // as the production `flowchart-node.tsx`.
            <TokenTreeView
              tree={propositionTree}
              notationNames={notationNames}
              onIdentifierClick={onIdentifierClick}
              onIdentifierHover={handleHover}
              onIdentifierLeave={onIdentifierLeave}
            />
          ) : (
            <span className={styles.unavailable}>proposition unavailable</span>
          )}
        </div>
      </div>

      {/* No footer AT ALL on a `False` card. A contradiction is not a claim a
       * reader can take a side on, so it gets no track, no endcaps and no
       * acknowledgement control — and the empty strip goes with them, floor
       * included (.footerless). */}
      {falseConclusion ? null : (
        <div className={styles.footer}>
          {/* The "definitional" label is shown ONLY when the node is ACTUALLY settled —
           * NOT as a fallback for missing holdings. (The feed preview sends no
           * holdings, so the old `|| holdings === null` arm mislabeled every premise
           * "definitional".) A non-settled node shows its Holding bar when the data is
           * present (the theorem page); with no holdings / unresolved hash (the feed
           * preview, or a data-skew node) it shows nothing — never a false
           * "definitional". */}
          {node.holdings !== null && propositionId !== undefined ? (
            <HoldingBar
              propositionId={propositionId}
              holdings={node.holdings}
              onBadgeActivate={onBadgeActivate}
              // No drill-in wired (the feed preview) means a display-only bar,
              // not a no-op button.
              readOnly={onBadgeActivate === undefined}
            />
          ) : node.settled ? (
            <span className={styles.settled}>definitional</span>
          ) : null}
        </div>
      )}

      {role === "premise" ? (
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={false}
        />
      ) : null}
    </div>
  );
}
