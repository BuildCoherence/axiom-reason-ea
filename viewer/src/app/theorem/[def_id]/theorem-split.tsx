"use client";

import * as React from "react";
import { useDefaultLayout, useGroupRef } from "react-resizable-panels";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { safeLayoutStorage } from "@/components/ui/resizable-storage";

import styles from "./page.module.css";

// Theorem Page workspace split — the theorem info panel on the LEFT and the
// full-bleed flowchart canvas on the RIGHT, as a resizable two-pane group.
// This is the INNER split (the lean-UI side panel is the OUTER right pane, owned
// by `LeanUIShell`); the two groups nest, each with its own persisted width.
//
// Unlike the lean side panel (which mounts/unmounts as the visitor opens defs),
// BOTH panes here are ALWAYS mounted, so the restore path is simpler — no
// open-from-closed race against the lib's `derivedPanelConstraints`. We still
// need the rAF `setLayout` restore for the deep-link cold load, where SSR can't
// surface the persisted layout to the first client render (the storage shim
// collapses to `null` server-side), so `defaultSize` mounts at the rem default
// and the saved width must be re-applied after hydration — otherwise the lib's
// mount-time write clobbers the visitor's preference with the rem default. See
// `lean-ui-shell.tsx` for the full v4-timing rationale this mirrors.
//
// MOBILE: no resizable group — the info panel stacks ABOVE the canvas in a
// single vertical scroll (a side panel makes no sense at phone widths).

const INFO_PANEL_ID = "info";
const CANVAS_PANEL_ID = "canvas";

// Width policy — the info panel opens at a PROPORTION of the workspace so the
// flowchart canvas (the page's focal point) always keeps the majority at every
// viewport. A fixed 42rem default (a full ~80-char signature) used to crush the
// canvas to a sliver on a tablet (~810px); a proportional default keeps the
// split balanced from tablet to desktop. defaultSize takes a percentage; the
// rem min/max stay content-derived (the lib normalizes the mixed units).
//   - INFO_DEFAULT = 38% — the canvas takes the remaining ~62%. At ~810px
//     tablet that's ~308px info / ~502px canvas; at 1280px desktop ~486 / ~794.
//   - INFO_MIN = 16rem (~256px). A reading floor (a Lean signature stays
//     legible, just wraps more); low enough that the 38% default is never
//     clamped up across the tablet→desktop range.
//   - INFO_MAX = 60rem (~960px). Drag-to-widen for the full ~80-char signature
//     on one line; caps so the canvas is never crushed.
const INFO_DEFAULT_WIDTH = "38%";
const INFO_MIN_WIDTH = "16rem";
const INFO_MAX_WIDTH = "60rem";

export interface TheoremSplitProps {
  /** Left pane — the theorem info panel (synthetic signature + publish meta). */
  info: React.ReactNode;
  /** Right pane — the flowchart canvas (or the dag-absent fallback note). */
  canvas: React.ReactNode;
  /** Host-owned viewport reading (shared `useIsMobile`). */
  isMobile: boolean;
  /** Stable id keying the persisted width in localStorage. */
  id?: string;
}

export function TheoremSplit({
  info,
  canvas,
  isMobile,
  id = "theorem-info-panel-width",
}: TheoremSplitProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    panelIds: [INFO_PANEL_ID, CANVAS_PANEL_ID],
    storage: safeLayoutStorage,
  });

  // `defaultSize` is a CONSTANT (never the persisted value): both panes are
  // ALWAYS SSR'd, so deriving the mount size from localStorage would make the
  // server (rem default) and client (persisted %) markup disagree — a hydration
  // mismatch. Keeping it constant makes SSR and the first client render
  // identical; the saved width is re-applied imperatively below instead. (The
  // lean-UI shell can derive its side-panel size because that panel mounts
  // client-only on open, so there's no SSR markup to mismatch.)
  //
  // Restore path: after mount + the lib's Group re-render that publishes the
  // panel constraints, rAF-`setLayout` the persisted layout so it overwrites
  // the constant-default mount layout before the lib's debounced write persists
  // it — otherwise the mount-time write would clobber the saved width. No-op on
  // a first visit (defaultLayout undefined) and when the saved layout already
  // equals the default.
  const groupRef = useGroupRef();
  React.useEffect(() => {
    if (defaultLayout === undefined) return;
    const handle = requestAnimationFrame(() => {
      groupRef.current?.setLayout(defaultLayout);
    });
    return () => cancelAnimationFrame(handle);
  }, [defaultLayout]);

  if (isMobile) {
    return (
      <div className={styles.mobileStack}>
        <div className={styles.mobileInfo}>{info}</div>
        <div className={styles.mobileCanvas}>{canvas}</div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      id={id}
      orientation="horizontal"
      groupRef={groupRef}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id={INFO_PANEL_ID}
        defaultSize={INFO_DEFAULT_WIDTH}
        minSize={INFO_MIN_WIDTH}
        maxSize={INFO_MAX_WIDTH}
      >
        {info}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id={CANVAS_PANEL_ID}>{canvas}</ResizablePanel>
    </ResizablePanelGroup>
  );
}
