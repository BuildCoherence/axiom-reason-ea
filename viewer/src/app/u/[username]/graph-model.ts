// Pure data shaping for the profile graph + lists.
//
// Kept free of `sigma`/`graphology` and of React so it stays server-safe and
// unit-testable; the Sigma island (profile-graph.tsx) consumes the GraphSpec
// and turns it into a graphology Graph. Encodes the decided rules:
//   - D4: graph nodes are axioms + held propositions; edges = premise→axiom.
//   - D7: held propositions are a *scoped, ranked slice* (slider); all axioms
//     always show.
//   - D12: the four ordering modes; controversy = min(holders, rejecters).
//
// MOVED from `prototype/profile/graph-model.ts` (T12) and retyped to the REAL
// wire shape: it now keys off `ProfileAxiom` / `HeldProposition` (the
// the profile payload `data/u/<name>.json` row types from `profile-body.tsx`) instead of
// the prototype's `ProtoAxiom` / `ProtoHeldTheorem`. The load-bearing rename is
// the prototype's `support.premiseAxiomIds` (camelCase, mock-only) → the wire
// `supports[].premise_axiom_ids` (snake_case); all edge / over-determination
// logic keys off that field. No behavioural change to the layout / reducers /
// fly-to — only the element types and field accessors changed.

import type { TokenTree, ViewChoice } from "@/components/lean-ui/types";

import type {
  GraphSliceItem,
  HeldProposition,
  ProfileAxiom,
  ProfileSupport,
  ProfileSupportPremise,
} from "./profile-body";

export type { GraphSliceItem };

// List ordering is FIXED (no user control): axioms in author order, held
// propositions by ENGAGEMENT (adopters + rejecters). `Ordering` survives only as
// the held-pagination fetch key — "popularity" is the backend's DEFAULT order,
// which now ranks by engagement (profile_query.go); "authored" is a vestigial
// fallback the held fetch never sends.
export type Ordering = "authored" | "popularity";

// ---- Wire-shape text extraction --------------------------------------------
//
// The prototype rows carried precomputed `label` / `searchText` strings as mock
// side-metadata; the real wire shape does not. We derive both from the wire:
//   - an axiom's label is its `local_name`;
//   - a held proposition's label is the leaf text of its conclusion `p`;
//   - the search haystack folds both display fields (names + both views of the
//     proposition text) so substring search (D10) matches either view.

/** Flatten a TokenTree to its concatenated surface text. */
export function tokenText(tree: TokenTree | null): string {
  if (tree === null) return "";
  switch (tree.node) {
    case "text":
      return tree.text;
    case "tag":
      return tokenText(tree.child);
    case "append":
      return tree.children.map(tokenText).join("");
  }
}

/**
 * A held proposition's representative-phrasing text for the given view, falling
 * back to the empty view when the author phrasing carries an absent signal
 * (`p.author === null`). Used for the graph node label and search haystack.
 */
export function propositionText(t: HeldProposition, view: ViewChoice["kind"]): string {
  // `t.p` is null when no representative phrasing resolved; the conclusion has no
  // searchable/label text in that case (the row renders as a bare `theorem <id>`).
  const tree = t.p?.[view] ?? t.p?.empty ?? null;
  return tree ? tokenText(tree) : "";
}

/** Lowercased substring haystack for an axiom — both views' names. */
function axiomHaystack(a: ProfileAxiom): string {
  return `${a.local_name} ${a.qualified_name}`.toLowerCase();
}

/** Lowercased substring haystack for a held proposition — both views' text. */
function theoremHaystack(t: HeldProposition): string {
  // Include the representative declaration's name (D26) — it labels the row, so
  // a substring search should match it too.
  return `${t.representative.name} ${propositionText(t, "author")} ${propositionText(t, "empty")}`.toLowerCase();
}

/** Engagement — the sum of adoption and rejection for a proposition. A null
 *  rejecter count (no negation row) reads as 0 (nobody rejects). This is the
 *  metric held propositions + the graph slice rank by (matching the backend). */
const engagement = (adopters: number, rejecters: number | null): number =>
  adopters + (rejecters ?? 0);

/** Axioms render in AUTHOR (publication) order — the wire's array order
 *  (`latest_user_axioms.axioms[]`); a stable copy preserves it. */
export function orderAxioms(axioms: readonly ProfileAxiom[]): ProfileAxiom[] {
  return [...axioms];
}

