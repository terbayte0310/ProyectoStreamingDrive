import Link from "next/link";

import { AdminMediaManager, type AdminMediaRecord, type TmdbMetadata } from "@/components/admin-media-manager";
import { AppHeader } from "@/components/app-header";
import { requireAdminAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const metadataColumns = "id, media_kind, movie_id, series_id, season_id, episode_id, tmdb_id, tmdb_url, localized_title, original_title, overview, poster_path, backdrop_path, release_date, runtime_minutes, genres, vote_average, vote_count, synced_at";

export default async function AdminMediaPage() {
  const access = await requireAdminAccess();
  const supabase = await createSupabaseServerClient();
  const [moviesResult, seriesResult, metadataResult] = await Promise.all([
    supabase.from("movies").select("id, internal_code, admin_code, admin_title, status").order("created_at"),
    supabase.from("series").select("id, internal_code, admin_code, admin_title, status").order("created_at"),
    supabase.from("media_tmdb_metadata").select(metadataColumns),
  ]);
  const error = moviesResult.error ?? seriesResult.error ?? metadataResult.error;
  const movies = (moviesResult.data ?? []) as AdminMediaRecord[];
  const series = (seriesResult.data ?? []) as AdminMediaRecord[];
  const metadata = (metadataResult.data ?? []) as TmdbMetadata[];

  return (
    <div className="admin-page app-shell">
      <AppHeader email={access.profile.email} showNavigation={false} />
      <main className="admin-main page-width">
        <section className="admin-hero admin-reveal">
          <div><p className="eyebrow">Control de medios</p><h1>Movies y Series.</h1><p>Crea la estructura interna, controla publicación y vincula los metadatos que se conservarán en tu propia base de datos.</p></div>
          <div className="admin-hero-actions"><div className="admin-stat"><strong>{movies.length}</strong><span>Movies</span></div><div className="admin-stat"><strong>{series.length}</strong><span>Series</span></div><Link className="secondary-button" href="/admin">Administrar cursos <span aria-hidden="true">↗</span></Link></div>
        </section>
        {error ? <p className="admin-alert admin-alert-error">No se pudo cargar el catálogo de medios.</p> : <AdminMediaManager initialMetadata={metadata} initialMovies={movies} initialSeries={series} />}
      </main>
    </div>
  );
}
