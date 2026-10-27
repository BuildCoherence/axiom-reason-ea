"use client";

import * as React from "react";
import { useDefaultLayout, useGroupRef } from "react-resizable-panels";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { safeLayoutStorage } from "@/components/ui/resizable-storage";

// Host-page-agnostic docked IDE-style pane shell for the lean UI side panel.
// See the Lean UI Component design doc § "Side panel as a docked IDE-style
// pane (not an overlay sheet)" and § "Web rendering > Side panel" for the
// full contract. The shell is the layout primitive lifted out of the v1
// file-page-only body-dataset shim into a shared component
// the file page AND the profile page (and any future surface) consume.
//
// MOUNT — page-wide, not inside the reading column.
//
// Both host pages mount the shell at the page level (as the direct child of
// the chrome's `<main>` flex container), NOT inside the per-page 920px
// reading-column wrapper. The reading column lives INSIDE the shell's main
// slot instead. This matters: a `pre.shiki` `width: max-content` floor
// inside a 920px-capped main slot used to drag the side panel down to
// ~30-40px wide — the same shape every IDE workbench addresses by laying
// the editor + auxiliary bar out as viewport-edge siblings (see VS Code
// Web `src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts`).
// See the file-page spec § Composition for the full reasoning.
//
// VIEWPORT PINNING — both host routes mount the shell inside a workbench
// wrapper on `page.tsx`: `<div data-workbench className="fixed inset-x-0
// bottom-0 top-[var(--ce-nav-height)] flex flex-col overflow-hidden">`.
// The fixed-position box has a definite height (`top` + `bottom` together
// produce an explicit size, unlike the chrome's `min-h-dvh` floor which
// isn't definite for CSS percentage resolution), so the `ResizablePanelGroup`'s
// `flex h-full w-full` resolves trivially. Each pane manages its own internal
// scroll (file route: `.body`'s `overflow-y: auto`; profile route: `.main`'s
// `overflow-y: auto`). Side pane is naturally pinned next to the main pane
// because both are sibling flex items in the workbench row — no
// `position: sticky` is involved (and could not be: per
// https://github.com/bvaughn/react-resizable-panels/issues/469 `PanelGroup`
// sets `overflow: hidden` inline on its root, defeating sticky descendants).
//
// The workbench wrapper covers the marketing footer on both host routes
// — a deliberate IDE-layout tradeoff. The design doc's "Side panel as a
// docked IDE-style pane" decision already commits to uniform behaviour
// across host pages, so this is an intended consequence of that decision
// rather than a profile-specific shape. The wrapper lives on `page.tsx`
// (not a route-segment layout) so `not-found.tsx` / `error.tsx` siblings
// escape it and the 404 / error branches still render with the marketing
// footer visible.
//
// CHROME — viewport-adaptive, owned here rather than in the host page.
//
// Desktop / tablet (`!isMobile`): a horizontal `react-resizable-panels`
// `Group` with two `Panel`s — the main content (children) and the side panel
// (the `panel` prop) — separated by a `Separator` (resize handle). The handle
// + side panel are conditionally rendered together based on `panel !== null`
// so when the panel closes the main panel grows back to fill the freed
// space. The panel width is persisted via `useDefaultLayout` (the v4
// equivalent of v3's `autoSaveId`) keyed by the consumer-supplied `id` so
// width tracks ACROSS host pages (opening the panel on the profile page
// picks up the width the visitor set on the file page).
//
// Mobile (`isMobile`): no resizable group — the main content renders
// directly and the panel mounts beside it. The `panel` prop in the mobile
// branch is the `SidePanel` component itself, which renders the v1 bottom-
// `Sheet` chrome (modal, overlay, click-outside-to-close) internally; the
// shell does not wrap it in any container, it just sits next to the main
// content in the React tree. This preserves the v1 mobile sheet behaviour
// (focus trap, dimmed backdrop, dismiss-on-overlay-click) where it is the
// right gesture — a covering pane the visitor expects to click out of.
//
// STATE OWNERSHIP — the shell does NOT own panel-open state. It receives
// `panel: ReactNode | null` from the host, which derives it from
// `useDefSelection`. The shell renders whatever it is given.

