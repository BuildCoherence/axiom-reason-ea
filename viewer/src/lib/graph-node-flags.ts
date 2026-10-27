// The geometry flag bits — mirrored from `graphsnap/encode.go`, and the ONE
// definition of them in the web. In `lib/` so the server-rendered poster and OG
// card can read a node's state without importing the client decoder.

/** WIRE VALUES. A bit is never renumbered, only appended to. */
export const GRAPH_FLAG_USER_AXIOM = 1 << 0;
/** Degree-0 IN THIS EMISSION — the node has no edge among the nodes that were
 *  emitted, which is not the same as having no edge in the corpus — and exempt
 *  from pruning, so an isolated node is kept rather than dropped to make room. */
export const GRAPH_FLAG_ISOLATED = 1 << 1;
/** A PROOF NODE whose certificate concludes `False` — not the flag the False
 *  node is coloured by; that is GRAPH_FLAG_FALSE_PROPOSITION. */
export const GRAPH_FLAG_CONCLUDES_FALSE = 1 << 2;
/** A PROOF NODE whose certificate has no premises. NOT "the claim is settled" —
 *  that is GRAPH_FLAG_SETTLED — and under the shipping topology this bit is
 *  effectively never set. */
export const GRAPH_FLAG_PREMISE_FREE = 1 << 3;
/** A PROPOSITION some in-scope certificate concludes with no premises. The
 *  settled sense the Theorem Page badges, and the one to render by. */
export const GRAPH_FLAG_SETTLED = 1 << 4;
/** THE proposition `False` — one node, however many arguments derive it. */
export const GRAPH_FLAG_FALSE_PROPOSITION = 1 << 5;

// Bit 6 burned (was GRAPH_FLAG_SETTLED_HUB); never reclaim it — artifacts still
// in caches carry it set with that meaning. Append at bit 7.

/** Every bit this release knows. Unknown bits are TOLERATED and simply not
 *  read; only a `format_version` change may repurpose an existing bit. */
export const GRAPH_FLAG_MASK =
  GRAPH_FLAG_USER_AXIOM |
  GRAPH_FLAG_ISOLATED |
  GRAPH_FLAG_CONCLUDES_FALSE |
  GRAPH_FLAG_PREMISE_FREE |
  GRAPH_FLAG_SETTLED |
  GRAPH_FLAG_FALSE_PROPOSITION;
