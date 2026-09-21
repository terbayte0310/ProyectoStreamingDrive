import { CatalogCollection } from "@/components/catalog-collection";
import { Icon } from "@/components/icons";
import { IntentLink } from "@/components/intent-link";
import { Backdrop, metadataSummary, PosterCard, type TmdbCatalogMetadata, TmdbAttribution } from "@/components/media-catalog";
import { SiteHeader } from "@/components/site-header";
import { Spotlight, type SpotlightSlide } from "@/components/spotlight";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const metadataColumns = "movie_id, localized_title, overview, poster_path, backdrop_path, release_date, runtime_minutes, genres, tmdb_url";

export default async function MoviesCatalogPage() {
  const supabase = await createSupabaseServerClient();
  const viewer = await requireAuthorizedAccess();
  const hasMovies = viewer.modules.includes("movies");
  const [moviesResult, metadataResult] = hasMovies ? await Promise.all([
    supabase.from("movies").select("id, admin_title").eq("status", "published").order("created_at"),
    supabase.from("media_tmdb_metadata").select(metadataColumns).not("movie_id", "is", null),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const metadataByMovie = new Map(((metadataResult.data ?? []) as TmdbCatalogMetadata[]).flatMap((metadata) => metadata.movie_id ? [[metadata.movie_id, metadata]] : []));
  const movies = (moviesResult.data ?? []).map((movie) => {
    const metadata = metadataByMovie.get(movie.id);
    return { id: movie.id, metadata, title: metadata?.localized_title ?? movie.admin_title };
  });
  const failed = Boolean(moviesResult.error || metadataResult.error);

  // Destacados: los más recientes con fondo panorámico disponible.
  const slides: SpotlightSlide[] = movies.filter((movie) => movie.metadata?.backdrop_path).slice(-5).reverse().map((movie) => ({
    actions: (
      <>
        <IntentLink className="btn btn-primary btn-lg" href={`/catalog/movies/${movie.id}`} transitionTypes={["nav-forward"]}><Icon name="play" />Ver ahora</IntentLink>
        <a className="btn btn-glass btn-lg" href="#biblioteca">Todas las películas</a>
      </>
    ),
    badges: metadataSummary(movie.metadata).split(" · ").filter((value) => value && value !== "Sin datos adicionales"),
    description: movie.metadata?.overview,
    id: movie.id,
    kicker: "Película destacada",
    media: <Backdrop morphId={movie.id} path={movie.metadata?.backdrop_path} title={movie.title} />,
    title: movie.title,
  }));

  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell-main container">
        {!hasMovies ? (
          <section className="empty-state" style={{ marginTop: 32 }}>
            <span aria-hidden="true" className="empty-orb" />
            <h1 className="title-l">Películas no está en tu plan</h1>
            <p>Pide a un administrador acceso al módulo Películas.</p>
          </section>
        ) : null}
        {failed ? <div className="notice notice-error" style={{ marginTop: 16 }}><span className="notice-icon"><Icon name="warning" /></span><div>No se pudo cargar el catálogo de películas. Recarga en unos segundos.</div></div> : null}
        {hasMovies && !failed ? (
          <>
            {slides.length ? <Spotlight label="Películas destacadas" slides={slides} /> : (
              <header className="page-head">
                <p className="kicker">Películas</p>
                <h1 className="display">Una noche.<br /><span className="text-gradient">Mil historias.</span></h1>
                <p className="lede">Elige una película, ponte cómodo y deja que la historia haga el resto.</p>
              </header>
            )}
            <CatalogCollection
              entries={movies.map((movie, index) => ({
                category: movie.metadata?.genres[0]?.name ?? "",
                content: <PosterCard href={`/catalog/movies/${movie.id}`} id={movie.id} index={index} metadata={movie.metadata} title={movie.title} />,
                id: movie.id,
                title: movie.title,
              }))}
              heading="Todas las películas"
              kicker={`${movies.length} películas`}
            />
          </>
        ) : null}
        <TmdbAttribution />
      </main>
    </div>
  );
}
