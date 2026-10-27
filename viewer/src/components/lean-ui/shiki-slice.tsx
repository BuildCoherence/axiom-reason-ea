"use client";

import * as React from "react";
import type { Root } from "hast";

import { buildSliceDecorations, byteSlice } from "./ce-file-decorations";
import { buildByteToCharMap, highlightLeanToHast } from "./lean-highlighter";
import {
  renderHast,
  TokenInteractionContext,
  type TokenInteraction,
} from "./render-hast";
import type { PopoverTarget } from "./identifier-popover";
import type { ByteRange, SourceToken } from "./types";

// Author-view source-slice renderer for the side panel's Type / Value sections.
//
// The panel renders the author view from VERBATIM source bytes (design §
// "Author view from verbatim source bytes"). The slice is highlighted in the
// browser with the same patched Lean grammar the prerendered file body uses
// (lean-highlighter.ts) and walked with the SAME client `renderHast`, so
// identifiers inside the slice stay clickable, consistent with the file body.
//
// INTERACTION — CLICK always pivots the panel (clicking an identifier inside
// the Type/Value slice, like the empty-view TokenTreeView). Hover / leave are
// OPTIONAL: when the host passes `onIdentifierHover` / `onIdentifierLeave` they
// are forwarded to render-hast so identifiers show the hover popover. Hosts
// that own a popover host opt in (the feed, the side panel via its `popover`
// prop, the theorem page's synthetic signature and flowchart cards); a host
// that wires nothing (`/search`) keeps the click-only behaviour, and the
// rendered DOM is identical either way — render-hast always attaches the
// handlers and the absent ones default to no-ops here. Escape stays a no-op.
//
// NEVER-BLANK — while the highlight is in progress we render the raw
// `byteSlice(source, range)` as plain text (instant, since the panel already
// holds file_content); on error we keep that raw-text fallback. A highlight
// failure never blanks the section.

export interface ShikiSliceProps {
  /** The home file's verbatim source (DefData.file_content). */
  source: string;
  /** The decl's chosen sub-span (decl_sig_byte_range / decl_val_byte_range). */
  range: ByteRange;
  /** The decl's UNsliced source_tokens — the handler slices + rebases them. */
  tokens: SourceToken[];
  /** Click pivots the panel to the clicked identifier's def. */
  onIdentifierClick: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  /**
   * OPTIONAL hover/focus handler — render-hast surfaces a complete
   * `PopoverTarget` (rect captured while the span is attached), so a host with
   * a popover host can pass its slice-shaped handler straight through with no
   * rect adapter. Absent ⇒ hover is a no-op, and the DOM is unchanged.
   */
  onIdentifierHover?: (target: PopoverTarget) => void;
  /** OPTIONAL — fires on pointer-leave / blur, paired with `onIdentifierHover`. */
  onIdentifierLeave?: () => void;
  /**
   * OPTIONAL extra spans to mark — SLICE-relative half-open UTF-8 byte ranges
   * (e.g. search-query hits in the federated Source section). Emitted as
   * `search-mark` decorations that
   * render-hast renders as styleable <mark> spans on top of the grammar
   * colouring. Absent ⇒ no marks (the panel's original behaviour).
   */
  marks?: ByteRange[];
  /**
   * OPTIONAL — fires each time the slice reaches a terminal state: the hast
   * landed, the request failed, or the cross-mount cache seeded it on the first
   * render. A host that lays itself out from measured DOM needs it because the
   * raw-text → hast swap resizes the slice AFTER first paint (the theorem
   * shell's per-card settle counter). Treat it as idempotent; absent ⇒ nothing
   * runs, so the panel / file-body callers are unaffected.
   */
  onSettled?: () => void;
}

type SliceStatus = "loading" | "ok" | "error";

