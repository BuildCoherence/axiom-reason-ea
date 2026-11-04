// Shared wire-shape types for the Lean UI Component.
//
// These mirror the JSON envelope every Lean-rendering endpoint returns — the
// per-decl Decl, its structured token trees, and the file-shaped scaffolding
// — as specified by the internal lean-ui-component doc §§ "Decl
// envelope", "Structured token tree", "Component inputs (props)", and the
// the `def` payload of `data/def/<id>.json` (§ "Public API").
//
// The proposition-panel wire types (`PropData` + helpers) mirror
// the `proposition` payload of `data/prop/<id>.json` from
// the internal user-profile-page doc. They live alongside the other Lean-UI wire types because
// the PropositionPanel is a sibling of the SidePanel (both wrap PanelShell);
// `HoldingRow` is imported from the theorem-flowchart types — NOT redefined —
// since it is the existing holders/rejecters drill-in row shape shared across
// surfaces.
//
// Field names are kept in snake_case to match the wire format 1:1, the same
// convention already used by the file-page and profile-page consumers (see
// e.g. `created_at`, `forked_from`, `publisher` on the existing
// `CeFileResponse` in `(public)/f/[file_id]/page.tsx`). This avoids a
// per-field rename layer between fetch and render — the renderer reads what
// the API emits.

import type { HoldingRow } from "@/components/theorem-flowchart/types";

/**
 * Stable DOM id for the declaration side panel's content surface. Clickable
 * identifiers stamp `aria-controls={SIDE_PANEL_ID}` (both in the server-side
 * Shiki decorations on the file page and in the client TokenTreeView) so
 * assistive tech knows the in-page surface they open/operate. Lives
 * here — the one module both the panel and the renderers already import —
 * so the value has a single source of truth and no import cycle.
 */
export const SIDE_PANEL_ID = "ce-side-panel";

/**
 * Stable DOM id for the proposition inspection panel's content surface — the
 * `?prop=` sibling of {@link SIDE_PANEL_ID}. The PropositionPanel passes this
 * to PanelShell's `surfaceId`, and identifiers inside the proposition's `p`
 * stamp `aria-controls={PROP_PANEL_ID}` so assistive tech knows the in-page
 * surface they pivot into (a cross-type pivot opens the DEF panel, but the
 * prop panel is the surface the prop-axis identifier lives in). Distinct from
 * the def panel's id so the two surfaces never collide in the DOM when a
 * future revision keeps both mounted across a pivot.
 */
export const PROP_PANEL_ID = "ce-proposition-panel";

/**
 * Premise-telescope collapse policy, shared by the two surfaces that render a
 * theorem's premises as telescope lines: the Theorem Page's synthetic signature
 * (`theorem-syntax.tsx`) and the side panel's Premises section. More than
 * {@link PREMISE_COLLAPSE_THRESHOLD} premises collapse to the first
 * {@link PREMISES_VISIBLE_WHEN_COLLAPSED} plus an "N more" control.
 */
export const PREMISE_COLLAPSE_THRESHOLD = 4;
export const PREMISES_VISIBLE_WHEN_COLLAPSED = 3;

/**
 * Structured token tree — the renderable unit. Mirrors Lean's own
 * `CodeWithInfos` / `TaggedText SubexprInfo` shape (the same model
 * `Widget.tagCodeInfos`, doc-gen4, and ProofWidgets4 emit), so the wire
 * format is 1:1 with what the validator's extraction pass produces.
 */
export type TokenTree =
  | { node: "text"; text: string }
  | { node: "append"; children: TokenTree[] }
  | { node: "tag"; tag: TokenTag; child: TokenTree };

/**
 * Per-leaf (or interior) metadata carried by `node: "tag"`. See the design
 * doc § "Structured token tree" — every field's role and nullability is
 * fixed there.
 */
