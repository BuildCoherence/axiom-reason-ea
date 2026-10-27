"use client";

import { loadPropPanel } from "@/lib/panel-data";

import type { PanelState } from "./panel-shell";
import type { PropData } from "./types";
import { usePanelFile } from "./use-panel-file";

export interface UsePropData {
  /** The proposition payload, or null while idle / loading / errored. */
  propData: PropData | null;
  /** "idle" when propId === null, else loading/loaded/error. */
  state: PanelState;
  /** HTTP status for the error surface; null on a network / parse failure. */
  errorStatus: number | null;
  /** Re-read the current id (drives the error-surface Retry). */
  retry: () => void;
}

const loadProposition = (id: string) =>
  loadPropPanel(id).then((file) => file.proposition);

/** The PropositionPanel's `?prop=` data, read from `data/prop/<id>.json`. */
export function usePropData(propId: string | null): UsePropData {
  const { data, state, errorStatus, retry } = usePanelFile(
    propId,
    loadProposition,
  );
  return { propData: data, state, errorStatus, retry };
}
