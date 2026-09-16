"use client";

import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { CinemaPlayer } from "@/components/cinema-player";
import { completeSignOut } from "@/lib/auth/sign-out-client";
import { shiftSubtitleCues } from "@/lib/media/subtitle-time";

type PlayerState = "error" | "loading" | "needs-drive" | "ready";

function languageLabel(name: string | undefined, lang: string | undefined, index: number) {
  const value = `${name ?? ""} ${lang ?? ""}`.toLowerCase();
  if (value.includes("spa") || value.includes("españ") || value.includes("spanish")) return "Español";
  if (value.includes("eng") || value.includes("ingl") || value.includes("english")) return "English";
  return name || lang || `Pista ${index + 1}`;
}

export function MediaHlsPlayer({ module, packageId, title = "Tu próxima historia" }: { module: "movies" | "series"; packageId: string; title?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const originalCueTimesRef = useRef(new WeakMap<TextTrackCue, { endTime: number; startTime: number }>());
  const subtitleDelayRef = useRef(0);
  const [state, setState] = useState<PlayerState>("loading");
  const [error, setError] = useState("");
  const [audioTracks, setAudioTracks] = useState<Array<{ index: number; label: string }>>([]);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [subtitles, setSubtitles] = useState<Array<{ index: number; label: string }>>([]);
  const [subtitle, setSubtitle] = useState(-1);
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [qualities, setQualities] = useState<Array<{ index: number; label: string }>>([]);
  const [quality, setQuality] = useState(-1);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let hlsInstance: Hls | null = null;
    async function prepare() {
      setState("loading");
      setError("");
      setAudioTracks([]); setSubtitles([]); setQualities([]); setQuality(-1); setSubtitle(-1);
      originalCueTimesRef.current = new WeakMap();
      try {
        // Refresh once before hls.js starts its parallel playlist/segment loads.
        // The resulting HttpOnly cookie is then available to every scoped HLS URL.
        const tokenResponse = await fetch(`/api/drive-token?force=1&module=${module}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (tokenResponse.status === 401) {
          if (!disposed) setState("needs-drive");
          return;
        }
        if (!tokenResponse.ok) {
          const body = await tokenResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || "No se pudo autorizar la reproducción con Google Drive.");
        }
        const video = videoRef.current;
        if (!video) throw new Error("No se pudo preparar el reproductor.");
        const manifestUrl = `/api/media-hls/packages/${packageId}/manifest?hls-route=drive-cookie-v3`;
        const Hls = (await import("hls.js")).default;
        if (disposed) return;
        if (Hls.isSupported()) {
          const instance = new Hls({ enableWorker: true });
          hlsInstance = instance;
          hlsRef.current = instance;
          const refreshTracks = () => {
            if (disposed) return;
            setAudioTracks(instance.audioTracks.map((track, index) => ({ index, label: languageLabel(track.name, track.lang, index) })));
            setAudioTrack(instance.audioTrack);
          };
          instance.on(Hls.Events.AUDIO_TRACKS_UPDATED, refreshTracks);
          instance.on(Hls.Events.AUDIO_TRACK_SWITCHED, refreshTracks);
          instance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
            if (!disposed) setSubtitles(instance.subtitleTracks.map((track, index) => ({ index, label: languageLabel(track.name, track.lang, index) })));
          });
          instance.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => { if (!disposed) setSubtitle(instance.subtitleTrack); });
          instance.on(Hls.Events.SUBTITLE_FRAG_PROCESSED, () => {
            window.requestAnimationFrame(() => {
              if (!disposed && video.textTracks) {
                shiftSubtitleCues(video.textTracks, subtitleDelayRef.current, originalCueTimesRef.current);
              }
            });
          });
          instance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!disposed) setQualities(instance.levels.map((level, index) => ({ index, label: level.height ? `${level.height}p` : `Variante ${index + 1}` })));
          });
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || disposed) return;
            const httpStatus = typeof data.response?.code === "number" ? ` · HTTP ${data.response.code}` : "";
            const failedPath = typeof data.url === "string" ? ` · ${new URL(data.url, window.location.origin).pathname}` : "";
            setError(`La reproducción se interrumpió (${data.type} · ${data.details}${httpStatus}${failedPath}).`);
            setState("error");
          });
          instance.loadSource(manifestUrl);
          instance.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = manifestUrl;
        } else {
          throw new Error("Este navegador no admite reproducción HLS.");
        }
        if (!disposed) setState("ready");
      } catch (caught) {
        if (!disposed) { setError(caught instanceof Error ? caught.message : "No se pudo preparar el reproductor."); setState("error"); }
      }
    }
    void prepare();
    return () => { disposed = true; hlsInstance?.destroy(); if (hlsRef.current === hlsInstance) hlsRef.current = null; };
  }, [module, packageId, attempt]);

  return <>
    {state === "loading" ? <div className="status-card" role="status">Preparando tu vídeo…</div> : null}
    {state === "needs-drive" ? <div className="status-card" role="alert"><p>La autorización de Google Drive venció o no está disponible.</p><button className="secondary-button mt-4" type="button" onClick={() => void completeSignOut()}>Volver a iniciar sesión</button></div> : null}
    {state === "error" ? <div className="status-card" role="alert"><p>{error}</p><button className="secondary-button mt-4" type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar reproducción</button></div> : null}
    <div className={state === "ready" ? "video-shell" : "hidden"}><CinemaPlayer title={title} preload="metadata" videoRef={videoRef} settings={<>{audioTracks.length > 1 ? <label>Audio<select onChange={(event) => { const next = Number(event.target.value); if (hlsRef.current) hlsRef.current.audioTrack = next; setAudioTrack(next); }} value={audioTrack}>{audioTracks.map((track) => <option key={track.index} value={track.index}>{track.label}</option>)}</select></label> : <p>Las pistas disponibles dependen del vídeo. En Safari puedes usar los controles del navegador para cambiar el audio.</p>}
      {subtitles.length ? <label>Subtítulos<select aria-label="Subtítulos" value={subtitle} onChange={event => { const value = Number(event.target.value); if (hlsRef.current) hlsRef.current.subtitleTrack = value; setSubtitle(value); }}><option value={-1}>Desactivados</option>{subtitles.map(track => <option key={track.index} value={track.index}>{track.label}</option>)}</select></label> : null}
      {subtitles.length ? <label>Sincronización de subtítulos <span>{subtitleDelay > 0 ? `+${subtitleDelay.toFixed(1)} s` : `${subtitleDelay.toFixed(1)} s`}</span><input aria-label="Sincronización de subtítulos" type="range" min={-10} max={10} step={0.5} value={subtitleDelay} onChange={event => { const value = Number(event.target.value); subtitleDelayRef.current = value; setSubtitleDelay(value); const video = videoRef.current; if (video) shiftSubtitleCues(video.textTracks, value, originalCueTimesRef.current); }} /><small>Negativo adelanta · positivo retrasa</small></label> : null}
      {qualities.length > 1 ? <label>Calidad<select aria-label="Calidad" value={quality} onChange={event => { const value = Number(event.target.value); if (hlsRef.current) hlsRef.current.currentLevel = value; setQuality(value); }}><option value={-1}>Automática</option>{qualities.map(level => <option key={level.index} value={level.index}>{level.label}</option>)}</select></label> : null}
    </>} /></div>
  </>;
}
