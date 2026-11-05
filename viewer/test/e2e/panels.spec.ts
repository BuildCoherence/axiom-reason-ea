import type { Page } from "@playwright/test";

import { archiveUrl } from "./hosts";
import {
  declarationPanel,
  expect,
  openHolders,
  propositionPanel,
  test,
} from "./same-origin";

const at = (path: string) => new URL(path, archiveUrl()).toString();

// The author-view slice is highlighted in the browser: Shiki's token spans
// carry the Base16 `var(--baseXX)` colours.
async function expectHighlightedSlice(page: Page) {
  await expect(
    declarationPanel(page).locator('span[style*="var(--base"]').first(),
  ).toBeAttached();
}

async function expectReferencedBy(page: Page, names: string[]) {
  const section = declarationPanel(page).getByRole("region", { name: "Referenced by" });
  if (names.length === 0) {
    await expect(section).toContainText("Nothing references this declaration.");
    return;
  }
  for (const name of names) {
    await expect(section.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

test.describe("file page", () => {
  test("def panel, slice highlight and referenced-by open with data", async ({ page }) => {
    await page.goto(at("/f/a1b2c3d4?def=g0000001"));
    const panel = declarationPanel(page);
    await expect(panel.getByRole("region", { name: "Identity" })).toContainText("golden_rule");
    await expect(panel).toContainText("Published in a1b2c3d4");
    await expectHighlightedSlice(page);
    await expectReferencedBy(page, ["everyone_kind"]);
  });

  test("a theorem's def panel links to its theorem page", async ({ page }) => {
    await page.goto(at("/f/b2c3d4e5?def=e0000001"));
    const link = declarationPanel(page).getByRole("link", { name: "View theorem page" });
    await expect(link).toHaveAttribute("href", "/theorem/e0000001");
    await expectReferencedBy(page, []);
  });

  test("a source identifier opens its def panel, which outlines the file", async ({ page }) => {
    await page.goto(at("/f/a1b2c3d4"));
    await page.locator('.ce-identifier[data-def-id="p0000001"]').first().click();
    const panel = declarationPanel(page);
    await expect(panel.getByRole("region", { name: "Identity" })).toContainText("Ethics.Person");
    const outline = panel.getByRole("region", { name: "In this file" });
    for (const name of ["Person", "Kind", "golden_rule"]) {
      await expect(outline.getByRole("button", { name, exact: true })).toBeVisible();
    }
  });

  test("the command palette filters the file's decls and opens the pick", async ({ page }) => {
    await page.goto(at("/f/a1b2c3d4"));
    await page.keyboard.press("/");
    const palette = page.getByRole("dialog", { name: "Jump to declaration" });
    await palette.getByRole("combobox").fill("Kind");
    await palette.getByRole("option", { name: /Ethics\.Kind/ }).click();
    const identity = declarationPanel(page).getByRole("region", { name: "Identity" });
    await expect(identity).toContainText("Ethics.Kind");
  });

  test("an outline pick replaces the open def panel", async ({ page }) => {
    await page.goto(at("/f/a1b2c3d4?def=g0000001"));
    const panel = declarationPanel(page);
    const identity = panel.getByRole("region", { name: "Identity" });
    await expect(identity).toContainText("golden_rule");
    const outline = panel.getByRole("region", { name: "In this file" });
    await outline.getByRole("button", { name: "Kind", exact: true }).click();
    await expect(identity).toContainText("Ethics.Kind");
    await expect(page).toHaveURL(/[?&]def=k0000001(&|$)/);
  });

  test("a palette pick replaces the open def panel", async ({ page }) => {
    await page.goto(at("/f/a1b2c3d4?def=g0000001"));
    const identity = declarationPanel(page).getByRole("region", { name: "Identity" });
    await expect(identity).toContainText("golden_rule");
    await page.keyboard.press("/");
    const palette = page.getByRole("dialog", { name: "Jump to declaration" });
    await palette.getByRole("combobox").fill("Person");
    await palette.getByRole("option", { name: /Ethics\.Person/ }).click();
    await expect(identity).toContainText("Ethics.Person");
    await expect(page).toHaveURL(/[?&]def=p0000001(&|$)/);
  });

  test("proposition panel and its holders open with data", async ({ page }) => {
    await page.goto(at("/f/a1b2c3d4?prop=q0000001"));
    await expect(propositionPanel(page).getByRole("region", { name: "Adoption" })).toBeVisible();
    const dialog = await openHolders(page);
    await expect(dialog.getByRole("row", { name: /AliceSmith.*Adopts.*axiom golden_rule/ })).toBeVisible();
    await expect(dialog.getByRole("row", { name: /bob.*Rejects/ })).toBeVisible();
  });

  test("a head-only holder's link opens their profile page", async ({ page }) => {
    await page.goto(at("/f/a1b2c3d4?prop=q0000001"));
    const dialog = await openHolders(page);
    const link = dialog.getByRole("row", { name: /carol.*Adopts/ }).getByRole("link", { name: "@carol" });
    await expect(link).toHaveAttribute("href", "/u/carol");
    await link.click();
    await expect(page).toHaveURL(/\/u\/carol$/);
    await expect(page.getByRole("region", { name: "Axioms" })).toContainText("Axioms (1)");
  });

  test("a holder's link to a projection-hinted theorem goes to its redirect target", async ({ page }) => {
    await page.goto(at("/f/a1b2c3d4?prop=q0000001"));
    const dialog = await openHolders(page);
    const row = dialog.getByRole("row", { name: /bob.*Adopts/ });
    // theorem-redirects.json: x0000001 → {file_id: a1b2c3d4, proposition_id: q0000001}
    await expect(row.getByRole("link", { name: "via an argument" })).toHaveAttribute(
      "href",
      "/f/a1b2c3d4?prop=q0000001",
    );
  });

  test.describe("merged proposition", () => {
    test.use({ allowMisses: [/\/data\/prop\/q0000009\.json$/] });

    test("a merged proposition id opens its surviving proposition", async ({ page }) => {
      await page.goto(at("/f/a1b2c3d4?prop=q0000009"));
      const dialog = await openHolders(page);
      await expect(dialog.getByRole("row", { name: /AliceSmith.*axiom golden_rule/ })).toBeVisible();
    });
  });
});

test.describe("theorem page", () => {
  test("adopters drill-in opens with data", async ({ page }) => {
    await page.goto(at("/theorem/e0000001"));
    await page.getByRole("button", { name: "2 users adopt this argument" }).click();
    const dialog = page.getByRole("dialog", { name: "Adopters" });
    await expect(dialog.getByRole("row", { name: "AliceSmith" })).toBeVisible();
    await expect(dialog.getByRole("row", { name: "bob" })).toBeVisible();
  });

  test("a premise's holders drill-in opens with data", async ({ page }) => {
    await page.goto(at("/theorem/m0000001"));
    await page.getByRole("button", { name: "1 hold, 0 reject — view holders" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Holders" });
    await expect(dialog.getByRole("row", { name: /bob.*Adopts/ })).toBeVisible();
  });

  // Two removed accounts on one list share the unattributed marker; rows keyed
  // by username alone leave a stale row behind when a search narrows the list.
  test("two unattributed holders list and filter as distinct rows", async ({ page }) => {
    await page.goto(at("/theorem/m0000001"));
    await page.getByRole("button", { name: "3 hold, 0 reject — view holders" }).click();
    const dialog = page.getByRole("dialog", { name: "Holders" });
    const unattributed = dialog.getByRole("row", { name: /unattributed \(account removed\).*Adopts/ });
    await expect(unattributed).toHaveCount(2);
    await dialog.getByRole("searchbox", { name: "Search holders by username" }).fill("unattributed");
    await expect(dialog.getByRole("row", { name: /bob/ })).toHaveCount(0);
    await expect(dialog.getByRole("row")).toHaveCount(3);
    await expect(unattributed).toHaveCount(2);
  });

  test("two unattributed adopters list and filter as distinct rows", async ({ page }) => {
    await page.goto(at("/theorem/m0000001"));
    await page.getByRole("button", { name: "3 users adopt this argument" }).click();
    const dialog = page.getByRole("dialog", { name: "Adopters" });
    const unattributed = dialog.getByRole("row", { name: "unattributed (account removed)" });
    await expect(unattributed).toHaveCount(2);
    await dialog.getByRole("searchbox", { name: "Search adopters by username" }).fill("unattributed");
    await expect(dialog.getByRole("row", { name: "bob" })).toHaveCount(0);
    await expect(dialog.getByRole("row")).toHaveCount(3);
    await expect(unattributed).toHaveCount(2);
  });

  test("def panel and referenced-by open with data", async ({ page }) => {
    await page.goto(at("/theorem/e0000001?def=k0000001"));
    await expect(declarationPanel(page).getByRole("region", { name: "Identity" })).toContainText("Kind");
    await expectHighlightedSlice(page);
    await expectReferencedBy(page, ["everyone_kind"]);
  });

  test("proposition panel opens with data", async ({ page }) => {
    await page.goto(at("/theorem/e0000001?prop=q0000002"));
    const dialog = await openHolders(page);
    await expect(dialog.getByRole("row", { name: /AliceSmith.*Adopts/ })).toBeVisible();
  });
});

test.describe("profile page", () => {
  test("the held-propositions list opens its def panel with data", async ({ page }) => {
    await page.goto(at("/u/bob"));
    const theorems = page.getByRole("region", { name: "Theorems" });
    await theorems.getByRole("button", { name: "Show all", exact: true }).click();
    await theorems.getByText("everyone_kind").first().click();
    await expect(page).toHaveURL(/\?def=e0000001$/);
    await expect(declarationPanel(page).getByRole("region", { name: "Identity" })).toContainText(
      "everyone_kind",
    );
    await expectReferencedBy(page, []);
  });

  test("proposition panel holders link to theorem pages and redirect targets", async ({ page }) => {
    await page.goto(at("/u/alicesmith?prop=q0000002"));
    const dialog = await openHolders(page);
    await expect(
      dialog.getByRole("row", { name: /AliceSmith/ }).getByRole("link", { name: "via an argument" }),
    ).toHaveAttribute("href", "/theorem/e0000001");
    // theorem-redirects.json: y0000001 → {file_id: c3d4e5f6} (no proposition)
    await expect(
      dialog.getByRole("row", { name: /bob/ }).getByRole("link", { name: "via an argument" }),
    ).toHaveAttribute("href", "/f/c3d4e5f6?def=y0000001");
  });
});
