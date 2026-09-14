import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260913050000_media_admin_commands.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/rollbacks/20260913050000_media_admin_commands.rollback.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/admin/media/route.ts", import.meta.url), "utf8");

test("media administration allocates immutable root codes atomically", () => {
  assert.match(migration, /create sequence public\.movie_internal_code_sequence/);
  assert.match(migration, /create sequence public\.series_internal_code_sequence/);
  assert.match(migration, /security definer/);
  assert.match(migration, /if not public\.is_admin\(\)/);
  assert.match(migration, /return 'MOV-' \|\| lpad\(nextval/);
  assert.match(migration, /return 'SER-' \|\| lpad\(nextval/);
  assert.match(migration, /revoke all on sequence public\.movie_internal_code_sequence from public/);
  assert.match(migration, /grant execute on function public\.next_movie_internal_code\(\) to authenticated/);
  assert.match(rollback, /drop function if exists public\.next_movie_internal_code/);
  assert.match(rollback, /drop sequence if exists public\.series_internal_code_sequence/);
});

test("media administration route is same-origin, administrator-only, and derives child codes", () => {
  assert.match(route, /if \(!isSameOrigin\(request\)\)/);
  assert.match(route, /access\?\.profile\?\.is_authorized && access\.profile\.role === "admin"/);
  assert.match(route, /next_movie_internal_code/);
  assert.match(route, /next_series_internal_code/);
  assert.match(route, /series\.internal_code \+ "-S"/);
  assert.match(route, /season\.internal_code \+ "-E"/);
  assert.match(route, /\.update\(\{ admin_code: adminCode, admin_title: title, status \}\)/);
  assert.doesNotMatch(route, /\.delete\(/);
});
