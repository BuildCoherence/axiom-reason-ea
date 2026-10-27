// Pure classifiers for a declaration's generated `members` (see the side
// panel's Fields / Constructors sections in `side-panel.tsx`).
//
// Factored out of `side-panel.tsx` (a `"use client"` module that pulls React
// + the CSS-Module import chain) so the unit suite can pin the branch table
// WITHOUT standing up React / a browser / CSS-Module resolution — the same
// split `notation-names.ts` and `equivalence-grouping.ts` use. `side-panel.tsx`
// imports these to drive its Fields / Constructors render.
//
// Framework-free: imports only the `DeclarationMember` TYPE (erased at compile
// time), so a plain `node --import tsx --test` run can import it.

import type { DeclarationMember } from "./types";

// A generated member the panel surfaces in the Constructors section — an
// inductive's constructor. Keys off the raw `kind` only (NOT `display_kind`):
// the Constructors section lists literal constructor members.
export function isConstructorMember(member: DeclarationMember): boolean {
  return member.kind === "constructor";
}

// A generated member the panel surfaces in the Fields section — a displayable
// projection-like field, as opposed to the compiler-generated helpers
// (`rec`, `recOn`, `casesOn`, `noConfusion`, …) that share the decl's authored
// source span but are noise in the panel. Prefers the wire `display_kind`
// (new API) over the raw `kind` (old shape): `display_kind === "field"` is
// displayable outright, constructors / recursors are not, and the remaining
// members are filtered by a denylist of generated-helper names.
export function isDisplayableField(member: DeclarationMember): boolean {
  const displayKind = member.display_kind ?? member.kind;
  if (displayKind === "constructor" || displayKind === "recursor") return false;
  if (displayKind === "field") return true;
  const name = member.local_name;
  if (
    name === "rec" ||
    name === "recOn" ||
    name === "casesOn" ||
    name === "noConfusion" ||
    name === "noConfusionType" ||
    name === "injEq" ||
    name === "_flat_ctor"
  ) {
    return false;
  }
  return true;
}
