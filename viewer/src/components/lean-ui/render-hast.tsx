"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Root, Element as HastElement, RootContent } from "hast";

import { shouldShowPopover, type PopoverTarget } from "./identifier-popover";
import { PROP_PANEL_ID, type TokenTag } from "./types";
import styles from "./render-hast.module.css";

// Shiki-hast → React-tree walker, extracted from `ce-file-body.tsx` so BOTH the
// file body and the side panel's `ShikiSlice` render decorated Shiki hast the
// same way (identifier nodes become interactive spans, import/open file-ref
// nodes become navigation links). The interaction callbacks reach the leaf
// components through `TokenInteractionContext`, so each host provides its own
// provider: the file body wires full hover/popover + click; the panel slice
// wires click only (hover/leave/escape are no-ops for v1 — see the side-panel
// spec § "renderHast reuse" / "ShikiSlice").
//
// This module is `"use client"` and depends ONLY on `identifier-popover`
// (client) and the erased `TokenTag` type — NOT on `ce-file-body.tsx`'s
// host-page machinery — so the panel can reuse the walker without dragging the
// file body's `useDefSelection` / fetch / popover-host state in.

// Callbacks the IdentifierSpan needs, supplied via context so the walker output
// is a stable, memoisable tree. Each host stabilises its provider value
// (useCallback-backed handlers) so the memoised tree only rebuilds on `hast`
// change.
export interface TokenInteraction {
  onIdentifierClick: (target: {
    def_id?: string | null;
    qualified_name: string;
    proposition_id?: string | null;
  }) => void;
  onIdentifierHover: (target: PopoverTarget) => void;
  onIdentifierLeave: () => void;
  /** Escape pressed on a token — dismiss the popover without moving focus. */
  onIdentifierEscape: () => void;
}

export const TokenInteractionContext =
  React.createContext<TokenInteraction | null>(null);

// Reconstruct a TokenTag from a decorated node's `properties`. Shiki stamped
// these server-side (the SAME hyphenated keys buildDecorations set); the
// popover policy (shouldShowPopover) reads `qualified_name` + `kind` and the
// popover body reads `qualified_name`, `inlined_type_summary`, `hover_kind`.
function tagFromProperties(
  props: HastElement["properties"],
  text: string,
): TokenTag | null {
  const get = (key: string): string | undefined => {
    const v = props[key];
    return typeof v === "string" ? v : undefined;
  };
  // A control atom (validator-stamped `token_role: "control_atom"`, e.g. `𝕖`)
  // never gets a popover — keyed on the explicit stored role, the
  // stored-metadata switch that superseded the old kind+null-qualified-name
  // inference (validator-emission-completion design, Rollout step 5).
  if (get("data-token-role") === "control_atom") return null;
  // Accept `identifier`, `stdlib`, AND `notation` here: the API resolver
  // rewrites unresolved qualified-name identifier tokens to `stdlib`, but the
  // popover wiring (hover/focus, keyboard escape) should still fire — only
  // the click is suppressed (gated on `defId` inside `activate`). If we
  // dropped `stdlib` from this gate, post-rewrite the body span would fall
  // through to the plain-element branch and lose hover/focus/`.ce-identifier`.
  // `notation` is a notation-use atom (`loves`; `thinks`/`about`) carrying its
  // head function as `qualified_name` — interactive exactly like an identifier
  // (clickable to that function), so it shares this path.
  const kind = get("data-kind");
  if (kind !== "identifier" && kind !== "stdlib" && kind !== "notation")
    return null;
  // qualified_name gates the popover policy; absent means suppress.
  const qualifiedName = get("data-qualified-name");
  if (qualifiedName === undefined) return null;
  const binderRoleRaw = get("data-binder-role");
  const binderRole =
    binderRoleRaw === "def_site" || binderRoleRaw === "use_site"
      ? binderRoleRaw
      : null;
  const defId = get("data-def-id") ?? null;
  return {
    kind: "identifier",
    text,
    qualified_name: qualifiedName,
    def_id: defId,
    token_id: get("data-token-id") ?? `${defId ?? "unknown"}::unknown`,
    hover_kind: get("data-hover-kind") ?? "term",
    binder_role: binderRole,
    inlined_type_summary: get("data-inlined-type-summary") ?? null,
  };
}

