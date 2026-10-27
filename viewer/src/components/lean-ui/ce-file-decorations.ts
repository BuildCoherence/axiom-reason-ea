// Shiki decoration builder for the CE file page.
//
// The SINGLE SOURCE of the file page's decoration-building logic. The Server
// Component (`(app)/(public)/f/[file_id]/page.tsx`) imports `buildDecorations`
// to drive Shiki's `decorations` API; the unit suite imports it to assert the
// construction directly (char offsets, attributes, sort + de-overlap) without
// standing up Shiki / Next / a browser.
//
// This module is intentionally NOT `server-only` and imports only the
// `DecorationItem` TYPE from shiki (erased at compile time), so it carries no
// runtime dependency on the WASM highlighter — a plain `node --test` / `tsx`
// run can import it. The actual byte→char conversion (`buildByteToCharMap`) and
// the Shiki render (`highlightSourceToHast`) stay in the `server-only`
// `lean-code.tsx`; this module is pure data transformation.

import type { DecorationItem } from "shiki";

import {
  PROP_PANEL_ID,
  SIDE_PANEL_ID,
  type ByteRange,
  type Decl,
  type FileRef,
  type SourceToken,
} from "./types";

// Shiki leaves `properties` optional, but every decoration this module builds
// stamps it — the `data-*` handles ARE the decoration's payload. Narrowing the
// return types to this alias is what lets callers (and the unit suite) read
// `dec.properties[...]` without a non-null assertion.
export type BuiltDecoration = DecorationItem & {
  properties: NonNullable<DecorationItem["properties"]>;
};

