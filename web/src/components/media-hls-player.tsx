"use client";

import type Hls from "hls.js";
import type { HlsConfig } from "hls.js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { NebulaPlayer, type PlayerStatus, type TrackOption } from "@/components/nebula-player";
import { completeSignOut } from "@/lib/auth/sign-out-client";
import { getDriveWorker, sendDriveToken, workerControlsPage } from "@/lib/media/drive-worker";
import { readLocalProgress, resumePoint, writeLocalProgress } from "@/lib/media/local-progress";
import { shiftSubtitleCues } from "@/lib/media/subtitle-time";

const stageLabels = ["Verificando tu acceso", "Preparando el canal seguro", "Leyendo el índice del vídeo", "Cargando los primeros segundos"];

// Pensado para conexiones lentas o inestables: arranca con una estimación
// prudente, limita la calidad al tamaño real del reproductor y reintenta los
// fragmentos antes de rendirse.
const slowNetworkConfig: Partial<HlsConfig> = {
  abrEwmaDefaultEstimate: 1_500_000,
  backBufferLength: 60,
  capLevelToPlayerSize: true,
  enableWorker: true,
  fragLoadPolicy: {
    default: {
      errorRetry: { maxNumRetry: 4, maxRetryDelayMs: 8000, retryDelayMs: 800 },
      maxLoadTimeMs: 90_000,
      maxTimeToFirstByteMs: 20_000,
      timeoutRetry: { maxNumRetry: 3, maxRetryDelayMs: 0, retryDelayMs: 0 },
    },
  },
  maxBufferLength: 30,
  maxBufferSize: 60 * 1000 * 1000,
  maxMaxBufferLength: 120,
  startFragPrefetch: true,
  startLevel: -1,
  testBandwidth: true,
};

function languageLabel(name: string | undefined, lang: string | undefined, index: number) {
  const value = `${name ?? ""} ${lang ?? ""}`.toLowerCase();
  if (value.includes("spa") || value.includes("españ") || value.includes("spanish") || /\bes\b/.test(value)) return "Español";
  if (value.includes("eng") || value.includes("ingl") || value.includes("english") || /\ben\b/.test(value)) return "English";
  if (value.includes("jpn") || value.includes("japan") || /\bja\b/.test(value)) return "日本語";
  return name || lang || `Pista ${index + 1}`;
}

type Props = {
  backHref: string;
  backdrop?: string | null;
  badges?: string[];
  module: "movies" | "series";
  next?: { packageId: string; title: string } | null;
  packageId: string;
  subtitle?: string;
  title?: string;
};

