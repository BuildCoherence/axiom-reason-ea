"use client";

import * as React from "react";
import { Focus } from "lucide-react";

import { useFocusMode } from "./use-focus-mode";

import styles from "./workbench-status-bar.module.css";

// Status-bar focus-mode toggle — the VISIBLE affordance for the chrome-hide
// the file route's `f` hotkey drives (see use-focus-mode.ts and the design
// doc § "Focus mode (chrome-hiding affordance)").
//
// WHY a button at all. Focus mode persists (localStorage) and the hidden-nav
// state survives client-side navigation, so EVERY route that renders the
// workbench needs an exit affordance the visitor can see: the profile route
// binds no hotkeys, a touch viewport has no `f` key, and "press a key you
// have no way to discover" is not an exit affordance. Mounted in BOTH
// workbench status bars (file + profile); visible on mobile too, unlike the
// shortcuts button (the toggle works via tap).
//
// `aria-pressed` makes the on/off state machine-readable on the button
// itself; the polite live region announces the page-level effect ("Focus
// mode on/off") for WHICHEVER surface triggered the toggle — this button or
// the `f` hotkey — since hiding the chrome is otherwise silent to a
// screen-reader user. The region renders the store's announcement string,
// which is empty until the first toggle (mount and localStorage rehydration
// never announce).
//
// Lives as its own client component so the surrounding status bars can stay
// server components; only this small slice of the strip ships JS.

export function FocusModeButton() {
  const { focusMode, announcement, toggleFocusMode } = useFocusMode();

  return (
    <>
      <button
        type="button"
        className={styles.focusModeButton}
        aria-label="Toggle focus mode"
        aria-pressed={focusMode}
        title={focusMode ? "Exit focus mode (f)" : "Focus mode (f)"}
        onClick={toggleFocusMode}
      >
        <Focus aria-hidden="true" className={styles.focusModeIcon} />
      </button>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
