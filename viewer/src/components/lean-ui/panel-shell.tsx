"use client";

import * as React from "react";
import { AlertCircle, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";

import {
  focusFirstPanelControl,
  hasPanelMobileContainer,
  hostOwnsMobileContainer,
  panelFocusFirstMarker,
  restorePanelInvokerFocus,
  shellOwnsMobileSheet,
} from "./panel-focus";
import styles from "./side-panel.module.css";

// Shared inspection-panel chrome — extracted from `SidePanel` so BOTH the
// declaration panel (`SidePanel`) and the proposition panel
// (`PropositionPanel`, downstream) wrap ONE implementation of the
// viewport-adaptive container, focus management, the desktop Esc handler,
// the Back / Forward drill-down strip, the Close button, and the
// skeleton / error / idle fallback surfaces. The wrapping panel supplies
// only its loaded BODY (its sections) plus a small set of header extras and
// lifecycle inputs.
//
// This is a PURE EXTRACTION: `SidePanel`'s observable behaviour stays
// byte-for-byte (same DOM `id`, same `role="region"` / `aria-label`, same
// mobile `Sheet` markup, the same focus capture/restore selectors, the same
// document-level Esc gating). Everything below moved verbatim out of
// `side-panel.tsx`; see that file's header for the chrome rationale (docked
// IDE-style pane on desktop vs the v1 bottom Sheet on mobile).

/**
 * Lifecycle state of a panel's data fetch — the host computes this from its
 * in-flight fetch (idle = between selections, loading = fetch in flight,
 * loaded = data available, error = non-OK / network throw / malformed body).
 * The shell branches on it to pick the right surface: skeleton, content, or
 * an error + Retry affordance.
 *
 * Defined here (the shell owns the state branching) and re-exported from
 * `side-panel.tsx` so existing `import { type PanelState } from
 * ".../side-panel"` sites keep compiling.
 */
export type PanelState = "idle" | "loading" | "loaded" | "error";

// Re-exported so a host writing a `renderMobileContainer` can stamp the focus
// marker without hard-coding the attribute string.
export { PANEL_FOCUS_FIRST_ATTR } from "./panel-focus";

/** What `PanelShell` hands a host that takes over the mobile container: the whole pane, header included, since the focus-marked controls sit outside `data-side-panel-body`. */
export interface PanelMobileContainerArgs {
  /** The pane, as a fragment. The host's returned tree must wrap it, not render it as a sibling. */
  children: React.ReactNode;
  /**
   * Attach to the container's outermost node — it is the root the shell queries
   * for the focus marker and the root the Esc containment check uses. The host's
   * container also owns `id`, `role="region"` and `aria-label`, because the shell
   * renders no wrapper of its own on this path, and must lay out as a flex column.
   */
  panelRootRef: React.RefCallback<HTMLDivElement>;
}

export interface PanelShellProps {
  /** Whether the panel is open. Host passes `selected !== null` for its kind. */
  open: boolean;
  /** Fetch lifecycle — drives skeleton (loading + no data) vs error vs body. */
  state: PanelState;
  /** True once the body data is available (loaded). When false + loading → skeleton. */
  hasData: boolean;
  /** HTTP status for the error surface's muted "HTTP <n>" line (optional). */
  errorStatus?: number | null;
  /** In-panel drill-down affordance flags (shared in-memory stack). */
  history: { can_back: boolean; can_forward: boolean };
  onBack: () => void;
  onForward: () => void;
  onClose: () => void;
  onRetry: () => void;
  /**
   * The loaded body — the wrapping panel's sections. Rendered only in the
   * "loaded" branch; PanelShell renders the skeleton / error / idle surfaces
   * itself so each wrapper does not re-implement them.
   */
  children: React.ReactNode;
  /**
   * Optional header extras rendered on the trailing edge of the chrome
   * header (desktop docked header + mobile Sheet header), after Close.
   * SidePanel passes its `View in file` button here; PropositionPanel
   * passes null.
   */
  headerExtras?: React.ReactNode;
  /**
   * Skeleton variant — the section-shaped placeholder differs slightly per
   * panel (the prop panel has no Value/Source-location). The host passes its
   * own; null renders no skeleton (the loading branch then shows nothing,
   * which the def host avoids by always passing its `LoadingSkeleton`).
   */
  loadingSkeleton?: React.ReactNode;
  /** Accessible region label — "Declaration inspection" (def) / "Proposition inspection" (prop). */
  ariaLabel: string;
  /** Stable DOM id for the surface. SidePanel passes SIDE_PANEL_ID; the prop panel passes PROP_PANEL_ID. */
  surfaceId: string;
  /**
   * Mobile Sheet title — visually-hidden but required by Radix Dialog. The
   * loaded local_name (def) / a "Proposition" literal (prop). Host supplies.
   */
  sheetTitle: string;
  /**
   * Desktop focus re-anchor key — the id of the current selection (the def_id
   * / proposition_id). On open AND whenever this changes (re-pointing the
   * panel at a different selection), desktop focus moves to the first
   * focusable header control, matching `SidePanel`'s original `[def_id, ...]`
   * dependency so a panel-to-panel pivot re-anchors focus to a fresh
   * navigation context. Defaults to a stable literal (focus moves on the open
   * edge only) when the host has nothing meaningful to key on.
   */
  focusKey?: string | null;
  /** Mobile escape hatch: when supplied, the shell renders the pane into the host's own container instead of its modal `Sheet`. Never invoked on desktop. */
  renderMobileContainer?: (args: PanelMobileContainerArgs) => React.ReactNode;
  /** Whether the host's container carries its own close control and the single focus marker. `false` says the container is chrome only and the shell must keep both. Ignored unless the host's container renders. */
  hostSuppliesFocusMarker?: boolean;
}

// Drill-down navigation strip (Back / Forward icon buttons). Walks the host
// hook's in-memory stack — NOT browser history. `aria-label`s name the
// panel-local navigation explicitly ("Previous declaration" / "Next
// declaration") rather than the generic "Back" / "Forward" so AT users don't
// expect browser-history semantics from a panel-scoped control. See design
// doc § "In-panel drill-down history". Same component used by both the
// desktop docked chrome and the mobile Sheet chrome — and (post-extraction)
// shared across the def panel and the prop panel.
//
// Back carries one `data-panel-focus-first` marker and Close the other;
// `focusFirstMarker` is `undefined` when the shell must suppress its own, which
// makes React omit the attribute entirely.
function DrillDownNav({
  history,
  onBack,
  onForward,
  focusFirstMarker,
}: Pick<PanelShellProps, "history" | "onBack" | "onForward"> & {
  focusFirstMarker: "" | undefined;
}) {
  return (
    <div className={styles.navStrip} aria-label="Drill-down history">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={!history.can_back}
        onClick={onBack}
        aria-label="Previous declaration"
        data-panel-focus-first={focusFirstMarker}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={!history.can_forward}
        onClick={onForward}
        aria-label="Next declaration"
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}

// Error state — shown when the host's fetch landed in the "error" branch
// (non-OK status, network throw, or a malformed body). Surfaces a plain
// apology + Retry button wired to the host's onRetry. Lucide `AlertCircle`
// icon names the failure visually; when the host knows the HTTP status code
// it shows it muted ("HTTP 404") so a developer sees what failed without
// opening DevTools. Mirrors the page-level error.tsx boundary in tone.
function ErrorSection({
  errorStatus,
  onRetry,
}: {
  errorStatus: number | null | undefined;
  onRetry: () => void;
}) {
  return (
    <section className={styles.section} aria-label="Error">
      <p className={styles.errorMessage} role="alert">
        <AlertCircle
          className={styles.errorIcon}
          aria-hidden="true"
          size={16}
        />
        <span>Couldn&apos;t load this declaration.</span>
      </p>
      {typeof errorStatus === "number" ? (
        <p className={styles.errorStatus}>HTTP {errorStatus}</p>
      ) : null}
      <p>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </p>
    </section>
  );
}

// Defensive idle placeholder — the panel is only mounted when open, and the
// host sets `state === "idle"` ONLY when nothing is selected, so this branch
// should never render in practice. Kept as a friendly fallback (over
// rendering nothing) in case a future revision mounts the panel in a
// transitional close-animation pose.
function IdlePlaceholder() {
  return (
    <section className={styles.section} aria-label="No selection">
      <p className={styles.idleMessage}>Click a declaration to inspect it.</p>
    </section>
  );
}

export function PanelShell({
  open,
  state,
  hasData,
  errorStatus = null,
  history,
  onBack,
  onForward,
  onClose,
  onRetry,
  children,
  headerExtras,
  hostSuppliesFocusMarker = true,
  loadingSkeleton,
  ariaLabel,
  surfaceId,
  sheetTitle,
  focusKey = null,
  renderMobileContainer,
}: PanelShellProps) {
  const isMobile = useIsMobile();

  // `shellOwnsSheet` is the one value all four mobile-specific branches read and
  // the one value their dependency arrays carry — never `renderMobileContainer`
  // itself, whose inline-arrow identity changes every parent render.
  const hasMobileContainer = hasPanelMobileContainer(renderMobileContainer);
  const shellOwnsSheet = shellOwnsMobileSheet(isMobile, hasMobileContainer);
  // Keyed on whether the host's container is rendering, not on whether one was
  // supplied: suppressing the shell's marker for a container that is not on
  // screen leaves the tree with none at all.
  const hostRendersContainer = hostOwnsMobileContainer(
    isMobile,
    hasMobileContainer,
  );
  // A marker on a `display: none` control is not a focus target, so a container
  // that is pure chrome must leave the marker on the shell's own Close.
  const focusFirstMarker = panelFocusFirstMarker(
    hostRendersContainer && hostSuppliesFocusMarker,
  );

  // State branching — render the right surface for the fetch lifecycle.
  // `state === "error"` → ErrorSection; `!hasData && loading` → skeleton;
  // `!hasData && idle` → the defensive idle placeholder; else the body.
  let surface: React.ReactNode;
  if (state === "error") {
    surface = <ErrorSection errorStatus={errorStatus} onRetry={onRetry} />;
  } else if (!hasData) {
    surface = state === "loading" ? loadingSkeleton : <IdlePlaceholder />;
  } else {
    surface = children;
  }

  // ---- Focus management (desktop + mobile) ----------------------------
  //
  // The panel opens from a click/Enter on a server-stamped identifier span
  // (or a list/graph row) — there is no real Radix trigger, so we capture
  // the element that had focus when the panel opened and restore focus to it
  // on close, so the keyboard visitor returns to where they came from instead
  // of dropping to <body>.
  //
  // On DESKTOP the docked pane participates in the global tab order rather
  // than installing a focus trap (the trap was a Sheet artifact). The pane
  // also receives focus on open — we focus the FIRST focusable affordance in
  // the docked header (Back if enabled, otherwise X close) so the visitor
  // lands on a meaningful control. The restore-on-close uses a plain
  // `useEffect` cleanup rather than Sheet's `onCloseAutoFocus`.
  //
  // On MOBILE, when the SHELL owns the container, shadcn's `Sheet` (Radix
  // Dialog, `modal=true`) handles the focus trap and auto-focus on open; we
  // still pass our captured restoreFocus through `onCloseAutoFocus` so the
  // close-time focus return matches the desktop behaviour. A host-owned mobile
  // container has no Radix Dialog doing any of that, which is why the effects
  // below gate on `shellOwnsSheet` rather than on `isMobile`.
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const panelRootRef = React.useRef<HTMLDivElement | null>(null);

  // Focus-on-open cannot be an effect alone: a host container mounts through a
  // portal AFTER every effect the shell can run, so the ref callback attaching is
  // the only moment its marker is in the document. Inputs come from a ref so the
  // callback keeps a stable identity — a changed ref callback is re-invoked with
  // `null` and then the node again, re-stealing focus.
  const attachStateRef = React.useRef({ open, shellOwnsSheet });
  attachStateRef.current = { open, shellOwnsSheet };

  const attachPanelRoot = React.useCallback((node: HTMLDivElement | null) => {
    panelRootRef.current = node;
    if (node === null) return;
    const state = attachStateRef.current;
    // The modal Sheet does its own focus management; a closed panel has
    // nothing to focus into.
    if (state.shellOwnsSheet || !state.open) return;
    // Must stay idempotent: a host container re-attaches several times in the
    // frames after it opens, and re-focusing the header would yank focus back out
    // of a body the visitor has already tabbed into.
    if (node.contains(document.activeElement)) return;
    // The last moment the invoker is observable. On a host that mounts the shell
    // already open, the passive capture effect below runs a phase later, by which
    // time `document.activeElement` is the panel's own Close button.
    const active = document.activeElement;
    if (active instanceof HTMLElement) restoreFocusRef.current = active;
    focusFirstPanelControl(node);
  }, []);

  // Capture the previously-focused element on open. Tracked once per open
  // edge (i.e. when `open` flips from false to true) — re-opens for a
  // different selection don't re-capture, since the visitor is already inside
  // the panel.
  const prevOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      const active = document.activeElement;
      // NEVER CAPTURE A CONTROL INSIDE THE PANEL. `attachPanelRoot` has already
      // run whenever the shell mounts open — a ref callback fires in the commit
      // phase, before any passive effect — so it has both moved focus into the
      // header AND captured the real invoker on its way past. An unguarded
      // assignment here would overwrite that capture with the panel's own Close
      // button one phase later, i.e. with a node that unmounts with the panel.
      // Leaving the previous value alone is safe: it is either that capture or
      // null, because every restore clears the ref.
      if (
        active instanceof HTMLElement &&
        !(panelRootRef.current?.contains(active) ?? false)
      ) {
        restoreFocusRef.current = active;
      }
    }
    prevOpenRef.current = open;
  }, [open]);

  // A re-pointed non-modal panel re-anchors after its root attach handles opening.
  React.useEffect(() => {
    if (shellOwnsSheet) return; // the modal Sheet has built-in focus management
    if (!open) return;
    focusFirstPanelControl(panelRootRef.current);
  }, [shellOwnsSheet, open, focusKey]);

  // Hosts close by unmounting, so focus restoration belongs to this cleanup.
  React.useEffect(() => {
    if (shellOwnsSheet) return; // handled by the Sheet's onCloseAutoFocus
    if (!open) return; // nothing open to close
    return () => {
      // Not every teardown is a close. A viewport crossing into the shell-owned
      // Sheet with the panel still open is a hand-over, and the Sheet's
      // `onCloseAutoFocus` needs the captured invoker a restore here would
      // consume; an unmount reads its own last render and is a real close.
      const next = attachStateRef.current;
      if (next.open && next.shellOwnsSheet) return;
      // Focus orphaned by a teardown lands on `<body>` or is still inside the pane
      // being closed; anything else is a deliberate claim by whatever ran in
      // between — a remount re-points the panel and focuses it a phase earlier —
      // and restoring over it would yank focus out of the panel that just opened.
      const active = document.activeElement;
      const orphaned =
        active === null ||
        active === document.body ||
        (panelRootRef.current?.contains(active) ?? false);
      if (!orphaned) return;
      restorePanelInvokerFocus(restoreFocusRef);
    };
  }, [shellOwnsSheet, open]);

  // ---- Esc dismisses when the shell owns no Dialog ----------------------
  //
  // Non-modal roots close on Escape only while focus remains inside the pane.
  React.useEffect(() => {
    if (shellOwnsSheet) return;
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const root = panelRootRef.current;
      if (root === null) return;
      const active = document.activeElement;
      if (!(active instanceof Node)) return;
      if (!root.contains(active)) return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shellOwnsSheet, onClose, open]);

  // Sheet's onOpenChange fires false for ESC / overlay-click / the built-in X
  // close button — forward all three to the host's onClose. Click-outside-to-
  // close is the expected gesture on mobile (a covering pane the visitor
  // "clicks out of"), so we deliberately let Sheet's default overlay-dismiss
  // ride through.
  function handleSheetOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }
  function handleSheetCloseAutoFocus(event: Event) {
    restorePanelInvokerFocus(restoreFocusRef, () => event.preventDefault());
  }

  // ---- Mobile (bottom-sheet) chrome -----------------------------------
  //
  // A host-owned mobile container falls through; only the shell-owned path uses Sheet.
  if (shellOwnsSheet) {
    const sheetClass = [styles.sheet, styles.sheetBottom].join(" ");
    return (
      <Sheet open={open} onOpenChange={handleSheetOpenChange} modal={true}>
        <SheetContent
          id={surfaceId}
          side="bottom"
          className={sheetClass}
          onCloseAutoFocus={handleSheetCloseAutoFocus}
        >
          <SheetHeader className={styles.sheetHeader}>
            <DrillDownNav
              history={history}
              onBack={onBack}
              onForward={onForward}
              focusFirstMarker={focusFirstMarker}
            />
            {/* `SheetTitle` is required by Radix `Dialog` for AT announcement
             * on open — rendering null causes a console warning AND a WCAG
             * failure. Visually hidden via `.srOnly` because the body's first
             * section already shows the heading; the visible title in the
             * chrome was redundant. */}
            <SheetTitle className={styles.srOnly}>{sheetTitle}</SheetTitle>
            {/* sr-only-style description — required by Radix Dialog for a11y
             * when no visible description exists. */}
            <SheetDescription className={styles.srOnly}>
              {ariaLabel} panel
            </SheetDescription>
            {headerExtras}
          </SheetHeader>

          {/* `data-side-panel-body` marks this as the scroll container the
           * ReferencedBySection's IntersectionObserver uses as its `root`
           * (CO-3). Without the marker the observer falls back to the
           * document viewport, which fires "lazy" on the first animation
           * frame — defeating the deferred-fetch posture. Kept as
           * `data-side-panel-body` (not renamed) so the observer's root
           * lookup is unchanged — the prop panel has no Referenced-by section
           * that relies on it. */}
          <div className={styles.body} data-side-panel-body>
            {surface}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // A fragment so the same subtree serves both the docked pane and a
  // host-supplied mobile container.
  const pane = (
    <>
      {/* Docked header — DrillDownNav on the left; `headerExtras` then Close
       * pushed right as one group by `.dockedTrailing`'s `margin-left: auto`.
       * The visible title was dropped because the body's first section already
       * renders the heading — the docked-header title was visually redundant.
       * The panel's a11y label still names the surface via the wrapper
       * `role="region" aria-label=...`.
       *
       * Close must stay last in the DOM rather than moved by a CSS `order`: it is
       * a focus-on-open target and the focus selector walks the DOM. */}
      <header className={styles.dockedHeader}>
        <DrillDownNav
          history={history}
          onBack={onBack}
          onForward={onForward}
          focusFirstMarker={focusFirstMarker}
        />
        <div className={styles.dockedTrailing}>
          {headerExtras}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close panel"
            data-panel-focus-first={focusFirstMarker}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </header>

      {/* `data-side-panel-body` marks this as the scroll container the
       * ReferencedBySection's IntersectionObserver uses as its `root` (CO-3).
       * See the matching attribute on the mobile branch above. */}
      <div className={styles.body} data-side-panel-body>
        {surface}
      </div>
    </>
  );

  // The shell renders no wrapper of its own on this path: the host's container
  // owns `id`, `role` and `aria-label`, and carries `panelRootRef`.
  if (hostRendersContainer && renderMobileContainer !== undefined) {
    return renderMobileContainer({
      children: pane,
      panelRootRef: attachPanelRoot,
    });
  }

  // ---- Desktop / tablet (docked IDE-style pane) chrome ----------------
  //
  // Plain div tree — no Radix Dialog, no overlay, no focus trap. Lives inside
  // the host shell's `ResizablePanel` column; the shell owns the pane's outer
  // width and the resize handle, this component owns the header + scrollable
  // body. Click-outside-to-close is naturally a no-op (there is no overlay to
  // dismiss); X and Esc-while-inside are the only close affordances.
  return (
    <div
      ref={attachPanelRoot}
      id={surfaceId}
      role="region"
      aria-label={ariaLabel}
      className={[styles.dockedPane].join(" ")}
    >
      {pane}
    </div>
  );
}