// UTF-8 byte width of a single codepoint (passed as a 1- or 2-UTF-16-unit
// string). Standard UTF-8 width buckets keyed on the codepoint value — the
// SAME buckets as `lean-code.tsx`'s `utf8ByteLength`, duplicated here so this
// non-`server-only` module stays importable by the unit suite (a `node --test`
// / `tsx` run can't pull the `server-only` `lean-code.tsx`).
function utf8ByteLength(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

/**
 * Resolve a half-open UTF-8 byte `range` to the pair of JS (UTF-16) CHAR
 * indices `[startChar, endChar)` that address it, in a SINGLE forward walk that
 * stops as soon as both offsets are located. `source` is a JS string and
 * `range` carries UTF-8 BYTE offsets (Lean source is Unicode-heavy, so
 * byte ≠ char). Offsets that land mid-codepoint resolve to the codepoint that
 * contains them; out-of-range offsets clamp to the string bounds.
 *
 * This is the two-point idiom the slice highlighter uses to extract a
 * slice WITHOUT building a whole-file byte→char map (`buildByteToCharMap`): for
 * a warm-cache panel-open/toggle the only thing it needs from the
 * (potentially large) file is the two char indices bounding the slice, so an
 * O(range.end) early-exit walk replaces the O(file) preprocessing (CO-3). Pure
 * + non-`server-only` so the unit suite covers it without Shiki.
 */
export function byteSliceChars(
  source: string,
  range: ByteRange,
): { startChar: number; endChar: number } {
  let startChar = -1;
  let endChar = -1;
  let bytes = 0;
  let charIndex = 0;
  for (const ch of source) {
    if (startChar === -1 && bytes >= range.start) startChar = charIndex;
    if (endChar === -1 && bytes >= range.end) endChar = charIndex;
    if (startChar !== -1 && endChar !== -1) break;
    bytes += utf8ByteLength(ch);
    charIndex += ch.length;
  }
  // Byte offset >= total bytes clamps to the string end (the loop ran past
  // every codepoint without hitting the offset).
  if (startChar === -1) startChar = charIndex;
  if (endChar === -1) endChar = charIndex;
  return { startChar, endChar };
}

/**
 * Byte-slice `source` over a half-open UTF-8 byte range, returning the JS
 * (UTF-16) substring it addresses. Thin wrapper over {@link byteSliceChars}
 * (single source of truth for the byte→char two-point walk).
 *
 * `ShikiSlice` uses it to show the un-highlighted slice instantly (loading) and as the
 * never-blank-the-section error fallback. Pure + non-`server-only` so the unit
 * suite covers it without Shiki.
 */
export function byteSlice(source: string, range: ByteRange): string {
  const { startChar, endChar } = byteSliceChars(source, range);
  if (endChar < startChar) return "";
  return source.slice(startChar, endChar);
}

/**
 * Slice + rebase a decl's `source_tokens` to a sub-span window. Keeps only
 * tokens fully inside `[range.start, range.end)` and rebases each kept token's
 * absolute byte offsets to be RELATIVE to the slice (subtracting `range.start`)
 * so they address the sliced substring, not the whole file. This is the
 * `sliceSourceTokens(decl.source_tokens, decl.decl_sig_byte_range)` the design's
 * pseudocode names; the slice highlighter feeds the rebased window into
 * `buildDecorations` so identifiers inside a Type / Value slice stay clickable.
 *
 * Pure + non-`server-only` so the unit suite covers it without Shiki.
 */
export function sliceSourceTokens(
  tokens: SourceToken[],
  range: ByteRange,
): SourceToken[] {
  const out: SourceToken[] = [];
  for (const t of tokens) {
    if (t.byte_start >= range.start && t.byte_end <= range.end) {
      out.push({
        ...t,
        byte_start: t.byte_start - range.start,
        byte_end: t.byte_end - range.start,
      });
    }
  }
  return out;
}

/**
 * Assemble the inputs the slice highlighter feeds to Shiki: the slice's
 * verbatim text and its `decorations` array. PURE — the caller injects
 * `buildByteToChar`, the `buildByteToCharMap` factory. The factory is
 * applied to the SLICE text only — never the whole file — so the rebased
 * tokens' byte offsets map to char offsets in the slice.
 *
 * The slice text itself is extracted with {@link byteSliceChars} — a two-point
 * forward walk that early-exits at `range.end` — INSTEAD of building a whole-
 * file byte→char map, so a warm-cache panel-open/toggle no longer redoes
 * O(file) preprocessing (CO-3). Token rebasing + the synthetic one-decl
 * `buildDecorations` wrap live here, which keeps the assembly testable with an injected fake byte→char factory.
 */
export function buildSliceDecorations(
  source: string,
  range: ByteRange,
  tokens: SourceToken[],
  buildByteToChar: (text: string) => (byteOffset: number) => number,
  // OPTIONAL extra spans to mark — SLICE-relative half-open UTF-8 byte ranges
  // (e.g. search-query hits). Absent / empty ⇒ no marks (the original
  // behaviour). Each becomes a Shiki decoration carrying a `search-mark` class +
  // `data-search-mark` prop, merged into the same sort + de-overlap pass so the
  // mark span layers on top of the grammar colouring without Shiki throwing.
  marks?: ByteRange[],
): { sliceText: string; decorations: BuiltDecoration[] } {
  // Two-point walk over the file to get the slice's char bounds (no whole-file
  // byte→char map — CO-3).
  const { startChar, endChar } = byteSliceChars(source, range);
  const sliceText = source.slice(startChar, endChar);

  // Byte→char over the SLICE itself (the rebased tokens' offsets are byte
  // offsets into the slice, not the whole file).
  const toCharSlice = buildByteToChar(sliceText);

  // Slice + rebase the decl's source tokens to the sub-span window.
  const rebasedTokens = sliceSourceTokens(tokens, range);
  const sliceByteLen = new TextEncoder().encode(sliceText).length;

  // Reuse the existing buildDecorations by wrapping the rebased tokens in a
  // one-element synthetic Decl whose source_tokens ARE the rebased window and
  // whose byte_range spans the whole slice. No file_refs (there are no
  // import/open directives inside a type/value slice); data-decl-wrapper is
  // harmless here (the panel doesn't use it).
  const syntheticDecl: Decl = {
    def_id: "slice",
    kind: "",
    qualified_name: "",
    local_name: "",
    publisher: null,
    file_id: "",
    byte_range: { start: 0, end: sliceByteLen },
    decl_sig_byte_range: null,
    decl_val_byte_range: null,
    type_tokens: { author: null, empty: { node: "text", text: "" } },
    value_tokens: null,
    source_tokens: rebasedTokens,
  };
  const tokenDecorations = buildDecorations(
    [syntheticDecl],
    [],
    sliceText,
    toCharSlice,
  );

  if (marks === undefined || marks.length === 0) {
    return { sliceText, decorations: tokenDecorations };
  }

  // Mark pass: one decoration per query-hit range, byte→char over the SAME
  // slice map. Same defensive range guards as the token pass so a malformed
  // mark degrades (loses that one mark) rather than throwing. render-hast keys
  // on the `data-search-mark` attribute to emit a styleable <mark>-like span.
  const charLen = sliceText.length;
  const markDecorations: BuiltDecoration[] = [];
  for (const m of marks) {
    const start = toCharSlice(m.start);
    const end = toCharSlice(m.end);
    if (!(end > start)) continue;
    if (start < 0 || end > charLen) continue;
    markDecorations.push({
      start,
      end,
      properties: {
        "data-search-mark": "true",
        class: "search-mark",
      },
    });
  }

  // Merge marks with the token/file-ref decorations and re-run the SAME sort +
  // de-overlap invariant the token pass uses (Shiki throws on overlapping
  // decorations). Marks are LAST in the combined list, so a mark covering
  // EXACTLY an identifier's range merges onto that one span (the `search-mark`
  // class joins `ce-identifier`); a mark that only partially overlaps still
  // drops. For the Source snippet path `tokens` is empty so there is nothing to
  // conflict with.
  const merged = dedupeOverlapping([...tokenDecorations, ...markDecorations]);
  return { sliceText, decorations: merged };
}

// Union two decorations' properties. `class` values JOIN (both affordance
// classes must survive onto the one span); every other key is last-wins, the
// later pass being the more specific affordance. Values are hast `Properties`,
// so a non-string `class` (hast allows arrays) falls back to last-wins rather
// than string-joining.
function mergeProperties(
  base: BuiltDecoration["properties"],
  extra: BuiltDecoration["properties"],
): BuiltDecoration["properties"] {
  const out: BuiltDecoration["properties"] = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = out[key];
    if (
      key === "class" &&
      typeof existing === "string" &&
      typeof value === "string"
    ) {
      const classes = new Set(
        `${existing} ${value}`.split(/\s+/).filter((c) => c !== ""),
      );
      out[key] = [...classes].join(" ");
      continue;
    }
    out[key] = value;
  }
  return out;
}

