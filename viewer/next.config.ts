import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

import { corpusDir } from "./scripts/corpus-dir.mjs";

// Compacted for inlining into the client bundle (src/lib/theorem-href.ts).
const theoremRedirects = JSON.stringify(
  JSON.parse(
    readFileSync(path.join(corpusDir(), "theorem-redirects.json"), "utf8"),
  ),
);

const nextConfig: NextConfig = {
  output: "export",
  // `/f/<id>` is served from `f/<id>.html`; client navigation fetches `/f/<id>.txt`.
  trailingSlash: false,
  images: { unoptimized: true },
  env: { THEOREM_REDIRECTS: theoremRedirects },
};

export default nextConfig;
