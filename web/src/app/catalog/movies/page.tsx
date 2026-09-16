import Link from "next/link";
import { CatalogCollection } from "@/components/catalog-collection";

import { AppHeader } from "@/components/app-header";
import { CatalogModuleNavigation, MediaPoster, metadataSummary, type LibraryModule, type TmdbCatalogMetadata, TmdbAttribution } from "@/components/media-catalog";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const metadataColumns = "movie_id, localized_title, overview, poster_path, release_date, runtime_minutes, genres, tmdb_url";

export default async function MoviesCatalogPage() {
  const access = await requireAuthorizedAccess();
  const supabase = await createSupabaseServerClient();
  const modulesResult = await supabase.rpc("get_my_module_access");
  const modules = Array.isArray(modulesResult.data) ? modulesResult.data.flatMap((row) => row && typeof row === "object" && ["courses", "movies", "series"].includes((row as { module?: string }).module ?? "") ? [(row as { module: LibraryModule }).module] : []) : [];
  const hasMovies = modules.includes("movies");
  const [moviesResult, metadataResult] = hasMovies ? await Promise.all([
    supabase.from("movies").select("id, admin_title").eq("status", "published").order("created_at"),
    supabase.from("media_tmdb_metadata").select(metadataColumns).not("movie_id", "is", null),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const metadataByMovie = new Map(((metadataResult.data ?? []) as TmdbCatalogMetadata[]).flatMap((metadata) => metadata.movie_id ? [[metadata.movie_id, metadata]] : []));
  const movies = moviesResult.data ?? [];

  return <div className="app-shell"><AppHeader admin={access.profile.role === "admin"} contextLabel="Películas" email={access.profile.email} showNavigation={false} /><main className="catalog-main page-width"><CatalogModuleNavigation active="movies" modules={modules} /><section className="media-catalog-intro"><p className="eyebrow">Biblioteca de películas</p><h1>Una noche.<br />Mil historias.</h1><p>Elige una película, ponte cómodo y deja que la historia haga el resto.</p></section>{!hasMovies ? <section className="status-card">No tienes acceso al módulo Películas.</section> : null}{moviesResult.error || metadataResult.error ? <section className="status-card">No se pudo cargar el catálogo de películas.</section> : null}{hasMovies && !moviesResult.error && !metadataResult.error ? <CatalogCollection entries={movies.map((movie) => { const metadata = metadataByMovie.get(movie.id); return { id: movie.id, title: metadata?.localized_title ?? movie.admin_title, category: metadata?.genres[0]?.name ?? "", content: <article className="media-card" key={movie.id}><MediaPoster posterPath={metadata?.poster_path ?? null} title={metadata?.localized_title ?? movie.admin_title} /><div className="media-card-body"><h2>{metadata?.localized_title ?? movie.admin_title}</h2><p className="media-card-summary">{metadata?.overview ?? "Sin sinopsis disponible."}</p><p className="course-card-meta">{metadataSummary(metadata)}</p><Link className="media-card-link" href={`/catalog/movies/${movie.id}`}>Ver ficha <span aria-hidden="true">→</span></Link></div></article> }; })} /> : null}{hasMovies && !movies.length && !moviesResult.error ? <section className="status-card">Todavía no hay películas publicadas.</section> : null}<TmdbAttribution /></main></div>;
}
