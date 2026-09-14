import "server-only";

import { NextRequest } from "next/server";

import { DRIVE_ACCESS_COOKIE, DRIVE_REFRESH_COOKIE, DRIVE_USER_COOKIE, refreshDriveAccessToken } from "@/lib/drive/session";

type DriveNode = { id: string; mimeType: string; name: string; size?: string };
const folderMimeType = "application/vnd.google-apps.folder";

export class MediaDriveError extends Error {}

async function driveJson<T>(accessToken: string, input: string) {
  const response = await fetch(input, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new MediaDriveError(`Drive respondió ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function getDriveTokenForMedia(request: NextRequest, userId: string) {
  if (request.cookies.get(DRIVE_USER_COOKIE)?.value !== userId) {
    throw new MediaDriveError("Debes autorizar Google Drive con esta cuenta.");
  }
  const accessToken = request.cookies.get(DRIVE_ACCESS_COOKIE)?.value;
  if (accessToken) return accessToken;
  const refreshToken = request.cookies.get(DRIVE_REFRESH_COOKIE)?.value;
  if (!refreshToken) throw new MediaDriveError("Debes autorizar Google Drive.");
  const token = await refreshDriveAccessToken(refreshToken);
  return token.access_token!;
}

async function getDriveNode(accessToken: string, nodeId: string) {
  return driveJson<DriveNode>(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(nodeId)}?fields=id,name,mimeType,parents&supportsAllDrives=true`);
}

export async function assertFolderInsideSource(accessToken: string, packageFolderId: string, sourceFolderId: string) {
  let currentId: string | undefined = packageFolderId;
  for (let depth = 0; currentId && depth < 50; depth += 1) {
    const node = await getDriveNode(accessToken, currentId) as DriveNode & { parents?: string[] };
    if (node.mimeType !== folderMimeType) throw new MediaDriveError("El paquete debe ser una carpeta de Drive.");
    if (node.id === sourceFolderId) return;
    currentId = node.parents?.[0];
  }
  throw new MediaDriveError("La carpeta HLS no pertenece a la fuente de medios indicada.");
}

async function listFolder(accessToken: string, folderId: string) {
  const nodes: DriveNode[] = [];
  let pageToken = "";
  do {
    const parameters = new URLSearchParams({
      fields: "nextPageToken,files(id,name,mimeType,size)",
      includeItemsFromAllDrives: "true",
      pageSize: "1000",
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      supportsAllDrives: "true",
    });
    if (pageToken) parameters.set("pageToken", pageToken);
    const page = await driveJson<{ files?: DriveNode[]; nextPageToken?: string }>(accessToken, `https://www.googleapis.com/drive/v3/files?${parameters}`);
    nodes.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return nodes;
}

export type ScannedHlsAsset = {
  asset_kind: "audio" | "master_playlist" | "media_playlist" | "other" | "segment" | "subtitle";
  byte_size: number | null;
  content_type: string | null;
  drive_file_id: string;
  playlist_body: string | null;
  relative_path: string;
};

function classify(path: string, mimeType: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".m3u8")) return lower === "master.m3u8" ? "master_playlist" : "media_playlist";
  if (lower.endsWith(".vtt")) return "subtitle";
  if (lower.endsWith(".aac") || lower.endsWith(".m4a")) return "audio";
  if (lower.endsWith(".ts") || lower.endsWith(".m4s") || mimeType.startsWith("video/")) return "segment";
  return "other";
}

export async function scanHlsPackage(accessToken: string, rootFolderId: string) {
  const pending = [{ folderId: rootFolderId, path: "" }];
  const assets: ScannedHlsAsset[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    for (const node of await listFolder(accessToken, current.folderId)) {
      const relativePath = current.path ? `${current.path}/${node.name}` : node.name;
      if (node.mimeType === folderMimeType) {
        pending.push({ folderId: node.id, path: relativePath });
        continue;
      }
      if (assets.length >= 50_000) throw new MediaDriveError("El paquete supera el límite de 50 000 archivos.");
      const assetKind = classify(relativePath, node.mimeType);
      let playlistBody: string | null = null;
      if (assetKind === "master_playlist" || assetKind === "media_playlist") {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(node.id)}?alt=media`, { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok) throw new MediaDriveError(`No se pudo leer ${relativePath} desde Drive.`);
        playlistBody = await response.text();
        if (!playlistBody.startsWith("#EXTM3U")) throw new MediaDriveError(`${relativePath} no es una lista HLS válida.`);
      }
      assets.push({ asset_kind: assetKind, byte_size: node.size ? Number(node.size) : null, content_type: node.mimeType || null, drive_file_id: node.id, playlist_body: playlistBody, relative_path: relativePath });
    }
  }
  const masters = assets.filter((asset) => asset.asset_kind === "master_playlist");
  if (masters.length !== 1) throw new MediaDriveError("El paquete debe contener exactamente un master.m3u8 en su raíz.");
  if (!assets.some((asset) => asset.asset_kind === "media_playlist")) throw new MediaDriveError("El paquete no contiene listas HLS de vídeo o audio.");
  return assets;
}