// CO-4: cross-mount hast cache. The panel's author↔empty toggle UNMOUNTS this
// component on the empty view (the author branch is conditional), so without a
// cache each toggle back to author re-highlights the slice and re-flashes the
// raw-text fallback while it runs. A module-scoped cache keyed
// on the FULL slice identity `(source, range, tokens, marks)` (see
// `sliceIdentity`) survives the unmount so a re-open of an already-fetched
// author slice paints the highlighted hast synchronously on first render — no
// re-fetch, no flash. The key hashes the source CONTENT (not just its length)
// and fingerprints the tokens so two distinct decls/slices that happen to share
// a byte/char length can never collide and cross-render (the search-surface
// cross-row / cross-file bleed bug).
//
// Highlighting is async, so without this cache the first paint after re-mount
// is the loading fallback.
//
// Keying on the source CONTENT (hashed) + range + tokens is sound: corpus file
// content is immutable, and the lang is fixed (Lean). A bounded LRU
// (insertion-ordered Map, evict-oldest past the cap) caps memory across a long
// session of opening many decls.
const SLICE_HAST_CACHE_MAX = 64;
const sliceHastCache = new Map<string, Root>();

// Serialise marks to a stable key fragment so two slices differing ONLY in
// their query-hit marks cache (and re-fetch) separately. Empty / absent marks
// collapse to "" so the panel's markless path keeps its original key.
function marksKey(marks: ByteRange[] | undefined): string {
  if (marks === undefined || marks.length === 0) return "";
  return marks.map((m) => `${m.start}-${m.end}`).join(",");
}

// Fingerprint the slice's tokens so two slices differing ONLY in their tokens
// (e.g. two DIFFERENT decls whose first lines share length + content shape but
// carry different identifier resolutions) cache — and render — separately. The
// tokens drive the per-identifier decorations the route stamps, so they are
// part of the slice's RENDERED IDENTITY and MUST be in the cache key. Empty
// tokens collapse to "" so the Source snippet's `tokens: []` path keeps a clean
// key. token_id is the validator's stable `(decl, view, DFS-index)` id, so it
// uniquely fingerprints a decl's token set without serialising every field.
function tokensKey(tokens: SourceToken[]): string {
  if (tokens.length === 0) return "";
  return tokens
    .map((t) => `${t.byte_start}-${t.byte_end}:${t.token_id}`)
    .join(",");
}

// The full slice IDENTITY — everything the rendered hast depends on. Used both
// as the cache key AND as the in-flight request token (the async guard compares
// the identity a response was issued for against the component's CURRENT one).
//
// CRITICAL: this keys on the FULL `source` string, not `source.length`. Two
// different decls can have first lines of identical byte/char length (e.g.
// `def KristieLovesChildhoodDog :=` and `def LoveMeansPayingAttention :=` are
// both 31 ASCII bytes) and SourceSignature always passes range {0, firstLineLen}
// — so a length-only key COLLIDES and one row paints another row's (or another
// file's) highlighted signature. Hashing the content + tokens makes the key
// uniquely identify the decl's slice, eliminating the cross-row/cross-file
// bleed. The hash keeps the key bounded for large file bodies (the side panel /
// file body pass the whole file_content as `source`).
function sliceIdentity(
  source: string,
  range: ByteRange,
  tokens: SourceToken[],
  marks: ByteRange[] | undefined,
): string {
  return `${hashString(source)}:${source.length}:${range.start}:${range.end}:${tokensKey(tokens)}:${marksKey(marks)}`;
}

// FNV-1a — a fast, dependency-free 32-bit string hash. Collisions are
// astronomically unlikely between two distinct slice sources, and the key also
// carries source.length + range + the token fingerprint, so a hash collision
// alone cannot cross-render two genuinely different slices.
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function readSliceHastCache(
  source: string,
  range: ByteRange,
  tokens: SourceToken[],
  marks: ByteRange[] | undefined,
): Root | null {
  return (
    sliceHastCache.get(sliceIdentity(source, range, tokens, marks)) ?? null
  );
}

