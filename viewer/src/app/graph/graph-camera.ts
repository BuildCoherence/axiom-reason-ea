// Pure: no `three`, no `window`, no `document` — the island's bundle boundary
// depends on it.

/** `globe` frames the whole cloud and idles; `inspect` targets the selection. */
export type GraphCameraMode = "globe" | "inspect";

/** `OrbitControls.autoRotateSpeed`, in ITS units: one revolution per `60 / speed` seconds. */
export const GRAPH_AUTO_ROTATE_SPEED = 0.8;

/** For delta-timed loops: `autoRotateSpeed` is applied per frame against an assumed 60fps. */
export const GRAPH_AUTO_ROTATE_RAD_PER_S =
  (2 * Math.PI * GRAPH_AUTO_ROTATE_SPEED) / 60;

/** Frame-delta ceiling in seconds: a backgrounded tab resumes with one huge delta. */
export const GRAPH_MAX_FRAME_DT_S = 0.05;

/** Dolly limits in world units; the scene is normalised into roughly ±1 (`graphSceneBasis`). */
export type GraphCameraLimits = {
  readonly minDistance: number;
  readonly maxDistance: number;
};

export const GRAPH_GLOBE_LIMITS: GraphCameraLimits = {
  // Safe below the cloud only because `zoomToCursor` moves the orbit target with
  // the camera; 0 would let the camera pass through the point it looks at.
  minDistance: 0.04,
  maxDistance: 6,
};

/** Inspect opens the dolly floor; the ceiling is shared with globe. */
export const GRAPH_INSPECT_LIMITS: GraphCameraLimits = {
  // Below any distance the fly-to fit can ask for (~0.05), or `OrbitControls`
  // clamps the flight straight back out on its next `update()`.
  minDistance: 0.04,
  maxDistance: 6,
};

export function graphCameraLimits(mode: GraphCameraMode): GraphCameraLimits {
  return mode === "inspect" ? GRAPH_INSPECT_LIMITS : GRAPH_GLOBE_LIMITS;
}

/** Gesture names; the caller maps them onto three's `TOUCH`, keeping this module `three`-free. */
export type GraphOrbitGesture = "rotate" | "dolly-rotate";

export type GraphOrbitConfig = {
  /** Right button only, and safe only because `clampGraphPanTarget` keeps the
   *  orbit target inside the cloud. */
  enablePan: boolean;
  enableRotate: true;
  enableZoom: true;
  /** Moves the camera down the pointer ray and re-places the target; three
   *  silently disables it for a non-perspective, non-orthographic camera. */
  zoomToCursor: boolean;
  /** Never true: damping needs an `update()` every frame, and the renderer
   *  draws only on change. */
  enableDamping: false;
  minDistance: number;
  maxDistance: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  /** `TWO` must be `dolly-rotate`: three's default `DOLLY_PAN` pans on a pinch. */
  touches: { ONE: GraphOrbitGesture; TWO: GraphOrbitGesture };
};

export type GraphOrbitConfigInput = {
  mode: GraphCameraMode;
  /** `prefers-reduced-motion`, a deep link, or any rung whose arrival is skipped. */
  reducedMotion: boolean;
  /** The visitor already took the camera earlier this visit. Carried in, because
   *  a scene rebuild (a theme toggle) creates fresh controls that would drift again. */
  autoRotateDismissed?: boolean;
};

/** Auto-rotate is globe-only and pre-interaction-only. */
export function graphOrbitConfig(
  input: GraphOrbitConfigInput,
): GraphOrbitConfig {
  const limits = graphCameraLimits(input.mode);
  return {
    enablePan: true,
    enableRotate: true,
    enableZoom: true,
    zoomToCursor: true,
    enableDamping: false,
    minDistance: limits.minDistance,
    maxDistance: limits.maxDistance,
    autoRotate:
      input.mode === "globe" &&
      !input.reducedMotion &&
      !input.autoRotateDismissed,
    autoRotateSpeed: GRAPH_AUTO_ROTATE_SPEED,
    touches: { ONE: "rotate", TWO: "dolly-rotate" },
  };
}

/** three's `TOUCH` enum, structurally — injected so this module stays `three`-free. */
export type GraphTouchConstants<T> = {
  ROTATE: T;
  DOLLY_ROTATE: T;
};

/** Orbit-target travel limit, as a multiple of the normalised cloud's radius (~1). */
export const GRAPH_PAN_TARGET_RADIUS = 1.35;