/** Held propositions are derived (no authored order); they rank by ENGAGEMENT
 *  (adopters + rejecters) — the same metric the backend orders the page and the
 *  graph slice by, so this client re-rank of the loaded pages stays consistent. */
export function orderTheorems(
  theorems: readonly HeldProposition[],
): HeldProposition[] {
  return [...theorems].sort(
    (a, b) =>
      engagement(b.adopters, b.rejecters) - engagement(a.adopters, a.rejecters),
  );
}

/** Whether a held proposition is over-determined (≥2 distinct premise-sets, D4).
 *  Prefers the wire's `over_determined` (the backend computes it — source of
 *  truth); falls back to the support count for forward compatibility. */
export const isOverDetermined = (t: HeldProposition): boolean =>
  t.over_determined || t.supports.length > 1;

// ---- Graph slice (the GRAPH's own ranked feed, NOT the list page) ----------
//
// The graph is fed from `held_propositions.graph_slice` (top-1000 by engagement,
// INDEPENDENT of the paginated list). A graph-slice item is now a FULL held-
// proposition row, not the old minimal node+edge datum: alongside the topology
// the graph needs (`proposition_id`, `representative`, `supports[]`,
// `axiom_premise`, `over_determined`) it also carries `p`, `adopters`,
// `rejecters`, `has_theorem_page`, and `created_at`. The extra fields exist for
// ROW-REVEAL — a graph-node click can select a holding beyond the held list's
// first 50-row page, so the whole slice is passed as `revealableHeldProps` to
// reveal that row (label, counts, links) without a cursor fetch. Node labels
// come from the leaf of the representative name (Proof Nodes) or of
// `proposition_id` (proposition nodes) — the same derivation the lean-row
// `theorem <name>` uses (lean-rows.tsx). This was widened from the old minimal
// datum — it is NOT a frozen contract.

/** Leaf segment of a dotted/qualified id — the display name for a graph node
 *  whose proposition carries no phrasing in the slice (mirrors lean-rows.tsx). */
function leafName(id: string): string {
  const idx = id.lastIndexOf(".");
  return idx >= 0 ? id.slice(idx + 1) : id;
}

function projectionLabel(p: ProfileSupportPremise): string {
  const path = p.field_path.replace(/^\./, "");
  if (path !== "") {
    const parts = path.split(".");
    return parts.slice(Math.max(0, parts.length - 2)).join(".");
  }
  return leafName(p.label || p.proposition_id);
}

/** Over-determination off a graph-slice item — prefers the wire's
 *  `over_determined`, falling back to the support count for forward-compat
 *  (same rule as `isOverDetermined` over a full held proposition). */
const sliceOverDetermined = (g: GraphSliceItem): boolean =>
  g.over_determined || g.supports.length > 1;

/** The union of the user's axioms a graph-slice item depends on (across all
 *  supports). The single load-bearing wire field: `premise_axiom_ids`. */
export function premiseAxiomIds(g: { supports: Array<{ premise_axiom_ids: string[] }> }): string[] {
  const ids = new Set<string>();
  for (const s of g.supports) for (const id of s.premise_axiom_ids) ids.add(id);
  return [...ids];
}

function supportPremises(
  support: Pick<ProfileSupport, "premise_axiom_ids" | "premises">,
  axiomById: Map<string, ProfileAxiom>,
): ProfileSupportPremise[] {
  if (support.premises && support.premises.length > 0) return support.premises;
  return support.premise_axiom_ids
    .filter((id) => axiomById.has(id))
    .map((id) => ({
      axiom_def_id: id,
      field_path: "",
      proposition_id: axiomById.get(id)?.proposition_id ?? "",
      label: axiomById.get(id)?.local_name ?? id,
    }));
}

/** The scoped slice of graph-slice items the slider exposes (D7): the first
 *  `count` of the already-ranked (top-N-by-adopters) graph slice. The backend
 *  ranks the slice; the slider scopes WITHIN it (it never re-ranks). */
export function sliceForCount(
  graphSlice: readonly GraphSliceItem[],
  count: number,
): GraphSliceItem[] {
  return graphSlice.slice(0, Math.max(0, count));
}

