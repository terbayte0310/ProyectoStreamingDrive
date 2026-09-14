import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function GET(_request: NextRequest, context: RouteContext<"/api/media-hls/assets/[assetId]">) {
  const { assetId } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data: asset, error: assetError } = await supabase
    .from("media_hls_assets")
    .select("drive_file_id, package_id")
    .eq("id", assetId)
    .maybeSingle<{ drive_file_id: string; package_id: string }>();
  if (assetError || !asset) return noStoreJson({ error: "El archivo de reproducción no está disponible." }, { status: 404 });
  const { data: packageRow, error: packageError } = await supabase
    .from("media_hls_packages")
    .select("movie_id, episode_id")
    .eq("id", asset.package_id)
    .maybeSingle<{ episode_id: string | null; movie_id: string | null }>();
  if (packageError || !packageRow) return noStoreJson({ error: "El paquete no está disponible." }, { status: 404 });
  return noStoreJson({ driveFileId: asset.drive_file_id, module: packageRow.movie_id ? "movies" : "series" });
}
