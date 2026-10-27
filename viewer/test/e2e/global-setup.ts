import { existsSync } from "node:fs";
import path from "node:path";

import { createExportServer, listen } from "../static-server.mjs";

const OUT = path.resolve(__dirname, "../../out");
const WORKSPACE = path.resolve(__dirname, "../fixtures/workspace");

// Environment set here reaches the test workers.
export default async function globalSetup() {
  if (!existsSync(OUT)) throw new Error("out/ is missing: run `npm run build:fixture` first");
  const archive = createExportServer(OUT);
  const workspace = createExportServer(OUT, { workspace: WORKSPACE });
  process.env.VIEWER_ARCHIVE_URL = await listen(archive);
  process.env.VIEWER_WORKSPACE_URL = await listen(workspace);
  return async () => {
    await Promise.all(
      [archive, workspace].map((s) => new Promise((resolve) => s.close(resolve))),
    );
  };
}
