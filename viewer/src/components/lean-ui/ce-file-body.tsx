"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useHotkeys } from "react-hotkeys-hook";
import type { Root } from "hast";

import { HoldersModal } from "@/components/theorem-flowchart/holders-modal";
import type { DrillInRequest } from "@/components/theorem-flowchart/types";
import { useIsMobile } from "@/hooks/use-is-mobile";

import { CommandPalette } from "./command-palette";
import { cssAttrEscape } from "./dom-utils";
import {
  IdentifierPopoverHost,
  IDENTIFIER_POPOVER_CONTENT_ID,
  shouldShowPopover,
  type PopoverTarget,
} from "./identifier-popover";
import { LeanUIShell } from "./lean-ui-shell";
import {
  renderHast,
  TokenInteractionContext,
  type TokenInteraction,
} from "./render-hast";
import { ShortcutsHelp } from "./shortcuts-help";
import { SidePanel } from "./side-panel";
import { PropositionPanel } from "./proposition-panel";
import { useDefData } from "./use-def-data";
import { usePropData } from "./use-prop-data";
import { useSelection } from "./use-selection";
import { useFocusMode } from "./use-focus-mode";
import type { IdentifierPopoverHandlers } from "./use-identifier-popover";
import type { Decl, TokenTag, ViewChoice } from "./types";
import styles from "./ce-file-body.module.css";

// CE file page body — the thin Client Component that renders the server-
// DECORATED Shiki hast (HTML AST) for the whole file's source as a REAL React
// element tree and layers interaction on top of it through normal React.
//
// ARCHITECTURE — render identity from authoritative data, via React.
//
// The page (Server Component) drives Shiki's `decorations` API from the
// backend's per-decl `source_tokens` (exact UTF-8 byte ranges). Shiki splits
// its own syntax tokens at those offsets and stamps our `data-*` attributes
// onto the resulting identifier nodes server-side. So the nodes arrive already
// carrying their navigation identity:
//
//   data-kind="identifier", data-token-id, data-qualified-name (opt),
//   data-hover-kind (opt), data-binder-role (opt), data-token-role (opt —
//   "control_atom" forces non-interactive rendering),
//   data-inlined-type-summary (opt); and for clickable (def_id-resolved)
//   tokens: data-def-id, tabindex="0", role="button", class="ce-identifier";
//   plus data-decl-wrapper=<def_id> on each decl's header token.
//
// Instead of injecting an HTML string and delegating native listeners over it,
// we render the hast tree to React elements ourselves (a small recursive
// `renderHast` walker — dep-free; the hast shape Shiki emits is simple).
// Identifier nodes (`data-kind="identifier"`) become an interactive
// `<IdentifierSpan>` with React onClick / onKeyDown / onMouseEnter / onFocus /
// onMouseLeave / onBlur; import/open file-reference nodes
// (`data-kind="file-ref"`) become a `<FileRefLink>` real anchor that
// SPA-navigates to `/f/<target>`; every other node is a plain React element.
// Click
// formation and keyboard focus now work because React owns these nodes — no
// subtree gets re-committed out from under the pointer, so there is no
// MutationObserver / memo / delegated-listener machinery anymore.
//
// The rendered tree is memoised on `hast`; the interaction callbacks reach it
// through `TokenInteractionContext` so the walker output and the tree stay
// stable across CeFileBody's frequent state re-renders (popover open/close,
// panel fetch state, view toggle, …) while handlers still read latest state.
//
// URL state (`?def=`) lives in the `useDefSelection` hook (uses
// useSearchParams — the page wraps this component in <Suspense>).

export interface CeFileBodyProps {
  /** This file's `<base50>` id. */
  fileId: string;
  /**
   * Server-decorated Shiki hast (HTML AST) for the entire file's source.
   * Rendered as a real React element tree via `renderHast`. hast is a plain,
   * JSON-serialisable object tree, so it crosses the RSC → client boundary as a
   * prop fine. Safety is NOT a matter of provenance: some decoration properties
   * (data-qualified-name, data-inlined-type-summary) ARE source-derived; the
   * invariant is that we set every attribute as a React prop (React escapes
   * them) and emit the source as React text children — no value is ever placed
   * in a raw-HTML / non-escaping context.
   */
  hast: Root;
  /**
   * Server-rendered file header. Rendered inside the shell's main column
   * (above the source body, inside the 920px reading-column constraint).
   * Passed in as a slot rather than imported here so this client component
   * doesn't need to know about the header's server-only data fetching.
   */
  header: React.ReactNode;
  /**
   * Per-decl envelopes for this file (the same array `buildDecorations`
   * consumes). Used by the sticky-decl-header overlay to look up the
   * currently-topmost decl's `local_name` / `qualified_name` from its
   * `def_id` (read off the source body's `[data-decl-wrapper]` token).
   * Empty array when the file has no decls. The full envelopes are
   * passed (not a `[def_id, label]` projection) so the overlay can be
   * extended without changing the wire shape — and the overlay's lookup
   * runs at click time, never per scroll tick.
   */
  decls: Decl[];
}

