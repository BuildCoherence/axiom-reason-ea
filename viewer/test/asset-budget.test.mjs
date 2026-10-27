// Drives the asset-budget step the viewer workflow runs on `out/` against
// synthetic export trees.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ASSET_CEILING, MAX_ASSET_BYTES } from "../scripts/check-asset-budget.mjs";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/check-asset-budget.mjs",
);

let dirs = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function exportTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "asset-budget-"));
  dirs.push(root);
  for (const [rel, size] of files) {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, "");
    if (size > 0) truncateSync(p, size);
  }
  return root;
}

function nFiles(n) {
  return Array.from({ length: n }, (_, i) => [`data/def/${String(i).padStart(8, "0")}.json`, 0]);
}

function check(root) {
  const r = spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

describe("asset budget step", () => {
  test("the ceiling is the Workers Free per-version file limit", () => {
    assert.equal(ASSET_CEILING, 20_000);
    assert.equal(MAX_ASSET_BYTES, 25 * 1024 * 1024);
  });

  test("passes at exactly ASSET_CEILING emitted files", () => {
    assert.equal(check(exportTree(nFiles(ASSET_CEILING))).status, 0);
  });

  test("fails at ASSET_CEILING + 1 emitted files", () => {
    const r = check(exportTree(nFiles(ASSET_CEILING + 1)));
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`${ASSET_CEILING + 1} emitted files exceed ASSET_CEILING`));
  });

  test("passes a 25 MiB file and fails a 25 MiB + 1 byte file", () => {
    assert.equal(check(exportTree([["graph/1/graph.json", MAX_ASSET_BYTES]])).status, 0);
    const r = check(exportTree([["graph/1/graph.json", MAX_ASSET_BYTES + 1]]));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /graph\.json: 26214401 bytes exceed 26214400/);
  });

  for (const name of ["con.json", "aux.html", "com0.html", "data/NUL/x.json", "LPT¹.txt", "prn.tar.gz"]) {
    test(`fails a Windows reserved path part: ${name}`, () => {
      const r = check(exportTree([["index.html", 1], [name, 1]]));
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Windows reserved device name/);
    });
  }

  test("passes names that only resemble reserved names", () => {
    const names = ["console.html", "com10.html", "auxiliary.json", "f/nul0.html", "lpt.txt"];
    assert.equal(check(exportTree(names.map((n) => [n, 1]))).status, 0);
  });
});
