import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { getDriveTokenForMedia } from "@/lib/drive/media-hls";
import { isPlaylistAsset, rewriteHlsPlaylistForPackage } from "@/lib/media/hls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  const response = NextResponse.json({ error: message }, { status });
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function GET(request: NextRequest, context: { params: Promise<{ packageId: string; path: string[] }> }) {
  const { packageId, path } = await context.params;
  if (!path.length || path.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
    return error("El archivo de reproducción no está disponible.", 404);
  }

  // Old manifests and already-open players may still request the former route.
  // Redirect them before reading Drive cookies: those credentials are
  // intentionally available only below /api/drive-token.
  if (request.nextUrl.pathname.startsWith("/api/media-hls/packages/")) {
    const destination = new URL(
      `/api/drive-token/media-playback/packages/${encodeURIComponent(packageId)}/${path.map(encodeURIComponent).join("/")}`,
      request.url,
    );
    destination.search = request.nextUrl.search;
    const response = NextResponse.redirect(destination, 307);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }

  const access = await getCurrentAccess();
  if (!access?.user?.id) return error("Debes iniciar sesión.", 401);
  const supabase = await createSupabaseServerClient();
  const relativePath = path.join("/");
  const { data: asset, error: assetError } = await supabase
    .from("media_hls_assets")
    .select("drive_file_id, content_type, asset_kind, playlist_body")
    .eq("package_id", packageId)
    .eq("relative_path", relativePath)
    .eq("is_active", true)
    .maybeSingle<{ asset_kind: string; content_type: string | null; drive_file_id: string; playlist_body: string | null }>();
  if (assetError || !asset) return error("El archivo de reproducción no está disponible.", 404);

  if (asset.asset_kind === "subtitle" && request.nextUrl.searchParams.get("hls-subtitle-playlist") === "1") {
    const subtitleUrl = new URL(request.url);
    subtitleUrl.search = "";
    subtitleUrl.searchParams.set("hls-subtitle-file", "1");
    const body = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXT-X-TARGETDURATION:86400",
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXTINF:86400.000,",
      subtitleUrl.pathname + subtitleUrl.search,
      "#EXT-X-ENDLIST",
      "",
    ].join("\n");
    return new NextResponse(body, {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
      },
    });
  }

  if (isPlaylistAsset(asset.asset_kind) && asset.playlist_body) {
    const { data: assets, error: assetsError } = await supabase
      .from("media_hls_assets")
      .select("relative_path")
      .eq("package_id", packageId)
      .eq("is_active", true);
    if (assetsError || !assets) return error("No se pudieron cargar los archivos del paquete.", 500);
    const body = rewriteHlsPlaylistForPackage(asset.playlist_body, relativePath, assets, packageId);
    return new NextResponse(body, { headers: { "cache-control": "private, no-store", "content-type": "application/vnd.apple.mpegurl; charset=utf-8" } });
  }

  try {
    const token = await getDriveTokenForMedia(request, access.user.id);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const range = request.headers.get("range");
    if (range) headers.set("Range", range);
    const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(asset.drive_file_id)}?alt=media`, {
      cache: "no-store",
      headers,
    });
    if (!driveResponse.ok) return error("No se pudo cargar el archivo desde Drive.", 502);
    const responseHeaders = new Headers({
      "cache-control": "private, no-store",
      "content-type": asset.asset_kind === "subtitle" ? "text/vtt; charset=utf-8" : (asset.content_type || "application/octet-stream"),
    });
    for (const header of ["accept-ranges", "content-length", "content-range"]) {
      const value = driveResponse.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }
    return new NextResponse(driveResponse.body, { headers: responseHeaders, status: driveResponse.status });
  } catch {
    return error("No se pudo autorizar Google Drive para cargar este archivo.", 401);
  }
}
