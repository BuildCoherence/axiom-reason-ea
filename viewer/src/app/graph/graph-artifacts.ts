import type { GraphDegradedReason } from "./graph-degraded";
import {
  decodeGraphGeometry,
  decodeGraphLabels,
  type DecodedGraphGeometry,
  type DecodedGraphLabels,
} from "./graph-wire";

/** Bounded, not merely deprioritised: an unsettled request leaves search in a loading state no rung clears. */
export const GRAPH_LABELS_FETCH_TIMEOUT_MS = 3000;

/** Must pair with `page.tsx`'s `<link rel="preload" crossorigin="anonymous">` (⇒ credentials "same-origin"), or the browser fetches the payload twice. */
export const GRAPH_ARTIFACT_REQUEST_INIT: RequestInit = {
  mode: "cors",
  credentials: "same-origin",
};

export type GraphGeometryOutcome =
  | { status: "ok"; geometry: DecodedGraphGeometry }
  | {
      status: "unavailable";
      reason: GraphDegradedReason;
      /** `null` = never got a response (network error, abort, timeout), which the copy distinguishes from a 404. */
      httpStatus: number | null;
      /** `null` when the response carries no usable `Retry-After`. */
      retryAfterMs: number | null;
    };

/** Distinct from `GraphDegradedReason`: a labels failure costs SEARCH, not the canvas, and pulls down no rung. */
export type GraphLabelsUnavailableReason =
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "error";

export type GraphLabelsOutcome =
  | { status: "ok"; labels: DecodedGraphLabels }
  | {
      status: "search-unavailable";
      reason: GraphLabelsUnavailableReason;
      httpStatus: number | null;
    };

export type GraphFetchDeps = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

/** 429 is its own reason because it is the one non-2xx an operator can act on; the 404 COPY differs, the reason does not. */
export function graphArtifactReasonForStatus(
  httpStatus: number,
): GraphDegradedReason {
  return httpStatus === 429 ? "rate_limited" : "artifact_unavailable";
}

/** Never throws: every failure mode comes back as a named outcome, because this sits on the path to a page that must not white-screen. */
export async function fetchGraphGeometry(
  url: string,
  deps: GraphFetchDeps = {},
): Promise<GraphGeometryOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      ...GRAPH_ARTIFACT_REQUEST_INIT,
      signal: deps.signal,
    });
  } catch {
    return {
      status: "unavailable",
      reason: "artifact_unavailable",
      httpStatus: null,
      retryAfterMs: null,
    };
  }

  if (!response.ok) {
    return {
      status: "unavailable",
      reason: graphArtifactReasonForStatus(response.status),
      httpStatus: response.status,
      retryAfterMs: parseGraphRetryAfterMs(response.headers?.get("Retry-After")),
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: "unavailable",
      reason: "artifact_unavailable",
      httpStatus: response.status,
      retryAfterMs: null,
    };
  }

  const decoded = decodeGraphGeometry(body);
  if (decoded.status === "format_version") {
    return {
      status: "unavailable",
      reason: "format_version",
      httpStatus: response.status,
      retryAfterMs: null,
    };
  }
  if (decoded.status === "malformed") {
    return {
      status: "unavailable",
      reason: "artifact_unavailable",
      httpStatus: response.status,
      retryAfterMs: null,
    };
  }
  return { status: "ok", geometry: decoded.geometry };
}

/** A REFUSAL threshold, not a clamp: above this the retry is abandoned and the page degrades now. */
export const GRAPH_RETRY_AFTER_CAP_MS = 5_000;

/** Full jitter (`random(0, base)`), not backoff: one retry has no sequence to grow, but the herd is still real. */
export const GRAPH_RETRY_JITTER_BASE_MS = 1_000;

/** `null` when the header is absent or unparseable. */
export function parseGraphRetryAfterMs(
  raw: string | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  if (!HTTP_DATE_FORMS.some((form) => form.test(trimmed))) return null;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}

