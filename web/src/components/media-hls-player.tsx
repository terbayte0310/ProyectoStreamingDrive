"use client";

import type Hls from "hls.js";
import type { HlsConfig } from "hls.js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { NebulaPlayer, type PlayerStatus, type TrackOption } from "@/components/nebula-player";
import { completeSignOut } from "@/lib/auth/sign-out-client";
import { getDriveWorker, sendDriveToken, workerControlsPage } from "@/lib/media/drive-worker";
import { readLocalProgress, resumePoint, writeLocalProgress } from "@/lib/media/local-progress";
import { deviceSnapshot, flushPlayerEvents, reportPlayerEvent, takeUncleanMarker, writePlayerMarker } from "@/lib/media/player-telemetry";
import { shiftSubtitleCues } from "@/lib/media/subtitle-time";

const stageLabels = ["Verificando tu acceso", "Preparando el canal seguro", "Leyendo el índice del vídeo", "Cargando los primeros segundos"];

// Pensado para conexiones lentas o inestables: arranca con una estimación
// prudente, limita la calidad al tamaño real del reproductor y reintenta los
// fragmentos antes de rendirse.
const slowNetworkConfig: Partial<HlsConfig> = {
  abrEwmaDefaultEstimate: 1_500_000,
  backBufferLength: 60,
  capLevelToPlayerSize: true,
  // Los subtítulos los carga el reproductor una sola vez (ver selectSubtitle):
  // sin el controlador de fragmentos ni el de línea de tiempo, hls.js solo lista
  // las pistas (enableWebVTT las deja visibles) y no vuelve a pedir ni analizar el
  // archivo, que el manifiesto declara como un fragmento de 24 h.
  enableCEA708Captions: false,
  enableIMSC1: false,
  enableWebVTT: true,
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
  renderTextTracksNatively: false,
  startFragPrefetch: true,
  startLevel: -1,
  subtitleStreamController: undefined,
  testBandwidth: true,
  timelineController: undefined,
};

// iPhone y iPad (también con Chrome, que usa el motor de Safari) matan la
// página cuando pasa de cierta memoria: se mantiene menos vídeo en el búfer.
const appleTouchConfig: Partial<HlsConfig> = {
  backBufferLength: 20,
  capLevelOnFPSDrop: true,
  maxBufferLength: 20,
  maxBufferSize: 30 * 1000 * 1000,
  maxMaxBufferLength: 40,
};

function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

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
  backdropMorphId?: string;
  badges?: string[];
  module: "movies" | "series";
  next?: { packageId: string; title: string } | null;
  packageId: string;
  subtitle?: string;
  title?: string;
};

