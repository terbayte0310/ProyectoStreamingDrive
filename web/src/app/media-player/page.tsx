import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MediaHlsPlayer } from "@/components/media-hls-player";
import { tmdbImage } from "@/components/media-catalog";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reproduciendo" };

type PackageRow = { episode_id: string | null; id: string; movie_id: string | null };
type EpisodeRow = { admin_title: string; episode_number: number; id: string; season_id: string };
type SeasonRow = { id: string; season_number: number; series_id: string };
type MetadataRow = { backdrop_path: string | null; localized_title: string | null; poster_path: string | null };

export default async function MediaPlayerPage({ searchParams }: { searchParams: Promise<{ package?: string }> }) {
  const { package: packageId } = await searchParams;
  if (!packageId) notFound();
  const supabase = await createSupabaseServerClient();
  const [access, packageResult] = await Promise.all([
    requireAuthorizedAccess(),
    supabase.from("media_hls_packages").select("id, movie_id, episode_id").eq("id", packageId).maybeSingle<PackageRow>(),
  ]);
  const packageRow = packageResult.data;
  if (!packageRow) notFound();

  if (packageRow.movie_id) {
    const [movieResult, metadataResult] = await Promise.all([
      supabase.from("movies").select("admin_title").eq("id", packageRow.movie_id).maybeSingle<{ admin_title: string }>(),
      supabase.from("media_tmdb_metadata").select("localized_title, backdrop_path, poster_path").eq("movie_id", packageRow.movie_id).maybeSingle<MetadataRow>(),
    ]);
    if (!movieResult.data) notFound();
    const metadata = metadataResult.data;
    return (
      <main className="watch-page">
        <div className="watch-stage">
          <MediaHlsPlayer
            userId={access.user.id}
            backHref={`/catalog/movies/${packageRow.movie_id}`}
            backdrop={tmdbImage(metadata?.backdrop_path ?? metadata?.poster_path, "w1280")}
            backdropMorphId={packageRow.movie_id}
            module="movies"
            packageId={packageRow.id}
            subtitle="Película"
            title={metadata?.localized_title ?? movieResult.data.admin_title}
          />
        </div>
      </main>
    );
  }

  // Episodio: se resuelve la serie, su temporada y el siguiente episodio con paquete listo.
  const { data: episode } = await supabase.from("series_episodes").select("id, admin_title, episode_number, season_id").eq("id", packageRow.episode_id!).maybeSingle<EpisodeRow>();
  if (!episode) notFound();
  const { data: season } = await supabase.from("series_seasons").select("id, season_number, series_id").eq("id", episode.season_id).maybeSingle<SeasonRow>();
  if (!season) notFound();
  const [seasonsResult, episodeMetadataResult, seriesMetadataResult, seriesResult] = await Promise.all([
    supabase.from("series_seasons").select("id, season_number, series_id").eq("series_id", season.series_id).eq("status", "published").order("season_number"),
    supabase.from("media_tmdb_metadata").select("localized_title, backdrop_path, poster_path").eq("episode_id", episode.id).maybeSingle<MetadataRow>(),
    supabase.from("media_tmdb_metadata").select("localized_title, backdrop_path, poster_path").eq("series_id", season.series_id).maybeSingle<MetadataRow>(),
    supabase.from("series").select("admin_title").eq("id", season.series_id).maybeSingle<{ admin_title: string }>(),
  ]);
  const seasons = (seasonsResult.data ?? []) as SeasonRow[];
  const seasonNumbers = new Map(seasons.map((item) => [item.id, item.season_number]));
  const { data: siblingEpisodes } = seasons.length
    ? await supabase.from("series_episodes").select("id, admin_title, episode_number, season_id").in("season_id", seasons.map((item) => item.id)).eq("status", "published").order("episode_number")
    : { data: [] as EpisodeRow[] };
  const ordered = ((siblingEpisodes ?? []) as EpisodeRow[]).sort((a, b) => (seasonNumbers.get(a.season_id) ?? 0) - (seasonNumbers.get(b.season_id) ?? 0) || a.episode_number - b.episode_number);
  const currentIndex = ordered.findIndex((item) => item.id === episode.id);
  const following = currentIndex >= 0 ? ordered.slice(currentIndex + 1, currentIndex + 6) : [];
  const { data: followingPackages } = following.length
    ? await supabase.from("media_hls_packages").select("id, episode_id").in("episode_id", following.map((item) => item.id))
    : { data: [] as Array<{ episode_id: string | null; id: string }> };
  const packageByEpisode = new Map((followingPackages ?? []).flatMap((item) => item.episode_id ? [[item.episode_id, item.id]] : []));
  const nextEpisode = following.find((item) => packageByEpisode.has(item.id));
  const code = (item: EpisodeRow) => `T${seasonNumbers.get(item.season_id) ?? season.season_number}:E${item.episode_number}`;
  const seriesTitle = seriesMetadataResult.data?.localized_title ?? seriesResult.data?.admin_title ?? "Serie";
  const episodeMetadata = episodeMetadataResult.data;

  return (
    <main className="watch-page">
      <div className="watch-stage">
        <MediaHlsPlayer
          userId={access.user.id}
          backHref={`/catalog/series/${season.series_id}`}
          backdrop={tmdbImage(episodeMetadata?.backdrop_path ?? seriesMetadataResult.data?.backdrop_path ?? seriesMetadataResult.data?.poster_path, "w1280")}
          backdropMorphId={season.series_id}
          module="series"
          next={nextEpisode ? { packageId: packageByEpisode.get(nextEpisode.id)!, title: `${code(nextEpisode)} · ${nextEpisode.admin_title}` } : null}
          packageId={packageRow.id}
          subtitle={`${seriesTitle} · ${code(episode)}`}
          title={episodeMetadata?.localized_title ?? episode.admin_title}
        />
      </div>
    </main>
  );
}