/** Matched strictly before `Date.parse` sees the value: `Date.parse("-3")` succeeds, and would floor to an immediate retry. */
const HTTP_DATE_FORMS: readonly RegExp[] = [
  // IMF-fixdate — the only form a sender may generate. `toUTCString()` emits it.
  /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  // RFC 850, obsolete but still required of recipients.
  /^[A-Za-z]{6,9}, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT$/,
  // asctime.
  /^[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/,
];

/** A server-supplied value is NOT jittered: the origin has already spread its own `Retry-After` values. */
export function graphRetryDelayMs(
  retryAfterMs: number | null,
  random: () => number = Math.random,
): number | null {
  if (retryAfterMs === null) return random() * GRAPH_RETRY_JITTER_BASE_MS;
  if (retryAfterMs > GRAPH_RETRY_AFTER_CAP_MS) return null;
  return Math.max(0, retryAfterMs);
}

/** Abortable: a timer outliving the view would fire against a Generation the page has already left. */
function graphRetrySleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type GraphRetryDeps = GraphFetchDeps & {
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

/** ONLY 429 is retried, exactly once: a 404, a `format_version` mismatch and a malformed body all fail identically on a second read. */
export async function fetchGraphGeometryRetrying429(
  url: string,
  deps: GraphRetryDeps = {},
): Promise<GraphGeometryOutcome> {
  const first = await fetchGraphGeometry(url, deps);
  if (first.status === "ok" || first.reason !== "rate_limited") return first;

  const delay = graphRetryDelayMs(first.retryAfterMs, deps.random);
  if (delay === null) return first;

  const sleep = deps.sleepImpl ?? graphRetrySleep;
  await sleep(delay, deps.signal);
  if (deps.signal?.aborted) return first;

  return fetchGraphGeometry(url, deps);
}

/** A labels payload of a different length is a cross-Generation mismatch and is REFUSED rather than rendered. */
export async function fetchGraphLabels(
  url: string,
  expectedNodeCount: number,
  deps: GraphFetchDeps & { timeoutMs?: number } = {},
): Promise<GraphLabelsOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? GRAPH_LABELS_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  deps.signal?.addEventListener("abort", onOuterAbort);

  try {
    let response: Response;
    try {
      response = await doFetch(url, {
        ...GRAPH_ARTIFACT_REQUEST_INIT,
        signal: controller.signal,
      });
    } catch {
      return {
        status: "search-unavailable",
        reason: controller.signal.aborted ? "timeout" : "error",
        httpStatus: null,
      };
    }

    if (!response.ok) {
      const reason: GraphLabelsUnavailableReason =
        response.status === 404
          ? "not_found"
          : response.status === 429
            ? "rate_limited"
            : "error";
      return { status: "search-unavailable", reason, httpStatus: response.status };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        status: "search-unavailable",
        reason: "error",
        httpStatus: response.status,
      };
    }

    const decoded = decodeGraphLabels(body, expectedNodeCount);
    if (decoded.status !== "ok") {
      return {
        status: "search-unavailable",
        reason: "error",
        httpStatus: response.status,
      };
    }
    return { status: "ok", labels: decoded.labels };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onOuterAbort);
  }
}

export type IdleScheduleDeps = {
  requestIdle?: (cb: () => void) => number;
  cancelIdle?: (handle: number) => void;
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
};

/** `requestIdleCallback` where it exists, a short `setTimeout` otherwise — Safari shipped it only recently. */
export function scheduleGraphIdleTask(
  task: () => void,
  deps: IdleScheduleDeps = {},
): () => void {
  const requestIdle =
    deps.requestIdle ??
    (typeof globalThis.requestIdleCallback === "function"
      ? (cb: () => void) => globalThis.requestIdleCallback(cb)
      : undefined);

  if (requestIdle) {
    const handle = requestIdle(task);
    const cancelIdle =
      deps.cancelIdle ??
      (typeof globalThis.cancelIdleCallback === "function"
        ? (h: number) => globalThis.cancelIdleCallback(h)
        : undefined);
    return () => cancelIdle?.(handle);
  }

  const setTimeoutImpl =
    deps.setTimeoutImpl ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutImpl =
    deps.clearTimeoutImpl ??
    ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const handle = setTimeoutImpl(task, 0);
  return () => clearTimeoutImpl(handle);
}
