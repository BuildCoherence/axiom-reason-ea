import type { LayoutStorage } from "react-resizable-panels";

// SSR-safe storage shim for `react-resizable-panels`' `useDefaultLayout`. The
// hook defaults `storage` to a bare `localStorage` reference evaluated at call
// time — which throws `ReferenceError: localStorage is not defined` during
// Next's Client-Component server render. This lazy adapter replaces the default:
//   - during SSR (`typeof window === "undefined"`), get/set are no-ops; no
//     persisted layout is returned, so a consuming group renders with its
//     rem-based default size server-side.
//   - in the browser, get/set proxy to `window.localStorage` so persistence
//     works exactly as the stock default would.
// Both directions silent-fail: `localStorage` access can throw synchronously in
// sandboxed iframes / SecurityError-locked contexts, and writes can additionally
// throw QuotaExceededError (or SecurityError in Safari private mode). Width
// persistence is a nice-to-have — an uncaught throw here would bubble to the
// route error boundary and blow away the whole page over it.
//
// Shared by every workbench pane that persists its width (the lean-UI side
// panel shell, the Theorem Page info/canvas split) so the SSR-safety contract
// has one source of truth.
export const safeLayoutStorage: LayoutStorage = {
  getItem(key) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Silent fail — the pane just doesn't persist its width.
    }
  },
};
