// Service worker de Nébula: autoriza las lecturas de Google Drive sin exponer
// el token a la página y mantiene el fusible de transferencia.
//
// Rutas interceptadas:
//   /drive-stream/{fileId}      lecciones de cursos (MP4 con rangos)
//   /drive-download/{fileId}    enlace de descarga de recursos
//   /drive-hls/{fileId}?pkg&p   segmentos HLS directos a Google (sin pasar por Vercel)
//   /media-stream/{assetId}     compatibilidad con manifiestos antiguos

let driveAccessToken = null;
let refreshPromise = null;
let driveSessionVersion = 0;
let driveAccessInvalidated = false;
let driveModule = "courses";
// Tras una reserva aprobada, las siguientes lecturas reservan en paralelo a la
// descarga durante este intervalo: el fusible sigue contando cada byte, pero la
// latencia de la reserva deja de sumarse al primer byte de vídeo.
let budgetWarmUntil = 0;
const budgetWarmMs = 90_000;
const announcedTransferNotices = new Set();
const maxTransferRetries = 2;
// Tamaño total de cada archivo, devuelto por la reserva. Google no expone
// Content-Range a las peticiones con CORS y Safari lo exige en vídeo por rangos.
const fileSizes = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type === "drive-access-token" && typeof event.data.token === "string") {
    if (event.data.module === "movies" || event.data.module === "series" || event.data.module === "courses") {
      driveModule = event.data.module;
    }
    if (driveAccessInvalidated) {
      void refreshAccessToken().then((token) => event.ports[0]?.postMessage({ accepted: Boolean(token) }));
    } else {
      driveAccessToken = event.data.token;
      event.ports[0]?.postMessage({ accepted: true });
    }
  }
  if (event.data?.type === "clear-drive-access-token") {
    driveSessionVersion += 1;
    driveAccessToken = null;
    driveAccessInvalidated = true;
    refreshPromise = null;
    budgetWarmUntil = 0;
    announcedTransferNotices.clear();
    event.ports[0]?.postMessage({ cleared: true });
  }
  if (event.data?.type === "claim-clients") {
    event.waitUntil?.(self.clients.claim());
  }
});

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, retryNumber) {
  const retryAfter = response?.headers.get("Retry-After");
  let providerDelay = 0;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    providerDelay = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now());
    if (providerDelay > 8000) return null;
  }
  const backoff = (2 ** retryNumber) * 250 + Math.floor(Math.random() * 250);
  return Math.max(providerDelay, backoff);
}

async function fetchWithBoundedRetries(input, init, shouldRetry) {
  let retryNumber = 0;
  while (true) {
    let response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      if (retryNumber >= maxTransferRetries) throw error;
      await wait(retryDelay(null, retryNumber));
      retryNumber += 1;
      continue;
    }
    if (!shouldRetry(response) || retryNumber >= maxTransferRetries) return response;
    const delay = retryDelay(response, retryNumber);
    if (delay === null) return response;
    await wait(delay);
    retryNumber += 1;
  }
}

async function announceTransferNotice(kind, details = {}) {
  if (announcedTransferNotices.has(kind)) return;
  announcedTransferNotices.add(kind);
  const windows = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  windows.forEach((client) => client.postMessage({ ...details, kind, type: "transfer-usage-notice" }));
}