// hast property `style` is a CSS string; React needs an object. CSS custom
// properties (--x) pass through verbatim; standard properties are camelCased
// (background-color → backgroundColor).
function parseStyleString(style: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) continue;
    const rawProp = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (rawProp === "" || value === "") continue;
    const prop = rawProp.startsWith("--")
      ? rawProp
      : rawProp.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[prop] = value;
  }
  return out as React.CSSProperties;
}

// Convert a hast element's `properties` to React props. Shiki's `codeToHast`
// emits HTML-attr-named keys: `class` (a STRING for its own syntax tokens, an
// ARRAY for decoration-added classes like `ce-identifier`), `style` as a CSS
// string, and `tabindex`. React needs `className` / a `style` object /
// `tabIndex`. `data-*` / `aria-*` / `role` / `id` are accepted by React as-is
// and pass through unchanged (so the `[data-decl-wrapper]` scroll selector and
// e2e selectors keep working).
function hastPropsToReact(
  properties: HastElement["properties"] | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class" || k === "className") {
      out.className = Array.isArray(v) ? v.join(" ") : String(v);
    } else if (k === "style" && typeof v === "string") {
      out.style = parseStyleString(v);
    } else if (k === "tabindex" || k === "tabIndex") {
      out.tabIndex = typeof v === "number" ? v : Number(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isDeadEndFieldProperties(
  properties: HastElement["properties"],
): boolean {
  return (
    properties["data-hover-kind"] === "field" &&
    typeof properties["data-proposition-id"] !== "string"
  );
}

function stripInteractiveIdentifierProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...props };
  delete next["data-def-id"];
  delete next.role;
  delete next.tabIndex;
  delete next.tabindex;
  delete next["aria-haspopup"];
  delete next["aria-controls"];
  if (typeof next.className === "string") {
    next.className = next.className
      .split(/\s+/)
      .filter((cls) => cls !== "ce-identifier")
      .join(" ");
  }
  return next;
}

