"use client";

import * as React from "react";

// Shared mobile-viewport hook. Returns `true` while the viewport is narrower
// than the project's `md` breakpoint (Tailwind v4 default: 768px), `false`
// otherwise.
//
// The `md` breakpoint is the same threshold GlobalNav uses to swap between
// its desktop entries and its mobile drawer, and the same threshold the lean-
// UI side panel uses to swap between the docked-pane chrome (desktop /
// tablet) and the bottom-sheet chrome (mobile). Lifting it into a single
// shared hook keeps every surface that branches on viewport size reading from
// ONE breakpoint constant — no parallel breakpoint mechanism per consumer.
//
// SSR note: the initial value during the first synchronous render is `false`
// (desktop default). The effect updates state on mount based on
// `window.matchMedia`. Consumers that mount unconditionally on the server may
// observe a one-frame mismatch between SSR-paint and the real viewport on
// narrow screens; the lean-UI shell consumes this hook from a Client
// Component that only mounts the panel after a client-only state change
// (`?def=` selection), so there is no SSR-vs-hydration class of bug for the
// panel's chrome swap.

// Tailwind v4's default `md` breakpoint is 768px. Mirrors GlobalNav's drawer
// threshold and side-panel.module.css's `.sheetRight` / `.sheetBottom` split.
const MD_BREAKPOINT_PX = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${MD_BREAKPOINT_PX - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    // `addEventListener` is the modern signature (Safari 14+, supported
    // across the project's compat matrix). The older `addListener` fallback
    // is left out — the project's Tailwind v4 / Next 15 baseline is already
    // past Safari 14.
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}
