import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { fetchTmdbMetadata, searchTmdb, TmdbClientError } from "@/lib/tmdb/client";
import type { TmdbMediaKind } from "@/lib/tmdb/metadata";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ContentKind = TmdbMediaKind;
type RequestBody = { action?: unknown; contentId?: unknown; contentKind?: unknown; query?: unknown; tmdbId?: unknown };
type ContentContext = { episodeNumber?: number; parentTmdbId?: number; seasonNumber?: number };

const contentTables: Record<ContentKind, string> = {
  episode: "series_episodes",
  movie: "movies",
  season: "series_seasons",
  series: "series",
};

const relationColumns: Record<ContentKind, string> = {
  episode: "episode_id",
  movie: "movie_id",
  season: "season_id",
  series: "series_id",
};

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === getRequestOrigin(request);
}

function isContentKind(value: unknown): value is ContentKind {
  return value === "movie" || value === "series" || value === "season" || value === "episode";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTmdbId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

async function getContentContext(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, kind: ContentKind, contentId: string): Promise<ContentContext | null> {
  if (kind === "movie" || kind === "series") {
    const { data, error } = await supabase.from(contentTables[kind]).select("id").eq("id", contentId).maybeSingle<{ id: string }>();
    return !error && data ? {} : null;
  }

  if (kind === "season") {
    const { data, error } = await supabase.from("series_seasons").select("series_id, season_number").eq("id", contentId).maybeSingle<{ season_number: number; series_id: string }>();
    if (error || !data) return null;
    const { data: parent, error: parentError } = await supabase
      .from("media_tmdb_metadata")
      .select("tmdb_id")
      .eq("series_id", data.series_id)
      .not("tmdb_id", "is", null)
      .maybeSingle<{ tmdb_id: number }>();
    if (parentError || !parent?.tmdb_id) return { seasonNumber: data.season_number };
    return { parentTmdbId: parent.tmdb_id, seasonNumber: data.season_number };
  }

  const { data, error } = await supabase
    .from("series_episodes")
    .select("episode_number, season_id, series_seasons!inner(series_id, season_number)")
    .eq("id", contentId)
    .maybeSingle<{ episode_number: number; season_id: string; series_seasons: { season_number: number; series_id: string } }>();
  if (error || !data) return null;
  const { data: parent, error: parentError } = await supabase
    .from("media_tmdb_metadata")
    .select("tmdb_id")
    .eq("series_id", data.series_seasons.series_id)
    .not("tmdb_id", "is", null)
    .maybeSingle<{ tmdb_id: number }>();
  if (parentError || !parent?.tmdb_id) {
    return { episodeNumber: data.episode_number, seasonNumber: data.series_seasons.season_number };
  }
  return {
    episodeNumber: data.episode_number,
    parentTmdbId: parent.tmdb_id,
    seasonNumber: data.series_seasons.season_number,
  };
}

function emptyCache() {
  return {
    backdrop_path: null,
    genres: [],
    linked_at: null,
    localized_title: null,
    original_title: null,
    overview: null,
    poster_path: null,
    raw_payload: null,
    release_date: null,
    runtime_minutes: null,
    synced_at: null,
    tagline: null,
    tmdb_fallback_locale: null,
    tmdb_id: null,
    tmdb_locale: null,
    tmdb_parent_id: null,
    tmdb_url: null,
    unlinked_at: new Date().toISOString(),
    vote_average: null,
    vote_count: null,
  };
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Origen no permitido." }, { status: 403 });

  const access = await getCurrentAccess();
  if (!access) return noStoreJson({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") {
    return noStoreJson({ error: "Se requiere acceso de administrador." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as RequestBody | null;
  if (!body || typeof body.action !== "string") return noStoreJson({ error: "La solicitud no es válida." }, { status: 400 });

  if (body.action === "search") {
    if ((body.contentKind !== "movie" && body.contentKind !== "series") || typeof body.query !== "string" || !body.query.trim() || body.query.length > 200) {
      return noStoreJson({ error: "La búsqueda no es válida." }, { status: 400 });
    }
    try {
      return noStoreJson({ results: await searchTmdb(body.query.trim(), body.contentKind) });
    } catch (error) {
      const status = error instanceof TmdbClientError ? error.status : 500;
      const message = error instanceof Error ? error.message : "No se pudo consultar TMDB.";
      return noStoreJson({ error: message }, { status });
    }
  }

  if (!isContentKind(body.contentKind) || !isUuid(body.contentId) || (body.action !== "link" && body.action !== "refresh" && body.action !== "unlink")) {
    return noStoreJson({ error: "La solicitud no es válida." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const context = await getContentContext(supabase, body.contentKind, body.contentId);
  if (!context) return noStoreJson({ error: "El contenido no existe o no está disponible para este administrador." }, { status: 404 });
  const relationColumn = relationColumns[body.contentKind];

  if (body.action === "unlink") {
    const { data, error } = await supabase
      .from("media_tmdb_metadata")
      .update(emptyCache())
      .eq(relationColumn, body.contentId)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) return noStoreJson({ error: "No se pudo desvincular TMDB." }, { status: 500 });
    return noStoreJson({ unlinked: Boolean(data) });
  }

  let tmdbId: number | null = body.action === "link" && isTmdbId(body.tmdbId) ? body.tmdbId : null;
  if (body.action === "refresh") {
    const { data, error } = await supabase
      .from("media_tmdb_metadata")
      .select("tmdb_id")
      .eq(relationColumn, body.contentId)
      .not("tmdb_id", "is", null)
      .maybeSingle<{ tmdb_id: number }>();
    if (error || !data?.tmdb_id) return noStoreJson({ error: "El contenido no está vinculado a TMDB." }, { status: 409 });
    tmdbId = data.tmdb_id;
  }
  if (!tmdbId || ((body.contentKind === "season" || body.contentKind === "episode") && !context.parentTmdbId)) {
    return noStoreJson({ error: "Selecciona un identificador válido y vincula primero la serie principal." }, { status: 409 });
  }

  try {
    const metadata = await fetchTmdbMetadata({
      episodeNumber: context.episodeNumber,
      kind: body.contentKind,
      parentTmdbId: context.parentTmdbId,
      seasonNumber: context.seasonNumber,
      tmdbId,
    });
    const { data, error } = await supabase
      .from("media_tmdb_metadata")
      .upsert(
        {
          ...metadata,
          [relationColumn]: body.contentId,
          linked_at: new Date().toISOString(),
          media_kind: body.contentKind,
          synced_at: new Date().toISOString(),
          unlinked_at: null,
        },
        { onConflict: relationColumn },
      )
      .select("id, tmdb_id, tmdb_url, synced_at")
      .maybeSingle<{ id: string; synced_at: string; tmdb_id: number; tmdb_url: string }>();
    if (error || !data) return noStoreJson({ error: "No se pudo guardar la caché de TMDB." }, { status: 500 });
    return noStoreJson({ metadata: data }, { status: body.action === "link" ? 201 : 200 });
  } catch (error) {
    const status = error instanceof TmdbClientError ? error.status : 500;
    const message = error instanceof Error ? error.message : "No se pudo consultar TMDB.";
    return noStoreJson({ error: message }, { status });
  }
}
