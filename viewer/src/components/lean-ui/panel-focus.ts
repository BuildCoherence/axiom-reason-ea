// Pure focus kernel behind `panel-shell.tsx`: the shell imports a CSS module and
// `@/…` aliases, neither of which the unit runner can resolve.

/** Focus-on-open target. `:not([disabled])` is load-bearing: the marker sits on both Back and Close, and Back is disabled on a fresh deep link. */
export const PANEL_FOCUS_FIRST_SELECTOR =
  "[data-panel-focus-first]:not([disabled])";

/** Marker attribute name, exported so a host-supplied mobile container can stamp its own close control. */
export const PANEL_FOCUS_FIRST_ATTR = "data-panel-focus-first";

/** True when the host supplied a `renderMobileContainer`; derived to a boolean because the render-prop's identity changes every render and this sits in three effect dependency arrays. */
export function hasPanelMobileContainer(
  renderMobileContainer: unknown,
): boolean {
  return typeof renderMobileContainer === "function";
}

/** True when the shell itself owns the mobile container; every one of the shell's four mobile-specific branches must gate on this, or the escape hatch is unreachable. */
export function shellOwnsMobileSheet(
  isMobile: boolean,
  hasMobileContainer: boolean,
): boolean {
  return isMobile && !hasMobileContainer;
}

/** True when the host's mobile container is the tree actually rendering — a distinct question from whether one was supplied, since the render-prop is passed unconditionally. */
export function hostOwnsMobileContainer(
  isMobile: boolean,
  hasMobileContainer: boolean,
): boolean {
  return isMobile && hasMobileContainer;
}

/** Value for the shell's own marker attribute; `undefined` (omitted) when the host renders its container, since exactly one marker may be live in a rendered tree. */
export function panelFocusFirstMarker(
  hostRendersContainer: boolean,
): "" | undefined {
  return hostRendersContainer ? undefined : "";
}

/** Move focus to the first enabled marked control inside `root`; the markers live in the chrome header, outside `data-side-panel-body`, so `root` must be the whole pane. */
export function focusFirstPanelControl(
  root: ParentNode | null,
): HTMLElement | null {
  if (root === null) return null;
  const first = root.querySelector<HTMLElement>(PANEL_FOCUS_FIRST_SELECTOR);
  if (first === null) return null;
  first.focus();
  return first;
}

/** Restore focus to the panel's invoker; `preventDefault` fires only when a live target exists, so a stale invoker leaves Radix's own close-focus behaviour intact. */
export function restorePanelInvokerFocus(
  restoreFocusRef: { current: HTMLElement | null },
  preventDefault?: () => void,
): boolean {
  const target = restoreFocusRef.current;
  let restored = false;
  if (target !== null && target.isConnected) {
    preventDefault?.();
    target.focus();
    restored = true;
  }
  restoreFocusRef.current = null;
  return restored;
}
