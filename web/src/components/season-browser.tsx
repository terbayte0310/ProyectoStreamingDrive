"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import { IntentLink } from "@/components/intent-link";
import { tmdbImage } from "@/components/media-catalog";
import { isFinished, type LocalProgress, progressRatio, readLocalProgress } from "@/lib/media/local-progress";

export type EpisodeView = { id: string; number: number; overview: string | null; packageId: string | null; runtime: number | null; stillPath: string | null; title: string };
export type SeasonView = { episodes: EpisodeView[]; id: string; number: number; overview: string | null; title: string };

function useProgressMap(seasons: SeasonView[]) {
  const [progress, setProgress] = useState<Map<string, LocalProgress>>(new Map());
  useEffect(() => {
    const next = new Map<string, LocalProgress>();
    for (const season of seasons) for (const episode of season.episodes) {
      if (!episode.packageId) continue;
      const value = readLocalProgress(episode.packageId);
      if (value) next.set(episode.packageId, value);
    }
    // Lectura única de localStorage tras montar: evita desajustes de hidratación.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(next);
  }, [seasons]);
  return progress;
}

function episodeCode(season: SeasonView, episode: EpisodeView) {
  return `T${season.number}:E${episode.number}`;
}

/** Botón principal: continúa el último episodio empezado o el siguiente pendiente. */
export function SeriesPlayButton({ seasons }: { seasons: SeasonView[] }) {
  const progress = useProgressMap(seasons);
  const target = useMemo(() => {
    const playable = seasons.flatMap((season) => season.episodes.filter((episode) => episode.packageId).map((episode) => ({ episode, season })));
    if (!playable.length) return null;
    let latestIndex = -1;
    let latestAt = 0;
    playable.forEach(({ episode }, index) => {
      const value = progress.get(episode.packageId!);
      if (value && value.at > latestAt) { latestAt = value.at; latestIndex = index; }
    });
    if (latestIndex < 0) return { ...playable[0], label: "Reproducir" };
    const latest = playable[latestIndex];
    if (!isFinished(progress.get(latest.episode.packageId!) ?? null)) return { ...latest, label: "Continuar" };
    const next = playable[latestIndex + 1];
    return next ? { ...next, label: "Siguiente" } : { ...latest, label: "Volver a ver" };
  }, [progress, seasons]);

  if (!target) return <span aria-disabled="true" className="btn btn-glass btn-lg"><Icon name="info" />Aún no hay episodios listos</span>;
  return (
    <Link className="btn btn-primary btn-lg" href={`/media-player?package=${target.episode.packageId}`} prefetch transitionTypes={["nav-forward"]}>
      <Icon name="play" />{target.label} {episodeCode(target.season, target.episode)}
    </Link>
  );
}

export function SeasonBrowser({ seasons }: { seasons: SeasonView[] }) {
  const [activeId, setActiveId] = useState(seasons[0]?.id);
  const progress = useProgressMap(seasons);
  const season = seasons.find((item) => item.id === activeId) ?? seasons[0];
  if (!season) return null;

  return (
    <section aria-labelledby="seasons-title" className="seasons section">
      <div className="section-head">
        <div>
          <p className="kicker">Episodios</p>
          <h2 className="title-l" id="seasons-title">{season.title}</h2>
        </div>
      </div>
      {seasons.length > 1 ? (
        <div aria-label="Temporadas" className="season-tabs" role="tablist">
          {seasons.map((item) => (
            <button aria-selected={item.id === season.id} className={`chip${item.id === season.id ? " chip-active" : ""}`} key={item.id} onClick={() => setActiveId(item.id)} role="tab" type="button">
              Temporada {item.number} <span className="chip-count">{item.episodes.length}</span>
            </button>
          ))}
        </div>
      ) : null}
      {season.overview ? <p className="season-summary">{season.overview}</p> : null}
      <ol className="episode-list" key={season.id}>
        {season.episodes.map((episode, index) => {
          const value = episode.packageId ? progress.get(episode.packageId) ?? null : null;
          const ratio = progressRatio(value);
          const still = tmdbImage(episode.stillPath, "w342");
          return (
            <li className={`episode${episode.packageId ? "" : " episode-unavailable"}`} key={episode.id} style={{ "--i": index } as CSSProperties}>
              <span aria-hidden="true" className="episode-num">{String(episode.number).padStart(2, "0")}</span>
              <div className="episode-still">
                {/* eslint-disable-next-line @next/next/no-img-element -- CDN de TMDB con tamaño fijo. */}
                {still ? <img alt="" decoding="async" loading="lazy" src={still} /> : <span className="episode-still-fallback"><Icon name="film" /></span>}
                {ratio > 0 ? <span className="meter" style={{ position: "absolute", right: 6, bottom: 6, left: 6, color: "#fff" }}><span style={{ width: `${ratio * 100}%` }} /></span> : null}
              </div>
              <div className="episode-body">
                <strong>{episode.title}</strong>
                <span className="mono subtle" style={{ fontSize: "0.72rem" }}>
                  {episodeCode(season, episode)}{episode.runtime ? ` · ${episode.runtime} min` : ""}{isFinished(value) ? " · Visto" : ratio > 0 ? " · En curso" : ""}{episode.packageId ? "" : " · Próximamente"}
                </span>
                {episode.overview ? <p>{episode.overview}</p> : null}
              </div>
              {episode.packageId ? (
                <>
                  <span aria-hidden="true" className="episode-play"><Icon name="play" /></span>
                  <IntentLink aria-label={`Reproducir ${episodeCode(season, episode)}: ${episode.title}`} className="episode-link" dwellPrefetch href={`/media-player?package=${episode.packageId}`} transitionTypes={["nav-forward"]} />
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!season.episodes.length ? <p className="muted">Todavía no hay episodios publicados en esta temporada.</p> : null}
    </section>
  );
}
