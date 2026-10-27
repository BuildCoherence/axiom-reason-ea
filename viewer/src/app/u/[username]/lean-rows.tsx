"use client";

// Highlighted declaration rendering for the profile lists (D23). These mirror
// the production `profile-body.tsx` helpers (declSignatureTree /
// axiomSignatureTree / theoremSignatureTree) so the lists render real Lean —
// `axiom <name> : <prop>` / `theorem <name> : <prop>` — through the real
// `TokenTreeView` (empty / delab) and `ShikiSlice` (author / verbatim source
// bytes). The only list-specific addition is `WhenVisible`, which defers each
// author-view `ShikiSlice` mount until the row scrolls near the viewport, so a
// 140-axiom list doesn't fire 140 highlight requests on mount.
//
// Held propositions keep proposition identity as their membership truth but are
// FACED by a representative declaration (D26). `TheoremDecl` renders
// `theorem <repName> : <p>` — `<repName>` is the leaf of the representative's FQ
// name (clickable → `?def=<representative.def_id>`, like an axiom row's name) and
// `<p>` is the representative-phrasing conclusion (held_propositions.items[].p)
// through `TokenTreeView` in BOTH views (a proposition is never a `ShikiSlice` —
// it has no file source). The held-prop ROW also opens `?def=<representative.def_id>`.

import * as React from "react";

import { byteSlice } from "@/components/lean-ui/ce-file-decorations";
import { ShikiSlice } from "@/components/lean-ui/shiki-slice";
import { TokenTreeView } from "@/components/lean-ui/token-tree";
import type { Decl, TokenTree, ViewChoice } from "@/components/lean-ui/types";

import type { HeldProposition } from "./profile-body";
import styles from "./lean-rows.module.css";

type IdentifierClick = (target: { def_id: string; qualified_name: string }) => void;

function leafName(qualifiedName: string): string {
  const idx = qualifiedName.lastIndexOf(".");
  return idx >= 0 ? qualifiedName.slice(idx + 1) : qualifiedName;
}

// Compose `<keyword> <name> : <body>` for one decl, rendered through a single
// TokenTreeView so the NAME reuses the renderer's click/styling path. Mirrors
// profile-body.tsx. The name's surface text is the bare local name in author
// view, the fileId-qualified name in empty view. `defId === null` (a held
// proposition has no clickable def) renders the name as plain text — the tag's
// `def_id` is null, so the renderer suppresses the click, and selection is the
// row's `?prop=` job.
function declSignatureTree(args: {
  keyword: string;
  defId: string | null;
  localName: string;
  qualifiedName: string | null;
  view: ViewChoice["kind"];
  body?: TokenTree;
}): TokenTree {
  const { keyword, defId, localName, qualifiedName, view, body } = args;
  const displayName = view === "empty" ? (qualifiedName ?? localName) : localName;
  const tokenIdBase = defId ?? localName;
  const children: TokenTree[] = [
    {
      node: "tag",
      tag: {
        kind: "keyword",
        text: keyword,
        qualified_name: null,
        def_id: null,
        token_id: `${tokenIdBase}::sig::kw`,
        hover_kind: null,
        binder_role: null,
        inlined_type_summary: null,
      },
      child: { node: "text", text: keyword },
    },
    { node: "text", text: " " },
    {
      node: "tag",
      tag: {
        kind: "identifier",
        text: displayName,
        qualified_name: qualifiedName,
        def_id: defId,
        token_id: `${tokenIdBase}::sig::name`,
        hover_kind: "term",
        binder_role: "def_site",
        inlined_type_summary: null,
      },
      child: { node: "text", text: displayName },
    },
  ];
  if (body !== undefined) {
    children.push({ node: "text", text: " : " }, body);
  }
  return { node: "append", children };
}

function axiomSignatureTree(decl: Decl, view: ViewChoice["kind"]): TokenTree {
  const pair = decl.value_tokens ?? decl.type_tokens;
  return declSignatureTree({
    keyword: "axiom",
    defId: decl.def_id,
    localName: decl.local_name,
    qualifiedName: decl.qualified_name,
    view,
    body: pair !== null ? (pair[view] ?? undefined) : undefined,
  });
}

