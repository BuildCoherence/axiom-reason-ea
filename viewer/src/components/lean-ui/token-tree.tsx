"use client";

import * as React from "react";

import { SIDE_PANEL_ID } from "./types";
import type { TokenTag, TokenTree } from "./types";

// Re-export the pure notation-head derivation (defined CSS-free in
// notation-names.ts so the unit suite can cover it) for this module's React
// consumers, who already import from token-tree.
export { notationNamesFromSourceTokens } from "./notation-names";
import { KIND_CLASS_KEY } from "./token-tree-kind-class";
import styles from "./token-tree.module.css";

// Structured-token-tree renderer — the interactive sibling of `LeanCode`.
//
// Where `LeanCode` highlights raw source bytes via Shiki (the source-display
// slice on the file page body, see lean-code.tsx), this component renders the
// validator-extracted structured-token tree the design at
// the internal lean-ui-component doc § "Structured token tree" specifies.
// Each `node: "tag"` becomes one styled <span> that surfaces click and hover
// events back to the host page; pure text and append nodes are bare wrappers
// so the renderer never strips layout or per-leaf addressability. The host
// page composes scaffolding around per-decl regions; this component owns
// rendering of one tree only.
//
// CLIENT COMPONENT — the file carries `"use client"` because it attaches
// onClick / onMouseEnter / onFocus handlers. The host page may still be a
// Server Component that mounts `<TokenTreeView>` as a client island, the
// same boundary `LeanCode` lives behind today on the file page.
//
// EVENTS — kept aligned with the design's `Component outputs (events)`:
//   - `onIdentifierClick({ def_id, qualified_name })` fires on any tag with a
//     non-null `def_id`. The renderer suppresses the event for `def_id ===
//     null` tags (stdlib / prelude refs); there is no in-CE target to open.
//   - `onIdentifierHover({ tag, element })` fires on tag mouseEnter AND tag
//     focus (keyboard tab into a clickable tag). Carries the full tag
//     metadata plus the trigger DOM element so the host can anchor a
//     popover over it via Radix's `virtualRef`. The renderer does NOT
//     debounce or filter — wire any throttling on the host.
//   - `onIdentifierLeave()` fires on mouseLeave AND blur. The host clears
//     the popover anchor target. Both events fire so keyboard tab-away
//     dismisses the popover symmetrically with pointer leave.
//
// CLICK BUBBLING — per the design's § "Tag placement" and the spike's Q4
// finding (§ 5 of the token-tree spike), nested application tags repeat the
// head identifier's metadata at every sub-application level. The renderer
// must let the INNERMOST click win — the user's click on a nested identifier
// inside `OtherFx.helper 4` should open the panel at the inner identifier,
// not at the outer application's head. We achieve this with
// `event.stopPropagation()` inside every tag's onClick (the simpler of the
// two equivalent strategies the design names; the alternative is a
// `closest('[data-def-id]')` walk).

export interface TokenTreeProps {
  /** The structured-token tree to render. */
  tree: TokenTree;
  /**
   * Fires when the visitor clicks a tag whose `def_id` is non-null. Tags
   * with `def_id === null` (stdlib / prelude refs) suppress the click per
   * the design's § "Tag placement"; the host is not notified.
   */
  onIdentifierClick?: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  /**
   * Fires on mouseEnter AND focus for any tag. Carries the full leaf
   * metadata plus the trigger DOM element the host can anchor a popover
   * over (Radix's `PopperAnchor virtualRef` consumes element directly).
   * The renderer does NOT debounce or filter — wire any throttling on
   * the host.
   */
  onIdentifierHover?: (target: {
    tag: TokenTag;
    element: HTMLElement;
  }) => void;
  /**
   * Fires on mouseLeave AND blur for any tag the renderer previously
   * fired `onIdentifierHover` for. Both events fire so keyboard tab-away
   * dismisses the popover symmetrically with pointer leave.
   */
  onIdentifierLeave?: () => void;
  /**
   * Qualified names the caller has classified as NOTATION heads (derived from
   * the decl's `source_tokens`, which tag notation atoms with kind "notation").
   * A tag whose `qualified_name` is in this set paints through
   * `--ce-token-notation`, so a notation atom (`A`, `∃`, `∧`) colours the SAME
   * in this delaborated tree as it does in the source-bytes `ShikiSlice` render
   * — one classification source across both renderers (see token-tree.module.css
   * `.kindNotation`). Omit ⇒ no notation reclassification (the prior behaviour).
   */
  notationNames?: ReadonlySet<string>;
}

