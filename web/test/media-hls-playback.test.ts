import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260913060000_media_hls_playback.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/rollbacks/20260913060000_media_hls_playback.rollback.sql", import.meta.url), "utf8");
const playbackRoute = readFileSync(new URL("../src/app/api/admin/media-playback/route.ts", import.meta.url), "utf8");
const manifestRoute = readFileSync(new URL("../src/app/api/media-hls/packages/[packageId]/manifest/route.ts", import.meta.url), "utf8");

test("HLS playback ties a package to exactly one movie or episode", () => {
  assert.match(migration, /check \(\(movie_id is null\) <> \(episode_id is null\)\)/);
  assert.match(migration, /media_hls_packages_movie_id_key/);
  assert.match(migration, /media_hls_packages_episode_id_key/);
  assert.match(migration, /manifest_asset_id uuid/);
  assert.match(migration, /validate_media_hls_manifest_asset/);
});

test("HLS playback limits readers to a ready published parent and their module", () => {
  assert.match(migration, /Movie members read ready playback packages/);
  assert.match(migration, /Series members read ready playback packages/);
  assert.match(migration, /public\.has_module_access\('movies'\)/);
  assert.match(migration, /public\.has_module_access\('series'\)/);
  assert.match(migration, /movie\.status = 'published'/);
  assert.match(migration, /episode\.status = 'published'/);
  assert.match(migration, /is_active/);
});

test("HLS scanner keeps Drive data server-side and reverses cleanly", () => {
  assert.match(playbackRoute, /assertFolderInsideSource/);
  assert.match(playbackRoute, /scanHlsPackage/);
  assert.match(playbackRoute, /isSameOrigin/);
  assert.match(manifestRoute, /rewriteHlsPlaylist/);
  assert.match(rollback, /drop table if exists public\.media_hls_assets/);
  assert.match(rollback, /drop type if exists public\.media_hls_package_status/);
});
