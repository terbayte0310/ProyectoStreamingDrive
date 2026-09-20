import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const catalogPage = readFileSync(new URL("../src/app/catalog/page.tsx", import.meta.url), "utf8");
const access = readFileSync(new URL("../src/lib/auth/access.ts", import.meta.url), "utf8");

test("the root URL redirects to the protected courses catalog before Proxy runs", () => {
  assert.match(nextConfig, /source:\s*["']\/["'][\s\S]*destination:\s*["']\/catalog\/cursos["']/);
});

test("catalog startup fetches the viewer and the catalog concurrently", () => {
  assert.match(catalogPage, /Promise\.all\(\[[\s\S]*getViewer\(\)[\s\S]*get_catalog_home[\s\S]*\]\)/);
  assert.match(access, /export const getViewer = cache\(/);
  assert.match(access, /Promise\.all\(\[[\s\S]*profiles[\s\S]*get_my_module_access[\s\S]*\]\)/);
});

test("protected pages avoid a remote Auth user lookup", () => {
  assert.match(access, /auth\.getClaims\(\)/);
  for (const source of [catalogPage, access]) assert.doesNotMatch(source, /auth\.getUser\(\)/);
});
