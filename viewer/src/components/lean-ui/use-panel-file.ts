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

interface Loaded<T> {
  id: string;
  data: T | null;
  state: PanelState;
  errorStatus: number | null;
}

/**
 * Loads one Viewer Page Data panel value for `id`. A result that lands after
 * `id` changed or the host unmounted is dropped, and a value loaded for an
 * earlier `id` is never returned for the current one.
 */
export function usePanelFile<T>(
  id: string | null,
  load: (id: string) => Promise<T>,
): UsePanelFile<T> {
  const [loaded, setLoaded] = React.useState<Loaded<T> | null>(null);
  const [retryNonce, setRetryNonce] = React.useState(0);
  const retry = React.useCallback(() => setRetryNonce((n) => n + 1), []);

  React.useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    setLoaded({ id, data: null, state: "loading", errorStatus: null });
    load(id).then(
      (value) => {
        if (cancelled) return;
        setLoaded({ id, data: value, state: "loaded", errorStatus: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        console.error(`panel data for ${id} failed:`, err);
        setLoaded({
          id,
          data: null,
          state: "error",
          errorStatus: err instanceof PanelDataError ? err.status : null,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, load, retryNonce]);

  if (id === null) {
    return { data: null, state: "idle", errorStatus: null, retry };
  }
  if (loaded === null || loaded.id !== id) {
    return { data: null, state: "loading", errorStatus: null, retry };
  }
  return {
    data: loaded.data,
    state: loaded.state,
    errorStatus: loaded.errorStatus,
    retry,
  };
}