export function isStructuralProjectionItem(g: GraphSliceItem): boolean {
  const conclusion = g.axiom_premise;
  if (!conclusion?.field_path) return false;
  if (g.supports.length === 0) return false;
  return g.supports.every((support) => {
    const premises = support.premises ?? [];
    if (premises.length !== 1) return false;
    const premise = premises[0];
    if (premise.axiom_def_id !== conclusion.axiom_def_id) return false;
    if (premise.proposition_id === conclusion.proposition_id) return false;
    if (premise.field_path === "") return conclusion.field_path !== "";
    return conclusion.field_path.startsWith(`${premise.field_path}.`);
  });
}

export function sliceForGraphCount(
  graphSlice: readonly GraphSliceItem[],
  count: number,
  opts?: { showProjections?: boolean },
): GraphSliceItem[] {
  const limit = Math.max(0, count);
  const theoremRows = graphSlice.filter((g) => !isStructuralProjectionItem(g));
  if (opts?.showProjections !== true) return theoremRows.slice(0, limit);

  const projectionRows = graphSlice.filter(isStructuralProjectionItem);
  const selectedTheoremRows = theoremRows.slice(0, limit);
  const projectionBudget = Math.max(0, limit - selectedTheoremRows.length);
  const selected = new Set<GraphSliceItem>([
    ...selectedTheoremRows,
    ...projectionRows.slice(0, projectionBudget),
  ]);
  return graphSlice.filter((g) => selected.has(g));
}

// ---- Graph spec -------------------------------------------------------------

export interface GraphNode {
  id: string;
  /**
   * D29 adaptive-tripartite: `axiom` (id = def_id), `theorem` (a declaration-faced
   * proof node; id = the representative's def_id; opens `?def=`), `proposition`
   * (a neutral over-determined-holding node; id = proposition_id; opens `?prop=`),
   * or `projection` (a virtual user-axiom field node; opens `?prop=propositionId`).
   */
  kind: "axiom" | "proof" | "proposition" | "projection";
  label: string;
  propositionId?: string;
  parentAxiomId?: string;
  fieldPath?: string;
  /** Number of incident edges (drives node size — structural importance, D7). */
  degree: number;
  /** True on a `proposition` node (an over-determined holding); false otherwise.
   *  Drives the third (`propositionOver`) colour. */
  overDetermined: boolean;
  /**
   * Axiom-only: this axiom was a premise of the proof of False
   * (`inconsistency.proof_premise_axiom_ids`, #4). The graph gives these nodes a
   * distinct highlight ring so the premises used in the inconsistency are
   * visible in place. Such a node renders even when it is otherwise isolated at
   * the current slice (axioms always render, so the ring is never dropped).
   */
  proofPremise: boolean;
}

export interface GraphEdge {
  id: string;
  /** the SOURCE — a theorem (declaration-faced) node (D29). */
  source: string;
  /** the TARGET — an axiom node, or (over-determined only) the holding's
   *  proposition node. */
  target: string;
  /**
   * STATIC per (proof → axiom) edge: the axiom is ABSENT from at least one of
   * the theorem's premise-sets, so the theorem still holds via another argument
   * if this axiom were dropped (`!T.supports.every(s => s.includes(A))`). For a
   * non-over-determined theorem (a single premise-set) this is always false
   * (every axiom is essential). It is a theorem-relative judgement — the edge
   * reducer only surfaces it when the THEOREM end is the selected node. Not
   * selection-dependent in the data; precomputed here once.
   */
  droppable: boolean;
  viaProjection?: boolean;
  projectionId?: string;
}

export interface GraphSpec {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** How many held propositions were dropped by the slice (honest "showing N of
   *  M", D7). */
  hiddenTheoremCount: number;
}

export interface BuildGraphSpecOptions {
  totalHeldCount?: number;
  proofPremiseAxiomIds?: readonly string[];
  showProjections?: boolean;
}

/**
 * Build the graph from all axioms + the given graph-slice (the graph's OWN
 * top-N-by-adopters feed, NOT the paginated list). Edges connect each sliced
 * proposition to every axiom in the union of its supports' premise-sets. Axiom
 * nodes with no incident (sliced) proposition are still included — the graph
 * "shows all axioms" (D7) even when isolated at the current slice.
 *
 * Node ids (D29, adaptive-tripartite): an axiom node's id is its `def_id`; a
 * SINGLE-proof holding is ONE Proof Node whose id is its representative
 * declaration's `def_id` (opens `?def=`); an OVER-DETERMINED holding is a
 * proposition node (id = `proposition_id`, opens `?prop=`) plus one Proof Node
 * per premise-set (id = that set's representative `def_id`), each wired to its own
 * premise axioms AND to the proposition node. Labels are the leaf of the
 * representative name (Proof Nodes) or of the proposition_id (proposition nodes).
 *
 * `proofPremiseAxiomIds` (#4) are the user's axioms that were premises of the
 * proof of False — those axiom nodes get a distinct highlight ring (`proofPremise`),
 * and they render even if the slice left them isolated (axioms always render).
 *
 * `totalHeldCount` is the full held-set cardinality, used only for the honest
 * "showing N of M" legend; pass the graph slice's own total when the held count
 * is not separately known.
 */
export function buildGraphSpec(
  axioms: readonly ProfileAxiom[],
  graphSlice: readonly GraphSliceItem[],
  opts?: BuildGraphSpecOptions,
): GraphSpec {
  const axiomById = new Map(axioms.map((a) => [a.def_id, a]));
  const proofPremise = new Set(opts?.proofPremiseAxiomIds ?? []);
  const showProjections = opts?.showProjections === true;
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);

