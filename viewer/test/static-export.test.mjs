// Runs against `out/` from `npm run build:fixture` (the fixture corpus).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { SEARCH_INDEX_PATH } from "../src/lib/search-index.mjs";
import { createExportServer, listen } from "./static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "out");
const CORPUS = path.join(root, "test/fixtures/corpus");
const UNATTRIBUTED = "unattributed (account removed)";

const readCorpus = (...parts) =>
  JSON.parse(readFileSync(path.join(CORPUS, ...parts), "utf8"));
const corpus = readCorpus("corpus.json");
const filePage = (id) => readCorpus("data", "f", `${id}.json`).file;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// The text a reader sees with JavaScript disabled: markup without scripts.
function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

function hrefs(html) {
  const out = [];
  for (const tag of html.match(/<a\b[^>]*>/g) ?? []) {
    const m = tag.match(/\bhref="([^"]*)"/);
    if (m) out.push(m[1].replace(/&amp;/g, "&"));
  }
  return out;
}

let server;
let base;
before(async () => {
  assert.ok(existsSync(OUT), "out/ is missing: run `npm run build:fixture` first");
  server = createExportServer(OUT);
  base = await listen(server);
});
after(() => server?.close());

async function getPage(pathname) {
  const res = await fetch(base + pathname);
  assert.equal(res.status, 200, `${pathname} status`);
  return res.text();
}

const publishers = [
  ...new Set(
    corpus.files
      .map((f) => f.publisher)
      .filter((p) => p !== null && p !== UNATTRIBUTED),
  ),
];
// Every exported user has a data/u file: publishers and head-only users.
const exportedUsers = readdirSync(path.join(CORPUS, "data", "u"))
  .filter((n) => n.endsWith(".json"))
  .map((n) => n.slice(0, -".json".length))
  .sort();
const headOnly = exportedUsers.filter(
  (name) => !publishers.some((p) => p.toLowerCase() === name),
);

describe("emitted tree", () => {
  test("fixture shape covers the cases under test", () => {
    assert.ok(corpus.files.length >= 3);
    assert.ok(corpus.files.some((f) => f.deps.length > 0));
    assert.ok(publishers.length >= 2);
    assert.ok(publishers.some((p) => p !== p.toLowerCase()));
    assert.ok(headOnly.length >= 1, "a head-only exported user");
    assert.ok(corpus.theorems.length >= 2);
    assert.ok(corpus.files.some((f) => filePage(f.id).publisher === null));
    assert.ok(
      corpus.files.some((f) => filePage(f.id).publisher?.username === UNATTRIBUTED),
    );
  });

  test("every page kind and static page is emitted with its RSC payload", () => {
    const pages = [
      ...corpus.files.map((f) => `f/${f.id}`),
      ...exportedUsers.map((name) => `u/${name}`),
      ...corpus.theorems.map((id) => `theorem/${id}`),
      "index",
      "graph",
      "install/toolkit",
      "install/cli",
      "auth/cli",
    ];
    for (const page of pages) {
      assert.ok(existsSync(path.join(OUT, `${page}.html`)), `${page}.html`);
      assert.ok(existsSync(path.join(OUT, `${page}.txt`)), `${page}.txt`);
    }
    assert.ok(existsSync(path.join(OUT, "404.html")), "404.html");
  });

  test("a profile is emitted for exactly each exported user", () => {
    const profiles = readdirSync(path.join(OUT, "u"));
    assert.deepEqual(
      profiles.filter((n) => n.endsWith(".html")).sort(),
      exportedUsers.map((name) => `${name}.html`),
    );
  });
});

