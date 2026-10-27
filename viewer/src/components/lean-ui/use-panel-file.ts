"use client";

import * as React from "react";

import { PanelDataError } from "@/lib/panel-data";

import type { PanelState } from "./panel-shell";

export interface UsePanelFile<T> {
  /** The loaded value, or null while idle / loading / errored. */
  data: T | null;
  /** "idle" when id === null, else loading / loaded / error. */
  state: PanelState;
  /** HTTP status for the error surface; null on a network or parse failure. */
  errorStatus: number | null;
  /** Re-read the current id (drives the error-surface Retry). */
  retry: () => void;
}

/**
 * Loads one Viewer Page Data panel value for `id`. A result that lands after
 * `id` changed or the host unmounted is dropped.
 */
export function usePanelFile<T>(
  id: string | null,
  load: (id: string) => Promise<T>,
): UsePanelFile<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [state, setState] = React.useState<PanelState>("idle");
  const [errorStatus, setErrorStatus] = React.useState<number | null>(null);
  const [retryNonce, setRetryNonce] = React.useState(0);
  const retry = React.useCallback(() => setRetryNonce((n) => n + 1), []);

  React.useEffect(() => {
    setData(null);
    setErrorStatus(null);
    if (id === null) {
      setState("idle");
      return;
    }
    let cancelled = false;
    setState("loading");
    load(id).then(
      (value) => {
        if (cancelled) return;
        setData(value);
        setState("loaded");
      },
      (err: unknown) => {
        if (cancelled) return;
        console.error(`panel data for ${id} failed:`, err);
        setErrorStatus(err instanceof PanelDataError ? err.status : null);
        setState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, load, retryNonce]);

  return { data, state, errorStatus, retry };
}
