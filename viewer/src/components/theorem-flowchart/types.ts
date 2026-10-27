// Wire-shape + prop types for the Theorem Flowchart and the Theorem Page.
//
// Mirrors the theorem page payload `data/theorem/<id>.json`, specified in
// the internal theorem-page doc § "Wire contract" 1:1 (snake_case to
// match the wire format, the same convention `lean-ui/types.ts` uses). The
// flowchart consumes only `FlowchartNode` / `FlowchartEdge` (it is deliberately
// data-prop-driven and fetch/URL-unaware so the marketing hero can re-skin it
// with mocked data); the page route consumes the whole `TheoremPageResponse`.

import type { ByteRange, Decl, TokenTreePair } from "@/components/lean-ui/types";

/**
 * Node kind. v1 emits `"premise"` | `"conclusion"`; `"bridge"` | `"intermediate"`
 * | `"restatement"` arrive with #850's proof-term walk. `"restatement"` (a
 * premise-equality bridge) renders with bridge chrome via the label map. Typed
 * as a string union open at the edges (the renderer shows the kind label
 * verbatim and the layering function is kind-agnostic), so a future kind needs
 * no type change here.
 */
export type FlowchartNodeKind =
  | "premise"
  | "conclusion"
  | "bridge"
  | "intermediate"
  | "restatement"
  | (string & {});

/**
 * One DAG node. `id` is the STABLE node identity — the proposition id for
 * current blobs, historically the node hash — ALWAYS present (even for an
 * unresolved node); it is the React/layering/edge key, so ≥2 unresolved nodes
 * never collide. `proposition_id` is the LIVE proposition id the read path
 * resolved for the node — OPTIONAL: omitted for an unresolved node (a logged
 * server-side event); when present it drives the `data-proposition-id`
 * attribute and the holders drill-in. `tokens` is the self-contained per-node
 * author/empty TokenTreePair the validator emits (null when not yet
 * backfilled — render a graceful fallback, never crash). `holdings` is null
 * only when the node is unresolved.
 */
export interface FlowchartNode {
  kind: FlowchartNodeKind;
  /**
   * Stable node identity: the proposition id for current blobs; historically
   * the node hash. Always present; the keying handle.
   */
  id: string;
  /**
   * Resolved live proposition id; omitted when the node identity didn't
   * resolve. It can differ from `id` (a stored id absorbed by a rule-bump
   * merge resolves to its survivor). Used only for `data-proposition-id` and
   * the holders drill-in — NEVER for keying.
   */
  proposition_id?: string;
  /** Settled nodes render a literal "settled" label in the badge slot. */
  settled: boolean;
  /** Current Adoptability Pair matches the server's CXI and Lean versions. */
  adoptable?: boolean;
  /** A reference or theorem-position adoption leg can structurally exist. */
  endcap_eligible?: boolean;
  /** Per-node token trees; null when the DAG row predates the backfill. */
  tokens: TokenTreePair | null;
  /**
   * Half-open, 0-indexed UTF-8 byte range of the node's proposition into the
   * theorem's home-file source (`TheoremPageResponse.file_content`). Present
   * when the validator aligned this node to a verbatim source span — the AUTHOR
   * view then renders the proposition from those source bytes (mirroring the
   * side panel / profile axiom rows) instead of delaborating the token tree,
   * preserving the authored surface syntax (`Sam thinks about Kristie`).
   * `null`/omitted for a derived or non-firing node with no aligned span — those
   * keep the delaborated `tokens` render. (PROTOTYPE wire field.)
   */
  author_byte_range?: ByteRange | null;
  /**
   * Premise binder name (e.g. `moral_duty`), forwarded from the validator —
   * shown as the premise card header instead of the bare word "Premise". Present
   * only on a premise node whose binder named; `null` for a conclusion node, a
   * premise whose binder didn't name (an anonymous `variable [Inst]` instance,
   * `inst✝`), or a pre-backfill node. The wire emits an explicit `null`, so the
   * type must admit it — consumers MUST guard with `!= null`, not `!== undefined`.
   */
  name?: string | null;
  /** ✓/✗ Holding counts; null only for an unresolved node. */
  holdings: { pro: number; con: number } | null;
  acknowledgements?: { acknowledged_undecided: number };
  /**
   * The signed-in viewer's stance on this node's proposition. Present ONLY when
   * the request was authenticated AND the node is non-settled and resolved;
   * omitted entirely for an anonymous read (and for settled/unresolved nodes).
   * "held" — the viewer holds the proposition; "rejected" — the viewer holds
   * its negation; "undecided" — neither.
   */
  viewer_stance?: "held" | "rejected" | "undecided";
}

