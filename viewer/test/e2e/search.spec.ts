import type { Page } from "@playwright/test";

import { archiveUrl } from "./hosts";
import { declarationPanel, expect, test } from "./same-origin";

const at = (path: string) => new URL(path, archiveUrl()).toString();

function section(page: Page, name: string) {
  return page.getByRole("region", { name: new RegExp(`^${name}`) });
}

/** The `data-*` keys of a section's rows, in rendered order. */
async function rowKeys(page: Page, name: string, attr: "data-def-id" | "data-type-head") {
  const rows = section(page, name).locator(`li[${attr}]`);
  return rows.evaluateAll((els, a) => els.map((e) => e.getAttribute(a)), attr);
}

async function usernames(page: Page) {
  return section(page, "Users").locator("li").locator("div.font-semibold").allTextContents();
}

test.describe("/search", () => {
  test("lists Users, Type heads and Constants from the same-origin index, with no Source domain", async ({
    page,
    requests,
  }) => {
    await page.goto(at("/search"));
    await expect(section(page, "Constants").locator("li")).toHaveCount(6);
    expect(
      await page.locator("section[data-domain]").evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-domain")),
      ),
    ).toEqual(["users", "types", "constants"]);
    await expect(page.getByRole("group", { name: "Search domains" }).getByRole("checkbox")).toHaveCount(3);
    await expect(page.getByText("Source", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/active contributors/i)).toHaveCount(0);

    expect(await usernames(page)).toEqual(["@bob", "@AliceSmith", "@carol"]);
    expect(await rowKeys(page, "Type heads", "data-type-head")).toEqual([
      "Ethics.Kind",
      "Ethics.Person",
      "Nat",
    ]);
    // Newest first, the CLI's default order.
    expect(await rowKeys(page, "Constants", "data-def-id")).toEqual([
      "n0000001",
      "m0000001",
      "e0000001",
      "g0000001",
      "k0000001",
      "p0000001",
    ]);
    expect(requests.map((u) => new URL(u).pathname)).toContain("/search-index.json");
  });

  test("matches case-insensitive substrings, filters and sorts as `axm search` does", async ({ page }) => {
    await page.goto(at("/search"));
    await page.getByRole("searchbox", { name: "Search the archive" }).fill("KIND");
    await expect(section(page, "Constants").locator("li")).toHaveCount(2);
    expect(await rowKeys(page, "Constants", "data-def-id")).toEqual(["e0000001", "k0000001"]);
    expect(await rowKeys(page, "Type heads", "data-type-head")).toEqual(["Ethics.Kind"]);
    await expect(section(page, "Users")).toContainText("No matches.");

    await page.getByRole("searchbox", { name: "Search the archive" }).fill("");
    await page.getByRole("button", { name: "Advanced" }).click();
    await page.getByRole("checkbox", { name: "Theorems" }).click();
    await expect(section(page, "Constants").locator("li")).toHaveCount(2);
    expect(await rowKeys(page, "Constants", "data-def-id")).toEqual(["m0000001", "e0000001"]);
    await expect(page).toHaveURL(/[?&]kind=theorem(&|$)/);
  });

  test("restores author, date and sort filters from the URL", async ({ page }) => {
    await page.goto(at("/search?author=@aliceSMITH&sort=name:asc"));
    await expect(section(page, "Constants").locator("li")).toHaveCount(3);
    expect(await rowKeys(page, "Constants", "data-def-id")).toEqual(["g0000001", "k0000001", "p0000001"]);
    expect(await rowKeys(page, "Type heads", "data-type-head")).toEqual(["Ethics.Kind", "Ethics.Person"]);
    // The author facet does not apply to Users.
    expect(await usernames(page)).toEqual(["@AliceSmith", "@bob", "@carol"]);

    await page.goto(at("/search?created_after=2026-09-02&created_before=2026-09-04&sort=created_at:asc"));
    await expect(section(page, "Constants").locator("li")).toHaveCount(2);
    expect(await rowKeys(page, "Constants", "data-def-id")).toEqual(["e0000001", "m0000001"]);
    // A platform built-in has no date, so a date filter drops it.
    expect(await rowKeys(page, "Type heads", "data-type-head")).toEqual([]);
  });

  test("links every exported user to their profile", async ({ page }) => {
    await page.goto(at("/search?in=users"));
    const users = section(page, "Users");
    await expect(users.locator("li")).toHaveCount(3);
    await expect(users.getByRole("link", { name: "Profile →" })).toHaveCount(3);
    await expect(
      users.locator("li", { hasText: "@AliceSmith" }).getByRole("link", { name: "Profile →" }),
    ).toHaveAttribute("href", "/u/alicesmith");
    const carol = users.locator("li", { hasText: "@carol" });
    await expect(carol).toContainText("No published files");
    await expect(carol.getByRole("link", { name: "Profile →" })).toHaveAttribute("href", "/u/carol");
  });

  test("a constant's signature opens its def panel from data/def", async ({ page, requests }) => {
    await page.goto(at("/search?q=golden"));
    await section(page, "Constants").getByRole("button", { name: "Inspect Ethics.golden_rule" }).click();
    await expect(page).toHaveURL(/[?&]def=g0000001(&|$)/);
    await expect(declarationPanel(page).getByRole("region", { name: "Identity" })).toContainText(
      "golden_rule",
    );
    expect(requests.map((u) => new URL(u).pathname)).toContain("/data/def/g0000001.json");
  });
});

