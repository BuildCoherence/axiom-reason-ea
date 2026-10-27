"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";

import { ShortcutsHelp } from "@/components/lean-ui/shortcuts-help";

import styles from "@/components/lean-ui/workbench-status-bar.module.css";

// Status-bar affordance that opens the same keyboard-shortcuts help dialog
// the `?` hotkey opens (see `ShortcutsHelp` in
// `axiom/web/src/components/lean-ui/shortcuts-help.tsx`). The dialog has no
// discoverable surface from the file body's keyboard layer alone — visitors
// who don't know about `?` would never see the shortcut list — so the
// status bar surfaces a visible icon button as the discovery affordance.
//
// Lives as its own client component so the surrounding `StatusBar` can stay
// a server component (it has no other client state); only this small slice
// of the strip ships JS.

export function ShortcutsHelpButton() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.shortcutsButton}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        onClick={() => setOpen(true)}
      >
        <Keyboard aria-hidden="true" className={styles.shortcutsIcon} />
      </button>
      <ShortcutsHelp open={open} onOpenChange={setOpen} />
    </>
  );
}