// Compose `theorem <repName> : <p>` for one held proposition. D26: the row is
// FACED by the representative declaration — its name (leaf of the FQ
// `representative.name`) labels the row and `?def=<representative.def_id>` is the
// clickable target (the name is a real def reference, like an axiom row's name).
// `<p>` is the representative-phrasing conclusion body; the null-guard degrades a
// missing phrasing (`p[view]` and the whole pair carrying an absent signal) to a
// bare `theorem <repName>`.
function theoremSignatureTree(hp: HeldProposition, view: ViewChoice["kind"]): TokenTree {
  const rep = hp.representative;
  return declSignatureTree({
    keyword: "theorem",
    defId: rep.def_id,
    localName: leafName(rep.name),
    qualifiedName: rep.name,
    view,
    // `hp.p` is null when the proposition resolved no representative phrasing;
    // `?.` degrades that (and an absent per-view tree) to a bare `theorem <name>`.
    // Author-view fallback to the empty tree: a held proposition backed by a
    // compiler-synthesized decl (a structure-field projection, `.rec`, etc.)
    // has no author/source view — the validator emits empty-only tokens
    // (`p.author` null, `p.empty` present). Falling back to `p.empty` keeps the
    // proposition rendered in author view instead of degrading to a bare name.
    body: hp.p?.[view] ?? hp.p?.empty ?? undefined,
  });
}

// Render `children` only once the wrapper scrolls within `rootMargin` of the
// viewport; until then render `fallback`. Latches once visible (disconnects).
// Used to defer per-row ShikiSlice highlight fetches to the on-screen rows.
function WhenVisible({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (el === null || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return (
    <span ref={ref}>{visible ? children : fallback}</span>
  );
}

// One axiom's `axiom <name> : <prop>`. Author view renders the proposition from
// verbatim source bytes (ShikiSlice, gated by visibility); empty view and the
// no-source fallback use the delab TokenTreeView path. The author-view source
// is the WHOLE-file content for the axiom's home file
// (`file_content_by_file[file_id]`), sliced over `decl_val_byte_range` by
// `ShikiSlice`. Mirrors profile-body's AxiomRow.
export function AxiomDecl({
  decl,
  view,
  source,
  onIdentifierClick,
}: {
  decl: Decl;
  view: ViewChoice["kind"];
  source: string | undefined;
  onIdentifierClick: IdentifierClick;
}) {
  const useSourceBytes =
    view === "author" && decl.decl_val_byte_range !== null && source !== undefined;

  if (!useSourceBytes) {
    return (
      <TokenTreeView
        tree={axiomSignatureTree(decl, view)}
        onIdentifierClick={onIdentifierClick}
      />
    );
  }

  const prefix = declSignatureTree({
    keyword: "axiom",
    defId: decl.def_id,
    localName: decl.local_name,
    qualifiedName: decl.qualified_name,
    view,
  });
  const range = decl.decl_val_byte_range!;
  return (
    <span className={styles.code}>
      <TokenTreeView tree={prefix} onIdentifierClick={onIdentifierClick} />
      {" : "}
      <WhenVisible fallback={<span className="text-muted-foreground">{byteSlice(source!, range)}</span>}>
        <ShikiSlice
          source={source!}
          range={range}
          tokens={decl.source_tokens}
          onIdentifierClick={onIdentifierClick}
        />
      </WhenVisible>
    </span>
  );
}

// One held proposition's `theorem <name> : <p>`. Rendered from the
// representative-phrasing conclusion `p` through the delab `TokenTreeView` in
// BOTH views — a proposition has no source file, so it is never a `ShikiSlice`.
// A missing phrasing degrades to a bare `theorem <name>` (theoremSignatureTree's
// null-guard).
export function TheoremDecl({
  proposition,
  view,
  onIdentifierClick,
}: {
  proposition: HeldProposition;
  view: ViewChoice["kind"];
  onIdentifierClick: IdentifierClick;
}) {
  return (
    <TokenTreeView
      tree={theoremSignatureTree(proposition, view)}
      onIdentifierClick={onIdentifierClick}
    />
  );
}
