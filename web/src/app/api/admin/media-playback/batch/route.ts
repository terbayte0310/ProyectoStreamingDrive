import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { discoverHlsPackageFolders, getDriveTokenForMedia, MediaDriveError, scanHlsPackage } from "@/lib/drive/media-hls";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const batchSize = 5;
type ContentKind = "episode" | "movie";
type BatchBody = { refresh?: unknown; skipCodes?: unknown; sourceId?: unknown };
type Content = { id: string; kind: ContentKind };

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === getRequestOrigin(request);
}

async function requireAdmin() {
  const access = await getCurrentAccess();
  return access?.profile?.is_authorized && access.profile.role === "admin" ? access : null;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Origen no permitido." }, { status: 403 });
  const access = await requireAdmin();
  if (!access) return noStoreJson({ error: "Se requiere acceso de administrador." }, { status: 403 });
  const body = await request.json().catch(() => null) as BatchBody | null;
  if (!body || !isUuid(body.sourceId)) return noStoreJson({ error: "La fuente de Drive no es válida." }, { status: 400 });
  const refresh = body.refresh === true;
  const skipCodes = new Set(Array.isArray(body.skipCodes) ? body.skipCodes.filter((code): code is string => typeof code === "string" && /^(MOV-[0-9]{5,}|SER-[0-9]{5,}-S[0-9]{2}-E[0-9]{2,3})$/.test(code)) : []);

  const supabase = await createSupabaseServerClient();
  const { data: source, error: sourceError } = await supabase
    .from("media_drive_sources")
    .select("id, drive_root_folder_id, is_active")
    .eq("id", body.sourceId)
    .maybeSingle<{ drive_root_folder_id: string; id: string; is_active: boolean }>();
  if (sourceError || !source || !source.is_active) return noStoreJson({ error: "La fuente de medios no está disponible." }, { status: 404 });

  try {
    const token = await getDriveTokenForMedia(request, access.user.id);
    const [discovered, moviesResult, episodesResult, packagesResult] = await Promise.all([
      discoverHlsPackageFolders(token, source.drive_root_folder_id),
      supabase.from("movies").select("id, internal_code"),
      supabase.from("series_episodes").select("id, internal_code"),
      supabase.from("media_hls_packages").select("id, movie_id, episode_id, drive_root_folder_id, status"),
    ]);
    if (moviesResult.error || episodesResult.error || packagesResult.error) throw new MediaDriveError("No se pudo cargar el catálogo para el escaneo por lote.");

    const contentByCode = new Map<string, Content>();
    for (const movie of moviesResult.data ?? []) contentByCode.set(movie.internal_code, { id: movie.id, kind: "movie" });
    for (const episode of episodesResult.data ?? []) contentByCode.set(episode.internal_code, { id: episode.id, kind: "episode" });

    const countByCode = new Map<string, number>();
    for (const folder of discovered) countByCode.set(folder.internalCode, (countByCode.get(folder.internalCode) ?? 0) + 1);
    const duplicateCodes = Array.from(countByCode.entries()).filter(([, count]) => count > 1).map(([code]) => code);
    const duplicateSet = new Set(duplicateCodes);
    const candidates = discovered.filter((folder) => !duplicateSet.has(folder.internalCode));
    const unmatchedCodes = candidates.filter((folder) => !contentByCode.has(folder.internalCode)).map((folder) => folder.internalCode);
    const packages = packagesResult.data ?? [];
    const pending = candidates.filter((folder) => {
      if (skipCodes.has(folder.internalCode)) return false;
      const content = contentByCode.get(folder.internalCode);
      if (!content) return false;
      const existing = packages.find((entry) => content.kind === "movie" ? entry.movie_id === content.id : entry.episode_id === content.id);
      return refresh || !(existing?.status === "ready" && existing.drive_root_folder_id === folder.driveRootFolderId);
    });
    const selected = pending.slice(0, batchSize);
    const scanned: Array<{ assets: number; internalCode: string }> = [];
    const errors: Array<{ internalCode: string; message: string }> = [];

    for (const folder of selected) {
      const content = contentByCode.get(folder.internalCode)!;
      try {
        const scannedAssets = await scanHlsPackage(token, folder.driveRootFolderId);
        const relation = content.kind === "movie" ? { movie_id: content.id } : { episode_id: content.id };
        const relationColumn = content.kind === "movie" ? "movie_id" : "episode_id";
        const { data: existing } = await supabase.from("media_hls_packages").select("id").eq(relationColumn, content.id).maybeSingle<{ id: string }>();
        const packageRow = existing
          ? await supabase.from("media_hls_packages").update({ drive_root_folder_id: folder.driveRootFolderId, last_error: null, source_id: source.id, status: "draft" }).eq("id", existing.id).select("id").single()
          : await supabase.from("media_hls_packages").insert({ ...relation, drive_root_folder_id: folder.driveRootFolderId, source_id: source.id, status: "draft" }).select("id").single();
        if (packageRow.error || !packageRow.data) throw new MediaDriveError("No se pudo guardar el paquete HLS.");
        const packageId = packageRow.data.id;
        const { error: deactivateError } = await supabase.from("media_hls_assets").update({ is_active: false }).eq("package_id", packageId);
        if (deactivateError) throw new MediaDriveError("No se pudieron actualizar los archivos anteriores.");
        for (let start = 0; start < scannedAssets.length; start += 500) {
          const assets = scannedAssets.slice(start, start + 500).map((asset) => ({ ...asset, is_active: true, package_id: packageId }));
          const { error } = await supabase.from("media_hls_assets").upsert(assets, { onConflict: "package_id,relative_path" });
          if (error) throw new MediaDriveError("No se pudieron guardar los archivos detectados.");
        }
        const { data: master, error: masterError } = await supabase.from("media_hls_assets").select("id").eq("package_id", packageId).eq("relative_path", "master.m3u8").eq("is_active", true).maybeSingle<{ id: string }>();
        if (masterError || !master) throw new MediaDriveError("No se pudo registrar master.m3u8.");
        const { error: readyError } = await supabase.from("media_hls_packages").update({ last_error: null, manifest_asset_id: master.id, scanned_at: new Date().toISOString(), status: "ready" }).eq("id", packageId);
        if (readyError) throw new MediaDriveError("No se pudo activar el paquete HLS.");
        scanned.push({ assets: scannedAssets.length, internalCode: folder.internalCode });
      } catch (error) {
        errors.push({ internalCode: folder.internalCode, message: error instanceof Error ? error.message : "No se pudo escanear el paquete HLS." });
      }
    }

    return noStoreJson({
      duplicateCodes,
      errors,
      missingContentCodes: unmatchedCodes,
      remaining: Math.max(0, pending.length - selected.length),
      scanned,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar los paquetes HLS.";
    return noStoreJson({ error: message }, { status: error instanceof MediaDriveError ? 400 : 500 });
  }
}