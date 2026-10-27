// Notation-head derivation for the structured-token-tree renderer.
//
// Factored out of `token-tree.tsx` (which pulls the CSS-Module import chain) so
// the unit suite can verify the derivation without standing up CSS-Module
// resolution — the same split `token-tree-kind-class.ts` uses. `token-tree.tsx`
// re-exports `notationNamesFromSourceTokens` for its React consumers.

import type { SourceToken } from "./types";

/**
 * The set of notation-head `qualified_name`s in a decl's `source_tokens` (the
 * tokens the validator classifies with kind "notation"), for `TokenTreeView`'s
 * `notationNames` prop. Passing it makes a delaborated tree colour notation
 * atoms (`A`, `∃`, `∧`) IDENTICALLY to the source-bytes `ShikiSlice` render, so
 * the two renderers share ONE classification source and cannot drift. Cheap and
 * pure; callers compute it once per card/decl and memoize.
 */
export function notationNamesFromSourceTokens(
  tokens: SourceToken[] | undefined,
): ReadonlySet<string> {
  const out = new Set<string>();
  if (tokens === undefined) return out;
  for (const t of tokens) {
    if (t.kind === "notation" && t.qualified_name !== null) {
      out.add(t.qualified_name);
    }
  }
  return out;
}