// Per-kind class lookup. Resolved at module-load by indexing the imported
// `styles` (CSS-Module) record at the keys named in `KIND_CLASS_KEY`. The
// key table lives in its own pure module — see `./token-tree-kind-class.ts`
// — so the unit suite can verify the mapping shape without standing up
// CSS-Module resolution. Keeping this as a typed `Record<TokenTag["kind"]>`
// gives the type checker a hand verifying every union value has a matching
// class — change the union in types.ts and a missing entry here is a
// compile error.
const KIND_CLASS: Record<TokenTag["kind"], string> = {
  identifier: styles[KIND_CLASS_KEY.identifier],
  keyword: styles[KIND_CLASS_KEY.keyword],
  op: styles[KIND_CLASS_KEY.op],
  literal: styles[KIND_CLASS_KEY.literal],
  string: styles[KIND_CLASS_KEY.string],
  comment: styles[KIND_CLASS_KEY.comment],
  whitespace: styles[KIND_CLASS_KEY.whitespace],
  stdlib: styles[KIND_CLASS_KEY.stdlib],
  type: styles[KIND_CLASS_KEY.type],
};

// Compose the class list for one tag. The base `.tag` class is always
// present; the per-kind class is the colour driver; the binder-role
// sub-styling and the clickable / stdlib affordance classes are
// IDENTIFIER-ONLY layers on top — only `kind: "identifier"` tags carry
// the binder-role colour (def_site vs use_site), the in-CE clickable
// affordance, or the stdlib muted treatment.
//
// CRITICAL — the binder-role guard. The validator emits `binder_role`
// for every `.ofTermInfo` tag, including ones whose `kind` is `"op"`
// (the whole `Type → Type → Prop` chain delaborates as a `forallE`
// whose `getAppFn` isn't a `.const` / `.fvar` / `.lit`, so `kindOf`
// returns `"op"`; and `Type` / `Prop` themselves are `Sort` literals,
// also `"op"`). If we applied `binderUseSite` to those op-kind tags,
// the `.binderUseSite` rule — declared LATER than `.kindOp` in
// `token-tree.module.css` — would override the op colour at equal
// specificity, collapsing the whole signature into the use-site
// muted-foreground slot (`--ce-token-binder-usesite` → `--base04`).
// That's the recurring "panel syntax highlighting still not working"
// report: every tag in `Type → Type → Prop` ends up gray.
//
// Gating binder-role on `kind === "identifier"` keeps the
// def-site/use-site distinction where it makes semantic sense (it's
// about IDENTIFIER occurrences) and lets non-identifier kinds render
// in their own colour slot.
function tagClassName(
  tag: TokenTag,
  clickable: boolean,
  notationNames?: ReadonlySet<string>,
): string {
  // CO-2: surface unknown kinds as a dev-only console.error so a future API
  // /validator widening that adds a kind we haven't taught `KIND_CLASS`
  // about is greppable (matching `ce-file-body.tsx` / `shiki-slice.tsx`'s
  // peer-module posture). Production stays silent to avoid noise.
  const kindClass = KIND_CLASS[tag.kind];
  if (kindClass === undefined && process.env.NODE_ENV !== "production") {
    console.error(
      `TokenTreeView: no KIND_CLASS entry for tag.kind="${tag.kind}" (token_id=${tag.token_id}); add it to KIND_CLASS in token-tree.tsx`,
    );
  }
  const classes: string[] = [styles.tag, kindClass];
  if (tag.kind === "identifier") {
    if (clickable) {
      classes.push(styles.clickable);
    } else if (tag.def_id === null && tag.qualified_name !== null) {
      // qualified_name is set but def_id is null → stdlib / prelude ref. The
      // design's § "Tag placement" specifies these are unclickable; the muted
      // `.stdlib` colour de-emphasises the out-of-CE reference.
      classes.push(styles.stdlib);
    }
    // A def_id-bearing tag with NO click handler wired (`clickable` false) — e.g.
    // the feed's display-only graph nodes — is intentionally neither clickable
    // nor stdlib: it renders as a plain identifier, with no dotted-underline /
    // side-panel affordance. The affordance is gated on an actual handler so it
    // never advertises an interaction (role="button", aria-controls=side panel)
    // that does nothing.
    if (tag.binder_role === "def_site") {
      classes.push(styles.binderDefSite);
    } else if (tag.binder_role === "use_site") {
      classes.push(styles.binderUseSite);
    }
  }
  // Notation reclassification — a tag whose head function the caller flagged as
  // a notation atom (via `source_tokens`) paints through `--ce-token-notation`,
  // matching the source-bytes ShikiSlice render. Pushed LAST so `.kindNotation`
  // (declared last in the CSS) wins over the kind / binder-role colour at equal
  // specificity. This is the tree side of the single-classification-source fix.
  if (
    notationNames !== undefined &&
    tag.qualified_name !== null &&
    notationNames.has(tag.qualified_name)
  ) {
    classes.push(styles.kindNotation);
  }
  // Filter falsy entries — CSS-Modules returns `undefined` for an unknown
  // key, which would render as the literal string "undefined" in the
  // className if joined directly.
  return classes.filter(Boolean).join(" ");
}

