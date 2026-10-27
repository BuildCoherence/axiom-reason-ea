"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { canonicalizeId } from "@/lib/id-codec";
import {
  EMPTY_STACK,
  applyBack,
  applyForward,
  applyReplaceCurrent,
  applySelect,
  type Selection,
  type StackState,
} from "./selection-stack";

// Unified `?def=` + `?prop=` URL-state hook for the inspection panels, plus
// a UNIFIED in-memory drill-down stack the in-panel Back / Forward buttons
// walk. The single owner of two things:
//
//  1. The URL's `?def=` / `?prop=` value (read by the `SelectionUrlReader`
//     leaf via `useSearchParams`, written via the native History API — see "Why native History API"
//     below). The two params are MUTUALLY EXCLUSIVE: writing one always
//     clears the other in the same `replaceState`.
//  2. An IN-MEMORY drill-down stack + cursor that the panel's Back /
//     Forward affordances walk. The stack lives only as long as the host
//     page is mounted. Its entries are a discriminated `def | prop` union
//     (`Selection`), so the two selection axes share ONE history walked by
//     a single Back / Forward gesture.
//
// MUTUAL EXCLUSION. `?def=` and `?prop=` never coexist. On WRITE,
// `buildSelectionUrl` deletes both params and sets exactly the one for the
// target selection (or neither, on close). On READ, a hand-edited / stale
// URL carrying both is resolved with `?def=` winning (the established
// surface) — `?prop=` is ignored that render.
//
// HISTORY MODEL — UNIFIED stack; ALL replaceState; browser history is
// page-level only.
//
// Every panel-changing selection — whether a def or a prop, and whatever
// surface it originated from (source body, inside a panel, the lists pane,
// the graph, the keyboard / command palette) — appends onto a SINGLE
// in-memory stack. The panel's Back / Forward buttons walk that one stack
// across both kinds and all origins. There is no "reset vs push"
// distinction: a new selection always extends the stack (truncating any
// forward branch first, standard browser-style semantics), so the
// visitor's path through the panels is recorded in the order they took it.
//
// EVERY panel state change updates the URL via `window.history.replaceState`:
// any-origin selections, the in-panel Back / Forward affordances, and
// close. Browser back / forward therefore NEVER walk the panel's selection
// state — they navigate to the previous / next page. The visitor's in-panel
// drill-down history lives entirely in the in-memory stack and is walked
// only by the panel's own Back / Forward buttons.
//
// DEEP LINK behaviour. When the visitor navigates directly to a URL with
// `?def=X` or `?prop=Y` (e.g. by clicking a share link), the hook reads the
// initial URL on mount; nothing is written to history. Browser-back from a
// deep-linked open panel goes to the PREVIOUS PAGE — the correct behaviour
// (there is no "panel closed" state for this URL).
//
// WHY NATIVE HISTORY API (not `router.push`/`router.replace`).
// ----------------------------------------------------------------------------
// Selecting a declaration / proposition is a pure client-side UI concern. A
// `router.push`/`router.replace` to a query param forces an RSC payload
// round-trip before `useSearchParams()` even reports the new value.
//
// Next.js integrates `window.history.replaceState` with its router (since
// 14.1, unchanged in 15): these updates make `useSearchParams()` /
// `usePathname()` report the new value reactively WITHOUT re-running the
// server component. So we get the same deep-link + URL-share semantics with
// no server re-render. See Next's "Using the native History API" docs and
// vercel/next.js#49540. (Pass `null` as the state arg — Next merges its own
// routing metadata in.)
//
// Native replaceState does not scroll the page (unlike `router.replace`,
// which scrolls to top); the selected-decl scroll is still handled
// separately (scrollIntoView on the decl-header span).
//
// WHY ALL-REPLACESTATE (no pushState).
// ----------------------------------------------------------------------------
// Browser back / forward stay reserved for page-level navigation. Panel
// selection / drill-down state never appears in the browser's history
// stack: visitors who press browser-back from an open panel leave the page
// entirely, and the in-panel Back / Forward buttons are the only affordance
// that walks the in-memory drill-down stack. This keeps one mental model
// per gesture — "browser back = previous page" and "in-panel back =
// previous thing I drilled into".
//
// Other query params are preserved (defensive against future state and any
// tracking/share params already on the URL).
//
// PRERENDER. `useSearchParams()` bails the nearest <Suspense> boundary out of
// static prerendering. Only the `SelectionUrlReader` leaf calls it, under its
// own boundary (`urlReader`, which each host renders once), so the host body's
// full content stays in the exported HTML; the selection starts empty and the
// leaf reports the URL's selection after hydration.

