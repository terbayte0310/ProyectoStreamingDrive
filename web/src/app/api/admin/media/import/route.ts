import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type InventoryRow = Record<string, unknown>;
type MovieRow = { internalCode: string; rowNumber: number; title: string; type: "movie" };
type EpisodeRow = { episodeNumber: number; internalCode: string; rowNumber: number; seasonNumber: number; seriesCode: string; seriesTitle: string; title: string; type: "episode" };
type NormalizedRow = MovieRow | EpisodeRow;

const movieCodePattern = /^MOV-[0-9]{5,}$/;
const episodeCodePattern = /^(SER-[0-9]{5,})-S([0-9]{2})-E([0-9]{2,3})$/;
const maxRows = 600;

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === getRequestOrigin(request);
}

async function requireAdmin() {
  const access = await getCurrentAccess();
  return access?.profile?.is_authorized && access.profile.role === "admin" ? access : null;
}

function stringValue(row: InventoryRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberValue(row: InventoryRow, keys: string[]) {
  const value = stringValue(row, keys);
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRows(rows: InventoryRow[]) {
  const normalized: NormalizedRow[] = [];
  const errors: string[] = [];
  const seenCodes = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const internalCode = stringValue(row, ["CodigoInterno", "CódigoInterno", "internal_code"]).toUpperCase();
    const title = stringValue(row, ["TituloProvisional", "TítuloProvisional", "Titulo", "Título", "title"]);
    const declaredType = stringValue(row, ["Tipo", "tipo"]).toUpperCase();
    if (!internalCode) {
      errors.push(`Fila ${rowNumber}: falta CodigoInterno.`);
      return;
    }
    if (seenCodes.has(internalCode)) {
      errors.push(`Fila ${rowNumber}: el código ${internalCode} está repetido en el archivo.`);
      return;
    }
    seenCodes.add(internalCode);
    if (!title || title.length > 300) {
      errors.push(`Fila ${rowNumber}: falta un título válido para ${internalCode}.`);
      return;
    }

    if (movieCodePattern.test(internalCode)) {
      if (declaredType && declaredType !== "PELICULA" && declaredType !== "PELÍCULA") {
        errors.push(`Fila ${rowNumber}: ${internalCode} debe ser de tipo PELICULA.`);
        return;
      }
      normalized.push({ internalCode, rowNumber, title, type: "movie" });
      return;
    }

    const episodeMatch = internalCode.match(episodeCodePattern);
    if (!episodeMatch) {
      errors.push(`Fila ${rowNumber}: ${internalCode} no es un código MOV o episodio SER válido.`);
      return;
    }
    if (declaredType && declaredType !== "SERIE") {
      errors.push(`Fila ${rowNumber}: ${internalCode} debe ser de tipo SERIE.`);
      return;
    }
    const seasonNumber = Number(episodeMatch[2]);
    const episodeNumber = Number(episodeMatch[3]);
    const suppliedSeason = numberValue(row, ["Temporada", "temporada"]);
    const suppliedEpisode = numberValue(row, ["Episodio", "episodio"]);
    const seriesTitle = stringValue(row, ["Serie", "serie"]);
    if (!seriesTitle || seriesTitle.length > 300) {
      errors.push(`Fila ${rowNumber}: falta el nombre de serie para ${internalCode}.`);
      return;
    }
    if ((suppliedSeason !== null && suppliedSeason !== seasonNumber) || (suppliedEpisode !== null && suppliedEpisode !== episodeNumber)) {
      errors.push(`Fila ${rowNumber}: temporada o episodio no coincide con ${internalCode}.`);
      return;
    }
    normalized.push({ episodeNumber, internalCode, rowNumber, seasonNumber, seriesCode: episodeMatch[1], seriesTitle, title, type: "episode" });
  });

  return { errors, normalized };
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Origen no permitido." }, { status: 403 });
  if (!await requireAdmin()) return noStoreJson({ error: "Se requiere acceso de administrador." }, { status: 403 });
  const body = await request.json().catch(() => null) as { rows?: unknown } | null;
  if (!body || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > maxRows || !body.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    return noStoreJson({ error: `Carga un CSV con entre 1 y ${maxRows} filas válidas.` }, { status: 400 });
  }

  const { errors, normalized } = normalizeRows(body.rows as InventoryRow[]);
  if (errors.length) return noStoreJson({ error: "El inventario tiene errores. No se guardó nada.", errors }, { status: 400 });

  const movies = normalized.filter((row): row is MovieRow => row.type === "movie");
  const episodes = normalized.filter((row): row is EpisodeRow => row.type === "episode");
  const seriesByCode = new Map<string, string>();
  const seasonsByCode = new Map<string, { seriesCode: string; seasonNumber: number }>();
  for (const episode of episodes) {
    const priorTitle = seriesByCode.get(episode.seriesCode);
    if (priorTitle && priorTitle !== episode.seriesTitle) {
      errors.push(`Las filas de ${episode.seriesCode} usan nombres de serie diferentes.`);
      continue;
    }
    seriesByCode.set(episode.seriesCode, episode.seriesTitle);
    seasonsByCode.set(`${episode.seriesCode}-S${String(episode.seasonNumber).padStart(2, "0")}`, { seriesCode: episode.seriesCode, seasonNumber: episode.seasonNumber });
  }
  if (errors.length) return noStoreJson({ error: "El inventario tiene errores. No se guardó nada.", errors }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const [{ data: knownMovies, error: moviesError }, { data: knownSeries, error: seriesError }, { data: knownSeasons, error: seasonsError }, { data: knownEpisodes, error: episodesError }] = await Promise.all([
    supabase.from("movies").select("id, internal_code"),
    supabase.from("series").select("id, internal_code"),
    supabase.from("series_seasons").select("id, internal_code, series_id"),
    supabase.from("series_episodes").select("id, internal_code"),
  ]);
  if (moviesError || seriesError || seasonsError || episodesError) return noStoreJson({ error: "No se pudo comprobar el catálogo actual." }, { status: 500 });

  const movieCodes = new Set((knownMovies ?? []).map((item) => item.internal_code));
  const seriesIds = new Map((knownSeries ?? []).map((item) => [item.internal_code, item.id]));
  const seasonIds = new Map((knownSeasons ?? []).map((item) => [item.internal_code, item.id]));
  const episodeCodes = new Set((knownEpisodes ?? []).map((item) => item.internal_code));
  let createdMovies = 0;
  let createdSeries = 0;
  let createdSeasons = 0;
  let createdEpisodes = 0;

  const movieInserts = movies.filter((item) => !movieCodes.has(item.internalCode)).map((item) => ({ admin_title: item.title, internal_code: item.internalCode, status: "draft" }));
  if (movieInserts.length) {
    const { data, error } = await supabase.from("movies").insert(movieInserts).select("id, internal_code");
    if (error) return noStoreJson({ error: "No se pudieron crear las películas del inventario." }, { status: 400 });
    createdMovies = data?.length ?? 0;
  }

  const seriesInserts = Array.from(seriesByCode, ([internal_code, admin_title]) => ({ admin_title, internal_code, status: "draft" })).filter((item) => !seriesIds.has(item.internal_code));
  if (seriesInserts.length) {
    const { data, error } = await supabase.from("series").insert(seriesInserts).select("id, internal_code");
    if (error) return noStoreJson({ error: "No se pudieron crear las series del inventario." }, { status: 400 });
    for (const item of data ?? []) seriesIds.set(item.internal_code, item.id);
    createdSeries = data?.length ?? 0;
  }

  const seasonInserts = Array.from(seasonsByCode, ([internalCode, definition]) => ({ admin_title: `Temporada ${definition.seasonNumber}`, internal_code: internalCode, season_number: definition.seasonNumber, series_id: seriesIds.get(definition.seriesCode)!, status: "draft" })).filter((item) => !seasonIds.has(item.internal_code));
  if (seasonInserts.length) {
    const { data, error } = await supabase.from("series_seasons").insert(seasonInserts).select("id, internal_code");
    if (error) return noStoreJson({ error: "No se pudieron crear las temporadas del inventario." }, { status: 400 });
    for (const item of data ?? []) seasonIds.set(item.internal_code, item.id);
    createdSeasons = data?.length ?? 0;
  }

  const episodeInserts = episodes.filter((item) => !episodeCodes.has(item.internalCode)).map((item) => ({ admin_title: item.title, episode_number: item.episodeNumber, internal_code: item.internalCode, season_id: seasonIds.get(`${item.seriesCode}-S${String(item.seasonNumber).padStart(2, "0")}`)!, status: "draft" }));
  if (episodeInserts.length) {
    const { data, error } = await supabase.from("series_episodes").insert(episodeInserts).select("id, internal_code");
    if (error) return noStoreJson({ error: `No se pudieron crear los episodios del inventario: ${error.message}`, databaseCode: error.code ?? null }, { status: 400 });
    createdEpisodes = data?.length ?? 0;
  }

  return noStoreJson({ created: { episodes: createdEpisodes, movies: createdMovies, seasons: createdSeasons, series: createdSeries }, existing: { episodes: episodes.length - createdEpisodes, movies: movies.length - createdMovies } });
}
