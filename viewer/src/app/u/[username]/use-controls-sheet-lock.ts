"use client";

import * as React from "react";

// useControlsSheetLock — "canvas controls locked to the bottom sheet" on MOBILE.
//
// Google-Maps style: the Sigma zoom/center control card rides a fixed 12px gap
// above the LIVE top edge of the Vaul bottom sheet, moving CONTINUOUSLY as the
// sheet is dragged or snapped (the discrete `activeSnapPoint` React state can't
// capture mid-drag motion, so we observe the DOM element directly).
//
// MECHANISM — the hook owns ALL the geometry and publishes a single final px
// value the CSS just consumes:
//
//   --controls-sheet-bottom : "<px>px"   (set on document.documentElement)
//
// `profile-graph.module.css` reads it on mobile as
//   .controls { bottom: var(--controls-sheet-bottom, 8rem) !important }
// so the card's `bottom` (measured by the library from its positioning
// container) places its bottom edge `GAP_PX` above the sheet's top edge:
//
//   bottom = containerRect.bottom - drawerRect.top + GAP_PX
//
// where `container` is the control card's offsetParent (the `.react-sigma`
// positioning context — NOT the viewport), so the value is correct even if the
// graph container doesn't reach the viewport bottom (e.g. an inconsistency strip
// pinned above it). `drawer` is Vaul's content element (`[data-vaul-drawer]`).
//
// SMOOTHNESS — a requestAnimationFrame loop runs ONLY while motion is in
// progress: it is kicked on a pointer drag (`pointerdown`→`pointerup` within the
// drawer) and on the snap `transform` transition (`transitionstart`/
// `transitionend`), plus a ResizeObserver on the drawer and a window `resize`.
// The loop early-exits once the value has been stable for `SETTLE_FRAMES`
// frames, so there is never a permanently-spinning rAF.
//
// ROBUSTNESS — the drawer (a Portal) and the graph island (an ssr:false dynamic
// import) may both mount AFTER this effect first runs, so we retry via a
// MutationObserver until both elements exist. When `enabled` is false (desktop)
// or on unmount we remove the var and tear everything down.

const VAR_NAME = "--controls-sheet-bottom";
const GAP_PX = 12; // fixed gap between the control card and the sheet's top edge
const SETTLE_FRAMES = 6; // stop the rAF loop after this many unchanged frames

export function useControlsSheetLock(enabled: boolean): void {
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const root = document.documentElement;

    const findDrawer = (): HTMLElement | null =>
      document.querySelector<HTMLElement>("[data-vaul-drawer]");
    const findControls = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(".react-sigma-controls");

    // The final `bottom` px (relative to the control card's positioning
    // container), or null until both the sheet and the control card exist.
    const compute = (): number | null => {
      const drawer = findDrawer();
      const controls = findControls();
      if (!drawer || !controls) return null;
      // The card is positioned (absolute) by the library relative to its nearest
      // positioned ancestor — the `.react-sigma` div. Measure `bottom` from that
      // same box so the math matches what CSS does with the value.
      const container =
        (controls.offsetParent as HTMLElement | null) ??
        controls.closest<HTMLElement>(".react-sigma");
      if (!container) return null;
      const containerRect = container.getBoundingClientRect();
      const drawerRect = drawer.getBoundingClientRect();
      return containerRect.bottom - drawerRect.top + GAP_PX;
    };

    let rafId = 0;
    let stableFrames = 0;
    let pointerActive = false;
    let lastPublished = Number.NaN;
    let detached = false;

    const measure = (): void => {
      const v = compute();
      // Treat "not ready" (null) like "unchanged" so a missing drawer lets the
      // loop settle and stop rather than spin forever; the observers re-kick it.
      if (v === null || Math.abs(v - lastPublished) < 0.5) {
        stableFrames += 1;
        return;
      }
      stableFrames = 0;
      lastPublished = v;
      root.style.setProperty(VAR_NAME, `${Math.round(v)}px`);
    };

    const loop = (): void => {
      rafId = 0;
      if (detached) return;
      measure();
      // Keep going while a drag is live, or until the value has settled (covers
      // the snap-transition tail after pointerup, where the value keeps moving).
      if (pointerActive || stableFrames < SETTLE_FRAMES) {
        rafId = requestAnimationFrame(loop);
      }
    };

    const kick = (): void => {
      stableFrames = 0; // re-arm the settle window for the new motion
      if (!rafId) rafId = requestAnimationFrame(loop);
    };

    // ---- Event wiring ------------------------------------------------------
    // Pointer + resize on `window` (capture) so they don't depend on element
    // identity (Vaul may re-create / pointer-capture during a drag).
    const onPointerDown = (e: PointerEvent): void => {
      const drawer = findDrawer();
      if (drawer && e.target instanceof Node && drawer.contains(e.target)) {
        pointerActive = true;
        kick();
      }
    };
    const onPointerUp = (): void => {
      if (!pointerActive) return;
      pointerActive = false;
      kick(); // let the loop settle through the snap animation
    };
    // Only the sheet's `transform` transition moves its top edge — ignore other
    // (descendant / opacity) transitions that bubble to the drawer element.
    const onTransition = (e: TransitionEvent): void => {
      if (e.propertyName === "transform") kick();
    };
    const onResize = (): void => kick();

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("resize", onResize);

    // Element-bound observers (the drawer): (re)attached once it is in the DOM.
    let observedDrawer: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;

    const attach = (): boolean => {
      const drawer = findDrawer();
      const controls = findControls();
      if (!drawer || !controls) return false;
      observedDrawer = drawer;
      drawer.addEventListener("transitionstart", onTransition);
      drawer.addEventListener("transitionend", onTransition);
      ro = new ResizeObserver(() => kick());
      ro.observe(drawer);
      kick(); // initial measurement
      return true;
    };

    // The drawer Portal + the ssr:false graph island can mount after this effect
    // runs — poll via a MutationObserver until both are present, then stop.
    let mo: MutationObserver | null = null;
    if (!attach()) {
      mo = new MutationObserver(() => {
        if (attach()) {
          mo?.disconnect();
          mo = null;
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      detached = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("resize", onResize);
      if (observedDrawer) {
        observedDrawer.removeEventListener("transitionstart", onTransition);
        observedDrawer.removeEventListener("transitionend", onTransition);
      }
      ro?.disconnect();
      mo?.disconnect();
      root.style.removeProperty(VAR_NAME);
    };
  }, [enabled]);
}
