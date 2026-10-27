import {
  kindLegendEntry,
  type GraphNodeKind,
  type KindLegendEntry,
} from "@/lib/graph-kind-legend";

import type {
  GraphManifest,
  GraphManifestTopNode,
} from "./graph-manifest-types";
import {
  GRAPH_FLAG_FALSE_PROPOSITION,
  GRAPH_FLAG_SETTLED,
} from "./graph-wire";

// Pinned locale: an unlocalised `Intl.NumberFormat` reads the runtime default,
// so the server and the client can disagree and hydration mismatches.
const GRAPH_NUMBER_FORMAT = new Intl.NumberFormat("en-US");

/** Format a corpus count for display. Always through this — never `toLocaleString()`. */
export function formatGraphCount(value: number): string {
  return GRAPH_NUMBER_FORMAT.format(value);
}

/** One result row. Carries no `href` by ruling: a row SELECTS, and the ruled
 *  exit from /graph is the panel's own link-outs. */
export type GraphOutlineRow = {
  id: string;
  label: string;
  kind: GraphNodeKind;
  /** Kind Legend display label ("Proposition" / "Proof Node"). */
  kindLabel: string;
  /** Kind Legend colour token; render as `var(<token>)`. */
  token: string;
  /** Zero-based band index. */
  band: number;
  /** "Band 2 of 5", or "Frontier" — the phrasing the search and outline rows share. */
  bandLabel: string;
};

/** The legend row a row should FACE. The precedence — False, then settled, then
 *  kind — is the order `nodeColor` uses in `graph-scene-model.ts`, and a row's
 *  dot must not disagree with the node it points at. */
function outlineLegendEntry(node: GraphManifestTopNode): KindLegendEntry {
  const flags = node.flags ?? 0;
  if (flags & GRAPH_FLAG_FALSE_PROPOSITION) {
    return kindLegendEntry("false-proposition");
  }
  if (flags & GRAPH_FLAG_SETTLED) return kindLegendEntry("settled");
  return kindLegendEntry(node.kind);
}

/** "Band 2 of 5", from a zero-based index, or "Frontier" for a band at or past
 *  the count — the Frontier's band value is `band_counts.length`, outside the
 *  core's bands, and "Band 6 of 5" is the string this arm exists to prevent.
 *  `bandCount` comes from the manifest, never a hardcoded 5 — the band count is
 *  a build parameter. */
export function graphBandLabel(band: number, bandCount: number): string {
  if (band >= bandCount) return "Frontier";
  return `Band ${band + 1} of ${bandCount}`;
}

export function graphOutlineRow(
  node: GraphManifestTopNode,
  bandCount: number,
): GraphOutlineRow {
  const kindEntry = kindLegendEntry(node.kind);
  const entry = outlineLegendEntry(node);
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    kindLabel:
      entry === kindEntry
        ? kindEntry.label
        : `${kindEntry.label} · ${entry.label}`,
    token: entry.token,
    band: node.band,
    bandLabel: graphBandLabel(node.band, bandCount),
  };
}

export function graphOutlineRows(manifest: GraphManifest): GraphOutlineRow[] {
  const bandCount = manifest.band_counts.length;
  return manifest.top_nodes.map((node) => graphOutlineRow(node, bandCount));
}

export type GraphStat = { id: string; term: string; value: string };

/** The corpus stats. Reads `counts` — what this Generation EMITTED — so the
 *  numbers match the picture; `totals` is what the corpus holds. */
export function graphStats(manifest: GraphManifest): GraphStat[] {
  return [
    {
      id: "propositions",
      term: "Propositions",
      value: formatGraphCount(manifest.counts.propositions),
    },
    {
      id: "proof-nodes",
      term: "Proof Nodes",
      value: formatGraphCount(manifest.counts.proof_nodes),
    },
    {
      id: "entails",
      term: "Entails",
      value: formatGraphCount(manifest.counts.entails_edges),
    },
    {
      id: "negates",
      term: "Negates",
      value: formatGraphCount(manifest.counts.negates_edges),
    },
    {
      id: "formal-identities",
      term: "Formal identities",
      value: formatGraphCount(manifest.formal_identity_total),
    },
  ];
}

/** The truncation sentence, or `null` when the Generation carries the whole
 *  corpus. Counts PROPOSITIONS, not nodes: the node total mixes in Proof Nodes,
 *  whose count is a function of the topology rather than of the corpus.
 *
 *  It says nothing about RANK: the Frontier is admitted by a provenance-keyed
 *  pass and trimmed only within its own shell, so the emitted proposition set is
 *  no longer a rank prefix of the corpus and "the N most engaged" would be
 *  false. One sentence, true under both shapes. */
export function graphTruncationNote(manifest: GraphManifest): string | null {
  if (!manifest.truncated) return null;
  const shown = formatGraphCount(manifest.counts.propositions);
  const total = formatGraphCount(manifest.totals.propositions);
  return `Showing ${shown} of ${total} propositions.`;
}

export type GraphStarterGroup = {
  id: keyof GraphManifest["starters"];
  label: string;
  /** What the list's unit is — none of the three is the rank that orders
   *  `top_nodes`. */
  hint: string;
  chips: GraphStarterChip[];
};

/** A starter chip. `row` is present only when the id resolves to a `top_nodes`
 *  entry. */
export type GraphStarterChip = { id: string; row: GraphOutlineRow | null };

const STARTER_GROUPS: readonly {
  id: keyof GraphManifest["starters"];
  label: string;
  hint: string;
}[] = [
  {
    id: "most_adopted",
    label: "Most adopted",
    hint: "How many formal identities have discharged the argument",
  },
  {
    id: "most_contested",
    label: "Most contested",
    hint: "Live disagreement: the smaller of the two sides",
  },
  { id: "newest", label: "Newest", hint: "Most recent first occurrence" },
];

/** Resolve the three starter lists against `top_nodes`. A starter id need not be
 *  one of the 200: an unresolved chip stays, inert, rather than silently
 *  shortening the list. An empty list is legitimate. */
export function graphStarterGroups(
  manifest: GraphManifest,
): GraphStarterGroup[] {
  const byId = new Map(graphOutlineRows(manifest).map((row) => [row.id, row]));
  return STARTER_GROUPS.map((group) => ({
    ...group,
    chips: manifest.starters[group.id].map((id) => ({
      id,
      row: byId.get(id) ?? null,
    })),
  }));
}

