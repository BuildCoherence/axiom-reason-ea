// Drives the archive-fidelity-crawl step the release workflow runs on `out/`
// against a small export tree and planted defects in copies of it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "../scripts/archive-fidelity-crawl.mjs");
const FIXTURE = path.join(here, "fixtures/fidelity");

let dirs = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function copyFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "fidelity-crawl-"));
  dirs.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

function crawl(root) {
  const r = spawnSync(process.execPath, [SCRIPT, path.join(root, "out")], {
    encoding: "utf8",
    env: { ...process.env, VIEWER_CORPUS_DIR: path.join(root, "corpus") },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function edit(file, from, to) {
  const body = readFileSync(file, "utf8");
  assert.ok(body.includes(from), `${file} contains ${from}`);
  writeFileSync(file, body.replace(from, to));
}

describe("archive-fidelity-crawl", () => {
  test("passes the committed export tree", () => {
    const r = crawl(FIXTURE);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 corpus pages and \d+ links checked, 0 misses/);
  });

  for (const [url, file] of [
    ["/f/a1b2c3d4", "f/a1b2c3d4.html"],
    ["/u/alice", "u/alice.html"],
    ["/theorem/e0000001", "theorem/e0000001.html"],
  ]) {
    test(`fails a missing ${url} page`, () => {
      const root = copyFixture();
      rmSync(path.join(root, "out", file));
      const r = crawl(root);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes(`${url}: ${file} is not in the export`), r.stderr);
    });
  }

  test("fails a corpus file with empty source text", () => {
    const root = copyFixture();
    const data = path.join(root, "corpus/data/f/a1b2c3d4.json");
    const json = JSON.parse(readFileSync(data, "utf8"));
    json.file.content = "\n  \n";
    writeFileSync(data, JSON.stringify(json));
    const r = crawl(root);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("/f/a1b2c3d4: the corpus file has empty source text"), r.stderr);
  });

  test("fails a file page rendered without a source line", () => {
    const root = copyFixture();
    edit(path.join(root, "out/f/a1b2c3d4.html"), "<span> fun _ =&gt; rfl</span>", "");
    const r = crawl(root);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("/f/a1b2c3d4: source line \"theorem kind_all"), r.stderr);
  });

  test("fails profile and theorem pages rendered without their text", () => {
    const root = copyFixture();
    edit(path.join(root, "out/u/alice.html"), "<h1>@Alice</h1>", "<h1></h1>");
    edit(path.join(root, "out/theorem/e0000001.html"), "theorem kind_all", "kind_all");
    const r = crawl(root);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('/u/alice: "@Alice" is not in the page text'), r.stderr);
    assert.ok(r.stderr.includes('/theorem/e0000001: "theorem kind_all" is not in the page text'), r.stderr);
  });

  for (const href of ["/f/zzzzzzzz", "https://axiomreason.com/graph", "../nope/", "/theorem/x0000002"]) {
    test(`fails a dangling internal href ${href}`, () => {
      const root = copyFixture();
      edit(path.join(root, "out/u/alice.html"), '<a href="/">', `<a href="${href}">`);
      const r = crawl(root);
      assert.equal(r.status, 1);
      const target = new URL(href, "https://axiomreason.com/u/alice").pathname;
      assert.ok(r.stderr.includes(`/u/alice links to ${target}: no file under out/`), r.stderr);
    });
  }

  test("fails a /theorem/ link whose id is not a theorem-redirects.json id", () => {
    const root = copyFixture();
    writeFileSync(path.join(root, "out/theorem-redirects.json"), "{}");
    const r = crawl(root);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("/u/alice links to /theorem/x0000001"), r.stderr);
  });
});