export interface TokenTag {
  /**
   * Coarse syntactic classification driving renderer styling. The validator's
   * `kindOf` (LeanValidator/Extract/Tokens.lean) emits `identifier`,
   * `string` (`.lit (.strVal _)`), `literal` (other `.lit _`), `op`,
   * `whitespace`, and — since the emission-completion amendment — `type` for
   * Sort-valued identifier heads (`Nat`, `Prop`-valued heads, type formers;
   * the check rides the per-leaf `Meta.inferType` the inlined summary already
   * computes), consumed by the shared `--ce-token-type` color slot in both
   * pipelines (the #756 body↔panel invariant). `stdlib` is set by the API
   * resolver via a post-publish lookup (in-CE def_id resolution against
   * `axiom_defs`) — the validator itself never produces it. `keyword` and
   * `comment` survive in the union because the structured-token TREE has
   * class-based panel consumers for them even though `kindOf` does not emit
   * them today.
   */
  kind:
    | "identifier"
    | "string"
    | "literal"
    | "op"
    | "keyword"
    | "comment"
    | "whitespace"
    | "stdlib"
    | "type";
  /** Surface text of the tagged subtree. */
  text: string;
  /**
   * Fully-qualified Lean Name of the referenced decl, when the tagged
   * subtree reduces to a single head identifier. `null` for binders /
   * locals and for tags that do not name a constant.
   */
  qualified_name: string | null;
  /**
   * `axiom_defs.id` UUID for in-CE references; `null` for stdlib / prelude
   * references (e.g. `Nat.add`, `HAdd.hAdd`). The side panel anchors on
   * this directly; clicks on `null`-def_id tags are suppressed per the
   * design's § "Tag placement".
   */
  def_id: string | null;
  /**
   * Stable identifier for this tag, derived from
   * `(decl_name, view, DFS-index)`. Used as the React key across re-renders.
   */
  token_id: string;
  /**
   * Coarse classification of the tagged token (`term`, `tactic`, `field`,
   * `doc`, …). v1 consumes only `term`; other values are informational.
   */
  hover_kind: string | null;
  /** `def_site` (binders) vs `use_site` (occurrences). */
  binder_role: "def_site" | "use_site" | null;
  /**
   * One line of `Format` computed at extraction time via
   * `Meta.ppExpr ∘ Meta.inferType`. Drives the hover popover without a
   * network round-trip.
   */
  inlined_type_summary: string | null;
  /**
   * `Lean.SubExpr.Pos` path of the tagged subterm within its `type_expr` /
   * `value_expr` tree, in Lean's own `"/1/0/2"` string encoding
   * (emission-completion amendment; `SubexprInfo.subexprPos`). Reserved for
   * re-anchoring tokens to expression nodes (inline filter-match
   * highlighting, instantiation views). Null-tolerant: absent/`null` on tags
   * from producers that do not stamp it — readers must not assume presence.
   */
  subexpr_pos?: string | null;
  /**
   * Explicit per-token role stamped by the validator (same append-only
   * vocabulary as `SourceToken.token_role`, spec-extract-emission-completion
   * § 0.1 — treat unknown values as `null`). On tree tags the validator
   * stamps only the literal roles: `num_lit` when the tagged subterm is a
   * numeric literal — a plain numeral (`OfNat.ofNat`-elaborated) or a
   * scientific literal like `1.5` (`OfScientific.ofScientific`-elaborated,
   * same color family) — and `char_lit` when it is a char literal like
   * `'a'` (`Char.ofNat`-elaborated). The tag `kind` stays `identifier` for
   * all of these (rewritten `stdlib` by the API where applicable), so these
   * are the data-only channel a renderer can key literal coloring on; no
   * renderer consumes them yet. `control_atom` / `macro_surface` are
   * source-token-only producers.
   */
  token_role?: "control_atom" | "macro_surface" | "num_lit" | "char_lit" | null;
}

/**
 * View choice — the rendering lens for a piece of Lean content. v1 ships
 * `author` and `empty`; the design leaves the door open for a future
 * `{ kind: "user", userId }` variant via the structured-choice shape.
 */
export type ViewChoice = { kind: "author" } | { kind: "empty" };

/** Half-open, 0-indexed UTF-8 byte range into the file source. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Both pre-rendered views for a single type / value tree. Either side may
 * be selected by the host page; both share the same identifier `def_id`s
 * so click navigation is view-stable.
 */
