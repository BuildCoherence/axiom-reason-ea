// No `three` here: the probe must answer before the island chunk is fetched, and
// the lifecycle must be assertable without a GPU.

/** What the visitor is looking at. `poster` is not an error screen — the
 *  server-rendered poster and the search card over it are already painted, so
 *  falling back means not drawing over them. */
export type GraphCanvasRung = "canvas" | "poster";

/** Would a WebGL context be available on this device? Probe BEFORE mounting the
 *  island — a renderer that throws during construction bubbles into `error.tsx`
 *  and blanks a usable page — and release the probe context immediately, since
 *  browsers cap live contexts per page at around 16. */
export function detectWebGLSupport(
  createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): boolean {
  try {
    const canvas = createCanvas();
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    releaseGraphContext(gl);
    return true;
  } catch {
    // Some browsers and enterprise policies throw from `getContext` rather than
    // returning null.
    return false;
  }
}

/** Explicitly drop a GPU context. Dropping the canvas reference is not enough —
 *  the context survives until GC runs — and `WEBGL_lose_context` is the only
 *  synchronous release the platform offers. */
export function releaseGraphContext(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined,
): void {
  try {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // A context already lost throws from `getExtension`; there is nothing left
    // to release.
  }
}

export type GraphContextLifecycleDeps = {
  /** Re-upload buffers and redraw on restore. Must be idempotent: every GPU
   *  resource is gone and is recreated from the JS-side scene model. */
  reupload: () => void;
  /** Told whenever the rung changes. */
  onRungChange?: (rung: GraphCanvasRung) => void;
};

export type GraphContextLifecycle = {
  rung: () => GraphCanvasRung;
  /** Whether a loss has happened at all this mount. Stays true after a failed
   *  restore, which is what keeps the affordance offered. */
  hasLost: () => boolean;
  handleContextLost: (event: { preventDefault?: () => void }) => void;
  handleContextRestored: () => void;
};

/** The context-loss state machine. `preventDefault()` on the loss event is
 *  load-bearing: without it the browser attempts no restore and
 *  `webglcontextrestored` never fires, stranding the page on the poster rung. */
export function createGraphContextLifecycle(
  deps: GraphContextLifecycleDeps,
): GraphContextLifecycle {
  let rung: GraphCanvasRung = "canvas";
  let lost = false;

  const setRung = (next: GraphCanvasRung) => {
    if (rung === next) return;
    rung = next;
    deps.onRungChange?.(next);
  };

  return {
    rung: () => rung,
    hasLost: () => lost,

    handleContextLost(event) {
      // First — before any of our own bookkeeping can throw.
      event.preventDefault?.();
      if (rung === "poster") return;
      lost = true;
      setRung("poster");
    },

    handleContextRestored() {
      if (rung === "canvas") return;
      setRung("canvas");
      // Every GPU-side object is gone; the JS-side scene model is not.
      deps.reupload();
    },
  };
}

/** Bind a lifecycle to a real canvas; returns the detach function. The listeners
 *  go on the CANVAS, not `window`, so one island never reacts to another's
 *  loss. */
export function attachGraphContextLifecycle(
  canvas: HTMLCanvasElement,
  lifecycle: GraphContextLifecycle,
): () => void {
  const onLost = (event: Event) => lifecycle.handleContextLost(event);
  const onRestored = () => lifecycle.handleContextRestored();
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);
  return () => {
    canvas.removeEventListener("webglcontextlost", onLost, false);
    canvas.removeEventListener("webglcontextrestored", onRestored, false);
  };
}
