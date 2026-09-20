"use client";

import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export type SpotlightSlide = {
  actions: ReactNode;
  badges: string[];
  description?: string | null;
  id: string;
  kicker: string;
  media: ReactNode;
  progress?: number | null;
  progressLabel?: string;
  title: string;
};

const intervalMs = 7000;

/** Hero cinematográfico: rota entre destacados con Ken Burns y un haz de proyector. */
export function Spotlight({ label = "Destacados", slides }: { label?: string; slides: SpotlightSlide[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const count = slides.length;

  const go = useCallback((index: number) => setActive(((index % count) + count) % count), [count]);

  useEffect(() => {
    if (count < 2 || paused) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const timer = window.setTimeout(() => go(active + 1), intervalMs);
    return () => window.clearTimeout(timer);
  }, [active, count, go, paused]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  if (!count) return null;

  return (
    <section
      aria-label={label}
      aria-roledescription="carrusel"
      className="spotlight"
      data-paused={paused ? "" : undefined}
      onBlurCapture={(event) => { if (!rootRef.current?.contains(event.relatedTarget as Node)) setPaused(false); }}
      onFocusCapture={() => setPaused(true)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(active + 1);
        if (event.key === "ArrowLeft") go(active - 1);
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      ref={rootRef}
      style={{ "--spotlight-interval": `${intervalMs}ms` } as CSSProperties}
    >
      {slides.map((slide, index) => (
        <div aria-hidden={index !== active} aria-label={`${index + 1} de ${count}`} aria-roledescription="diapositiva" className="spotlight-slide" data-active={index === active ? "" : undefined} inert={index !== active} key={slide.id} role="group">
          <div aria-hidden="true" className="spotlight-media">{slide.media}</div>
          <div className="spotlight-copy container" style={{ marginInline: 0 }}>
            <p className="kicker">{slide.kicker}</p>
            <h2 className="display">{slide.title}</h2>
            {slide.description ? <p className="spotlight-desc">{slide.description}</p> : null}
            <div className="spotlight-meta">
              {slide.badges.map((badge) => <span className="badge" key={badge}>{badge}</span>)}
              {typeof slide.progress === "number" && slide.progress > 0 ? (
                <span className="spotlight-progress" style={{ minWidth: 200 }}>
                  <span className="meter"><span style={{ width: `${slide.progress}%` }} /></span>
                  {slide.progressLabel ?? `${slide.progress}%`}
                </span>
              ) : null}
            </div>
            <div className="spotlight-actions">{slide.actions}</div>
          </div>
        </div>
      ))}
      {count > 1 ? (
        <div className="spotlight-dots" role="tablist">
          {slides.map((slide, index) => (
            <button aria-current={index === active} aria-label={`Ver destacado ${index + 1}: ${slide.title}`} className="spotlight-dot" key={`${slide.id}-${index === active ? active : "idle"}`} onClick={() => go(index)} role="tab" type="button" />
          ))}
        </div>
      ) : null}
    </section>
  );
}