export function MediaHlsPlayer({ backHref, backdrop, backdropMorphId, badges, module, next, packageId, subtitle, title = "Tu próxima historia" }: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const originalCueTimesRef = useRef(new WeakMap<TextTrackCue, { endTime: number; startTime: number }>());
  const subtitleDelayRef = useRef(0);
  const lastSavedRef = useRef(0);
  const subtitleInfoRef = useRef<Array<{ label: string; lang: string; url: string }>>([]);
  const subtitleElementsRef = useRef(new Map<number, { element: HTMLTrackElement; objectUrl: string }>());
  const subtitleRequestRef = useRef(0);
  const statsRef = useRef({ frags: 0, hlsErrors: 0, stalls: 0, waits: 0 });
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

  const report = useCallback((event: string, detail: Record<string, boolean | number | string | null | undefined> = {}) => {
    reportPlayerEvent(packageId, event, detail);
  }, [packageId]);

  /** Una sola descarga por idioma; el navegador analiza el archivo una vez y lo muestra como pista nativa. */
  const selectSubtitle = useCallback(async (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const request = ++subtitleRequestRef.current;
    setSubtitle(value);
    subtitleElementsRef.current.forEach(({ element }) => { element.track.mode = "disabled"; });
    if (value < 0) return;
    let entry = subtitleElementsRef.current.get(value);
    if (!entry) {
      const info = subtitleInfoRef.current[value];
      if (!info) return;
      try {
        const source = new URL(info.url, window.location.href);
        source.search = "";
        const response = await fetch(source, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (request !== subtitleRequestRef.current || !videoRef.current) return;
        const objectUrl = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        const element = document.createElement("track");
        element.kind = "subtitles";
        element.label = info.label;
        element.srclang = info.lang || "es";
        element.src = objectUrl;
        element.addEventListener("load", () => shiftSubtitleCues([element.track], subtitleDelayRef.current, originalCueTimesRef.current));
        videoRef.current.appendChild(element);
        entry = { element, objectUrl };
        subtitleElementsRef.current.set(value, entry);
      } catch (caught) {
        setSubtitle(-1);
        report("subtitle-failed", { message: caught instanceof Error ? caught.message.slice(0, 80) : "error" });
        return;
      }
    }
    if (request === subtitleRequestRef.current) entry.element.track.mode = "showing";
  }, [report]);

  /** Renueva el permiso de Drive sin cerrar la sesión de Nébula. */
  const silentReauth = useCallback(async () => {
    try {
      const response = await fetch(`/api/drive-token?force=1&module=${module}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) { report("silent-reauth-failed", { status: response.status }); return false; }
      const { accessToken } = await response.json() as { accessToken?: string };
      const worker = await getDriveWorker().catch(() => null);
      if (worker && accessToken) await sendDriveToken(worker, accessToken, module);
      report("silent-reauth-ok");
      return Boolean(accessToken);
    } catch {
      report("silent-reauth-failed", { status: 0 });
      return false;
    }
  }, [module, report]);

  useEffect(() => {
    let disposed = false;
    let hlsInstance: Hls | null = null;
    let authRecoveries = 0;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    let directFailures = 0;

    async function prepare() {
      setStatus("loading");
      setStage(0);
      setError("");
      setAudioTracks([]); setSubtitles([]); setQualities([]); setQuality(-1); setSubtitle(-1);
      originalCueTimesRef.current = new WeakMap();
      subtitleInfoRef.current = [];
      setResumeAt(resumePoint(readLocalProgress(packageId)));
      try {
        // Token, worker y la librería HLS se preparan en paralelo. El token
        // también renueva la cookie HttpOnly que usa la ruta de respaldo.
        const [tokenResponse, worker, HlsModule] = await Promise.all([
          fetch(`/api/drive-token?module=${module}`, { cache: "no-store", credentials: "same-origin" }),
          getDriveWorker().catch(() => null),
          import("hls.js"),
        ]);
        if (disposed) return;
        if (tokenResponse.status === 401) {
          // Un 401 aislado no debe pedir contraseña: se reintenta una vez antes de rendirse.
          report("token-401", { retry: authRecoveries });
          if (authRecoveries < 1) {
            authRecoveries += 1;
            window.setTimeout(() => { if (!disposed) void prepare(); }, 1500);
            return;
          }
          setStatus("needs-auth");
          return;
        }
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
          const appleTouch = isAppleTouchDevice();
          const instance = new HlsClass(appleTouch ? { ...slowNetworkConfig, ...appleTouchConfig } : slowNetworkConfig);
          report("session-start", { ...deviceSnapshot(), apple: appleTouch, mode: direct ? "direct" : "proxy" });
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
            if (disposed) return;
            subtitleInfoRef.current = instance.subtitleTracks.map((track, index) => ({ label: languageLabel(track.name, track.lang, index), lang: track.lang ?? "", url: track.url }));
            setSubtitles(subtitleInfoRef.current.map((info, index) => ({ label: info.label, value: index })));
          });
          // Si el manifiesto marca una pista por defecto, se muestra con la misma vía nativa.
          instance.on(Events.SUBTITLE_TRACK_SWITCH, () => { if (!disposed && instance.subtitleTrack >= 0) void selectSubtitle(instance.subtitleTrack); });
          instance.on(Events.FRAG_LOADED, () => { statsRef.current.frags += 1; });
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
            const code = typeof data.response?.code === "number" ? data.response.code : 0;
            if (!data.fatal) { statsRef.current.hlsErrors += 1; return; }
            if (disposed) return;
            report("hls-fatal", { code, details: data.details, type: data.type });
            if (code === 401) {
              // El permiso de Drive caducó: se renueva en silencio antes de pedir sesión.
              if (authRecoveries < 2) {
                authRecoveries += 1;
                void silentReauth().then((renewed) => {
                  if (disposed) return;
                  if (renewed) instance.startLoad(videoRef.current?.currentTime ?? -1);
                  else setStatus("needs-auth");
                });
                return;
              }
              setStatus("needs-auth");
              return;
            }
            if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
              mediaRecoveries += 1;
              if (mediaRecoveries === 2) instance.swapAudioCodec();
              instance.recoverMediaError();
              return;
            }
            if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
              if (direct && data.details === HlsClass.ErrorDetails.FRAG_LOAD_ERROR && ++directFailures >= 2) {
                // Si la vía directa falla de forma repetida se cambia al proxy sin perder la posición.
                report("force-proxy", { failures: directFailures });
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
  }, [attempt, forceProxy, module, packageId, report, selectSubtitle, silentReauth]);

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

  // Diagnóstico: latido por minuto, esperas del vídeo y detección de páginas que
  // el sistema mató sin avisar (típico de iPad con poca memoria).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stats = statsRef.current;
    const previous = takeUncleanMarker();
    if (previous) report("unclean-restart", { gapSeconds: Math.round((Date.now() - previous.ts) / 1000), lastTime: Math.round(previous.currentTime), samePackage: previous.packageId === packageId });
    const onWaiting = () => { stats.waits += 1; };
    const onStalled = () => { stats.stalls += 1; };
    const onVideoError = () => report("video-error", { code: video.error?.code, message: video.error?.message?.slice(0, 80) });
    const onVisibility = () => report("visibility", { state: document.visibilityState, t: Math.round(video.currentTime) });
    const bufferedAhead = () => {
      for (let index = 0; index < video.buffered.length; index += 1) {
        if (video.currentTime >= video.buffered.start(index) && video.currentTime <= video.buffered.end(index)) return Math.round(video.buffered.end(index) - video.currentTime);
      }
      return 0;
    };
    const marker = (clean: boolean) => writePlayerMarker({ clean, currentTime: video.currentTime, packageId, ts: Date.now() });
    const beat = window.setInterval(() => {
      const quality = video.getVideoPlaybackQuality?.();
      report("beat", {
        ahead: bufferedAhead(),
        dropped: quality?.droppedVideoFrames,
        errors: stats.hlsErrors,
        frags: stats.frags,
        paused: video.paused,
        rs: video.readyState,
        stalls: stats.stalls,
        t: Math.round(video.currentTime),
        visible: document.visibilityState === "visible",
        waits: stats.waits,
      });
      stats.frags = 0; stats.hlsErrors = 0; stats.stalls = 0; stats.waits = 0;
      marker(false);
    }, 60_000);
    const onPageHide = () => { marker(true); flushPlayerEvents(true); };
    marker(false);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("error", onVideoError);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(beat);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("error", onVideoError);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      marker(true);
      flushPlayerEvents();
    };
  }, [packageId, playerKey, report]);

  // Las pistas de subtítulos y sus URL temporales pertenecen a este reproductor.
  useEffect(() => {
    const elements = subtitleElementsRef.current;
    return () => {
      elements.forEach(({ element, objectUrl }) => { element.remove(); URL.revokeObjectURL(objectUrl); });
      elements.clear();
    };
  }, [playerKey]);

  const reauthorize = useCallback(async () => {
    report("reauthorize-click");
    if (await silentReauth()) setAttempt((value) => value + 1);
    else await completeSignOut();
  }, [report, silentReauth]);

  const playNext = useCallback(() => { if (next) router.push(`/media-player?package=${next.packageId}`, { transitionTypes: ["nav-forward"] }); }, [next, router]);

  return (
    <NebulaPlayer
      audio={{ onChange: (value) => { if (hlsRef.current) hlsRef.current.audioTrack = value; setAudioTrack(value); }, options: audioTracks, value: audioTrack }}
      autoPlay
      backHref={backHref}
      backdrop={backdrop}
      backdropMorphId={backdropMorphId}
      badges={badges}
      captionDelay={{ onChange: (value) => { subtitleDelayRef.current = value; setSubtitleDelay(value); const video = videoRef.current; if (video) shiftSubtitleCues(video.textTracks, value, originalCueTimesRef.current); }, value: subtitleDelay }}
      captions={{ onChange: (value) => { void selectSubtitle(value); }, options: subtitles, value: subtitle_ }}
      error={error}
      key={playerKey}
      nextLabel={next ? `Siguiente: ${next.title}` : undefined}
      onNext={next ? playNext : undefined}
      onReauthorize={() => void reauthorize()}
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