function isDeadEndFieldTag(tag: TokenTag): boolean {
  return tag.hover_kind === "field";
}

// Recursive renderer. Returns a `ReactNode` rather than a JSX element
// directly so we can return a fragment for `append` nodes (the design's
// concatenation case has no semantic wrapper of its own).
//
// `keyFromContext` — for `text` and `append` nodes that carry no `token_id`
// of their own, React still needs a stable key when they appear as a child
// in an `append` parent. We thread the array index from the parent down as
// a fallback. Tagged nodes always carry `token_id` (the validator's
// (decl_name, view, DFS-index)-derived stable key, see the design's leaf
// metadata `token_id` field) and use that as the key instead.
function renderNode(
  node: TokenTree,
  keyFromContext: string | number,
  onIdentifierClick: TokenTreeProps["onIdentifierClick"],
  onIdentifierHover: TokenTreeProps["onIdentifierHover"],
  onIdentifierLeave: TokenTreeProps["onIdentifierLeave"],
  notationNames: ReadonlySet<string> | undefined,
): React.ReactNode {
  if (node.node === "text") {
    // Bare text leaf — wrap in a <span> so DOM tooling and tests can
    // address every leaf uniformly. The wrapper carries no styling beyond
    // the no-op `.text` class.
    return (
      <span key={keyFromContext} className={styles.text}>
        {node.text}
      </span>
    );
  }
  if (node.node === "append") {
    // Fragment iterating children. Each child gets its own key — tagged
    // children prefer their `token_id`; text/append fall back to the array
    // index relative to this append.
    return (
      <React.Fragment key={keyFromContext}>
        {node.children.map((child, i) => {
          const childKey =
            child.node === "tag" ? child.tag.token_id : i;
          return renderNode(
            child,
            childKey,
            onIdentifierClick,
            onIdentifierHover,
            onIdentifierLeave,
            notationNames,
          );
        })}
      </React.Fragment>
    );
  }

  // node === "tag" — the interactive case. Build the span with full data
  // attributes (for selectors / tests / future style hooks), wire the
  // click / hover / focus handlers per the design, and recurse into the
  // child.
  const { tag, child } = node;
  // Clickable only when the tag resolves to a def AND the host actually wired a
  // click handler. A def_id without a handler (the feed's display-only graph
  // nodes) must NOT show a side-panel affordance — see tagClassName.
  const clickable =
    tag.def_id !== null &&
    onIdentifierClick !== undefined &&
    !isDeadEndFieldTag(tag);

  const handleClick: React.MouseEventHandler<HTMLSpanElement> | undefined =
    clickable
      ? (event) => {
          // Innermost-click-wins per design § "Tag placement" + spike § Q4.
          // Stop bubbling so an outer interior tag (e.g. an application
          // node carrying the head's qualified_name) does NOT also fire.
          event.stopPropagation();
          onIdentifierClick?.({
            def_id: tag.def_id as string,
            qualified_name: tag.qualified_name ?? tag.text,
          });
        }
      : undefined;

  // Hover/focus open the popover; leave/blur close it. Both pointer-side
  // (mouseEnter/mouseLeave) and keyboard-side (focus/blur) wire to the
  // same callbacks so the popover is accessible without a mouse —
  // restores the WCAG 2.1.1 commitment broken by the previous pointer-only
  // HoverCard. Skip when there is no qualified_name (binders / locals) —
  // there is nothing useful to display.
  const hoverActive =
    onIdentifierHover !== undefined && tag.qualified_name !== null;

  // Single handler shape used for both pointer (MouseEvent) and keyboard
  // (FocusEvent). Both events expose `currentTarget: HTMLSpanElement`,
  // which is all the popover host needs to anchor over the tag.
  const handleEnter:
    | ((
        event: React.SyntheticEvent<HTMLSpanElement>,
      ) => void)
    | undefined = hoverActive
    ? (event) => {
        onIdentifierHover!({ tag, element: event.currentTarget });
      }
    : undefined;

  const handleLeave: (() => void) | undefined = hoverActive
    ? () => {
        onIdentifierLeave?.();
      }
    : undefined;

  // Recurse into the child. The child's own keys are scoped under this
  // tag, but since this tag's <span> is the React-tree parent, the child's
  // key only needs to be unique among siblings inside this tag — which is
  // trivially satisfied (one child per tag, per the wire shape).
  const renderedChild = renderNode(
    child,
    0,
    onIdentifierClick,
    onIdentifierHover,
    onIdentifierLeave,
    notationNames,
  );

  return (
    <span
      key={tag.token_id}
      className={tagClassName(tag, clickable, notationNames)}
      data-token-id={tag.token_id}
      data-kind={tag.kind}
      data-def-id={tag.def_id ?? undefined}
      data-qualified-name={tag.qualified_name ?? undefined}
      // Make clickable tags keyboard-reachable so identifier navigation
      // works without a mouse — matches the focus-ring foundation already
      // exposed via .clickable:focus-visible in the CSS module.
      tabIndex={clickable ? 0 : undefined}
      // role="button" (not "link"): activating opens the in-page inspection
      // panel, it does not navigate. aria-haspopup="true" announces a popup
      // without promising a specific type — desktop renders the panel as a
      // docked <div role="region">, only mobile is a real Dialog; the panel's
      // own ARIA role communicates its semantics on open. aria-controls points
      // at the panel. aria-expanded is omitted (the open def is host state this
      // pure renderer can't see per-tag, so we don't stamp a stale value) —
      // kept in step with the server-decoration path in page.tsx buildDecorations.
      role={clickable ? "button" : undefined}
      aria-haspopup={clickable ? "true" : undefined}
      aria-controls={clickable ? SIDE_PANEL_ID : undefined}
      onClick={handleClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {renderedChild}
    </span>
  );
}

/**
 * Pure presentational renderer for one structured-token tree. The host
 * page owns URL state, fetching, popovers, side-panel chrome, and the
 * source-byte scaffolding around per-decl regions — this component just
 * paints one tree and surfaces interaction events.
 */
export function TokenTreeView({
  tree,
  onIdentifierClick,
  onIdentifierHover,
  onIdentifierLeave,
  notationNames,
}: TokenTreeProps) {
  return (
    <>
      {renderNode(
        tree,
        0,
        onIdentifierClick,
        onIdentifierHover,
        onIdentifierLeave,
        notationNames,
      )}
    </>
  );
}