describe("prerendered content without JavaScript", () => {
  test("file pages carry source text, declaration names, publisher and links", async () => {
    for (const { id } of corpus.files) {
      const file = filePage(id);
      const html = await getPage(`/f/${id}`);
      const text = visibleText(html);
      for (const line of file.content.split("\n").filter((l) => l.trim())) {
        assert.ok(text.includes(line), `/f/${id} source line ${JSON.stringify(line)}`);
      }
      for (const decl of file.decls) {
        assert.ok(text.includes(decl.local_name), `/f/${id} decl ${decl.local_name}`);
      }
      const username = file.publisher?.username ?? null;
      if (username === null || username === UNATTRIBUTED) {
        assert.ok(text.includes(UNATTRIBUTED), `/f/${id} unattributed marker`);
      } else {
        assert.ok(text.includes(`@${username}`), `/f/${id} publisher`);
        assert.ok(hrefs(html).includes(`/u/${username.toLowerCase()}`));
      }
      for (const ref of file.file_refs) {
        assert.ok(hrefs(html).includes(`/f/${ref.target_file_id}`), `/f/${id} import link`);
      }
      if (file.forked_from !== null) {
        assert.ok(hrefs(html).includes(`/f/${file.forked_from}`), `/f/${id} fork link`);
      }
    }
  });

  test("profile pages carry the username, declarations and links", async () => {
    for (const name of exportedUsers) {
      const data = readCorpus("data", "u", `${name}.json`);
      const html = await getPage(`/u/${name}`);
      const text = visibleText(html);
      assert.ok(text.includes(`@${data.profile.username}`), `/u/${name} username`);
      for (const axiom of data.profile.latest_user_axioms?.axioms ?? []) {
        assert.ok(text.includes(axiom.local_name), `/u/${name} axiom ${axiom.local_name}`);
      }
      for (const item of data.held_propositions.popularity.items) {
        assert.ok(text.includes(item.representative.name), `/u/${name} theorem`);
      }
      const axiomsFile = data.profile.latest_user_axioms?.file_id;
      if (axiomsFile) assert.ok(hrefs(html).includes(`/f/${axiomsFile}`));
    }
  });

  test("theorem pages carry the statement, publisher and source link", async () => {
    for (const id of corpus.theorems) {
      const data = readCorpus("data", "theorem", `${id}.json`);
      const html = await getPage(`/theorem/${id}`);
      const text = visibleText(html);
      assert.ok(text.includes(`theorem ${data.decl.local_name}`), `/theorem/${id} name`);
      for (const node of data.dag.nodes) {
        if (node.name) assert.ok(text.includes(node.name), `/theorem/${id} premise ${node.name}`);
      }
      const username = data.decl.publisher?.username ?? null;
      if (username === null || username === UNATTRIBUTED) {
        assert.ok(text.includes(UNATTRIBUTED), `/theorem/${id} unattributed`);
      } else {
        assert.ok(hrefs(html).includes(`/u/${username.toLowerCase()}`));
      }
      assert.ok(
        hrefs(html).includes(`/f/${data.decl.file_id}?def=${data.decl.def_id}`),
        `/theorem/${id} source link`,
      );
    }
  });

  test("the graph page carries the frozen Generation's poster and artifact preload", async () => {
    const manifest = readCorpus("graph", String(corpus.graph_generation), "manifest.json");
    const html = await getPage("/graph");
    const poster = html.match(
      /<svg[^>]*aria-label="Orthographic view of the most engaged region of the Knowledge Graph"[\s\S]*?<\/svg>/,
    );
    assert.ok(poster, "poster svg");
    assert.equal((poster[0].match(/<circle\b/g) ?? []).length, manifest.counts.nodes);
    assert.ok(
      html.includes(`<link rel="preload" as="fetch" href="${manifest.geometry_path}" crossorigin="anonymous"`),
      "geometry preload",
    );
  });

  test("static pages and the archive 404 render", async () => {
    assert.match(visibleText(await getPage("/")), /Publishing has closed/);
    assert.match(visibleText(await getPage("/install/toolkit")), /Install the Axiom Toolkit/);
    assert.match(visibleText(await getPage("/install/cli")), /Install the AXM CLI/);
    assert.match(visibleText(await getPage("/auth/cli")), /axm upgrade/);
    const res = await fetch(`${base}/f/zzzzzzzz`);
    assert.equal(res.status, 404);
    assert.match(visibleText(await res.text()), /not in the Axiom archive/);
  });
});