// Width of the line-number gutter, in rem. Used by the click-on-gutter
// scroll-to-line handler to decide whether a click landed in the gutter strip
// (left of this offset) vs in the source body.
const LINE_NUMBER_GUTTER_REM = 3.5;

export function CeFileBody({ fileId, hast, header, decls }: CeFileBodyProps) {
  const router = useRouter();
  const {
    selectedDefId,
    selectedPropId,
    selectDef,
    replaceDef,
    selectProp,
    back,
    forward,
    close,
    canBack,
    canForward,
    urlReader,
  } = useSelection();

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // ---- Panel data (?def=) ---------------------------------------------------
  const {
    defData,
    state: panelState,
    errorStatus,
    retry: retryFetch,
  } = useDefData(selectedDefId);
  // A generated decl's def file carries its owner declaration; canonicalize
  // the URL to it.
  React.useEffect(() => {
    if (defData !== null && selectedDefId !== null && defData.decl.def_id !== selectedDefId) {
      replaceDef(defData.decl.def_id);
    }
  }, [defData, selectedDefId, replaceDef]);

  const {
    propData,
    state: propPanelState,
    errorStatus: propErrorStatus,
    retry: retryPropFetch,
  } = usePropData(selectedPropId);

  // ---- Panel view (author/empty) state ----------------------------------
  // The file body is locked to author's view; the panel has its own toggle
  // (local state — URL-encoded view is a future revision, not v1).
  const [panelView, setPanelView] = React.useState<ViewChoice>({
    kind: "author",
  });

  const [drillIn, setDrillIn] = React.useState<DrillInRequest | null>(null);
  const onHoldersDrillIn = React.useCallback(
    (args: {
      side: "pro" | "con";
      proposition_id: string;
      element: HTMLElement;
    }) => {
      setDrillIn({
        kind: "holders",
        side: args.side,
        proposition_id: args.proposition_id,
        element: args.element,
      });
    },
    [],
  );
  const closeDrillIn = React.useCallback(() => setDrillIn(null), []);

  // ---- Identifier click — single unified handler -------------------------
  //
  // Per the design doc § "In-panel drill-down history", every selection
  // that changes the panel — whether the click originated in the source
  // body, inside the panel itself, the command palette, or the outline
  // — appends onto ONE unified in-memory stack. The in-panel Back /
  // Forward buttons walk this stack across all origins. `select` itself
  // truncates any forward branch and appends, dedupes a re-click on the
  // currently-selected def, and `replaceState`s the URL.
  const onIdentifierClick = React.useCallback(
    (target: {
      def_id?: string | null;
      qualified_name: string;
      proposition_id?: string | null;
    }) => {
      if (typeof target.proposition_id === "string") {
        selectProp(target.proposition_id);
        return;
      }
      if (typeof target.def_id !== "string") return;
      selectDef(target.def_id);
    },
    [selectDef, selectProp],
  );

  // ---- Identifier hover popover state -----------------------------------
  // A SINGLE page-level Popover anchored to the hovered/focused span.
  const [popoverTarget, setPopoverTarget] =
    React.useState<PopoverTarget | null>(null);
  // Strip the trigger→popover `aria-describedby` link from whatever span
  // currently carries it (only ever the one anchored span). Centralised so
  // every close path drops the description reference.
  const clearDescribedBy = React.useCallback(() => {
    if (typeof document === "undefined") return;
    document
      .querySelectorAll<HTMLElement>(
        `[aria-describedby="${IDENTIFIER_POPOVER_CONTENT_ID}"]`,
      )
      .forEach((el) => el.removeAttribute("aria-describedby"));
  }, []);
  const clearPopoverTarget = React.useCallback(() => {
    clearDescribedBy();
    setPopoverTarget(null);
  }, [clearDescribedBy]);

  // Close-intent grace delay (WCAG 1.4.13 "Dismissable"/W3C F95). A
  // pointer/blur leaving an identifier does NOT clear the popover
  // immediately — we defer the clear so the pointer has time to travel into
  // the portaled popover content (which is hoverable, see
  // IdentifierPopoverHost's onContentPointerEnter/Leave). Re-entering an
  // identifier or the content cancels the pending clear; leaving the content
  // schedules it again.
  const CLOSE_GRACE_MS = 120;
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const cancelScheduledClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const scheduleClose = React.useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      clearDescribedBy();
      setPopoverTarget(null);
    }, CLOSE_GRACE_MS);
  }, [cancelScheduledClose, clearDescribedBy]);
  // Pointer moved onto the portaled popover content — keep it open.
  const onPopoverContentPointerEnter = React.useCallback(() => {
    cancelScheduledClose();
  }, [cancelScheduledClose]);
  // Pointer left the popover content — schedule the graced close.
  const onPopoverContentPointerLeave = React.useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);
  // Clear any pending timer if the host unmounts.
  React.useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  // ---- Token interaction handlers (read by TokenSpan via context) -------
  //
  // A hover/focus on an identifier cancels any pending graced close, links
  // trigger → popover for screen readers, and sets the popover
  // target (anchored to the rect TokenSpan captured). A leave schedules the
  // graced close. Escape dismisses without moving focus.
  const onIdentifierHover = React.useCallback(
    (target: PopoverTarget) => {
      cancelScheduledClose();
      clearDescribedBy();
      target.element.setAttribute(
        "aria-describedby",
        IDENTIFIER_POPOVER_CONTENT_ID,
      );
      setPopoverTarget(target);
    },
    [cancelScheduledClose, clearDescribedBy],
  );
  const onIdentifierLeave = React.useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);
  const onIdentifierEscape = React.useCallback(() => {
    cancelScheduledClose();
    clearDescribedBy();
    setPopoverTarget(null);
  }, [cancelScheduledClose, clearDescribedBy]);

  // The panel's renderers speak two hover shapes: `ShikiSlice` / render-hast
  // surface a complete `PopoverTarget`, `TokenTreeView` surfaces
  // `{ tag, element }` and needs the rect captured here (while the span is
  // attached). Bundled into the `IdentifierPopoverHandlers` shape the panel
  // takes, so the file page's ONE popover host serves the body AND the panel.
  const onTreeHover = React.useCallback(
    ({ tag, element }: { tag: TokenTag; element: HTMLElement }) => {
      if (!shouldShowPopover(tag)) return;
      const r = element.getBoundingClientRect();
      onIdentifierHover({
        tag,
        element,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      });
    },
    [onIdentifierHover],
  );
  const panelPopover = React.useMemo<IdentifierPopoverHandlers>(
    () => ({
      onTreeHover,
      onSliceHover: onIdentifierHover,
      onIdentifierLeave,
    }),
    [onTreeHover, onIdentifierHover, onIdentifierLeave],
  );

  // Stable provider value — all four handlers are useCallback-backed, so this
  // memo only recomputes if one of them genuinely changes identity (it won't
  // on popover/panel/view state churn). Keeps the memoised tree from rebuilding
  // while letting the handlers read latest state.
  // A `theorem`-kind decl's keyword is stamped server-side by
  // `buildDecorations` (a `data-kind="theorem-keyword"` + `data-theorem-def-id`
  // decoration); render-hast mounts it on the SAME IdentifierSpan path, so it
  // lands in `onIdentifierClick` below with the theorem's def_id and needs no
  // separate affordance threaded through the interaction context.
  const interactionValue = React.useMemo<TokenInteraction>(
    () => ({
      // Body-token clicks extend the unified drill-down stack via the
      // same `select` call every other origin uses.
      onIdentifierClick,
      onIdentifierHover,
      onIdentifierLeave,
      onIdentifierEscape,
    }),
    [
      onIdentifierClick,
      onIdentifierHover,
      onIdentifierLeave,
      onIdentifierEscape,
    ],
  );

  // ---- Render the decorated hast as a real React tree -------------------
  //
  // Memoised on `hast` so unrelated CeFileBody state churn never rebuilds the
  // big source tree (the context value is stable, so the memo holds; the
  // walker reads handlers from context, not closure). `renderHast` turns the
  // `<pre>`/`<code>`/token `<span>`s Shiki emits into normal React elements;
  // identifier `<span>`s become interactive <IdentifierSpan>s.
  const tree = React.useMemo(() => renderHast(hast, "src"), [hast]);

  // ---- Selected-decl highlight + scroll ---------------------------------
  //
  // React now owns the token nodes (no spurious subtree replacement), so we no
  // longer need the MutationObserver re-apply hack. On `?def=` change: clear
  // any previous aria-current / aria-expanded, mark the matching decl header
  // token aria-current="true" (CSS targets
  // [data-decl-wrapper][aria-current="true"]), reflect aria-expanded="true"
  // on every clickable span that opens this def's panel, and scroll the
  // header into view (honouring prefers-reduced-motion) next frame so the
  // panel's slide-in doesn't race the scroll.
  //
  // aria-expanded is the disclosure half page.tsx's buildDecorations
  // intentionally can't stamp server-side (which def is open is client
  // state). We set it here so each identifier button (aria-haspopup="true"
  // + aria-controls) announces whether its panel is currently open. Only the
  // open def's spans get aria-expanded="true"; others have the attribute
  // absent (a button may legitimately omit aria-expanded) rather than a
  // stale "false".
  React.useEffect(() => {
    const body = containerRef.current;
    if (body === null) return;

    body
      .querySelectorAll<HTMLElement>('[data-decl-wrapper][aria-current="true"]')
      .forEach((el) => el.removeAttribute("aria-current"));
    body
      .querySelectorAll<HTMLElement>('[data-def-id][aria-expanded="true"]')
      .forEach((el) => el.removeAttribute("aria-expanded"));
    if (selectedDefId === null) return;

    // Every clickable span pointing at the open def controls the now-open
    // panel, so all of them are "expanded".
    body
      .querySelectorAll<HTMLElement>(
        `[data-def-id="${cssAttrEscape(selectedDefId)}"]`,
      )
      .forEach((el) => el.setAttribute("aria-expanded", "true"));

    const node = body.querySelector<HTMLElement>(
      `[data-decl-wrapper="${cssAttrEscape(selectedDefId)}"]`,
    );
    if (node === null) return;
    node.setAttribute("aria-current", "true");

    const handle = requestAnimationFrame(() => {
      // Skip the scroll when the decl-header is already in the body's
      // scroll viewport — re-centering on every panel pivot is jarring
      // when the visitor can already see the decl. Only the off-screen
      // case triggers movement. The deep-link / "View in file" case
      // (mount with `?def=` set and the decl far from the top of the
      // file) lands here with the header off-screen and gets the centred
      // scroll. The same-decl-re-click case (already centred) skips.
      // Use the body's bounding rect as the viewport reference so a
      // decl that has scrolled out the bottom or the top of the body
      // (whose pane itself may be smaller than the viewport) is treated
      // as off-screen.
      const bodyRect = body.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const isVisible =
        nodeRect.bottom > bodyRect.top && nodeRect.top < bodyRect.bottom;
      if (isVisible) return;
      const prefersReduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollIntoView({
        block: "center",
        behavior: prefersReduced ? "auto" : "smooth",
      });
    });

    return () => {
      cancelAnimationFrame(handle);
    };
  }, [selectedDefId]);

  // ---- Sticky decl header overlay (VS Code 1.70+ "sticky scroll") -------
  //
  // Long decls (e.g. the BFO+Theorems file at 1354 lines) lose the decl's
  // header line off the top of the viewport as the visitor scrolls deep
  // into the body. VS Code 1.70's release added "sticky scroll" — the
  // current scope's header stays pinned at the top of the editor pane.
  // We approximate that with an overlay strip above the file body: it
  // shows the decl whose header has scrolled past the top of the body's
  // viewport AND whose body extent has not yet scrolled away (i.e. the
  // last decl-header that has scrolled past).
  //
  // STRATEGY — scroll-position calculation, NOT IntersectionObserver.
  //
  // The Shiki output is one continuous `<pre>` block; per-decl tokens
  // (`[data-decl-wrapper]`) are nested several layers deep inside that
  // pre. An IntersectionObserver against the scroll container would
  // require us to maintain a Map<def_id, IntersectionEntry> across all
  // headers, reapply the observer when the memoised hast tree commits,
  // and reason about per-entry root-margins. A plain scroll-handler that
  // re-queries `[data-decl-wrapper]` on each scroll tick is simpler and
  // works against the existing DOM contract directly. The body's number
  // of decls is bounded (file pages) and we throttle via rAF, so per-tick
  // cost is O(#decls) reads of `getBoundingClientRect` — well below the
  // 16ms frame budget for any realistic file size.
  //
  // The lookup runs the SAME contract the selected-decl effect already
  // uses (`querySelectorAll('[data-decl-wrapper]')`) so the overlay
  // tracks exactly the spans page.tsx's `buildDecorations` stamps.
  const [topmostDeclDefId, setTopmostDeclDefId] = React.useState<string | null>(
    null,
  );

  // Stable lookup from def_id → display labels for the overlay's click +
  // text. Built once per `decls` prop change; the overlay reads via this
  // map at click time, never per scroll tick.
  const declLabelByDefId = React.useMemo(() => {
    const m = new Map<string, { local_name: string; qualified_name: string }>();
    for (const decl of decls) {
      m.set(decl.def_id, {
        local_name: decl.local_name,
        qualified_name: decl.qualified_name,
      });
    }
    return m;
  }, [decls]);

  React.useEffect(() => {
    const body = containerRef.current;
    if (body === null) return;

    let rafHandle: number | null = null;
    let lastDefId: string | null = topmostDeclDefId;

    const compute = () => {
      rafHandle = null;
      // The body's viewport top is the reference: a decl-header that has
      // scrolled past the top of the body has `rect.top <= bodyTop`. Pick
      // the one with the LARGEST `rect.top` that is still ≤ bodyTop — the
      // most-recent header to scroll past — which is the decl whose body
      // contents currently surround the visitor's viewport. (The
      // selection effect's `aria-current` decl is irrelevant here; the
      // overlay reflects scroll position, not the open panel.)
      const bodyTop = body.getBoundingClientRect().top;
      const headers = body.querySelectorAll<HTMLElement>("[data-decl-wrapper]");
      let bestDefId: string | null = null;
      let bestTop = Number.NEGATIVE_INFINITY;
      for (const el of headers) {
        const top = el.getBoundingClientRect().top;
        // ≤ bodyTop = the header is at or above the body's top edge,
        // i.e. scrolled past. Allow a 1px tolerance because subpixel
        // layout can leave a header's top at e.g. 0.5px after a scroll.
        if (top <= bodyTop + 1 && top > bestTop) {
          bestTop = top;
          bestDefId = el.getAttribute("data-decl-wrapper");
        }
      }
      // The overlay HIDES when nothing has scrolled past (file's
      // import/open header or pre-first-decl whitespace). Hiding =
      // setTopmostDeclDefId(null) — distinct from "showing nothing".
      if (bestDefId !== lastDefId) {
        lastDefId = bestDefId;
        setTopmostDeclDefId(bestDefId);
      }
    };

    const onScroll = () => {
      // Throttle to one compute per animation frame. Many scroll events
      // can fire per frame on a fast wheel; rAF coalesces them so we run
      // the rect queries once per paint, not once per event.
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(compute);
    };

    // Seed: the overlay is correct on first paint (e.g. deep-link mount
    // where the page has been scrolled to a decl in the middle).
    compute();
    body.addEventListener("scroll", onScroll, { passive: true });
    // Resize can also change which decl is topmost (the body's viewport
    // top moves when the workbench column resizes).
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      body.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // `hast` in deps: the memoised tree commits new DOM when the source
    // changes, so the cached `[data-decl-wrapper]` elements may be stale
    // — re-seed by re-attaching with the new DOM. (In practice `hast` is
    // server-rendered and immutable per page load; this is defensive.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hast]);

  const stickyDeclLabel =
    topmostDeclDefId !== null
      ? (declLabelByDefId.get(topmostDeclDefId) ?? null)
      : null;

  // ---- Keyboard shortcuts + command palette -----------------------------
  //
  // `/`  — open the "Jump to declaration" palette (preventDefault so the
  //        browser's quick-find doesn't fire).
  // `j` / `k` — walk forward / backward through `decls` (file source
  //        order), scroll the matching DOM element into view, and open the
  //        side panel anchored to it.
  // `Esc` — close the side panel if one is open. The hook below is gated
  //        on `selectedDefId !== null`, so when no panel is open this
  //        binding does NOT consume the event and the browser's default
  //        Esc behaviour rides through.
  // `?` — open the keyboard-shortcuts help dialog.
  // `f` — toggle focus mode (see `use-focus-mode.ts`): hide the global
  //        nav + marketing footer, let the workbench expand to fill the
  //        tab. Hotkey-only — there's no visible affordance for it.
  //
  // react-hotkeys-hook v5's `enableOnFormTags` default is `false` — the hook
  // already ignores events that originate from inputs / textareas / selects /
  // contenteditable elements (its `tagFilter` checks the active element's
  // `tagName` + `isContentEditable`). So `j`/`k`/`/` won't fire when the
  // visitor is typing into the palette's search field or any other input on
  // the page. (Verified against the hook's source — no explicit scope or
  // `enableOnContentEditable: false` override is needed.)

  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Scroll the decl-header span for `def_id` into view (centered) and open
  // the side panel anchored to it. Used by both the palette's onSelect and
  // by the j/k walker.
  const jumpToDecl = React.useCallback(
    (def_id: string) => {
      const body = containerRef.current;
      if (body !== null) {
        const node = body.querySelector<HTMLElement>(
          `[data-decl-wrapper="${cssAttrEscape(def_id)}"]`,
        );
        if (node !== null) {
          node.scrollIntoView({ block: "center" });
        }
      }
      selectDef(def_id);
    },
    [selectDef],
  );

  // j/k indices into `decls`. Picks the next/previous index of the
  // currently-selected decl; if no decl is selected, j picks the first and
  // k picks the last so the visitor always lands somewhere on first press.
  const stepDecl = React.useCallback(
    (delta: 1 | -1) => {
      if (decls.length === 0) return;
      const currentIndex = decls.findIndex((d) => d.def_id === selectedDefId);
      let nextIndex: number;
      if (currentIndex === -1) {
        nextIndex = delta === 1 ? 0 : decls.length - 1;
      } else {
        nextIndex = (currentIndex + delta + decls.length) % decls.length;
      }
      jumpToDecl(decls[nextIndex].def_id);
    },
    [decls, jumpToDecl, selectedDefId],
  );

  // `preventDefault: true` MUST be set as an OPTION (not via
  // `e.preventDefault()` in the handler) — react-hotkeys-hook gates
  // the browser default on its own preventDefault path. In Firefox
  // especially, calling preventDefault on the event after the fact is
  // too late: the quick-find UI claims `/` before our handler runs.
  // `useKey: true` listens to the produced character (so `?` reliably
  // matches the `?` keypress on US layouts without a `shift+/` combo).
  useHotkeys(
    "/",
    () => {
      setPaletteOpen(true);
    },
    {
      enabled: !paletteOpen && !helpOpen,
      preventDefault: true,
      useKey: true,
    },
  );
  // Mobile path — `PaletteButton` in the status bar dispatches the
  // `ce-open-palette` window event because the button is a sibling of
  // CeFileBody in the route tree (no parent component owns both). Listen
  // here and flip the palette open. The event has no payload — open is
  // the only signal. See `palette-button.tsx` for the rationale.
  React.useEffect(() => {
    function onOpen() {
      setPaletteOpen(true);
    }
    window.addEventListener("ce-open-palette", onOpen);
    return () => window.removeEventListener("ce-open-palette", onOpen);
  }, []);
  useHotkeys(
    "?",
    () => {
      setHelpOpen(true);
    },
    {
      enabled: !paletteOpen && !helpOpen,
      preventDefault: true,
      useKey: true,
    },
  );
  useHotkeys("j", () => stepDecl(1), {
    enabled: !paletteOpen && !helpOpen,
    useKey: true,
  });
  useHotkeys("k", () => stepDecl(-1), {
    enabled: !paletteOpen && !helpOpen,
    useKey: true,
  });
  // `f` toggles focus mode via `useFocusMode`. The status bars'
  // `FocusModeButton` is the visible counterpart (and announces the
  // toggle to screen readers — including toggles from this hotkey, via
  // the store's announcement channel). Gated like the other hotkeys so
  // it doesn't fire while the palette / help dialog is capturing keys.
  const { toggleFocusMode } = useFocusMode();
  useHotkeys("f", () => toggleFocusMode(), {
    enabled: !paletteOpen && !helpOpen,
    useKey: true,
  });
  // Esc — only consume when a panel is actually open; otherwise let the
  // browser default through (so Esc in the page chrome stays generic).
  useHotkeys(
    "esc",
    () => {
      close();
    },
    {
      enabled:
        (selectedDefId !== null || selectedPropId !== null) &&
        !paletteOpen &&
        !helpOpen,
    },
  );

  const onPaletteSelect = React.useCallback(
    (def_id: string) => {
      setPaletteOpen(false);
      jumpToDecl(def_id);
    },
    [jumpToDecl],
  );

  // ---- Click-to-jump on the line number area ----------------------------
  //
  // Clicking inside the line-number gutter scrolls that line into view
  // (no URL change — line numbers are not a permalink surface) and
  // flashes the line briefly so the visitor sees what they hit. Useful
  // for stack-trace-style "jump to line N" workflows when reading
  // source.
  //
  // HEURISTIC — `event.offsetX <= 3.5rem from the `.line`'s content box.
  //
  // The line-number gutter occupies the leftmost `padding-left: 1rem +
  // width: 2.5rem` = 3.5rem of every `.line` (rendered via a CSS counter on
  // a `::before` pseudo-element; see ce-file-body.module.css). CSS counters
  // are not click-targets themselves, but the `.line` element wraps them,
  // and `offsetX` against the `.line`'s box reliably places the click
  // inside or outside the gutter:
  //
  //   - Click on the counter / its padding → offsetX < 3.5rem.
  //   - Click on a `.ce-identifier` span (or any non-counter text) →
  //     bubbles up to `.line` with offsetX > 3.5rem because the identifier
  //     spans sit after the gutter in the line's layout.
  //
  // We belt-and-brace by ALSO checking that the click target is not an
  // identifier / file-ref (those have their own onClicks; we must not
  // steal them). If a user happens to click on a leading-whitespace token
  // that lives within 3.5rem of the line's left edge, the heuristic
  // treats it as a gutter click — acceptable, since the action is just
  // "scroll the line you're already on into center view," which is a
  // no-op-shaped gesture rather than a destructive one.
  const onBodyClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target === null) return;
      // Don't steal clicks from identifier / file-ref children — they own
      // their own onClicks; this delegated handler is the gutter-only
      // safety net.
      if (target.closest(".ce-identifier") !== null) return;
      if (target.closest(".ce-file-ref") !== null) return;
      const line = target.closest(".line");
      if (!(line instanceof HTMLElement)) return;

      // `offsetX` is relative to the click target's box, not the `.line`'s
      // box. Re-project onto the line by adding the target's left offset
      // inside the line; equivalent to clientX-minus-line-rect-left, which
      // is the most reliable cross-target measurement.
      const lineRect = line.getBoundingClientRect();
      const xInLine = e.clientX - lineRect.left;
      // `LINE_NUMBER_GUTTER_REM` in pixels — read the document's font size
      // to support the mobile `.body { font-size: 1rem }` override which
      // changes rem-to-px on this surface. Falls back to 16 in jsdom.
      const remPx =
        typeof window !== "undefined"
          ? parseFloat(
              window.getComputedStyle(document.documentElement).fontSize,
            ) || 16
          : 16;
      if (xInLine > LINE_NUMBER_GUTTER_REM * remPx) return;

      // The click landed in the gutter — scroll the line into center view
      // and flash it. `behavior: "auto"` honours reduced-motion.
      const prefersReduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      line.scrollIntoView({
        block: "center",
        behavior: prefersReduced ? "auto" : "smooth",
      });

      // Stamp `data-line-flash="true"` to trigger the CSS keyframe; clear
      // it on animationend so a subsequent click re-triggers (re-applying
      // the same value would not restart the animation). The listener is
      // `{ once: true }` to auto-remove itself.
      line.setAttribute("data-line-flash", "true");
      const onAnimationEnd = () => {
        line.removeAttribute("data-line-flash");
      };
      line.addEventListener("animationend", onAnimationEnd, { once: true });
    },
    [],
  );

  // ---- Cross-file "View in file" navigation -----------------------------
  // The panel's "View in file" jumps to the def's home file with `?def=` as
  // a client-side route push (different pathname, so the hook's same-path
  // dedupe doesn't apply — we push the router directly).
  const navigateToFile = React.useCallback(
    (def_id: string, target_file_id: string) => {
      router.push(
        `/f/${encodeURIComponent(target_file_id)}?def=${encodeURIComponent(def_id)}`,
      );
    },
    [router],
  );

  // ---- Render -----------------------------------------------------------
  //
  // Layout uses the host-page-agnostic `LeanUIShell` (see lean-ui-shell.tsx
  // and design § "Side panel as a docked IDE-style pane"): the file body
  // sits in the main column, the SidePanel sits in the docked side column,
  // and the shell handles the resizable / mobile-sheet split. The previous
  // file-page-only body-dataset shim that padded `<main>` is
  // gone — the shell's `ResizablePanel` pushes the main column for us. We
  // share the panel-width persistence id with the profile page so the
  // visitor's preferred width carries across surfaces.
  const isMobile = useIsMobile();
  const canViewInFile = defData !== null && defData.decl.file_id !== fileId;

  const panel =
    selectedDefId !== null ? (
      <SidePanel
        def_id={selectedDefId}
        def_data={defData}
        view={panelView}
        state={panelState}
        errorStatus={errorStatus}
        canViewInFile={canViewInFile}
        history={{ can_back: canBack, can_forward: canForward }}
        onBack={back}
        onForward={forward}
        onClose={close}
        onRetry={retryFetch}
        // Identifier clicks inside the panel funnel through the SAME
        // `select` call body-token clicks use — every panel-changing
        // selection extends the one unified drill-down stack.
        onIdentifierClick={onIdentifierClick}
        // Same page-level popover host the body drives, so an identifier in the
        // panel's Conclusion / Premises / Signature / Value shows the metadata
        // popover it shows in the source below.
        popover={panelPopover}
        onViewChange={setPanelView}
        onViewInFile={navigateToFile}
        onSelectProp={selectProp}
        onHoldersDrillIn={onHoldersDrillIn}
        // "In this file" outline — wired ONLY on the file page (the only
        // surface where the panel is anchored to a file). Outline selects
        // jump to the picked decl just like the command palette: scroll
        // its DOM into view AND rebase the panel on it.
        fileOutline={decls}
        onOutlineSelect={jumpToDecl}
      />
    ) : selectedPropId !== null ? (
      <PropositionPanel
        prop_id={selectedPropId}
        prop_data={propData}
        view={panelView}
        state={propPanelState}
        errorStatus={propErrorStatus}
        history={{ can_back: canBack, can_forward: canForward }}
        onBack={back}
        onForward={forward}
        onClose={close}
        onRetry={retryPropFetch}
        onViewChange={setPanelView}
        onSelectDef={onIdentifierClick}
        onSelectProp={selectProp}
        onHoldersDrillIn={onHoldersDrillIn}
      />
    ) : null;

  return (
    <>
      {/* `.shellWrapper` flex-grows inside the file route's workbench column
       * so the page's sibling status bar (rendered by page.tsx below
       * CeFileBody) sits naturally at the bottom edge while the shell + its
       * resizable panes fill the remaining vertical space. The workbench
       * route-segment layout (see f/[file_id]/layout.tsx) applies on every
       * viewport — the file body scrolls inside its own pane and the status
       * bar pins at the bottom edge on mobile too (matching VS Code Web /
       * github.dev / Codespaces mobile). */}
      <div className={styles.shellWrapper}>
        <LeanUIShell
          panel={panel}
          isMobile={isMobile}
          id="lean-ui-side-panel-width"
        >
          {/* Page-level reading column. The shell is mounted page-wide (so
           * the side panel can extend toward the viewport edge); this inner
           * div re-applies the 920px max-width that constrains the
           * file-header chrome + the source body to a comfortable reading
           * width. See ce-file-body.module.css `.mainColumn`. */}
          <div className={styles.mainColumn}>
            {header}
            {/* The decorated source, rendered as a real React tree. The
             * container owns the scroll-into-view querySelector scope and the
             * horizontal-scroll a11y affordance (tabIndex={0}, WCAG 2.1.1).
             * The interaction callbacks reach the token spans via context so
             * the memoised tree stays pinned across CeFileBody state churn. */}
            <TokenInteractionContext.Provider value={interactionValue}>
              <div
                ref={containerRef}
                // `id="file-body"` is the target of the route layout's
                // `<SkipToContent>` link (a11y: WCAG 2.4.1 "Bypass Blocks"),
                // so keyboard / SR users tabbing from the URL bar can jump
                // directly into the source body past the global nav. The
                // scrollable region is the right landing — focus arrives at
                // a `tabIndex={0}` element that scrolls.
                id="file-body"
                className={styles.body}
                role="region"
                aria-label="Lean source"
                tabIndex={0}
                // Delegated click handler — detects clicks on the line-number
                // gutter (the leftmost 3.5rem of any `.line`, occupied by
                // the CSS counter) and scrolls/flashes that line. See
                // `onBodyClick`'s comment for the heuristic rationale.
                // Identifier / file-ref onClicks run BEFORE this (React
                // delegates from the target up), and `onBodyClick` no-ops
                // when the click landed on one of those, so the handler
                // never steals an interaction.
                onClick={onBodyClick}
              >
                {/* Sticky decl-header overlay — VS Code 1.70's "sticky
                 * scroll" pattern. Pinned to the top of the body's
                 * scroll container via `position: sticky`; the
                 * overlay's text + click target reflect the decl whose
                 * body currently surrounds the visitor's viewport
                 * (tracked by the body's onScroll handler above). When
                 * no decl has scrolled past (visitor is in the file's
                 * import/open header) the overlay HIDES entirely
                 * (`stickyDeclLabel === null`) — rendering nothing
                 * keeps the source body's first line fully visible and
                 * avoids a covering bar over the imports. */}
                {stickyDeclLabel !== null && topmostDeclDefId !== null ? (
                  <div className={styles.stickyDeclHeader} aria-hidden="true">
                    <span className={styles.stickyDeclHeaderLabel}>
                      <span className={styles.stickyDeclName}>
                        {stickyDeclLabel.local_name}
                      </span>
                      {/* Qualified name as a quieter prefix so the leaf
                       * name reads first. Trimmed to display only the
                       * namespace portion (without the trailing
                       * `.local_name`) when present, to avoid
                       * duplicating the leaf — VS Code's sticky-scroll
                       * shows "ClassName ▸ methodName" rather than
                       * just the leaf, for context. */}
                      {stickyDeclLabel.qualified_name !==
                      stickyDeclLabel.local_name ? (
                        <span className={styles.stickyDeclQualifier}>
                          {stickyDeclLabel.qualified_name}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ) : null}
                {tree}
              </div>
            </TokenInteractionContext.Provider>
          </div>
        </LeanUIShell>
      </div>

      {/* One page-level identifier popover for the whole body, anchored over
       * the currently hovered/focused span via a rect captured at hover time.
       * The content is itself hoverable (pointer-enter cancels the graced
       * close, pointer-leave reschedules it) so the user can travel into it to
       * read/copy a long type summary (WCAG 1.4.13 "Hoverable"). Lives
       * OUTSIDE the shell so its portaled content is not constrained by the
       * shell's resizable column boundary. */}
      <IdentifierPopoverHost
        target={popoverTarget}
        onClose={clearPopoverTarget}
        onContentPointerEnter={onPopoverContentPointerEnter}
        onContentPointerLeave={onPopoverContentPointerLeave}
      />

      {/* "Jump to declaration" command palette — opened on `/` from the body
       * (the global hotkey above), filtered against the file's `decls` via
       * fuse.js. Closed on Esc / outside-click by Radix Dialog's defaults. */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        decls={decls}
        onSelect={onPaletteSelect}
      />

      {/* Keyboard-shortcuts help — opened on `?` (Shift+/). */}
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <HoldersModal request={drillIn} onClose={closeDrillIn} />
      {urlReader}
    </>
  );
}