  // Adaptive-tripartite (D29): a SINGLE-proof holding is one declaration-faced
  // Proof Node (id = its representative def_id); an OVER-DETERMINED holding
  // splits into a neutral proposition node (id = proposition_id) + one theorem
  // node per premise-set (id = that set's representative def_id), each wired to
  // its own premise axioms AND to the proposition node, so the proposition's
  // fan-in IS the robustness picture. Held-node descriptors are collected here
  // (deduped by id) and materialised with their degree below.
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  const addEdge = (edge: GraphEdge) => {
    if (edgeIds.has(edge.id)) return;
    edgeIds.add(edge.id);
    edges.push(edge);
    bump(edge.source);
    bump(edge.target);
  };
  const heldNodes = new Map<
    string,
    {
      id: string;
      kind: "proof" | "proposition" | "projection";
      label: string;
      overDetermined: boolean;
      propositionId?: string;
      parentAxiomId?: string;
      fieldPath?: string;
    }
  >();
  const addHeld = (n: {
    id: string;
    kind: "proof" | "proposition" | "projection";
    label: string;
    overDetermined: boolean;
    propositionId?: string;
    parentAxiomId?: string;
    fieldPath?: string;
  }) => {
    if (!heldNodes.has(n.id)) heldNodes.set(n.id, n);
  };
  const addProofNode = (rep: ProfileSupport["representative"]) => {
    addHeld({
      id: rep.def_id,
      kind: "proof",
      label: leafName(rep.name),
      overDetermined: false,
    });
  };
  // Wire a Proof Node to its premise axioms. `droppable` is dormant under the
  // adaptive split (each Proof Node owns a single premise-set, so every axiom
  // is essential to THAT proof — essential-vs-droppable now reads structurally,
  // as shared vs per-proof axiom edges across a proposition's Proof Nodes, D29);
  // kept on the edge shape for the reducer.
  const projectionNodeId = (p: ProfileSupportPremise): string =>
    `projection:${p.axiom_def_id}:${p.field_path}:${p.proposition_id}`;
  const ensureProjectionNode = (premise: ProfileSupportPremise): string | null => {
    const axId = premise.axiom_def_id;
    if (!axiomById.has(axId)) return null;
    const projId = projectionNodeId(premise);
    addHeld({
      id: projId,
      kind: "projection",
      label: projectionLabel(premise),
      overDetermined: false,
      propositionId: premise.proposition_id,
      parentAxiomId: axId,
      fieldPath: premise.field_path,
    });
    return projId;
  };
  const connectProjectionToAxiom = (projectionId: string, premise: ProfileSupportPremise) => {
    addEdge({
      id: `${projectionId}__${premise.axiom_def_id}`,
      source: projectionId,
      target: premise.axiom_def_id,
      droppable: false,
      viaProjection: true,
      projectionId,
    });
  };
  const structuralProjectionParent = (
    conclusion: ProfileSupportPremise,
    support: ProfileSupport,
  ): ProfileSupportPremise | null => {
    const premises = supportPremises(support, axiomById);
    if (premises.length !== 1) return null;
    const premise = premises[0];
    if (premise.axiom_def_id !== conclusion.axiom_def_id) return null;
    if (premise.proposition_id === conclusion.proposition_id) return null;
    if (premise.field_path === "") return conclusion.field_path !== "" ? premise : null;
    return conclusion.field_path.startsWith(`${premise.field_path}.`) ? premise : null;
  };
  const addAxiomEdges = (sourceId: string, support: ProfileSupport) => {
    for (const premise of supportPremises(support, axiomById)) {
      const axId = premise.axiom_def_id;
      if (!axiomById.has(axId)) continue; // defensive
      if (premise.field_path !== "" && showProjections) {
        const projId = ensureProjectionNode(premise);
        if (projId === null) continue;
        addEdge({
          id: `${sourceId}__${projId}`,
          source: sourceId,
          target: projId,
          droppable: false,
          viaProjection: true,
          projectionId: projId,
        });
        connectProjectionToAxiom(projId, premise);
      } else {
        addEdge({
          id: `${sourceId}__${axId}`,
          source: sourceId,
          target: axId,
          droppable: false,
          viaProjection: premise.field_path !== "",
        });
      }
    }
  };

