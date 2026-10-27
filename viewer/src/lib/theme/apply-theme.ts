// Shared apply helper: the canonical post-hydration writer for the three-
// attribute theme write (data-mode, data-theme, style.colorScheme) plus the
// localStorage persistence pair. See the internal axiom-web-theme-foundation doc § Shared apply helper.
//
// Callers: the <ThemeToggle /> click handler, the storage event listener (for
// cross-tab sync), and the matchMedia change listener (for system-preference
// follow when mode === "system"). The pre-paint script in pre-paint-script.ts
// mirrors the same write set as a string — it runs before any module is loaded
// and can't import this helper.

import {
  DEFAULT_MODE,
  DEFAULT_PALETTE,
  KNOWN_MODES,
  KNOWN_PALETTES,
  STORAGE_KEY_MODE,
  STORAGE_KEY_PALETTE,
} from "./pre-paint-script";

export {
  DEFAULT_MODE,
  DEFAULT_PALETTE,
  KNOWN_MODES,
  KNOWN_PALETTES,
  STORAGE_KEY_MODE,
  STORAGE_KEY_PALETTE,
};

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";
// v1 has a single palette; the type widens when additional palettes ship.
export type ThemePalette = "axiom";

// The resolved mode the SERVER render produces: `resolveMode(DEFAULT_MODE)`
// with no `matchMedia` to consult falls through to "light". Client state that
// must hydrate byte-identically to SSR seeds from this constant rather than
// calling `resolveMode(DEFAULT_MODE)` — that call reads `matchMedia` in the
// browser and so returns "dark" for a dark-preference visitor on the FIRST
// client render, before any effect has run. `test/unit/ssr-resolved-mode.spec.ts`
// pins the two together so this cannot drift from `resolveMode`.
export const SSR_RESOLVED_MODE: ResolvedMode = "light";

export function resolveMode(mode: ThemeMode): ResolvedMode {
  if (mode !== "system") {
    return mode;
  }
  // matchMedia is guarded for non-browser callers (e.g., SSR import of a
  // constant from this module pulling the symbol in). In a real browser path
  // matchMedia is always defined.
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function applyThemeSelection(
  mode: ThemeMode,
  palette: ThemePalette,
): ResolvedMode {
  const resolved = resolveMode(mode);

  const html = document.documentElement;
  html.setAttribute("data-mode", resolved);
  html.setAttribute("data-theme", palette);
  html.style.colorScheme = resolved;

  // Per-write try/catch mirrors the per-read safeGet posture in the pre-paint
  // script: Safari private mode and storage-disabled environments throw on
  // setItem. Silent on failure — log noise in private mode is unhelpful, and
  // the user-facing tradeoff (preference doesn't survive reload) is documented
  // in user-flow/user-toggles-theme.md § "localStorage write-disabled
  // environments".
  try {
    localStorage.setItem(STORAGE_KEY_MODE, mode);
  } catch {
    // intentionally swallowed
  }
  try {
    localStorage.setItem(STORAGE_KEY_PALETTE, palette);
  } catch {
    // intentionally swallowed
  }

  return resolved;
}
