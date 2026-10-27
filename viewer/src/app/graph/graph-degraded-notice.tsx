"use client";

// An overlay on the stage: it adds a sentence, and never replaces the poster
// underneath. Every string comes from `graph-degraded.ts`, never from here.

import { graphDegradedCopy, type GraphDegradedReason } from "./graph-degraded";

const OVERLAY_CARD =
  "pointer-events-auto max-w-sm rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur-sm";

/** The in-stage degraded notice. `onRetry` is offered only where the catalogue
 *  says a restore is possible. */
export function GraphDegradedNotice({
  reason,
  onRetry,
}: {
  reason: GraphDegradedReason;
  onRetry?: () => void;
}) {
  const copy = graphDegradedCopy(reason);

  return (
    <div
      // The stage's bottom HUD column owns the anchoring, the z-index and the
      // `pointer-events-none`; the card takes pointer events back for its button.
      className="flex justify-start"
    >
      <div role="status" className={OVERLAY_CARD}>
        <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
          {copy.headline}
        </p>
        <p className="mt-1 font-serif text-xs leading-relaxed text-muted-foreground">
          {copy.detail}
        </p>
        {copy.restorable && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-sm font-mono text-[0.6875rem] uppercase tracking-widest text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
