import { archiveUrl, offLoopback, workspaceUrl } from "./hosts";
import { expect, test } from "./same-origin";

const UNAVAILABLE = "Your workspace appears only in axm viewer";

test.describe("/local", () => {
  test("off loopback it shows the axm viewer notice and the nav has no link", async ({
    page,
    requests,
  }) => {
    await page.goto(new URL("/local", offLoopback(workspaceUrl())).toString());
    await expect(page.getByRole("main")).toContainText(UNAVAILABLE);
    await expect(page.getByRole("navigation", { name: "Site" })).toContainText("Install");
    await expect(page.getByRole("link", { name: "Workspace" })).toHaveCount(0);
    expect(requests.filter((u) => u.includes("/local/api/"))).toEqual([]);
  });

  test.describe("on loopback without a workspace", () => {
    test.use({ allowMisses: [/\/local\/api\/files$/] });

    test("a non-200 file list shows the axm viewer notice", async ({ page }) => {
      await page.goto(new URL("/local", archiveUrl()).toString());
      await expect(page.getByRole("main")).toContainText(UNAVAILABLE);
      await expect(page.getByRole("link", { name: "Workspace" })).toBeVisible();
    });
  });

  test("on loopback the nav links to the workspace, whose files render with corpus import links", async ({
    page,
  }) => {
    await page.goto(new URL("/", workspaceUrl()).toString());
    await page.getByRole("link", { name: "Workspace" }).click();
    await expect(page).toHaveURL(/\/local$/);
    const files = page.getByRole("navigation", { name: "Workspace files" });
    await expect(files.getByRole("button", { name: "Notes/Draft.lean" })).toBeVisible();
    await files.getByRole("button", { name: "MyIdeas.lean" }).click();
    await expect(page).toHaveURL(/\?path=MyIdeas\.lean$/);

    const source = page.locator('[aria-label="MyIdeas.lean source"][data-highlighted]');
    await expect(source).toContainText("axiom local_claim");
    await expect(source.getByRole("link", { name: "a1b2c3d4" })).toHaveAttribute("href", "/f/a1b2c3d4");
    await expect(source.getByRole("link", { name: "b2c3d4e5" })).toHaveAttribute("href", "/f/b2c3d4e5");
    await source.getByRole("link", { name: "a1b2c3d4" }).click();
    await expect(page).toHaveURL(/\/f\/a1b2c3d4$/);
  });
});