export interface TokenTreePair {
  /**
   * `null` in the common case — the panel renders author view from source
   * bytes via the decl's byte sub-span. Populated ONLY as the inferred-type
   * fallback (when `decl_sig_byte_range` is null): the delab-rendered tree
   * under the author-view openDecls, marked "(inferred)" in the UI.
   * `value_tokens.author` is ALWAYS null (values always have source bytes).
   */
  author: TokenTree | null;
  empty: TokenTree;
}

/**
 * Source-aligned semantic token — one identifier occurrence in the file's
 * verbatim source, carrying EXACT absolute UTF-8 byte offsets into the
 * file content. The backend emits these per decl (see `Decl.source_tokens`)
 * so the file page can drive Shiki's `decorations` API server-side: Shiki
 * splits its own syntax tokens at these byte offsets and stamps our
 * `data-*` attributes onto the resulting spans. This replaces the old
 * client-side DOM-walking / text-matching approach — the spans carry their
 * identity from authoritative data, not from re-deriving it in the browser.
 *
 * Mirrors `TokenTag` semantics (qualified_name / def_id / hover_kind /
 * binder_role / inlined_type_summary) but is keyed by absolute byte range
 * rather than living inside a per-decl `TokenTree`.
 */
export interface SourceToken {
  /** Absolute 0-indexed UTF-8 byte offset into the file source (inclusive). */
  byte_start: number;
  /** Absolute 0-indexed UTF-8 byte offset into the file source (exclusive). */
  byte_end: number;
  /**
   * Coarse syntactic classification. Matches `TokenTag.kind`: the validator
   * emits `identifier`, `string`, `literal`, `op`, `whitespace`, `notation`,
   * and — since the emission-completion amendment — `keyword` / `comment`
   * (the whole-file syntactic atom walk) and `type` (Sort-valued identifier
   * heads); `stdlib` is set by the API resolver via a post-publish lookup
   * against `axiom_defs` (in-CE vs stdlib disambiguation — unresolved
   * `identifier` AND `type` tokens both present as `stdlib` on the wire
   * while the type-coloring deferral is in effect; see the note in
   * token-colors.css). See `TokenTag.kind` for the full rationale.
   *
   * `notation` is emitted for the literal ATOM(S) of a notation/macro use that
   * expands to a function application (`loves`; `thinks`/`about`; built-in
   * `∧`): the validator decomposes the use into argument identifier tokens +
   * per-atom `notation` tokens, each carrying the head function as
   * `qualified_name`. The atom is colored distinctly (keyword-like) and stays
   * clickable to the head function exactly like an identifier — so it routes
   * through the same interactive / def_id-resolution pipeline.
   */
  kind:
    | "identifier"
    | "string"
    | "literal"
    | "op"
    | "keyword"
    | "comment"
    | "whitespace"
    | "stdlib"
    | "notation"
    | "type";
  /** Surface text of the token (the identifier as it appears in source). */
  text: string;
  /**
   * Fully-qualified Lean Name of the referenced decl, or `null` when the
   * token does not name a constant (binders / locals).
   */
  qualified_name: string | null;
  /**
   * `axiom_defs.id` UUID for in-CE references; `null` for stdlib / prelude
   * references (NOT clickable — the side panel can't anchor on them).
   */
  def_id: string | null;
  /** Proposition-panel target for Prop-valued fields/theorem declarations. */
  proposition_id?: string | null;
  /** Stable id derived from `(decl, view, DFS-index)` — used for tracking. */
  token_id: string;
  /** Coarse classification of the tagged token (`term`, `tactic`, …). */
  hover_kind: string | null;
  /** `def_site` (binders) vs `use_site` (occurrences). */
  binder_role: "def_site" | "use_site" | null;
  /** One line of `Format` for the hover popover (no network round-trip). */
  inlined_type_summary: string | null;
  /**
   * Explicit per-token role stamped by the validator (emission-completion
   * amendment; vocabulary owned by
   * the internal spec-extract-emission-completion doc § 0.1,
   * append-only — treat unknown values as `null`):
   *
   *   - `control_atom` — a syntactic control marker (e.g. `𝕖`) that must
   *     never link or open a panel. The renderers key non-clickability on
   *     THIS value (superseding the old kind+null-qualified-name inference).
   *   - `macro_surface` — a token recovered from a macro use's original
   *     surface rather than from an elaborator `TermInfo`.
   *   - `num_lit` — a numeric-literal occurrence: `numLitKind` source
   *     syntax (decimal or `0x…`/`0b…`/`0o…`; `kind` stays `identifier`,
   *     rewritten `stdlib` by the API resolver) or `scientificLitKind`
   *     source syntax (`1.5` — a scientific literal IS a numeric literal,
   *     one color family; its syntactic-layer atom keeps `kind: "op"`).
   *   - `char_lit` — a char-literal occurrence (`charLitKind` source
   *     syntax, e.g. `'a'`; its syntactic-layer atom keeps `kind: "op"`).
   *
   * The literal roles preserve today's rendering (`kind` unchanged); they
   * are the data-only channel a future renderer can key literal coloring
   * on. No renderer consumes them yet — both renderings stay
   * frontend-choosable. Absent/`null` on ordinary tokens and on rows
   * persisted before the emission-completion backfill.
   */
  token_role?: "control_atom" | "macro_surface" | "num_lit" | "char_lit" | null;
}

