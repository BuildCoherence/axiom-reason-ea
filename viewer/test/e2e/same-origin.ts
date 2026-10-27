import { expect, test as base, type Page } from "@playwright/test";

// Every test records the page's requests and fails if any leaves the origin
// it loaded from, or if a same-origin read fails other than as `allowMisses`.
export const test = base.extend<{ allowMisses: RegExp[]; requests: string[] }>({
  allowMisses: [[], { option: true }],
  requests: [
    async ({ page, allowMisses }, use) => {
      const requests: string[] = [];
      const failures: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      page.on("requestfailed", (r) => failures.push(`${r.url()} ${r.failure()?.errorText}`));
      page.on("response", (r) => {
        if (r.status() >= 400 && !allowMisses.some((re) => re.test(r.url()))) {
          failures.push(`${r.url()} ${r.status()}`);
        }
      });
      await use(requests);
      const origin = new URL(page.url()).origin;
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.filter((u) => new URL(u).origin !== origin)).toEqual([]);
      expect(requests.filter((u) => new URL(u).pathname.startsWith("/api/"))).toEqual([]);
      expect(failures).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export function declarationPanel(page: Page) {
  return page.getByRole("region", { name: "Declaration inspection" });
}

export function propositionPanel(page: Page) {
  return page.getByRole("region", { name: "Proposition inspection" });
}

/** Opens the holders drill-in from a panel's Adoption bar. */
export async function openHolders(page: Page) {
  await propositionPanel(page)
    .getByRole("region", { name: "Adoption" })
    .getByRole("button")
    .click();
  const dialog = page.getByRole("dialog", { name: "Holders" });
  await expect(dialog.getByRole("table")).toBeVisible();
  return dialog;
}
