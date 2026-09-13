import "server-only";

const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

type Environment = Record<string, string | undefined>;

export type TmdbConfig = {
  apiBaseUrl: string;
  readAccessToken: string;
};

export function getTmdbConfig(environment: Environment = process.env): TmdbConfig {
  const readAccessToken = environment.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!readAccessToken) {
    throw new Error("La configuración privada de TMDB está incompleta.");
  }

  return { apiBaseUrl: TMDB_API_BASE_URL, readAccessToken };
}
