"use client"

// shadcn `resizable` primitive, adapted to the Axiom theme foundation —
// wraps `react-resizable-panels`. v1 has no consumer (the file page uses
// `Sheet` for the side panel chrome instead), but the primitive is
// installed per the Lean UI Component design's § "Library picks for v1"
// so a future surface (e.g. a desktop two-pane proposition page layout)
// can drop it in without an install round trip.
//
// Differences from stock shadcn new-york `resizable.tsx`:
//   1. Uses `lucide-react` for the grip icon (matches the icon-set rule
//      already established in sheet.tsx).
//   2. The handle uses the foundation's `outline-*` + `outline-[var(--ring)]`
//      focus-ring convention instead of shadcn's default `ring-*` (mirrors
//      button.tsx and sheet.tsx).

import * as React from "react"
import { GripVertical } from "lucide-react"
import { Group, Panel, Separator } from "react-resizable-panels"

import { cn } from "@/lib/utils"

// `react-resizable-panels` v4 renames the v3 exports:
//   PanelGroup       → Group
//   PanelResizeHandle → Separator
// Stock shadcn templates still reference the v3 names; we map them to v4
// at the wrapper boundary so consumers can keep the familiar
// `ResizablePanelGroup` / `ResizableHandle` shorthand from the design doc.

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({
  className,
  ...props
}: React.ComponentProps<typeof Panel>) {
  // `overflow-hidden` clips a child with intrinsic width (Shiki's
  // `pre.shiki` uses `width: max-content` so its themed background spans
  // the longest source line) at the panel's allotted bounds so horizontal
  // scroll is handled by the child's own `overflow-x` rather than blowing
  // the layout. `min-width: 0` itself is enforced by
  // `react-resizable-panels` v4 on the Panel outer div via its
  // `PROHIBITED_CSS_PROPERTIES` set — we don't repeat it here.
  return (
    <Panel
      data-slot="resizable-panel"
      className={cn("overflow-hidden", className)}
      {...props}
    />
  )
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
}) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        "data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full",
        "data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2",
        className
      )}
      {...props}
    >
      {/* No-op when withHandle is false. Uses lucide-react's GripVertical
       * — the same icon stock shadcn ships and the same icon set already
       * used by sheet.tsx / mobile-drawer / theme-toggle / cli-install-
       * banner. */}
      {withHandle ? (
        <div
          aria-hidden="true"
          className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border"
        >
          <GripVertical className="size-2.5" />
        </div>
      ) : null}
    </Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
