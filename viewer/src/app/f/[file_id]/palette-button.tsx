"use client";

import * as React from "react";
import { Search } from "lucide-react";

import styles from "@/components/lean-ui/workbench-status-bar.module.css";

// Status-bar affordance that opens the same "Jump to declaration" command
// palette the `/` hotkey opens (see `CommandPalette` mounted by
// `axiom/web/src/components/lean-ui/ce-file-body.tsx`). The `/` hotkey is a
// physical-keyboard affordance and a touch viewport has no `/` key, so the
// mobile status bar surfaces this explicit icon button as the only path to
// the palette. Desktop hides the button via CSS (`.paletteButton` defaults
// to `display: none`, the `< md` media block flips it to `inline-flex`) so
// the desktop bar stays uncluttered and `/` remains canonical.
//
// COMMUNICATION CHANNEL — window custom event. CeFileBody owns
// `paletteOpen` state and the palette mount, but the StatusBar (where this
// button lives) is a Server Component sibling of CeFileBody in the
// route's `page.tsx` tree — no parent component owns both, so there is no
// direct prop path to thread the `setPaletteOpen` setter through. A
// document-scoped CustomEvent (`ce-open-palette`) is the lightweight
// cross-component channel: this button dispatches it on click;
// CeFileBody adds a `window.addEventListener` for it and flips its own
// `paletteOpen` to `true`. The event is intentionally global (no bus, no
// store) because only this one button → one listener pair needs the
// signal.

export function PaletteButton() {
  const onClick = React.useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("ce-open-palette"));
  }, []);
  return (
    <button
      type="button"
      className={styles.paletteButton}
      aria-label="Search declarations"
      title="Search declarations"
      onClick={onClick}
    >
      <Search aria-hidden="true" className={styles.paletteIcon} />
    </button>
  );
}
