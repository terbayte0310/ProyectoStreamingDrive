"use client";

import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";

type PlayerState = "error" | "loading" | "needs-drive" | "ready";
const workerRevision = "media-hls-v1";

async function getDriveWorker() {
  const registration = await navigator.serviceWorker.register(`/sw.js?revision=${workerRevision}`, { scope: "/" });
  if (registration.active?.scriptURL.includes(`revision=${workerRevision}`)) return registration.active;
  const pending = registration.installing ?? registration.waiting;
  if (!pending) throw new Error("No se pudo actualizar el reproductor de Drive. Recarga normalmente.");
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("La actualización de Drive tardó demasiado.")), 5000);
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") { window.clearTimeout(timeout); resolve(); }
      if (pending.state === "redundant") { window.clearTimeout(timeout); reject(new Error("No se pudo activar el reproductor de Drive.")); }
    });
  });
  if (!registration.active?.scriptURL.includes(`revision=${workerRevision}`)) throw new Error("El reproductor de Drive no se actualizó. Recarga normalmente.");
  return registration.active;
}

function languageLabel(name: string | undefined, lang: string | undefined, index: number) {
  const value = `${name ?? ""} ${lang ?? ""}`.toLowerCase();
  if (value.includes("spa") || value.includes("españ") || value.includes("spanish")) return "Español";
  if (value.includes("eng") || value.includes("ingl") || value.includes("english")) return "English";
  return name || lang || `Pista ${index + 1}`;
}

export function MediaHlsPlayer({ module, packageId }: { module: "movies" | "series"; packageId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [state, setState] = useState<PlayerState>("loading");
  const [error, setError] = useState("");
  const [audioTracks, setAudioTracks] = useState<Array<{ index: number; label: string }>>([]);
  const [audioTrack, setAudioTrack] = useState(-1);

  useEffect(() => {
    let disposed = false;
    let hlsInstance: Hls | null = null;
    async function prepare() {
      setState("loading");
      setError("");
      try {
        const worker = await getDriveWorker();
        const tokenResponse = await fetch(`/api/drive-token?module=${module}`, { cache: "no-store" });
        if (tokenResponse.status === 401) { if (!disposed) setState("needs-drive"); return; }
        if (!tokenResponse.ok) throw new Error("No se pudo autorizar la reproducción.");
        const { accessToken } = await tokenResponse.json() as { accessToken: string };
        worker.postMessage({ module, token: accessToken, type: "drive-access-token" });
        const video = videoRef.current;
        if (!video) throw new Error("No se pudo preparar el reproductor.");
        const manifestUrl = `/api/media-hls/packages/${packageId}/manifest`;
        const Hls = (await import("hls.js")).default;
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
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal && !disposed) setError("La reproducción HLS se interrumpió. Comprueba que el paquete esté completo.");
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
  }, [module, packageId]);

  return <>
    {state === "loading" ? <div className="status-card">Preparando una reproducción segura desde Drive…</div> : null}
    {state === "needs-drive" ? <div className="status-card">Debes volver a iniciar sesión para autorizar Google Drive.</div> : null}
    {state === "error" ? <div className="status-card text-rose-500">{error}</div> : null}
    <div className={state === "ready" ? "video-shell" : "hidden"}><video controls playsInline preload="metadata" ref={videoRef} /></div>
    {state === "ready" && audioTracks.length > 1 ? <label className="mt-4 flex max-w-xs flex-col gap-1 text-sm font-medium">Audio<select className="admin-input rounded-lg border px-3 py-2" onChange={(event) => { const next = Number(event.target.value); if (hlsRef.current) hlsRef.current.audioTrack = next; setAudioTrack(next); }} value={audioTrack}>{audioTracks.map((track) => <option key={track.index} value={track.index}>{track.label}</option>)}</select></label> : null}
    {state === "ready" && !audioTracks.length ? <p className="mt-3 text-sm text-slate-500">En Safari, el idioma se cambia desde el control de pistas del reproductor.</p> : null}
  </>;
}
