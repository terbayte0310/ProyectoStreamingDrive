"use client";
import { useRef } from "react";
import { AppHeader } from "@/components/app-header";
import { CatalogCollection } from "@/components/catalog-collection";
import { CinemaPlayer } from "@/components/cinema-player";
import { CourseCover } from "@/components/course-cover";
import { CatalogModuleNavigation } from "@/components/media-catalog";
const titles = [
  { title: "El arte de observar", category: "Creatividad" },
  { title: "Diseñar lo esencial", category: "Diseño" },
  { title: "Un mundo en movimiento", category: "Creatividad" },
  { title: "Arquitectura de las ideas", category: "Diseño" },
];
export function DesignPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  return <div className="app-shell"><AppHeader /><main className="page-width catalog-main">
    <p className="muted text-xs mt-4">Vista de diseño · Solo desarrollo · Contenido de ejemplo, sin conexión al catálogo privado.</p>
    <CatalogModuleNavigation active="courses" modules={["courses", "movies", "series"]} />
    <section className="hero"><div className="hero-copy"><p className="eyebrow">UN MOMENTO PARA DESCUBRIR</p><h1>El arte de observar</h1><p className="hero-description">Las mejores ideas empiezan mirando de otra manera. Haz espacio para la curiosidad y descubre tu siguiente gran idea.</p><div className="hero-meta"><span className="meta-pill">Creatividad</span><span className="meta-pill">12 lecciones</span><span className="meta-pill">Tu ritmo, tu espacio</span></div><div className="hero-actions"><a href="#preview-player" className="primary-button">▶ Explorar reproductor</a><a href="#biblioteca" className="secondary-button">Ver biblioteca</a></div></div><div className="hero-art" aria-hidden="true"><CourseCover title="El arte de observar" category="Creatividad" /></div></section>
    <CatalogCollection kind="courses" entries={titles.map((entry, i) => ({ id: String(i), ...entry, content: <article className="course-card"><CourseCover {...entry} /><div className="course-card-body"><h3>{entry.title}</h3><p className="course-card-meta">12 lecciones · {entry.category}</p><div className="progress-line"><span style={{ width: `${i * 20}%` }} /></div><div className="course-card-footer"><a href="#preview-player">Explorar reproductor →</a><span className="percentage">{i * 20}%</span></div></div></article> }))} />
    <section id="preview-player" className="section-block"><div className="section-heading"><div><p className="eyebrow">EL CONTENIDO, EN PRIMER PLANO</p><h2>Tu sala privada</h2><p>Reproductor de demostración. La prueba automatizada incorpora un vídeo sintético local.</p></div></div><div className="video-shell"><CinemaPlayer videoRef={videoRef} title="El arte de observar · Vista de diseño" /></div></section>
  </main></div>;
}
