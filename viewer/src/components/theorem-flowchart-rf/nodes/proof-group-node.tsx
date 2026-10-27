import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { SIDE_PANEL_ID } from "@/components/lean-ui/types";
import { FORMAL_STANCE_GLYPHS } from "@/lib/formal-stance-glyphs";

import { capName } from "../layout-model";
import styles from "./nodes.module.css";

// Proof-fold container — the collapsible group/parent node (design § 3).
//
// COLLAPSED: a compact pill standing in for the whole proof interior, with a
//   "Show steps" toggle. Premises route INTO it and it routes OUT to the
//   conclusion (the shell re-routes edges; layout.ts reduces them).
// EXPANDED: a dashed/elevated, subtly-tinted frame that is the PARENT of the
//   interior nodes (React Flow `parentId`), with a header (Proof pill + "Hide
//   steps" toggle). The interior cards render as children, positioned by dagre.
//
// The toggle calls back into the shell, which flips fold state → re-runs dagre →
// fitView. This node owns no layout. EXPANDED it is chrome over a size the shell
// sets from the layout result; COLLAPSED it is chrome over its own CONTENT size
// (as wide as the theorem name), which the shell measures and the layout then
// reserves — the same seam a proposition card sits on.

export interface ProofGroupData {
  collapsed: boolean;
  /** Count of interior steps, shown as the "N steps" sublabel. */
  stepCount: number;
  /**
   * Human-facing theorem name (snake_case) — the PRIMARY header (design change
   * #3). Falls back to "Proof" when absent; the step count is a secondary label.
   */
  theoremName?: string;
  /**
   * The theorem's def id (design fix #5). When set, the NAME is a clickable
   * identifier that opens the Lean side panel via {@link onIdentifierClick}.
   */
  theoremDefId?: string;
  /** The theorem's fully-qualified name → the click target's `qualified_name`. */
  theoremQualifiedName?: string;
  /** Expanded container size (from the layout result); ignored when collapsed. */
  width: number;
  height: number;
  onToggle: () => void;
  /**
   * Identifier click (design fix #5) → host opens the Lean side panel. Same
   * contract the proposition cards take; invoked when the theorem name is
   * clicked (only when {@link theoremDefId} is set).
   */
  onIdentifierClick?: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  /**
   * Theorem-level adopter count — the number of users who adopt the whole
   * argument. When set, the header shows a `⊢ N` turnstile chip (the redesign
   * moves the count off the page header onto the theorem node, replacing the
   * old star). Absent (premise-free / preview harness) ⇒ no chip.
   */
  adopterCount?: number;
  /**
   * The adopter chip was activated → host opens the adopters drill-in anchored
   * to `element`. Paired with {@link adopterCount}.
   */
  onAdoptersActivate?: (element: HTMLElement) => void;
  [key: string]: unknown;
}