// Interactive renderer for an identifier token span (the decorated
// `data-kind="identifier"` nodes) AND for a theorem's keyword span, which opens
// the same panel via `defIdOverride`. Reads its metadata from `node.properties`
// (the same hyphenated keys buildDecorations set) and attaches React onClick /
// onKeyDown / onMouseEnter / onFocus / onMouseLeave / onBlur. Plain
// (non-interactive) nodes are rendered directly by `renderHast`, not here.
function IdentifierSpan({
  node,
  children,
  sliceMode = false,
  defIdOverride,
}: {
  node: HastElement;
  children: React.ReactNode;
  /** Author-view source-slice mode: tag the span with the shared
   *  `.sliceIdentifier` class so it picks up the token tree's semantic color +
   *  affordance (renderHast has stripped the inner Shiki color, so no
   *  `!important` is needed). Off for the file body. */
  sliceMode?: boolean;
  /** Open the panel on THIS def_id, ignoring the span's own
   *  `data-def-id` / `data-proposition-id`. Set only by the theorem-keyword
   *  branch, whose span may also carry the merged `keyword` token's metadata —
   *  the keyword targets its DECL, never that token's own target. */
  defIdOverride?: string;
}) {
  const interaction = React.useContext(TokenInteractionContext);
  const properties = node.properties ?? {};
  const isDeadEndField = isDeadEndFieldProperties(properties);
  const reactProps = isDeadEndField
    ? stripInteractiveIdentifierProps(hastPropsToReact(properties))
    : hastPropsToReact(properties);
  if (sliceMode) {
    reactProps.className = [reactProps.className, styles.sliceIdentifier]
      .filter(Boolean)
      .join(" ");
  }

  // No interaction context (shouldn't happen inside a provider) → inert span.
  if (interaction === null) {
    return <span {...reactProps}>{children}</span>;
  }

  const defId =
    defIdOverride ??
    (!isDeadEndField && typeof properties["data-def-id"] === "string"
      ? properties["data-def-id"]
      : undefined);
  const propositionId =
    defIdOverride === undefined &&
    !isDeadEndField &&
    typeof properties["data-proposition-id"] === "string"
      ? properties["data-proposition-id"]
      : undefined;
  if (propositionId !== undefined) {
    reactProps["aria-controls"] = PROP_PANEL_ID;
  }

  const activate = (e: React.SyntheticEvent) => {
    if (defId === undefined && propositionId === undefined) return;
    const qualifiedName =
      typeof properties["data-qualified-name"] === "string"
        ? properties["data-qualified-name"]
        : (e.currentTarget.textContent ?? "");
    e.preventDefault();
    interaction.onIdentifierClick({
      def_id: defId ?? null,
      qualified_name: qualifiedName,
      proposition_id: propositionId,
    });
  };

  const openPopover = (
    e: React.MouseEvent<HTMLSpanElement> | React.FocusEvent<HTMLSpanElement>,
  ) => {
    const tag = tagFromProperties(
      properties,
      e.currentTarget.textContent ?? "",
    );
    if (tag === null) return;
    if (!shouldShowPopover(tag)) return;
    // Capture the span's rect NOW, while it is attached and laid out — the
    // popover anchors to this rect (see PopoverTarget.rect).
    const r = e.currentTarget.getBoundingClientRect();
    interaction.onIdentifierHover({
      tag,
      element: e.currentTarget,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    });
  };

  // The decl NAME opens the side panel (the data-def-id activation above). A
  // theorem's `theorem` KEYWORD mounts this same component with
  // `defIdOverride`, so it opens the SAME panel targeted at the theorem; the
  // panel's "View theorem page" link is the navigation hop from there.
  return (
    <span
      {...reactProps}
      onClick={(e) => activate(e)}
      onKeyDown={(e) => {
        // Escape dismisses the popover (WCAG 1.4.13 "Dismissable") without
        // moving focus off the span.
        if (e.key === "Escape") {
          interaction.onIdentifierEscape();
          return;
        }
        // role="button" + tabbable → Enter/Space activate.
        if (e.key === "Enter" || e.key === " ") {
          activate(e);
        }
      }}
      onMouseEnter={(e) => openPopover(e)}
      onFocus={(e) => openPopover(e)}
      onMouseLeave={() => interaction.onIdentifierLeave()}
      onBlur={() => interaction.onIdentifierLeave()}
    >
      {children}
    </span>
  );
}

// Navigation link for an import/open file-reference span (the decorated
// `data-kind="file-ref"` nodes). Reads its target from `node.properties`
// (the `data-target-file-id` / `data-ref-kind` keys buildDecorations set) and
// renders a REAL anchor — so native keyboard activation, middle-click, and
// cmd/ctrl-click "open in new tab" all work for free. onClick intercepts a
// plain primary click for SPA navigation (router.push) but deliberately lets
// the browser handle modified / non-primary clicks (new tab). This component
// NEVER touches identifier / side-panel logic: a file-ref NAVIGATES, it does
// not open the panel, and the target carries NO `?def=`.
function FileRefLink({
  node,
  children,
}: {
  node: HastElement;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const properties = node.properties ?? {};
  const reactProps = hastPropsToReact(properties);

  const targetFileId =
    typeof properties["data-target-file-id"] === "string"
      ? properties["data-target-file-id"]
      : undefined;

  // No resolvable target → render inert (non-navigating) text, never a
  // dangling link. Shouldn't happen (buildDecorations always stamps it).
  if (targetFileId === undefined) {
    return <span {...reactProps}>{children}</span>;
  }

  const href = `/f/${targetFileId}`;

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle "open in new tab/window" gestures: any modifier
    // key or a non-primary (middle/right) button. Don't preventDefault — the
    // real anchor's href does the right thing.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    // Plain primary click → SPA navigation to the referenced file PAGE (no
    // `?def=`; this navigates, it does not open the side panel).
    e.preventDefault();
    router.push(href);
  };

  return (
    <a {...reactProps} href={href} onClick={onClick}>
      {children}
    </a>
  );
}

