"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import styles from "./shortcuts-help.module.css";

// Small "?"-triggered help dialog listing the file-body keyboard shortcuts.
// Lives in `CeFileBody`. Pure presentation; the parent owns `open` and
// closes the dialog on Esc (via Radix Dialog's default behaviour).
//
// SHORTCUT LIST is hard-coded here rather than passed as a prop — the dialog
// describes the keys this file-page surface binds (see ce-file-body.tsx),
// and the source-of-truth for those bindings IS this dialog when the visitor
// looks for it. Keeping the list inline keeps the two in lockstep.

export interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Shortcut {
  /**
   * One or more key glyphs — rendered as side-by-side `<kbd>` chips.
   * Each entry is `[glyph, ariaLabel]`: the glyph is the visible character
   * (e.g. "/", "j", "?") and the ariaLabel is what assistive tech reads
   * (e.g. "forward slash", "J key", "Escape"). iOS VoiceOver elides
   * single-glyph keyboard hints without a label — and the dialog's whole
   * purpose is teaching keystrokes, so the labels are required here.
   */
  keys: [glyph: string, ariaLabel: string][];
  /** Plain description shown next to the chips. */
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  {
    keys: [["/", "forward slash"]],
    description: "Search this file's declarations",
  },
  {
    keys: [["j", "J key"]],
    description: "Jump to next declaration (opens panel)",
  },
  {
    keys: [["k", "K key"]],
    description: "Jump to previous declaration (opens panel)",
  },
  { keys: [["f", "F key"]], description: "Toggle focus mode" },
  { keys: [["Esc", "Escape"]], description: "Dismiss" },
  { keys: [["?", "question mark"]], description: "Show this help dialog" },
];

// Mouse / pointer gestures the file body binds. Listed alongside the
// keyboard shortcuts so the help dialog stays the source-of-truth for
// every discoverable interaction on the surface. Currently one entry —
// the line-number gutter click — but the section is structured so future
// gestures (right-click, double-click, etc.) can join without restructuring.
interface Gesture {
  /** Plain description of the gesture (e.g. "Click a line number"). */
  gesture: string;
  /** Plain description of what it does. */
  description: string;
}

const GESTURES: Gesture[] = [
  {
    gesture: "Click a line number",
    description: "Scroll that line into view",
  },
];

export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.content}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Available while reading the source body.
          </DialogDescription>
        </DialogHeader>
        <dl className={styles.list}>
          {SHORTCUTS.map((s) => (
            <React.Fragment key={s.keys.map(([k]) => k).join("+")}>
              <dt className={styles.keys}>
                {s.keys.map(([glyph, ariaLabel]) => (
                  <kbd key={glyph} className={styles.kbd} aria-label={ariaLabel}>
                    {glyph}
                  </kbd>
                ))}
              </dt>
              <dd className={styles.description}>{s.description}</dd>
            </React.Fragment>
          ))}
        </dl>
        <h3 className={styles.gesturesHeading}>Mouse</h3>
        <dl className={styles.list}>
          {GESTURES.map((g) => (
            <React.Fragment key={g.gesture}>
              <dt className={styles.gestureName}>{g.gesture}</dt>
              <dd className={styles.description}>{g.description}</dd>
            </React.Fragment>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