/** Clamp a panned orbit target inside the cloud — without it, pan can lose the graph off-screen. */
export function clampGraphPanTarget(
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const length = Math.hypot(x, y, z);
  if (!(length > GRAPH_PAN_TARGET_RADIUS)) return { x, y, z };
  const scale = GRAPH_PAN_TARGET_RADIUS / length;
  return { x: x * scale, y: y * scale, z: z * scale };
}

/** The `OrbitControls` fields this module writes; structural, so a spec can pass a plain object. */
export type GraphOrbitControlsLike<T> = {
  enablePan: boolean;
  enableRotate: boolean;
  enableZoom: boolean;
  zoomToCursor: boolean;
  enableDamping: boolean;
  minDistance: number;
  maxDistance: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  touches: { ONE?: T | null; TWO?: T | null };
};

/** Writes every field on every call: this is also the globe → inspect mode switch. */
export function applyGraphOrbitConfig<T>(
  controls: GraphOrbitControlsLike<T>,
  config: GraphOrbitConfig,
  touch: GraphTouchConstants<T>,
): void {
  controls.enablePan = config.enablePan;
  controls.enableRotate = config.enableRotate;
  controls.enableZoom = config.enableZoom;
  controls.zoomToCursor = config.zoomToCursor;
  controls.enableDamping = config.enableDamping;
  controls.minDistance = config.minDistance;
  controls.maxDistance = config.maxDistance;
  controls.autoRotate = config.autoRotate;
  controls.autoRotateSpeed = config.autoRotateSpeed;
  const constant = (gesture: GraphOrbitGesture) =>
    gesture === "rotate" ? touch.ROTATE : touch.DOLLY_ROTATE;
  controls.touches.ONE = constant(config.touches.ONE);
  controls.touches.TWO = constant(config.touches.TWO);
}

/** One keyboard dolly step, as a distance multiplier so it feels the same at any range. */
export const GRAPH_KEY_DOLLY_STEP = 1.15;

/** The next camera distance, clamped at both ends. A non-finite or non-positive
 *  distance resolves to the floor: NaN in a camera position is a blank canvas. */
export function graphCameraDolly(
  distance: number,
  direction: "in" | "out",
  limits: GraphCameraLimits,
  step: number = GRAPH_KEY_DOLLY_STEP,
): number {
  const clamp = (value: number) =>
    Math.min(Math.max(value, limits.minDistance), limits.maxDistance);
  if (!Number.isFinite(distance) || distance <= 0)
    return clamp(limits.minDistance);
  const factor = Math.max(step, 1);
  return clamp(direction === "in" ? distance / factor : distance * factor);
}

/** Radians per arrow press, in `OrbitControls`' `rotateLeft`/`rotateUp` units (~7°). */
export const GRAPH_KEY_ORBIT_STEP_RAD = 0.12;

/** Shift = coarse. */
export const GRAPH_KEY_ORBIT_FAST_MULTIPLIER = 3;

/** No cursor member: a node cursor here would compete with the search list's focus model. */
export type GraphOrbitCommand =
  | {
      kind: "orbit";
      /** Radians for `OrbitControls.rotateLeft`; positive = a rightward drag. */
      azimuth: number;
      /** Radians for `OrbitControls.rotateUp`; positive = a downward drag. */
      polar: number;
    }
  | { kind: "dolly"; direction: "in" | "out" }
  | { kind: "reset" };

export type GraphOrbitKeyEvent = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

/** `null` means the caller must not `preventDefault()`, so `Tab`/`Enter`/`Space`
 *  and the Ctrl/Meta/Alt bindings keep their meaning under `role="application"`. */
export function graphOrbitKeyCommand(
  event: GraphOrbitKeyEvent,
): GraphOrbitCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const step =
    GRAPH_KEY_ORBIT_STEP_RAD *
    (event.shiftKey ? GRAPH_KEY_ORBIT_FAST_MULTIPLIER : 1);

  switch (event.key) {
    case "ArrowLeft":
      return { kind: "orbit", azimuth: -step, polar: 0 };
    case "ArrowRight":
      return { kind: "orbit", azimuth: step, polar: 0 };
    case "ArrowUp":
      return { kind: "orbit", azimuth: 0, polar: -step };
    case "ArrowDown":
      return { kind: "orbit", azimuth: 0, polar: step };
    // `+` needs Shift on most layouts, so `=` and the numpad name are accepted too.
    case "+":
    case "=":
    case "Add":
      return { kind: "dolly", direction: "in" };
    case "-":
    case "_":
    case "Subtract":
      return { kind: "dolly", direction: "out" };
    case "0":
      return { kind: "reset" };
    default:
      return null;
  }
}
