import { CatalogCollection } from "@/components/catalog-collection";
import { Icon } from "@/components/icons";
import { IntentLink } from "@/components/intent-link";
import { Backdrop, metadataSummary, PosterCard, type TmdbCatalogMetadata, TmdbAttribution } from "@/components/media-catalog";
import { SiteHeader } from "@/components/site-header";
import { Spotlight, type SpotlightSlide } from "@/components/spotlight";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const metadataColumns = "series_id, localized_title, overview, poster_path, backdrop_path, release_date, runtime_minutes, genres, tmdb_url";

export default async function SeriesCatalogPage() {
  const supabase = await createSupabaseServerClient();
  const viewer = await requireAuthorizedAccess();
  const hasSeries = viewer.modules.includes("series");
  const [seriesResult, metadataResult] = hasSeries ? await Promise.all([
    supabase.from("series").select("id, admin_title").eq("status", "published").order("created_at"),
    supabase.from("media_tmdb_metadata").select(metadataColumns).not("series_id", "is", null).is("season_id", null).is("episode_id", null),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const metadataBySeries = new Map(((metadataResult.data ?? []) as TmdbCatalogMetadata[]).flatMap((metadata) => metadata.series_id ? [[metadata.series_id, metadata]] : []));
  const series = (seriesResult.data ?? []).map((item) => {
    const metadata = metadataBySeries.get(item.id);
    return { id: item.id, metadata, title: metadata?.localized_title ?? item.admin_title };
  });
  const failed = Boolean(seriesResult.error || metadataResult.error);

  const slides: SpotlightSlide[] = series.filter((item) => item.metadata?.backdrop_path).slice(-5).reverse().map((item) => ({
    actions: (
      <>
        <IntentLink className="btn btn-primary btn-lg" href={`/catalog/series/${item.id}`} transitionTypes={["nav-forward"]}><Icon name="play" />Ver temporadas</IntentLink>
        <a className="btn btn-glass btn-lg" href="#biblioteca">Todas las series</a>
      </>
    ),
    badges: metadataSummary(item.metadata).split(" · ").filter((value) => value && value !== "Sin datos adicionales"),
    description: item.metadata?.overview,
    id: item.id,
    kicker: "Serie destacada",
    media: <Backdrop morphId={item.id} path={item.metadata?.backdrop_path} title={item.title} />,
    title: item.title,
  }));

  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell-main container">
        {!hasSeries ? (
          <section className="empty-state" style={{ marginTop: 32 }}>
            <span aria-hidden="true" className="empty-orb" />
            <h1 className="title-l">Series no está en tu plan</h1>
            <p>Pide a un administrador acceso al módulo Series.</p>
          </section>
        ) : null}
        {failed ? <div className="notice notice-error" style={{ marginTop: 16 }}><span className="notice-icon"><Icon name="warning" /></span><div>No se pudo cargar el catálogo de series. Recarga en unos segundos.</div></div> : null}
        {hasSeries && !failed ? (
          <>
            {slides.length ? <Spotlight label="Series destacadas" slides={slides} /> : (
              <header className="page-head">
                <p className="kicker">Series</p>
                <h1 className="display">Solo un episodio <span className="text-gradient">más.</span></h1>
                <p className="lede">Historias que se quedan contigo. Explora temporadas y encuentra tu próxima serie.</p>
              </header>
            )}
            <CatalogCollection
              entries={series.map((item, index) => ({
                category: item.metadata?.genres[0]?.name ?? "",
                content: <PosterCard href={`/catalog/series/${item.id}`} id={item.id} index={index} metadata={item.metadata} title={item.title} />,
                id: item.id,
                title: item.title,
              }))}
              heading="Todas las series"
              kicker={`${series.length} series`}
            />
          </>
        ) : null}
        <TmdbAttribution />
      </main>
    </div>
  );
}
