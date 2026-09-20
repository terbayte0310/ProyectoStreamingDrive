import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/access";
import { getDriveTokenForMedia } from "@/lib/drive/media-hls";
import { type HlsDirectAsset, isPlaylistAsset, rewriteHlsPlaylistForDirect, rewriteHlsPlaylistForPackage } from "@/lib/media/hls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Listas: pocos KB y estables por paquete. Segmentos: inmutables por ruta.
const playlistCache = "private, max-age=300";
const segmentCache = "private, max-age=86400, immutable";

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

  // Identidad local (JWT) sin consultar el perfil: la política RLS de
  // media_hls_assets ya exige cuenta autorizada, módulo y contenido publicado.
  const userId = await getSessionUserId();
  if (!userId) return error("Debes iniciar sesión.", 401);
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
        "cache-control": playlistCache,
        "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
      },
    });
  }

  if (isPlaylistAsset(asset.asset_kind) && asset.playlist_body) {
    const deliveryModule = request.nextUrl.searchParams.get("m");
    if (request.nextUrl.searchParams.get("delivery") === "direct" && (deliveryModule === "movies" || deliveryModule === "series")) {
      // Solo los archivos de la carpeta de esta lista: un índice de vídeo no
      // necesita las rutas de los audios ni de otros idiomas.
      const directory = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/") + 1) : "";
      // PostgREST devuelve como máximo 1000 filas por respuesta: una película
      // de dos horas en segmentos de 6 s supera ese número, así que se pagina.
      const assets: HlsDirectAsset[] = [];
      for (let page = 0; page < 30; page += 1) {
        let query = supabase
          .from("media_hls_assets")
          .select("relative_path, drive_file_id, asset_kind")
          .eq("package_id", packageId)
          .eq("is_active", true);
        if (directory) query = query.like("relative_path", `${directory.replace(/[%_\\]/g, "\\$&")}%`);
        const { data, error: assetsError } = await query.order("relative_path").range(page * 1000, page * 1000 + 999).returns<HlsDirectAsset[]>();
        if (assetsError || !data) return error("No se pudieron cargar los archivos del paquete.", 500);
        assets.push(...data);
        if (data.length < 1000) break;
      }
      const body = rewriteHlsPlaylistForDirect(asset.playlist_body, relativePath, assets, packageId, deliveryModule);
      return new NextResponse(body, { headers: { "cache-control": playlistCache, "content-type": "application/vnd.apple.mpegurl; charset=utf-8" } });
    }
    // Cada referencia local se reescribe a la ruta con credenciales sin
    // necesidad de listar el paquete completo.
    const body = rewriteHlsPlaylistForPackage(asset.playlist_body, relativePath, [], packageId);
    return new NextResponse(body, { headers: { "cache-control": playlistCache, "content-type": "application/vnd.apple.mpegurl; charset=utf-8" } });
  }

  try {
    const token = await getDriveTokenForMedia(request, userId);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const range = request.headers.get("range");
    if (range) headers.set("Range", range);
    const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(asset.drive_file_id)}?alt=media`, {
      cache: "no-store",
      headers,
    });
    if (!driveResponse.ok) return error("No se pudo cargar el archivo desde Drive.", 502);
    const responseHeaders = new Headers({
      "cache-control": asset.asset_kind === "subtitle" ? playlistCache : segmentCache,
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
