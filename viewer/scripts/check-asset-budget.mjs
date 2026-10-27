// Fails the build when the static export would not deploy as one Cloudflare
// Workers Free version, or would not extract on Windows (the local target).
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Workers Free: 20,000 files per version (developer ruling: stay on Free).
export const ASSET_CEILING = 20_000;
// Workers: 25 MiB per asset file.
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
// Windows reserved device names, matched on a path part's text before its
// first dot, case-insensitively.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });
}

/** Every budget violation of the export rooted at `root`; empty when it passes. */
export function assetBudgetViolations(root) {
  const files = walk(root);
  const violations = [];
  if (files.length > ASSET_CEILING) {
    violations.push(`${files.length} emitted files exceed ASSET_CEILING ${ASSET_CEILING}`);
  }
  for (const file of files) {
    const rel = path.relative(root, file);
    const size = statSync(file).size;
    if (size > MAX_ASSET_BYTES) {
      violations.push(`${rel}: ${size} bytes exceed ${MAX_ASSET_BYTES}`);
    }
    for (const part of rel.split(path.sep)) {
      if (WINDOWS_RESERVED.test(part.split(".")[0])) {
        violations.push(`${rel}: "${part}" is a Windows reserved device name`);
      }
    }
  }
  return { count: files.length, violations };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2];
  if (root === undefined) {
    console.error("usage: check-asset-budget.mjs <export dir>");
    process.exit(2);
  }
  const { count, violations } = assetBudgetViolations(root);
  for (const v of violations) console.error(v);
  console.log(`${count} emitted files (ceiling ${ASSET_CEILING})`);
  process.exit(violations.length === 0 ? 0 : 1);
}
