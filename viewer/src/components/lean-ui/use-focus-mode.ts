"use client";

import * as React from "react";

// "Focus mode" — an in-page chrome-hider for the CE file viewer.
//
// State model. A single module-scope boolean is the source of truth.
// React components subscribe via `useSyncExternalStore` so every consumer
// reads from the SAME value — flipping it from any surface updates every
// subscriber in the same paint. The consumers are the body's `f` hotkey
// binding (file route) and the status bars' `FocusModeButton` (file +
// profile routes — every route whose workbench covers the chrome needs a
// visible exit affordance, since the hidden-nav state persists across
// navigation). The store is also mirrored to `<html
// data-focus-mode="true">` (so chrome-hiding CSS selectors in
// globals.css can read it without prop-drilling) and persisted to
// localStorage so a refresh keeps the visitor in focus mode if they
// were in it.
//
// Screen-reader feedback. Toggles also update a module-scope ANNOUNCEMENT
// string ("Focus mode on" / "Focus mode off") that `FocusModeButton`
// renders into a polite live region — hiding the page chrome is otherwise
// a silent state change to a screen-reader user, whichever surface
// triggered it. The localStorage rehydration on mount deliberately does
// NOT announce (nothing changed from the visitor's point of view; the
// page simply loaded in the state they left it in).
//
// Why useSyncExternalStore (not React context). A context provider would
// have to wrap a common ancestor of every consumer. The body and the
// status bar mount as siblings under different route-segment subtrees
// (`CeFileBody` inside the file route's body; `StatusBar` outside it),
// so the smallest common ancestor is the route layout — and threading a
// provider through that layout to pass one boolean is more plumbing than
// the affordance warrants. `useSyncExternalStore` is the React-idiomatic
// fit for a small cross-tree shared state of this exact shape: it
// participates in concurrent rendering and tearing protection, unlike a
// bare custom-event channel.
//
// Why not the Fullscreen API. Focus mode is a SUBTLER affordance than
// browser fullscreen: it hides our own global nav + marketing footer and
// lets the workbench fill the tab, but the browser's tabs / address bar
// stay visible and ESC does not need to be pressed to exit. Closer to
// GitHub's "expand to full width" or rustdoc's reader mode than to
// document.documentElement.requestFullscreen(). The fullscreen API was
// previously used here and replaced because the modal-style "no tabs, no
// address bar, ESC to exit" UX was too heavy for a code reading surface.
//
// SSR-safe. The server snapshot is `false` (no `<html data-focus-mode>`).
// The first client effect reads localStorage and seeds the store; the
// useSyncExternalStore subscription then drives every consumer.

const STORAGE_KEY = "ce-focus-mode";
const HTML_ATTR = "data-focus-mode";

// Module-scope store. `value` is the current focus-mode state; `seeded`
// guards the localStorage read so the rehydration effect runs once
// across the lifetime of the page, regardless of how many consumers
// mount. Listeners are notified on every change.
let value = false;
let seeded = false;
// Live-region text. Empty until the FIRST user toggle so mounting (and
// the localStorage rehydration) never announces; thereafter alternates
// "Focus mode on" / "Focus mode off", and the text CHANGE is what makes
// the live region re-announce.
let announcement = "";
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return value;
}

function getAnnouncementSnapshot(): string {
  return announcement;
}

function getServerAnnouncementSnapshot(): string {
  return "";
}

// Server snapshot — always `false` so SSR markup is deterministic. The
// chrome stays visible on the server render; the client effect below
// rehydrates to localStorage and re-renders if needed.
function getServerSnapshot(): boolean {
  return false;
}

function applyToDom(next: boolean): void {
  if (typeof document === "undefined") return;
  if (next) {
    document.documentElement.setAttribute(HTML_ATTR, "true");
  } else {
    document.documentElement.removeAttribute(HTML_ATTR);
  }
}

function persistToStorage(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (next) {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage access can throw in some embedded / private-mode
    // contexts. Silent fail — focus mode just doesn't persist.
  }
}

function setValue(next: boolean, opts?: { announce?: boolean }): void {
  if (value === next) return;
  value = next;
  if (opts?.announce) {
    announcement = next ? "Focus mode on" : "Focus mode off";
  }
  applyToDom(next);
  persistToStorage(next);
  notify();
}

export interface FocusMode {
  /** Current focus-mode state. `false` server-side and on first render. */
  focusMode: boolean;
  /**
   * Live-region text for the last user toggle ("Focus mode on" / "Focus
   * mode off"); empty until the first toggle. Rendered by
   * `FocusModeButton`'s polite live region.
   */
  announcement: string;
  /** Set to a specific value (used by toggles + programmatic exits). */
  setFocusMode: (next: boolean) => void;
  /** Flip the state. The button click and the `f` hotkey use this. */
  toggleFocusMode: () => void;
}

export function useFocusMode(): FocusMode {
  const focusMode = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const announcement = React.useSyncExternalStore(
    subscribe,
    getAnnouncementSnapshot,
    getServerAnnouncementSnapshot,
  );

  // Hydrate from localStorage exactly once across the whole page (the
  // `seeded` guard is module-scope, so a second consumer mounting does
  // not re-read). `[]` deps is correct: the read is a one-shot bootstrap
  // and subsequent toggles go through setValue.
  React.useEffect(() => {
    if (seeded) return;
    seeded = true;
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "true") {
        setValue(true);
      }
    } catch {
      // See persistToStorage.
    }
  }, []);

  const setFocusMode = React.useCallback((next: boolean) => {
    setValue(next, { announce: true });
  }, []);

  const toggleFocusMode = React.useCallback(() => {
    setValue(!value, { announce: true });
  }, []);

  return { focusMode, announcement, setFocusMode, toggleFocusMode };
}
