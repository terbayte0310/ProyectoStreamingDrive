"use client";

// Una sola revisión para todo el sitio. Antes la cabecera registraba
// "budget-v1" y el reproductor "media-hls-v1": cada cambio de página
// reinstalaba el worker y el reproductor esperaba hasta 5 s su activación.
export const DRIVE_WORKER_REVISION = "nebula-v3";
export const DRIVE_WORKER_URL = `/sw.js?revision=${DRIVE_WORKER_REVISION}`;

type Module = "courses" | "movies" | "series";

let registration: Promise<ServiceWorkerRegistration> | null = null;

export function registerDriveWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  registration ??= navigator.serviceWorker.register(DRIVE_WORKER_URL, { scope: "/", updateViaCache: "none" });
  return registration;
}

function isCurrent(worker: ServiceWorker | null | undefined): worker is ServiceWorker {
  return Boolean(worker?.scriptURL.includes(`revision=${DRIVE_WORKER_REVISION}`));
}

/** Devuelve el worker activo de esta revisión, esperando su activación si hace falta. */
export async function getDriveWorker(timeoutMs = 8000): Promise<ServiceWorker> {
  const pending = registerDriveWorker();
  if (!pending) throw new Error("Este navegador no admite el reproductor seguro de Drive.");
  const current = await pending;
  if (isCurrent(current.active)) { await waitForController(); return current.active; }
  const installing = current.installing ?? current.waiting;
  if (!installing) throw new Error("No se pudo preparar el reproductor. Recarga la página.");
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("El reproductor tardó demasiado en prepararse. Recarga la página.")), timeoutMs);
    installing.addEventListener("statechange", () => {
      if (installing.state === "activated") { window.clearTimeout(timer); resolve(); }
      if (installing.state === "redundant") { window.clearTimeout(timer); reject(new Error("No se pudo activar el reproductor.")); }
    });
  });
  if (!isCurrent(current.active)) throw new Error("El reproductor no se actualizó. Recarga la página.");
  await waitForController();
  return current.active;
}

/** Tras la primera instalación, clients.claim() tarda unos milisegundos en tomar la página. */
async function waitForController(timeoutMs = 2500) {
  if (isCurrent(navigator.serviceWorker.controller)) return;
  // Una recarga forzada deja la página sin controlar aunque el worker esté activo: se le pide que la reclame.
  void navigator.serviceWorker.ready.then((ready) => ready.active?.postMessage({ type: "claim-clients" }));
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, timeoutMs);
    navigator.serviceWorker.addEventListener("controllerchange", () => { window.clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** Entrega el token de Drive al worker y espera su confirmación. */
export async function sendDriveToken(worker: ServiceWorker, token: string, module: Module) {
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(resolve, 1500);
    channel.port1.onmessage = () => { window.clearTimeout(timer); resolve(); };
    worker.postMessage({ module, token, type: "drive-access-token" }, [channel.port2]);
  });
}

/** El worker solo intercepta peticiones de páginas que controla. */
export function workerControlsPage() {
  return typeof navigator !== "undefined" && isCurrent(navigator.serviceWorker?.controller);
}
