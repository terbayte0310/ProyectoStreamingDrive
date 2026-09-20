type HlsAsset = { id: string; relative_path: string };
type HlsPathAsset = { relative_path: string };

function internalPackagePath(reference: string) {
  let pathname: string;
  try {
    pathname = new URL(reference, "http://hls.local").pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/api\/(?:media-hls\/packages|drive-token\/media-playback\/packages)\/[^/]+\/(.+)$/);
  if (!match?.[1]) return null;
  try {
    return match[1].split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

function normalizeRelativePath(basePath: string, reference: string) {
  const internalPath = internalPackagePath(reference);
  if (internalPath) return internalPath;
  const base = basePath.split("/").slice(0, -1);
  const target = reference.split("?")[0]?.split("#")[0] ?? reference;
  const parts = [...base, ...target.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join("/");
}

function rewritePlaylist(
  playlistBody: string,
  playlistPath: string,
  byPath: Map<string, string>,
  makeUrl: (path: string) => string,
  rewriteEveryLocalReference = false,
  wrapStandaloneSubtitles = false,
) {
  const rewriteReference = (reference: string, subtitleRendition = false) => {
    if (!reference || /^(?:data:|blob:)/i.test(reference)) return reference;
    if (/^https?:/i.test(reference) && !internalPackagePath(reference)) return reference;
    const normalizedPath = normalizeRelativePath(playlistPath, reference);
    const target = byPath.get(normalizedPath) ?? (rewriteEveryLocalReference ? normalizedPath : null);
    if (!target) return reference;
    const url = makeUrl(target);
    return wrapStandaloneSubtitles && subtitleRendition && target.toLowerCase().endsWith(".vtt")
      ? `${url}?hls-subtitle-playlist=1`
      : url;
  };
  return playlistBody.split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (!line.startsWith("#")) return rewriteReference(line.trim());
    const subtitleRendition = /^#EXT-X-MEDIA:.*\bTYPE=SUBTITLES\b/i.test(line);
    return line.replace(/URI=("([^"]+)"|'([^']+)'|([^,\s]+))/g, (whole, raw, doubleQuoted, singleQuoted, unquoted) => {
      const reference = doubleQuoted ?? singleQuoted ?? unquoted;
      const rewritten = rewriteReference(reference, subtitleRendition);
      if (rewritten === reference) return whole;
      const quote = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : "";
      return `URI=${quote}${rewritten}${quote}`;
    });
  }).join("\n");
}

export function rewriteHlsPlaylist(playlistBody: string, playlistPath: string, assets: HlsAsset[]) {
  const byPath = new Map(assets.map((asset) => [asset.relative_path, asset.id]));
  return rewritePlaylist(playlistBody, playlistPath, byPath, (assetId) => `/media-stream/${assetId}`);
}

export function rewriteHlsPlaylistForPackage(playlistBody: string, playlistPath: string, assets: HlsPathAsset[], packageId: string) {
  const byPath = new Map(assets.map((asset) => [asset.relative_path, asset.relative_path]));
  // Drive credentials are intentionally scoped to /api/drive-token. Keep every
  // physical HLS asset under that prefix so the browser sends the HttpOnly
  // credentials without exposing them to unrelated application routes.
  const base = `/api/drive-token/media-playback/packages/${encodeURIComponent(packageId)}`;
  return rewritePlaylist(
    playlistBody,
    playlistPath,
    byPath,
    (path) => `${base}/${path.split("/").map(encodeURIComponent).join("/")}`,
    true,
    true,
  );
}

export type HlsDirectAsset = { asset_kind: string; drive_file_id: string; relative_path: string };
export type HlsDeliveryModule = "movies" | "series";

function packageAssetUrl(packageId: string, path: string) {
  return `/api/drive-token/media-playback/packages/${encodeURIComponent(packageId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Entrega directa: las listas siguen pasando por el servidor (son pequeñas y
 * aplican permisos), pero cada segmento apunta a /drive-hls/{id}, que el
 * service worker descarga de Google sin el salto por Vercel. p/pkg permiten al
 * worker volver al proxy del servidor si la lectura directa falla.
 */
export function rewriteHlsPlaylistForDirect(
  playlistBody: string,
  playlistPath: string,
  assets: HlsDirectAsset[],
  packageId: string,
  module: HlsDeliveryModule,
) {
  const byPath = new Map(assets.map((asset) => [asset.relative_path, asset]));
  return rewritePlaylist(
    playlistBody,
    playlistPath,
    new Map(assets.map((asset) => [asset.relative_path, asset.relative_path])),
    (path) => {
      const asset = byPath.get(path);
      const lower = path.toLowerCase();
      if (lower.endsWith(".m3u8")) return `${packageAssetUrl(packageId, path)}?delivery=direct&m=${module}`;
      if (!asset || asset.asset_kind === "subtitle" || lower.endsWith(".vtt") || isPlaylistAsset(asset.asset_kind)) return packageAssetUrl(packageId, path);
      const query = new URLSearchParams({ m: module, p: path, pkg: packageId });
      return `/drive-hls/${encodeURIComponent(asset.drive_file_id)}?${query}`;
    },
    true,
    true,
  );
}

export function isPlaylistAsset(kind: string) {
  return kind === "master_playlist" || kind === "media_playlist";
}