export interface LeanUIShellProps {
  /**
   * Main content column. The host's primary content (file body or profile
   * content) — anything but the side panel itself.
   */
  children: React.ReactNode;
  /**
   * Side panel content, or null when the panel is closed. The host typically
   * passes `<SidePanel ... />` when open and `null` when closed. The shell
   * conditionally renders the resize handle + side `ResizablePanel`
   * together based on whether this is non-null.
   */
  panel: React.ReactNode | null;
  /**
   * Viewport size. The host owns the `useIsMobile` reading and forwards it
   * so the shell and the panel pick the SAME branch in the same render. Use
   * the shared `useIsMobile` hook from `@/hooks/use-is-mobile`.
   */
  isMobile: boolean;
  /**
   * Stable id used by `useDefaultLayout` to persist the desktop pane width
   * across page reloads (and across host pages — use the SAME id on the
   * file page and the profile page so the width is shared). Falls back to a
   * React-generated id if omitted, which disables cross-page persistence.
   */
  id?: string;
}

// Stable Panel ids — used both as the layout-persistence keys and as the
// `id` prop on each `ResizablePanel`. `useDefaultLayout`'s `panelIds` prop
// must match the ids that mount, so we list both even though the side panel
// is conditionally mounted (no-shows are simply absent from the stored
// layout map — `react-resizable-panels` tolerates this).
const MAIN_PANEL_ID = "main";
const SIDE_PANEL_ID = "side";

// Side-panel width policy — pixel-/rem-derived sizes grounded in prior art.
//
// `react-resizable-panels` v4 accepts string units on `defaultSize` /
// `minSize` / `maxSize` (lib README: "Pixels may also be specified as
// strings ending with the unit `px`. Other units should be specified as
// strings ending with their CSS property units (e.g. `1rem`, `50vh`).") We
// express the bounds as rem so the panel's comfortable-reading floor is
// content-derived (Lean type signatures at the panel's font size) rather
// than a fraction of whatever container hosts the shell.
//
// Recipe — citing prior art in IDE/sidebar widgets AND grounded in the
// actual rendering need:
//   - SIDE_MIN = 20rem  (~320px at the default font size). Above VS Code
//     Web's `auxiliaryBarPart.ts` 170px floor, well above shadcn
//     `Sidebar`'s `SIDEBAR_WIDTH = "16rem"` (256px), and — the load-
//     bearing constraint — wide enough to fit a typical Lean type
//     signature on one line. A line like `theorem add_comm (a b : Nat) :
//     a + b = b + a` is ~40 monospace chars; at the panel's `.codeSurface`
//     font-size of 0.85rem (≈ 13.6px) with proportional monospace widths
//     around 7-9px per char, 40 chars ≈ 320px, plus 1rem padding on each
//     side (≈ 32px). 20rem (~320px content + ~32px padding) is the floor
//     where a single-line Lean sig still reads as one line. Sibling-app
//     precedent (auxiliaryBarPart, shadcn Sidebar) sets the lower bound
//     but does NOT set the comfortable-reading bound; the content-derived
//     20rem does.
//   - SIDE_DEFAULT = 22rem (~352px). Between shadcn's 256px and the
//     ~400px width VS Code users commonly widen the auxiliary bar to.
//     Wide enough for a full `theorem … : ∀ …` signature line and the
//     qualified-name header in the panel.
//   - SIDE_MAX = 40rem (~640px). Caps at a reading-width-of-prose
//     equivalent so the main column is never crushed even on a narrow
//     viewport with the panel widened to its lib-enforced max.
//
// Sources (so the choices are auditable, not bespoke):
//   - VS Code aux-bar minimum: src/vs/workbench/browser/parts/
//     auxiliarybar/auxiliaryBarPart.ts → `minimumWidth: 170`.
//   - shadcn Sidebar default: apps/v4/registry/new-york-v4/ui/sidebar.tsx
//     → `SIDEBAR_WIDTH = "16rem"`.
//   - rustdoc sidebar (200px hardcoded) for a third reference point —
//     rust-lang/rust#139302 discussion.
//   - Content-derived floor: ~40 monospace chars at 0.85rem font + 1rem
//     padding both sides; see `.codeSurface` in side-panel.module.css.
const SIDE_PANEL_MIN_WIDTH = "20rem";
const SIDE_PANEL_DEFAULT_WIDTH = "22rem";
const SIDE_PANEL_MAX_WIDTH = "40rem";

