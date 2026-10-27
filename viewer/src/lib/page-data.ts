import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { corpusDir } from "../../scripts/corpus-dir.mjs";

import type { Decl, FileRef } from "@/components/lean-ui/types";
import type { Publisher } from "@/components/publisher-name";
import type { TheoremPageResponse } from "@/components/theorem-flowchart/types";
import {
  GRAPH_MANIFEST_FORMAT_VERSION,
  type GraphManifest,
} from "@/app/graph/graph-manifest-types";
import type {
  HeldPropositions,
  ProfileAxioms,
  UserProfileBodyData,
} from "@/app/u/[username]/profile-body";

// Viewer Page Data is read from the Published Corpus at build time.

// The profile list ordering the forked lists pane renders.
const PROFILE_LIST_ORDERING = "popularity";

export type PageKind = "f" | "u" | "theorem";

export interface FilePageFile {
  id: string;
  content: string;
  lean_version: string;
  publisher: Publisher;
  created_at: string;
  forked_from: string | null;
  decls: Decl[];
  file_refs: FileRef[];
}

export interface FilePageData {
  file: FilePageFile;
  closure: string[];
}

export interface CorpusIndex {
  frozen_at: string;
  graph_generation: number;
  files: { id: string; publisher: string | null }[];
  theorems: string[];
}


interface RawProfilePage {
  profile: Omit<UserProfileBodyData, "held_propositions">;
  held_propositions: Record<string, HeldPropositions>;
}

function readJson<T>(...parts: string[]): T {
  const file = path.join(corpusDir(), ...parts);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function loadCorpusIndex(): CorpusIndex {
  return readJson<CorpusIndex>("corpus.json");
}

// Each page JSON is inlined into its HTML, so the loaders rebuild every
// object that can carry account fields from named keys only.
function publisherOf(p: { username: string } | null | undefined): Publisher {
  return p == null ? null : { username: p.username };
}

function declOf<D extends Decl>(d: D): D {
  return { ...d, publisher: publisherOf(d.publisher) };
}

function filePage(raw: FilePageData): FilePageData {
  const f = raw.file;
  return {
    file: {
      id: f.id,
      content: f.content,
      lean_version: f.lean_version,
      publisher: publisherOf(f.publisher),
      created_at: f.created_at,
      forked_from: f.forked_from,
      decls: (f.decls ?? []).map(declOf),
      file_refs: f.file_refs ?? [],
    },
    closure: raw.closure,
  };
}

function profilePage(raw: RawProfilePage): UserProfileBodyData {
  const p = raw.profile;
  const held = raw.held_propositions[PROFILE_LIST_ORDERING];
  if (held === undefined) {
    throw new Error(
      `profile ${p.username} has no ${PROFILE_LIST_ORDERING} held_propositions`,
    );
  }
  const axioms: ProfileAxioms | null = p.latest_user_axioms
    ? {
        ...p.latest_user_axioms,
        axioms: p.latest_user_axioms.axioms.map(declOf),
      }
    : null;
  return {
    username: p.username,
    latest_user_axioms: axioms,
    held_propositions: {
      items: held.items,
      graph_slice: held.graph_slice,
      total: held.total,
    },
    coverage_proposition_ids: p.coverage_proposition_ids,
    inconsistency: p.inconsistency,
  };
}

function theoremPage(raw: TheoremPageResponse): TheoremPageResponse {
  return {
    decl: declOf(raw.decl),
    created_at: raw.created_at,
    adoption: raw.adoption,
    dag: raw.dag,
    file_content: raw.file_content,
  };
}

export function loadPageData(kind: "f", id: string): FilePageData;
export function loadPageData(kind: "u", id: string): UserProfileBodyData;
export function loadPageData(kind: "theorem", id: string): TheoremPageResponse;
export function loadPageData(
  kind: PageKind,
  id: string,
): FilePageData | UserProfileBodyData | TheoremPageResponse {
  switch (kind) {
    case "f":
      return filePage(readJson<FilePageData>("data", "f", `${id}.json`));
    case "u":
      return profilePage(readJson<RawProfilePage>("data", "u", `${id}.json`));
    case "theorem":
      return theoremPage(
        readJson<TheoremPageResponse>("data", "theorem", `${id}.json`),
      );
  }
}

/** The frozen final Generation's Graph Manifest. Its artifact paths are the
 *  same-origin `/graph/<gen>/` files the archive build copies into the site. */
export function loadGraphManifest(index: CorpusIndex): GraphManifest {
  const manifest = readJson<GraphManifest>(
    "graph",
    String(index.graph_generation),
    "manifest.json",
  );
  if (manifest.format_version !== GRAPH_MANIFEST_FORMAT_VERSION) {
    throw new Error(
      `graph manifest format_version ${manifest.format_version}, want ${GRAPH_MANIFEST_FORMAT_VERSION}`,
    );
  }
  return manifest;
}

/** Every `/u/<name>`: one per exported user's `data/u/<name>.json`, whose
 *  file name is the lowercased username. */
export function profileUsernames(): string[] {
  return readdirSync(path.join(corpusDir(), "data", "u"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}
