import Image from "next/image";
import Link from "next/link";

export type LibraryModule = "courses" | "movies" | "series";

export type TmdbCatalogMetadata = {
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

const moduleLinks: Array<{ href: string; label: string; module: LibraryModule }> = [
  { href: "/catalog/cursos", label: "Cursos", module: "courses" },
  { href: "/catalog/movies", label: "Movies", module: "movies" },
  { href: "/catalog/series", label: "Series", module: "series" },
];

export function CatalogModuleNavigation({ active, modules }: { active: LibraryModule; modules: LibraryModule[] }) {
  return (
    <nav aria-label="Módulos del catálogo" className="catalog-module-nav">
      {moduleLinks.filter((item) => modules.includes(item.module)).map((item) => (
        <Link aria-current={item.module === active ? "page" : undefined} className={item.module === active ? "catalog-module-link catalog-module-link-active" : "catalog-module-link"} href={item.href} key={item.module}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function tmdbImageUrl(posterPath: string | null) {
  return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null;
}

export function MediaPoster({ posterPath, title }: { posterPath: string | null; title: string }) {
  const imageUrl = tmdbImageUrl(posterPath);
  return imageUrl ? <Image alt={`Portada de ${title}`} className="media-poster-image" height={750} sizes="(max-width: 640px) 50vw, 18rem" src={imageUrl} width={500} /> : <div aria-label={`Sin portada para ${title}`} className="media-poster-placeholder" role="img">{title.slice(0, 1).toUpperCase()}</div>;
}

export function metadataSummary(metadata: TmdbCatalogMetadata | undefined) {
  if (!metadata) return "Sin datos adicionales.";
  return [metadata.release_date?.slice(0, 4), metadata.runtime_minutes ? `${metadata.runtime_minutes} min` : null, metadata.genres.map((genre) => genre.name).slice(0, 2).join(" · ") || null].filter(Boolean).join(" · ") || "Sin datos adicionales.";
}

export function TmdbAttribution() {
  return <p className="tmdb-attribution">Datos e imágenes proporcionados por TMDB. Esta aplicación no está respaldada ni certificada por TMDB.</p>;
}
