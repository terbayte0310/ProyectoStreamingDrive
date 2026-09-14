import { NextRequest, NextResponse } from "next/server";

import { rewriteHlsPlaylist } from "@/lib/media/hls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function GET(_request: NextRequest, context: RouteContext<"/api/media-hls/packages/[packageId]/manifest">) {
  const { packageId } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data: packageRow, error: packageError } = await supabase
    .from("media_hls_packages")
    .select("id, manifest_asset_id")
    .eq("id", packageId)
    .maybeSingle<{ id: string; manifest_asset_id: string | null }>();
  if (packageError || !packageRow?.manifest_asset_id) return noStoreJson({ error: "El paquete no está disponible." }, { status: 404 });

  const { data: assets, error: assetsError } = await supabase
    .from("media_hls_assets")
    .select("id, relative_path, playlist_body, asset_kind")
    .eq("package_id", packageRow.id);
  if (assetsError || !assets) return noStoreJson({ error: "No se pudieron cargar los archivos del paquete." }, { status: 500 });
  const manifest = assets.find((asset) => asset.id === packageRow.manifest_asset_id);
  if (!manifest?.playlist_body || manifest.asset_kind !== "master_playlist") {
    return noStoreJson({ error: "El manifiesto HLS no está listo." }, { status: 409 });
  }
  const body = rewriteHlsPlaylist(manifest.playlist_body, manifest.relative_path, assets);
  return new NextResponse(body, { headers: { "cache-control": "private, no-store", "content-type": "application/vnd.apple.mpegurl; charset=utf-8" } });
}
