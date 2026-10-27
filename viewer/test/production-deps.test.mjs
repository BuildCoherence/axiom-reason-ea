// The production dependency set is what `license-checker --production` reads
// at extraction; build-only tooling must stay out of it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const BUILD_ONLY = ["tailwindcss", "@tailwindcss/postcss", "postcss", "typescript"];

test("build-only tooling is declared as devDependencies", () => {
  for (const name of BUILD_ONLY) {
    assert.ok(pkg.devDependencies?.[name], `${name} in devDependencies`);
    assert.ok(!pkg.dependencies?.[name], `${name} not in dependencies`);
  }
});

test("no lightningcss package is installed for production", () => {
  const prod = Object.entries(lock.packages)
    .filter(([key]) => /(^|\/)node_modules\/lightningcss[^/]*$/.test(key))
    .filter(([, entry]) => entry.dev !== true);
  assert.deepEqual(prod.map(([key]) => key), []);
});
