import path from "node:path";

// The Published Corpus the build reads. The standalone repository keeps
// `corpus/` beside `viewer/`.
const CORPUS_DIR_ENV = "VIEWER_CORPUS_DIR";
const DEFAULT_CORPUS_DIR = "../corpus";

export function corpusDir() {
  return path.resolve(
    process.cwd(),
    process.env[CORPUS_DIR_ENV] ?? DEFAULT_CORPUS_DIR,
  );
}
