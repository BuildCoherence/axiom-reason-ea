"use client";

import * as React from "react";
import Fuse from "fuse.js";

import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import type { DeclLabel } from "./types";
import styles from "./command-palette.module.css";

// "Jump to declaration" palette — opens on `/` from the file body, closes on
// Esc / outside-click (Radix Dialog's defaults inside shadcn's `CommandDialog`).
// Lives inside `CeFileBody`, which owns the `decls` array; the palette filters
// it by `local_name` + `qualified_name` via fuse.js.
//
// WHY fuse.js — visitors typing partial / out-of-order chars in a leaf name
// shouldn't get a substring-only match. Fuse's default fuzzy scoring matches
// the mental model "I'm typing the first few chars of the leaf name I half-
// remember." The local_name gets a higher weight than the qualified_name
// because the visitor's mental model anchors on the leaf — VS Code's quick-
// open does the same prioritisation.
//
// VIRTUALIZATION — deferred. Files ship with ~50 decls (BFO+Theorems). The
// virtualization knob lands when a real file pushes past 200 (the threshold
// the design doc names). cmdk's `CommandList` already provides a fixed-height
// scroller for the overflow case, so render-cost is bounded.

export interface CommandPaletteProps {
  /** Whether the palette is mounted-open. The parent toggles via `/` / Esc. */
  open: boolean;
  /** Parent toggles `open`. Bound to Radix Dialog's `onOpenChange`. */
  onOpenChange: (open: boolean) => void;
  /** All file-level decls — palette filters this list. */
  decls: DeclLabel[];
  /**
   * Called when the visitor picks a row. Parent scrolls the matching DOM
   * element into view AND opens the side panel anchored to that decl.
   */
  onSelect: (def_id: string) => void;
}

// Fuse threshold ranges 0.0 (exact) to 1.0 (anything matches). 0.4 picks up
// typos and partial leaf names while still ranking exact-prefix matches
// first.
const FUSE_THRESHOLD = 0.4;

export function CommandPalette({
  open,
  onOpenChange,
  decls,
  onSelect,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");

  // Reset the query each time the palette re-opens so a stale search doesn't
  // greet the visitor on the next `/` press.
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Build the fuse index once per `decls` identity. The decls array is
  // server-passed and stable across CeFileBody state churn, so this index
  // is effectively built once per page load.
  const fuse = React.useMemo(
    () =>
      new Fuse(decls, {
        keys: [
          { name: "local_name", weight: 0.7 },
          { name: "qualified_name", weight: 0.3 },
        ],
        threshold: FUSE_THRESHOLD,
        // Don't require all chars to be contiguous — typing "FtT" should
        // still match "FormalTheoryOf...". Fuse's default tokenizer covers
        // this when the query is short.
        ignoreLocation: true,
      }),
    [decls],
  );

  // Empty query → show the full list in source order. Non-empty → run fuse;
  // fuse preserves its ranked order so the visitor's typing surfaces the
  // most-relevant matches first.
  const visible = React.useMemo<DeclLabel[]>(() => {
    if (query.trim() === "") return decls;
    return fuse.search(query).map((r) => r.item);
  }, [decls, fuse, query]);

  // cmdk's CommandList has its own filter pipeline — we already filter via
  // fuse, so disable cmdk's built-in filter by passing `shouldFilter={false}`
  // on the Command primitive (handled via the parent CommandDialog props).
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to declaration"
      description="Filter file declarations by leaf or qualified name"
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Type a declaration name…"
        value={query}
        onValueChange={setQuery}
        className={styles.input}
      />
      <CommandList>
        <CommandEmpty>No matching declarations</CommandEmpty>
        {visible.map((decl) => (
          <CommandItem
            key={decl.def_id}
            value={decl.def_id}
            onSelect={() => onSelect(decl.def_id)}
          >
            <span className={styles.localName}>{decl.local_name}</span>
            <span className={styles.qualifiedName}>{decl.qualified_name}</span>
          </CommandItem>
        ))}
      </CommandList>
      {/* Footer hints — cmdk's standard navigation glyphs (↑↓ navigate / ↵
       * open / Esc close) plus a discoverability prompt for the broader
       * shortcuts dialog. Lives inside the CommandDialog so the hints
       * surface only when the visitor is actually looking at the palette. */}
      <div className={styles.footer} aria-hidden="true">
        <span className={styles.footerHint}>
          <kbd className={styles.kbd}>↑</kbd>
          <kbd className={styles.kbd}>↓</kbd>
          navigate
        </span>
        <span className={styles.footerHint}>
          <kbd className={styles.kbd}>↵</kbd>
          open
        </span>
        <span className={styles.footerHint}>
          <kbd className={styles.kbd}>Esc</kbd>
          close
        </span>
        <span className={styles.footerHint}>
          <kbd className={styles.kbd}>?</kbd>
          all shortcuts
        </span>
      </div>
    </CommandDialog>
  );
}
