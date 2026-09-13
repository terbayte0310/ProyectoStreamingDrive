import "server-only";

import { getTmdbConfig } from "@/lib/tmdb/config";
import { mapTmdbMetadata, type TmdbCachedMetadata, type TmdbMediaKind } from "@/lib/tmdb/metadata";

const preferredLocales = ["es-PE", "es-ES"] as const;

export class TmdbClientError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type TmdbSearchResult = {
  id: number;
  originalTitle: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  title: string | null;
};

type TmdbRequestResult = { payload: Record<string, unknown>; response: Response };

async function requestTmdb(pathname: string, query: Record<string, string | undefined> = {}): Promise<TmdbRequestResult> {
  const config = getTmdbConfig();
  const url = new URL(pathname, config.apiBaseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${config.readAccessToken}` },
    });
  } catch {
    throw new TmdbClientError("No se pudo conectar con TMDB.", 503);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new TmdbClientError("TMDB rechazó la configuración del servidor.", 502);
    if (response.status === 404) throw new TmdbClientError("TMDB no encontró ese contenido.", 404);
    throw new TmdbClientError("TMDB no pudo completar la consulta.", 502);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TmdbClientError("TMDB devolvió una respuesta inválida.", 502);
  }
  return { payload: payload as Record<string, unknown>, response };
}

function hasLocalizedText(payload: Record<string, unknown>) {
  return [payload.title, payload.name, payload.overview].some((value) => typeof value === "string" && value.trim());
}

async function requestLocalizedDetails(pathname: string) {
  for (const [index, locale] of preferredLocales.entries()) {
    const result = await requestTmdb(pathname, { language: locale });
    if (hasLocalizedText(result.payload)) {
      return { fallbackLocale: index === 0 ? null : locale, locale, payload: result.payload };
    }
  }
  const result = await requestTmdb(pathname);
  return { fallbackLocale: "original", locale: "original", payload: result.payload };
}

export async function searchTmdb(query: string, kind: Extract<TmdbMediaKind, "movie" | "series">): Promise<TmdbSearchResult[]> {
  const result = await requestTmdb(kind === "movie" ? "/search/movie" : "/search/tv", {
    include_adult: "false",
    language: preferredLocales[0],
    query,
  });
  const results = Array.isArray(result.payload.results) ? result.payload.results : [];
  return results.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const payload = entry as Record<string, unknown>;
    const id = typeof payload.id === "number" && Number.isInteger(payload.id) && payload.id > 0 ? payload.id : null;
    if (!id) return [];
    return [{
      id,
      originalTitle: typeof payload.original_title === "string" ? payload.original_title : typeof payload.original_name === "string" ? payload.original_name : null,
      posterPath: typeof payload.poster_path === "string" ? payload.poster_path : null,
      releaseDate: typeof payload.release_date === "string" ? payload.release_date : typeof payload.first_air_date === "string" ? payload.first_air_date : null,
      title: typeof payload.title === "string" ? payload.title : typeof payload.name === "string" ? payload.name : null,
    }];
  });
}

export async function fetchTmdbMetadata({
  episodeNumber,
  kind,
  parentTmdbId,
  seasonNumber,
  tmdbId,
}: {
  episodeNumber?: number;
  kind: TmdbMediaKind;
  parentTmdbId?: number;
  seasonNumber?: number;
  tmdbId: number;
}): Promise<TmdbCachedMetadata & { tmdb_fallback_locale: string | null; tmdb_locale: string }> {
  let pathname: string;
  if (kind === "movie") pathname = `/movie/${tmdbId}`;
  else if (kind === "series") pathname = `/tv/${tmdbId}`;
  else if (parentTmdbId && seasonNumber && kind === "season") pathname = `/tv/${parentTmdbId}/season/${seasonNumber}`;
  else if (parentTmdbId && seasonNumber && episodeNumber && kind === "episode") pathname = `/tv/${parentTmdbId}/season/${seasonNumber}/episode/${episodeNumber}`;
  else throw new Error("Falta la relación TMDB de la serie para consultar este contenido.");

  const result = await requestLocalizedDetails(pathname);
  const metadata = mapTmdbMetadata(kind, result.payload, {
    episodeNumber,
    parentId: parentTmdbId,
    seasonNumber,
  });
  if (metadata.tmdb_id !== tmdbId) throw new TmdbClientError("El identificador seleccionado no corresponde al contenido de TMDB.", 422);
  return { ...metadata, tmdb_fallback_locale: result.fallbackLocale, tmdb_locale: result.locale };
}
