// Serves a static export the way the archive and `axm viewer` resolve it:
// `/x` → `x` or `x.html`, unknown paths → `404.html` with status 404. Given a
// workspace directory it also answers `axm viewer`'s `/local/api/*` reads.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function within(root, rel) {
  const p = path.resolve(root, rel);
  return p === root || p.startsWith(root + path.sep) ? p : null;
}

function isFile(p) {
  return p !== null && existsSync(p) && statSync(p).isFile();
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}

function serveLocalApi(workspace, url, res) {
  if (url.pathname === "/local/api/files") {
    res.setHeader("Content-Type", CONTENT_TYPES[".json"]);
    res.end(JSON.stringify({ files: listFiles(workspace).sort().map((p) => ({ path: p })) }));
    return;
  }
  const file = url.pathname === "/local/api/file" ? within(workspace, url.searchParams.get("path") ?? "") : null;
  if (!isFile(file)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader("Content-Type", CONTENT_TYPES[".txt"]);
  res.end(readFileSync(file));
}

export function createExportServer(outDir, { workspace } = {}) {
  const root = path.resolve(outDir);
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (workspace !== undefined && url.pathname.startsWith("/local/api/")) {
      serveLocalApi(path.resolve(workspace), url, res);
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const candidates = rel === "" ? ["index.html"] : [rel, `${rel}.html`];
    const hit = candidates.map((c) => within(root, c)).find(isFile);
    const file = hit ?? path.join(root, "404.html");
    res.statusCode = hit ? 200 : 404;
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
}

/** Listens on an ephemeral loopback port and resolves to the base URL. */
export function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}
