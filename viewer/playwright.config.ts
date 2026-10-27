import { defineConfig, devices } from "@playwright/test";

import { OFF_LOOPBACK_HOST } from "./test/e2e/hosts";

// Runs against `out/` from `npm run build:fixture`; global-setup serves it.
export default defineConfig({
  testDir: "test/e2e",
  globalSetup: "./test/e2e/global-setup.ts",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    // A non-loopback name for the same server, to load pages as the archive.
    launchOptions: {
      args: [`--host-resolver-rules=MAP ${OFF_LOOPBACK_HOST} 127.0.0.1`],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