describe("emitted files carry no account data or trackers", () => {
  const sentinels = (() => {
    const alice = readCorpus("data", "u", "alicesmith.json").profile;
    const uid = filePage("a1b2c3d4").publisher.user_id;
    return [alice.display_name, alice.bio, alice.avatar_color, alice.created_at, uid];
  })();
  const forbidden = [
    /"(display_name|bio|avatar_color|user_id|uid)"/,
    /\\"(display_name|bio|avatar_color|user_id|uid)\\"/,
    /\/api\/beta\/me\b/,
    /googletagmanager|gtag\(|\bG-[A-Z0-9]{8,12}\b/,
    /firebase/i,
    /\/u\/unattributed/,
  ];
  const textFiles = () =>
    walk(OUT).filter((p) => /\.(html|txt|js|json|css)$/.test(p));

  test("the fixture's account sentinels are real values", () => {
    for (const s of sentinels) assert.ok(typeof s === "string" && s.length > 0);
  });

  test("no emitted file contains a sentinel or forbidden pattern", () => {
    for (const p of textFiles()) {
      const body = readFileSync(p, "utf8");
      for (const s of sentinels) {
        assert.ok(!body.includes(s), `${path.relative(OUT, p)} contains ${s}`);
      }
      for (const re of forbidden) {
        assert.ok(!re.test(body), `${path.relative(OUT, p)} matches ${re}`);
      }
    }
  });

  test("no page or payload carries a firebase-uid-shaped value", () => {
    const uidShaped = /(?<![A-Za-z0-9_$-])[A-Za-z0-9]{28}(?![A-Za-z0-9_$-])/g;
    for (const p of walk(OUT).filter((f) => /\.(html|txt)$/.test(f))) {
      const body = readFileSync(p, "utf8").replace(/<script\b[^>]*src="[^"]*"/g, "");
      const hits = (body.match(uidShaped) ?? []).filter(
        (h) => /[0-9]/.test(h) && /[A-Z]/.test(h) && /[a-z]/.test(h),
      );
      assert.deepEqual(hits, [], path.relative(OUT, p));
    }
  });
});

describe("same-origin archive data", () => {
  const corpusFiles = (dir) =>
    walk(path.join(CORPUS, dir)).map((p) => path.relative(CORPUS, p));

  test("every data/def and data/prop file is served at the path the viewer fetches", async () => {
    const files = [...corpusFiles("data/def"), ...corpusFiles("data/prop")];
    assert.ok(files.length > 0);
    for (const rel of files) {
      const res = await fetch(`${base}/${rel.split(path.sep).join("/")}`);
      assert.equal(res.status, 200, rel);
      assert.equal(await res.text(), readFileSync(path.join(CORPUS, rel), "utf8"), rel);
    }
  });

  test("every graph file is served at its corpus path, and the manifest names those paths", async () => {
    const gen = String(corpus.graph_generation);
    const files = corpusFiles("graph").map((rel) => rel.split(path.sep).join("/"));
    assert.deepEqual(files.sort(), [
      `graph/${gen}/graph.json`,
      `graph/${gen}/labels.json`,
      `graph/${gen}/manifest.json`,
    ]);
    for (const rel of files) {
      const res = await fetch(`${base}/${rel}`);
      assert.equal(res.status, 200, rel);
      assert.equal(await res.text(), readFileSync(path.join(CORPUS, rel), "utf8"), rel);
    }
    const manifest = readCorpus("graph", gen, "manifest.json");
    assert.equal(manifest.geometry_path, `/graph/${gen}/graph.json`);
    assert.equal(manifest.labels_path, `/graph/${gen}/labels.json`);
  });

  test("theorem-redirects.json is copied to the site root", () => {
    const redirects = readFileSync(path.join(CORPUS, "theorem-redirects.json"), "utf8");
    assert.ok(Object.keys(JSON.parse(redirects)).length > 0);
    assert.equal(readFileSync(path.join(OUT, "theorem-redirects.json"), "utf8"), redirects);
  });

  test("search-index.json is served at the path the viewer fetches", async () => {
    const index = readFileSync(path.join(CORPUS, "search-index.json"), "utf8");
    const { constants, types, users } = JSON.parse(index);
    assert.ok(constants.length > 0 && types.length > 0 && users.length > 0);
    const res = await fetch(base + SEARCH_INDEX_PATH);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), index);
  });

  test("the merged-proposition alias map is emitted beside the panel data", () => {
    const aliases = JSON.parse(readFileSync(path.join(OUT, "data/prop-aliases.json"), "utf8"));
    assert.ok(Object.keys(corpus.proposition_aliases).length > 0);
    assert.deepEqual(aliases, corpus.proposition_aliases);
  });
});

describe("sitemap and robots", () => {
  const SITE = "https://axiomreason.com";
  const STATIC_PAGES = ["/", "/graph", "/install/toolkit", "/install/cli"];

  test("sitemap.xml lists exactly the corpus pages plus the static pages", async () => {
    const xml = await getPage("/sitemap.xml");
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    const expected = [
      ...STATIC_PAGES,
      ...corpus.files.map((f) => `/f/${f.id}`),
      ...exportedUsers.map((name) => `/u/${name}`),
      ...corpus.theorems.map((id) => `/theorem/${id}`),
    ].map((p) => new URL(p, SITE).toString());
    assert.deepEqual([...locs].sort(), [...expected].sort());
    assert.equal(new Set(locs).size, locs.length);
  });

  test("robots.txt is static and points at the sitemap", () => {
    const robots = readFileSync(path.join(OUT, "robots.txt"), "utf8");
    assert.match(robots, /^User-Agent: \*$/m);
    assert.match(robots, /^Disallow: \/local$/m);
    assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap.xml$`, "m"));
  });
});

describe("archive banner", () => {
  const REPO = "https://github.com/BuildCoherence/axiom-reason-ea";

  test("every emitted page carries the read-only banner with the GitHub link", () => {
    const pages = walk(OUT).filter((p) => p.endsWith(".html"));
    assert.ok(pages.length > corpus.files.length);
    for (const p of pages) {
      const html = readFileSync(p, "utf8");
      const banner = html.match(/<div role="note" aria-label="Archive notice"[\s\S]*?<\/div>/);
      assert.ok(banner, `${path.relative(OUT, p)} banner`);
      const text = visibleText(banner[0]);
      assert.match(text, /Read-only archive/, path.relative(OUT, p));
      assert.match(text, /Publishing has closed/, path.relative(OUT, p));
      assert.ok(hrefs(banner[0]).includes(REPO), `${path.relative(OUT, p)} GitHub link`);
    }
  });
});
