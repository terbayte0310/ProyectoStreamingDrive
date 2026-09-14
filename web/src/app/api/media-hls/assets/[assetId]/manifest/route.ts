import { NextRequest, NextResponse } from "next/server";

import { isPlaylistAsset, rewriteHlsPlaylist } from "@/lib/media/hls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function GET(_request: NextRequest, context: RouteContext<"/api/media-hls/assets/[assetId]/manifest">) {
  const { assetId } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data: asset, error: assetError } = await supabase
    .from("media_hls_assets")
    .select("id, package_id, relative_path, playlist_body, asset_kind")
    .eq("id", assetId)
    .maybeSingle<{ asset_kind: string; id: string; package_id: string; playlist_body: string | null; relative_path: string }>();
  if (assetError || !asset || !isPlaylistAsset(asset.asset_kind) || !asset.playlist_body) {
    return noStoreJson({ error: "La lista HLS no está disponible." }, { status: 404 });
  }
  const { data: assets, error: assetsError } = await supabase
    .from("media_hls_assets")
    .select("id, relative_path")
    .eq("package_id", asset.package_id);
  if (assetsError || !assets) return noStoreJson({ error: "No se pudieron cargar los archivos del paquete." }, { status: 500 });
  const body = rewriteHlsPlaylist(asset.playlist_body, asset.relative_path, assets);
  return new NextResponse(body, { headers: { "cache-control": "private, no-store", "content-type": "application/vnd.apple.mpegurl; charset=utf-8" } });
}
