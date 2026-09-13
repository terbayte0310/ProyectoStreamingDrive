let driveAccessToken = null;
let refreshPromise = null;
let driveSessionVersion = 0;
let driveAccessInvalidated = false;

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
    event.ports[0]?.postMessage({ cleared: true });
  }
});

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
  let response = await fetch(url, { headers, method: "GET", mode: "cors" });
  if (response.status !== 401) return response;

  const freshToken = await refreshAccessToken();
  if (!freshToken) return response;
  headers.set("Authorization", `Bearer ${freshToken}`);
  response = await fetch(url, { headers, method: "GET", mode: "cors" });
  return response;
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
    if (isDownloadRequest) {
      headers.set("Accept", "application/json");
      return fetchFromDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=webContentLink`, headers);
    }
    return fetchFromDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, headers);
  })());
});
