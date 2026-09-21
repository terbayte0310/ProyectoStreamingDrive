"use client";

// Registro mínimo de lo que le pasa al reproductor en un dispositivo real:
// reinicios, fallos de sesión y un latido por minuto. Se agrupa y se envía cada
// 20 s (o al salir), con un tope por sesión para no gastar batería ni datos.

type Detail = Record<string, boolean | number | string | null | undefined>;
type QueuedEvent = { at: number; detail: Detail; event: string; packageId: string };

const endpoint = "/api/player-events";
const flushIntervalMs = 20_000;
const maxQueued = 30;
const maxPerSession = 400;
const markerKey = "nebula-player-marker";

let queue: QueuedEvent[] = [];
let sent = 0;
let timer: number | null = null;

function send(events: QueuedEvent[], unloading: boolean) {
  if (!events.length) return;
  const body = JSON.stringify({ events });
  try {
    if (unloading && navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }))) return;
    void fetch(endpoint, { body, credentials: "same-origin", headers: { "content-type": "application/json" }, keepalive: true, method: "POST" }).catch(() => undefined);
  } catch {
    // La telemetría nunca debe interrumpir la reproducción.
  }
}

export function flushPlayerEvents(unloading = false) {
  if (timer !== null) { window.clearTimeout(timer); timer = null; }
  const events = queue;
  queue = [];
  send(events, unloading);
}

export function reportPlayerEvent(packageId: string, event: string, detail: Detail = {}) {
  if (typeof window === "undefined" || sent >= maxPerSession) return;
  sent += 1;
  queue.push({ at: Date.now(), detail, event, packageId });
  if (queue.length >= maxQueued) flushPlayerEvents();
  else timer ??= window.setTimeout(() => flushPlayerEvents(), flushIntervalMs);
}

type Marker = { clean: boolean; currentTime: number; packageId: string; ts: number };

/** Marca el estado del reproductor: si la página muere sin avisar, la próxima carga lo detecta. */
export function writePlayerMarker(marker: Marker) {
  try { window.localStorage.setItem(markerKey, JSON.stringify(marker)); } catch { /* almacenamiento no disponible */ }
}

/** Lee y borra el marcador anterior; devuelve algo solo si la página se cerró sin `pagehide`. */
export function takeUncleanMarker(): Marker | null {
  try {
    const raw = window.localStorage.getItem(markerKey);
    window.localStorage.removeItem(markerKey);
    if (!raw) return null;
    const marker = JSON.parse(raw) as Marker;
    return marker && marker.clean === false && Number.isFinite(marker.ts) && Date.now() - marker.ts < 15 * 60_000 ? marker : null;
  } catch {
    return null;
  }
}

export function deviceSnapshot(): Detail {
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  return {
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    standalone: Boolean(nav.standalone),
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
  };
}
