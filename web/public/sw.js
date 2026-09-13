let driveAccessToken = null;
let refreshPromise = null;
let driveSessionVersion = 0;
let driveAccessInvalidated = false;
const announcedTransferNotices = new Set();
const maxTransferRetries = 2;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type === "drive-access-token" && typeof event.data.token === "string") {
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
    announcedTransferNotices.clear();
    event.ports[0]?.postMessage({ cleared: true });
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
    response = await requestBudget({ fileId, kind, operation: "reserve", range });
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
  return { reservationId: data.reservationId };
}

async function settleTransfer(operation, reservationId) {
  try {
    await requestBudget({ operation, reservationId });
  } catch {
    // The reservation remains counted and expires safely if finalization fails.
  }
}

async function refreshAccessToken() {
  const version = driveSessionVersion;
  if (!refreshPromise || refreshPromise.version !== version) {
    const operation = { promise: null, version };
    operation.promise = fetch("/api/drive-token?force=1", {
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isStreamRequest = url.pathname.startsWith("/drive-stream/");
  const isDownloadRequest = url.pathname.startsWith("/drive-download/");
  if (!isStreamRequest && !isDownloadRequest) return;

  const pathPrefix = isStreamRequest ? "/drive-stream/" : "/drive-download/";
  const fileId = url.pathname.slice(pathPrefix.length);
  if (!fileId) {
    event.respondWith(new Response("Drive authorization is missing.", { status: 401 }));
    return;
  }

  event.respondWith((async () => {
    if (!driveAccessToken && !(await refreshAccessToken())) {
      return new Response("Drive authorization is missing.", { status: 401 });
    }
    const headers = new Headers(event.request.headers);
    const reservation = await reserveTransfer(
      fileId,
      isDownloadRequest ? "download" : "stream",
      headers.get("Range"),
    );
    if (reservation.error) return reservation.error;

    let response;
    try {
      if (isDownloadRequest) {
        headers.set("Accept", "application/json");
        response = await fetchFromDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=webContentLink`, headers);
      } else {
        response = await fetchFromDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, headers);
      }
    } catch {
      await settleTransfer("release", reservation.reservationId);
      void announceTransferNotice("drive-unavailable");
      return new Response("Google Drive está temporalmente indisponible.", { status: 503 });
    }

    if (!response.ok) {
      await settleTransfer("release", reservation.reservationId);
      if (response.status === 429 || response.status >= 500) void announceTransferNotice("drive-unavailable");
      return response;
    }
    event.waitUntil(settleTransfer("confirm", reservation.reservationId));
    return response;
  })());
});
