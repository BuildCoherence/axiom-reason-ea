// Shared "is this proposition the Lean `False`?" predicate — the ONE definition
// every surface reads. A bare `False` is a contradiction, not a claim a reader
// can take a side on, so it carries no stance affordance anywhere: the theorem
// -page card drops its whole footer, the feed's theorem rows mount no control,
// and the Proposition side panel omits its Adoption section.

import type { RfFlowchartNode, TokenTree, TokenTreePair } from "../types";

/** Flatten a token tree to its bare surface text (no tags / no styling). */
function flattenTree(t: TokenTree): string {
  if (t.node === "text") return t.text;
  if (t.node === "append") return t.children.map(flattenTree).join("");
  return flattenTree(t.child);
}

/**
 * True iff the rendered pair flattens to exactly `False`. A null / empty pair
 * (an unresolved-hash node) → false.
 */
export function isFalseTokenPair(t: TokenTreePair | null | undefined): boolean {
  if (!t) return false;
  const tree = t.empty ?? t.author;
  if (!tree) return false;
  return flattenTree(tree).trim() === "False";
}

/** {@link isFalseTokenPair} for a flowchart node's proposition. */
export function isFalseProp(node: RfFlowchartNode): boolean {
  return isFalseTokenPair(node.tokens);
}