// Per-render options threaded through the recursion.
export interface RenderHastOpts {
  /** Author-view source-slice mode (set by ShikiSlice, NEVER the file body):
   *  render decorated identifiers with the token tree's semantic color +
   *  affordance, stripping Shiki's default inline `color` from their inner
   *  grammar spans so the semantic color applies by inheritance (no
   *  `!important`). */
  colorIdentifiers?: boolean;
  /** Internal: set while recursing INTO a decorated identifier so its inner
   *  Shiki grammar spans drop their inline `color` and inherit the
   *  `.sliceIdentifier` color. Never set by callers. */
  _stripColor?: boolean;
}

// Recursively render a Shiki hast tree to a React tree. Text nodes → strings;
// identifier token spans AND theorem-keyword spans → interactive
// <IdentifierSpan>s (which read their callbacks from TokenInteractionContext,
// so this output is stable across host state churn and can be memoised on
// `hast` alone); import/open file-reference spans → <FileRefLink> navigation
// anchors; every other element → a plain React element. Children get index keys.
export function renderHast(
  node: Root | RootContent,
  key: React.Key,
  opts: RenderHastOpts = {},
): React.ReactNode {
  if (node.type === "text") return node.value;
  if (node.type === "root") {
    return node.children.map((child, i) => renderHast(child, i, opts));
  }
  if (node.type === "element") {
    // Interactive token spans: identifiers, post-resolver `stdlib`, AND
    // notation-use atoms. All three are mounted as <IdentifierSpan> (clickable
    // when a def_id resolved, hover/focus popover, slice affordance);
    // `notation` atoms link to their head function exactly like an identifier.
    // EXCEPT control atoms (validator-stamped `token_role: "control_atom"`,
    // e.g. `𝕖`): they render as plain spans with no interactive machinery —
    // the explicit stored-metadata gate that superseded the old
    // kind+null-qualified-name inference (validator-emission-completion
    // design, Rollout step 5).
    //
    // A theorem decl's `theorem` KEYWORD mounts the same component (targeted at
    // `data-theorem-def-id`, so the panel opens on the theorem). Its span may
    // ALSO carry the backend's `keyword` token metadata — buildDecorations
    // merges the two identical-range decorations — so this branch is checked
    // FIRST and the keyword's own decl target wins.
    const theoremDefId =
      node.tagName === "span" &&
      typeof node.properties?.["data-theorem-def-id"] === "string"
        ? node.properties["data-theorem-def-id"]
        : undefined;
    const isIdentifier =
      theoremDefId === undefined &&
      node.tagName === "span" &&
      node.properties?.["data-token-role"] !== "control_atom" &&
      (node.properties?.["data-kind"] === "identifier" ||
        node.properties?.["data-kind"] === "stdlib" ||
        node.properties?.["data-kind"] === "notation");
    const mountsIdentifierSpan = isIdentifier || theoremDefId !== undefined;
    // Inside a decorated identifier in slice mode, strip Shiki's inline `color`
    // from descendant grammar spans so they inherit `.sliceIdentifier`'s color.
    const childOpts: RenderHastOpts =
      opts.colorIdentifiers && mountsIdentifierSpan
        ? { ...opts, _stripColor: true }
        : opts;
    const children = node.children.map((child, i) =>
      renderHast(child, i, childOpts),
    );
    if (mountsIdentifierSpan) {
      // `stdlib` is post-resolver-rewrite: the API rewrites unresolved
      // qualified-name identifier tokens to `kind: "stdlib"`. We still
      // mount the IdentifierSpan so hover/focus popover, keyboard focus,
      // and the `.ce-identifier` class survive the rewrite. The click is
      // suppressed by IdentifierSpan.activate's early-return when defId
      // is undefined — stdlib tokens carry no def_id, so they remain
      // non-clickable without an extra branch here.
      return (
        <IdentifierSpan
          key={key}
          node={node}
          sliceMode={opts.colorIdentifiers}
          defIdOverride={theoremDefId}
        >
          {children}
        </IdentifierSpan>
      );
    }
    // Import/open file-reference spans become navigation links — a real <a>
    // that SPA-pushes to `/f/<target>` (NOT the side panel). Distinct from
    // identifier spans both in render (anchor vs span) and behaviour.
    if (
      node.tagName === "span" &&
      node.properties?.["data-kind"] === "file-ref"
    ) {
      return (
        <FileRefLink key={key} node={node}>
          {children}
        </FileRefLink>
      );
    }
    // A search-query hit span (the optional `marks` decorations the
    // highlight-slice route emits) renders as a real <mark> so it reads as a
    // highlight to assistive tech and matches the prototype's `<mark>` styling
    // (`.search-mark`). It layers on top of the grammar colouring — Shiki split
    // the underlying tokens at the mark boundaries, so the coloured children
    // still render inside the <mark>. No interaction wiring (it's not an
    // identifier / file-ref / keyword); its props (the `search-mark` class)
    // pass through verbatim.
    if (
      node.tagName === "span" &&
      node.properties?.["data-search-mark"] !== undefined
    ) {
      return (
        <mark {...hastPropsToReact(node.properties)} key={key}>
          {children}
        </mark>
      );
    }
    const elementProps = hastPropsToReact(node.properties);
    // Slice mode, inside an identifier: drop Shiki's inline `color` so the
    // grammar span inherits the `.sliceIdentifier` semantic color (no
    // `!important`). Other style (background, etc.) is preserved.
    if (
      opts._stripColor &&
      elementProps.style !== undefined &&
      elementProps.style !== null
    ) {
      const { color: _dropped, ...rest } = elementProps.style as Record<
        string,
        unknown
      >;
      elementProps.style = rest as React.CSSProperties;
    }
    // Slice mode, the ROOT `pre.shiki`: drop Shiki's inline block BACKGROUND
    // (`background-color: var(--base01)`) so the slice flows FLUSH on whatever
    // surface the host supplies. A slice is INLINE content — its surface is the
    // container's concern (the side panel's `.codeSurface` and the file body
    // each paint their own `--base01`; the profile axiom rows + search heroes
    // want it transparent). Shiki stamps that background INLINE, which beats the
    // consumers' non-`!important` `pre.shiki { background: transparent }` resets
    // — so an AXIOM's type slice (the only signature part rendered through
    // ShikiSlice; the `axiom <name>` prefix is a flush TokenTreeView) sat on a
    // distinct `--base01` block while the keyword/name stayed neutral. Dropping
    // it here, at the single slice-render seam, neutralises it for every
    // consumer without touching the file body (which never sets
    // `colorIdentifiers`, so it keeps its Shiki background). Only the background
    // is removed; token text colours are untouched.
    if (
      opts.colorIdentifiers &&
      node.tagName === "pre" &&
      elementProps.style !== undefined &&
      elementProps.style !== null
    ) {
      const {
        background: _bg,
        backgroundColor: _bgc,
        ...rest
      } = elementProps.style as Record<string, unknown>;
      elementProps.style = rest as React.CSSProperties;
    }
    return React.createElement(
      node.tagName,
      { ...elementProps, key },
      children,
    );
  }
  // comment / doctype — nothing to render.
  return null;
}