/**
 * File reference — a clickable `import` / `open` directive in the file's
 * verbatim source that points at another CE file by its unified id. The
 * backend emits one per import/open occurrence on the file payload `data/f/<id>.json`
 * (top-level `file_refs`), carrying the EXACT absolute UTF-8 byte range of
 * the clickable file-id token in the source.
 *
 * This drives the file page's import/open NAVIGATION links: the page's
 * `buildDecorations` turns each `FileRef` into a Shiki decoration stamped
 * `data-kind="file-ref"`, and the client body renders it as a real anchor
 * (`<a href="/f/<target_file_id>">`) that SPA-navigates to the referenced
 * file's page. Unlike clickable identifiers (which open the in-page side
 * panel), a file-ref NAVIGATES — both `import` and `open` resolve to the same
 * `/f/<target>` mechanism (the file page shows that namespace's content).
 *
 * Keyed by absolute byte range rather than by a per-decl `TokenTree`; field
 * names stay snake_case to match the wire format 1:1 (see module header).
 */
export interface FileRef {
  /** Absolute 0-indexed UTF-8 byte offset of the token start (inclusive). */
  byte_start: number;
  /** Absolute 0-indexed UTF-8 byte offset of the token end (exclusive). */
  byte_end: number;
  /** Unified id of the file to navigate to (`/f/<target_file_id>`). */
  target_file_id: string;
  /** Which directive produced the reference. Both navigate identically. */
  kind: "import" | "open";
}

/**
 * Decl envelope — the wire shape every API endpoint returns and the
 * component consumes. Composed server-side from joined `axiom_defs`,
 * `axiom_files`, and `users` rows; the structured-token trees come from
 * the new validator-extracted columns.
 */
