"use client"

// shadcn `collapsible` primitive, adapted to the Axiom theme foundation —
// same posture as the existing `sheet.tsx` wrapper (radix-ui aggregate
// namespace import, `cn()` for class composition).
//
// Collapsible has no `Content`-side animation by default — Radix exposes
// `data-[state]` attributes the consumer can drive an animation against,
// but we keep this v1 wrapper minimal: the side-panel's "Value" section
// is the single v1 consumer, where the expand/collapse is a layout shift
// the visitor initiates and a snap-open is acceptable. A future revision
// can layer a height animation here without touching the consumer.

import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
