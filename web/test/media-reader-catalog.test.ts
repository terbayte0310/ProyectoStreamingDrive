import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const movies = readFileSync(new URL("../src/app/catalog/movies/page.tsx", import.meta.url), "utf8");
const movieDetail = readFileSync(new URL("../src/app/catalog/movies/[movieId]/page.tsx", import.meta.url), "utf8");
const series = readFileSync(new URL("../src/app/catalog/series/page.tsx", import.meta.url), "utf8");
const seriesDetail = readFileSync(new URL("../src/app/catalog/series/[seriesId]/page.tsx", import.meta.url), "utf8");
const courses = readFileSync(new URL("../src/app/catalog/cursos/page.tsx", import.meta.url), "utf8");
const mediaComponents = readFileSync(new URL("../src/components/media-catalog.tsx", import.meta.url), "utf8");

test("reader catalog keeps the requested module routes and cache-only TMDB rendering", () => {
  assert.match(courses, /import CatalogPage from "@\/app\/catalog\/page"/);
  assert.match(mediaComponents, /href: "\/catalog\/cursos"/);
  assert.match(mediaComponents, /href: "\/catalog\/movies"/);
  assert.match(mediaComponents, /href: "\/catalog\/series"/);
  for (const source of [movies, movieDetail, series, seriesDetail]) {
    assert.match(source, /requireAuthorizedAccess/);
    assert.match(source, /media_tmdb_metadata/);
    assert.doesNotMatch(source, /searchTmdb|fetchTmdbMetadata|api\.themoviedb\.org/);
  }
});

test("reader catalog explicitly asks for published content and preserves series hierarchy", () => {
  assert.match(movies, /\.eq\("status", "published"\)/);
  assert.match(movieDetail, /\.eq\("status", "published"\)/);
  assert.match(series, /\.eq\("status", "published"\)/);
  assert.match(seriesDetail, /series_seasons[\s\S]*\.eq\("status", "published"\)/);
  assert.match(seriesDetail, /series_episodes[\s\S]*\.eq\("status", "published"\)/);
  assert.match(seriesDetail, /\.in\("season_id", seasonIds\)/);
  assert.match(seriesDetail, /\.in\("episode_id", episodeIds\)/);
  assert.match(mediaComponents, /Datos e imágenes proporcionados por TMDB/);
});
