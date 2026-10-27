// Pure grouping / naming / covered-split logic behind the proposition panel's
// **Equivalences** and **Proofs** sections (see `proposition-sections.tsx`).
//
// The SINGLE SOURCE of this section's data transformation. The client component
// (`proposition-sections.tsx`, a `"use client"` module that transitively pulls
// React + CSS modules + the Shiki/HoldingBar UI) imports these helpers to drive
// its render; the unit suite imports them to assert the grouping, witness
// ordering, covered/uncovered split predicate, and headline fallback chain
// WITHOUT standing up React / a browser / CSS modules.
//
// This module is intentionally framework-free — it imports only TYPES from
// `./types` (erased at compile time) — so a plain `node --test` / `tsx` run can
// import it (mirroring `ce-file-decorations.ts`, the file page's
// dependency-free decoration builder).

import type { PropEquivalence, TokenTree } from "./types";

// Leaf component of a fully-qualified `axiom_defs.name` — the bare local name a
// row shows (the FQ form is `<file_id>.<localname>`). Mirrors `leafName` in the
// profile lists' `lean-rows.tsx`.
export function leafName(qualifiedName: string): string {
  const idx = qualifiedName.lastIndexOf(".");
  return idx >= 0 ? qualifiedName.slice(idx + 1) : qualifiedName;
}

// Surface label for a proof / witness theorem name. `activeFileId` is the file
// the inspected DECLARATION lives in (a def panel): the row shows the bare leaf
// when the cert is in that SAME file, but the FULLY-QUALIFIED `<file_id>.<leaf>`
// when it's from a DIFFERENT file (disambiguation). On a proposition panel there
// is no active file (`activeFileId` null/absent) → ALWAYS fully qualified.
export function supportDisplayName(
  fqName: string,
  activeFileId?: string | null,
): string {
  if (!activeFileId) return fqName;
  const dot = fqName.indexOf(".");
  const certFileId = dot >= 0 ? fqName.slice(0, dot) : null;
  return certFileId !== null && certFileId !== activeFileId
    ? fqName
    : leafName(fqName);
}

// Premise-count label — "1 premise" / "N premises". The SAME phrasing a Proofs
// row uses, so a witness's premise count reads identically whether it faces a
// proof or an equivalence.
export function premiseLabel(count: number): string {
  return count === 1 ? "1 premise" : `${count} premises`;
}

// The covered/uncovered split predicate, shared by BOTH sections: a premise-set
// is COVERED iff every premise PROPOSITION id is held by the profile user
// (`premiseAxiomIds ⊆ coveredPropositionIds`). `premiseAxiomIds` may be absent on
// a stale response → treat as `[]`, so `[].every === true` ⇒ a premise-free
// support/witness is covered for everyone. The covered SET is never null here —
// the section gates the split on a non-null set upstream; an EMPTY set covers
// nothing but the premise-free case.
export function premisesCovered(
  premiseAxiomIds: string[] | undefined | null,
  coveredPropositionIds: ReadonlySet<string>,
): boolean {
  return (premiseAxiomIds ?? []).every((p) => coveredPropositionIds.has(p));
}

// Is a witness COVERED by the profile user's held axiom-propositions? Thin
// PropEquivalence wrapper over `premisesCovered` (the Proofs section applies the
// same predicate to `PropSupport.premise_axiom_ids`).
export function witnessCovered(
  e: PropEquivalence,
  coveredPropositionIds: ReadonlySet<string>,
): boolean {
  return premisesCovered(e.premise_axiom_ids, coveredPropositionIds);
}

// Empty-state copy for a proposition the profile user HOLDS BY MEMBERSHIP — the
// proposition is itself in their coverage set (one of their axioms, or a
// projection of one), so it needs no derived proof. Shared by the def panel's
// plain Proofs list and the proposition panel's covered split, so the two
// surfaces read identically and cannot drift apart. "Held directly", NOT "held
// by membership": the GLOSSARY reserves "Membership" for the paid Beta tier
// (GLOSSARY.md § Beta Tier) and the substrate term would read as a tier perk;
// "as an axiom" is also wrong for the projection-closure leg (a field of a
// structured axiom is held directly without being a listed axiom itself).
export const HELD_DIRECTLY_EMPTY = "Held directly — no derived proof.";

// Empty-state copy for the covered "Proofs from @user's axioms" group. When the
// inspected proposition is itself held by membership (`propositionId` in the
// user's coverage set), it is held without a derived proof — so the copy must say
// so, RECONCILING with the Adoption section (which counts the user as a holder of
// exactly that proposition). Otherwise the covered set is genuinely empty: the
// user holds none of the premises of any proof of it, so there is no proof from
// their axioms yet. The predicate is the SAME coverage set the split itself uses.
export function coveredProofsEmptyText(
  propositionId: string | null | undefined,
  coveredPropositionIds: ReadonlySet<string>,
): string {
  return propositionId != null && coveredPropositionIds.has(propositionId)
    ? HELD_DIRECTLY_EMPTY
    : "No proof from these axioms yet.";
}

