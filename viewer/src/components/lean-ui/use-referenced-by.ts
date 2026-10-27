"use client";

import { loadDefPanel } from "@/lib/panel-data";

import type { ReferencedByEntry } from "./types";
import { usePanelFile, type UsePanelFile } from "./use-panel-file";

const loadReferencedBy = (id: string) =>
  loadDefPanel(id).then((file) => file.referenced_by);

/**
 * The side panel's "Referenced by" list: the unpaginated `referenced_by` of
 * `data/def/<id>.json`, the same file the def panel reads.
 */
export function useReferencedBy(
  defId: string | null,
): UsePanelFile<ReferencedByEntry[]> {
  return usePanelFile(defId, loadReferencedBy);
}
