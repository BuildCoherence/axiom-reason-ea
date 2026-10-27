"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import type { TokenTag } from "./types";
import styles from "./identifier-popover.module.css";

// Identifier hover popover — the design-§ "Side panel component" sibling
// surface that renders a tag's inline metadata (qualified_name,
// inlined_type_summary, hover_kind) without a per-hover network round-trip
// per the Lean UI Component design
// § "Structured token tree" (the `inlined_type_summary` field's commitment:
// "Drives the hover popover without a network round-trip").
//
// V1 SHAPE — a single page-level Radix `Popover` driven by an anchor
// element + controlled `open` state, NOT a per-tag `HoverCard.Root`
// instantiation. The host page (ce-file-body.tsx) owns the open / target
// state; the renderer (token-tree.tsx) surfaces hover + focus events
// carrying the hovered/focused DOM element. This shape:
//
//   1. Costs one Popover tree, not one per tag — a CE file with thousands
//      of tags previously paid 1 × HoverCard.Root per tag.
//   2. Triggers on BOTH pointer hover AND keyboard focus, restoring
//      keyboard-only access — the previous HoverCard wrapper was
//      pointer-only, breaking WCAG 2.1.1).
//   3. Decouples interactivity from per-tag DOM — the renderer's tag
//      <span>s no longer need to nest inside a trigger primitive.
//
// CONTRACT —
//   - `IdentifierPopoverHost` mounts a single Radix Popover with a
//     virtual anchor (PopoverAnchor `virtualRef`) pointing at the
//     currently-hovered/focused element. Pass it the current `target`
//     ({tag, element} or null), and an `onOpenChange` close handler
//     (the host wires this to clear the target).
//   - SUPPRESSED CASES are decided by the host before setting a target:
//     `qualified_name === null` (binders / locals / non-term tags),
//     `kind === "whitespace"` / `kind === "comment"` — see the
//     `shouldShowPopover` helper exported below.

/** Returns true when the tag carries metadata worth surfacing in the popover. */
export function shouldShowPopover(tag: TokenTag): boolean {
  if (tag.qualified_name === null) return false;
  if (tag.kind === "whitespace") return false;
  if (tag.kind === "comment") return false;
  return true;
}

// The currently-targeted tag + the DOM element to anchor against. The
// element is the actual hovered/focused <span> in the token-tree, used
// via Radix's `PopperAnchor virtualRef` so the popover positions over
// the trigger without us having to compute coordinates by hand.
export interface PopoverTarget {
  tag: TokenTag;
  /** The hovered/focused span — used by the host to stamp aria-describedby. */
  element: HTMLElement;
  /**
   * The span's viewport rect, captured at hover/focus time (while the span
   * is definitely attached and laid out). We anchor the popover to a real
   * positioned element built from this rect rather than to a mutated
   * `virtualRef`: the body's decorated subtree is re-committed under us on
   * `?def=` navigations (Shiki HTML is rebuilt server-side per request), which
   * detaches the original span and makes a live `getBoundingClientRect()`
   * return 0,0 — pinning the popover to the top-left. A captured rect is
   * immune to that.
   */
  rect: { top: number; left: number; width: number; height: number };
}

// Stable id for the popover content surface. Used as the `aria-describedby`
// target the host stamps onto the anchored span while the popover is open,
// linking trigger → description for screen readers.
export const IDENTIFIER_POPOVER_CONTENT_ID = "ce-identifier-popover-content";

export interface IdentifierPopoverHostProps {
  /** Currently-targeted tag + anchor element, or null when nothing is hovered/focused. */
  target: PopoverTarget | null;
  /**
   * Host clears the target when the popover closes (ESC, blur,
   * pointer-leave). Pass a setter that nulls the target state.
   */
  onClose: () => void;
  /**
   * Pointer entered the portaled popover content. The host cancels its
   * close-intent grace timer so moving onto the popover keeps it open
   * (WCAG 1.4.13 "Hoverable" / W3C F95).
   */
  onContentPointerEnter?: () => void;
  /**
   * Pointer left the popover content. The host reschedules the graced
   * close so leaving the popover dismisses it.
   */
  onContentPointerLeave?: () => void;
}

