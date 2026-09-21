import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition } from "react";

import { Icon } from "@/components/icons";
import { Backdrop, MediaPoster, type TmdbCatalogMetadata, TmdbAttribution, yearOf } from "@/components/media-catalog";
import { SeasonBrowser, SeriesPlayButton, type SeasonView } from "@/components/season-browser";
import { SiteHeader } from "@/components/site-header";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Season = { admin_title: string; id: string; season_number: number };
type Episode = { admin_title: string; episode_number: number; id: string; season_id: string };
const metadataColumns = "series_id, season_id, episode_id, localized_title, overview, poster_path, backdrop_path, release_date, runtime_minutes, genres, tmdb_url";

export default async function SeriesDetailPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  const supabase = await createSupabaseServerClient();
  const [, seriesResult, seriesMetadataResult, seasonsResult] = await Promise.all([
    requireAuthorizedAccess(),
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
  const episodes = (episodesResult.data ?? []) as Episode[];
  const episodeIds = episodes.map((episode) => episode.id);
  const [seasonMetadataResult, episodeMetadataResult, packageResult] = await Promise.all([
    seasonIds.length ? supabase.from("media_tmdb_metadata").select(metadataColumns).in("season_id", seasonIds) : Promise.resolve({ data: [], error: null }),
    episodeIds.length ? supabase.from("media_tmdb_metadata").select(metadataColumns).in("episode_id", episodeIds) : Promise.resolve({ data: [], error: null }),
    episodeIds.length ? supabase.from("media_hls_packages").select("id, episode_id").in("episode_id", episodeIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const series = seriesResult.data;
  const metadata = seriesMetadataResult.data as TmdbCatalogMetadata | null;
  const childMetadata = [...((seasonMetadataResult.data ?? []) as TmdbCatalogMetadata[]), ...((episodeMetadataResult.data ?? []) as TmdbCatalogMetadata[])];
  const metadataBySeason = new Map(childMetadata.flatMap((item) => item.season_id ? [[item.season_id, item]] : []));
  const metadataByEpisode = new Map(childMetadata.flatMap((item) => item.episode_id ? [[item.episode_id, item]] : []));
  const packageByEpisode = new Map((packageResult.data ?? []).flatMap((item) => item.episode_id ? [[item.episode_id, item.id]] : []));
  const title = metadata?.localized_title ?? series.admin_title;
  const partialError = Boolean(seasonsResult.error || episodesResult.error || seasonMetadataResult.error || episodeMetadataResult.error);

  const seasonViews: SeasonView[] = seasons.map((season) => {
    const seasonMetadata = metadataBySeason.get(season.id);
    return {
      episodes: episodes.filter((episode) => episode.season_id === season.id).map((episode) => {
        const episodeMetadata = metadataByEpisode.get(episode.id);
        return {
          id: episode.id,
          number: episode.episode_number,
          overview: episodeMetadata?.overview ?? null,
          packageId: packageByEpisode.get(episode.id) ?? null,
          runtime: episodeMetadata?.runtime_minutes ?? null,
          stillPath: episodeMetadata?.backdrop_path ?? episodeMetadata?.poster_path ?? null,
          title: episodeMetadata?.localized_title ?? episode.admin_title,
        };
      }),
      id: season.id,
      number: season.season_number,
      overview: seasonMetadata?.overview ?? null,
      title: seasonMetadata?.localized_title ?? season.admin_title,
    };
  });
  const totalEpisodes = seasonViews.reduce((total, season) => total + season.episodes.length, 0);
  const year = yearOf(metadata);

  return (
    <div className="shell">
      <SiteHeader tone="media" />
      <main className="shell-main">
        <section className="detail-hero">
          <div className="detail-backdrop"><Backdrop morphId={series.id} path={metadata?.backdrop_path ?? metadata?.poster_path} title={title} /></div>
          <div className="detail-hero-inner container">
            <ViewTransition default="none" name={`poster-${series.id}`} share="nb-morph">
              <div className="detail-poster"><MediaPoster eager posterPath={metadata?.poster_path ?? null} sizes="300px" title={title} /></div>
            </ViewTransition>
            <div className="detail-copy">
              <Link className="back-link" href="/catalog/series" prefetch transitionTypes={["nav-back"]}><Icon name="arrowLeft" />Series</Link>
              <h1 className="display">{title}</h1>
              <div className="detail-meta">
                {year ? <span className="badge">{year}</span> : null}
                <span className="badge">{seasonViews.length} {seasonViews.length === 1 ? "temporada" : "temporadas"}</span>
                <span className="badge">{totalEpisodes} episodios</span>
                {metadata?.genres.slice(0, 2).map((genre) => <span className="badge" key={genre.id}>{genre.name}</span>)}
              </div>
              <p className="detail-overview">{metadata?.overview ?? "Sin sinopsis disponible."}</p>
              <div className="detail-actions" id="series-actions">
                <SeriesPlayButton seasons={seasonViews} />
                {metadata?.tmdb_url ? <a className="btn btn-glass btn-lg" href={metadata.tmdb_url} rel="noreferrer" target="_blank">Ficha en TMDB</a> : null}
              </div>
            </div>
          </div>
        </section>

        <div className="container">
          {partialError ? <div className="notice notice-warn" style={{ marginBottom: 20 }}><span className="notice-icon"><Icon name="warning" /></span><div>Algunos datos de temporadas no se pudieron cargar. Lo disponible se muestra abajo.</div></div> : null}
          {seasonViews.length ? <SeasonBrowser seasons={seasonViews} /> : (
            <div className="empty-state"><span aria-hidden="true" className="empty-orb" /><h2 className="title-m">Todavía no hay temporadas publicadas</h2><p>Vuelve pronto: los episodios aparecerán aquí en cuanto estén listos.</p></div>
          )}
          <TmdbAttribution />
        </div>
      </main>
    </div>
  );
}
