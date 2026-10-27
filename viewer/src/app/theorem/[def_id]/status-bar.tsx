import type { ReactNode } from "react";

import { LEGAL_LINKS_LIST } from "@/components/footer-legal-links";
import { FocusModeButton } from "@/components/lean-ui/focus-mode-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";

import styles from "@/components/lean-ui/workbench-status-bar.module.css";

// Theorem Page status bar — the thin IDE-style strip pinned to the bottom edge
// of the workbench on `/theorem/<def_id>`. Same shape and chrome as the file
// route's `StatusBar` and the profile route's `ProfileStatusBar` (theme toggle
// + focus-mode on the right, copyright + legal links anchoring the row); the
// route-specific content on the left is the theorem's local name and its
// premise count. Server Component; no client state.
//
// Shares the visual module (workbench-status-bar.module.css) with the file and
// profile status bars — see that module's leading comment for the workbench-
// covering-marketing-footer rationale. The theorem page adopts the same
// workbench shell (see page.tsx), so it carries the same compact footer rather
// than the marketing footer the shell covers.

export interface TheoremStatusBarProps {
  /** The theorem declaration's local name (e.g. `sam_is_inconsistent`). */
  localName: string;
  /**
   * The certificate's premise count, or `null` when the theorem has no
   * certificate (open-binder / pre-backfill — the fallback-rendering case).
   * `0` is rendered ("definitional fact") — distinct from the
   * no-certificate case.
   */
  premiseCount: number | null;
  /**
   * The page-level author/empty view toggle, moved into the footer by the
   * Theorem Page redesign. Rendered in the center of the bar; omitted (e.g. a
   * future non-toggle surface) leaves the slot empty.
   */
  viewToggle?: ReactNode;
}

export function TheoremStatusBar({
  localName,
  premiseCount,
  viewToggle,
}: TheoremStatusBarProps) {
  return (
    // An `aria-label` on a ROLELESS <div> is ignored by AT. This strip is
    // page-footer chrome (theorem id + premise count + copyright/legal), so make
    // it a real `contentinfo` landmark — now the accessible name is exposed and
    // the bar is reachable via landmark navigation.
    <div
      className={styles.statusBar}
      role="contentinfo"
      aria-label="Theorem status"
    >
      {/* On mobile the name + premise-count chips are suppressed (see the module)
       * so the footer has room to surface the page-view toggle instead. */}
      <div className={`${styles.left} ${styles.statusLeftMobileHide}`}>
        {/* Local-name chip — mirrors the file route's `.fileIdChip` shape so
         * the status bars read as the same row of chrome with route-
         * appropriate content. */}
        <code className={styles.fileIdChip}>{localName}</code>

        {/* Premise-count chip — the theorem-page analogue of the file route's
         * decl-count and the profile route's axiom/theorem counts. `null`
         * (no certificate) renders an em dash so the chip still anchors the
         * row; `0` is a definitional fact. */}
        <code className={styles.declCountChip}>
          {premiseCount === null
            ? "—"
            : premiseCount === 0
              ? "definitional fact"
              : `${premiseCount} ${premiseCount === 1 ? "premise" : "premises"}`}
        </code>
      </div>

      {/* Page view toggle — center slot (the redesign moves the author/empty
       * toggle out of the content area into the footer). */}
      {viewToggle !== undefined ? (
        <div className={styles.viewToggleSlot}>{viewToggle}</div>
      ) : null}

      <div className={styles.right}>
        {/* Theme toggle — the workbench covers the marketing footer's toggle
         * on this route, so the affordance lives here. */}
        <ThemeToggle />

        {/* Focus-mode toggle — the visible counterpart for restoring chrome a
         * persisted focus mode hid (the theorem route binds no hotkeys). */}
        <FocusModeButton />

        {/* Copyright + legal links — same anchor row the file and profile
         * routes carry; `LEGAL_LINKS_LIST` is the marketing footer's source
         * of truth so URLs/labels can't drift. */}
        <span className={styles.copyright}>
          © {new Date().getFullYear()} Coherence Labs
        </span>
        {LEGAL_LINKS_LIST.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.legalLink}
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
