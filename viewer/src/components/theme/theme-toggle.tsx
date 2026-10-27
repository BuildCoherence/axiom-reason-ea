"use client";

// ThemeToggle — single-button three-state cycle (system → dark → light → system).
// See the internal axiom-web-theme-foundation doc § <ThemeToggle /> component
// for the authoritative description, and § Decisions § "Three-state cycle button"
// for why this is a cycle (not a dropdown) and why the icon represents the
// persisted selection (not the resolved mode).

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import type { ThemeMode } from "@/lib/theme/apply-theme";

// Cycle order: system → dark → light → system. Matching coherencelabs.net's
// marketing-site toggle (components/layout/ThemeToggle.tsx) — first click from
// `system` goes to DARK, not light, so an OS-dark visitor toggling away from
// `system` isn't flipped to the opposite of their OS. See design
// § Decisions § "Three-state cycle button".
function nextMode(current: ThemeMode): ThemeMode {
  switch (current) {
    case "system":
      return "dark";
    case "dark":
      return "light";
    case "light":
      return "system";
  }
}

// State-aware accessible name — names both the current selection and the
// click outcome. This is the screen-reader signal for state change per design
// § <ThemeToggle /> component a11y floor (aria-pressed is wrong for a
// three-state model; a future amendment may add an aria-live status element
// if usability evidence shows the label-only floor is insufficient).
function accessibleName(current: ThemeMode): string {
  return `Theme: ${current}. Click to switch to ${nextMode(current)}`;
}

export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    // size="icon" → h-9 w-9 = 36×36 CSS px, comfortably above the WCAG 2.2
    // SC 2.5.8 AA 24×24 minimum hit target per design § Interactive-state
    // conventions. The Button base carries the rest of the foundation
    // conventions: focus-visible outline (kept under Windows High Contrast
    // Mode) and motion-safe-gated colour transition (instant swap under
    // prefers-reduced-motion per design § Reduced motion).
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setMode(nextMode(mode))}
      aria-label={accessibleName(mode)}
    >
      {mode === "light" && <Sun className="h-4 w-4" aria-hidden="true" />}
      {mode === "dark" && <Moon className="h-4 w-4" aria-hidden="true" />}
      {mode === "system" && (
        <Monitor className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}
