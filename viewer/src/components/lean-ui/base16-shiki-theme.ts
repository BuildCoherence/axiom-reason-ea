import type { ThemeRegistrationRaw } from "shiki";

// Base16 → TextMate-scope theme for Shiki, with every colour expressed as a
// reference to the site's live Base16 CSS custom properties (`--base00`…
// `--base0F`, set per `[data-theme][data-mode]` in globals.css).
//
// Shiki emits a theme's colours verbatim into the inline `style` attributes of
// the tokens it renders, so `var(--base0E)` lands in the HTML as
// `style="color:var(--base0E)"`. The browser resolves it at paint against
// whatever `data-mode` (and future palette) the no-flash pre-paint script has
// already stamped on `<html>`. The upshot: highlighting tracks light/dark and
// any palette swap automatically, with a SINGLE theme — no dual-theme markup,
// no per-mode `!important` swap rule, and no theme flash on first paint.
//
// Scope → slot assignments follow the canonical base16 textmate template
// (https://github.com/chriskempson/base16-textmate): base03 comments, base05
// default foreground, base08 variables/tags, base09 constants/numbers, base0A
// types/classes, base0B strings, base0C escapes & support constants, base0D
// functions, base0E keywords/storage. base01 is the editor surface (one step
// off the page background `--base00`, so the block reads as a distinct surface).
//
// EVERY scope the panel ALSO classifies (keyword / op / literal / string /
// comment / identifier / type) routes through the SHARED `--ce-token-<slot>`
// layer (token-colors.css), not directly through `--base0X`. The body and the
// side panel's `TokenTreeView` consume the same `--ce-token-*` vocabulary, so
// the two paths cannot drift — change a slot's palette mapping in
// token-colors.css once and both surfaces follow. The body additionally relies
// on a data-attribute override in `token-colors.css` that takes precedence over
// Shiki's inline color when a span carries `data-kind` (plus `data-binder-role`
// for identifier sub-styling) from the authoritative `source_tokens` data — so
// the source-tokens classification, not whatever TextMate scope Shiki guessed,
// drives token color in the body. Scopes the panel does NOT classify (escape
// chars, invalid) keep their direct `--base0X` mappings — there is no `kind`
// equivalent for them, so there's nothing to drift WITH. See the "Single
// shared syntax-color source" decision in
// the internal lean-ui-component doc (issue #756).
//
// KNOWN LIMITS — what the body's `data-kind` data-attribute OVERRIDES (in
// token-colors.css) currently cover vs. what still falls through to Shiki's
// TextMate-scope guess. Read together with the override rules at the bottom
// of token-colors.css:
//
//   * Classified by the source-token pipeline today:
//     - `kind: "string"` is emitted by the validator's `kindOf` for
//       `.lit (.strVal _)` heads, so `[data-kind="string"]` body spans
//       authoritatively paint through `--ce-token-string`.
//     - `kind: "stdlib"` is set by the API resolver post-publish for
//       unresolved qualified-name identifier tokens, so
//       `[data-kind="stdlib"]` body spans authoritatively paint through
//       `--ce-token-stdlib` (and the renderer mounts the IdentifierSpan
//       so hover/focus popover still wires up).
//
//   * NOT classified — these scopes still rely on Shiki's TextMate guess,
//     so a different scope or a guess miss leaves the body painted by
//     whatever Shiki picked. The `[data-kind="op"]` override rule in
//     token-colors.css is dormant today; we keep it for forward
//     compatibility with a future `kindOf` arm.
//     - OPERATORS (`→`, `∀`, `=`, `+`, …) — the validator's `kindOf`
//       filter at SourceTokens.lean elides `op`-kind source tokens
//       (`tokStx? = none`), so no body span carries `data-kind="op"` today.
//       Coloring comes from Shiki's `keyword.operator.*` / fallback scopes.
//     - TYPE NAMES (`Nat`, `Prop`, `Type`, user-introduced types) —
//       `kindOf` returns `"identifier"` for `.const _ _` heads regardless
//       of whether the constant's type is `Sort _`; the body's Shiki
//       theme paints `entity.name.type` family scopes via
//       `--ce-token-type`, but the panel resolves them as plain identifier
//       (no Sort-valued classification). Closing this gap depends on the
//       deferred `MetaM`-capable `kindOf` that can inspect the head
//       constant's type at extraction time — see
//       LeanValidator/Extract/Tokens.lean § `kindOf`.
export const base16ShikiTheme = {
  name: "axiom-base16",
  type: "dark",
  colors: {
    "editor.background": "var(--base01)",
    "editor.foreground": "var(--base05)",
  },
  settings: [
    { settings: { background: "var(--base01)", foreground: "var(--base05)" } },
    {
      // Routed through the shared layer's `--ce-token-comment` slot (aliases
      // base03) so the panel's `kindComment` class and the body's comment
      // spans resolve to the same source of truth.
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "var(--ce-token-comment)" },
    },
    {
      // Routed through the shared layer's `--ce-token-string` slot (aliases
      // base0B) so the panel's `kindString` class and the body's string
      // spans resolve to the same source of truth.
      scope: [
        "string",
        "punctuation.definition.string",
        "constant.character",
        "string.regexp",
      ],
      settings: { foreground: "var(--ce-token-string)" },
    },
    {
      // Routed through the shared layer's `--ce-token-literal` slot (aliases
      // base09) so the panel's `kindLiteral` class and the body's numeric /
      // language-constant spans resolve to the same source of truth.
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.other",
        "keyword.other.unit",
      ],
      settings: { foreground: "var(--ce-token-literal)" },
    },
    {
      // Routed through the shared layer's `--ce-token-keyword` slot (aliases
      // base0E) so the panel's `kindKeyword` class and the body's keyword /
      // storage spans resolve to the same source of truth.
      scope: ["keyword", "storage", "storage.type", "storage.modifier"],
      settings: { foreground: "var(--ce-token-keyword)" },
    },
    {
      // Identifier-shaped: function / decl-name (Shiki's prior mapping to
      // base0D matches the shared layer's `--ce-token-binder-defsite` slot).
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call",
        "variable.function",
      ],
      settings: { foreground: "var(--ce-token-binder-defsite)" },
    },
    {
      // Identifier-shaped: type / class / namespace name. Routed through the
      // shared layer's `--ce-token-type` slot (aliases base0A) so a future
      // type-aware source-token vocabulary can drive type-name color via the
      // data-attribute override without a base16-shiki-theme.ts edit.
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.namespace",
        "support.type",
        "support.class",
        "entity.other.inherited-class",
      ],
      settings: { foreground: "var(--ce-token-type)" },
    },
    {
      // Identifier-shaped: plain variable / parameter / tag. Routes through
      // the shared layer's `--ce-token-identifier` slot (aliases base08). The
      // data-attribute override in token-colors.css promotes spans carrying
      // a binder_role to `--ce-token-binder-defsite` / `--ce-token-binder-usesite`
      // at paint time, so source-token-decorated identifiers paint from the
      // authoritative classification regardless of Shiki's scope assignment.
      scope: [
        "variable",
        "variable.other",
        "variable.parameter",
        "entity.name.tag",
      ],
      settings: { foreground: "var(--ce-token-identifier)" },
    },
    {
      scope: [
        "support.constant",
        "constant.other.symbol",
        "constant.character.escape",
      ],
      settings: { foreground: "var(--base0C)" },
    },
    {
      scope: ["invalid", "invalid.deprecated"],
      settings: { foreground: "var(--base0F)" },
    },
  ],
} satisfies ThemeRegistrationRaw;
