// shadcn `button` primitive, adapted to the Axiom theme foundation.
//
// Two adaptations from the stock shadcn new-york Button, both to stay
// consistent with what the foundation already established across the
// hand-rolled controls this component replaces:
//
//   1. Focus ring uses `outline-*` + `outline-[var(--ring)]`, NOT shadcn's
//      default `ring-*`. The foundation deliberately uses outline (not
//      box-shadow/ring) so the focus indicator survives Windows High
//      Contrast Mode — see axiom-web-theme-foundation.md § Focus rings.
//   2. Variants are a plain lookup + `cn()` rather than `class-variance-
//      authority`. cva is the stock shadcn dependency, but adding it would
//      force a flake `npmDepsHash` bump for one small helper; a typed
//      lookup composed through `cn()` is the same abstraction without the
//      new dependency. `buttonVariants()` keeps the cva-style call shape
//      (`buttonVariants({ variant, size })`) so `asChild` consumers read
//      the same as upstream shadcn.
//
// `asChild` (Radix `Slot`) lets a `next/link` <Link> or a Radix trigger
// adopt the button styling without nesting an <a> inside a <button> — the
// idiom for nav links and `<SheetTrigger asChild>`.

import * as React from "react"
import { Slot as SlotPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type ButtonVariant =
  | "default"
  | "ghost"
  | "outline"
  | "destructive"
  | "destructive-outline"
type ButtonSize = "default" | "sm" | "lg" | "icon"

// Shared base: layout + radius + the foundation's outline focus-ring
// convention + the disabled posture. `motion-safe:` gates the colour
// transition so prefers-reduced-motion users get an instant swap.
const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md text-sm font-medium motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50"

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
  outline:
    "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  // GitHub's SSH-key Delete pattern: red border + red text + transparent
  // background at idle, solid destructive on hover. Use for idle triggers
  // of confirm-gated destructive actions where solid `destructive` would
  // be too loud at rest (Revoke / Delete / Disconnect at idle); the
  // confirm step escalates to solid `destructive`.
  "destructive-outline":
    "border border-destructive text-destructive bg-background hover:bg-destructive hover:text-destructive-foreground",
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: "px-3 py-2",
  sm: "h-8 px-3",
  // `lg` is the landing-page CTA size (hero primary, pricing tier CTAs,
  // email-signup submit) — fixed 40px height + 20px horizontal padding.
  lg: "h-10 px-5",
  icon: "h-9 w-9",
}

export function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}) {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)
}

export type ButtonProps = React.ComponentProps<"button"> & {
  variant?: ButtonVariant
  size?: ButtonSize
  // Render the styling onto the single child element instead of a <button>
  // (Radix Slot). Used for <Link> nav entries and Radix triggers.
  asChild?: boolean
}

export function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? SlotPrimitive.Root : "button"
  return (
    <Comp
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}