async function requestBudget(payload) {
  return fetchWithBoundedRetries(
    "/api/transfer-budget",
    {
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    (response) => response.status >= 500,
  );
}

async function reserveTransfer(fileId, kind, range) {
  let response;
  try {
    response = await requestBudget({ fileId, kind, module: driveModule, operation: "reserve", range });
  } catch {
    void announceTransferNotice("counter-unavailable");
    return { error: new Response("La medición de transferencia está temporalmente indisponible.", { status: 503 }) };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.allowed || typeof data.reservationId !== "string") {
    const kind = data.code === "emergency_fuse" ? "emergency-fuse" : "counter-unavailable";
    void announceTransferNotice(kind, {
      emergencyLimitBytes: Number(data.emergencyLimitBytes) || undefined,
    });
    return {
      error: new Response(
        typeof data.error === "string" ? data.error : "No se pudo autorizar la transferencia.",
        { headers: response.headers, status: response.status || 503 },
      ),
    };
  }

  if (data.userWarning) {
    void announceTransferNotice("user-warning", {
      warningLimitBytes: Number(data.userWarningLimitBytes) || undefined,
    });
  }
  if (data.globalWarning) {
    void announceTransferNotice("global-warning", {
      warningLimitBytes: Number(data.globalWarningLimitBytes) || undefined,
    });
  }
  const fileSize = Number(data.fileSize);
  if (Number.isSafeInteger(fileSize) && fileSize > 0) fileSizes.set(fileId, fileSize);
  return { reservationId: data.reservationId };
}

// Las confirmaciones y liberaciones no bloquean ninguna descarga: se agrupan y
// viajan juntas cada pocos segundos en lugar de una petición por segmento. Si
// el worker se detiene antes de enviarlas, la reserva sigue contada y caduca sola.
const settleQueue = [];
const settleDelayMs = 4000;
const settleBatchMax = 40;
let settleFlush = null;

async function flushSettles() {
  settleFlush = null;
  while (settleQueue.length) {
    const items = settleQueue.splice(0, settleBatchMax);
    try {
      await requestBudget({ items, operation: "settle" });
    } catch {
      // La reserva sigue contada y caduca de forma segura si el envío falla.
    }
  }
}

/** Devuelve una promesa para event.waitUntil: mantiene vivo el worker hasta el envío. */
function settleTransfer(operation, reservationId) {
  settleQueue.push({ operation, reservationId });
  if (settleQueue.length >= settleBatchMax) return flushSettles();
  settleFlush ??= wait(settleDelayMs).then(flushSettles);
  return settleFlush;
}

async function refreshAccessToken() {
  const version = driveSessionVersion;
  if (!refreshPromise || refreshPromise.version !== version) {
    const operation = { promise: null, version };
    const tokenUrl = driveModule === "courses"
      ? "/api/drive-token?force=1"
      : `/api/drive-token?force=1&module=${encodeURIComponent(driveModule)}`;
    operation.promise = fetch(tokenUrl, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json();
        return typeof data.accessToken === "string" ? data.accessToken : null;
      })
      .finally(() => {
        if (refreshPromise === operation) refreshPromise = null;
      });
    refreshPromise = operation;
  }
  const operation = refreshPromise;
  const token = await operation.promise;
  if (operation.version !== driveSessionVersion) return null;
  if (token) {
    driveAccessToken = token;
    driveAccessInvalidated = false;
  }
  return token;
}

async function fetchFromDrive(url, requestHeaders) {
  const headers = new Headers(requestHeaders);
  headers.set("Authorization", `Bearer ${driveAccessToken}`);
  let refreshedToken = false;
  let transientRetries = 0;
  while (true) {
    let response;
    try {
      response = await fetch(url, { headers, method: "GET", mode: "cors" });
    } catch (error) {
      if (transientRetries >= maxTransferRetries) throw error;
      await wait(retryDelay(null, transientRetries));
      transientRetries += 1;
      continue;
    }

    if (response.status === 401 && !refreshedToken) {
      const freshToken = await refreshAccessToken();
      if (!freshToken) return response;
      headers.set("Authorization", `Bearer ${freshToken}`);
      refreshedToken = true;
      continue;
    }

    const transient = response.status === 429 || response.status >= 500;
    if (!transient || transientRetries >= maxTransferRetries) return response;
    const delay = retryDelay(response, transientRetries);
    if (delay === null) return response;
    await wait(delay);
    transientRetries += 1;
  }
}

// No se inspecciona ni transforma el cuerpo del MP4 en el Service Worker.
// La prueba de TransformStream bloqueó la reproducción nativa; la medición se
// observa desde PerformanceResourceTiming en la página de validación.

/** Reserva + descarga. Secuencial en frío, en paralelo cuando hay una reserva reciente aprobada. */
async function budgetedDriveFetch(event, fileId, kind, range, driveRequest) {
  const optimistic = Date.now() < budgetWarmUntil;
  const reservationPromise = reserveTransfer(fileId, kind, range);
  let drivePromise = null;
  if (optimistic) drivePromise = driveRequest().then((response) => ({ response }), (error) => ({ error }));

  const reservation = await reservationPromise;
  if (reservation.error) {
    budgetWarmUntil = 0;
    if (drivePromise) void drivePromise.then((result) => result.response?.body?.cancel()).catch(() => undefined);
    return reservation.error;
  }
  budgetWarmUntil = Date.now() + budgetWarmMs;
  if (!drivePromise) drivePromise = driveRequest().then((response) => ({ response }), (error) => ({ error }));

  const result = await drivePromise;
  if (result.error || !result.response) {
    event.waitUntil(settleTransfer("release", reservation.reservationId));
    void announceTransferNotice("drive-unavailable");
    return new Response("Google Drive está temporalmente indisponible.", { status: 503 });
  }
  const response = result.response;
  if (!response.ok) {
    event.waitUntil(settleTransfer("release", reservation.reservationId));
    if (response.status === 429 || response.status >= 500) void announceTransferNotice("drive-unavailable");
    return response;
  }
  event.waitUntil(settleTransfer("confirm", reservation.reservationId));
  return response;
}

function proxyFallback(url) {
  const packageId = url.searchParams.get("pkg");
  const relativePath = url.searchParams.get("p");
  if (!packageId || !relativePath) return null;
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `/api/drive-token/media-playback/packages/${encodeURIComponent(packageId)}/${encodedPath}`;
}