  for (const g of graphSlice) {
    if (g.axiom_premise) {
      if (g.axiom_premise.field_path !== "") {
        const projectionId = showProjections ? ensureProjectionNode(g.axiom_premise) : null;
        for (const s of g.supports) {
          const structuralParent = structuralProjectionParent(g.axiom_premise, s);
          if (structuralParent !== null) {
            if (projectionId !== null) {
              if (structuralParent.field_path === "") {
                connectProjectionToAxiom(projectionId, structuralParent);
              } else {
                const parentProjectionId = ensureProjectionNode(structuralParent);
                if (parentProjectionId !== null) {
                  addEdge({
                    id: `${projectionId}__${parentProjectionId}`,
                    source: projectionId,
                    target: parentProjectionId,
                    droppable: false,
                    viaProjection: true,
                    projectionId,
                  });
                  connectProjectionToAxiom(parentProjectionId, structuralParent);
                }
              }
            }
            continue;
          }
          const rep = sliceOverDetermined(g) ? s.representative : g.representative;
          const repId = rep.def_id;
          addProofNode(rep);
          if (projectionId !== null) {
            addEdge({
              id: `${repId}__${projectionId}`,
              source: repId,
              target: projectionId,
              droppable: false,
              viaProjection: true,
              projectionId,
            });
          }
          addAxiomEdges(repId, s);
        }
        continue;
      }
      if (axiomById.has(g.axiom_premise.axiom_def_id)) continue;
    }
    if (!sliceOverDetermined(g)) {
      // Single proof — one declaration-faced Proof Node.
      const repId = g.representative.def_id;
      addProofNode(g.representative);
      for (const s of g.supports) addAxiomEdges(repId, s);
    } else {
      // Over-determined — a neutral proposition node + a Proof Node per set.
      const propId = g.proposition_id;
      addHeld({
        id: propId,
        kind: "proposition",
        label: leafName(propId),
        overDetermined: true,
      });
      for (const s of g.supports) {
        const repId = s.representative.def_id;
        addProofNode(s.representative);
        // proof → proposition (the fan-in edge)
        addEdge({
          id: `${repId}__${propId}`,
          source: repId,
          target: propId,
          droppable: false,
        });
        addAxiomEdges(repId, s);
      }
    }
  }

  const nodes: GraphNode[] = [];
  for (const a of axioms) {
    const id = a.def_id;
    nodes.push({
      id,
      kind: "axiom",
      label: a.local_name,
      degree: degree.get(id) ?? 0,
      overDetermined: false,
      proofPremise: proofPremise.has(id),
    });
  }
  for (const n of heldNodes.values()) {
    nodes.push({
      id: n.id,
      kind: n.kind,
      label: n.label,
      propositionId: n.propositionId,
      parentAxiomId: n.parentAxiomId,
      fieldPath: n.fieldPath,
      degree: degree.get(n.id) ?? 0,
      overDetermined: n.overDetermined,
      proofPremise: false,
    });
  }

  const totalHeld = opts?.totalHeldCount ?? graphSlice.length;
  const visibleTheoremRows = graphSlice.filter((g) => !isStructuralProjectionItem(g)).length;
  return {
    nodes,
    edges,
    hiddenTheoremCount: Math.max(0, totalHeld - visibleTheoremRows),
  };
}

// Substring search over BOTH views' display fields (D10) — `q` is the
// precomputed lowercased query.
export const matchesAxiom = (a: ProfileAxiom, q: string): boolean =>
  !q || axiomHaystack(a).includes(q);

export const matchesTheorem = (t: HeldProposition, q: string): boolean =>
  !q || theoremHaystack(t).includes(q);
