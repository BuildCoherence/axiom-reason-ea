import Link from "next/link";

import { PublisherName, type Publisher } from "@/components/publisher-name";
import { LEGAL_LINKS_LIST } from "@/components/footer-legal-links";
import { FocusModeButton } from "@/components/lean-ui/focus-mode-button";
import inTextLinkStyles from "@/components/lean-ui/in-text-link.module.css";
import { ThemeToggle } from "@/components/theme/theme-toggle";

import { PaletteButton } from "./palette-button";
import { ShortcutsHelpButton } from "./shortcuts-help-button";
import styles from "@/components/lean-ui/workbench-status-bar.module.css";

// CE file page status bar — the thin IDE-style strip pinned to the bottom
// edge of the workbench. Server Component; no client state.
//
// WHY a status bar — not the chrome <Footer/>.
//
// The file route's workbench wrapper (axiom/web/src/app/(app)/(public)/f/
// [file_id]/page.tsx — `fixed inset-x-0 bottom-0 top-[var(--ce-nav-height)]
// overflow-hidden`) covers the chrome <Footer/> from below. The canonical
// reader-focused IDE answer (VS Code Web `src/vs/workbench/browser/parts/
// statusbar/statusbarPart.ts`, vscode.dev, github.dev, Sourcegraph's webapp)
// is to drop the marketing footer on code routes and surface a thin status
// bar inside the workbench instead. This component is that strip: file-id
// chip + publisher attribution + decl count on the left, theme toggle +
// palette + shortcuts help + copyright + legal links on the right. The
// profile route uses the same shape via `ProfileStatusBar`; both routes
// share the visual module `@/components/lean-ui/workbench-status-bar.module.css`.
//
// COMPOSITION.
//
// Rendered as the LAST child of the workbench wrapper, BELOW `CeFileBody`'s
// `LeanUIShell`. The `LeanUIShell` consumes the remaining vertical space
// (`flex: 1 1 auto`) and the status bar sits at `flex: 0 0 auto` underneath
// — so the file body still scrolls inside its pane and the status bar reads
// as a fixed bottom edge.
//
// The chrome <Footer/> is still rendered by `(app)/layout.tsx`; the
// workbench wrapper covers it visually on workbench-shaped routes (file
// viewer + profile) via fixed positioning. Non-workbench routes (home,
// search, account, etc.) keep the marketing footer in view.

export interface StatusBarProps {
  /** This file's `<base50>` id. */
  fileId: string;
  /**
   * Publisher of the file, or `null` when the publisher's account is unknown
   * (mirrors the file header's optional-region rule — no placeholder when
   * publisher data is absent).
   */
  publisher: Publisher;
  /**
   * Number of declarations in this file. Surfaced as a chip alongside the
   * file-id chip — gives the visitor a quick sense of file scale before
   * they scroll. `0` is rendered ("0 declarations") — distinct from the
   * unknown / loading case (which doesn't reach this component).
   */
  declCount: number;
}

export function StatusBar({ fileId, publisher, declCount }: StatusBarProps) {
  return (
    <div className={styles.statusBar} aria-label="File status">
      <div className={styles.left}>
        {/* File-id chip — base50 in a compact monospace chip, mirroring the
         * header's chip style but sized for the 2rem-tall status row. base50
         * is case-sensitive (rendered verbatim, never lowercased). */}
        <code className={styles.fileIdChip}>{fileId}</code>

        <span className={styles.publisherLine}>
          Published by{" "}
          <PublisherName
            publisher={publisher}
            className={inTextLinkStyles.link}
          />
        </span>

        {/* Declaration count chip — quick file-scale signal next to the
         * file-id chip and publisher attribution. Style mirrors
         * `.fileIdChip` so the two read as paired pieces of file
         * metadata. */}
        <code className={styles.declCountChip}>
          {declCount} {declCount === 1 ? "declaration" : "declarations"}
        </code>

        {/* "Press / to search" hint — the cmdk command palette landed (see
         * `CommandPalette` in CeFileBody), so this hint is now an actual
         * shortcut affordance, not a stub. Rendered inside `.left` near the
         * publisher line so it reads as workbench chrome alongside the file
         * id + attribution, distinct from the right block's legal text. */}
        <span className={styles.searchHint}>
          Press{" "}
          <kbd className={styles.kbd} aria-label="forward slash">
            /
          </kbd>{" "}
          to search
        </span>
      </div>

      {/* Right-aligned legal notice. Per Nolo / Revision Legal: US copyright
       * protection is automatic under Berne (no per-page notice required) and
       * DMCA needs a registered agent + takedown procedure (also not a footer
       * obligation), but the convention to put a copyright line + ToS/Privacy
       * links REACHABLE FROM EVERY PAGE prevents the "innocent infringer"
       * defense and is what every reader-focused IDE site does (vscode.dev,
       * github.dev's hamburger Legal, Sourcegraph's chrome-light footer,
       * docs.rs' thin footer). VS Code Web's status bar carries the
       * equivalent — it's the canonical IDE-style answer.
       *
       * The "/ to search" affordance that lived here briefly was removed —
       * the key wasn't actually wired (it was a stub for the future command
       * palette). Will return as a working chip when the cmdk palette lands. */}
      {/* Legal links read from `LEGAL_LINKS_LIST` (footer-legal-links.ts)
       * — same source of truth the marketing footer uses, so the URLs and
       * labels cannot drift. Both are absolute coherencelabs.net URLs (the
       * legal pages live on the marketing site, not axiomreason.com);
       * rendered as plain anchors with external-link rel for the new-tab
       * case. */}
      <div className={styles.right}>
        {/* Theme toggle — same three-state (system / dark / light) cycle the
         * marketing footer carries. The workbench layout covers the chrome
         * <Footer/> on this route, so without surfacing the toggle here the
         * visitor has no way to change theme while on the file page. Lives
         * leftmost in the right block; the shortcuts-help affordance and the
         * legal links follow. */}
        <ThemeToggle />

        {/* Focus-mode toggle — visible counterpart to the `f` hotkey, and
         * the only focus-mode affordance on touch viewports. See
         * `FocusModeButton` for why every workbench status bar carries
         * one (the hidden-chrome state persists across routes). */}
        <FocusModeButton />

        {/* Search / command-palette affordance — opens the same "Jump to
         * declaration" palette the `/` hotkey opens (see
         * `CommandPalette` in CeFileBody). Mobile-only: a touch viewport
         * has no `/` key, and the desktop branch keeps the `/` hint in
         * the left block plus the hotkey itself, so the button is hidden
         * via CSS on desktop (see `.paletteButton` in
         * workbench-status-bar.module.css). */}
        <PaletteButton />

        {/* Keyboard-shortcuts affordance — same dialog the `?` hotkey
         * opens. The icon button is the discovery surface (visitors who
         * don't know about `?` would never see the shortcut list). Lives
         * before the legal block on the right side. */}
        <ShortcutsHelpButton />
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
