import { LEGAL_LINKS_LIST } from "@/components/footer-legal-links";
import { FocusModeButton } from "@/components/lean-ui/focus-mode-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";

import styles from "@/components/lean-ui/workbench-status-bar.module.css";

// Profile page status bar — the thin IDE-style strip pinned to the bottom
// edge of the workbench on `/u/<username>`. Same shape and chrome as the
// file route's StatusBar (theme toggle on the right, copyright + legal
// links anchoring the row); the route-specific content on the left is the
// profile being viewed and the size of its axiom + held-proposition lists.
// Server Component; no client state.
//
// Shares the visual module (workbench-status-bar.module.css) with the file
// route's StatusBar — see that module's leading comment for the workbench-
// covering-marketing-footer rationale.

export interface ProfileStatusBarProps {
  /** The profile being viewed (canonical lowercase username). */
  username: string;
  /**
   * Number of axioms in the profile's latest `Axioms.lean`. `0` is rendered
   * ("0 axioms") — distinct from the no-publish case (which the caller can
   * encode by passing `null`).
   */
  axiomCount: number | null;
  /**
   * Number of held propositions loaded for this profile — the `?prop=` unit
   * that replaced the v1 `theorems[]` count (D14/D25). `0` is rendered.
   */
  heldCount: number;
}

export function ProfileStatusBar({
  username,
  axiomCount,
  heldCount,
}: ProfileStatusBarProps) {
  return (
    <div className={styles.statusBar} aria-label="Profile status">
      <div className={styles.left}>
        {/* `@<username>` chip — mirrors the file route's `.fileIdChip`
         * shape so the two status bars read as the same row of chrome
         * with route-appropriate content. */}
        <code className={styles.fileIdChip}>@{username}</code>

        {/* Counts — same shape as the file route's `.declCountChip`.
         * Axioms can be null (the profile has not published an
         * Axioms.lean); render an em dash so the chip still anchors
         * the row. Held propositions is always a number (zero is
         * meaningful and rendered). Singular / plural follows count. */}
        <code className={styles.declCountChip}>
          {axiomCount === null
            ? "no axioms"
            : `${axiomCount} ${axiomCount === 1 ? "axiom" : "axioms"}`}
        </code>
        <code className={styles.declCountChip}>
          {heldCount}{" "}
          {heldCount === 1 ? "theorem" : "theorems"}
        </code>
      </div>

      <div className={styles.right}>
        {/* Theme toggle — the workbench covers the marketing footer's
         * toggle on this route, so the affordance lives here. */}
        <ThemeToggle />

        {/* Focus-mode toggle — the profile route binds no hotkeys, so
         * without this button a visitor whose persisted focus mode hid
         * the nav would have no way to restore it from this page. See
         * `FocusModeButton`. */}
        <FocusModeButton />

        {/* Copyright + legal links — same anchor row the file route
         * carries. `new Date().getFullYear()` evaluated at SSR so the
         * year matches the rendered footer on non-workbench routes. */}
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
