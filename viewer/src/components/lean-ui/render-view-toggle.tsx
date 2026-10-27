"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { ViewChoice } from "./types";
import styles from "./render-view-toggle.module.css";

// Shared author/empty render-view toggle — the single source of truth for the
// two-button mutex control that was triplicated across the Theorem Page, the
// side panel, and the profile lists (CO-3). Centralising the WCAG-2.1.1
// keyboard logic (roving tabindex + Arrow/Home/End) is exactly where future
// divergence would otherwise become an a11y regression.
//
// MODELLED as an ARIA `radiogroup` per the APG authoring practice for mutually
// exclusive toggles: each option is a `role="radio"` with `aria-checked`,
// exactly one option is in the tab sequence at a time (roving tabindex), and
// arrow keys move selection (activate-on-focus). The parent owns the `view`
// state. This stays a radiogroup — NOT a `role="switch"` — because two equal
// named views are radios, not a boolean, and the design leaves room for a 3rd
// (`kind: "user"`) position.
//
// PRESENTATION — a single connected SEGMENTED PILL with a thumb that slides
// under the selected cell (render-view-toggle.module.css). The visible labels
// are display copy ("Author's" / "Universal"); the underlying `kind` values
// ("author" / "empty") are unchanged. The "Syntax" axis label is baked in to
// the LEFT of the pill so callers no longer own it.
//
// LABELLING — the baked-in "Syntax" text is `aria-hidden` (visual axis label
// only). The accessible name comes from `ariaLabel`, which callers set to a
// context-qualified string ("Page syntax", "Panel syntax", "Axioms syntax", …)
// so multiple toggles on one page stay distinguishable to screen readers.

const VIEW_OPTIONS: Array<{ kind: ViewChoice["kind"]; label: string }> = [
  { kind: "author", label: "Author's" },
  { kind: "empty", label: "Universal" },
];

export interface RenderViewToggleProps {
  view: ViewChoice;
  onViewChange: (next: ViewChoice) => void;
  /**
   * Accessible name for the radiogroup → `aria-label`. The visible "Syntax"
   * label is `aria-hidden`, so this is what assistive tech announces; callers
   * pass a context-qualified name (e.g. "Page syntax", "Axioms syntax") so
   * multiple toggles on one page stay distinguishable.
   */
  ariaLabel?: string;
  /**
   * Class for the OUTER container — layout / placement only (margins,
   * min-width, status-bar flex behaviour). The pill, label, and thumb are
   * styled internally and do not depend on it.
   */
  className?: string;
}

export function RenderViewToggle({
  view,
  onViewChange,
  ariaLabel,
  className,
}: RenderViewToggleProps) {
  // Arrow-key handling per the APG radiogroup pattern: Left/Up → previous,
  // Right/Down → next (wrapping), Home/End → first/last. Activation on focus
  // matches APG's "Activated by default upon focus" — the visitor can scrub
  // through views with a single key per direction.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const currentIndex = VIEW_OPTIONS.findIndex((opt) => opt.kind === view.kind);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % VIEW_OPTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + VIEW_OPTIONS.length) % VIEW_OPTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = VIEW_OPTIONS.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      const next = VIEW_OPTIONS[nextIndex];
      onViewChange({ kind: next.kind });
      // Move focus to the now-selected radio. The buttons share a common
      // data-view-kind attribute so a selector pick is reliable.
      const target = event.currentTarget.querySelector<HTMLButtonElement>(
        `[data-view-kind="${next.kind}"]`,
      );
      target?.focus();
    }
  }

  return (
    <div className={cn(styles.root, className)}>
      {/* Baked-in visual axis label — `aria-hidden`; the radiogroup's
       * `aria-label` carries the accessible name (see LABELLING note above). */}
      <span className={styles.label} aria-hidden="true">
        Syntax
      </span>
      <div
        className={styles.pill}
        role="radiogroup"
        aria-label={ariaLabel}
        // Drives the thumb position via CSS (`[data-selected-kind="empty"]`).
        data-selected-kind={view.kind}
        onKeyDown={onKeyDown}
      >
        {/* Sliding thumb — presentational, sits under the selected cell. */}
        <span className={styles.thumb} aria-hidden="true" />
        {VIEW_OPTIONS.map((opt) => {
          const selected = view.kind === opt.kind;
          return (
            <button
              key={opt.kind}
              type="button"
              className={styles.option}
              role="radio"
              aria-checked={selected}
              // Roving tabindex per APG: exactly one radio in the group is in
              // the tab sequence at a time (the selected one).
              tabIndex={selected ? 0 : -1}
              data-view-kind={opt.kind}
              // Mirrors the label; the CSS `::after` ghost uses it to reserve
              // the BOLD width so selecting an option never resizes the cell.
              data-label={opt.label}
              onClick={() => onViewChange({ kind: opt.kind })}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
