import "server-only";

type HlsAsset = { id: string; relative_path: string };

function normalizeRelativePath(basePath: string, reference: string) {
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

function rewriteReference(reference: string, basePath: string, byPath: Map<string, string>) {
  if (!reference || /^(?:https?:|data:|blob:)/i.test(reference)) return reference;
  const assetId = byPath.get(normalizeRelativePath(basePath, reference));
  return assetId ? `/media-stream/${assetId}` : reference;
}

export function rewriteHlsPlaylist(playlistBody: string, playlistPath: string, assets: HlsAsset[]) {
  const byPath = new Map(assets.map((asset) => [asset.relative_path, asset.id]));
  return playlistBody.split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (!line.startsWith("#")) return rewriteReference(line.trim(), playlistPath, byPath);
    return line.replace(/URI=("([^"]+)"|'([^']+)'|([^,\s]+))/g, (whole, raw, doubleQuoted, singleQuoted, unquoted) => {
      const reference = doubleQuoted ?? singleQuoted ?? unquoted;
      const rewritten = rewriteReference(reference, playlistPath, byPath);
      if (rewritten === reference) return whole;
      const quote = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : "";
      return `URI=${quote}${rewritten}${quote}`;
    });
  }).join("\n");
}

export function isPlaylistAsset(kind: string) {
  return kind === "master_playlist" || kind === "media_playlist";
}
