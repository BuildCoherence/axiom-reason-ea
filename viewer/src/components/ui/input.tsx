// shadcn `input` primitive, adapted to the Axiom theme foundation.
//
// Focus ring uses the foundation's `outline-*` + `outline-[var(--ring)]`
// convention (NOT shadcn's default `ring-*`) so the indicator survives
// Windows High Contrast Mode — same rationale as ui/button.tsx. Surface/border
// tokens (`bg-background`, `border-border`) resolve per active palette.

import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
        "motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "aria-[invalid=true]:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