export interface Decl {
  /** `axiom_defs.id` UUID — stable identity across surfaces. */
  def_id: string;
  /**
   * Declaration kind (`axiom_defs.kind`, the `declaration_kind` enum) —
   * `"definition"`, `"theorem"`, `"axiom"`, `"opaque"`, `"inductive_type"`,
   * `"constructor"`, `"recursor"`, … (NOT `"def"`; `"user_theorem"` is NOT a
   * `declaration_kind` — the user_theorem distinction lives on
   * `entailment_certificates.source`). Additive field (per
   * the internal api-expand-contract-evolution doc) the file, defs,
   * profile, and theorem-page endpoints all now return. Drives the
   * Theorem-Page inbound affordances: the file-page "view theorem page"
   * icon-link and the side panel's "View theorem page" link gate on
   * `kind === "theorem"` (navigate-to-theorem-page flow). Always present;
   * pre-amendment callers that don't read it are unaffected.
   */
  kind: string;
  /** UI-facing role; projection declarations render as `field`. */
  display_kind?: string | null;
  /** `<file_id>.<localname>` — the fully-qualified Lean Name. */
  qualified_name: string;
  /** Leaf component of `qualified_name`. */
  local_name: string;
  /**
   * Publisher attribution. `null` when the publisher's user account has
   * been deleted — the API's `LEFT JOIN users ... ON DELETE SET NULL`
   * surfaces this case as a null envelope. Consumers must gate any
   * publisher-keyed rendering (link, username display) on non-null per
   * the design's § "Publication, not authorship" — mirroring the file-
   * page header's gating in `(public)/f/[file_id]/ce-file-header.tsx`.
   */
  publisher: { username: string } | null;
  /** Unified id of the home file. */
  file_id: string;
  /** Half-open, 0-indexed UTF-8 byte range into the file's source. */
  byte_range: ByteRange;
  /**
   * Half-open UTF-8 byte range of the written type-annotation node into the
   * file source. `null` iff the type is inferred (no `: T` written, e.g.
   * `def foo := 42`) — the panel then falls back to the `type_tokens.author`
   * delab tree with an "(inferred)" badge. Design § "Author-view extraction".
   */
  decl_sig_byte_range: ByteRange | null;
  /**
   * Half-open UTF-8 byte range of the value/body node into the file source.
   * `null` iff the decl is an `axiom` (no value). Design § "Author-view
   * extraction".
   */
  decl_val_byte_range: ByteRange | null;
  type_tokens: TokenTreePair;
  /** `null` for axioms; present for defs / theorems. */
  value_tokens: TokenTreePair | null;
  /**
   * Source-aligned semantic tokens with absolute UTF-8 byte ranges into the
   * file source. Always an array (empty if the decl has no resolvable
   * identifiers). Drives the file page's server-side Shiki decorations.
   */
  source_tokens: SourceToken[];
}

/**
 * The fields of a `Decl` the file page's client body reads (outline, command
 * palette, sticky header, j/k stepping). The page projects its decls to this
 * shape so the token trees, which only the server-side decorations consume,
 * stay out of the client payload.
 */
export type DeclLabel = Pick<Decl, "def_id" | "local_name" | "qualified_name">;

/**
 * The `def` payload of `data/def/<id>.json`. The side panel's
 * primary data source for cross-file panel anchoring.
 */
export interface DefData {
  decl: Decl;
  /** 1-indexed inclusive line range — for "Scroll to in file" affordance. */
  source_lines: { start: number; end: number };
  /** RFC3339. */
  created_at: string;
  /**
   * The home file's verbatim UTF-8 source. The panel byte-slices this over
   * `decl.decl_sig_byte_range` / `decl.decl_val_byte_range` to render the
   * author view.
   */
  file_content: string;
  /**
   * The proposition this declaration DENOTES, when it is Prop-typed: a theorem's
   * conclusion (the proposition it proves), OR an axiom / `def … : Prop`'s
   * asserted / defined proposition. `null` for non-Prop defs. When non-null the
   * def panel grafts the proposition's Adoption / Supports / Equivalences sections
   * (D28) for ANY Prop-typed def; only the covered/uncovered "provable from your
   * axioms" split within Supports is theorem-only. Optional on the wire for
   * forward-compat; the current backend always emits it.
   */
  conclusion_prop?: string | null;
  /**
   * Generated declarations that share this declaration's authored source span.
   * Structures/classes surface projection-like generated members here; ordinary
   * inductives surface their constructors. The side panel uses this to replace
   * the misleading valueless "(no value)" surface with a domain-specific
   * Fields/Constructors section.
   */
  members?: DeclarationMember[] | null;
  /**
   * DAG-sourced statement of a theorem — the source of the panel's Conclusion
   * and Premises sections. `null` / absent for non-theorems (including
   * projection fields, which are theorem-kind on the wire) and for a theorem
   * with no premise-DAG row; the panel then falls back to the
   * `decl_sig_byte_range` slice under the same Conclusion heading. Sourcing the
   * conclusion from the DAG node is load-bearing: `decl_sig_byte_range` equals
   * the conclusion only for a binder-style theorem in Author's view — for
   * `theorem f : P → R`, in Universal view, and in the (inferred)/(universal)
   * fallbacks it spans the FULL type, premises included.
   */
  theorem_statement?: TheoremStatement | null;
}

