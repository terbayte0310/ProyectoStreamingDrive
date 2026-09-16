import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
  const { data: episodes, error: episodesError } = episodeIds.length
    ? await supabase.from("series_episodes").select("id, season_id").in("id", episodeIds)
    : { data: [], error: null };
  if (episodesError) return noStoreJson({ error: "No se pudieron preparar los episodios para publicar." }, { status: 500 });
  const seasonIds = Array.from(new Set((episodes ?? []).map((item) => item.season_id)));
  const { data: seasons, error: seasonsError } = seasonIds.length
    ? await supabase.from("series_seasons").select("id, series_id").in("id", seasonIds)
    : { data: [], error: null };
  if (seasonsError) return noStoreJson({ error: "No se pudieron preparar las temporadas para publicar." }, { status: 500 });
  const seriesIds = Array.from(new Set((seasons ?? []).map((item) => item.series_id)));

  const updates = await Promise.all([
    movieIds.length ? supabase.from("movies").update({ status: "published" }).in("id", movieIds) : Promise.resolve({ error: null }),
    episodeIds.length ? supabase.from("series_episodes").update({ status: "published" }).in("id", episodeIds) : Promise.resolve({ error: null }),
    seasonIds.length ? supabase.from("series_seasons").update({ status: "published" }).in("id", seasonIds) : Promise.resolve({ error: null }),
    seriesIds.length ? supabase.from("series").update({ status: "published" }).in("id", seriesIds) : Promise.resolve({ error: null }),
  ]);
  if (updates.some((result) => result.error)) return noStoreJson({ error: "No se pudo completar la publicación." }, { status: 500 });

  return noStoreJson({ published: { episodes: episodeIds.length, movies: movieIds.length, seasons: seasonIds.length, series: seriesIds.length } });
}