async function handleDirectHls(event, url) {
  const fileId = decodeURIComponent(url.pathname.slice("/drive-hls/".length));
  const fallback = proxyFallback(url);
  if (url.searchParams.get("m") === "movies" || url.searchParams.get("m") === "series") driveModule = url.searchParams.get("m");
  if (!fileId) return new Response("Archivo no válido.", { status: 404 });
  if (!driveAccessToken && !(await refreshAccessToken())) {
    return fallback ? fetch(fallback, { credentials: "same-origin" }) : new Response("Drive authorization is missing.", { status: 401 });
  }
  const headers = new Headers();
  const range = event.request.headers.get("Range");
  if (range) headers.set("Range", range);
  const response = await budgetedDriveFetch(
    event,
    fileId,
    "stream",
    range,
    () => fetchFromDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, headers),
  );
  // Si Google rechaza la lectura directa, el servidor lo intenta con su propio canal.
  if (fallback && (response.status === 403 || response.status >= 500) && response.status !== 429) {
    return fetch(fallback, { credentials: "same-origin" });
  }
  if (!response.ok) return response;
  // Los segmentos son inmutables: se entregan sin cabeceras de Google que
  // impidan reutilizarlos al retroceder dentro de la misma sesión.
  const out = new Headers(response.headers);
  out.set("cache-control", "private, max-age=86400, immutable");
  return new Response(response.body, { headers: out, status: response.status, statusText: response.statusText });
}

/**
 * Devuelve la respuesta de Google con las cabeceras de rango completas.
 * Google no expone Content-Range ni Accept-Ranges a peticiones CORS, y Safari
 * rechaza vídeo por rangos si faltan. Si no se puede calcular con seguridad,
 * se devuelve la respuesta original sin tocar.
 */
function withRangeHeaders(response, range, total) {
  if (!response.ok || !Number.isSafeInteger(total) || total <= 0) return response;
  const length = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0) return response;

  const headers = new Headers();
  headers.set("content-type", response.headers.get("content-type") || "video/mp4");
  headers.set("content-length", String(length));
  headers.set("accept-ranges", "bytes");

  if (response.status === 206) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
    if (!match || (!match[1] && !match[2])) return response;
    const start = match[1] ? Number(match[1]) : Math.max(total - Number(match[2]), 0);
    if (!Number.isSafeInteger(start) || start + length > total) return response;
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${total}`);
  } else if (response.status !== 200) {
    return response;
  }
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location?.origin && self.location) return;
  if (url.pathname.startsWith("/drive-hls/")) {
    event.respondWith(handleDirectHls(event, url));
    return;
  }
  const isStreamRequest = url.pathname.startsWith("/drive-stream/");
  const isDownloadRequest = url.pathname.startsWith("/drive-download/");
  const isMediaStreamRequest = url.pathname.startsWith("/media-stream/");
  if (!isStreamRequest && !isDownloadRequest && !isMediaStreamRequest) return;

  const pathPrefix = isMediaStreamRequest ? "/media-stream/" : isStreamRequest ? "/drive-stream/" : "/drive-download/";
  let fileId = url.pathname.slice(pathPrefix.length);
  if (!fileId) {
    event.respondWith(new Response("Drive authorization is missing.", { status: 401 }));
    return;
  }

  event.respondWith((async () => {
    if (isMediaStreamRequest) {
      const assetResponse = await fetch(`/api/media-hls/assets/${encodeURIComponent(fileId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const asset = await assetResponse.json().catch(() => ({}));
      if (!assetResponse.ok || typeof asset.driveFileId !== "string") {
        return new Response(typeof asset.error === "string" ? asset.error : "El archivo de reproducción no está disponible.", { status: assetResponse.status || 404 });
      }
      if (asset.module === "movies" || asset.module === "series") driveModule = asset.module;
      const manifestResponse = await fetch(`/api/media-hls/assets/${encodeURIComponent(fileId)}/manifest`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (manifestResponse.ok) return manifestResponse;
      if (manifestResponse.status !== 404) return manifestResponse;
      fileId = asset.driveFileId;
    }
    if (!driveAccessToken && !(await refreshAccessToken())) {
      return new Response("Drive authorization is missing.", { status: 401 });
    }
    // Solo se reenvía Range. Safari añade cabeceras propias a sus peticiones de
    // vídeo (X-Playback-Session-Id): Google las rechaza en la verificación previa
    // de CORS y la lectura falla. La ruta HLS ya enviaba solo Range.
    const range = event.request.headers.get("Range");
    const headers = new Headers();
    if (range) headers.set("Range", range);
    if (isDownloadRequest) headers.set("Accept", "application/json");
    const driveUrl = isDownloadRequest
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=webContentLink`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const response = await budgetedDriveFetch(
      event,
      fileId,
      isDownloadRequest ? "download" : "stream",
      range,
      () => fetchFromDrive(driveUrl, headers),
    );
    return isStreamRequest ? withRangeHeaders(response, range, fileSizes.get(fileId)) : response;
  })());
});
