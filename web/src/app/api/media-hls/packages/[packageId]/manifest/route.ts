import { NextRequest, NextResponse } from "next/server";

import { rewriteHlsPlaylistForDirect, rewriteHlsPlaylistForPackage } from "@/lib/media/hls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function GET(request: NextRequest, context: RouteContext<"/api/media-hls/packages/[packageId]/manifest">) {
  const { packageId } = await context.params;
  const supabase = await createSupabaseServerClient();
  // RLS decide la visibilidad (módulo + publicado). Solo se lee el master: las
  // referencias locales se reescriben sin cargar los miles de segmentos del paquete.
  const { data: packageRow, error: packageError } = await supabase
    .from("media_hls_packages")
    .select("id, manifest_asset_id, movie_id")
    .eq("id", packageId)
    .maybeSingle<{ id: string; manifest_asset_id: string | null; movie_id: string | null }>();
  if (packageError || !packageRow?.manifest_asset_id) return noStoreJson({ error: "El paquete no está disponible." }, { status: 404 });

  const { data: manifest, error: manifestError } = await supabase
    .from("media_hls_assets")
    .select("relative_path, playlist_body, asset_kind")
    .eq("id", packageRow.manifest_asset_id)
    .eq("is_active", true)
    .maybeSingle<{ asset_kind: string; playlist_body: string | null; relative_path: string }>();
  if (manifestError) return noStoreJson({ error: "No se pudieron cargar los archivos del paquete." }, { status: 500 });
  if (!manifest?.playlist_body || manifest.asset_kind !== "master_playlist") {
    return noStoreJson({ error: "El manifiesto HLS no está listo." }, { status: 409 });
  }

  const direct = request.nextUrl.searchParams.get("delivery") === "direct";
  const body = direct
    ? rewriteHlsPlaylistForDirect(manifest.playlist_body, manifest.relative_path, [], packageRow.id, packageRow.movie_id ? "movies" : "series")
    : rewriteHlsPlaylistForPackage(manifest.playlist_body, manifest.relative_path, [], packageRow.id);
  // Privado: nunca se cachea en una CDN compartida; el navegador puede reutilizarlo unos minutos.
  return new NextResponse(body, { headers: { "cache-control": "private, max-age=300", "content-type": "application/vnd.apple.mpegurl; charset=utf-8" } });
}
