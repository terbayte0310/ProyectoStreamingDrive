import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const catalogPage = readFileSync(new URL("../src/app/catalog/page.tsx", import.meta.url), "utf8");

test("the root URL redirects to the protected courses catalog before Proxy runs", () => {
  assert.match(nextConfig, /source:\s*["']\/["'][\s\S]*destination:\s*["']\/catalog\/cursos["']/);
});

test("catalog startup fetches independent access data concurrently", () => {
  assert.match(catalogPage, /Promise\.all\(\[[\s\S]*get_my_module_access[\s\S]*get_catalog_home[\s\S]*\]\)/);
});

test("protected catalog avoids a second remote Auth user lookup", () => {
  assert.match(catalogPage, /auth\.getClaims\(\)/);
  assert.doesNotMatch(catalogPage, /auth\.getUser\(\)/);
});
