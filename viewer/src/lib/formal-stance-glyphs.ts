export const FORMAL_STANCE_GLYPHS = {
  adopt: "⊤",
  reject: "⊥",
  follows: "⊢",
  negation: "¬",
} as const;

export const DERIVED_REJECTION_GLYPH =
  FORMAL_STANCE_GLYPHS.follows + FORMAL_STANCE_GLYPHS.negation;
