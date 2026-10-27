import "server-only";

import type { Root } from "hast";
import type { DecorationItem } from "shiki";

import { base16ShikiTheme } from "./base16-shiki-theme";
import styles from "./lean-code.module.css";
import {
  dataLineTransformer,
  getLeanHighlighter,
  highlightLeanToHast,
  LEAN_LANG,
} from "./lean-highlighter";

export { buildByteToCharMap } from "./lean-highlighter";

// Reusable Lean source renderer — the "source-view boundary" the
// Lean UI Component design names as
// the seam the future per-declaration token-overlay renderer replaces/extends.
//
// This slice (per the file-page spec § Body) renders the file's source bytes
// verbatim with Shiki Lean syntax highlighting and a line-number gutter. It is
// a Server Component: highlighting runs once on the server, the page ships zero
// client JS for code rendering. The interactive depth from the design
// (clickable identifiers, hover popovers) depends on the unbuilt structured-
// token backend and is deliberately absent here — not stubbed.
//
// THEMING APPROACH — a single Base16 theme keyed on the site's CSS variables.
// ----------------------------------------------------------------------------
// `base16ShikiTheme` (see base16-shiki-theme.ts) maps TextMate scopes onto the
// site's Base16 slots expressed as `var(--base0X)`. Shiki emits those var()
// references verbatim into each token's inline `style`, so the browser resolves
// them at paint against whatever `data-mode` (and future palette) the no-flash
// pre-paint script has already stamped on <html>. The highlighting therefore
// tracks light/dark — and any palette swap — automatically, with ONE theme: no
// dual-theme markup, no per-mode `!important` swap rule in globals.css, and no
// theme flash on first server-rendered paint.
//
// CSP — Shiki emits only inline `style="..."` attributes (allowed by the
// existing `style-src 'self' 'unsafe-inline'` in src/middleware.ts) and NO
// inline <script>. We inject the markup via dangerouslySetInnerHTML below; see
// the comment at the injection site for why this is not an XSS vector.

// Cross-request hast cache for `highlightSourceToHast`.
// ----------------------------------------------------------------------------
// Shiki tokenization (oniguruma WASM, split at every decoration offset) is the
// dominant cost of rendering a large file, and it is PURE: the output depends
// only on (source, decorations, lang). The theme is a single fixed Base16 theme
// whose token colours are `var(--base0X)` references resolved at paint, so the
// hast never varies by light/dark mode — a content+decorations key is theme-
// stable. Without a cache, every cold load or refresh of the same file re-runs
// the whole-file WASM pass from scratch. We memoize the resolved hast in a
// bounded, process-lifetime LRU so repeat views of an unchanged file skip it.
//
// Deliberately a plain module-level Map, NOT `unstable_cache` / `'use cache'`:
// those serialize their values through the framework Data Cache (wrong for a
// large in-memory hast tree) and are at odds with the file route's
// `force-dynamic` posture. A module singleton mirrors the `highlighterPromise`
// idiom above — it persists across requests for the life of the server process
// (per instance; a miss on another instance simply recomputes, never wrong).
// The cached tree is treated as immutable — `renderHast` only reads it.
//
// Only the hast pipeline (`highlightSourceToHast`, the file BODY) is cached.
// Its sibling `highlightSource` (`codeToHtml`, used by `LeanCode`) is left
// uncached on purpose: its sole caller is not a per-request hot path on a
// large file, so it doesn't pay the cold-load cost this cache targets.
//
// The cap is by ENTRY COUNT, not bytes. Each entry is a whole-file hast tree
// held for the process lifetime, so 64 large files is the rough memory budget
// (a count proxy for a working set, not a measured byte bound) — bump it down
// if heap pressure on large files becomes a concern.
const HAST_CACHE_MAX = 64; // recently-viewed files; see byte-budget note above
const hastCache = new Map<string, Root>();
// Single-flight: dedupe concurrent identical highlights so a burst of requests
// for the same file (before the first resolves) runs Shiki once, not N times.
const hastInflight = new Map<string, Promise<Root>>();

