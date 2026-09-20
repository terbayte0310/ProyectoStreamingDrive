"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";

/** Riel horizontal con snap, flechas que se desactivan en los extremos y scroll suave. */
export function Rail({ children, description, kicker, title }: { children: ReactNode; description?: string; kicker?: string; title: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ end: true, start: true });

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setEdges({ end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 4, start: track.scrollLeft <= 4 });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    measure();
    track.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => { track.removeEventListener("scroll", measure); observer.disconnect(); };
  }, [measure]);

  function scroll(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ behavior: "smooth", left: direction * track.clientWidth * 0.85 });
  }

  return (
    <section className="section rail">
      <div className="section-head">
        <div>
          {kicker ? <p className="kicker">{kicker}</p> : null}
          <h2 className="title-l">{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {!(edges.start && edges.end) ? (
          <div className="rail-controls">
            <button aria-label="Anterior" className="rail-button" disabled={edges.start} onClick={() => scroll(-1)} type="button"><Icon name="chevronLeft" /></button>
            <button aria-label="Siguiente" className="rail-button" disabled={edges.end} onClick={() => scroll(1)} type="button"><Icon name="chevronRight" /></button>
          </div>
        ) : null}
      </div>
      <div className="rail-track" ref={trackRef}>{children}</div>
    </section>
  );
}