function validSidePanelLayout(
  layout: Record<string, number> | undefined,
): layout is Record<string, number> {
  const side = layout?.[SIDE_PANEL_ID];
  const main = layout?.[MAIN_PANEL_ID];
  return (
    typeof main === "number" &&
    Number.isFinite(main) &&
    main > 0 &&
    main < 100 &&
    typeof side === "number" &&
    Number.isFinite(side) &&
    side > 0 &&
    side < 100
  );
}

export function LeanUIShell({
  children,
  panel,
  isMobile,
  id = "lean-ui-shell",
}: LeanUIShellProps) {
  const [hasHydrated, setHasHydrated] = React.useState(false);
  const panelOpen = panel !== null;
  const panelOpenOnFirstRender = React.useRef(panelOpen);

  React.useEffect(() => {
    setHasHydrated(true);
  }, []);

  // `useDefaultLayout` is `react-resizable-panels` v4's replacement for v3's
  // `autoSaveId`. `onLayoutChanged` is the WRITE path: it's wired to the
  // `Group` so resize results land in localStorage under the consumer-
  // supplied `id`. Listing both panel ids in `panelIds` keeps the storage
  // key shape stable whether the side pane is currently open or closed,
  // so the saved width is keyed against the visitor's intent
  // (`<group-id>:main:side`) rather than the transient mount state.
  //
  // The hook's READ surface (`defaultLayout`) feeds two restoration paths
  // below that together cover the two routes by which the side `Panel`
  // can come up — the click-from-closed transition and the deep-link cold
  // load. See the spec doc ("Behavior" § Desktop / tablet) for the full
  // rationale; in brief, neither of the two obvious single-mechanism
  // approaches works on its own:
  //   - The Group's `defaultLayout` prop is mount-only (v4 reads it once
  //     at registration), and SSR / hydration can't surface a
  //     `localStorage`-sourced layout to the initial render at all.
  //   - An imperative `setLayout` from a parent `useEffect` on the
  //     panel-open transition races with the lib's
  //     `derivedPanelConstraints` re-publish: the side `Panel`'s
  //     `registerPanel` schedules a Group re-render, but the parent
  //     effect fires before that re-render commits, so `setLayout` sees
  //     stale 1-entry constraints against a 2-entry layout and throws
  //     `Invalid 1 panel layout: …` — the bug behind issue #871.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    panelIds: [MAIN_PANEL_ID, SIDE_PANEL_ID],
    storage: safeLayoutStorage,
  });
  const initialDefaultLayout = React.useRef<typeof defaultLayout>(undefined);
  if (
    !hasHydrated &&
    initialDefaultLayout.current === undefined &&
    validSidePanelLayout(defaultLayout)
  ) {
    initialDefaultLayout.current = defaultLayout;
  }
  const hasInitialDefaultLayout = initialDefaultLayout.current !== undefined;
  const restoredDefaultLayout = initialDefaultLayout.current ?? defaultLayout;
  const hasRestoredDefaultLayout = validSidePanelLayout(restoredDefaultLayout);

  // Path 1 — click-from-closed (side Panel mounts on the client when the
  // visitor opens the pane). `defaultSize` is read at the Panel's mount,
  // so the saved width is applied at exactly the right moment with no
  // imperative call needed and no race against `derivedPanelConstraints`.
  //
  // `defaultLayout` values are 0..100 percentages (see
  // `GroupImperativeHandle.setLayout` jsdoc), and the lib accepts
  // string percentages on `defaultSize` (e.g. "30%" — see the lib's
  // `parseSize`-equivalent at `react-resizable-panels.js:24`). We
  // require a *strict* positive-finite-percentage shape (not just
  // `!== undefined`) so a future migration that writes a degenerate
  // `0` or `100` doesn't push the lib to its `minSize` clamp on
  // every open — the lib would still clamp safely, but the visitor's
  // explicit-23.669% preference shouldn't quietly collapse to 20rem
  // because of a storage corruption.
  //
  // The hydration gate is load-bearing. `useDefaultLayout` reads browser
  // storage during the first client render, so using it immediately here
  // makes the client render `${saved}%` while SSR rendered `22rem`,
  // producing React's "attributes didn't match" warning on deep-linked
  // panel loads. Keep SSR and hydration on the same rem default; after
  // hydration, saved percentages are safe for click-from-closed panel
  // mounts, while the rAF `setLayout` effect below restores deep-linked
  // panels that were already mounted during hydration.
  const sidePanelDefaultSize: string =
    hasHydrated &&
    hasRestoredDefaultLayout
      ? `${restoredDefaultLayout[SIDE_PANEL_ID]}%`
      : SIDE_PANEL_DEFAULT_WIDTH;

  // Path 2 — deep-link cold load (`/u/X?def=Y` or `/f/X?def=Y` directly).
  // The side `Panel` is already in the SSR'd HTML because `selectedDefId`
  // is non-null on the first render (force-dynamic routes resolve
  // `useSearchParams` synchronously). During hydration the side `Panel`
  // still receives `SIDE_PANEL_DEFAULT_WIDTH` so its inline `flex-basis`
  // matches SSR. A saved `defaultLayout` may already be available from
  // browser storage, but `defaultSize` is hydration-gated above and is
  // mount-only anyway, so the saved width must be restored imperatively.
  // `defaultSize` is mount-only, so the post-hydration prop change to
  // `${saved}%` does NOT re-size the already-mounted Panel; without an
  // imperative restoration, the lib's mount-time layout remains the
  // 22rem-derived one and can overwrite the visitor's saved preference.
  //
  // The imperative call is wrapped in `requestAnimationFrame` so it
  // lands AFTER React's commit + the lib's Group re-render that
  // publishes `derivedPanelConstraints` for the side Panel's
  // registration (the "v4 timing window" PR #872's description named
  // and couldn't close from a synchronous effect). On the deep-link
  // path this also lands ahead of the lib's 100ms `onLayoutChanged`
  // storage-write debounce, so the saved layout overwrites the
  // 22rem-derived one before either is persisted. On the click-from-
  // closed path the side Panel's `defaultSize` already matches the
  // saved value, so `setLayout` is a no-op against the lib's
  // already-correct layout — kept harmless on this path, load-
  // bearing on the other.
  const groupRef = useGroupRef();
  React.useEffect(() => {
    if (!hasRestoredDefaultLayout || !panelOpen) {
      return;
    }
    const handle = requestAnimationFrame(() => {
      groupRef.current?.setLayout(restoredDefaultLayout);
    });
    return () => cancelAnimationFrame(handle);
  }, [hasRestoredDefaultLayout, restoredDefaultLayout, panelOpen]);

  // The imperative restore above is retained as a fallback, but a deep-linked
  // panel is already mounted during hydration. In v4, that path can miss the
  // post-hydration `setLayout` timing window and stay at the SSR-safe 22rem
  // default. Remount only the side Panel exactly once after hydration for that
  // cold-load shape so its saved `defaultSize` is read during Panel mount,
  // while the main content stays mounted and keeps its selected-decl anchor
  // lifecycle intact.
  const restoreSidePanelOnHydration =
    hasHydrated &&
    panelOpenOnFirstRender.current &&
    panelOpen &&
    hasInitialDefaultLayout;
  const sidePanelKey = restoreSidePanelOnHydration ? "restored" : "initial";

  if (isMobile) {
    // Mobile branch — no resizable group. The `panel` (typically a
    // `<SidePanel>` instance) renders its own bottom-`Sheet` chrome
    // internally; the shell is just a passthrough so React composition still
    // mounts both subtrees at the same level. v1 modal sheet semantics
    // (focus trap, dimmed overlay, click-outside-to-close) ride on the
    // SidePanel's internal Sheet, untouched by the shell.
    return (
      <>
        {children}
        {panel}
      </>
    );
  }

  // Desktop / tablet branch — docked IDE-style pane. The handle + side
  // panel are mounted together only when `panel !== null`; `Group` happily
  // recomputes its layout when its child set changes, and the main panel
  // grows back to fill the freed width when the panel closes.
  //
  // The MAIN panel deliberately omits an explicit `defaultSize`: the lib
  // auto-assigns the remaining space (see PanelProps.defaultSize jsdoc:
  // "default is auto-assigned based on the total number of Panels"), so
  // sizing the side panel in rem leaves the main column with whatever the
  // group has left — the right behavior when the group width is itself
  // viewport-relative.
  return (
    <ResizablePanelGroup
      id={id}
      orientation="horizontal"
      groupRef={groupRef}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel id={MAIN_PANEL_ID}>{children}</ResizablePanel>
      {panel !== null ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            key={sidePanelKey}
            id={SIDE_PANEL_ID}
            defaultSize={sidePanelDefaultSize}
            minSize={SIDE_PANEL_MIN_WIDTH}
            maxSize={SIDE_PANEL_MAX_WIDTH}
          >
            {panel}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}