// Fast non-crypto hash (32-bit FNV-1a via Math.imul) for the cache key. Cache
// keys are not a security boundary; they only need good distribution + speed
// over large source strings — `Math.imul` keeps the per-codepoint step in
// 32-bit integer math (no per-char BigInt allocation), so the key is cheap even
// on the hit path. 32-bit width is safe here: the cache holds at most
// HAST_CACHE_MAX (64) entries, where collision odds are negligible, and the key
// is additionally prefixed with cheap exact discriminators (lang + the two
// input lengths) so a hash collision still cannot serve the wrong file's hast.
function fnv1a32(s: string): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // * FNV prime, wraps to 32 bits via imul
  }
  return (h >>> 0).toString(36); // coerce to unsigned before stringifying
}

function hastCacheKey(
  source: string,
  lang: string,
  decorations: DecorationItem[],
): string {
  const decoded = JSON.stringify(decorations);
  return `${lang}:${source.length}:${decoded.length}:${fnv1a32(source)}:${fnv1a32(decoded)}`;
}

/**
 * Options for {@link highlightSource}.
 */
export interface HighlightSourceOptions {
  /** Shiki language id. Defaults to `lean`. */
  lang?: string;
  /**
   * Shiki `decorations` — character-offset-keyed spans Shiki splits its own
   * tokens at and stamps `properties` (our `data-*` attributes) onto. Must
   * be sorted by `start` and non-overlapping (Shiki throws otherwise); the
   * caller is responsible for that invariant. See the file page for how the
   * `source_tokens` byte ranges are converted + validated into this shape.
   */
  decorations?: DecorationItem[];
}

/**
 * Server-side helper that runs the Lean Shiki pipeline against `source`
 * and returns the highlighted HTML string. Exposed so the file page can
 * pre-render the source on the server and pass the HTML as a
 * dangerouslySetInnerHTML prop into the client-component body — the
 * Server-Component-inside-Client-Component boundary cannot be crossed, so
 * we pre-render the HTML on the server-side page route and hand the client
 * component the bytes.
 *
 * Pass `decorations` to have Shiki stamp identity-bearing `data-*`
 * attributes onto the identifier spans server-side (the file page's
 * code-navigation path); omit them for plain highlighting (`LeanCode`).
 *
 * The returned HTML is the same string the `LeanCode` component renders
 * verbatim; the same XSS safety reasoning applies. Safety here is NOT a
 * matter of provenance — some decoration `properties` (e.g.
 * `data-qualified-name`, `data-inlined-type-summary`) ARE source-derived.
 * The invariant is that Shiki/hast entity-escapes every attribute value
 * when it serialises the hast tree to an HTML string (and the source text
 * itself is emitted as escaped text tokens), so no attribute value can
 * break out of its quoted context to inject markup, scripts, or event
 * handlers. A future change moving these values into a raw-HTML /
 * non-escaping context (e.g. building markup by string concatenation)
 * would void that invariant — do not treat the values as pre-sanitised.
 *
 * Backwards-compatible: callers passing a bare `lang` string still work.
 */
export async function highlightSource(
  source: string,
  options: HighlightSourceOptions | string = {},
): Promise<string> {
  const opts: HighlightSourceOptions =
    typeof options === "string" ? { lang: options } : options;
  const lang = opts.lang ?? LEAN_LANG;
  const highlighter = await getLeanHighlighter();
  return highlighter.codeToHtml(source, {
    lang,
    // Single Base16 theme — token colours are var(--base0X) references that
    // resolve against the active data-mode/palette at paint time (see the
    // THEMING APPROACH note above and base16-shiki-theme.ts).
    theme: base16ShikiTheme.name,
    ...(opts.decorations !== undefined && opts.decorations.length > 0
      ? { decorations: opts.decorations }
      : {}),
    transformers: [dataLineTransformer],
  });
}

