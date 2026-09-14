import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MediaKind = "movie" | "series" | "season" | "episode";
type MediaStatus = "draft" | "published";
type RequestBody = {
  action?: unknown;
  adminCode?: unknown;
  contentId?: unknown;
  kind?: unknown;
  parentId?: unknown;
  status?: unknown;
  title?: unknown;
};

const tableByKind: Record<MediaKind, string> = {
  episode: "series_episodes",
  movie: "movies",
  season: "series_seasons",
  series: "series",
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

function isMediaKind(value: unknown): value is MediaKind {
  return value === "movie" || value === "series" || value === "season" || value === "episode";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toTitle(value: unknown) {
  return typeof value === "string" && value.trim() && value.trim().length <= 300 ? value.trim() : null;
}

function toAdminCode(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  return typeof value === "string" && /^[A-Z0-9]+-[0-9]{5,}$/.test(value.trim()) ? value.trim() : undefined;
}

function toStatus(value: unknown): MediaStatus | null {
  return value === "draft" || value === "published" ? value : null;
}

async function requireAdmin() {
  const access = await getCurrentAccess();
  return access?.profile?.is_authorized && access.profile.role === "admin" ? access : null;
}

export async function GET(request: NextRequest) {
  if (!await requireAdmin()) return noStoreJson({ error: "Se requiere acceso de administrador." }, { status: 403 });
  const seriesId = request.nextUrl.searchParams.get("seriesId");
  if (!isUuid(seriesId)) return noStoreJson({ error: "La serie no es válida." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: seasons, error: seasonsError } = await supabase
    .from("series_seasons")
    .select("id, internal_code, admin_code, admin_title, season_number, status")
    .eq("series_id", seriesId)
    .order("season_number");
  if (seasonsError) return noStoreJson({ error: "No se pudieron cargar las temporadas." }, { status: 500 });
  const seasonIds = (seasons ?? []).map((season) => season.id);
  const { data: episodes, error: episodesError } = seasonIds.length
    ? await supabase.from("series_episodes").select("id, internal_code, admin_code, admin_title, episode_number, season_id, status").in("season_id", seasonIds).order("episode_number")
    : { data: [], error: null };
  if (episodesError) return noStoreJson({ error: "No se pudieron cargar los episodios." }, { status: 500 });
  const episodeIds = (episodes ?? []).map((episode) => episode.id);
  const columns = "id, media_kind, series_id, season_id, episode_id, tmdb_id, tmdb_url, localized_title, original_title, overview, poster_path, backdrop_path, release_date, runtime_minutes, genres, vote_average, vote_count, synced_at";
  const { data: seriesMetadata, error: seriesMetadataError } = await supabase.from("media_tmdb_metadata").select(columns).eq("series_id", seriesId);
  const { data: seasonMetadata, error: seasonMetadataError } = seasonIds.length
    ? await supabase.from("media_tmdb_metadata").select(columns).in("season_id", seasonIds)
    : { data: [], error: null };
  const { data: episodeMetadata, error: episodeMetadataError } = episodeIds.length
    ? await supabase.from("media_tmdb_metadata").select(columns).in("episode_id", episodeIds)
    : { data: [], error: null };
  if (seriesMetadataError || seasonMetadataError || episodeMetadataError) {
    return noStoreJson({ error: "No se pudieron cargar los metadatos TMDB." }, { status: 500 });
  }
  return noStoreJson({ episodes: episodes ?? [], metadata: [...(seriesMetadata ?? []), ...(seasonMetadata ?? []), ...(episodeMetadata ?? [])], seasons: seasons ?? [] });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Origen no permitido." }, { status: 403 });
  if (!await requireAdmin()) return noStoreJson({ error: "Se requiere acceso de administrador." }, { status: 403 });
  const body = await request.json().catch(() => null) as RequestBody | null;
  if (!body || typeof body.action !== "string") return noStoreJson({ error: "La solicitud no es válida." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const title = toTitle(body.title);
  const adminCode = toAdminCode(body.adminCode);
  const status = toStatus(body.status) ?? "draft";
  if (adminCode === undefined) return noStoreJson({ error: "El código legible debe usar mayúsculas, números y terminar en -00001." }, { status: 400 });

  if (body.action === "create" && (body.kind === "movie" || body.kind === "series")) {
    if (!title) return noStoreJson({ error: "El título es obligatorio." }, { status: 400 });
    const rpc = body.kind === "movie" ? "next_movie_internal_code" : "next_series_internal_code";
    const { data: internalCode, error: codeError } = await supabase.rpc(rpc);
    if (codeError || typeof internalCode !== "string") return noStoreJson({ error: "No se pudo generar el código interno." }, { status: 500 });
    const { data, error } = await supabase
      .from(tableByKind[body.kind])
      .insert({ admin_code: adminCode, admin_title: title, internal_code: internalCode, status })
      .select("id, internal_code, admin_code, admin_title, status")
      .single();
    if (error || !data) return noStoreJson({ error: "No se pudo crear el contenido." }, { status: 400 });
    return noStoreJson({ item: data }, { status: 201 });
  }

  if (body.action === "create" && body.kind === "season") {
    if (!title || !isUuid(body.parentId)) return noStoreJson({ error: "La temporada requiere serie y título." }, { status: 400 });
    const { data: series, error: seriesError } = await supabase.from("series").select("internal_code").eq("id", body.parentId).maybeSingle<{ internal_code: string }>();
    if (seriesError || !series) return noStoreJson({ error: "La serie no existe." }, { status: 404 });
    const { data: latest } = await supabase.from("series_seasons").select("season_number").eq("series_id", body.parentId).order("season_number", { ascending: false }).limit(1).maybeSingle<{ season_number: number }>();
    const seasonNumber = (latest?.season_number ?? 0) + 1;
    const internalCode = series.internal_code + "-S" + String(seasonNumber).padStart(2, "0");
    const { data, error } = await supabase
      .from("series_seasons")
      .insert({ admin_code: adminCode, admin_title: title, internal_code: internalCode, season_number: seasonNumber, series_id: body.parentId, status })
      .select("id, internal_code, admin_code, admin_title, season_number, status")
      .single();
    if (error || !data) return noStoreJson({ error: "No se pudo crear la temporada." }, { status: 400 });
    return noStoreJson({ item: data }, { status: 201 });
  }

  if (body.action === "create" && body.kind === "episode") {
    if (!title || !isUuid(body.parentId)) return noStoreJson({ error: "El episodio requiere temporada y título." }, { status: 400 });
    const { data: season, error: seasonError } = await supabase.from("series_seasons").select("internal_code").eq("id", body.parentId).maybeSingle<{ internal_code: string }>();
    if (seasonError || !season) return noStoreJson({ error: "La temporada no existe." }, { status: 404 });
    const { data: latest } = await supabase.from("series_episodes").select("episode_number").eq("season_id", body.parentId).order("episode_number", { ascending: false }).limit(1).maybeSingle<{ episode_number: number }>();
    const episodeNumber = (latest?.episode_number ?? 0) + 1;
    const internalCode = season.internal_code + "-E" + String(episodeNumber).padStart(2, "0");
    const { data, error } = await supabase
      .from("series_episodes")
      .insert({ admin_code: adminCode, admin_title: title, episode_number: episodeNumber, internal_code: internalCode, season_id: body.parentId, status })
      .select("id, internal_code, admin_code, admin_title, episode_number, season_id, status")
      .single();
    if (error || !data) return noStoreJson({ error: "No se pudo crear el episodio." }, { status: 400 });
    return noStoreJson({ item: data }, { status: 201 });
  }

  if (body.action === "update" && isMediaKind(body.kind) && isUuid(body.contentId) && title) {
    const { data, error } = await supabase
      .from(tableByKind[body.kind])
      .update({ admin_code: adminCode, admin_title: title, status })
      .eq("id", body.contentId)
      .select()
      .maybeSingle();
    if (error || !data) return noStoreJson({ error: "No se pudo guardar el contenido." }, { status: 400 });
    return noStoreJson({ item: data });
  }

  return noStoreJson({ error: "La solicitud no es válida." }, { status: 400 });
}
