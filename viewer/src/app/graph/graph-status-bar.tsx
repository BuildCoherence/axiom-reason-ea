import { LEGAL_LINKS_LIST } from "@/components/footer-legal-links";
import { FocusModeButton } from "@/components/lean-ui/focus-mode-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";

import styles from "@/components/lean-ui/workbench-status-bar.module.css";

import { GraphCorpusLabel } from "./graph-corpus-label";

// The `.left` div stays in the tree even when the corpus label renders nothing:
// `.statusBar` is `justify-content: space-between`, so with a single child the
// chrome would slide to the left edge and stop matching the other status bars.

export function GraphStatusBar({ frozenAt }: { frozenAt: string }) {
  return (
    // A real `contentinfo` landmark: an `aria-label` on a roleless <div> is
    // ignored by assistive technology.
    <div className={styles.statusBar} role="contentinfo" aria-label="Graph status">
      <div className={styles.left}>
        <GraphCorpusLabel frozenAt={frozenAt} className={styles.declCountChip} />
      </div>

      <div className={styles.right}>
        {/* The workbench covers the marketing footer, so the affordances it
            would otherwise carry live here. */}
        <ThemeToggle />
        <FocusModeButton />

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

export default GraphStatusBar;