// Deterministic witness ordering WITHIN a group → picks the primary face. Prefer
// a COVERED witness (only when a covered set is supplied — the profile context),
// then fewest `premise_count` (the simplest equivalence), then lexicographically
// smallest `def_id` (a stable, content-independent final tiebreak). All new
// fields are guarded (`?? 0`) so a stale element never NaN-sorts.
export function compareWitnesses(
  a: PropEquivalence,
  b: PropEquivalence,
  coveredPropositionIds: ReadonlySet<string> | null,
): number {
  if (coveredPropositionIds !== null) {
    const ac = witnessCovered(a, coveredPropositionIds) ? 0 : 1;
    const bc = witnessCovered(b, coveredPropositionIds) ? 0 : 1;
    if (ac !== bc) return ac - bc;
  }
  const ap = a.premise_count ?? 0;
  const bp = b.premise_count ?? 0;
  if (ap !== bp) return ap - bp;
  return a.def_id < b.def_id ? -1 : a.def_id > b.def_id ? 1 : 0;
}

// One logical equivalence — all the Iff witnesses proving the SAME `P ↔ Q`,
// grouped by the partner proposition `propId` (the section collapses distinct
// `equivalences[]` elements that share an `equivalent_proposition_id`). `primary`
// is the chosen face (covered-first, then fewest premises, then smallest def_id);
// `others` are the extra witnesses (the "other proofs of this equivalence"
// disclosure); `covered` is true iff ≥1 witness is covered by the profile user's
// axioms — the across-group split key.
export interface EquivalenceGroup {
  propId: string;
  primary: PropEquivalence;
  others: PropEquivalence[];
  covered: boolean;
}

// Group the flat `equivalences[]` into one EquivalenceGroup per partner
// proposition. Witnesses are de-duplicated by `def_id` within a group (duplicate
// seed certs collide on React keys otherwise) and sorted by `compareWitnesses` so
// `[0]` is the primary face. Group order follows first-seen partner-prop order in
// the wire array — deterministic given the input.
export function buildEquivalenceGroups(
  equivalences: PropEquivalence[],
  coveredPropositionIds: ReadonlySet<string> | null,
): EquivalenceGroup[] {
  const byProp = new Map<string, Map<string, PropEquivalence>>();
  for (const e of equivalences) {
    let inner = byProp.get(e.equivalent_proposition_id);
    if (inner === undefined) {
      inner = new Map<string, PropEquivalence>();
      byProp.set(e.equivalent_proposition_id, inner);
    }
    if (!inner.has(e.def_id)) inner.set(e.def_id, e);
  }
  return Array.from(byProp.entries()).map(([propId, inner]) => {
    const witnesses = Array.from(inner.values()).sort((a, b) =>
      compareWitnesses(a, b, coveredPropositionIds),
    );
    const covered =
      coveredPropositionIds !== null &&
      witnesses.some((w) => witnessCovered(w, coveredPropositionIds));
    return { propId, primary: witnesses[0], others: witnesses.slice(1), covered };
  });
}

// The equivalence-row HEADLINE face, selected by fallback chain (the equivalent
// proposition Q has no name — only an id + statement):
//   1. `statement` — Q's STATEMENT (`equivalent_phrasing.empty`). OPTIONAL /
//      nullable on the wire; guarded before reading `.empty`.
//   2. `representative` — the REPRESENTATIVE declaration's name (rendered as a
//      `theorem <name>` token tree). Only when BOTH its `def_id` AND `name` are
//      non-empty; `representative` is itself optional, so read THROUGH it.
//   3. `id` — the bare `equivalent_proposition_id` (mono), last resort.
// A discriminated union so the row can switch on `kind` and render each face
// (the whole headline still opens Q's proposition panel regardless of face).
export type EquivalenceHeadline =
  | { kind: "statement"; statement: TokenTree }
  | { kind: "representative"; defId: string; name: string }
  | { kind: "id"; propId: string };

export function equivalenceHeadline(group: EquivalenceGroup): EquivalenceHeadline {
  const primary = group.primary;
  const statementTree = primary.equivalent_phrasing?.empty ?? null;
  if (statementTree !== null) {
    return { kind: "statement", statement: statementTree };
  }
  const rep = primary.representative;
  const repDefId = rep?.def_id ?? "";
  const repName = rep?.name ?? "";
  if (repDefId !== "" && repName !== "") {
    return { kind: "representative", defId: repDefId, name: repName };
  }
  return { kind: "id", propId: group.propId };
}
