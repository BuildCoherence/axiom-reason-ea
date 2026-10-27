// How a SETTLED node's card paints. Pure (no React, no CSS module) so the
// standalone unit runner drives it directly and the card components share one
// definition.
//
// `settled` covers two states that read as OPPOSITES on the page, so the flag
// alone can't pick the chrome:
//   • `False` — the argument closes on a contradiction. The body goes
//     diff-remove red and the card drops its footer panel outright: a
//     contradiction is not a claim a reader can adopt or reject.
//   • settled, anything else — definitional: proven for every viewer, so the
//     card paints the HELD rail whatever the viewer's own stance is, anonymous
//     (no stance at all) included. It keeps its "definitional" footer label.
// `False` wins the tie: a contested `False` must never paint green.

import type { RfFlowchartNode, ViewerStanceValue } from "../types";
import { isFalseProp } from "./is-false-prop";

/** The Lean `False` — the red-bodied, footerless contradiction card. */
export function isFalseConclusion(node: RfFlowchartNode): boolean {
  return isFalseProp(node);
}

/**
 * The stance the card's top rail and ∵/∴ kind glyph paint. A definitional node
 * reads HELD for everyone; every other node follows the VIEWER's own stance,
 * falling back to the neutral undecided rail when there is none.
 */
export function cardRailStance(
  node: RfFlowchartNode,
  stance: ViewerStanceValue | undefined,
): ViewerStanceValue {
  if (node.settled && !isFalseProp(node)) return "held";
  return stance ?? "undecided";
}
