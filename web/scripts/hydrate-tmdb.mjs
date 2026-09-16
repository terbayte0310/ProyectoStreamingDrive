import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const dry = process.argv.includes("--dry-run");
const env = (key) => { const value = process.env[key]?.trim(); if (!value) throw Error("Falta " + key); return value; };
const clean = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const value = (x) => typeof x === "string" && x.trim() ? x : null;
const name = (x) => value(x.title) ?? value(x.name);
const original = (x) => value(x.original_title) ?? value(x.original_name);
const run = async () => {
  const dbKey = process.env.SUPABASE_SECRET_KEY?.trim() || env("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), dbKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = env("TMDB_API_READ_ACCESS_TOKEN");
  const [movies, series, cache] = await Promise.all([
    db.from("movies").select("id,internal_code,admin_title"),
    db.from("series").select("id,internal_code,admin_title"),
    db.from("media_tmdb_metadata").select("movie_id,series_id,tmdb_id"),
  ]);
  for (const result of [movies, series, cache]) if (result.error) throw Error(result.error.message);
  const linked = new Map((cache.data ?? []).flatMap((item) => {
    const id = item.movie_id ?? item.series_id; return id && item.tmdb_id ? [[id, item.tmdb_id]] : [];
  }));
  const items = [...(movies.data ?? []).map((item) => ({ ...item, kind: "movie" })), ...(series.data ?? []).map((item) => ({ ...item, kind: "series" }))];
  const report = { dryRun: dry, matched: [], review: [], existing: [], startedAt: new Date().toISOString() };
  for (const [index, item] of items.entries()) {
    if (linked.has(item.id)) { report.existing.push({ code: item.internal_code, title: item.admin_title, tmdbId: linked.get(item.id) }); continue; }
    const endpoint = item.kind === "movie" ? "/search/movie" : "/search/tv";
    const response = await fetch("https://api.themoviedb.org/3" + endpoint + "?language=es-PE&include_adult=false&query=" + encodeURIComponent(item.admin_title), { headers: { authorization: "Bearer " + token, accept: "application/json" } });
    if (!response.ok) throw Error("TMDB HTTP " + response.status);
    const results = (await response.json()).results ?? [];
    const exact = results.filter((candidate) => [name(candidate), original(candidate)].some((title) => title && clean(title) === clean(item.admin_title))).sort((a,b) => Number(b.popularity ?? 0) - Number(a.popularity ?? 0));
    const entry = { code: item.internal_code, kind: item.kind, title: item.admin_title };
    if (exact.length === 1 || (exact.length > 1 && Number(exact[0].popularity ?? 0) > Number(exact[1].popularity ?? 0))) {
      const match = exact[0]; report.matched.push({ ...entry, tmdbId: match.id, tmdbTitle: name(match), originalTitle: original(match) });
      console.log("[" + (index + 1) + "/" + items.length + "] OK " + item.internal_code + " → TMDB " + match.id);
    } else {
      report.review.push({ ...entry, candidates: results.slice(0, 5).map((candidate) => ({ id: candidate.id, title: name(candidate), originalTitle: original(candidate), date: candidate.release_date ?? candidate.first_air_date ?? null })) });
      console.log("[" + (index + 1) + "/" + items.length + "] REVISAR " + item.internal_code);
    }
  }
  report.finishedAt = new Date().toISOString();
  const folder = resolve(process.cwd(), "scripts/output"); await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, "tmdb-hydration-last-run.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("Resultado: " + report.matched.length + " automáticos, " + report.review.length + " para revisar, " + report.existing.length + " ya vinculados. " + (dry ? "No se modificó Supabase." : "Este comando aún es informe; no escribe en Supabase."));
};
run().catch((error) => { console.error(error.message); process.exitCode = 1; });