// Render the popover content sections. Kept as a sub-component so the
// Content's portal-mounted surface is a clean read.
function PopoverBody({ tag }: { tag: TokenTag }) {
  // hover_kind is informational per the design — only show the badge when
  // the validator emitted something other than the v1-default "term".
  const showHoverKind =
    tag.hover_kind !== null && tag.hover_kind !== "term";

  return (
    <div className={styles.body}>
      {tag.qualified_name !== null ? (
        <code className={styles.qualifiedName}>{tag.qualified_name}</code>
      ) : null}
      {tag.inlined_type_summary !== null ? (
        <code className={styles.typeSummary}>
          {/* The summary is a one-line Format from
           * `Meta.ppExpr ∘ Meta.inferType`; render as monospace so the
           * Lean surface notation reads correctly. */}
          : {tag.inlined_type_summary}
        </code>
      ) : null}
      {showHoverKind ? (
        <span className={styles.kindBadge}>{tag.hover_kind}</span>
      ) : null}
    </div>
  );
}

export function IdentifierPopoverHost({
  target,
  onClose,
  onContentPointerEnter,
  onContentPointerLeave,
}: IdentifierPopoverHostProps) {
  const open = target !== null;

  // Sticky last-shown target — keeps the Anchor + body rendered through
  // Radix's close-out animation. Without this, when `target` goes null
  // (pointer leaves the identifier), our conditional `target !== null`
  // checks immediately unmount BOTH the position:fixed Anchor and the
  // PopoverBody. Radix's `Content` then plays its `data-state="closed"`
  // fade-out without a measurable anchor and momentarily paints at
  // (0, 0) — the "blurry box flashes at the top-left" the user reported.
  //
  // The fix is to track the most recent non-null target separately and
  // keep rendering the Anchor at its rect (and the body's content) for
  // the full duration of the close animation. Radix continues to have a
  // real, positioned anchor to measure, so the closing Content stays
  // pinned over the original identifier until it fades out.
  //
  // We hold the sticky target while `open === true`; on `open === false`
  // we keep it for one close-animation cycle. The close animation is
  // 80ms (see identifier-popover.module.css `identifier-popover-out`);
  // we use a slightly larger 150ms window to absorb scheduler jitter
  // and a possible second RAF, then drop the sticky reference. After
  // that Radix has fully unmounted the Content (post `animation-end`)
  // so the body is never visible without a sticky target.
  const [stickyTarget, setStickyTarget] =
    React.useState<PopoverTarget | null>(target);

  React.useEffect(() => {
    if (target !== null) {
      setStickyTarget(target);
      return;
    }
    // open just flipped to false — drop the sticky reference after the
    // close animation has run.
    const t = setTimeout(() => setStickyTarget(null), 150);
    return () => clearTimeout(t);
  }, [target]);

  function handleOpenChange(next: boolean) {
    // Radix fires onOpenChange(false) on ESC, outside-click, etc. Forward
    // to the host so the target gets cleared.
    if (!next) {
      onClose();
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {/* Real, position:fixed anchor placed at the rect we captured when the
       * span was hovered/focused (viewport coords from getBoundingClientRect).
       * Radix measures this concrete element reliably — no virtualRef whose
       * `.current` can point at a since-detached node and collapse to 0,0.
       * Rendered while a sticky target exists (so the anchor stays valid
       * during Radix's close-out animation, see stickyTarget above);
       * pointer-events:none so it never intercepts input. */}
      {stickyTarget !== null ? (
        <PopoverPrimitive.Anchor
          aria-hidden
          style={{
            position: "fixed",
            top: stickyTarget.rect.top,
            left: stickyTarget.rect.left,
            width: stickyTarget.rect.width,
            height: stickyTarget.rect.height,
            pointerEvents: "none",
          }}
        />
      ) : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={IDENTIFIER_POPOVER_CONTENT_ID}
          side="top"
          align="start"
          sideOffset={4}
          // Keep the popover off the fixed nav/header and the viewport
          // edges — without this an identifier on the first source line
          // can render its `side="top"` popover clipped behind the nav
          // edge. collisionPadding reserves a gutter on every edge;
          // Radix flips to `side="bottom"` when the top would collide.
          collisionPadding={12}
          className={styles.content}
          // Pointer travel onto the content keeps it open; leaving it
          // reschedules the host's graced close (WCAG 1.4.13 "Hoverable").
          onMouseEnter={onContentPointerEnter}
          onMouseLeave={onContentPointerLeave}
          // The popover content should not steal focus when it opens —
          // the user is keyboard-navigating tags and would be confused
          // by a focus jump. The `onOpenAutoFocus` handler preventing
          // default keeps focus on the trigger element.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Same for close: don't punt focus back to the (virtual)
          // anchor since it isn't a real Radix-managed trigger.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Use the sticky target so the body keeps rendering through
           * the close-out animation — Radix measures and positions
           * against the still-mounted Anchor above. */}
          {stickyTarget !== null ? <PopoverBody tag={stickyTarget.tag} /> : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
