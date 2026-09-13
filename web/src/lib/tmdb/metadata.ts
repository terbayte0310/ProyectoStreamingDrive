export type TmdbMediaKind = "movie" | "series" | "season" | "episode";

export type TmdbCachedMetadata = {
  backdrop_path: string | null;
  genres: Array<{ id: number; name: string }>;
  localized_title: string | null;
  original_title: string | null;
  overview: string | null;
  poster_path: string | null;
  raw_payload: Record<string, unknown>;
  release_date: string | null;
  runtime_minutes: number | null;
  tagline: string | null;
  tmdb_id: number;
  tmdb_parent_id: number | null;
  tmdb_url: string;
  vote_average: number | null;
  vote_count: number | null;
};

type TmdbUrlOptions = {
  episodeNumber?: number;
  parentId?: number;
  seasonNumber?: number;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function asPositiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function asNonNegativeInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function asVoteAverage(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10) return null;
  return Math.round(number * 10) / 10;
}

function asDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function asGenres(value: unknown): Array<{ id: number; name: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((genre) => {
    if (!genre || typeof genre !== "object") return [];
    const id = asPositiveInteger((genre as Record<string, unknown>).id);
    const name = asNonEmptyString((genre as Record<string, unknown>).name);
    return id && name ? [{ id, name }] : [];
  });
}

function runtimeFrom(payload: Record<string, unknown>) {
  const directRuntime = asNonNegativeInteger(payload.runtime);
  if (directRuntime !== null) return directRuntime;
  if (!Array.isArray(payload.episode_run_time)) return null;
  return asNonNegativeInteger(payload.episode_run_time[0]);
}

export function buildTmdbUrl(kind: TmdbMediaKind, tmdbId: number, options: TmdbUrlOptions = {}) {
  if (kind === "movie") return `https://www.themoviedb.org/movie/${tmdbId}`;
  if (kind === "series") return `https://www.themoviedb.org/tv/${tmdbId}`;
  if (!options.parentId || !options.seasonNumber) {
    throw new Error("Las temporadas y episodios requieren la serie y la temporada de TMDB.");
  }
  const seasonUrl = `https://www.themoviedb.org/tv/${options.parentId}/season/${options.seasonNumber}`;
  if (kind === "season") return seasonUrl;
  if (!options.episodeNumber) throw new Error("Los episodios requieren su número de episodio.");
  return `${seasonUrl}/episode/${options.episodeNumber}`;
}

export function mapTmdbMetadata(
  kind: TmdbMediaKind,
  payload: Record<string, unknown>,
  options: TmdbUrlOptions = {},
): TmdbCachedMetadata {
  const tmdbId = asPositiveInteger(payload.id);
  if (!tmdbId) throw new Error("TMDB devolvió un identificador inválido.");

  const localizedTitle = asNonEmptyString(payload.title) ?? asNonEmptyString(payload.name);
  const originalTitle = asNonEmptyString(payload.original_title) ?? asNonEmptyString(payload.original_name);
  return {
    backdrop_path: asNonEmptyString(payload.backdrop_path),
    genres: asGenres(payload.genres),
    localized_title: localizedTitle,
    original_title: originalTitle,
    overview: asNonEmptyString(payload.overview),
    poster_path: asNonEmptyString(payload.poster_path),
    raw_payload: payload,
    release_date: asDate(payload.release_date) ?? asDate(payload.first_air_date) ?? asDate(payload.air_date),
    runtime_minutes: runtimeFrom(payload),
    tagline: asNonEmptyString(payload.tagline),
    tmdb_id: tmdbId,
    tmdb_parent_id: options.parentId ?? null,
    tmdb_url: buildTmdbUrl(kind, tmdbId, options),
    vote_average: asVoteAverage(payload.vote_average),
    vote_count: asNonNegativeInteger(payload.vote_count),
  };
}