export interface UnifiedSelection {
  /** Current selection from the URL, or null when neither ?def= nor ?prop= is set. */
  selected: Selection | null;
  /** Back-compat: the ?def= id when the current selection is a def, else null. */
  selectedDefId: string | null;
  /** Back-compat: the ?prop= id when the current selection is a prop, else null. */
  selectedPropId: string | null;
  /**
   * Select a def (opens the SidePanel). Clears ?prop=. Truncates the
   * forward branch (everything after `cursor`), appends the def entry,
   * advances the cursor. Re-selecting the def already at the cursor is a
   * no-op (deduped). Writes the URL via `replaceState`.
   */
  selectDef: (def_id: string) => void;
  /** Replace the current def selection without adding a drill-down history entry. */
  replaceDef: (def_id: string) => void;
  /**
   * Select a proposition (opens the PropositionPanel). Clears ?def=. Same
   * drill-stack semantics as `selectDef`; selecting a prop while a def with
   * a coincidentally-equal id is at the cursor is a real pivot (a different
   * panel).
   */
  selectProp: (proposition_id: string) => void;
  /** Walk the drill-down stack back one step. No-op when `!canBack`. */
  back: () => void;
  /** Walk the drill-down stack forward one step. No-op when `!canForward`. */
  forward: () => void;
  /** Drop both `?def=` and `?prop=` from the URL and clear the stack. */
  close: () => void;
  /** True when the stack has a prior entry the visitor can navigate to. */
  canBack: boolean;
  /** True when the visitor has used Back and has not yet pivoted forward. */
  canForward: boolean;
  /** The URL-reading leaf under its own Suspense boundary; render it once. */
  urlReader: React.ReactNode;
}

// Build the URL for a selection write from the live location. ALWAYS deletes
// both `def` and `prop` first — this is what enforces mutual exclusion on
// every write — then sets exactly the one param for `sel` (or neither when
// `sel === null`), preserving all other query params and emitting the
// selection param first for deep-link readability.
function buildSelectionUrl(sel: Selection | null): string {
  const pathname = window.location.pathname;
  const rest = new URLSearchParams(window.location.search);
  rest.delete("def");
  rest.delete("prop");

  if (sel === null) {
    const qs = rest.toString();
    return qs.length > 0 ? `${pathname}?${qs}` : pathname;
  }

  const param = sel.kind === "def" ? "def" : "prop";
  const merged = new URLSearchParams();
  merged.set(param, sel.id);
  for (const [k, v] of rest) {
    merged.append(k, v);
  }
  const qs = merged.toString();
  return qs.length > 0 ? `${pathname}?${qs}` : pathname;
}

// Canonicalise a raw URL param: fold the value (mirror Go idcodec) with NO
// redirect, treating a malformed value as no selection (null) so the panel
// renders nothing rather than firing a doomed lookup.
function canonicalizeParam(raw: string | null): string | null {
  if (raw === null) return null;
  const result = canonicalizeId(raw);
  return result.ok ? result.canonical : null;
}

