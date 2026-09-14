import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CatalogModuleNavigation, MediaPoster, metadataSummary, type LibraryModule, type TmdbCatalogMetadata, TmdbAttribution } from "@/components/media-catalog";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const metadataColumns = "movie_id, localized_title, overview, poster_path, release_date, runtime_minutes, genres, tmdb_url";

export default async function MovieDetailPage({ params }: { params: Promise<{ movieId: string }> }) {
  const { movieId } = await params;
  const access = await requireAuthorizedAccess();
  const supabase = await createSupabaseServerClient();
  const [modulesResult, movieResult, metadataResult, packageResult] = await Promise.all([
    supabase.rpc("get_my_module_access"),
    supabase.from("movies").select("id, admin_title").eq("id", movieId).eq("status", "published").maybeSingle(),
    supabase.from("media_tmdb_metadata").select(metadataColumns).eq("movie_id", movieId).maybeSingle(),
    supabase.from("media_hls_packages").select("id").eq("movie_id", movieId).maybeSingle(),
  ]);
  if (!movieResult.data) notFound();
  const modules = Array.isArray(modulesResult.data) ? modulesResult.data.flatMap((row) => row && typeof row === "object" && ["courses", "movies", "series"].includes((row as { module?: string }).module ?? "") ? [(row as { module: LibraryModule }).module] : []) : [];
  const movie = movieResult.data;
  const metadata = metadataResult.data as TmdbCatalogMetadata | null;
  const title = metadata?.localized_title ?? movie.admin_title;

  return <div className="app-shell"><AppHeader admin={access.profile.role === "admin"} contextLabel="Ficha de Movie" email={access.profile.email} showNavigation={false} /><main className="catalog-main page-width"><CatalogModuleNavigation active="movies" modules={modules} /><Link className="catalog-back-link" href="/catalog/movies">← Volver a Movies</Link><article className="media-detail"><MediaPoster posterPath={metadata?.poster_path ?? null} title={title} /><div><p className="eyebrow">Movie</p><h1>{title}</h1><p className="media-detail-meta">{metadataSummary(metadata ?? undefined)}</p><p className="media-detail-overview">{metadata?.overview ?? "Sin sinopsis disponible."}</p>{packageResult.data ? <Link className="primary-button mt-6" href={`/media-player?package=${packageResult.data.id}`}>▶ Reproducir</Link> : null}{metadata?.tmdb_url ? <a className="secondary-button mt-6" href={metadata.tmdb_url} rel="noreferrer" target="_blank">Ver en TMDB ↗</a> : null}</div></article><TmdbAttribution /></main></div>;
}
