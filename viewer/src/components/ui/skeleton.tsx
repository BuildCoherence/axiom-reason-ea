// shadcn `skeleton` primitive — a low-chroma rectangle that pulses while
// downstream content is in flight. Adapted to the Axiom theme foundation:
// the surface uses `bg-muted` (which the theme bridges to `--base02`)
// rather than shadcn's stock `bg-primary/10`, so the placeholder reads as
// "empty surface" against the panel's `--base00` body without competing
// with the brand colour.
//
// The `motion-safe:` gate keeps `prefers-reduced-motion: reduce` users on
// a still surface — the theme foundation's reduced-motion rule (see
// axiom-web-theme-foundation.md § Reduced motion). On reduced-motion the
// rectangle is still rendered, just not animated.

import * as React from "react";

import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "motion-safe:animate-pulse rounded-md bg-muted",
        className,
      )}
      {...props}
    />
  );
}
