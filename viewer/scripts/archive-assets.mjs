// Copies the Published Corpus files the viewer reads at runtime into the
// static export, at the same-origin paths it fetches them from. Runs after
// `next build`.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { corpusDir } from "./corpus-dir.mjs";

const OUT_DIR = "out";
// Copied verbatim: panel data (`data/def/<id>.json`, `data/prop/<id>.json`)
// and the frozen Generation's `graph/<gen>/{manifest,graph,labels}.json`.
const VERBATIM_DIRS = ["data/def", "data/prop", "graph"];
// Read by the archive Worker on a `/theorem/` asset miss.
const THEOREM_REDIRECTS = "theorem-redirects.json";
// Read by `/search` (SEARCH_INDEX_PATH in src/lib/search-index.mjs).
const SEARCH_INDEX = "search-index.json";
// Read by the viewer when a merged proposition has no file of its own.
const PROP_ALIASES = "data/prop-aliases.json";

function copyArchiveAssets(corpus, out) {
  for (const dir of VERBATIM_DIRS) {
    const from = path.join(corpus, dir);
    // A corpus with no defs or no propositions has no directory for them.
    if (existsSync(from)) cpSync(from, path.join(out, dir), { recursive: true });
  }
  for (const file of [THEOREM_REDIRECTS, SEARCH_INDEX]) {
    cpSync(path.join(corpus, file), path.join(out, file));
  }
  const index = JSON.parse(readFileSync(path.join(corpus, "corpus.json"), "utf8"));
  writeFileSync(
    path.join(out, PROP_ALIASES),
    JSON.stringify(index.proposition_aliases ?? {}),
  );
}

copyArchiveAssets(corpusDir(), path.resolve(OUT_DIR));
