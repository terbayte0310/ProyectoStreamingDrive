"use client";

import Link from "next/link";
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject, type VideoHTMLAttributes, useCallback, useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/icons";
import { clampPlaybackTime, formatPlayerTime } from "@/lib/media/player-time";

export type TrackOption = { label: string; value: number };
export type TrackGroup = { onChange: (value: number) => void; options: TrackOption[]; value: number };
export type PlayerStatus = "error" | "loading" | "needs-auth" | "ready";

type FullscreenDocument = Document & { webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenElement?: Element | null };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitDisplayingFullscreen?: boolean };
type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, "controls" | "poster" | "title"> & {
  audio?: TrackGroup;
  backHref?: string;
  backdrop?: string | null;
  badges?: string[];
  captionDelay?: { onChange: (seconds: number) => void; value: number };
  captions?: TrackGroup;
  error?: string;
  nextLabel?: string;
  onNext?: () => void;
  onPrevious?: () => void;
  onReauthorize?: () => void;
  onRetry?: () => void;
  onTheaterChange?: (theater: boolean) => void;
  previousLabel?: string;
  quality?: TrackGroup & { autoLabel?: string };
  resumeAt?: number;
  stage?: { index: number; labels: string[] };
  status: PlayerStatus;
  subtitle?: string;
  theater?: boolean;
  title: string;
  upNext?: { onPlay: () => void; title: string } | null;
  videoRef: RefObject<HTMLVideoElement | null>;
};

type MenuPage = "audio" | "captions" | "main" | "quality" | "speed" | "sync";
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const hideDelayMs = 2800;
const volumeKey = "nb-volume";

const shortcuts: Array<[string, string]> = [
  ["Espacio / K", "Reproducir o pausar"], ["← / →", "Retroceder / avanzar 5 s"], ["J / L", "Retroceder / avanzar 10 s"],
  ["↑ / ↓", "Subir / bajar volumen"], ["M", "Silenciar"], ["F", "Pantalla completa"], ["C", "Subtítulos"],
  ["T", "Modo cine"], ["I", "Ventana flotante"], ["< / >", "Velocidad"], ["0 – 9", "Saltar al 0 %–90 %"],
  ["Mayús + N / P", "Siguiente / anterior"], ["?", "Mostrar atajos"],
];

/**
 * Reproductor de presentación. Quien lo usa conserva la autorización de la
 * fuente, HLS y la persistencia del progreso; aquí vive toda la experiencia.
 */
