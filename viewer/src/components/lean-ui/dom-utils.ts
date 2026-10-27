// Shared DOM utilities for the Lean UI components. Kept narrow — these are
// the helpers that two-or-more sibling components in this folder need.

/**
 * `CSS.escape` with a no-op fallback for environments that lack it
 * (jsdom is the relevant gap). The Lean UI's `def_id` values are
 * UUID-shaped (alphanumeric + hyphens) so the escape is effectively a
 * pass-through against real selectors; the wrapper exists so the fallback
 * path also stays consistent across the body and the side panel.
 *
 * Used by every site that builds an attribute selector against a
 * `def_id` — `[data-def-id="..."]`, `[data-decl-wrapper="..."]`,
 * `[data-row-def-id="..."]`.
 */
export function cssAttrEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value;
}
