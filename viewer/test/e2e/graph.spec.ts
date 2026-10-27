import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { archiveUrl, offLoopback } from "./hosts";
import { declarationPanel, expect, propositionPanel, test } from "./same-origin";

const CORPUS = path.resolve(__dirname, "../fixtures/corpus");
const corpus = JSON.parse(readFileSync(path.join(CORPUS, "corpus.json"), "utf8"));
const GEN = String(corpus.graph_generation);
const manifest = JSON.parse(readFileSync(path.join(CORPUS, "graph", GEN, "manifest.json"), "utf8"));

const CANVAS_LABEL =
  "Interactive 3D view of the Knowledge Graph. Use the search box to find a node by name.";
// `formatDate(corpus.frozen_at, "UTC")` for the fixture's 2026-11-01T12:00:00Z.
const FROZEN_DATE = "Nov 1, 2026";

const at = (p: string, base: URL = archiveUrl()) => new URL(p, base).toString();

// Reduced motion settles the arrival, so `data-graph-quiesced` is reachable.
test.use({ contextOptions: { reducedMotion: "reduce" } });

function stage(page: Page) {
  return page.getByRole("application", { name: CANVAS_LABEL });
}

/** The island mounted (a WebGL context exists) and drew its settled frame. */
async function openGraph(page: Page, url: string) {
  await page.goto(url);
  await expect(stage(page)).toBeVisible();
  await page.waitForSelector('[data-graph-quiesced="true"]', { timeout: 30_000 });
}

function searchFor(page: Page, needle: string, label: string) {
  const search = page.getByRole("search");
  return search
    .getByRole("searchbox", { name: "Search the Knowledge Graph" })
    .fill(needle)
    .then(() => search.getByRole("button", { name: label }));
}

/** The island's hover/selection label, which picking's own projection
 *  positions just above the node it names. */
function nodeLabel(page: Page) {
  return stage(page).locator(':scope > div[aria-hidden="true"]');
}

/** Where the selected node labelled `label` sits once the camera settles on
 *  it: the label's horizontal centre, and the y just below the label. */
async function settledLabelAnchor(page: Page, label: string) {
  await expect(nodeLabel(page)).toHaveText(label);
  // `data-graph-quiesced` can still read "true" from before the flight starts,
  // so the label must also hold still across frames.
  let box = await nodeLabel(page).boundingBox();
  await expect
    .poll(async () => {
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const previous = JSON.stringify(box);
      box = await nodeLabel(page).boundingBox();
      const quiesced = await stage(page).getAttribute("data-graph-quiesced");
      return quiesced === "true" && JSON.stringify(box) === previous;
    })
    .toBe(true);
  if (!box) throw new Error("the node label has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height };
}

/** With nothing selected, walks the pointer down from `anchor` until the
 *  island's hit test labels the node `label`; returns that point. */
async function hoverNode(page: Page, anchor: { x: number; y: number }, label: string) {
  for (let dy = 2; dy <= 60; dy += 2) {
    const point = { x: anchor.x, y: anchor.y + dy };
    await page.mouse.move(point.x, point.y);
    const hit = await nodeLabel(page)
      .filter({ hasText: label })
      .waitFor({ state: "visible", timeout: 250 })
      .then(() => true)
      .catch(() => false);
    if (hit) return point;
  }
  throw new Error(`no point below the label hit ${label}`);
}

test.describe("/graph", () => {
  test("renders the fixture Generation from same-origin artifacts, and search reads its labels", async ({
    page,
    requests,
  }) => {
    const paths = () => requests.map((u) => new URL(u).pathname);
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.text().includes("graph-island:")) problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(String(e)));
    await openGraph(page, at("/graph", offLoopback(archiveUrl())));
    expect(paths()).toContain(manifest.geometry_path);

    const row = await searchFor(page, "modus", "theorem modus_ponens");
    await expect(row).toBeVisible();
    expect(paths()).toContain(manifest.labels_path);

    // The geometry is on the canvas: selecting a node flies to it and labels it.
    await row.click();
    await expect(page).toHaveURL(/\/graph\?def=m0000001$/);
    await settledLabelAnchor(page, "theorem modus_ponens");
    expect(problems).toEqual([]);
  });

  test("off loopback the graph carries no corpus label", async ({ page }) => {
    await openGraph(page, at("/graph", offLoopback(archiveUrl())));
    await expect(page.getByRole("contentinfo", { name: "Graph status" })).toBeVisible();
    await expect(page.getByText("published corpus at")).toHaveCount(0);
  });

  test("in the local target the graph is labeled with the corpus frozen_at", async ({ page }) => {
    await openGraph(page, at("/graph"));
    const status = page.getByRole("contentinfo", { name: "Graph status" });
    await expect(status).toContainText(`published corpus at ${FROZEN_DATE}`);
    await expect(status.locator("time")).toHaveAttribute("datetime", corpus.frozen_at);
  });

  test.describe("a canvas tap on a Proof Node", () => {
    const DEF_PATH = "/data/def/e0000001.json";
    // The search-opened read is answered 503 so the tap's read is a fresh one:
    // panel reads are memoized per page, and only a failed read is evicted.
    test.use({ allowMisses: [new RegExp(`${DEF_PATH.replace(/\./g, "\\.")}$`)] });

    test("opens its def panel, whose data loads from data/def", async ({ page, requests }) => {
      await openGraph(page, at("/graph"));
      const defReads = () => requests.filter((u) => new URL(u).pathname === DEF_PATH).length;

      // Locate the node on the canvas, then deselect it so only the tap opens it.
      await page.route(`**${DEF_PATH}`, (route) =>
        route.fulfill({ status: 503, contentType: "text/plain", body: "unavailable" }),
      );
      await (await searchFor(page, "everyone", "theorem Ethics.everyone_kind")).click();
      const anchor = await settledLabelAnchor(page, "theorem Ethics.everyone_kind");
      const narrow = (await stage(page).boundingBox())!;
      await expect.poll(defReads).toBe(1);
      await page.getByRole("button", { name: "Close panel" }).click();
      await expect(page).toHaveURL(/\/graph$/);
      await expect(declarationPanel(page)).toHaveCount(0);
      await page.unroute(`**${DEF_PATH}`);

      // Closing the docked panel widens the stage; the camera keeps its vertical
      // field of view, so a point keeps its pixel offset from the stage centre.
      await expect
        .poll(async () => (await stage(page).boundingBox())!.width)
        .toBeGreaterThan(narrow.width);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      await expect(stage(page)).toHaveAttribute("data-graph-quiesced", "true");
      const wide = (await stage(page).boundingBox())!;
      const fromCentre = anchor.x - (narrow.x + narrow.width / 2);
      const moved = { x: wide.x + wide.width / 2 + fromCentre, y: anchor.y };
      const point = await hoverNode(page, moved, "theorem Ethics.everyone_kind");
      await page.mouse.click(point.x, point.y);
      await expect(page).toHaveURL(/\/graph\?def=e0000001$/);
      await expect(declarationPanel(page).getByRole("region", { name: "Identity" })).toContainText(
        "everyone_kind",
      );
      expect(defReads()).toBe(2);
    });
  });

  test("a ?prop= deep link opens the proposition panel from data/prop", async ({ page, requests }) => {
    await openGraph(page, at("/graph?prop=q0000002"));
    await expect(propositionPanel(page).getByRole("region", { name: "Adoption" })).toBeVisible();
    expect(requests.map((u) => new URL(u).pathname)).toContain("/data/prop/q0000002.json");
  });
});
