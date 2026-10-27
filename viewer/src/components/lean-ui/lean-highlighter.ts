import type { Root } from "hast";
import type { DecorationItem, LanguageRegistration } from "shiki";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

import { base16ShikiTheme } from "./base16-shiki-theme";

// The Lean Shiki pipeline shared by the prerendered file body (lean-code.tsx)
// and the client-side slice renderer (shiki-slice.tsx), so both surfaces use
// one patched grammar, one theme and one line transformer.

// Shiki's bundled grammar id for Lean 4 (tm-grammars `lean.json`). This is the
// only language we load — keeping the singleton's grammar set to exactly what
// the file page renders avoids loading the full bundled-language set. We load a
// PATCHED copy of this grammar (see patchedLeanGrammar below), not the bare id.
export const LEAN_LANG = "lean";

// ----------------------------------------------------------------------------
// `--` line-comment fix.
//
// tm-grammars' `lean` grammar (shiki 4.x) defines its `--` line-comment rule
// (`#dashComment`) with a SINGLE sub-pattern: `{ include: "source.lean4.markdown" }`.
// That embedded Markdown grammar is not loaded here, so vscode-textmate prunes
// the whole rule during compilation — and `--` comment lines fall through to
// the code patterns, rendering identifiers/numbers inside the comment with code
// colours instead of the muted comment colour. (The `/- -/` block and `/-- -/`
// doc-comment rules survive the same missing embed only because they ALSO carry
// a resolvable local `#blockComment` include.)
//
// Root-cause fix: strip the `source.lean4.markdown` embed from every comment
// rule. The `--` rule then survives compilation and matches, and all comment
// bodies render as one uniform comment token (no Markdown re-colouring of
// backticks/numbers inside a comment — the right call for a source-display
// surface). Verified via `codeToTokens(..., { includeExplanation: true })`:
// `--`, `/- -/`, `/-- -/`, and `/-! -/` all gain their `comment.*` scope.
const COMMENT_RULE_KEYS = [
  "dashComment",
  "docComment",
  "modDocComment",
  "blockComment",
] as const;

async function patchedLeanGrammar(): Promise<LanguageRegistration[]> {
  // The fine-grained `shiki/langs/lean.mjs` import keeps every other bundled
  // language out of the client build. structuredClone drops the bundled
  // grammar's Object.freeze so we can mutate the comment rules.
  const mod = await import("shiki/langs/lean.mjs");
  const grammars = structuredClone(mod.default) as LanguageRegistration[];
  for (const grammar of grammars) {
    // The bundled grammar's rule types are deeply `readonly`; structuredClone
    // already handed us a fresh mutable copy, so edit it through a mutable view.
    const repository = grammar.repository as
      | Record<string, { patterns?: { include?: string }[] } | undefined>
      | undefined;
    if (!repository) continue;
    for (const key of COMMENT_RULE_KEYS) {
      const rule = repository[key];
      if (rule?.patterns) {
        rule.patterns = rule.patterns.filter(
          (p) => p.include !== "source.lean4.markdown",
        );
      }
    }
  }
  return grammars;
}

// Process-wide singleton. createHighlighter loads the WASM oniguruma
// engine, the Lean grammar, and the Base16 theme once per server
// process; request-time renders reuse it rather than re-initializing.
// The promise is created lazily on first render, so importing this
// module has no startup cost for routes that never render Lean.
//
// WHY globalThis (not a bare module-scope `let`). Next.js dev mode
// re-evaluates module files on every HMR reload, which resets a bare
// module-level binding to its initial `null` and causes Shiki to call
// `createHighlighter` again per reload. Shiki's primitive layer
// counts highlighter instances process-wide and emits `[Shiki] N
// instances have been created. Shiki is supposed to be used as a
// singleton...` when N hits a multiple of 10
// (@shikijs/primitive/dist/index.mjs). Pinning the promise on
// `globalThis` (the same well-trodden pattern Next.js uses for the
// Prisma client and other HMR-sensitive singletons) survives module
// reloads because `globalThis` is owned by the runtime, not the
// module — every reloaded module copy reads the SAME slot. In
// production this is equivalent to the bare `let`; in dev it
// silences the warning and keeps cold-load timings stable.
const HIGHLIGHTER_GLOBAL_KEY = "__axiomLeanShikiHighlighterPromise" as const;
type HighlighterGlobal = typeof globalThis & {
  [HIGHLIGHTER_GLOBAL_KEY]?: Promise<HighlighterCore>;
};