// Theorem-level adopter chip — `⊢ N`, the count of users who adopt the whole
// argument. A clickable affordance opening the adopters drill-in (the turnstile
// replaces the old header star; the glyph rhymes with the Holding-bar ⊢). The
// glyph is aria-hidden; the button carries the descriptive name. `nodrag nopan`
// + stopPropagation keep the click off the canvas pan / fold toggle.
function AdopterChip({
  count,
  onActivate,
}: {
  count: number;
  onActivate?: (element: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.adopterChip} nodrag nopan`}
      aria-label={`${count} ${count === 1 ? "user adopts" : "users adopt"} this argument`}
      onClick={(e) => {
        e.stopPropagation();
        onActivate?.(e.currentTarget);
      }}
    >
      <span className={styles.adopterGlyph} aria-hidden="true">
        {FORMAL_STANCE_GLYPHS.follows}
      </span>
      <span aria-hidden="true">{count}</span>
    </button>
  );
}

// Header content shared by the collapsed pill + expanded frame: the theorem name
// (primary, ellipsised) with the step count as a small secondary label. The step
// count is SUPPRESSED for an empty-interior container (design fix #4): there are
// no steps to count, so the name stands alone.
//
// CLICKABLE NAME (design fix #5): when `theoremDefId` is set the name renders as a
// clickable identifier — pointer cursor, keyboard-focusable, Enter/Space activate
// — that opens the Lean side panel via `onIdentifierClick`. `nodrag nopan` +
// stopPropagation keep the click from panning the canvas. Absent the def id (e.g.
// the preview harness) the name is plain, selectable text.
function GroupTitle({
  theoremName,
  theoremDefId,
  theoremQualifiedName,
  stepCount,
  showSteps,
  onIdentifierClick,
}: {
  theoremName?: string;
  theoremDefId?: string;
  theoremQualifiedName?: string;
  stepCount: number;
  showSteps: boolean;
  onIdentifierClick?: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
}) {
  const stepsLabel = `${stepCount} ${stepCount === 1 ? "step" : "steps"}`;
  // Middle-ellipsised at NAME_CAP like a premise name, with the FULL name on the
  // `title` below. The collapsed pill is sized to this label, so the cap is also
  // what bounds the pill's width.
  const label = theoremName === undefined ? "Proof" : capName(theoremName);

  const clickable =
    theoremDefId !== undefined && onIdentifierClick !== undefined;

  const activate = (e: React.SyntheticEvent) => {
    if (!clickable) return;
    // Don't let the click/keydown bubble to the canvas (pan) or the fold toggle.
    e.stopPropagation();
    onIdentifierClick?.({
      def_id: theoremDefId,
      qualified_name: theoremQualifiedName ?? theoremName ?? "",
    });
  };

  return (
    <span className={styles.proofTitle}>
      {clickable ? (
        <span
          className={`${styles.proofName} ${styles.proofNameClickable} nodrag nopan`}
          // This affordance OPENS the Lean side panel — it is a BUTTON,
          // not a link (a link navigates). Unified with the theorem-syntax head's
          // role/haspopup/controls so the same "open the panel" affordance reads
          // identically to AT everywhere.
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-controls={SIDE_PANEL_ID}
          title={theoremName}
          onClick={activate}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              activate(e);
            }
          }}
        >
          {label}
        </span>
      ) : (
        <span
          className={`${styles.proofName} ${styles.selectableText} nodrag nopan`}
          title={theoremName}
        >
          {label}
        </span>
      )}
      {showSteps ? (
        <span className={styles.proofSteps}>{stepsLabel}</span>
      ) : null}
    </span>
  );
}

export function ProofGroupNode({ data }: NodeProps) {
  const {
    collapsed,
    stepCount,
    theoremName,
    theoremDefId,
    theoremQualifiedName,
    adopterCount,
    onAdoptersActivate,
    width,
    height,
    onToggle,
    onIdentifierClick,
  } = data as ProofGroupData;

  // EMPTY interior (design fix #4): the container ALWAYS renders so premises route
  // premise → container → conclusion, but with NO interior steps there is nothing
  // to expand — so suppress BOTH the expand chevron AND the "N STEPS" sublabel.
  // (`stepCount` is the interior-node count, computed in the shell.)
  const hasSteps = stepCount > 0;

  // The pill is CONTENT-SIZED (nodes.module.css .groupCollapsed) and the shell
  // measures it, so it carries NO inline width — an inline one would beat the
  // module rule and pin the very box the measurement exists to find.
  if (collapsed) {
    return (
      <div className={`${styles.group} ${styles.groupCollapsed}`}>
        <Handle type="target" position={Position.Top} isConnectable={false} />
        <span
          className={`${styles.groupIcon} ${styles.groupGlyph}`}
          aria-hidden="true"
        >
          {"⇒"}
        </span>
        <GroupTitle
          theoremName={theoremName}
          theoremDefId={theoremDefId}
          theoremQualifiedName={theoremQualifiedName}
          stepCount={stepCount}
          showSteps={hasSteps}
          onIdentifierClick={onIdentifierClick}
        />
        {/* Theorem-level adopter count (⊢ N) — the redesign's turnstile chip,
         * moved here from the page header. */}
        {adopterCount !== undefined ? (
          <AdopterChip count={adopterCount} onActivate={onAdoptersActivate} />
        ) : null}
        {/* Bare chevron expand control (design change #6): no text/border — the
         * arrow IS the affordance. `nodrag` so React Flow lets the click reach the
         * button instead of starting a pane drag; aria-label + aria-expanded carry
         * the meaning for AT. Omitted entirely when the interior is empty (design
         * fix #4): there is nothing to expand. */}
        {hasSteps ? (
          <button
            type="button"
            className={`${styles.toggle} nodrag`}
            onClick={onToggle}
            aria-expanded={false}
            aria-label="Show steps"
          >
            <ChevronDown size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={false}
        />
      </div>
    );
  }

  // Expanded: the parent region. Children (interior nodes) render on top of this
  // via React Flow parenting; we only paint the frame + header here. (Reachable
  // only with a non-empty interior — the shell never expands an empty container.)
  return (
    <div className={styles.group} style={{ width, height }}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className={styles.groupHeader}>
        <span
          className={`${styles.groupIcon} ${styles.groupGlyph}`}
          aria-hidden="true"
        >
          {"⇒"}
        </span>
        <GroupTitle
          theoremName={theoremName}
          theoremDefId={theoremDefId}
          theoremQualifiedName={theoremQualifiedName}
          stepCount={stepCount}
          showSteps={hasSteps}
          onIdentifierClick={onIdentifierClick}
        />
        {/* Theorem-level adopter count (⊢ N) — see the collapsed pill. */}
        {adopterCount !== undefined ? (
          <AdopterChip count={adopterCount} onActivate={onAdoptersActivate} />
        ) : null}
        {/* Bare chevron expand control (design change #6) — see the collapsed pill. */}
        <button
          type="button"
          className={`${styles.toggle} nodrag`}
          onClick={onToggle}
          aria-expanded={true}
          aria-label="Hide steps"
        >
          <ChevronUp size={16} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