/**
 * One node of a theorem's DAG-sourced statement. `name` is the premise binder
 * (`null` for the conclusion, for an anonymous binder, and for a pre-backfill
 * node — guard with `!= null`, the wire emits explicit null). `tokens` is the
 * node's own author/empty pair (null pre-backfill). `author_byte_range` spans
 * the node's verbatim source in `DefData.file_content`, so the author view can
 * render the authored surface syntax instead of a delaborated tree.
 * `proposition_id` is present only when the node's stored id resolved; it is
 * what a premise name opens the proposition panel with.
 */
export interface TheoremStatementNode {
  name?: string | null;
  proposition_id?: string;
  tokens: TokenTreePair | null;
  author_byte_range?: ByteRange | null;
}

/** `theorem_statement`: the conclusion node plus premises in declaration order. */
export interface TheoremStatement {
  conclusion: TheoremStatementNode;
  premises: TheoremStatementNode[];
}

export interface DeclarationMember {
  def_id: string;
  qualified_name: string;
  local_name: string;
  kind: string;
  display_kind?: string | null;
  conclusion_prop?: string | null;
}

/**
 * One entry in the side panel's "Referenced by" list — the slim per-row
 * shape of the `referenced_by` list of `data/def/<id>.json`. The list
 * trims the envelope to just what the panel's list row needs (clickable
 * label + drill-down key + hover qualifier); the full envelope is one
 * click away via the `def` payload of `data/def/<id>.json`.
 */
export interface ReferencedByEntry {
  /** `axiom_defs.id` of the referencing decl — the panel drills into this. */
  def_id: string;
  /** Fully-qualified Lean Name (`<file_id>.<localname>`) — shown on hover. */
  qualified_name: string;
  /** Leaf component of `qualified_name` — the visible row label. */
  local_name: string;
  /** Declaration kind (same vocabulary as `Decl.kind`). */
  kind: string;
  /** UI-facing role; projection declarations render as `field`. */
  display_kind?: string | null;
  /** Home file's unified id — included so a future row can link cross-file. */
  file_id: string;
}

/**
 * The `referenced_by` list of `data/def/<id>.json`. Always
 * a JSON array (`[]` for the zero-references case) so the panel can branch
 * on `items.length` rather than nullability. Sorted by `qualified_name`
 * ASC server-side.
 */
export interface ReferencedByResponse {
  items: ReferencedByEntry[];
  /**
   * True iff the SQL's LIMIT 201 probe surfaced a 201st row — i.e. the
   * anchored def has more than 200 referencing decls and `items[]` has
   * been truncated to the displayed-rows ceiling. Optional on the wire
   * for forward compatibility with any cached pre-cap response, but the
   * current backend always emits it (`spec-defs-handler.md`). The panel
   * does not yet surface a "showing first N" affordance — the flag is
   * here so a future iteration can without a wire-shape break.
   */
  has_more?: boolean;
}

/**
 * One "argument for" — a premise-set supporting a proposition, with its
 * premise-sets resolved to the holder's axiom def_ids. Mirrors the `supports[]`
 * entries of BOTH the `proposition` payload of `data/prop/<id>.json` and the profile
 * endpoint's `held_propositions.items[].supports[]` (the profile shape carries
 * only `premise_axiom_ids`; this fuller shape adds the certificate metadata the
 * panel renders). Field names are snake_case to match the wire 1:1.
 */
export interface PropSupport {
  /** `entailment_certificates.def_id` — the certificate witnessing the argument. */
  def_id: string;
  /**
   * Fully-qualified name (`<file_id>.<localname>`) of the certificate's
   * declaration — the theorem that witnesses this proof. Surfaced so a proof row
   * FACES the certificate with its real theorem name (clickable → `?def=def_id`)
   * instead of a positional "Argument N". `""` if the cert has no resolved name.
   */
  name: string;
  /** Number of premises in this argument. */
  premise_count: number;
  /** True iff this certificate concludes `False` (lockout-relevant). */
  concludes_false: boolean;
  /**
   * The user's axiom def_ids covering this premise-set — the graph-edge targets
   * (an edge runs from the proposition node to each of these axiom nodes).
   */
  premise_axiom_ids: string[];
}