test.describe("/search type-head query", () => {
  test("Query instances lists the exact type head's declarations newest first", async ({ page }) => {
    await page.goto(at("/search?q=ethics"));
    await section(page, "Type heads")
      .locator('li[data-type-head="Ethics.Kind"]')
      .getByRole("button", { name: "Query instances →" })
      .click();
    await expect(page).toHaveURL(/[?&]type_head=Ethics\.Kind(&|$)/);
    // Ethics.Kind declares the head but its own type head is not Ethics.Kind.
    await expect(section(page, "Instances").locator("li")).toHaveCount(2);
    expect(await rowKeys(page, "Instances", "data-def-id")).toEqual(["e0000001", "g0000001"]);
    await expect(page.getByRole("region", { name: "Type head" })).toContainText("arity 1");

    await page.getByRole("button", { name: /Back to Search/ }).click();
    await expect(page.getByRole("searchbox", { name: "Search the archive" })).toHaveValue("ethics");
  });

  test("a platform type head lists its declarations", async ({ page }) => {
    await page.goto(at("/search?type_head=Nat"));
    await expect(page.getByRole("region", { name: "Type head" })).toContainText("platform");
    expect(await rowKeys(page, "Instances", "data-def-id")).toEqual(["n0000001"]);
    await expect(page.getByRole("button", { name: "View def →" })).toHaveCount(0);
  });

  test("a prefix of a type head is unknown", async ({ page }) => {
    await page.goto(at("/search?type_head=Ethics.Ki"));
    await expect(page.getByRole("alert").filter({ hasText: "Unknown type head" })).toContainText(
      "Unknown type head Ethics.Ki.",
    );
    await expect(section(page, "Instances")).toHaveCount(0);
  });

  test("the def panel opened from the inspector loads from data/def", async ({ page, requests }) => {
    await page.goto(at("/search?type_head=Ethics.Kind"));
    await page.getByRole("button", { name: "View def →" }).click();
    const identity = declarationPanel(page).getByRole("region", { name: "Identity" });
    await expect(identity).toContainText("Kind");
    await expect(page).toHaveURL(/[?&]def=k0000001(&|$)/);

    await section(page, "Instances").getByRole("button", { name: "Inspect everyone_kind" }).click();
    await expect(identity).toContainText("everyone_kind");
    const paths = requests.map((u) => new URL(u).pathname);
    expect(paths).toContain("/data/def/k0000001.json");
    expect(paths).toContain("/data/def/e0000001.json");
  });
});
