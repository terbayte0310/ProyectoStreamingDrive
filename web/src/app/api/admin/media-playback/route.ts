import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { assertFolderInsideSource, getDriveTokenForMedia, MediaDriveError, scanHlsPackage } from "@/lib/drive/media-hls";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Body = { action?: unknown; contentId?: unknown; contentKind?: unknown; driveRootFolderId?: unknown; name?: unknown; sourceId?: unknown };
type ContentKind = "episode" | "movie";

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isSameOrigin(request: NextRequest) { const origin = request.headers.get("origin"); return !origin || origin === getRequestOrigin(request); }
function isContentKind(value: unknown): value is ContentKind { return value === "movie" || value === "episode"; }
async function requireAdmin() { const access = await getCurrentAccess(); return access?.profile?.is_authorized && access.profile.role === "admin" ? access : null; }

export async function GET() {
  if (!await requireAdmin()) return noStoreJson({ error: "Se requiere acceso de administrador." }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  const [sources, packages] = await Promise.all([
    supabase.from("media_drive_sources").select("id, name, drive_root_folder_id, is_active").order("name"),
    supabase.from("media_hls_packages").select("id, movie_id, episode_id, source_id, drive_root_folder_id, status, last_error, scanned_at").order("updated_at", { ascending: false }),
  ]);
  if (sources.error || packages.error) return noStoreJson({ error: "No se pudo cargar la configuración de reproducción." }, { status: 500 });
  return noStoreJson({ packages: packages.data ?? [], sources: sources.data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Origen no permitido." }, { status: 403 });
  const access = await requireAdmin();
  if (!access) return noStoreJson({ error: "Se requiere acceso de administrador." }, { status: 403 });
  const body = await request.json().catch(() => null) as Body | null;
  if (!body || typeof body.action !== "string") return noStoreJson({ error: "La solicitud no es válida." }, { status: 400 });
  const supabase = await createSupabaseServerClient();

  if (body.action === "create-source") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const root = typeof body.driveRootFolderId === "string" ? body.driveRootFolderId.trim() : "";
    if (!name || name.length > 120 || !root) return noStoreJson({ error: "Nombre y carpeta raíz de Drive son obligatorios." }, { status: 400 });
    const { data, error } = await supabase.from("media_drive_sources").insert({ drive_root_folder_id: root, name }).select("id, name, drive_root_folder_id, is_active").single();
    if (error || !data) return noStoreJson({ error: "No se pudo guardar la fuente de medios." }, { status: 400 });
    return noStoreJson({ source: data }, { status: 201 });
  }

  if (body.action !== "scan" || !isContentKind(body.contentKind) || !isUuid(body.contentId) || !isUuid(body.sourceId) || typeof body.driveRootFolderId !== "string" || !body.driveRootFolderId.trim()) {
    return noStoreJson({ error: "La solicitud de escaneo no es válida." }, { status: 400 });
  }
  const packageRoot = body.driveRootFolderId.trim();
  const { data: source, error: sourceError } = await supabase.from("media_drive_sources").select("id, drive_root_folder_id, is_active").eq("id", body.sourceId).maybeSingle<{ drive_root_folder_id: string; id: string; is_active: boolean }>();
  if (sourceError || !source || !source.is_active) return noStoreJson({ error: "La fuente de medios no está disponible." }, { status: 404 });
  const table = body.contentKind === "movie" ? "movies" : "series_episodes";
  const { data: content } = await supabase.from(table).select("id").eq("id", body.contentId).maybeSingle();
  if (!content) return noStoreJson({ error: "El contenido no existe." }, { status: 404 });
  try {
    const token = await getDriveTokenForMedia(request, access.user.id);
    await assertFolderInsideSource(token, packageRoot, source.drive_root_folder_id);
    const scannedAssets = await scanHlsPackage(token, packageRoot);
    const relation = body.contentKind === "movie" ? { movie_id: body.contentId } : { episode_id: body.contentId };
    const relationColumn = body.contentKind === "movie" ? "movie_id" : "episode_id";
    const { data: existing } = await supabase.from("media_hls_packages").select("id").eq(relationColumn, body.contentId).maybeSingle<{ id: string }>();
    const packageRow = existing
      ? (await supabase.from("media_hls_packages").update({ drive_root_folder_id: packageRoot, last_error: null, source_id: source.id, status: "draft" }).eq("id", existing.id).select("id").single())
      : await supabase.from("media_hls_packages").insert({ ...relation, drive_root_folder_id: packageRoot, source_id: source.id, status: "draft" }).select("id").single();
    if (packageRow.error || !packageRow.data) throw new MediaDriveError("No se pudo guardar el paquete HLS.");
    const packageId = packageRow.data.id;
    const { error: deactivateError } = await supabase.from("media_hls_assets").update({ is_active: false }).eq("package_id", packageId);
    if (deactivateError) throw new MediaDriveError("No se pudieron actualizar los archivos anteriores.");
    for (let start = 0; start < scannedAssets.length; start += 500) {
      const batch = scannedAssets.slice(start, start + 500).map((asset) => ({ ...asset, is_active: true, package_id: packageId }));
      const { error } = await supabase.from("media_hls_assets").upsert(batch, { onConflict: "package_id,relative_path" });
      if (error) throw new MediaDriveError("No se pudieron guardar los archivos detectados.");
    }
    const { data: master, error: masterError } = await supabase.from("media_hls_assets").select("id").eq("package_id", packageId).eq("relative_path", "master.m3u8").eq("is_active", true).maybeSingle<{ id: string }>();
    if (masterError || !master) throw new MediaDriveError("No se pudo registrar master.m3u8.");
    const { error: readyError } = await supabase.from("media_hls_packages").update({ last_error: null, manifest_asset_id: master.id, scanned_at: new Date().toISOString(), status: "ready" }).eq("id", packageId);
    if (readyError) throw new MediaDriveError("No se pudo activar el paquete HLS.");
    return noStoreJson({ packageId, scannedAssets: scannedAssets.length, status: "ready" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo escanear el paquete HLS.";
    return noStoreJson({ error: message }, { status: error instanceof MediaDriveError ? 400 : 500 });
  }
}
