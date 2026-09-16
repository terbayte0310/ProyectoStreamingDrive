"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject, type VideoHTMLAttributes } from "react";
import { clampPlaybackTime, formatPlayerTime } from "@/lib/media/player-time";

type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, "controls" | "title"> & {
  videoRef: RefObject<HTMLVideoElement | null>;
  title: string;
  settings?: ReactNode;
};

function Icon({ name }: { name: "play" | "pause" | "volume" | "mute" | "expand" | "pip" | "settings" }) {
  const paths = {
    play: "M8 5v14l11-7Z", pause: "M8 5v14M16 5v14",
    volume: "M3 9v6h4l5 4V5L7 9ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14",
    mute: "M3 9v6h4l5 4V5L7 9ZM17 9l5 6M22 9l-5 6",
    expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
    pip: "M21 11V4H3v16h8M13 13h8v7h-8Z",
    settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

/** Presentation only: callers retain source authorization and progress persistence. */
export function CinemaPlayer({ videoRef, title, settings, ...videoProps }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [visible, setVisible] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [nativeControls, setNativeControls] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setPlaying(!video.paused && !video.ended);
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume); setMuted(video.muted); setRate(video.playbackRate);
      const ranges = video.buffered;
      setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0);
    };
    const busy = () => setWaiting(true);
    const ready = () => { setWaiting(false); setMessage(""); };
    const failed = () => { setWaiting(false); setMessage("No se pudo reproducir este vídeo. Recarga o vuelve a autorizar Drive si el problema continúa."); };
    const full = () => setFullscreen(document.fullscreenElement === shellRef.current);
    const events = ["timeupdate", "durationchange", "loadedmetadata", "play", "pause", "ended", "volumechange", "ratechange", "progress", "emptied"];
    events.forEach(event => video.addEventListener(event, sync));
    video.addEventListener("waiting", busy);
    video.addEventListener("playing", ready);
    video.addEventListener("canplay", ready);
    video.addEventListener("error", failed);
    document.addEventListener("fullscreenchange", full);
    setPipSupported(Boolean(document.pictureInPictureEnabled && video.requestPictureInPicture));
    setFullscreenSupported(Boolean(document.fullscreenEnabled));
    sync();
    return () => {
      events.forEach(event => video.removeEventListener(event, sync));
      video.removeEventListener("waiting", busy); video.removeEventListener("playing", ready);
      video.removeEventListener("canplay", ready); video.removeEventListener("error", failed);
      document.removeEventListener("fullscreenchange", full);
    };
  }, [videoRef]);

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing && visible && !settingsOpen) hideTimer.current = setTimeout(() => setVisible(false), 3000);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [playing, visible, settingsOpen]);

  function reveal() {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing && !settingsOpen) hideTimer.current = setTimeout(() => setVisible(false), 3000);
  }
  async function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) video.pause();
    else { try { await video.play(); setMessage(""); } catch { setMessage("Pulsa reproducir para iniciar el vídeo. Si no comienza, comprueba tu conexión."); } }
    reveal();
  }
  function seek(seconds: number) {
    if (videoRef.current && duration > 0) videoRef.current.currentTime = clampPlaybackTime(seconds, duration);
    reveal();
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch { setMessage("La pantalla completa no está disponible en este navegador."); }
  }
  async function togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current?.requestPictureInPicture();
    } catch { setMessage("No se pudo abrir la ventana flotante. Inicia el vídeo e inténtalo otra vez."); }
  }

  return <div ref={shellRef} className={`cinema-player${visible || !playing || settingsOpen ? " cinema-controls-visible" : ""}`} onPointerMove={reveal} onPointerDown={reveal} onFocusCapture={reveal} onKeyDown={event => {
    if (event.key === "Escape") { setSettingsOpen(false); return; }
    if ((event.target as HTMLElement).closest("button, input, select, textarea, a, [contenteditable]")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if ([" ", "k", "arrowleft", "arrowright", "m", "f"].includes(key)) event.preventDefault();
    if (key === " " || key === "k") void togglePlay();
    if (key === "arrowleft") seek(time - 10);
    if (key === "arrowright") seek(time + 10);
    if (key === "m" && videoRef.current) videoRef.current.muted = !videoRef.current.muted;
    if (key === "f" && fullscreenSupported) void toggleFullscreen();
    if (key === "escape") setSettingsOpen(false);
  }} tabIndex={0} role="region" aria-label={`Reproductor: ${title}`}>
    <video {...videoProps} ref={videoRef} controls={nativeControls} playsInline aria-label={title} onClick={nativeControls ? videoProps.onClick : () => void togglePlay()} />
    {!nativeControls ? <>
      <div className="cinema-top"><span className="cinema-label">AHORA REPRODUCIENDO</span><strong>{title}</strong><span className="cinema-badge">NÉBULA</span></div>
      {waiting ? <div className="cinema-buffering" role="status">Cargando vídeo…</div> : null}
      {!playing && !waiting ? <button className="cinema-big-play" type="button" aria-label={time >= duration && duration > 0 ? "Volver a reproducir" : "Reproducir"} onClick={() => void togglePlay()}><Icon name="play" /></button> : null}
      <div className="cinema-bottom">
        <div className="cinema-timeline">
          <div className="cinema-buffer" style={{ width: `${duration ? Math.min(buffered / duration * 100, 100) : 0}%` }} />
          <input aria-label="Posición del vídeo" aria-valuetext={`${formatPlayerTime(time)} de ${formatPlayerTime(duration)}`} type="range" min={0} max={duration || 0} step={0.1} value={clampPlaybackTime(time, duration)} disabled={!duration} onChange={event => seek(Number(event.target.value))} style={{ background: `linear-gradient(to right, #dbf77e ${duration ? time / duration * 100 : 0}%, transparent 0)` }} />
        </div>
        <div className="cinema-toolbar">
          <button type="button" aria-label={playing ? "Pausar" : "Reproducir"} title="Reproducir / pausar (K)" onClick={() => void togglePlay()}><Icon name={playing ? "pause" : "play"} /></button>
          <button type="button" aria-label="Retroceder 10 segundos" onClick={() => seek(time - 10)} disabled={!duration}>↶<small>10</small></button>
          <button type="button" aria-label="Avanzar 10 segundos" onClick={() => seek(time + 10)} disabled={!duration}>↷<small>10</small></button>
          <div className="cinema-volume"><button type="button" aria-label={muted ? "Activar sonido" : "Silenciar"} onClick={() => { if (videoRef.current) videoRef.current.muted = !muted; }}><Icon name={muted || !volume ? "mute" : "volume"} /></button><input aria-label="Volumen" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={event => { if (videoRef.current) { videoRef.current.volume = Number(event.target.value); videoRef.current.muted = false; } }} /></div>
          <span className="cinema-time">{formatPlayerTime(time)} <span>/ {formatPlayerTime(duration)}</span></span>
          <div className="cinema-spacer" />
          <div className="cinema-settings-wrap"><button type="button" aria-label="Ajustes de reproducción" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Icon name="settings" /></button>
            {settingsOpen ? <div className="cinema-settings"><strong>A tu manera</strong><label>Velocidad<select aria-label="Velocidad" value={rate} onChange={event => { if (videoRef.current) videoRef.current.playbackRate = Number(event.target.value); }}>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(speed => <option key={speed} value={speed}>{speed === 1 ? "Normal" : `${speed}×`}</option>)}</select></label>{settings}<button type="button" onClick={() => { setNativeControls(true); setSettingsOpen(false); }}>Usar controles del navegador</button><p>Espacio / K: pausa · ← →: 10 s · M: sonido · F: pantalla completa. Activa los atajos enfocando el área del vídeo.</p></div> : null}
          </div>
          {pipSupported ? <button type="button" className="cinema-pip" aria-label="Ventana flotante" onClick={() => void togglePip()}><Icon name="pip" /></button> : null}
          {fullscreenSupported ? <button type="button" aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} onClick={() => void toggleFullscreen()}><Icon name="expand" /></button> : null}
        </div>
      </div>
    </> : <button className="cinema-native-return" type="button" onClick={() => setNativeControls(false)}>Volver a controles Nébula</button>}
    {message ? <div className="cinema-message" role="status">{message}<button aria-label="Cerrar aviso" type="button" onClick={() => setMessage("")}>×</button></div> : null}
  </div>;
}
