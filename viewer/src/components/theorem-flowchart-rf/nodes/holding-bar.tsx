import * as React from "react";

import { FORMAL_STANCE_GLYPHS } from "@/lib/formal-stance-glyphs";

import styles from "./nodes.module.css";

// The aggregate-holdings PROPORTION BAR shown in a proposition card's footer
// (design change #1) — replaces the old ⊢n / ¬n chip badges. It shows the
// pro/con split across ALL users (distinct from the per-viewer stance shown on
// the card outline + corner symbol):
//   ⊢ {pro}  |■■■■■░░░|  ¬ {con}
// The bar is filled GREEN from the LEFT proportional to `pro` and RED from the
// RIGHT proportional to `con`. When both sides are present the two segments are
// separated by a ~5px NEUTRAL gap centered on the meet point — a COLOR-BLIND cue
// so the boundary reads by spacing, not the green→red change alone (WCAG 1.4.1);
// at an extreme (one side 0) one fill spans the track with no gap. Symbols: ⊢
// (U+22A2 turnstile, "held") for pro, ¬ (U+00AC, the logical
// not Lean prints) for con — the SAME glyphs the viewer-stance corner symbol
// uses, so the two readings rhyme.
//
// EMPTY state (design fix #1): when NOBODY has weighed in (pro === 0 &&
// con === 0) the bar renders a NEUTRAL/empty affordance instead of a fully-red
// fill — a bare muted track with muted ⊢0 / ¬0 counts — so it reads "no holders
// yet" rather than "everyone rejects". Any holders ⇒ the green/red split.
//
// The whole bar is a <button>: a click affordance (hover state + cursor:pointer)
// that opens the Holding provenance drill-in (the production page's holders
// modal). It invokes `onBadgeActivate({ side, proposition_id, count, element })`
// — the SAME callback the production `flowchart-node.tsx` Holding badges fire, so
// this RF renderer is a drop-in for the live component's badge-activation seam.
// A single whole-bar click defaults to `side: "pro"` with `count = holdings.pro`
// (the modal shows BOTH sides regardless of which side opened it); `element` is
// the clicked bar so the host can anchor the drill-in. The accessible name spells
// out the counts + the action ("48 hold, 40 reject — view holders") so SR users
// don't depend on color or the bare glyphs (WCAG 1.4.1 / 4.1.2): meaning is
// carried by the numbers + symbols, never color alone.
//
// READ-ONLY VARIANT (`readOnly`): the docked profile-list rows render this bar as
// their non-interactive subtitle — a plain `role="img"` element (NOT a <button>)
// with no onClick, so a click passes straight THROUGH to the ancestor ROW's
// handler (the row, not the bar, opens the side panel). It drops the cursor /
// hover / focus affordance and the "view holders" action wording. The default
// interactive path is unchanged for the graph-node / proposition-panel callers.

