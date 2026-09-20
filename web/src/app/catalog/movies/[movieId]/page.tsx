import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition } from "react";

import { Icon } from "@/components/icons";
import { Backdrop, formatRuntime, MediaPoster, type TmdbCatalogMetadata, TmdbAttribution, yearOf } from "@/components/media-catalog";
import { SiteHeader } from "@/components/site-header";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const metadataColumns = "movie_id, localized_title, overview, poster_path, backdrop_path, release_date, runtime_minutes, genres, tmdb_url";

export default async function MovieDetailPage({ params }: { params: Promise<{ movieId: string }> }) {
  const { movieId } = await params;
  const supabase = await createSupabaseServerClient();
  const [, movieResult, metadataResult, packageResult] = await Promise.all([
    requireAuthorizedAccess(),
    supabase.from("movies").select("id, admin_title").eq("id", movieId).eq("status", "published").maybeSingle(),
    supabase.from("media_tmdb_metadata").select(metadataColumns).eq("movie_id", movieId).maybeSingle(),
    supabase.from("media_hls_packages").select("id").eq("movie_id", movieId).maybeSingle(),
  ]);
  if (!movieResult.data) notFound();
  const movie = movieResult.data;
  const metadata = metadataResult.data as TmdbCatalogMetadata | null;
  const title = metadata?.localized_title ?? movie.admin_title;
  const year = yearOf(metadata);

  return (
    <div className="shell">
      <SiteHeader tone="media" />
      <main className="shell-main">
        <section className="detail-hero">
          <div className="detail-backdrop"><Backdrop path={metadata?.backdrop_path ?? metadata?.poster_path} title={title} /></div>
          <div className="detail-hero-inner container">
            <ViewTransition default="none" name={`poster-${movie.id}`} share="nb-morph">
              <div className="detail-poster"><MediaPoster eager posterPath={metadata?.poster_path ?? null} sizes="300px" title={title} /></div>
            </ViewTransition>
            <div className="detail-copy">
              <Link className="back-link" href="/catalog/movies"><Icon name="arrowLeft" />Películas</Link>
              <h1 className="display">{title}</h1>
              <div className="detail-meta">
                {year ? <span className="badge">{year}</span> : null}
                {metadata?.runtime_minutes ? <span className="badge">{formatRuntime(metadata.runtime_minutes)}</span> : null}
                {metadata?.genres.slice(0, 3).map((genre) => <span className="badge" key={genre.id}>{genre.name}</span>)}
              </div>
              <p className="detail-overview">{metadata?.overview ?? "Sin sinopsis disponible."}</p>
              <div className="detail-actions">
                {packageResult.data ? (
                  <Link className="btn btn-primary btn-lg" href={`/media-player?package=${packageResult.data.id}`}><Icon name="play" />Reproducir</Link>
                ) : (
                  <span className="btn btn-glass btn-lg" aria-disabled="true"><Icon name="info" />Aún no está lista para reproducir</span>
                )}
                {metadata?.tmdb_url ? <a className="btn btn-glass btn-lg" href={metadata.tmdb_url} rel="noreferrer" target="_blank">Ficha en TMDB</a> : null}
              </div>
            </div>
          </div>
        </section>
        <div className="container"><TmdbAttribution /></div>
      </main>
    </div>
  );
}