export function NebulaPlayer(props: Props) {
  const { audio, backHref, backdrop, badges, captionDelay, captions, error, nextLabel, onNext, onPrevious, onReauthorize, onRetry, onTheaterChange, previousLabel, quality, resumeAt, stage, status, subtitle, theater, title, upNext, videoRef, ...videoProps } = props;
  const shellRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const scrubbing = useRef(false);
  const lastTap = useRef<{ at: number; timer: number | null; x: number }>({ at: 0, timer: null, x: 0 });
  const resumeApplied = useRef(false);
  const lastCaption = useRef<number>(-1);
  const pointerType = useRef("mouse");

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<Array<[number, number]>>([]);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [buffering, setBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [menu, setMenu] = useState<{ dir: "back" | "forward"; page: MenuPage } | null>(null);
  const [flash, setFlash] = useState<{ icon?: IconName; key: number; label?: string } | null>(null);
  const [ripple, setRipple] = useState<{ key: number; label: string; side: "left" | "right" } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [resumeChip, setResumeChip] = useState<number | null>(null);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [nativeControls, setNativeControls] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [hover, setHover] = useState<{ ratio: number } | null>(null);

  const flashFeedback = useCallback((icon?: IconName, label?: string) => setFlash({ icon, key: Date.now(), label }), []);

  // Eventos del vídeo -------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const saved = JSON.parse(localStorage.getItem(volumeKey) ?? "null") as { m?: boolean; v?: number } | null;
      if (saved && typeof saved.v === "number") video.volume = Math.min(1, Math.max(0, saved.v));
      if (saved?.m) video.muted = true;
    } catch { /* Volumen por defecto. */ }

    const readBuffered = () => {
      const ranges: Array<[number, number]> = [];
      for (let index = 0; index < video.buffered.length; index += 1) ranges.push([video.buffered.start(index), video.buffered.end(index)]);
      setBuffered(ranges);
    };
    const sync = () => {
      setPlaying(!video.paused && !video.ended);
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume);
      setMuted(video.muted);
      setRate(video.playbackRate);
    };
    const onPlaying = () => { setBuffering(false); setStarted(true); setEnded(false); setVideoError(""); sync(); };
    const onWaiting = () => setBuffering(true);
    const onReady = () => setBuffering(false);
    const onEnded = () => { setEnded(true); sync(); };
    const onVolume = () => {
      sync();
      try { localStorage.setItem(volumeKey, JSON.stringify({ m: video.muted, v: video.volume })); } catch { /* Opcional. */ }
    };
    const onError = () => {
      setBuffering(false);
      if (video.error) setVideoError("El vídeo dejó de responder. Puede ser la conexión o que Drive tardó demasiado.");
    };
    const events: Array<[string, () => void]> = [
      ["timeupdate", sync], ["durationchange", sync], ["loadedmetadata", sync], ["play", sync], ["pause", sync], ["ratechange", sync],
      ["progress", readBuffered], ["seeked", readBuffered], ["emptied", sync], ["playing", onPlaying], ["waiting", onWaiting],
      ["canplay", onReady], ["pause", onReady], ["seeked", onReady], ["ended", onEnded], ["volumechange", onVolume], ["error", onError],
    ];
    events.forEach(([name, handler]) => video.addEventListener(name, handler));
    setPipSupported(Boolean(document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function"));
    sync();
    return () => events.forEach(([name, handler]) => video.removeEventListener(name, handler));
  }, [videoRef]);

  // Progreso fluido a 60 fps sin re-renderizar React en cada cuadro.
  useEffect(() => {
    const video = videoRef.current;
    const shell = shellRef.current;
    if (!video || !shell) return;
    let frame = 0;
    const paint = () => {
      if (!scrubbing.current && Number.isFinite(video.duration) && video.duration > 0) {
        shell.style.setProperty("--np-progress", String(video.currentTime / video.duration));
      }
      if (!video.paused) frame = requestAnimationFrame(paint);
    };
    paint();
    video.addEventListener("play", paint);
    video.addEventListener("seeked", paint);
    video.addEventListener("loadedmetadata", paint);
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("play", paint);
      video.removeEventListener("seeked", paint);
      video.removeEventListener("loadedmetadata", paint);
    };
  }, [videoRef]);

  // Reanudar desde la última posición conocida.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resumeAt || resumeApplied.current || status !== "ready") return;
    const apply = () => {
      if (resumeApplied.current || !Number.isFinite(video.duration) || resumeAt >= video.duration - 5) return;
      resumeApplied.current = true;
      video.currentTime = resumeAt;
      setResumeChip(resumeAt);
    };
    if (video.readyState >= 1) apply();
    video.addEventListener("loadedmetadata", apply);
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [resumeAt, status, videoRef]);

  useEffect(() => {
    if (resumeChip === null) return;
    const timer = window.setTimeout(() => setResumeChip(null), 7000);
    return () => window.clearTimeout(timer);
  }, [resumeChip]);

  // Controles que se desvanecen mientras se reproduce.
  const reveal = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), hideDelayMs);
  }, []);
  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);
  const controlsShown = controlsVisible || !playing || Boolean(menu) || buffering || showShortcuts;

  // Pantalla completa -----------------------------------------------------
  useEffect(() => {
    const doc = document as FullscreenDocument;
    const video = videoRef.current as IosVideo | null;
    const onChange = () => {
      const element = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      setFullscreen(element === shellRef.current || Boolean(video?.webkitDisplayingFullscreen));
      if (!element) screen.orientation?.unlock?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    video?.addEventListener("webkitbeginfullscreen", onChange);
    video?.addEventListener("webkitendfullscreen", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      video?.removeEventListener("webkitbeginfullscreen", onChange);
      video?.removeEventListener("webkitendfullscreen", onChange);
    };
  }, [videoRef]);

  const toggleFullscreen = useCallback(async () => {
    const doc = document as FullscreenDocument;
    const shell = shellRef.current as FullscreenElement | null;
    const video = videoRef.current as IosVideo | null;
    if (!shell || !video) return;
    if (pseudoFullscreen) { setPseudoFullscreen(false); return; }
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      try { await (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.()); } catch { /* Ya salió. */ }
      return;
    }
    try {
      // Algunos navegadores embebidos (apps, vistas web) nunca resuelven la
      // promesa: si en 1,2 s no hay pantalla completa, se usa la propia.
      const settle = <T,>(request: Promise<T> | T) => Promise.race([
        Promise.resolve(request).then(() => "ok" as const),
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 1200)),
      ]);
      let outcome: "ok" | "timeout";
      if (shell.requestFullscreen) outcome = await settle(shell.requestFullscreen({ navigationUI: "hide" }));
      else if (shell.webkitRequestFullscreen) outcome = await settle(shell.webkitRequestFullscreen());
      else if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; }
      else { setPseudoFullscreen(true); return; }
      if (outcome === "timeout" && !(doc.fullscreenElement ?? doc.webkitFullscreenElement)) { setPseudoFullscreen(true); return; }
      // En móviles horizontal es lo natural; si el navegador no deja bloquear, se ignora.
      await (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape").catch(() => undefined);
    } catch {
      setPseudoFullscreen(true);
    }
  }, [pseudoFullscreen, videoRef]);

  // Acciones -----------------------------------------------------------------
  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || status !== "ready") return;
    if (video.paused || video.ended) {
      try { await video.play(); flashFeedback("play"); } catch { setControlsVisible(true); }
    } else {
      video.pause();
      flashFeedback("pause");
    }
  }, [flashFeedback, status, videoRef]);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = clampPlaybackTime(seconds, video.duration);
    shellRef.current?.style.setProperty("--np-progress", String(video.currentTime / video.duration));
    setTime(video.currentTime);
  }, [videoRef]);

  const seekBy = useCallback((delta: number, feedback: "flash" | "ripple" = "flash") => {
    const video = videoRef.current;
    if (!video) return;
    seekTo(video.currentTime + delta);
    const label = `${delta > 0 ? "+" : "−"}${Math.abs(delta)} s`;
    if (feedback === "ripple") setRipple({ key: Date.now(), label, side: delta > 0 ? "right" : "left" });
    else flashFeedback(delta > 0 ? "skipNext" : "skipBack", label);
  }, [flashFeedback, seekTo, videoRef]);

  const changeVolume = useCallback((next: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, next));
    video.muted = video.volume === 0;
    flashFeedback(video.volume === 0 ? "volumeMute" : video.volume < 0.5 ? "volumeLow" : "volume", `${Math.round(video.volume * 100)} %`);
  }, [flashFeedback, videoRef]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.6;
    flashFeedback(video.muted ? "volumeMute" : "volume");
  }, [flashFeedback, videoRef]);

  const changeRate = useCallback((next: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = next;
    flashFeedback(undefined, `${next}×`);
  }, [flashFeedback, videoRef]);

  const toggleCaptions = useCallback(() => {
    if (!captions?.options.length) return;
    if (captions.value >= 0) { lastCaption.current = captions.value; captions.onChange(-1); flashFeedback("subtitles", "Sin subtítulos"); return; }
    const next = captions.options.some((option) => option.value === lastCaption.current) ? lastCaption.current : captions.options[0].value;
    captions.onChange(next);
    flashFeedback("subtitles", captions.options.find((option) => option.value === next)?.label);
  }, [captions, flashFeedback]);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video?.requestPictureInPicture();
    } catch { /* El navegador lo rechazó; no es crítico. */ }
  }, [videoRef]);

  // Teclado --------------------------------------------------------------
  const handleKey = useCallback((event: KeyboardEvent | ReactKeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("input:not([type=range]), textarea, select, [contenteditable=true]")) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    const lower = key.toLowerCase();
    const onRange = Boolean(target.closest("input[type=range]"));
    const video = videoRef.current;
    let handled = true;

    if (key === "Escape") {
      if (showShortcuts) setShowShortcuts(false);
      else if (menu) setMenu(null);
      else if (pseudoFullscreen) setPseudoFullscreen(false);
      else handled = false;
    } else if (key === " " || lower === "k") {
      if (key === " " && target.closest("button, a")) return;
      void togglePlay();
    } else if (key === "ArrowLeft" && !onRange) seekBy(-5);
    else if (key === "ArrowRight" && !onRange) seekBy(5);
    else if (lower === "j") seekBy(-10);
    else if (lower === "l") seekBy(10);
    else if (key === "ArrowUp" && !onRange && video) changeVolume(video.volume + 0.05);
    else if (key === "ArrowDown" && !onRange && video) changeVolume(video.volume - 0.05);
    else if (lower === "m") toggleMute();
    else if (lower === "f") void toggleFullscreen();
    else if (lower === "c") toggleCaptions();
    else if (lower === "t" && onTheaterChange) onTheaterChange(!theater);
    else if (lower === "i" && pipSupported) void togglePip();
    else if (key === "?") setShowShortcuts((value) => !value);
    else if (key === ">" && video) changeRate(speeds[Math.min(speeds.length - 1, speeds.indexOf(video.playbackRate) + 1)] ?? 1);
    else if (key === "<" && video) changeRate(speeds[Math.max(0, speeds.indexOf(video.playbackRate) - 1)] ?? 1);
    else if (key === "N" && event.shiftKey && onNext) onNext();
    else if (key === "P" && event.shiftKey && onPrevious) onPrevious();
    else if (/^[0-9]$/.test(key) && video && Number.isFinite(video.duration)) seekTo(video.duration * Number(key) / 10);
    else handled = false;

    if (handled) { event.preventDefault(); reveal(); }
  }, [changeRate, changeVolume, menu, onNext, onPrevious, onTheaterChange, pipSupported, pseudoFullscreen, reveal, seekBy, seekTo, showShortcuts, theater, toggleCaptions, toggleFullscreen, toggleMute, togglePip, togglePlay, videoRef]);

  // Si el foco quedó en la página (p. ej. tras un clic fuera), los atajos siguen funcionando.
  useEffect(() => {
    const onDocumentKey = (event: KeyboardEvent) => {
      if (document.activeElement === document.body || document.activeElement === null) handleKey(event);
    };
    document.addEventListener("keydown", onDocumentKey);
    return () => document.removeEventListener("keydown", onDocumentKey);
  }, [handleKey]);

  // Gestos: clic = reproducir/pausar, doble clic = pantalla completa,
  // en táctil: toque = mostrar controles, doble toque lateral = ±10 s.
  function onGesturePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (menu) { setMenu(null); return; }
    if (event.pointerType === "mouse") return;
    const now = Date.now();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const tap = lastTap.current;
    if (now - tap.at < 300 && Math.abs(x - tap.x) < 0.25 && (x < 0.38 || x > 0.62)) {
      if (tap.timer) window.clearTimeout(tap.timer);
      tap.timer = null;
      seekBy(x < 0.5 ? -10 : 10, "ripple");
      tap.at = now;
      return;
    }
    tap.at = now;
    tap.x = x;
    if (tap.timer) window.clearTimeout(tap.timer);
    tap.timer = window.setTimeout(() => {
      tap.timer = null;
      if (!started || !playing) { void togglePlay(); return; }
      if (controlsVisible) setControlsVisible(false);
      else reveal();
    }, 260);
  }

  // Tarjeta "a continuación" -------------------------------------------------
  const remaining = duration - time;
  const showUpNext = Boolean(upNext) && !upNextDismissed && duration > 30 && (ended || (playing && remaining <= 12));
  useEffect(() => {
    if (!ended || !upNext || upNextDismissed) return;
    const timer = window.setTimeout(() => upNext.onPlay(), 6000);
    return () => window.clearTimeout(timer);
  }, [ended, upNext, upNextDismissed]);

  // Integraciones del sistema: controles de pantalla bloqueada y pantalla despierta.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({ album: "Nébula", artist: subtitle ?? "Nébula", artwork: backdrop ? [{ sizes: "780x439", src: backdrop }] : [], title });
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ["play", () => void videoRef.current?.play()],
      ["pause", () => videoRef.current?.pause()],
      ["seekbackward", () => seekBy(-10)],
      ["seekforward", () => seekBy(10)],
      ["previoustrack", onPrevious ? () => onPrevious() : null],
      ["nexttrack", onNext ? () => onNext() : null],
    ];
    for (const [action, handler] of handlers) { try { session.setActionHandler(action, handler); } catch { /* Acción no soportada. */ } }
    return () => { for (const [action] of handlers) { try { session.setActionHandler(action, null); } catch { /* Nada que limpiar. */ } } };
  }, [backdrop, onNext, onPrevious, seekBy, subtitle, title, videoRef]);

  useEffect(() => {
    if (!playing || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock.request("screen").then((lock) => { if (released) void lock.release(); else sentinel = lock; }).catch(() => undefined);
    return () => { released = true; void sentinel?.release().catch(() => undefined); };
  }, [playing]);

  // Línea de tiempo --------------------------------------------------------
  function ratioFromPointer(clientX: number) {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }
  function onTimelineDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!duration) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbing.current = true;
    event.currentTarget.dataset.scrubbing = "";
    const ratio = ratioFromPointer(event.clientX);
    shellRef.current?.style.setProperty("--np-progress", String(ratio));
    setHover({ ratio });
  }
  function onTimelineMove(event: ReactPointerEvent<HTMLDivElement>) {
    const ratio = ratioFromPointer(event.clientX);
    setHover({ ratio });
    if (scrubbing.current) shellRef.current?.style.setProperty("--np-progress", String(ratio));
  }
  function onTimelineUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    delete event.currentTarget.dataset.scrubbing;
    seekTo(ratioFromPointer(event.clientX) * duration);
  }

  const status2 = videoError && status === "ready" ? "error" : status;
  const errorMessage = status === "error" ? error : videoError;
  const hasQuality = Boolean(quality && quality.options.length > 1);
  const hasAudio = Boolean(audio && audio.options.length > 1);
  const hasCaptions = Boolean(captions && captions.options.length);
  const qualityLabel = quality ? (quality.value < 0 ? `Auto${quality.autoLabel ? ` (${quality.autoLabel})` : ""}` : quality.options.find((option) => option.value === quality.value)?.label ?? "Auto") : "";
  const captionLabel = captions ? (captions.value < 0 ? "Desactivados" : captions.options.find((option) => option.value === captions.value)?.label ?? "Activados") : "";
  const volumeIcon: IconName = muted || volume === 0 ? "volumeMute" : volume < 0.5 ? "volumeLow" : "volume";

  function openPage(page: MenuPage) { setMenu({ dir: "forward", page }); }
  function back() { setMenu({ dir: "back", page: "main" }); }

  return (
    <div
      aria-label={`Reproductor: ${title}`}
      className="nplayer"
      data-controls={controlsShown ? "visible" : "hidden"}
      data-pseudo-fullscreen={pseudoFullscreen ? "" : undefined}
      data-started={started ? "" : undefined}
      data-state={playing ? "playing" : "paused"}
      data-status={status2}
      onFocusCapture={reveal}
      onKeyDown={handleKey}
      onPointerMove={(event) => { if (event.pointerType === "mouse") reveal(); }}
      ref={shellRef}
      role="region"
      tabIndex={0}
    >
      <video {...videoProps} aria-label={title} controls={nativeControls} playsInline ref={videoRef} />

      {nativeControls ? (
        <button className="btn btn-glass btn-sm np-native-return" onClick={() => setNativeControls(false)} type="button">Volver a controles Nébula</button>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- fondo decorativo mientras carga. */}
          {backdrop ? <img alt="" className="np-poster" src={backdrop} /> : null}
          <div className="np-gesture" onClick={() => { if (pointerType.current === "mouse" && !menu) void togglePlay(); }} onDoubleClick={() => { if (pointerType.current === "mouse") void toggleFullscreen(); }} onPointerDown={(event) => { pointerType.current = event.pointerType; }} onPointerUp={onGesturePointerUp} />
          <div aria-hidden="true" className="np-scrim" />

          <div className="np-top">
            {backHref ? <Link aria-label="Volver" className="np-back" href={backHref}><Icon name="arrowLeft" /></Link> : null}
            <div className="np-titles">
              {subtitle ? <span>{subtitle}</span> : null}
              <strong>{title}</strong>
            </div>
            <div className="np-top-badges">
              {badges?.map((badge) => <span className="badge" key={badge}>{badge}</span>)}
              {hasQuality && quality ? <span className="badge">{qualityLabel}</span> : null}
            </div>
          </div>

          <div className="np-center">
            {status2 === "ready" && buffering && started ? <div aria-label="Cargando" className="np-buffering" role="status" /> : null}
            {status2 === "ready" && !playing && !buffering && (!started || ended) ? (
              <button aria-label={ended ? "Volver a reproducir" : "Reproducir"} className="np-bigplay" onClick={() => void togglePlay()} type="button">
                <Icon name={ended ? "refresh" : "play"} strokeWidth={2.4} />
              </button>
            ) : null}
            {flash ? (
              <div aria-hidden="true" className="np-flash" key={flash.key}>
                {flash.icon ? <Icon name={flash.icon} strokeWidth={2.2} /> : null}
                {flash.label && !flash.icon ? <span>{flash.label}</span> : null}
              </div>
            ) : null}
          </div>

          {ripple ? (
            <div aria-hidden="true" className="np-ripple" key={ripple.key} style={ripple.side === "left" ? { left: 0, "--side": "0%" } as CSSProperties : { right: 0, "--side": "100%" } as CSSProperties}>
              <span><Icon name={ripple.side === "left" ? "skipBack" : "skipNext"} />{ripple.label}</span>
            </div>
          ) : null}

          {status2 === "loading" ? (
            <div className="np-overlay" role="status">
              <span className="orbit-loader" style={{ "--size": "64px" } as CSSProperties}><span /></span>
              {stage ? (
                <>
                  <div aria-hidden="true" className="np-stages">
                    {stage.labels.map((label, index) => <span data-current={index === stage.index ? "" : undefined} data-done={index < stage.index ? "" : undefined} key={label} />)}
                  </div>
                  <span className="np-stage-label">{stage.labels[stage.index] ?? "Preparando…"}</span>
                </>
              ) : <span className="np-stage-label">Preparando tu vídeo…</span>}
            </div>
          ) : null}

          {status2 === "needs-auth" ? (
            <div className="np-overlay" role="alert">
              <span className="notice-icon" style={{ width: 52, height: 52, borderRadius: 16, background: "rgb(255 255 255 / .12)" }}><Icon name="lock" width={24} /></span>
              <h2 className="title-m">Hay que renovar el acceso</h2>
              <p>La autorización para leer los vídeos venció o no está disponible en esta sesión.</p>
              {onReauthorize ? <button className="btn btn-light" onClick={onReauthorize} type="button">Volver a iniciar sesión</button> : null}
            </div>
          ) : null}

          {status2 === "error" ? (
            <div className="np-overlay" role="alert">
              <span className="notice-icon" style={{ width: 52, height: 52, borderRadius: 16, background: "rgb(255 101 144 / .2)", color: "#ff8fb0" }}><Icon name="warning" width={24} /></span>
              <h2 className="title-m">No se pudo reproducir</h2>
              <p>{errorMessage || "Algo interrumpió la reproducción."}</p>
              <div className="np-overlay-actions">
                <button className="btn btn-light" onClick={() => { setVideoError(""); if (onRetry) onRetry(); else videoRef.current?.load(); }} type="button"><Icon name="refresh" />Reintentar</button>
                {backHref ? <Link className="btn btn-glass" href={backHref}>Volver</Link> : null}
              </div>
            </div>
          ) : null}

          {resumeChip !== null && status2 === "ready" ? (
            <div className="np-resume" role="status">
              Reanudado en {formatPlayerTime(resumeChip)}
              <button onClick={() => { seekTo(0); setResumeChip(null); }} type="button">Desde el inicio</button>
            </div>
          ) : null}

          {showUpNext && upNext ? (
            <div className="np-upnext" role="status">
              <small>{ended ? "Siguiente en unos segundos" : "A continuación"}</small>
              <strong>{upNext.title}</strong>
              <div className="np-upnext-actions">
                <button className={`btn btn-light btn-sm${ended ? " np-countdown" : ""}`} onClick={upNext.onPlay} style={{ "--countdown": "6s" } as CSSProperties} type="button"><Icon name="play" />Reproducir</button>
                <button className="btn btn-glass btn-sm" onClick={() => setUpNextDismissed(true)} type="button">Cancelar</button>
              </div>
            </div>
          ) : null}

          <div className="np-bottom">
            <div
              aria-label="Posición del vídeo"
              aria-valuemax={Math.round(duration)}
              aria-valuemin={0}
              aria-valuenow={Math.round(time)}
              aria-valuetext={`${formatPlayerTime(time)} de ${formatPlayerTime(duration)}`}
              className="np-timeline"
              onPointerDown={onTimelineDown}
              onPointerLeave={() => { if (!scrubbing.current) setHover(null); }}
              onPointerMove={onTimelineMove}
              onPointerUp={onTimelineUp}
              ref={timelineRef}
              role="slider"
              style={{ "--hover": `${(hover?.ratio ?? 0) * 100}%` } as CSSProperties}
              tabIndex={0}
            >
              <div className="np-track">
                {duration ? buffered.map(([start, end]) => <span className="np-buffered" key={`${start}-${end}`} style={{ left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` }} />) : null}
                <span className="np-hover-fill" />
                <span className="np-played" />
              </div>
              <span className="np-thumb" />
              <span className="np-bubble">{formatPlayerTime((hover?.ratio ?? 0) * duration)}</span>
            </div>

            <div className="np-bar">
              <button aria-label={playing ? "Pausar" : "Reproducir"} className="np-btn np-play" data-tip={playing ? "Pausar (K)" : "Reproducir (K)"} disabled={status2 !== "ready"} onClick={() => void togglePlay()} type="button">
                <Icon name={playing ? "pause" : "play"} strokeWidth={2.4} />
              </button>
              {onPrevious ? <button aria-label={previousLabel ?? "Anterior"} className="np-btn np-hide-narrow" data-tip={previousLabel ?? "Anterior"} onClick={onPrevious} type="button"><Icon name="skipPrev" /></button> : null}
              <button aria-label="Retroceder 10 segundos" className="np-btn" data-tip="−10 s (J)" disabled={!duration} onClick={() => seekBy(-10)} type="button"><Icon name="refresh" style={{ transform: "scaleX(-1)" }} /><span className="np-seek-label">10</span></button>
              <button aria-label="Avanzar 10 segundos" className="np-btn" data-tip="+10 s (L)" disabled={!duration} onClick={() => seekBy(10)} type="button"><Icon name="refresh" /><span className="np-seek-label">10</span></button>
              {onNext ? <button aria-label={nextLabel ?? "Siguiente"} className="np-btn" data-tip={nextLabel ?? "Siguiente"} onClick={onNext} type="button"><Icon name="skipNext" /></button> : null}
              <div className="np-volume">
                <button aria-label={muted ? "Activar sonido" : "Silenciar"} className="np-btn" data-tip="Silenciar (M)" onClick={toggleMute} type="button"><Icon name={volumeIcon} /></button>
                <div className="np-volume-slider np-hide-narrow">
                  <input aria-label="Volumen" className="np-range" max={1} min={0} onChange={(event) => { const video = videoRef.current; if (video) { video.volume = Number(event.target.value); video.muted = video.volume === 0; } }} step={0.02} style={{ "--fill": `${(muted ? 0 : volume) * 100}%` } as CSSProperties} type="range" value={muted ? 0 : volume} />
                </div>
              </div>
              <span className="np-time">{formatPlayerTime(time)} <span>/ {formatPlayerTime(duration)}</span></span>
              <div className="np-spacer" />
              {hasCaptions ? <button aria-label="Subtítulos" aria-pressed={(captions?.value ?? -1) >= 0} className="np-btn" data-tip="Subtítulos (C)" onClick={toggleCaptions} type="button"><Icon name="subtitles" /></button> : null}
              <button aria-expanded={Boolean(menu)} aria-label="Ajustes" className="np-btn" data-tip="Ajustes" onClick={() => setMenu(menu ? null : { dir: "forward", page: "main" })} type="button"><Icon name="settings" style={{ transform: menu ? "rotate(90deg)" : undefined, transition: "transform 420ms var(--ease-spring)" }} /></button>
              {onTheaterChange ? <button aria-label="Modo cine" aria-pressed={Boolean(theater)} className="np-btn np-hide-narrow" data-tip="Modo cine (T)" onClick={() => onTheaterChange(!theater)} type="button"><Icon name="theater" /></button> : null}
              {pipSupported ? <button aria-label="Ventana flotante" className="np-btn np-hide-narrow" data-tip="Ventana flotante (I)" onClick={() => void togglePip()} type="button"><Icon name="pip" /></button> : null}
              <button aria-label={fullscreen || pseudoFullscreen ? "Salir de pantalla completa" : "Pantalla completa"} className="np-btn" data-tip="Pantalla completa (F)" onClick={() => void toggleFullscreen()} type="button"><Icon name={fullscreen || pseudoFullscreen ? "minimize" : "expand"} /></button>
            </div>
          </div>

          {menu ? (
            <div aria-label="Ajustes de reproducción" className="np-menu" role="menu">
              {menu.page === "main" ? (
                <div className="np-menu-page" data-dir={menu.dir}>
                  <button className="np-menu-row" onClick={() => openPage("speed")} role="menuitem" type="button"><Icon name="sparkle" />Velocidad<span className="np-menu-value">{rate === 1 ? "Normal" : `${rate}×`}</span><Icon name="chevronRight" /></button>
                  {hasQuality ? <button className="np-menu-row" onClick={() => openPage("quality")} role="menuitem" type="button"><Icon name="layers" />Calidad<span className="np-menu-value">{qualityLabel}</span><Icon name="chevronRight" /></button> : null}
                  {hasAudio && audio ? <button className="np-menu-row" onClick={() => openPage("audio")} role="menuitem" type="button"><Icon name="volume" />Audio<span className="np-menu-value">{audio.options.find((option) => option.value === audio.value)?.label ?? "—"}</span><Icon name="chevronRight" /></button> : null}
                  {hasCaptions ? <button className="np-menu-row" onClick={() => openPage("captions")} role="menuitem" type="button"><Icon name="subtitles" />Subtítulos<span className="np-menu-value">{captionLabel}</span><Icon name="chevronRight" /></button> : null}
                  {hasCaptions && captionDelay ? <button className="np-menu-row" onClick={() => openPage("sync")} role="menuitem" type="button"><Icon name="wand" />Sincronizar subtítulos<span className="np-menu-value">{captionDelay.value > 0 ? "+" : ""}{captionDelay.value.toFixed(1)} s</span><Icon name="chevronRight" /></button> : null}
                  <button className="np-menu-row" onClick={() => { setMenu(null); setShowShortcuts(true); }} role="menuitem" type="button"><Icon name="info" />Atajos de teclado<span className="np-menu-value">?</span></button>
                  <button className="np-menu-row" onClick={() => { setMenu(null); setNativeControls(true); }} role="menuitem" type="button"><Icon name="settings" />Controles del navegador</button>
                </div>
              ) : null}
              {menu.page === "speed" ? (
                <OptionPage onBack={back} onSelect={(value) => { changeRate(value); back(); }} options={speeds.map((speed) => ({ label: speed === 1 ? "Normal" : `${speed}×`, value: speed }))} title="Velocidad" value={rate} />
              ) : null}
              {menu.page === "quality" && quality ? (
                <OptionPage onBack={back} onSelect={(value) => { quality.onChange(value); back(); }} options={[{ label: `Automática${quality.autoLabel ? ` · ${quality.autoLabel}` : ""}`, value: -1 }, ...quality.options]} title="Calidad" value={quality.value} />
              ) : null}
              {menu.page === "audio" && audio ? (
                <OptionPage onBack={back} onSelect={(value) => { audio.onChange(value); back(); }} options={audio.options} title="Audio" value={audio.value} />
              ) : null}
              {menu.page === "captions" && captions ? (
                <OptionPage onBack={back} onSelect={(value) => { if (value >= 0) lastCaption.current = value; captions.onChange(value); back(); }} options={[{ label: "Desactivados", value: -1 }, ...captions.options]} title="Subtítulos" value={captions.value} />
              ) : null}
              {menu.page === "sync" && captionDelay ? (
                <div className="np-menu-page" data-dir="forward">
                  <div className="np-menu-head"><button aria-label="Volver" onClick={back} type="button"><Icon name="chevronLeft" /></button>Sincronizar subtítulos</div>
                  <div className="np-sync">
                    <div className="np-sync-value">{captionDelay.value > 0 ? "+" : ""}{captionDelay.value.toFixed(1)} s</div>
                    <div className="np-sync-actions">
                      {[-1, -0.5, 0.5, 1].map((delta) => <button key={delta} onClick={() => captionDelay.onChange(Math.max(-10, Math.min(10, Math.round((captionDelay.value + delta) * 10) / 10)))} type="button">{delta > 0 ? "+" : "−"}{Math.abs(delta)}</button>)}
                    </div>
                    <span className="subtle" style={{ color: "rgb(255 255 255 / .6)" }}>Negativo adelanta el texto · positivo lo retrasa</span>
                    <button className="btn btn-glass btn-sm" onClick={() => captionDelay.onChange(0)} type="button">Restablecer</button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {showShortcuts ? (
            <div className="np-shortcuts" onClick={() => setShowShortcuts(false)}>
              <div aria-label="Atajos de teclado" className="np-shortcuts-card" onClick={(event) => event.stopPropagation()} role="dialog">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 className="title-m">Atajos de teclado</h2>
                  <button aria-label="Cerrar" className="np-btn" onClick={() => setShowShortcuts(false)} type="button"><Icon name="close" /></button>
                </div>
                <div className="np-shortcuts-grid">
                  {shortcuts.map(([keys, label]) => <div key={keys}><span>{label}</span><kbd>{keys}</kbd></div>)}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function OptionPage({ onBack, onSelect, options, title, value }: { onBack: () => void; onSelect: (value: number) => void; options: TrackOption[]; title: string; value: number }) {
  return (
    <div className="np-menu-page" data-dir="forward">
      <div className="np-menu-head"><button aria-label="Volver" onClick={onBack} type="button"><Icon name="chevronLeft" /></button>{title}</div>
      {options.map((option) => (
        <button aria-checked={option.value === value} className="np-menu-row np-option" key={option.value} onClick={() => onSelect(option.value)} role="menuitemradio" type="button">
          <span className="np-option-check">{option.value === value ? <Icon name="check" strokeWidth={2.4} /> : null}</span>
          {option.label}
        </button>
      ))}
    </div>
  );
}
