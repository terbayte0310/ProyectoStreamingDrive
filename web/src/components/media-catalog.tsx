import { type CSSProperties, ViewTransition } from "react";

import { Icon } from "@/components/icons";
import { IntentLink } from "@/components/intent-link";

export type LibraryModule = "courses" | "movies" | "series";

export type TmdbCatalogMetadata = {
  backdrop_path?: string | null;
  episode_id: string | null;
  genres: Array<{ id: number; name: string }>;
  localized_title: string | null;
  movie_id: string | null;
  overview: string | null;
  poster_path: string | null;
  release_date: string | null;
  runtime_minutes: number | null;
  season_id: string | null;
  series_id: string | null;
  tmdb_url: string | null;
};

export const libraryModuleLinks: Array<{ description: string; href: string; label: string; module: LibraryModule }> = [
  { description: "Aprende a tu ritmo con avance guardado.", href: "/catalog/cursos", label: "Cursos", module: "courses" },
  { description: "Una noche, una historia completa.", href: "/catalog/movies", label: "Películas", module: "movies" },
  { description: "Temporadas para quedarse.", href: "/catalog/series", label: "Series", module: "series" },
];

// TMDB sirve cada tamaño desde su propia CDN: usarlo directamente evita
// consumir la cuota gratuita de optimización de imágenes de Vercel.
export function tmdbImage(path: string | null | undefined, size: "w185" | "w342" | "w500" | "w780" | "w1280" | "original" = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export function posterSrcSet(path: string) {
  return `${tmdbImage(path, "w185")} 185w, ${tmdbImage(path, "w342")} 342w, ${tmdbImage(path, "w500")} 500w`;
}

export function backdropSrcSet(path: string) {
  return `${tmdbImage(path, "w780")} 780w, ${tmdbImage(path, "w1280")} 1280w`;
}

export function yearOf(metadata: TmdbCatalogMetadata | null | undefined) {
  return metadata?.release_date?.slice(0, 4) ?? null;
}

export function metadataSummary(metadata: TmdbCatalogMetadata | null | undefined) {
  if (!metadata) return "Sin datos adicionales";
  return [yearOf(metadata), metadata.runtime_minutes ? formatRuntime(metadata.runtime_minutes) : null, metadata.genres.map((genre) => genre.name).slice(0, 2).join(" · ") || null].filter(Boolean).join(" · ") || "Sin datos adicionales";
}

export function formatRuntime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/* eslint-disable @next/next/no-img-element -- imágenes servidas por la CDN de TMDB con srcset propio. */
export function MediaPoster({ eager = false, posterPath, sizes = "(max-width: 640px) 46vw, 220px", title }: { eager?: boolean; posterPath: string | null; sizes?: string; title: string }) {
  if (!posterPath) return <div aria-label={`Sin portada para ${title}`} className="poster-fallback" role="img">{title}</div>;
  return <img alt={`Portada de ${title}`} decoding="async" fetchPriority={eager ? "high" : "auto"} height={513} loading={eager ? "eager" : "lazy"} sizes={sizes} src={tmdbImage(posterPath, "w342")!} srcSet={posterSrcSet(posterPath)} width={342} />;
}

/**
 * Fondo de una película o serie. Con `morphId`, el mismo fondo se reconoce en el
 * banner del catálogo, en la ficha y en el reproductor, y el navegador lo
 * transforma de uno a otro al navegar (mismo `morphId` = mismo elemento).
 */
export function Backdrop({ morphId, path, title }: { morphId?: string; path: string | null | undefined; title: string }) {
  if (!path) return null;
  const image = <img alt="" aria-label={`Escena de ${title}`} decoding="async" fetchPriority="high" sizes="100vw" src={tmdbImage(path, "w1280")!} srcSet={backdropSrcSet(path)} />;
  return morphId ? <ViewTransition default="none" name={`backdrop-${morphId}`} share="nb-morph">{image}</ViewTransition> : image;
}
/* eslint-enable @next/next/no-img-element */

export function PosterCard({ href, id, index = 0, metadata, title }: { href: string; id: string; index?: number; metadata?: TmdbCatalogMetadata; title: string }) {
  return (
    <IntentLink className="poster-card" dwellPrefetch href={href} style={{ "--i": index } as CSSProperties} transitionTypes={["nav-forward"]}>
      <ViewTransition default="none" name={`poster-${id}`} share="nb-morph">
        <div className="poster-frame" data-spotlight="" data-tilt="9">
          <MediaPoster posterPath={metadata?.poster_path ?? null} title={title} />
          <div className="poster-hover">
            {metadata?.overview ? <p>{metadata.overview}</p> : null}
            <span className="link-arrow" style={{ color: "#fff" }}>Ver ficha <span aria-hidden="true"><Icon name="arrowRight" width={14} /></span></span>
          </div>
        </div>
      </ViewTransition>
      <div className="poster-info">
        <strong>{title}</strong>
        <span>{[yearOf(metadata), metadata?.genres[0]?.name].filter(Boolean).join(" · ") || "—"}</span>
      </div>
    </IntentLink>
  );
}

export function TmdbAttribution() {
  return <p className="tmdb-note">Datos e imágenes proporcionados por TMDB. Esta aplicación no está respaldada ni certificada por TMDB.</p>;
}
