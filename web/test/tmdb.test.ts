import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTmdbUrl, mapTmdbMetadata } from "../src/lib/tmdb/metadata.ts";

const migration = readFileSync(new URL("../supabase/migrations/20260913040000_tmdb_metadata_cache.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/rollbacks/20260913040000_tmdb_metadata_cache.rollback.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/admin/tmdb/route.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/lib/tmdb/config.ts", import.meta.url), "utf8");

test("TMDB metadata normalizes useful fields while retaining the provider payload", () => {
  const payload = {
    backdrop_path: "/backdrop.jpg",
    genres: [{ id: 14, name: "Fantasía" }, { id: "invalid", name: "No" }],
    id: 671,
    original_title: "Harry Potter and the Philosopher's Stone",
    overview: "Un niño descubre un mundo mágico.",
    poster_path: "/poster.jpg",
    release_date: "2001-11-16",
    runtime: 152,
    tagline: "Let the magic begin.",
    title: "Harry Potter y la piedra filosofal",
    vote_average: 7.914,
    vote_count: 28_000,
  };
  const metadata = mapTmdbMetadata("movie", payload);
  assert.equal(metadata.tmdb_id, 671);
  assert.equal(metadata.tmdb_url, "https://www.themoviedb.org/movie/671");
  assert.equal(metadata.vote_average, 7.9);
  assert.deepEqual(metadata.genres, [{ id: 14, name: "Fantasía" }]);
  assert.equal(metadata.raw_payload, payload);
});

test("TMDB canonical URLs preserve series hierarchy for seasons and episodes", () => {
  assert.equal(buildTmdbUrl("season", 101, { parentId: 1399, seasonNumber: 1 }), "https://www.themoviedb.org/tv/1399/season/1");
  assert.equal(buildTmdbUrl("episode", 102, { episodeNumber: 2, parentId: 1399, seasonNumber: 1 }), "https://www.themoviedb.org/tv/1399/season/1/episode/2");
  assert.throws(() => buildTmdbUrl("episode", 102, { parentId: 1399, seasonNumber: 1 }));
});

test("TMDB cache has one strict media parent, preserves consumer RLS, and has no delete policy", () => {
  assert.match(migration, /create table public\.media_tmdb_metadata/);
  assert.match(migration, /media_kind public\.tmdb_media_kind not null/);
  assert.match(migration, /raw_payload jsonb/);
  assert.match(migration, /unique \(media_kind, tmdb_id\)/);
  assert.match(migration, /Members read available TMDB metadata[\s\S]*exists \(select 1 from public\.movies/);
  assert.match(migration, /exists \(select 1 from public\.series_episodes/);
  assert.doesNotMatch(migration, /for delete to authenticated/);
  assert.match(rollback, /drop table if exists public\.media_tmdb_metadata/);
});

test("TMDB secret remains server-only and the route limits mutations to administrators", () => {
  assert.match(config, /import "server-only"/);
  assert.match(config, /TMDB_API_READ_ACCESS_TOKEN/);
  assert.doesNotMatch(config, /NEXT_PUBLIC_TMDB/);
  assert.match(route, /access\.profile\.role !== "admin"/);
  assert.match(route, /isSameOrigin\(request\)/);
  assert.match(route, /body\.action === "unlink"[\s\S]*\.update\(emptyCache\(\)\)/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_TMDB/);
});
