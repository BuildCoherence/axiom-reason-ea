"use client";

// ThemeProvider — React-state owner for the theme orchestration. See
// design § ThemeProvider Client Component and § Why the post-hydration
// sync exists for the authoritative description.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemeSelection,
  DEFAULT_MODE,
  DEFAULT_PALETTE,
  KNOWN_MODES,
  KNOWN_PALETTES,
  SSR_RESOLVED_MODE,
  STORAGE_KEY_MODE,
  STORAGE_KEY_PALETTE,
  type ResolvedMode,
  type ThemeMode,
  type ThemePalette,
} from "@/lib/theme/apply-theme";

type ThemeState = {
  mode: ThemeMode;
  palette: ThemePalette;
  resolvedMode: ResolvedMode;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: ThemePalette) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

// Per-read guard mirrors the safeGet helper in pre-paint-script.ts — Safari
// private mode and storage-disabled environments throw on getItem; one key's
// failure must not suppress the other's value.
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") {
    return DEFAULT_MODE;
  }
  const stored = safeGet(STORAGE_KEY_MODE);
  return (KNOWN_MODES as readonly string[]).includes(stored ?? "")
    ? (stored as ThemeMode)
    : DEFAULT_MODE;
}

function readStoredPalette(): ThemePalette {
  if (typeof window === "undefined") {
    return DEFAULT_PALETTE;
  }
  const stored = safeGet(STORAGE_KEY_PALETTE);
  return (KNOWN_PALETTES as readonly string[]).includes(stored ?? "")
    ? (stored as ThemePalette)
    : DEFAULT_PALETTE;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initial state matches SSR (DEFAULT_*); post-mount effect below
  // catches up from localStorage. See design § ThemeProvider.
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [palette, setPaletteState] = useState<ThemePalette>(DEFAULT_PALETTE);
  // Seeded from the SSR-stable constant, NOT `resolveMode(DEFAULT_MODE)`: that
  // call reads `matchMedia`, which exists on the client and not on the server,
  // so it would hand the hydration render "dark" for a dark-preference visitor
  // while SSR rendered "light" — a hydration mismatch for any consumer that
  // derives markup from `resolvedMode` during render. The real resolved mode
  // arrives in the post-hydration sync below, one commit later. See design
  // § Why the post-hydration sync exists.
  const [resolvedMode, setResolvedMode] =
    useState<ResolvedMode>(SSR_RESOLVED_MODE);
  // Polite SR announcement for the one theme change the user did NOT initiate
  // in this tab: a cross-tab flip via the storage listener below. Local toggles
  // are already self-announced by <ThemeToggle />'s accessible name, so this
  // stays empty for them — only the storage handler writes here.
  const [crossTabAnnouncement, setCrossTabAnnouncement] = useState("");

  const setMode = useCallback(
    (next: ThemeMode) => {
      const nextResolved = applyThemeSelection(next, palette);
      setModeState(next);
      setResolvedMode(nextResolved);
    },
    [palette],
  );

  const setPalette = useCallback(
    (next: ThemePalette) => {
      const nextResolved = applyThemeSelection(mode, next);
      setPaletteState(next);
      setResolvedMode(nextResolved);
    },
    [mode],
  );

  // Post-hydration sync: catch state up from localStorage and re-stamp
  // <html>. See design § Why the post-hydration sync exists.
  useEffect(() => {
    const storedMode = readStoredMode();
    const storedPalette = readStoredPalette();
    setModeState(storedMode);
    setPaletteState(storedPalette);
    setResolvedMode(applyThemeSelection(storedMode, storedPalette));
  }, []);

  useEffect(() => {
    // matchMedia listener — system-preference follow when mode === "system".
    // We read from localStorage (not React state) inside the handler because
    // the listener may fire AFTER a sibling tab wrote a new value but BEFORE
    // this tab's React state caught up via the storage event. localStorage is
    // the source of truth, per
    // user-flow/theme-follows-system-preference.md § What happens client-side.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onMediaChange = () => {
      const currentMode = readStoredMode();
      if (currentMode !== "system") {
        // Explicit light/dark wins — short-circuit per user flow step 4.
        return;
      }
      const currentPalette = readStoredPalette();
      const nextResolved = applyThemeSelection(currentMode, currentPalette);
      setResolvedMode(nextResolved);
    };
    mql.addEventListener("change", onMediaChange);

    // storage listener — picks up writes from sibling tabs. The writer tab
    // does NOT receive its own storage event, so this only fires cross-tab.
    // applyThemeSelection also writes back to localStorage; in this path
    // those writes are setItem-with-unchanged-value, which Chrome/Firefox/
    // Safari all suppress without firing a fresh `storage` event (the spec
    // does not strictly require this, but every major engine ships it).
    // Keeping the redundant call centralizes write logic in one helper; if
    // the no-event guarantee weakens we'd factor `applyThemeSelection` into
    // apply-only + write-only halves and call apply-only here.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY_MODE && e.key !== STORAGE_KEY_PALETTE) {
        return;
      }
      const nextMode = readStoredMode();
      const nextPalette = readStoredPalette();
      const nextResolved = applyThemeSelection(nextMode, nextPalette);
      setModeState(nextMode);
      setPaletteState(nextPalette);
      setResolvedMode(nextResolved);
      // Announce the otherwise-silent cross-tab flip so SR users aren't
      // surprised by a repaint they didn't trigger here. Names the
      // selection (mode) and the resolved appearance when they differ
      // (mode === "system").
      setCrossTabAnnouncement(
        nextMode === "system"
          ? `Theme changed to system (${nextResolved}) in another tab`
          : `Theme changed to ${nextMode} in another tab`,
      );
    };
    window.addEventListener("storage", onStorage);

    // Symmetric cleanup — avoids zombie handlers under dev hot-reload per
    // design § ThemeProvider Client Component.
    return () => {
      mql.removeEventListener("change", onMediaChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return (
    <ThemeContext.Provider
      value={{ mode, palette, resolvedMode, setMode, setPalette }}
    >
      {children}
      {/* Visually-hidden live region for cross-tab theme flips. */}
      <span role="status" aria-live="polite" className="sr-only">
        {crossTabAnnouncement}
      </span>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