/**
 * Server-side helper that runs the Lean Shiki pipeline against `source` and
 * returns the highlighted hast (HTML AST) `Root` instead of a serialised HTML
 * string. The file page uses this so the client body can render the tree as a
 * REAL React element tree (via the dep-free `renderHast` walker in
 * `ce-file-body.tsx`) and map decorated identifier nodes to an interactive
 * React component — instead of injecting an HTML string and layering native
 * delegated listeners over it. (The natural pick would be
 * `hast-util-to-jsx-runtime`'s `toJsxRuntime`, but the nix build can't fetch
 * that dependency, so v1 hand-rolls the equivalent walk.)
 *
 * Same singleton highlighter, patched grammar, single Base16 theme, and
 * `data-line` transformer as {@link highlightSource}; the only difference is
 * `codeToHast` (returns the AST) vs `codeToHtml` (serialises it). hast is a
 * plain, JSON-serialisable object tree, so it crosses the RSC → client boundary
 * as a prop fine.
 *
 * The same decoration `properties` (`data-*` attributes) Shiki stamps onto the
 * identifier nodes serve a dual role here: they are rendered as DOM attributes
 * AND read off `node.properties` by the client `IdentifierSpan` to reconstruct
 * each token's navigation identity — so the same XSS/escaping reasoning in
 * {@link highlightSource} applies (`renderHast` sets these via React props,
 * which React escapes; values are never placed in a raw-HTML context).
 *
 * The resolved hast is memoized cross-request in a bounded LRU keyed on the
 * (source, decorations, lang) inputs (see the cache note above), so repeat
 * cold loads / refreshes of an unchanged file skip the whole-file Shiki pass.
 */
export async function highlightSourceToHast(
  source: string,
  options: HighlightSourceOptions = {},
): Promise<Root> {
  const lang = options.lang ?? LEAN_LANG;
  const decorations =
    options.decorations !== undefined && options.decorations.length > 0
      ? options.decorations
      : [];

  const key = hastCacheKey(source, lang, decorations);
  const cached = hastCache.get(key);
  if (cached !== undefined) {
    // LRU touch: delete + re-set moves the key to most-recently-used. Map
    // iterates in insertion order, so the first key is the oldest (evicted).
    hastCache.delete(key);
    hastCache.set(key, cached);
    return cached;
  }

  let pending = hastInflight.get(key);
  if (pending === undefined) {
    pending = highlightLeanToHast(source, decorations)
      .then((hast) => {
        hastCache.set(key, hast);
        if (hastCache.size > HAST_CACHE_MAX) {
          const oldest = hastCache.keys().next().value;
          if (oldest !== undefined) hastCache.delete(oldest);
        }
        return hast;
      })
      .finally(() => {
        hastInflight.delete(key);
      });
    hastInflight.set(key, pending);
  }
  return pending;
}

export interface LeanCodeProps {
  /** The `.lean` source to render, verbatim. */
  source: string;
  /**
   * Shiki language id. Defaults to `lean`; only `lean` is preloaded, so
   * passing another id requires extending the singleton's `langs` above.
   */
  lang?: string;
}

/**
 * Server Component. Renders `source` as a highlighted, line-numbered code
 * surface. The returned markup is a Shiki `<pre class="shiki ...">` block with
 * a CSS-counter line-number gutter (see lean-code.module.css).
 */
export async function LeanCode({ source, lang = LEAN_LANG }: LeanCodeProps) {
  const html = await highlightSource(source, lang);

  return (
    // SAFETY: `html` is trusted, server-generated markup. Shiki HTML-escapes
    // the user-submitted `source` as text tokens (it never interprets it as
    // markup) and emits only <pre>/<code>/<span> with inline `style=` color
    // attributes — no <script>, no event handlers, no attribute injection from
    // the source. There is therefore no XSS vector from the file content. The
    // wrapping <div> owns the line-gutter layout and horizontal-scroll chrome.
    <div
      className={styles.leanCode}
      // tabIndex makes the horizontally-scrollable region keyboard-reachable
      // (WCAG 2.1.1 — axe `scrollable-region-focusable`), matching the
      // profile page's axioms <pre>.
      tabIndex={0}
      aria-label="Lean source"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
