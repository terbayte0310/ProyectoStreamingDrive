import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const need = (k) => { const v = process.env[k]?.trim(); if (!v) throw Error("Falta " + k); return v; };
const str = (v) => typeof v === "string" && v.trim() ? v : null;
const pos = (v) => Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const nonneg = (v) => Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const now = () => new Date().toISOString();
const cols = { movie: "movie_id", series: "series_id", season: "season_id", episode: "episode_id" };

async function get(token, path, query = {}) {
  const url = new URL(path.replace(/^\//, ""), "https://api.themoviedb.org/3/");
  for (const [k, v] of Object.entries(query)) if (v) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { authorization: "Bearer " + token, accept: "application/json" } });
  if (!r.ok) throw Error("TMDB HTTP " + r.status);
  return await r.json();
}
async function cache(token, kind, context) {
  const path = kind === "movie" ? "/movie/" + context.id : kind === "series" ? "/tv/" + context.id : kind === "season" ? "/tv/" + context.parent + "/season/" + context.season : "/tv/" + context.parent + "/season/" + context.season + "/episode/" + context.episode;
  let payload; let locale = "original"; let fallback = "original";
  for (const [i, language] of ["es-MX", "es-ES"].entries()) {
    payload = await get(token, path, { language });
    if ([payload.title, payload.name, payload.overview].some(str)) { locale = language; fallback = i ? language : null; break; }
  }
  const id = pos(payload.id); if (!id) throw Error("TMDB devolvió un ID inválido");
  const genres = Array.isArray(payload.genres) ? payload.genres.flatMap((g) => pos(g?.id) && str(g?.name) ? [{ id: pos(g.id), name: str(g.name) }] : []) : [];
  const date = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const runtime = nonneg(payload.runtime) ?? (Array.isArray(payload.episode_run_time) ? nonneg(payload.episode_run_time[0]) : null);
  const base = kind === "movie" ? "https://www.themoviedb.org/movie/" + id : kind === "series" ? "https://www.themoviedb.org/tv/" + id : "https://www.themoviedb.org/tv/" + context.parent + "/season/" + context.season;
  return { backdrop_path: str(payload.backdrop_path), genres, localized_title: str(payload.title) ?? str(payload.name), original_title: str(payload.original_title) ?? str(payload.original_name), overview: str(payload.overview), poster_path: str(payload.poster_path), raw_payload: payload, release_date: date(payload.release_date) ?? date(payload.first_air_date) ?? date(payload.air_date), runtime_minutes: runtime, tagline: str(payload.tagline), tmdb_id: id, tmdb_parent_id: context.parent ?? null, tmdb_url: kind === "episode" ? base + "/episode/" + context.episode : base, vote_average: typeof payload.vote_average === "number" ? Math.round(payload.vote_average * 10) / 10 : null, vote_count: nonneg(payload.vote_count), tmdb_locale: locale, tmdb_fallback_locale: fallback };
}
async function put(db, kind, localId, metadata) {
  const time = now();
  const { error } = await db.from("media_tmdb_metadata").upsert({ ...metadata, [cols[kind]]: localId, media_kind: kind, linked_at: time, synced_at: time, unlinked_at: null }, { onConflict: cols[kind] });
  if (error) throw Error(error.message);
}
async function main() {
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || need("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), key, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = need("TMDB_API_READ_ACCESS_TOKEN");
  const report = JSON.parse(await readFile(resolve(process.cwd(), "scripts/output/tmdb-hydration-last-run.json"), "utf8"));
  const safeMovies = { "MOV-00001":1311031, "MOV-00008":10228, "MOV-00009":12599, "MOV-00010":10991, "MOV-00011":12600, "MOV-00012":33875, "MOV-00013":36218, "MOV-00014":34065, "MOV-00015":34067, "MOV-00016":16808, "MOV-00017":25961, "MOV-00018":47292, "MOV-00019":39057, "MOV-00020":50087, "MOV-00021":115223, "MOV-00022":150213, "MOV-00023":227679, "MOV-00024":303903, "MOV-00025":350499, "MOV-00026":382190, "MOV-00027":436931 };
  const safeSeries = { "SER-00001": 67882, "SER-00002": 61295, "SER-00003": 62715 };
  const [movies, series, seasons, episodes] = await Promise.all([
    db.from("movies").select("id,internal_code"), db.from("series").select("id,internal_code"),
    db.from("series_seasons").select("id,series_id,season_number"), db.from("series_episodes").select("id,season_id,episode_number")
  ]);
  for (const r of [movies,series,seasons,episodes]) if (r.error) throw Error(r.error.message);
  const movieByCode = new Map((movies.data ?? []).map((x) => [x.internal_code, x]));
  const seriesByCode = new Map((series.data ?? []).map((x) => [x.internal_code, x]));
  const parents = [
    ...(report.matched ?? []).map((x) => ({ ...x, local: x.kind === "movie" ? movieByCode.get(x.code) : seriesByCode.get(x.code), id: x.tmdbId })),
    ...Object.entries(safeMovies).map(([code,id]) => ({ code, kind: "movie", local: movieByCode.get(code), id })),
    ...Object.entries(safeSeries).map(([code,id]) => ({ code, kind: "series", local: seriesByCode.get(code), id })),
  ].filter((x) => x.local);
  const linkedSeries = new Map();
  for (const item of parents) {
    console.log(now() + "  Guardando " + item.code + "…");
    await put(db, item.kind, item.local.id, await cache(token, item.kind, { id: item.id }));
    if (item.kind === "series") linkedSeries.set(item.local.id, item.id);
  }
  const seasonById = new Map((seasons.data ?? []).map((x) => [x.id, x]));
  const children = [
    ...(seasons.data ?? []).filter((x) => linkedSeries.has(x.series_id)).map((x) => ({ kind:"season", local:x, parent:linkedSeries.get(x.series_id), season:x.season_number })),
    ...(episodes.data ?? []).flatMap((x) => { const season=seasonById.get(x.season_id); const parent=season && linkedSeries.get(season.series_id); return parent ? [{ kind:"episode", local:x, parent, season:season.season_number, episode:x.episode_number }] : []; })
  ];
  let done=0, failed=0;
  for (const child of children) {
    try { await put(db, child.kind, child.local.id, await cache(token, child.kind, child)); done += 1; }
    catch (error) { failed += 1; console.warn(now() + "  Se omitió " + child.kind + ": " + error.message); }
  }
  const out = { finishedAt:now(), parents:parents.map((x)=>({code:x.code,tmdbId:x.id})), childrenSaved:done, childrenSkipped:failed, remainingForReview:report.review ?? [] };
  await mkdir(resolve(process.cwd(),"scripts/output"),{recursive:true});
  await writeFile(resolve(process.cwd(),"scripts/output/tmdb-apply-last-run.json"),JSON.stringify(out,null,2)+"\n");
  console.log(now()+"  Terminado: "+parents.length+" películas/series y "+done+" temporadas/episodios guardados; "+failed+" omitidos.");
}
main().catch((e)=>{ console.error(now()+"  TMDB DETENIDO — "+e.message); process.exitCode=1; });