/**
 * One Iff-linked equivalence — the proposition on the OTHER side of the Iff
 * (the row's PRIMARY FACE, rendered as its STATEMENT), plus the witnessing
 * `P ↔ Q` Iff theorem that PROVES it (demoted to the row's secondary "via …"
 * subline) and the equivalent proposition's representative declaration (a
 * statement-absent fallback face). Mirrors `equivalences[]` of the propositions
 * endpoint. NOTE the FRONTEND redesign: propositions have no names — only ids +
 * statements — so the Equivalences section now FACES each row with the
 * equivalent proposition Q's STATEMENT (`equivalent_phrasing.empty` via the
 * token-tree renderer, click → Q's proposition panel) and DEMOTES the witness
 * Iff theorem to a "via <name> · N premises" subline (click → the theorem's def
 * panel, where its premises live). Multiple `equivalences[]` elements may share
 * one `equivalent_proposition_id` (distinct Iff witnesses of the SAME
 * equivalence); the section GROUPS them into one logical equivalence per partner
 * proposition.
 */
export interface PropEquivalence {
  /**
   * The witnessing Iff theorem's declaration — the `P ↔ Q` proof. This is the
   * row's PRIMARY FACE and `?def=` pivot target (via `onSelectDef`): the section
   * renders this theorem's `name` as the clickable row label and drills the DEF
   * panel into it, where the witness's premises live. (Before the redesign it
   * was a hover-only qualifier; the row faced the equivalent proposition's
   * representative instead.)
   */
  def_id: string;
  /**
   * The witnessing Iff theorem's fully-qualified `axiom_defs.name` — the leaf is
   * the row label, syntax-highlighted as `theorem <name>` via the shared token
   * renderer. `""` / undefined when the witness has no resolved name (a stale
   * pre-amendment response, or a cert with no def row) → the row falls back to
   * the bare `def_id`. GUARD before reading `.length` (an unguarded read on an
   * absent field crashed the panel before).
   */
  name: string;
  /**
   * The witness theorem's premise count — shown on the row subline ("N
   * premises"), mirroring a Proofs row. May be undefined on a stale response →
   * treat as `0`.
   */
  premise_count: number;
  /**
   * The witness's premise PROPOSITION ids (NOT def_ids) — drive the
   * covered/uncovered split exactly like `PropSupport.premise_axiom_ids`: a
   * witness is COVERED iff every id is in the profile user's held set
   * (`premise_axiom_ids ⊆ coveredPropositionIds`; `[].every === true` ⇒ a
   * premise-free witness is covered for everyone). May be undefined on a stale
   * response → treat as `[]`.
   */
  premise_axiom_ids: string[];
  /**
   * The proposition on the OTHER side of the Iff (Q). Wire field name is
   * `equivalent_proposition_id` (NOT `proposition_id`) — the propositions
   * endpoint (`GetProposition`, theorems.go) emits the equivalent side as
   * `equivalent_proposition_id`. The row's "⇔ …" affordance pivots the panel
   * here (`onSelectProp`) when Q has no representative declaration; otherwise it
   * pivots to the representative def (`onSelectDef`).
   */
  equivalent_proposition_id: string;
  /**
   * The equivalent proposition's REPRESENTATIVE declaration (D26/D27) — the real
   * published theorem/decl chosen to FACE Q, resolved by the user-independent
   * global rule (earliest-published by anyone), so the row's "⇔ …" affordance
   * shows a name like every other social section (held rows, supports, adoption)
   * instead of a raw id. `name` is the FQ `axiom_defs.name` (the leaf is the
   * label); `def_id` is the `?def=` pivot target (clicked via `onSelectDef`);
   * `source` (`theorem` | `user_theorem`) is carried for shape-parity with the
   * held-row representative. `def_id`/`name` are EMPTY STRINGS when Q has no
   * published concluding certificate — the affordance then degrades to the bare
   * proposition id (`onSelectProp`). OPTIONAL / nullable on the wire: the backend
   * may omit it entirely (a nil field) for an unresolved equivalent, so consumers
   * MUST guard for its absence before reading `def_id`/`name` (an unguarded read
   * crashed the panel).
   */
  representative?: { def_id: string; name: string; source: string } | null;
  /**
   * The equivalent proposition Q's STATEMENT — the SAME `TokenTreePair` shape as
   * `PropData.p` (`author` is null in the common case; `empty` is the delab tree
   * the renderer paints). This is the row's PRIMARY FACE: the section renders
   * `equivalent_phrasing.empty` via `TokenTreeView`, prefixed with a "≡ " marker,
   * as the prominent headline — the whole headline opens Q's proposition panel
   * (`onSelectProp(equivalent_proposition_id)`). Faces Q by its STATEMENT because
   * a proposition has no name. OPTIONAL / nullable on the wire: the backend may
   * omit it (a nil field on a stale pre-amendment response), so consumers MUST
   * guard before reading `.empty`/`.author` — the headline then degrades to the
   * `representative` name, then to the bare `equivalent_proposition_id` (an
   * unguarded read crashed the panel on a partial air/next-rebuild response).
   */
  equivalent_phrasing?: TokenTreePair | null;
}

