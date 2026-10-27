import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch, Milestone } from "lucide-react";

import {
  TokenTreeView,
  notationNamesFromSourceTokens,
} from "@/components/lean-ui/token-tree";
import { shouldShowPopover } from "@/components/lean-ui/identifier-popover";
import type { SourceToken } from "@/components/lean-ui/types";

import type { RfFlowchartNode, TokenTag, PopoverTarget } from "../types";
import { pickTree } from "../layout-model";
import { HoldingBar } from "./holding-bar";
import { isFalseProp } from "./is-false-prop";
import styles from "./nodes.module.css";

// Interior proof-step node (bridge / intermediate / restatement). Renders only
// when the proof fold is EXPANDED, as a child of the proof-group container.
// SAME card box as a premise/conclusion — lighter, cooler chrome so steps read as
// "machinery" subordinate to the premises/conclusion — minus the stance chip
// (interior steps carry no viewer stance). Bridge vs intermediate diverge by icon
// + accent.

export interface InteriorStepData {
  node: RfFlowchartNode;
  view: "author" | "empty";
  /**
   * The decl's UNsliced `source_tokens`, forwarded so the delab-tree render
   * colours notation atoms from the SAME classification source the premise /
   * conclusion cards and the theorem page use (see lean-ui-component.md §
   * "Notation coloring parity"). Interior steps are derived, so they have no
   * author byte range and always render the delab tree; this keeps their
   * notation colour in sync with the rest of the graph.
   */
  sourceTokens?: SourceToken[];
  /** Identifier click inside the proposition → host opens the side panel. */
  onIdentifierClick?: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
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
  [key: string]: unknown;
}

interface KindMeta {
  label: string;
  className: string;
  Icon: typeof GitBranch;
}

const KIND_META: Record<string, KindMeta> = {
  bridge: { label: "Bridge", className: styles.bridge, Icon: GitBranch },
  restatement: { label: "Bridge", className: styles.bridge, Icon: GitBranch },
  intermediate: {
    label: "Intermediate",
    className: styles.intermediate,
    Icon: Milestone,
  },
};

function metaFor(kind: string): KindMeta {
  return (
    KIND_META[kind] ?? {
      label: kind,
      className: styles.bridge,
      Icon: GitBranch,
    }
  );
}

export function InteriorStepNode({ data }: NodeProps) {
  const {
    node,
    view,
    sourceTokens,
    onIdentifierClick,
    onIdentifierHover,
    onIdentifierLeave,
    onBadgeActivate,
  } = data as InteriorStepData;
  const propositionTree = React.useMemo(
    () => pickTree(node, view),
    [node, view],
  );
  // Colour notation atoms from the decl's source_tokens, the same way the
  // premise / conclusion cards do, so every graph node's delab tree agrees.
  const notationNames = React.useMemo(
    () => notationNamesFromSourceTokens(sourceTokens),
    [sourceTokens],
  );
  const { label, className, Icon } = metaFor(node.kind);
  // Same hover adapter as `flowchart-node.tsx` / the proposition card: guard with
  // shouldShowPopover, capture the rect at hover time.
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
  const propositionId = node.proposition_id;

  return (
    <div
      className={`${styles.card} ${styles.interior} ${className}`}
      data-node-id={node.id}
      data-kind={node.kind}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />

      <div className={styles.header}>
        <span className={styles.kindIcon} aria-hidden="true">
          <Icon size={13} strokeWidth={2.25} />
        </span>
        <span
          className={`${styles.kindLabel} ${styles.selectableText} nodrag nopan`}
        >
          {label}
        </span>
      </div>

      <div className={styles.proposition}>
        {/* See proposition-card.tsx: the text box inside is unpadded. */}
        <div
          className={`${styles.propositionClamp} ${styles.selectableText} nodrag nopan`}
        >
          {propositionTree !== null ? (
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

      <div className={styles.footer}>
        {/* Settled treatment (no bar) iff settled, no holdings, OR no resolved
         * proposition_id — the same guard as the production `flowchart-node.tsx`.
         * A settled `False` step suppresses even the "definitional" label (empty
         * slot), matching the proposition card. */}
        {node.settled ||
        node.holdings === null ||
        propositionId === undefined ? (
          isFalseProp(node) ? null : (
            <span className={styles.settled}>definitional</span>
          )
        ) : (
          <HoldingBar
            propositionId={propositionId}
            holdings={node.holdings}
            onBadgeActivate={onBadgeActivate}
            // No drill-in wired (the feed preview) means a display-only bar, not
            // a no-op button.
            readOnly={onBadgeActivate === undefined}
          />
        )}
      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