// Sort by (start, end), then reduce to a Shiki-legal (sorted, non-overlapping)
// list — the SAME invariant every pass in `buildDecorations` must satisfy,
// factored out so the mark-merge in `buildSliceDecorations` reuses it.
//
// Two candidates covering the IDENTICAL range are merged into one span carrying
// the union of their properties, because both passes' payloads are wanted
// there: the backend emits a `keyword` TOKEN over the same word the
// theorem-keyword pass marks, and dropping either one silently discards an
// affordance (dropping the theorem-keyword span is what made the `theorem`
// keyword inert). A PARTIAL overlap has no such single-span reading, so the
// later candidate is dropped — Shiki throws on overlapping decorations.
function dedupeOverlapping(candidates: BuiltDecoration[]): BuiltDecoration[] {
  candidates.sort((a, b) => {
    const sa = a.start as number;
    const sb = b.start as number;
    if (sa !== sb) return sa - sb;
    return (a.end as number) - (b.end as number);
  });
  const accepted: BuiltDecoration[] = [];
  for (const dec of candidates) {
    const start = dec.start as number;
    const end = dec.end as number;
    const last = accepted[accepted.length - 1];
    if (last === undefined) {
      accepted.push(dec);
      continue;
    }
    if (start === (last.start as number) && end === (last.end as number)) {
      accepted[accepted.length - 1] = {
        ...last,
        properties: mergeProperties(last.properties, dec.properties),
      };
      continue;
    }
    if (start < (last.end as number)) continue; // partially overlaps
    accepted.push(dec);
  }
  return accepted;
}

