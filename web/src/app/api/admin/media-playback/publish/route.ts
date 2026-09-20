import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Supabase serializes `.in()` values in the URL. Large series such as Dragon
// Ball Z exceed the practical URL size when every episode is requested at once.
const QUERY_BATCH_SIZE = 100;

function inBatches<T>(items: T[]) {
  return Array.from({ length: Math.ceil(items.length / QUERY_BATCH_SIZE) }, (_, index) =>
    items.slice(index * QUERY_BATCH_SIZE, (index + 1) * QUERY_BATCH_SIZE),
  );
}

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === getRequestOrigin(request);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function requireAdmin() {
  const access = await getCurrentAccess();
  return access?.profile?.is_authorized && access.profile.role === "admin" ? access : null;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Origen no permitido." }, { status: 403 });
  if (!await requireAdmin()) return noStoreJson({ error: "Se requiere acceso de administrador." }, { status: 403 });
  const body = await request.json().catch(() => null) as { sourceId?: unknown } | null;
  if (!body || !isUuid(body.sourceId)) return noStoreJson({ error: "La fuente de Drive no es válida." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: packages, error: packagesError } = await supabase
    .from("media_hls_packages")
    .select("episode_id, movie_id")
    .eq("source_id", body.sourceId)
    .eq("status", "ready");
  if (packagesError) return noStoreJson({ error: "No se pudieron consultar los paquetes listos." }, { status: 500 });

  const movieIds = Array.from(new Set((packages ?? []).flatMap((item) => item.movie_id ? [item.movie_id] : [])));
  const episodeIds = Array.from(new Set((packages ?? []).flatMap((item) => item.episode_id ? [item.episode_id] : [])));
  const episodes = [] as { id: string; season_id: string }[];
  for (const ids of inBatches(episodeIds)) {
    const { data, error } = await supabase.from("series_episodes").select("id, season_id").in("id", ids);
    if (error) return noStoreJson({ error: "No se pudieron preparar los episodios para publicar." }, { status: 500 });
    episodes.push(...(data ?? []));
  }
  const seasonIds = Array.from(new Set(episodes.map((item) => item.season_id)));
  const seasons = [] as { id: string; series_id: string }[];
  for (const ids of inBatches(seasonIds)) {
    const { data, error } = await supabase.from("series_seasons").select("id, series_id").in("id", ids);
    if (error) return noStoreJson({ error: "No se pudieron preparar las temporadas para publicar." }, { status: 500 });
    seasons.push(...(data ?? []));
  }
  const seriesIds = Array.from(new Set(seasons.map((item) => item.series_id)));

  const updates = await Promise.all([
    ...inBatches(movieIds).map((ids) => supabase.from("movies").update({ status: "published" }).in("id", ids)),
    ...inBatches(episodeIds).map((ids) => supabase.from("series_episodes").update({ status: "published" }).in("id", ids)),
    ...inBatches(seasonIds).map((ids) => supabase.from("series_seasons").update({ status: "published" }).in("id", ids)),
    ...inBatches(seriesIds).map((ids) => supabase.from("series").update({ status: "published" }).in("id", ids)),
  ]);
  if (updates.some((result) => result.error)) return noStoreJson({ error: "No se pudo completar la publicación." }, { status: 500 });

  return noStoreJson({ published: { episodes: episodeIds.length, movies: movieIds.length, seasons: seasonIds.length, series: seriesIds.length } });
}