export function HoldingBar({
  propositionId,
  holdings,
  onBadgeActivate,
  readOnly = false,
}: {
  /** Resolved proposition id — the drill-in key the host opens the modal with. */
  propositionId: string;
  holdings: { pro: number; con: number };
  /**
   * A Holding badge was activated — host opens the provenance drill-in anchored
   * to `element`. Matches the production `flowchart-node.tsx` contract. A count
   * of 0 still fires (uniform affordance), so the button is never disabled.
   */
  onBadgeActivate?: (args: {
    side: "pro" | "con";
    proposition_id: string;
    count: number;
    element: HTMLElement;
  }) => void;
  /**
   * Render a NON-interactive bar (a plain `role="img"` wrapper, NOT a <button>):
   * no click/focus/button semantics and `cursor: default`. Critically it does
   * NOT capture or stop the surrounding click, so an ancestor row's onClick still
   * fires through it (the docked profile-list rows are the real click target).
   * Default `false` keeps the interactive graph-node / panel path unchanged.
   */
  readOnly?: boolean;
}) {
  const { pro, con } = holdings;
  const total = pro + con;
  // EMPTY state (design fix #1): a proposition NOBODY has held or rejected reads
  // as a NEUTRAL/empty affordance — a plain muted track with no green/red fill and
  // muted glyph-counts — rather than a fully-red bar (which mis-reads as "all
  // reject"). Nodes with ANY holders keep the green/red proportion split below.
  const isEmpty = total === 0;
  // Guard a 0/0 split (both segments empty rather than NaN%); the meet point is
  // the pro fraction of the total, so the green/red fills always sum to 100%.
  const proPct = total > 0 ? (pro / total) * 100 : 0;
  // COLOR-BLIND boundary cue (WCAG 1.4.1): separate the green pro fill and red con
  // fill with a fixed ~5px NEUTRAL GAP (the muted track background showing through)
  // so the boundary is conveyed by SPACING/shape — not the green→red color change
  // alone, which red/green-blind (deuteranopia) users can't distinguish. The gap is
  // split evenly off each fill (`GAP_PX / 2` each) and the track uses
  // `justify-content: space-between`, so the 5px stays centered exactly on the
  // `proPct` meet point (each fill recedes from it symmetrically) and the
  // proportional reading is preserved. The gap applies ONLY when BOTH sides are
  // present (`hasSplit`): at an extreme (one side === 0) a single fill spans the
  // whole track, so there is no boundary to mark — we drop the gap to avoid a
  // floating neutral sliver against a single color. The empty state (no fills) is
  // unaffected: a clean single muted track.
  const GAP_PX = 5;
  const hasSplit = pro > 0 && con > 0;
  // The interactive bar's accessible name carries the "view holders" ACTION; the
  // readOnly bar has no action, so it drops that suffix (the counts + glyphs still
  // carry the meaning). Keeping the suffix conditional leaves the interactive
  // label byte-for-byte identical to before.
  const label = isEmpty
    ? `No holders yet${readOnly ? "" : " — view holders"}`
    : `${pro} hold, ${con} reject${readOnly ? "" : " — view holders"}`;

  const inner = (
    <>
      <span
        className={`${styles.holdingCount} ${isEmpty ? styles.holdingCountEmpty : styles.holdingCountPro}`}
        aria-hidden="true"
      >
        <span className={styles.holdingGlyph}>
          {FORMAL_STANCE_GLYPHS.follows}
        </span>{" "}
        {pro}
      </span>
      <span
        className={`${styles.holdingTrack} ${isEmpty ? styles.holdingTrackEmpty : ""}`}
        aria-hidden="true"
      >
        {/* Empty ⇒ a bare muted track (no fill). Otherwise green from the left
         * (pro), red from the right (con); when both sides are present they are
         * separated by a ~5px neutral gap centered on the `proPct` meet point
         * (see `hasSplit` / `GAP_PX` above), so the boundary reads by SPACING, not
         * the green→red color change alone. At an extreme (one side 0) the single
         * fill spans the track with no gap. `space-between` on the track parks the
         * pro fill at the left and the con fill at the right and distributes the
         * shaved width as the centered gap. */}
        {isEmpty ? null : (
          <>
            <span
              className={styles.holdingFillPro}
              style={{
                width: hasSplit
                  ? `calc(${proPct}% - ${GAP_PX / 2}px)`
                  : `${proPct}%`,
              }}
            />
            <span
              className={styles.holdingFillCon}
              style={{
                width: hasSplit
                  ? `calc(${100 - proPct}% - ${GAP_PX / 2}px)`
                  : `${100 - proPct}%`,
              }}
            />
          </>
        )}
      </span>
      <span
        className={`${styles.holdingCount} ${isEmpty ? styles.holdingCountEmpty : styles.holdingCountCon}`}
        aria-hidden="true"
      >
        <span className={styles.holdingGlyph}>
          {FORMAL_STANCE_GLYPHS.negation}
        </span>{" "}
        {con}
      </span>
    </>
  );

  // readOnly: a NON-interactive, non-focusable element (role="img" → one labelled
  // graphic, like the count chips it replaces). No onClick → a click passes
  // straight through to the ancestor row's handler; cursor:default + no
  // hover/focus affordance (`.holdingBarStatic`). The visual track is identical.
  if (readOnly) {
    return (
      <div
        className={`${styles.holdingBar} ${styles.holdingBarStatic} ${isEmpty ? styles.holdingBarEmpty : ""} nodrag`}
        role="img"
        aria-label={label}
        title={label}
      >
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.holdingBar} ${isEmpty ? styles.holdingBarEmpty : ""} nodrag`}
      onClick={(e) =>
        // Whole-bar click → default to the pro side / pro count (the modal shows
        // both sides regardless); `element` is the clicked bar so the host can
        // anchor the provenance drill-in over it.
        onBadgeActivate?.({
          side: "pro",
          proposition_id: propositionId,
          count: pro,
          element: e.currentTarget,
        })
      }
      aria-label={label}
    >
      {inner}
    </button>
  );
}
