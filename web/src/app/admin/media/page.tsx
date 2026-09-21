import type { Metadata } from "next";
import Link from "next/link";

import { AdminMediaManager, type AdminMediaRecord, type TmdbMetadata } from "@/components/admin-media-manager";
import { Icon } from "@/components/icons";
import { SiteHeader } from "@/components/site-header";
import { requireAdminAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administrar películas y series" };

const metadataColumns = "id, media_kind, movie_id, series_id, season_id, episode_id, tmdb_id, tmdb_url, localized_title, original_title, overview, poster_path, backdrop_path, release_date, runtime_minutes, genres, vote_average, vote_count, synced_at";

export default async function AdminMediaPage() {
  const supabase = await createSupabaseServerClient();
  const [, moviesResult, seriesResult, metadataResult] = await Promise.all([
    requireAdminAccess(),
    supabase.from("movies").select("id, internal_code, admin_code, admin_title, status").order("created_at"),
    supabase.from("series").select("id, internal_code, admin_code, admin_title, status").order("created_at"),
    // Solo títulos raíz: temporadas y episodios se cargan al abrir cada serie.
    supabase.from("media_tmdb_metadata").select(metadataColumns).is("season_id", null).is("episode_id", null),
  ]);
  const error = moviesResult.error ?? seriesResult.error ?? metadataResult.error;
  const movies = (moviesResult.data ?? []) as AdminMediaRecord[];
  const series = (seriesResult.data ?? []) as AdminMediaRecord[];
  const published = [...movies, ...series].filter((item) => item.status === "published").length;

  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell-main container">
        <section className="admin-hero rise">
          <div>
            <p className="kicker">Administración · Medios</p>
            <h1 className="display" style={{ fontSize: "clamp(2.2rem, 4.6vw, 4.2rem)" }}>Películas<br />y Series.</h1>
            <p className="lede">Crea la estructura, vincula metadatos de TMDB y publica paquetes HLS desde Drive.</p>
          </div>
          <div style={{ display: "grid", gap: 12, justifyItems: "end" }}>
            <div className="stat-row">
              <div className="stat"><strong>{movies.length}</strong><span>Películas</span></div>
              <div className="stat"><strong>{series.length}</strong><span>Series</span></div>
              <div className="stat"><strong>{published}</strong><span>Publicados</span></div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className="btn btn-ghost btn-sm" href="/admin"><Icon name="course" />Cursos</Link>
              <Link className="btn btn-ghost btn-sm" href="/admin/usage"><Icon name="settings" />Uso y cuotas</Link>
              <Link className="btn btn-ghost btn-sm" href="/catalog/movies"><Icon name="eye" />Ver catálogo</Link>
            </div>
          </div>
        </section>
        {error ? (
          <div className="notice notice-error" style={{ marginTop: 20 }}><span className="notice-icon"><Icon name="warning" /></span><div>No se pudo cargar el catálogo de medios.</div></div>
        ) : (
          <AdminMediaManager initialMetadata={(metadataResult.data ?? []) as TmdbMetadata[]} initialMovies={movies} initialSeries={series} />
        )}
      </main>
    </div>
  );
}