function writeSliceHastCache(
  source: string,
  range: ByteRange,
  tokens: SourceToken[],
  marks: ByteRange[] | undefined,
  hast: Root,
): void {
  const key = sliceIdentity(source, range, tokens, marks);
  // Refresh recency: delete-then-set moves the key to the Map's tail.
  sliceHastCache.delete(key);
  sliceHastCache.set(key, hast);
  if (sliceHastCache.size > SLICE_HAST_CACHE_MAX) {
    const oldest = sliceHastCache.keys().next().value;
    if (oldest !== undefined) sliceHastCache.delete(oldest);
  }
}

export function ShikiSlice({
  source,
  range,
  tokens,
  onIdentifierClick,
  onIdentifierHover,
  onIdentifierLeave,
  marks,
  onSettled,
}: ShikiSliceProps) {
  // Seed from the cross-mount cache so an already-fetched slice paints
  // highlighted on the very first render after a toggle (CO-4) — no loading
  // flash, no re-fetch. Keyed on the FULL slice identity (incl. tokens) so a
  // reused component instance with NEW props can never seed another decl's hast.
  const cached = readSliceHastCache(source, range, tokens, marks);
  const [hast, setHast] = React.useState<Root | null>(cached);
  const [status, setStatus] = React.useState<SliceStatus>(
    cached !== null ? "ok" : "loading",
  );

  // The slice identity this render is FOR — the single primitive that folds in
  // source-CONTENT + range + tokens + marks. It is BOTH the cache key and the
  // effect's dependency, so the effect re-fires exactly when the rendered slice
  // changes, and each effect run is bound (via its `cancelled` closure flag) to
  // exactly one identity. That binding IS the stale-response guard: when props
  // swap (a new decl lands in a reused instance), the previous effect's cleanup
  // flips `cancelled` and aborts, so its in-flight response is dropped rather
  // than painted onto the new row.
  const currentIdentity = sliceIdentity(source, range, tokens, marks);

  // Re-highlight when the slice identity changes. The per-effect `cancelled`
  // flag drops a result whose props were replaced while it ran, so a reused
  // instance never paints another slice's hast; a cache HIT skips the work.
  React.useEffect(() => {
    const hit = readSliceHastCache(source, range, tokens, marks);
    if (hit !== null) {
      setHast(hit);
      setStatus("ok");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setHast(null);
    Promise.resolve()
      .then(() => {
        const { sliceText, decorations } = buildSliceDecorations(
          source,
          range,
          tokens,
          buildByteToCharMap,
          marks,
        );
        return highlightLeanToHast(sliceText, decorations);
      })
      .then((result) => {
        if (cancelled) return;
        writeSliceHastCache(source, range, tokens, marks, result);
        setHast(result);
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Lean slice highlight failed:", err);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // `currentIdentity` folds in source-content + range + tokens + marks, so
    // the individual fields are intentionally not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdentity]);

  // Report every departure from `loading` — the terminal states above and the
  // cache-hit seed, which never passes through the effect at all. Bails before
  // doing anything when the host wants no report.
  React.useEffect(() => {
    if (onSettled === undefined || status === "loading") return;
    onSettled();
  }, [status, onSettled]);

  // Click always pivots the panel. Hover/leave are wired only when the host
  // opts in; the no-op defaults keep a non-wiring host's behaviour and DOM
  // unchanged. Escape stays a no-op.
  const interaction = React.useMemo<TokenInteraction>(
    () => ({
      onIdentifierClick: (target) => {
        if (typeof target.def_id !== "string") return;
        onIdentifierClick({
          def_id: target.def_id,
          qualified_name: target.qualified_name,
        });
      },
      onIdentifierHover: onIdentifierHover ?? (() => {}),
      onIdentifierLeave: onIdentifierLeave ?? (() => {}),
      onIdentifierEscape: () => {},
    }),
    [onIdentifierClick, onIdentifierHover, onIdentifierLeave],
  );

  // loading / error → raw byte-sliced source text (never blank the section).
  if (status !== "ok" || hast === null) {
    return <>{byteSlice(source, range)}</>;
  }

  return (
    <TokenInteractionContext.Provider value={interaction}>
      {renderHast(hast, "slice", { colorIdentifiers: true })}
    </TokenInteractionContext.Provider>
  );
}