/**
 * The `proposition` payload of `data/prop/<id>.json` — the PropositionPanel's
 * primary data source. Mirrors `user-profile-page.md`.
 */
export interface PropData {
  proposition_id: string;
  adoptable?: boolean;
  endcap_eligible?: boolean;
  settled?: boolean;
  acknowledgements?: { acknowledged_undecided: number };
  /**
   * Representative phrasing of the clean conclusion `p`. `author === null` in
   * the common case; Author view uses `p_author_source` when present and falls
   * back to this token tree otherwise. A null / absent phrasing degrades
   * upstream to a bare `theorem <name>` (see the held-proposition row's
   * null-guard).
   */
  p: TokenTreePair;
  /**
   * Source-backed author rendering for `p`, when the representative occurrence
   * came from a theorem DAG node with an aligned authored source range. The
   * proposition panel uses this in Author view to preserve macro/notation
   * surface syntax, falling back to `p.author ?? p.empty` when absent.
   */
  p_author_source?: {
    file_content: string;
    source_tokens: SourceToken[];
    author_byte_range: ByteRange;
  } | null;
  /**
   * The defining declaration of a listed User Axiom Prop — the panel's exits.
   * Present whenever the proposition has a listed `user_axiom_propositions` row
   * whose folded winner is toolchain-gated; `null` otherwise (including the
   * archived-toolchain population, whose `file_id` `GET /file/:id` would 404).
   * `wrapper_def_id` / `axiom_name` are null when the per-axiom wrapper did not
   * resolve, and `publisher` is null when the file's creator account is gone —
   * neither costs the `file_id` exit, and a null publisher means NO `/u/` link
   * rather than a link to "".
   */
  defined_by?: {
    wrapper_def_id: string | null;
    file_id: string;
    publisher: string | null;
    axiom_name: string | null;
  } | null;
  /** Pro — the Holding count of the proposition. */
  holders: number;
  /**
   * Con — the Holding count of the negation. `null` when no
   * `proposition_negations` row exists (the frontend omits the rejecter chip /
   * shows "—" rather than rendering a 0 that reads as "nobody rejects").
   */
  rejecters: number | null;
  /** Arguments-for, premise-sets resolved to the holder's axiom def_ids. */
  supports: PropSupport[];
  /** Pro drill-in rows (HoldingRow — imported, not redefined). */
  holder_rows: HoldingRow[];
  /** Con drill-in rows (holders of the negation). `[]` when no negation row. */
  rejecter_rows: HoldingRow[];
  /** Iff-linked propositions. */
  equivalences: PropEquivalence[];
  /**
   * The negation's `proposition_id`, or `null` when no `proposition_negations`
   * row exists (the same condition under which `rejecters` is null).
   */
  negation_proposition_id: string | null;
}
