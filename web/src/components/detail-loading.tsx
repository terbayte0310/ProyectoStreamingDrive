"use client";

import { useParams } from "next/navigation";
import { ViewTransition } from "react";

import { recallPoster } from "@/lib/media/poster-handoff";

/**
 * Esqueleto de una ficha de película o serie. Reproduce la estructura de la ficha
 * real y, si el usuario llegó pulsando una portada del catálogo, muestra esa misma
 * portada con el mismo nombre de transición: así el morfismo se forma desde el
 * primer instante en lugar de perderse hasta que llegan los datos.
 */
export function DetailLoading() {
  const params = useParams<{ movieId?: string; seriesId?: string }>();
  const id = params.movieId ?? params.seriesId ?? "";
  const poster = id ? recallPoster(id) : null;

  return (
    <main aria-busy="true" className="shell-main">
      <section className="detail-hero">
        <div className="detail-backdrop" />
        <div className="detail-hero-inner container">
          {poster ? (
            <ViewTransition default="none" name={`poster-${id}`} share="nb-morph">
              <div className="detail-poster">
                {/* eslint-disable-next-line @next/next/no-img-element -- la misma imagen que ya está en la caché del navegador. */}
                <img alt={poster.title} decoding="async" height={513} src={poster.src} width={342} />
              </div>
            </ViewTransition>
          ) : (
            <div className="detail-poster skeleton" style={{ aspectRatio: "2 / 3" }} />
          )}
          <div className="detail-copy">
            <span className="sr-only">Cargando la ficha…</span>
            <div className="skeleton" style={{ width: 120, height: 14, opacity: 0.4 }} />
            <div className="skeleton" style={{ width: "min(100%, 520px)", height: 64, opacity: 0.35 }} />
            <div className="skeleton" style={{ width: "min(100%, 360px)", height: 22, opacity: 0.3 }} />
            <div className="skeleton" style={{ width: "min(100%, 640px)", height: 84, opacity: 0.25 }} />
          </div>
        </div>
      </section>
    </main>
  );
}
