import Link from "next/link";
import { CatalogCollection } from "@/components/catalog-collection";

import { AppHeader } from "@/components/app-header";
import { CatalogModuleNavigation, MediaPoster, metadataSummary, type LibraryModule, type TmdbCatalogMetadata, TmdbAttribution } from "@/components/media-catalog";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const metadataColumns = "series_id, localized_title, overview, poster_path, release_date, runtime_minutes, genres, tmdb_url";

export default async function SeriesCatalogPage() {
  const access = await requireAuthorizedAccess();
  const supabase = await createSupabaseServerClient();
  const modulesResult = await supabase.rpc("get_my_module_access");
  const modules = Array.isArray(modulesResult.data) ? modulesResult.data.flatMap((row) => row && typeof row === "object" && ["courses", "movies", "series"].includes((row as { module?: string }).module ?? "") ? [(row as { module: LibraryModule }).module] : []) : [];
  const hasSeries = modules.includes("series");
  const [seriesResult, metadataResult] = hasSeries ? await Promise.all([
    supabase.from("series").select("id, admin_title").eq("status", "published").order("created_at"),
    supabase.from("media_tmdb_metadata").select(metadataColumns).not("series_id", "is", null),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const metadataBySeries = new Map(((metadataResult.data ?? []) as TmdbCatalogMetadata[]).flatMap((metadata) => metadata.series_id ? [[metadata.series_id, metadata]] : []));
  const series = seriesResult.data ?? [];

  return <div className="app-shell"><AppHeader admin={access.profile.role === "admin"} contextLabel="Catálogo de Series" email={access.profile.email} showNavigation={false} /><main className="catalog-main page-width"><CatalogModuleNavigation active="series" modules={modules} /><section className="media-catalog-intro"><p className="eyebrow">Biblioteca de series</p><h1>Solo un episodio<br />más.</h1><p>Historias que se quedan contigo. Explora temporadas y encuentra tu próxima serie.</p></section>{!hasSeries ? <section className="status-card">No tienes acceso al módulo Series.</section> : null}{seriesResult.error || metadataResult.error ? <section className="status-card">No se pudo cargar el catálogo de Series.</section> : null}{hasSeries && !seriesResult.error && !metadataResult.error ? <CatalogCollection entries={series.map((item) => { const metadata = metadataBySeries.get(item.id); return { id: item.id, title: metadata?.localized_title ?? item.admin_title, category: metadata?.genres[0]?.name ?? "", content: <article className="media-card" key={item.id}><MediaPoster posterPath={metadata?.poster_path ?? null} title={metadata?.localized_title ?? item.admin_title} /><div className="media-card-body"><h2>{metadata?.localized_title ?? item.admin_title}</h2><p className="media-card-summary">{metadata?.overview ?? "Sin sinopsis disponible."}</p><p className="course-card-meta">{metadataSummary(metadata)}</p><Link className="media-card-link" href={`/catalog/series/${item.id}`}>Ver temporadas <span aria-hidden="true">→</span></Link></div></article> }; })} /> : null}{hasSeries && !series.length && !seriesResult.error ? <section className="status-card">Todavía no hay series publicadas.</section> : null}<TmdbAttribution /></main></div>;
}
