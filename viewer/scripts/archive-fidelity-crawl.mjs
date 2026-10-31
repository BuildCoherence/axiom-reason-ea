// Fails the build when a corpus page is missing from the static export, renders
// without its text, or when any emitted page links to a path the export does
// not serve. Offline: reads only the export and the Published Corpus.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { corpusDir } from "./corpus-dir.mjs";

const THEOREM_REDIRECTS = "theorem-redirects.json";
const ROBOTS = "robots.txt";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });
}

const readJson = (...parts) => JSON.parse(readFileSync(path.join(...parts), "utf8"));

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function withoutScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

/** The text a reader sees with JavaScript disabled. */
export function visibleText(html) {
  return decodeEntities(withoutScripts(html).replace(/<[^>]+>/g, ""));
}

/** Every `href` attribute value on a tag outside a script. */
export function hrefs(html) {
  const out = [];
  for (const tag of withoutScripts(html).match(/<[a-z][^>]*>/gi) ?? []) {
    const m = tag.match(/\shref="([^"]*)"/i);
    if (m) out.push(decodeEntities(m[1]));
  }
  return out;
}

function pageUrl(rel) {
  const p = rel.split(path.sep).join("/").replace(/\.html$/, "");
  return p === "index" ? "/" : `/${p}`;
}

// The order-preserving search keeps the scan linear in the page size.
function missingLine(text, content) {
  let at = 0;
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    const found = text.indexOf(line, at);
    if (found === -1) return line;
    at = found + line.length;
  }
  return null;
}

function siteOrigin(out) {
  const robots = path.join(out, ROBOTS);
  const m = existsSync(robots) && readFileSync(robots, "utf8").match(/^Sitemap:\s*(\S+)\s*$/m);
  if (!m) throw new Error(`${ROBOTS} has no Sitemap line naming the site origin`);
  return new URL(m[1]).origin;
}

/** Every page the corpus enumerates, with the text its HTML must carry. */
function enumeratedPages(corpus) {
  const index = readJson(corpus, "corpus.json");
  const pages = [];
  for (const { id } of index.files) {
    const { content } = readJson(corpus, "data", "f", `${id}.json`).file;
    pages.push({ url: `/f/${id}`, file: `f/${id}.html`, content });
  }
  // Every exported user has a data/u file: publishers and head-only users.
  const users = readdirSync(path.join(corpus, "data", "u"))
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -".json".length));
  for (const name of users) {
    const { username } = readJson(corpus, "data", "u", `${name}.json`).profile;
    pages.push({ url: `/u/${name}`, file: `u/${name}.html`, needle: `@${username}` });
  }
  for (const id of index.theorems) {
    const { local_name } = readJson(corpus, "data", "theorem", `${id}.json`).decl;
    pages.push({ url: `/theorem/${id}`, file: `theorem/${id}.html`, needle: `theorem ${local_name}` });
  }
  return pages;
}

function coverageMisses(out, pages) {
  const misses = [];
  for (const page of pages) {
    const file = path.join(out, page.file);
    if (!existsSync(file)) {
      misses.push(`${page.url}: ${page.file} is not in the export`);
      continue;
    }
    const text = visibleText(readFileSync(file, "utf8"));
    if (page.content !== undefined) {
      if (page.content.trim() === "") {
        misses.push(`${page.url}: the corpus file has empty source text`);
        continue;
      }
      const line = missingLine(text, page.content);
      if (line !== null) misses.push(`${page.url}: source line ${JSON.stringify(line)} is not in the page text`);
    } else if (!text.includes(page.needle)) {
      misses.push(`${page.url}: ${JSON.stringify(page.needle)} is not in the page text`);
    }
  }
  return misses;
}

function linkMisses(out, files) {
  const origin = siteOrigin(out);
  const served = new Set(files.map((f) => path.relative(out, f).split(path.sep).join("/")));
  const redirectIds = new Set(Object.keys(readJson(out, THEOREM_REDIRECTS)));
  const resolves = (pathname) => {
    let p;
    try {
      p = decodeURIComponent(pathname).slice(1);
    } catch {
      return false;
    }
    if (p === "" || p.endsWith("/")) return served.has(`${p}index.html`);
    if (served.has(p) || served.has(`${p}.html`)) return true;
    const theorem = p.match(/^theorem\/([^/]+)$/);
    return theorem !== null && redirectIds.has(theorem[1]);
  };
  const misses = [];
  let links = 0;
  for (const file of files.filter((f) => f.endsWith(".html"))) {
    const from = pageUrl(path.relative(out, file));
    for (const href of new Set(hrefs(readFileSync(file, "utf8")))) {
      links++;
      let target;
      try {
        target = new URL(href, origin + from);
      } catch {
        misses.push(`${from} links to ${href}: not a URL`);
        continue;
      }
      if (target.origin !== origin) continue;
      if (!resolves(target.pathname)) {
        misses.push(`${from} links to ${target.pathname}: no file under out/ and not a ${THEOREM_REDIRECTS} id`);
      }
    }
  }
  return { links, misses };
}

/** Every coverage and link miss of the export `out` against the corpus; empty when it passes. */
export function fidelityMisses(out, corpus = corpusDir()) {
  const pages = enumeratedPages(corpus);
  const links = linkMisses(out, walk(out));
  return {
    pages: pages.length,
    links: links.links,
    misses: [...coverageMisses(out, pages), ...links.misses],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  if (out === undefined) {
    console.error("usage: archive-fidelity-crawl.mjs <export dir>");
    process.exit(2);
  }
  const { pages, links, misses } = fidelityMisses(path.resolve(out));
  for (const m of misses) console.error(m);
  console.log(`${pages} corpus pages and ${links} links checked, ${misses.length} misses`);
  process.exit(misses.length === 0 ? 0 : 1);
}
