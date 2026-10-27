// Pure state transitions for the inspection panel's in-memory drill-down
// stack.
//
// Extracted from `use-selection.ts` so the stack semantics — dedupe,
// forward-branch truncation, and FIFO eviction at the cap — are unit-
// testable without React or Next (see test/unit/def-selection-stack.spec.ts,
// mirroring the ce-file-decorations.ts precedent). The hook owns the URL
// (`?def=` / `?prop=` via replaceState) and React state; this module owns
// nothing but the stack arithmetic. Each transition returns the NEXT state,
// or `null` when the call is a no-op (so the hook can skip both the History
// API call and the re-render).
//
// DISCRIMINATED STACK. The refresh adds a second selection axis — `?prop=`
// opening the proposition panel — alongside the established `?def=` axis,
// and the two are MUTUALLY EXCLUSIVE (one URL param at a time). The stack
// entry is therefore a discriminated `def | prop` union rather than a bare
// string, and the dedupe comparison keys off BOTH `kind` and `id`:
// re-clicking the def already at the cursor is a no-op, but selecting the
// prop panel for a coincidentally-equal id is a real pivot (a different
// panel). `applyBack` / `applyForward` are pure cursor moves and stay
// kind-agnostic.
//
// See the hook's header comment for the full history model (unified stack,
// all-replaceState, browser history is page-level only).

/**
 * One entry on the drill-down stack — the unit the in-panel Back / Forward
 * buttons walk. A `def` entry maps to `?def=<id>` (the SidePanel); a `prop`
 * entry maps to `?prop=<id>` (the PropositionPanel). The two are mutually
 * exclusive on the URL.
 */
export type Selection =
  | { kind: "def"; id: string } // ?def=<id>  → SidePanel
  | { kind: "prop"; id: string }; // ?prop=<id> → PropositionPanel

export interface StackState {
  stack: Selection[];
  cursor: number; // -1 when stack is empty
}

export const EMPTY_STACK: StackState = { stack: [], cursor: -1 };

// Bound on the in-memory drill-down stack. Matches VS Code's editor
// navigation-history cap (`HistoryService.MAX_STACK_ITEMS`, 50): an
// in-memory navigation stack visited only by the panel's Back /
// Forward buttons doesn't need to retain every selection a long
// session has accumulated, and an unbounded stack leaks memory across
// extended sessions. When `applySelect` would push past this cap we drop
// the OLDEST entry (FIFO eviction at the front of the stack, NOT LIFO
// at the cursor) so the most-recent drill-down history survives. The
// cursor is decremented in lockstep so it continues to point at the
// same logical entry after the shift.
export const MAX_STACK_SIZE = 50;

/** Two selections are equal iff both their `kind` AND `id` match. */
function selectionEquals(a: Selection, b: Selection): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * Select an entry. Truncates the forward branch (everything after
 * `cursor`), appends `sel`, advances the cursor; evicts the oldest
 * entry when past `MAX_STACK_SIZE`. Returns `null` when `sel` is
 * already at the cursor (dedupe — a re-click on the same identifier
 * shouldn't truncate the stack or burn a History API call).
 *
 * Dedupe compares BOTH `kind` and `id`: re-clicking the def already at
 * the cursor is a no-op, but selecting `{kind:"prop", id:X}` while
 * `{kind:"def", id:X}` is at the cursor is a real pivot (a different
 * panel for a coincidentally-equal id).
 */
export function applySelect(
  prev: StackState,
  sel: Selection,
): StackState | null {
  if (prev.cursor >= 0 && selectionEquals(prev.stack[prev.cursor], sel)) {
    return null;
  }
  // Unified-stack semantics: every selection truncates the forward
  // branch and appends. Standard browser-style drill-down — a
  // pivot after Back drops the redo branch.
  const truncated = prev.stack.slice(0, prev.cursor + 1);
  truncated.push(sel);
  let nextStack = truncated;
  let nextCursor = truncated.length - 1;
  if (nextStack.length > MAX_STACK_SIZE) {
    nextStack = nextStack.slice(nextStack.length - MAX_STACK_SIZE);
    nextCursor = nextStack.length - 1;
  }
  return { stack: nextStack, cursor: nextCursor };
}

/**
 * Replace the entry at the current cursor without truncating, appending, or
 * changing Back / Forward position. Used when the server canonicalizes a
 * selected internal declaration id to the authored declaration that should own
 * the visible panel.
 */
export function applyReplaceCurrent(
  prev: StackState,
  sel: Selection,
): StackState | null {
  if (prev.cursor < 0) {
    return { stack: [sel], cursor: 0 };
  }
  if (selectionEquals(prev.stack[prev.cursor], sel)) {
    return null;
  }
  const nextStack = prev.stack.slice();
  nextStack[prev.cursor] = sel;
  return { stack: nextStack, cursor: prev.cursor };
}

/**
 * Walk the stack back one step. Returns `null` at the bottom (no prior
 * entry to navigate to). Kind-agnostic — a pure cursor move.
 */
export function applyBack(prev: StackState): StackState | null {
  if (prev.cursor <= 0) return null;
  return { stack: prev.stack, cursor: prev.cursor - 1 };
}

/**
 * Walk the stack forward one step. Returns `null` at the top (no redo
 * branch to navigate to). Kind-agnostic — a pure cursor move.
 */
export function applyForward(prev: StackState): StackState | null {
  if (prev.cursor >= prev.stack.length - 1) return null;
  return { stack: prev.stack, cursor: prev.cursor + 1 };
}