export function getLeanHighlighter(): Promise<HighlighterCore> {
  const g = globalThis as HighlighterGlobal;
  let pending = g[HIGHLIGHTER_GLOBAL_KEY];
  if (pending === undefined) {
    pending = patchedLeanGrammar()
      .then((langs) =>
        createHighlighterCore({
          themes: [base16ShikiTheme],
          langs,
          engine: createOnigurumaEngine(import("shiki/wasm")),
        }),
      )
      // Self-heal: if the WASM init / grammar load fails (offline, blocked
      // CDN, etc.) clear the cached rejected promise so the NEXT caller
      // starts fresh. Without this, the singleton would pin the failure
      // for the lifetime of the page and every subsequent identifier-click
      // / highlight call would re-await the same dead promise.
      .catch((e) => {
        delete (globalThis as HighlighterGlobal)[HIGHLIGHTER_GLOBAL_KEY];
        throw e;
      });
    g[HIGHLIGHTER_GLOBAL_KEY] = pending;
  }
  return pending;
}

// UTF-8 byte length of a single codepoint (passed as a 1- or 2-UTF-16-unit
// string). Standard UTF-8 width buckets keyed on the codepoint value.
function utf8ByteLength(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

/**
 * Precompute a byte-offset → char-offset map for `source` in a single pass.
 * Returns a function that resolves any byte offset to its char offset; byte
 * offsets that land in the middle of a multi-byte codepoint (should not
 * happen for well-formed token ranges) resolve to the char index of the
 * codepoint that contains them. Out-of-range offsets clamp to the source
 * length. Used by the file page to convert all `source_tokens` cheaply.
 */
export function buildByteToCharMap(
  source: string,
): (byteOffset: number) => number {
  // For each char index, the cumulative byte offset BEFORE that char. The
  // last entry is the total byte length, so a token's `byte_end` maps to
  // the source length when it equals the total.
  const byteAtChar: number[] = [];
  let bytes = 0;
  let charIndex = 0;
  for (const ch of source) {
    const width = ch.length; // 1 or 2 UTF-16 units
    for (let i = 0; i < width; i += 1) {
      byteAtChar.push(bytes);
    }
    bytes += utf8ByteLength(ch);
    charIndex += width;
  }
  // Sentinel: char index === source.length maps to total bytes.
  byteAtChar.push(bytes);
  const totalChars = charIndex;
  const totalBytes = bytes;

  return (byteOffset: number): number => {
    if (byteOffset <= 0) return 0;
    if (byteOffset >= totalBytes) return totalChars;
    // Binary search for the first char index whose cumulative byte offset
    // is >= byteOffset. byteAtChar is non-decreasing.
    let lo = 0;
    let hi = byteAtChar.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byteAtChar[mid] < byteOffset) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  };
}

// Shared Shiki transformer: tag each line so the CSS counter gutter can number
// them. A transformer is the Shiki-idiomatic place to do this (vs. a regex on
// the output string); it runs per-line during tokenization. Shared between the
// string (`highlightSource`) and hast (`highlightSourceToHast`) pipelines so
// both emit identical `data-line` markup.
export const dataLineTransformer = {
  line(node: { properties: Record<string, unknown> }) {
    node.properties["data-line"] = "";
  },
};


/** Highlight `source` as Lean and return the hast tree; uncached. */
export async function highlightLeanToHast(
  source: string,
  decorations: DecorationItem[] = [],
): Promise<Root> {
  const highlighter = await getLeanHighlighter();
  return highlighter.codeToHast(source, {
    lang: LEAN_LANG,
    theme: base16ShikiTheme.name,
    ...(decorations.length > 0 ? { decorations } : {}),
    transformers: [dataLineTransformer],
  });
}