// Build the Shiki `decorations` array from every decl's `source_tokens` AND the
// file's `import` / `open` `file_refs`.
//
// Each identifier token becomes one decoration whose `properties` carry the
// `data-*` attributes the client reads to drive clicks + the hover popover. For
// tokens with a resolved `def_id` (in-CE references, clickable) we also add
// `tabindex`/`role="button"`/a clickable class. For the ONE header token per
// decl we add `data-decl-wrapper=<def_id>` so the client can scroll to and
// highlight the decl.
//
// Each file_ref becomes one decoration stamped `data-kind="file-ref"` (plus
// `data-target-file-id` / `data-ref-kind` / `class="ce-file-ref"`). The client
// body renders these as real `<a href>` anchors that NAVIGATE to
// `/f/<target_file_id>` — distinct from identifiers, which open the in-page side
// panel. (No role/tabindex is stamped — a real anchor already has the link role
// and tab order.)
//
// A third pass marks each `theorem`-kind decl's leading keyword
// (`data-kind="theorem-keyword"` + `data-theorem-def-id`), which the client
// mounts as a side-panel-opening control targeted at the theorem.
//
// INVARIANTS Shiki requires: decorations must be sorted by `start` and be
// non-overlapping (Shiki throws on overlap). Identifier token ranges and
// file-ref ranges are disjoint by construction, but we put ALL THREE passes into
// the same `candidates` list and defensively (a) drop zero-width or inverted
// ranges, (b) merge candidates covering the identical range and skip any that
// PARTIALLY overlaps one already accepted, and (c) sort
// the final list — so a malformed payload degrades (loses some clickability)
// rather than throwing the whole page.
export function buildDecorations(
  decls: Decl[],
  fileRefs: FileRef[],
  content: string,
  toChar: (byteOffset: number) => number,
): BuiltDecoration[] {
  const charLen = content.length;

  // First pass: pick each decl's header token (the source token whose
  // qualified_name === decl.qualified_name AND binder_role === "def_site",
  // falling back to the token at byte_start === decl.byte_range.start). Map its
  // token_id → def_id so the second pass stamps data-decl-wrapper once.
  const headerTokenIdToDeclDefId = new Map<string, string>();
  for (const decl of decls) {
    const tokens = decl.source_tokens ?? [];
    const header =
      tokens.find(
        (t) =>
          t.qualified_name === decl.qualified_name &&
          t.binder_role === "def_site",
      ) ??
      tokens.find((t) => t.byte_start === decl.byte_range.start) ??
      tokens[0] ??
      null;
    if (header !== null) {
      headerTokenIdToDeclDefId.set(header.token_id, decl.def_id);
    }
  }

  // Second pass: one decoration per token. Build then sort + de-overlap.
  const candidates: BuiltDecoration[] = [];
  for (const decl of decls) {
    for (const token of decl.source_tokens ?? []) {
      const start = toChar(token.byte_start);
      const end = toChar(token.byte_end);
      // Defensive: drop zero-width, inverted, or out-of-range ranges.
      //
      // The `start < 0 || end > charLen` guard is only fully load-bearing if
      // `toChar` can return offsets outside [0, charLen]. It cannot today —
      // `buildByteToCharMap` clamps every result into [0, totalChars] — so this
      // clause is effectively a no-op and the real protection against overlap is
      // the sort + de-overlap pass below. If a future "faster" `toChar` returns
      // raw/unclamped offsets, this guard silently becomes the ONLY thing
      // keeping Shiki's sorted + non-overlapping invariant — so keep it.
      if (!(end > start)) continue;
      if (start < 0 || end > charLen) continue;

      const properties: Record<string, string> = {
        "data-token-id": token.token_id,
      };
      // data-kind stamping — the BODY-side half of the type-coloring
      // deferral (see the matching note in token-colors.css):
      //
      //   - kind "type" (Sort-valued identifier heads, the
      //     emission-completion amendment) stamps data-kind="identifier"
      //     so a resolved type token keeps the
      //     `[data-kind="identifier"][data-binder-role=…]` def/use-site
      //     colors it had before the amendment. (Unresolved stdlib type
      //     names never reach this branch: the API resolver rewrites them
      //     to kind "stdlib" on the wire.)
      //   - kinds "op" / "keyword" / "comment" (newly emitted by the
      //     whole-file syntactic-atom walk) stamp NO data-kind at all, so
      //     body rendering falls through to Shiki's grammar exactly as it
      //     did before the amendment (in particular, the pre-existing
      //     `[data-kind="op"]` override in token-colors.css remains a
      //     panel-tag rule and does not repaint body operators).
      //
      // The type-coloring follow-up PR removes this aliasing/suppression
      // (stamping token.kind verbatim again) alongside relaxing the API's
      // rewriteStdlibKind back to identifier-only.
      if (token.kind === "type") {
        properties["data-kind"] = "identifier";
      } else if (
        token.kind !== "op" &&
        token.kind !== "keyword" &&
        token.kind !== "comment"
      ) {
        properties["data-kind"] = token.kind;
      }
      if (token.qualified_name !== null) {
        properties["data-qualified-name"] = token.qualified_name;
      }
      if (token.hover_kind !== null) {
        properties["data-hover-kind"] = token.hover_kind;
      }
      if (token.binder_role !== null) {
        properties["data-binder-role"] = token.binder_role;
      }
      if (token.inlined_type_summary !== null) {
        properties["data-inlined-type-summary"] = token.inlined_type_summary;
      }
      // token_role is the validator's explicit per-token role stamp
      // (emission-completion amendment). Stamped as data-token-role so the
      // client renderer keys on it too (render-hast's control-atom gate).
      const tokenRole = token.token_role ?? null;
      if (tokenRole !== null) {
        properties["data-token-role"] = tokenRole;
      }
      // A control atom (e.g. `𝕖`) is a syntactic control marker: it must
      // never link, whatever other metadata it carries. Keyed on the
      // explicit token_role === "control_atom" stamp — the stored-metadata
      // replacement for the old "notation kind with null qualified_name"
      // inference (#1080 read-side prototype, superseded per the
      // validator-emission-completion design's Rollout step 5).
      const isControlAtom = tokenRole === "control_atom";
      const defTarget = token.def_id;
      const propTarget = token.proposition_id;
      const hasDefTarget = defTarget !== null;
      const hasPropTarget = typeof propTarget === "string";
      // Clickable iff the token has a loadable declaration target OR a
      // proposition target (and is not a control atom). Unloadable data
      // projections keep hover metadata but no link affordance.
      if (!isControlAtom && (hasDefTarget || hasPropTarget)) {
        if (hasDefTarget) {
          properties["data-def-id"] = defTarget;
        }
        if (hasPropTarget) {
          properties["data-proposition-id"] = propTarget;
        }
        properties["tabindex"] = "0";
        // role="button" (not "link"): activating opens an in-page inspection
        // panel, it does not navigate. aria-haspopup="true" announces that a
        // popup will appear without promising a specific popup type — desktop
        // renders the panel as a docked <div role="region">, only mobile is a
        // real Dialog; the panel's own ARIA role communicates its semantics on
        // open. aria-controls points at the panel's id. aria-expanded is NOT
        // stamped here — which def is open is client state.
        properties["role"] = "button";
        properties["aria-haspopup"] = "true";
        properties["aria-controls"] = hasPropTarget
          ? PROP_PANEL_ID
          : SIDE_PANEL_ID;
        properties["class"] = "ce-identifier";
      }
      // The decl's header token carries the scroll/highlight anchor.
      const wrapperDefId = headerTokenIdToDeclDefId.get(token.token_id);
      if (wrapperDefId !== undefined) {
        properties["data-decl-wrapper"] = wrapperDefId;
      }

      candidates.push({ start, end, properties });
    }
  }

  // File-ref pass: one decoration per import/open reference. Same byte→char
  // conversion and the SAME defensive range guards as identifier tokens, so a
  // malformed range degrades (loses that one link) rather than throwing. These
  // land in the same `candidates` list so the sort + de-overlap pass below
  // covers them alongside the identifier decorations.
  for (const ref of fileRefs) {
    const start = toChar(ref.byte_start);
    const end = toChar(ref.byte_end);
    if (!(end > start)) continue;
    if (start < 0 || end > charLen) continue;

    // The client renders this as a real <a href> that NAVIGATES to the
    // referenced file's page (it does not open the in-page side panel). We do
    // NOT stamp role="link"/tabindex here: an anchor with href already has the
    // implicit link role and is already in the tab order, so adding them is
    // redundant ARIA. No data-def-id / aria-haspopup either — this span is
    // never wired to identifier/side-panel logic.
    const properties: Record<string, string> = {
      "data-kind": "file-ref",
      "data-target-file-id": ref.target_file_id,
      "data-ref-kind": ref.kind,
      class: "ce-file-ref",
    };
    candidates.push({ start, end, properties });
  }

  // Theorem-keyword pass: for each `theorem`-kind decl, make its leading
  // keyword open the side panel TARGETED AT THE THEOREM (the same in-page
  // inspection the decl name opens, carried by the keyword itself rather than a
  // sibling icon; the panel's own "View theorem page" link is the navigation
  // hop). The keyword is the decl's leading non-whitespace word at
  // `byte_range.start`; we stamp it only when that word is actually a theorem
  // keyword, so a decl whose byte range starts elsewhere degrades to no
  // affordance rather than wrapping the wrong text. The range is disjoint from
  // the name token (which starts after the keyword + a space); it DOES coincide
  // with the backend's `keyword` token over the same word, and the de-overlap
  // pass merges those two into one span. render-hast mounts this span on the
  // same IdentifierSpan path a def-target identifier uses.
  for (const decl of decls) {
    if (decl.kind !== "theorem") continue;
    const kwStart = toChar(decl.byte_range.start);
    if (kwStart < 0 || kwStart >= charLen) continue;
    let kwEnd = kwStart;
    while (kwEnd < charLen && !/\s/.test(content[kwEnd])) kwEnd++;
    if (!(kwEnd > kwStart)) continue;
    const keyword = content.slice(kwStart, kwEnd);
    if (keyword !== "theorem" && keyword !== "lemma") continue;
    candidates.push({
      start: kwStart,
      end: kwEnd,
      properties: {
        "data-kind": "theorem-keyword",
        // A theorem-specific attribute, NOT `data-def-id`: it addresses the
        // DECL the keyword introduces, and the client reads it INSTEAD of the
        // span's own token metadata (the merged `keyword` token's). Keeping it
        // separate also stops the name's `[data-def-id]` selectors (the
        // aria-expanded sweep) from matching the keyword.
        "data-theorem-def-id": decl.def_id,
        // Same interaction contract a def-target identifier gets — activating
        // opens the in-page side panel, so the keyword is a button, not a link.
        tabindex: "0",
        role: "button",
        "aria-haspopup": "true",
        "aria-controls": SIDE_PANEL_ID,
        class: "ce-theorem-keyword",
      },
    });
  }

  // Sort by start (then end), merge identical-range candidates, and drop
  // partial overlaps — Shiki throws on overlapping decorations.
  return dedupeOverlapping(candidates);
}
