import type {
  DefData,
  PropData,
  ReferencedByEntry,
} from "@/components/lean-ui/types";
import type {
  AdoptersResponse,
  HoldersResponse,
} from "@/components/theorem-flowchart/types";

import { SEARCH_INDEX_PATH, type SearchIndex } from "./search-index.mjs";

// Lazy panel and search reads, served as same-origin Viewer Page Data files.
// The archive build copies the Published Corpus `data/def` and `data/prop`
// trees and `search-index.json` into the site at these paths, and writes the
// merged-proposition alias map beside them.

export interface DefPanelFile {
  def: DefData;
  referenced_by: ReferencedByEntry[];
  /** Present only for defs with a theorem page. */
  adopters?: AdoptersResponse["adopters"];
}

export interface PropPanelFile {
  proposition: PropData;
  holders: HoldersResponse & { proposition_id: string };
}

export const PROP_ALIASES_PATH = "/data/prop-aliases.json";

export function defPanelPath(defId: string): string {
  return `/data/def/${encodeURIComponent(defId)}.json`;
}

export function propPanelPath(propId: string): string {
  return `/data/prop/${encodeURIComponent(propId)}.json`;
}

/** A failed panel read; `status` is null for a network or parse failure. */
export class PanelDataError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
  ) {
    super(
      status === null ? `GET ${path} failed` : `GET ${path} returned ${status}`,
    );
  }
}

// Several panels read the same file (the def panel, its referenced-by section
// and the adopters modal share `data/def/<id>.json`), so reads are memoized.
// A failed read is evicted so Retry fetches again.
const reads = new Map<string, Promise<unknown>>();

function readJson<T>(path: string): Promise<T> {
  let pending = reads.get(path) as Promise<T> | undefined;
  if (pending === undefined) {
    pending = fetch(path).then(async (res) => {
      if (!res.ok) throw new PanelDataError(path, res.status);
      try {
        return (await res.json()) as T;
      } catch {
        throw new PanelDataError(path, null);
      }
    });
    pending.catch(() => reads.delete(path));
    reads.set(path, pending);
  }
  return pending;
}

export function loadDefPanel(defId: string): Promise<DefPanelFile> {
  return readJson<DefPanelFile>(defPanelPath(defId));
}

// A merged proposition has no file of its own; it resolves through the alias
// map to its surviving proposition.
export async function loadPropPanel(propId: string): Promise<PropPanelFile> {
  try {
    return await readJson<PropPanelFile>(propPanelPath(propId));
  } catch (err) {
    if (!(err instanceof PanelDataError) || err.status !== 404) throw err;
    const aliases = await readJson<Record<string, string>>(PROP_ALIASES_PATH);
    const target = aliases[propId];
    if (target === undefined) throw err;
    return readJson<PropPanelFile>(propPanelPath(target));
  }
}

export function loadSearchIndex(): Promise<SearchIndex> {
  return readJson<SearchIndex>(SEARCH_INDEX_PATH);
}