export function MediaHlsPlayer({ backHref, backdrop, badges, module, next, packageId, subtitle, title = "Tu próxima historia" }: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const originalCueTimesRef = useRef(new WeakMap<TextTrackCue, { endTime: number; startTime: number }>());
  const subtitleDelayRef = useRef(0);
  const lastSavedRef = useRef(0);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [forceProxy, setForceProxy] = useState(false);
  const [resumeAt, setResumeAt] = useState(0);
  const [audioTracks, setAudioTracks] = useState<TrackOption[]>([]);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [subtitles, setSubtitles] = useState<TrackOption[]>([]);
  const [subtitle_, setSubtitle] = useState(-1);
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [qualities, setQualities] = useState<TrackOption[]>([]);
  const [quality, setQuality] = useState(-1);
  const [autoLevelLabel, setAutoLevelLabel] = useState("");
  // Un reintento o el cambio a proxy montan un reproductor nuevo: la reanudación vuelve a aplicarse.
  const playerKey = `${packageId}:${attempt}:${forceProxy ? "proxy" : "auto"}`;

  useEffect(() => {
    let disposed = false;
    let hlsInstance: Hls | null = null;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    let directFailures = 0;

    async function prepare() {
      setStatus("loading");
      setStage(0);
      setError("");
      setAudioTracks([]); setSubtitles([]); setQualities([]); setQuality(-1); setSubtitle(-1);
      originalCueTimesRef.current = new WeakMap();
      setResumeAt(resumePoint(readLocalProgress(packageId)));
      try {
        // Token, worker y la librería HLS se preparan en paralelo. El token
        // también renueva la cookie HttpOnly que usa la ruta de respaldo.
        const [tokenResponse, worker, HlsModule] = await Promise.all([
          fetch(`/api/drive-token?force=1&module=${module}`, { cache: "no-store", credentials: "same-origin" }),
          getDriveWorker().catch(() => null),
          import("hls.js"),
        ]);
        if (disposed) return;
        if (tokenResponse.status === 401) { setStatus("needs-auth"); return; }
        if (!tokenResponse.ok) {
          const body = await tokenResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || "No se pudo autorizar la reproducción con Google Drive.");
        }
        const { accessToken } = await tokenResponse.json() as { accessToken?: string };
        setStage(1);
        const HlsClass = HlsModule.default;
        const canUseMse = HlsClass.isSupported();
        if (worker && accessToken) await sendDriveToken(worker, accessToken, module);
        // Entrega directa (navegador → Google) solo si el worker controla la
        // página y hls.js hace las peticiones; si no, respaldo por el servidor.
        const direct = canUseMse && !forceProxy && Boolean(worker) && workerControlsPage();
        const video = videoRef.current;
        if (!video || disposed) return;
        const manifestUrl = `/api/media-hls/packages/${packageId}/manifest?hls-route=drive-cookie-v3${direct ? "&delivery=direct" : ""}`;
        setStage(2);

        if (canUseMse) {
          const instance = new HlsClass(slowNetworkConfig);
          hlsInstance = instance;
          hlsRef.current = instance;
          const Events = HlsClass.Events;
          const refreshTracks = () => {
            if (disposed) return;
            setAudioTracks(instance.audioTracks.map((track, index) => ({ label: languageLabel(track.name, track.lang, index), value: index })));
            setAudioTrack(instance.audioTrack);
          };
          instance.on(Events.AUDIO_TRACKS_UPDATED, refreshTracks);
          instance.on(Events.AUDIO_TRACK_SWITCHED, refreshTracks);
          instance.on(Events.SUBTITLE_TRACKS_UPDATED, () => {
            if (!disposed) setSubtitles(instance.subtitleTracks.map((track, index) => ({ label: languageLabel(track.name, track.lang, index), value: index })));
          });
          instance.on(Events.SUBTITLE_TRACK_SWITCH, () => { if (!disposed) setSubtitle(instance.subtitleTrack); });
          instance.on(Events.SUBTITLE_FRAG_PROCESSED, () => {
            window.requestAnimationFrame(() => {
              if (!disposed && video.textTracks) shiftSubtitleCues(video.textTracks, subtitleDelayRef.current, originalCueTimesRef.current);
            });
          });
          instance.on(Events.MANIFEST_PARSED, () => {
            if (disposed) return;
            setStage(3);
            const levels = instance.levels.map((level, index) => ({ height: level.height, index }));
            setQualities(levels.sort((a, b) => b.height - a.height).map((level) => ({ label: level.height ? `${level.height}p` : `Variante ${level.index + 1}`, value: level.index })));
          });
          instance.on(Events.LEVEL_SWITCHED, (_event, data) => {
            const level = instance.levels[data.level];
            if (!disposed && level?.height) setAutoLevelLabel(`${level.height}p`);
          });
          instance.on(Events.FRAG_BUFFERED, () => { if (!disposed) setStatus((current) => (current === "loading" ? "ready" : current)); });
          instance.on(Events.ERROR, (_event, data) => {
            if (!data.fatal || disposed) return;
            const code = typeof data.response?.code === "number" ? data.response.code : 0;
            if (code === 401) { setStatus("needs-auth"); return; }
            if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
              mediaRecoveries += 1;
              if (mediaRecoveries === 2) instance.swapAudioCodec();
              instance.recoverMediaError();
              return;
            }
            if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
              if (direct && data.details === HlsClass.ErrorDetails.FRAG_LOAD_ERROR && ++directFailures >= 2) {
                // Si la vía directa falla de forma repetida se cambia al proxy sin perder la posición.
                setForceProxy(true);
                return;
              }
              if (networkRecoveries < 3) {
                networkRecoveries += 1;
                window.setTimeout(() => { if (!disposed) instance.startLoad(); }, 1000 * networkRecoveries);
                return;
              }
            }
            const httpStatus = code ? ` · HTTP ${code}` : "";
            setError(`La reproducción se interrumpió (${data.details}${httpStatus}). Revisa tu conexión y vuelve a intentarlo.`);
            setStatus("error");
          });
          instance.loadSource(manifestUrl);
          instance.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // Safari nativo (iPhone antiguo): sus peticiones de vídeo no pasan por el worker.
          video.src = manifestUrl;
          video.addEventListener("loadedmetadata", () => { if (!disposed) setStatus("ready"); }, { once: true });
        } else {
          throw new Error("Este navegador no admite reproducción HLS.");
        }
      } catch (caught) {
        if (!disposed) { setError(caught instanceof Error ? caught.message : "No se pudo preparar el reproductor."); setStatus("error"); }
      }
    }
    void prepare();
    const mountedVideo = videoRef.current;
    return () => {
      disposed = true;
      const video = mountedVideo;
      if (video && Number.isFinite(video.duration) && video.currentTime > 5) writeLocalProgress(packageId, video.currentTime, video.duration);
      hlsInstance?.destroy();
      if (hlsRef.current === hlsInstance) hlsRef.current = null;
    };
  }, [attempt, forceProxy, module, packageId]);

  // Si el primer fragmento ya está listo antes que el evento de hls.js (Safari), se marca listo igual.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onReady = () => setStatus((current) => (current === "loading" ? "ready" : current));
    video.addEventListener("canplay", onReady);
    return () => video.removeEventListener("canplay", onReady);
  }, [playerKey]);

  // Progreso local cada 5 s, al pausar y al abandonar la página.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const save = () => { if (Number.isFinite(video.duration) && video.currentTime > 5) writeLocalProgress(packageId, video.currentTime, video.duration); };
    const onTime = () => {
      const now = Date.now();
      if (now - lastSavedRef.current > 5000) { lastSavedRef.current = now; save(); }
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("pause", save);
    video.addEventListener("ended", save);
    window.addEventListener("pagehide", save);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", save);
      video.removeEventListener("ended", save);
      window.removeEventListener("pagehide", save);
    };
  }, [packageId, playerKey]);

  const playNext = useCallback(() => { if (next) router.push(`/media-player?package=${next.packageId}`); }, [next, router]);

  return (
    <NebulaPlayer
      audio={{ onChange: (value) => { if (hlsRef.current) hlsRef.current.audioTrack = value; setAudioTrack(value); }, options: audioTracks, value: audioTrack }}
      autoPlay
      backHref={backHref}
      backdrop={backdrop}
      badges={badges}
      captionDelay={{ onChange: (value) => { subtitleDelayRef.current = value; setSubtitleDelay(value); const video = videoRef.current; if (video) shiftSubtitleCues(video.textTracks, value, originalCueTimesRef.current); }, value: subtitleDelay }}
      captions={{ onChange: (value) => { if (hlsRef.current) { hlsRef.current.subtitleTrack = value; hlsRef.current.subtitleDisplay = value >= 0; } setSubtitle(value); }, options: subtitles, value: subtitle_ }}
      error={error}
      key={playerKey}
      nextLabel={next ? `Siguiente: ${next.title}` : undefined}
      onNext={next ? playNext : undefined}
      onReauthorize={() => void completeSignOut()}
      onRetry={() => setAttempt((value) => value + 1)}
      preload="metadata"
      quality={{ autoLabel: autoLevelLabel, onChange: (value) => { if (hlsRef.current) hlsRef.current.currentLevel = value; setQuality(value); }, options: qualities, value: quality }}
      resumeAt={resumeAt}
      stage={{ index: stage, labels: stageLabels }}
      status={status}
      subtitle={subtitle}
      title={title}
      upNext={next ? { onPlay: playNext, title: next.title } : null}
      videoRef={videoRef}
    />
  );
}
