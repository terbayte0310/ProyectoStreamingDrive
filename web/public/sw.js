let driveAccessToken = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type === "drive-access-token" && typeof event.data.token === "string") {
    driveAccessToken = event.data.token;
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isStreamRequest = url.pathname.startsWith("/drive-stream/");
  const isDownloadRequest = url.pathname.startsWith("/drive-download/");
  if (!isStreamRequest && !isDownloadRequest) return;

  const pathPrefix = isStreamRequest ? "/drive-stream/" : "/drive-download/";
  const fileId = url.pathname.slice(pathPrefix.length);
  if (!fileId || !driveAccessToken) {
    event.respondWith(new Response("Drive authorization is missing.", { status: 401 }));
    return;
  }

  const headers = new Headers(event.request.headers);
  headers.set("Authorization", `Bearer ${driveAccessToken}`);

  if (isDownloadRequest) {
    headers.set("Accept", "application/json");
    event.respondWith(
      fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=webContentLink`,
        { headers, method: "GET", mode: "cors" },
      ),
    );
    return;
  }

  event.respondWith(
    fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers,
      method: "GET",
      mode: "cors",
    }),
  );
});
