import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260913030000_media_catalog_schema.sql", import.meta.url), "utf8");

test("media schema models independent movies and ordered series hierarchies", () => {
  assert.match(migration, /create table public\.movies/);
  assert.match(migration, /create table public\.series/);
  assert.match(migration, /create table public\.series_seasons/);
  assert.match(migration, /create table public\.series_episodes/);
  assert.match(migration, /references public\.series\(id\)/);
  assert.match(migration, /references public\.series_seasons\(id\)/);
  assert.match(migration, /unique \(series_id, season_number\)/);
  assert.match(migration, /unique \(season_id, episode_number\)/);
});

test("media schema validates immutable canonical codes and optional readable codes", () => {
  assert.match(migration, /\^MOV-\[0-9\]\{5,\}/);
  assert.match(migration, /\^SER-\[0-9\]\{5,\}/);
  assert.match(migration, /validate_series_season_internal_code/);
  assert.match(migration, /validate_series_episode_internal_code/);
  assert.match(migration, /prevent_media_internal_code_change/);
  assert.match(migration, /admin_code text unique/);
});

test("media schema limits consumers to published content and their assigned module", () => {
  assert.match(migration, /Movie members read published movies[\s\S]*public\.has_module_access\('movies'\)[\s\S]*status = 'published'/);
  assert.match(migration, /Series members read published series[\s\S]*public\.has_module_access\('series'\)[\s\S]*status = 'published'/);
  assert.match(migration, /Series members read published seasons[\s\S]*public\.is_published_series\(series_id\)/);
  assert.match(migration, /Series members read published episodes[\s\S]*public\.is_published_series_season\(season_id\)/);
  assert.doesNotMatch(migration, /for delete to authenticated/);
});

test("media schema has an explicit rollback and no Drive links or playback fields", () => {
  const rollback = readFileSync(new URL("../supabase/rollbacks/20260913030000_media_catalog_schema.rollback.sql", import.meta.url), "utf8");
  assert.match(rollback, /drop table if exists public\.series_episodes/);
  assert.match(rollback, /drop table if exists public\.movies/);
  assert.match(rollback, /drop type if exists public\.media_publication_status/);
  assert.doesNotMatch(migration, /\b(?:drive_file_id|drive_item_id|playback_url|stream_url|source_url)\s+(?:text|uuid)\b/i);
});
