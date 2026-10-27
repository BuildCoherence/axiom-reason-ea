"use client";

import { loadDefPanel } from "@/lib/panel-data";

import type { PanelState } from "./panel-shell";
import type { DefData } from "./types";
import { usePanelFile } from "./use-panel-file";

export interface UseDefData {
  /** The def payload, or null while idle / loading / errored. */
  defData: DefData | null;
  /** "idle" when defId === null, else loading/loaded/error. */
  state: PanelState;
  /** HTTP status for the error surface; null on a network / parse failure. */
  errorStatus: number | null;
  /** Re-read the current id (drives the error-surface Retry). */
  retry: () => void;
}

const loadDef = (id: string) => loadDefPanel(id).then((file) => file.def);

/** The SidePanel's `?def=` data, read from `data/def/<id>.json`. */
export function useDefData(defId: string | null): UseDefData {
  const { data, state, errorStatus, retry } = usePanelFile(defId, loadDef);
  return { defData: data, state, errorStatus, retry };
}
