import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CatalogModuleNavigation, MediaPoster, metadataSummary, type LibraryModule, type TmdbCatalogMetadata, TmdbAttribution } from "@/components/media-catalog";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Season = { admin_title: string; id: string; season_number: number };
type Episode = { admin_title: string; episode_number: number; id: string; season_id: string };
const metadataColumns = "series_id, season_id, episode_id, localized_title, overview, poster_path, release_date, runtime_minutes, genres, tmdb_url";

export default async function SeriesDetailPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  const access = await requireAuthorizedAccess();
  const supabase = await createSupabaseServerClient();
  const [modulesResult, seriesResult, seriesMetadataResult, seasonsResult] = await Promise.all([
    supabase.rpc("get_my_module_access"),
    supabase.from("series").select("id, admin_title").eq("id", seriesId).eq("status", "published").maybeSingle(),
    supabase.from("media_tmdb_metadata").select(metadataColumns).eq("series_id", seriesId).maybeSingle(),
    supabase.from("series_seasons").select("id, admin_title, season_number").eq("series_id", seriesId).eq("status", "published").order("season_number"),
  ]);
  if (!seriesResult.data) notFound();
  const seasons = (seasonsResult.data ?? []) as Season[];
  const seasonIds = seasons.map((season) => season.id);
  const episodesResult = seasonIds.length
    ? await supabase.from("series_episodes").select("id, admin_title, episode_number, season_id").in("season_id", seasonIds).eq("status", "published").order("episode_number")
    : { data: [], error: null };
  const modules = Array.isArray(modulesResult.data) ? modulesResult.data.flatMap((row) => row && typeof row === "object" && ["courses", "movies", "series"].includes((row as { module?: string }).module ?? "") ? [(row as { module: LibraryModule }).module] : []) : [];
  const series = seriesResult.data;
  const metadata = seriesMetadataResult.data as TmdbCatalogMetadata | null;
  const episodes = (episodesResult.data ?? []) as Episode[];
  const episodeIds = episodes.map((episode) => episode.id);
  const [seasonMetadataResult, episodeMetadataResult, packageResult] = await Promise.all([
    seasonIds.length ? supabase.from("media_tmdb_metadata").select(metadataColumns).in("season_id", seasonIds) : Promise.resolve({ data: [], error: null }),
    episodeIds.length ? supabase.from("media_tmdb_metadata").select(metadataColumns).in("episode_id", episodeIds) : Promise.resolve({ data: [], error: null }),
    episodeIds.length ? supabase.from("media_hls_packages").select("id, episode_id").in("episode_id", episodeIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const childMetadata = [...((seasonMetadataResult.data ?? []) as TmdbCatalogMetadata[]), ...((episodeMetadataResult.data ?? []) as TmdbCatalogMetadata[])];
  const metadataBySeason = new Map(childMetadata.flatMap((item) => item.season_id ? [[item.season_id, item]] : []));
  const metadataByEpisode = new Map(childMetadata.flatMap((item) => item.episode_id ? [[item.episode_id, item]] : []));
  const packageByEpisode = new Map((packageResult.data ?? []).flatMap((item) => item.episode_id ? [[item.episode_id, item.id]] : []));
  const title = metadata?.localized_title ?? series.admin_title;

  return <div className="app-shell"><AppHeader admin={access.profile.role === "admin"} contextLabel="Ficha de Serie" email={access.profile.email} showNavigation={false} /><main className="catalog-main page-width"><CatalogModuleNavigation active="series" modules={modules} /><Link className="catalog-back-link" href="/catalog/series">← Volver a Series</Link><article className="media-detail"><MediaPoster posterPath={metadata?.poster_path ?? null} title={title} /><div><p className="eyebrow">Serie</p><h1>{title}</h1><p className="media-detail-meta">{metadataSummary(metadata ?? undefined)}</p><p className="media-detail-overview">{metadata?.overview ?? "Sin sinopsis disponible."}</p>{metadata?.tmdb_url ? <a className="secondary-button mt-6" href={metadata.tmdb_url} rel="noreferrer" target="_blank">Ver en TMDB ↗</a> : null}</div></article><section className="media-seasons"><div className="section-heading"><div><h2>Temporadas</h2><p>Los episodios con paquete listo se pueden reproducir.</p></div></div>{seasons.map((season) => { const seasonMetadata = metadataBySeason.get(season.id); const seasonEpisodes = episodes.filter((episode) => episode.season_id === season.id); return <details className="media-season" key={season.id} open={seasons.length === 1}><summary><span>Temporada {season.season_number}</span><strong>{seasonMetadata?.localized_title ?? season.admin_title}</strong><small>{seasonEpisodes.length} {seasonEpisodes.length === 1 ? "episodio" : "episodios"}</small></summary>{seasonMetadata?.overview ? <p className="media-season-overview">{seasonMetadata.overview}</p> : null}<ol className="media-episode-list">{seasonEpisodes.map((episode) => { const episodeMetadata = metadataByEpisode.get(episode.id); const packageId = packageByEpisode.get(episode.id); return <li key={episode.id}><span>E{episode.episode_number}</span><div><strong>{episodeMetadata?.localized_title ?? episode.admin_title}</strong>{episodeMetadata?.overview ? <p>{episodeMetadata.overview}</p> : null}{packageId ? <Link className="media-card-link" href={`/media-player?package=${packageId}`}>▶ Reproducir</Link> : null}</div></li>; })}</ol>{!seasonEpisodes.length ? <p className="media-season-overview">Todavía no hay episodios publicados.</p> : null}</details>; })}</section>{seasonsResult.error || episodesResult.error || seasonMetadataResult.error || episodeMetadataResult.error ? <section className="status-card">Algunos datos de la estructura no se pudieron cargar.</section> : null}{!seasons.length && !seasonsResult.error ? <section className="status-card">Todavía no hay temporadas publicadas.</section> : null}<TmdbAttribution /></main></div>;
}
