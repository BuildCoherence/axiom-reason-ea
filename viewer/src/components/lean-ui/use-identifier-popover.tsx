"use client";

import * as React from "react";

import {
  IdentifierPopoverHost,
  IDENTIFIER_POPOVER_CONTENT_ID,
  shouldShowPopover,
  type PopoverTarget,
} from "./identifier-popover";
import type { TokenTag } from "./types";

// Reusable wiring for the single page-level identifier hover popover (the
// design-§ "Side panel component" sibling surface). It owns the popover
// target state, the WCAG 1.4.13 "Hoverable" close-intent grace timer, and the
// `aria-describedby` bookkeeping — the same logic that previously lived inline
// in ce-file-body.tsx / profile-body.tsx / theorem-page-body.tsx. Lifting it
// here lets a NEW surface (the explore/home feed) reuse the popover without
// re-deriving the grace-timer dance, and is a drop-in those pages can adopt
// later to delete their copies.
//
// The hook returns:
//   - `onTreeHover`   — adapter for `TokenTreeView`'s `{ tag, element }` hover
//                       shape (captures the element's viewport rect at hover
//                       time, the same approach as the file/profile pages).
//   - `onSliceHover`  — the `ShikiSlice` / render-hast hover shape, which
//                       already surfaces a complete `PopoverTarget` (rect
//                       captured in render-hast while the span is attached).
//   - `onIdentifierLeave` — schedules the graced close (shared by both).
//   - `popoverHost`   — the single `<IdentifierPopoverHost>` node to mount
//                       once on the surface (it portals to <body>, so it is
//                       unaffected by a virtualized list unmounting the card
//                       the identifier lived in).

const CLOSE_GRACE_MS = 120;

export interface IdentifierPopoverHandlers {
  /** `TokenTreeView` hover ({ tag, element }) — rect captured here. */
  onTreeHover: (target: { tag: TokenTag; element: HTMLElement }) => void;
  /** `ShikiSlice` / render-hast hover (a complete `PopoverTarget`). */
  onSliceHover: (target: PopoverTarget) => void;
  /** Pointer/focus left an identifier — schedule the graced close. */
  onIdentifierLeave: () => void;
}

export interface UseIdentifierPopover {
  /** Stable handlers to thread into the renderers (TokenTreeView / ShikiSlice). */
  handlers: IdentifierPopoverHandlers;
  /** Mount once on the surface — the single portaled popover. */
  popoverHost: React.ReactNode;
}

export function useIdentifierPopover(): UseIdentifierPopover {
  const [popoverTarget, setPopoverTarget] =
    React.useState<PopoverTarget | null>(null);

  const clearDescribedBy = React.useCallback(() => {
    if (typeof document === "undefined") return;
    document
      .querySelectorAll<HTMLElement>(
        `[aria-describedby="${IDENTIFIER_POPOVER_CONTENT_ID}"]`,
      )
      .forEach((el) => el.removeAttribute("aria-describedby"));
  }, []);

  const clearPopoverTarget = React.useCallback(() => {
    clearDescribedBy();
    setPopoverTarget(null);
  }, [clearDescribedBy]);

  // Close-intent grace timer so pointer travel onto the popover content keeps
  // it open (WCAG 1.4.13 "Hoverable").
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const cancelScheduledClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const scheduleClose = React.useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      clearDescribedBy();
      setPopoverTarget(null);
    }, CLOSE_GRACE_MS);
  }, [cancelScheduledClose, clearDescribedBy]);
  React.useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  // Core: show the popover for a fully-formed target (guarded + aria-wired).
  const showPopover = React.useCallback(
    (target: PopoverTarget) => {
      if (!shouldShowPopover(target.tag)) return;
      cancelScheduledClose();
      clearDescribedBy();
      target.element.setAttribute(
        "aria-describedby",
        IDENTIFIER_POPOVER_CONTENT_ID,
      );
      setPopoverTarget(target);
    },
    [cancelScheduledClose, clearDescribedBy],
  );

  // Adapter from TokenTreeView's { tag, element } to a rect-bearing target.
  const onTreeHover = React.useCallback(
    ({ tag, element }: { tag: TokenTag; element: HTMLElement }) => {
      if (!shouldShowPopover(tag)) return;
      const r = element.getBoundingClientRect();
      showPopover({
        tag,
        element,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      });
    },
    [showPopover],
  );

  const onIdentifierLeave = React.useCallback(
    () => scheduleClose(),
    [scheduleClose],
  );

  const handlers = React.useMemo<IdentifierPopoverHandlers>(
    () => ({ onTreeHover, onSliceHover: showPopover, onIdentifierLeave }),
    [onTreeHover, showPopover, onIdentifierLeave],
  );

  const popoverHost = (
    <IdentifierPopoverHost
      target={popoverTarget}
      onClose={clearPopoverTarget}
      onContentPointerEnter={cancelScheduledClose}
      onContentPointerLeave={scheduleClose}
    />
  );

  return { handlers, popoverHost };
}
