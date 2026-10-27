// Per-kind class-identifier table for the structured-token-tree renderer.
//
// Factored out of `token-tree.tsx` so the unit suite can verify the SHAPE of
// the mapping (every `TokenTag["kind"]` has a non-empty `kind*` entry) without
// pulling the CSS-Module import chain. The values are the IDENTIFIER NAMES
// in `token-tree.module.css` (`kindIdentifier`, `kindOp`, …, `kindStdlib`);
// `token-tree.tsx` resolves them against the imported `styles` record at
// module-load.
//
// Keeping the union-keyed `Record<TokenTag["kind"], string>` type forces a
// compile error if a future widening of `TokenTag["kind"]` lands without
// updating this table. The runtime test in
// `test/unit/token-tree-kind-class.spec.ts` adds a value-level check that
// every entry is a non-empty `kind*`-prefixed string — catching the
// `undefined as unknown as string` pattern the review describes.

import type { TokenTag } from "./types";

export const KIND_CLASS_KEY: Record<TokenTag["kind"], string> = {
  identifier: "kindIdentifier",
  keyword: "kindKeyword",
  op: "kindOp",
  literal: "kindLiteral",
  string: "kindString",
  comment: "kindComment",
  whitespace: "kindWhitespace",
  // `stdlib` (set by the API resolver, not the validator, when an identifier
  // reference does not resolve to an in-CE def_id) gets a dedicated
  // `.kindStdlib` rule that resolves to `--ce-token-stdlib` directly. The
  // older `.stdlib` JS-side class branch in `token-tree.tsx`
  // (`def_id === null && qualified_name !== null`) still applies the muted
  // colour + `cursor: default` for legacy `kind: "identifier"` tags that were
  // never rewritten by the resolver, and the file-body's
  // `[data-kind="stdlib"]` override rule in `token-colors.css` covers the
  // body. All three code paths converge on `--ce-token-stdlib`.
  stdlib: "kindStdlib",
  // `type` — Sort-valued identifier heads (emission-completion amendment).
  // Routes through `--ce-token-type`, the slot token-colors.css reserved for
  // exactly this classification (the #756 body↔panel invariant).
  type: "kindType",
};