// MUTUAL-EXCLUSION READ RULE: if both params are present on a hand-edited /
// stale URL, `?def=` wins (the established surface).
function selectionFromParams(params: URLSearchParams): Selection | null {
  const defId = canonicalizeParam(params.get("def"));
  if (defId !== null) return { kind: "def", id: defId };
  const propId = canonicalizeParam(params.get("prop"));
  return propId !== null ? { kind: "prop", id: propId } : null;
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

function SelectionUrlReader({
  onSelection,
}: {
  onSelection: (sel: Selection | null) => void;
}) {
  const sel = selectionFromParams(useSearchParams());
  const kind = sel?.kind ?? null;
  const id = sel?.id ?? null;
  React.useEffect(() => {
    onSelection(kind !== null && id !== null ? { kind, id } : null);
  }, [onSelection, kind, id]);
  return null;
}

// The in-memory drill-down state and its pure transitions (dedupe,
// forward-branch truncation, FIFO eviction at MAX_STACK_SIZE) live in
// `selection-stack.ts` so they are unit-testable without React or Next.

export function useSelection(): UnifiedSelection {
  // The URL is the SOURCE OF TRUTH for the current selection; `selected`
  // mirrors it (from the leaf's reports and this hook's own writes).
  const [selected, setSelected] = React.useState<Selection | null>(null);
  const [state, setState] = React.useState<StackState>(EMPTY_STACK);
  const seededRef = React.useRef(false);

  // The callbacks below compute next-state synchronously from this ref and
  // run the `replaceState` side effect at event-handler time, never inside a
  // setState updater (React may re-run updaters during render, and a
  // replaceState there updates Next's Router while rendering another
  // component).
  const stateRef = React.useRef<StackState>(state);
  stateRef.current = state;

  // The first URL report seeds the stack: a deep link with a selection starts
  // the visitor at `[sel]` with cursor 0 (so `canBack === false`, and
  // browser-Back leaves the page). Later reports reflect this hook's own
  // writes and do not re-seed.
  const onUrlSelection = React.useCallback((sel: Selection | null) => {
    setSelected((prev) => (sameSelection(prev, sel) ? prev : sel));
    if (seededRef.current) return;
    seededRef.current = true;
    if (sel !== null) {
      const seeded: StackState = { stack: [sel], cursor: 0 };
      stateRef.current = seeded;
      setState(seeded);
    }
  }, []);

  const urlReader = React.useMemo(
    () => (
      <React.Suspense fallback={null}>
        <SelectionUrlReader onSelection={onUrlSelection} />
      </React.Suspense>
    ),
    [onUrlSelection],
  );

  const commit = React.useCallback(
    (sel: Selection | null, next: StackState) => {
      window.history.replaceState(null, "", buildSelectionUrl(sel));
      stateRef.current = next;
      setState(next);
      setSelected(sel);
    },
    [],
  );

  const applyAndWrite = React.useCallback(
    (sel: Selection) => {
      const next = applySelect(stateRef.current, sel);
      if (next === null) return;
      commit(sel, next);
    },
    [commit],
  );

  const selectDef = React.useCallback(
    (def_id: string) => applyAndWrite({ kind: "def", id: def_id }),
    [applyAndWrite],
  );

  const replaceDef = React.useCallback(
    (def_id: string) => {
      const sel: Selection = { kind: "def", id: def_id };
      const next = applyReplaceCurrent(stateRef.current, sel);
      if (next === null) return;
      commit(sel, next);
    },
    [commit],
  );

  const selectProp = React.useCallback(
    (proposition_id: string) =>
      applyAndWrite({ kind: "prop", id: proposition_id }),
    [applyAndWrite],
  );

  const back = React.useCallback(() => {
    const next = applyBack(stateRef.current);
    if (next === null) return;
    commit(next.stack[next.cursor], next);
  }, [commit]);

  const forward = React.useCallback(() => {
    const next = applyForward(stateRef.current);
    if (next === null) return;
    commit(next.stack[next.cursor], next);
  }, [commit]);

  const close = React.useCallback(() => {
    commit(null, EMPTY_STACK);
  }, [commit]);

  return {
    selected,
    selectedDefId: selected?.kind === "def" ? selected.id : null,
    selectedPropId: selected?.kind === "prop" ? selected.id : null,
    selectDef,
    replaceDef,
    selectProp,
    back,
    forward,
    close,
    canBack: state.cursor > 0,
    canForward: state.cursor < state.stack.length - 1,
    urlReader,
  };
}
