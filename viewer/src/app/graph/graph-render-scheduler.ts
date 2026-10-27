// Render-on-demand: outside the auto-rotate window a frame happens only because
// something changed, so the idle `requestAnimationFrame` count is 0.
//
// Auto-rotate never restarts once it has ended. A scheduler dies with the scene
// it drives and the island rebuilds that scene on a theme toggle, so the
// dismissal is carried across builds by passing `autoRotate: false`.
//
// `requestAnimationFrame`, `cancelAnimationFrame` and the clock are injected, so
// the spec drives the whole lifecycle with a fake clock.

/** The idle auto-rotate window. Infinite by ruling — rotation ends only at
 *  `noteInteraction()` — but every caller-supplied finite value still works. */
export const GRAPH_AUTO_ROTATE_WINDOW_MS = Number.POSITIVE_INFINITY;

export type GraphRenderSchedulerDeps = {
  /** Draw one frame. `timeMs` is the scheduler's clock, so auto-rotate advances
   *  by elapsed time rather than by frame count. */
  render: (timeMs: number) => void;
  requestFrame: (cb: (timeMs: number) => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
  /** `false` for reduced motion, a deep link, any rung that skips the arrival,
   *  and any scene rebuild after the visitor took the camera — that last one is
   *  how "never restarts" survives the scheduler being replaced. */
  autoRotate: boolean;
  autoRotateWindowMs?: number;
};

export type GraphRenderScheduler = {
  /** Draw the first frame and, if `autoRotate`, open the window. */
  start: () => void;
  /** Something changed; draw exactly one more frame. N calls before the next
   *  frame produce ONE frame, not N. */
  invalidate: () => void;
  /** The visitor took control. Ends auto-rotate for good and draws the frame
   *  that the interaction itself implies. */
  noteInteraction: () => void;
  /** End auto-rotate WITHOUT scheduling anything: this path must leave the
   *  scheduler at zero pending frames. */
  stopAutoRotate: () => void;
  /** True IFF the auto-rotate window is open. Read inside `render` it answers
   *  "is THIS frame a rotating one", and the resting frame answers `false`. */
  isAutoRotating: () => boolean;
  /** 1 while a frame is queued, else 0 — inside `render` it is 0 on every
   *  frame, so the quiesced signal reduces to "this frame is not rotating". */
  pendingFrames: () => number;
  /** Total frames drawn. Diagnostics and assertions only. */
  framesRendered: () => number;
  dispose: () => void;
};

/** Create the scheduler. Nothing runs until `start()` — the island is still
 *  uploading buffers when this is called. */
export function createGraphRenderScheduler(
  deps: GraphRenderSchedulerDeps,
): GraphRenderScheduler {
  const windowMs = deps.autoRotateWindowMs ?? GRAPH_AUTO_ROTATE_WINDOW_MS;

  let autoRotating = false;
  let autoRotateStartedAt = 0;
  let handle: number | null = null;
  let frames = 0;
  let disposed = false;

  const drawOnce = (timeMs: number) => {
    handle = null;
    frames++;
    deps.render(timeMs);
  };

  const scheduleOnce = () => {
    if (disposed || handle !== null) return;
    handle = deps.requestFrame((timeMs) => drawOnce(timeMs));
  };

  const autoRotateStep = (timeMs: number) => {
    handle = null;
    if (disposed || !autoRotating) return;
    // The window check runs BEFORE the render, so the last frame is drawn at
    // rest: consumers read scheduler state during `render`, and nothing is
    // scheduled afterwards to correct it.
    const windowElapsed = deps.now() - autoRotateStartedAt >= windowMs;
    if (windowElapsed) autoRotating = false;
    frames++;
    deps.render(timeMs);
    if (windowElapsed) {
      // Request nothing: the frame drawn above is the resting picture.
      return;
    }
    handle = deps.requestFrame(autoRotateStep);
  };

  const stopAutoRotate = () => {
    if (!autoRotating) return;
    autoRotating = false;
    // Cancel the queued frame: it would advance the camera one more step after
    // the visitor already grabbed it.
    if (handle !== null) {
      deps.cancelFrame(handle);
      handle = null;
    }
  };

  return {
    start() {
      if (disposed) return;
      if (deps.autoRotate) {
        autoRotating = true;
        autoRotateStartedAt = deps.now();
        handle = deps.requestFrame(autoRotateStep);
        return;
      }
      // Exactly one frame, then idle: the reduced-motion and deep-link paths
      // land here and must still SHOW the graph.
      scheduleOnce();
    },

    invalidate() {
      if (disposed) return;
      // A frame is already queued every frame while rotating; scheduling here
      // would double the frame rate.
      if (autoRotating) return;
      scheduleOnce();
    },

    noteInteraction() {
      if (disposed) return;
      stopAutoRotate();
      // The interaction IS the state change, so this path does schedule.
      scheduleOnce();
    },

    stopAutoRotate,

    isAutoRotating: () => autoRotating,
    pendingFrames: () => (handle === null ? 0 : 1),
    framesRendered: () => frames,

    dispose() {
      disposed = true;
      autoRotating = false;
      if (handle !== null) {
        deps.cancelFrame(handle);
        handle = null;
      }
    },
  };
}