/** A premise → conclusion edge, keyed by the nodes' stable `id`s (node identity strings). */
export interface FlowchartEdge {
  source: string;
  target: string;
}

/** The render-shaped premise DAG: nodes plus their derivation edges. */
export interface TheoremDag {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

/**
 * Adoption summary. `premise_count === 0` ⇒ premise-free ("definitional",
 * no adopter count); `adopter_count` is omitted/0 in that case (the read path
 * short-circuits). The whole `adoption` object is null for an open-binder or
 * pre-backfill theorem (fallback rendering).
 */
export interface TheoremAdoption {
  premise_count: number;
  adopter_count?: number;
}

/**
 * The theorem page payload `data/theorem/<id>.json`. `adoption` and `dag` are null
 * together for an open-binder / pre-backfill theorem — the page renders the
 * header + signature + an explanatory note and NEVER 404s for a real published
 * theorem (design § "Fallback rendering").
 */
export interface TheoremPageResponse {
  decl: Decl;
  /**
   * Publish timestamp (RFC3339) — the theorem's `axiom_defs.created_at`, the
   * SAME value the defs endpoint formats as `created_at`. Drives the side
   * panel's "published … <date>" line. Top-level (sibling of `decl`),
   * mirroring `DefData`'s shape.
   */
  created_at: string;
  adoption: TheoremAdoption | null;
  dag: TheoremDag | null;
  /**
   * The theorem's whole home-file verbatim source. Drives the AUTHOR-view
   * source-bytes rendering of flowchart nodes that carry an
   * `author_byte_range` (mirrors `DefData.file_content`, which backs the side
   * panel's slices). Always present — the Go handler writes it on every
   * response. (PROTOTYPE wire field.)
   */
  file_content: string;
}

// --- Drill-in endpoint wire shapes (lazy, client-fetched) ------------------

/**
 * One holder row from the `holders` of `data/prop/<id>.json`. Deduped
 * axiom > derived; `inconsistent: true` rows are the locked-out trailing group.
 * See `drill-into-holding-and-adoption-provenance.md` step 2.
 */
export interface HoldingRow {
  username: string;
  provenance: "axiom" | "derived";
  /** axiom provenance: the listed User Axiom's name. */
  axiom_name?: string;
  /** axiom provenance: projection path when the Holding is a bundle unwrap. */
  field_path?: string;
  /** axiom provenance: link target → `/f/<snapshot_file_id>?def=<snapshot_def_id>`. */
  snapshot_file_id?: string;
  snapshot_def_id?: string;
  /**
   * derived (via-argument) provenance: the witnessing certificate's
   * declaration. `source === "theorem"` → its Theorem Page (`/theorem/<def_id>`);
   * `source === "user_theorem"` → its file page (`/f/<file_id>?def=<def_id>`,
   * the strategy's recorded fallback — wrappers have no Theorem Page).
   */
  witness?: {
    def_id: string;
    file_id: string;
    qualified_name: string;
    source: "theorem" | "user_theorem";
  };
  /** Locked-out user — listed-and-flagged, never counted. */
  inconsistent: boolean;
}

/** The `holders` of `data/prop/<id>.json`. */
export interface HoldersResponse {
  pro: HoldingRow[];
  con: HoldingRow[];
}

/** The `adopters` of `data/def/<id>.json`.
 *
 * `inconsistent: true` rows are the locked-out adopters: excluded from the
 * adopter COUNT (the substrate's `AdopterCount` anti-join) but LISTED in the
 * adopters drill-in flagged inconsistent (flag-don't-hide; mirrors the holders
 * `inconsistent` flag, #895). See `drill-into-holding-and-adoption-provenance.md`. */
export interface AdoptersResponse {
  adopters: Array<{ username: string; inconsistent: boolean }>;
}

/** An active drill-in request, discriminated by `kind`. Both open the same
 * `HoldersModal`: a per-proposition Holding bar click (`holders`) and the
 * theorem-level adopter chip click (`adopters`). `element` is the trigger, for
 * focus return on close (WCAG 2.4.3). */
export type DrillInRequest =
  | {
      kind: "holders";
      side: "pro" | "con";
      proposition_id: string;
      element: HTMLElement;
    }
  | {
      kind: "adopters";
      def_id: string;
      element: HTMLElement;
    };
