import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { getDriveConfig } from "@/lib/drive/config";
import {
  listDriveChildren,
  listLibrarySnapshotIssues,
  scanDriveLibrary,
} from "@/lib/drive/library-snapshot";
import {
  clearDriveSessionCookies,
  DRIVE_REFRESH_COOKIE,
  DRIVE_USER_COOKIE,
  refreshDriveAccessToken,
  setDriveSessionCookies,
} from "@/lib/drive/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SyncMode = "preview" | "publish";
type Source = { drive_root_folder_id: string; id: string; name: string };

function fingerprintSnapshot(rootFolderId: string, items: unknown[]) {
  return createHash("sha256")
    .update(JSON.stringify({ items, rootFolderId }))
    .digest("hex");
}

export async function POST(request: NextRequest) {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") {
    return NextResponse.json({ error: "Se requiere acceso de administrador." }, { status: 403 });
  }

  const driveUserId = request.cookies.get(DRIVE_USER_COOKIE)?.value;
  const refreshToken = request.cookies.get(DRIVE_REFRESH_COOKIE)?.value;
  if (driveUserId !== access.user.id || !refreshToken) {
    const response = NextResponse.json({ error: "Debes autorizar Google Drive con esta cuenta." }, { status: 401 });
    clearDriveSessionCookies(response);
    return response;
  }

  let body: { confirmRootChange?: unknown; mode?: unknown; previewFingerprint?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "La solicitud de sincronización no es válida." }, { status: 400 });
  }
  const mode: SyncMode | null = body.mode === "preview" || body.mode === "publish" ? body.mode : null;
  if (!mode) return NextResponse.json({ error: "El modo debe ser preview o publish." }, { status: 400 });

  let token: Awaited<ReturnType<typeof refreshDriveAccessToken>>;
  try {
    token = await refreshDriveAccessToken(refreshToken);
  } catch {
    const response = NextResponse.json({ error: "La autorización de Drive venció o fue revocada." }, { status: 401 });
    clearDriveSessionCookies(response);
    return response;
  }

  const respond = (payload: unknown, status = 200) => {
    const response = NextResponse.json(payload, { status });
    setDriveSessionCookies(response, token, access.user.id);
    return response;
  };

  try {
    const config = getDriveConfig();
    const snapshot = await scanDriveLibrary({
      listChildren: (parentId) => listDriveChildren(token.access_token!, parentId),
      rootFolderId: config.rootFolderId,
    });
    const previewFingerprint = fingerprintSnapshot(config.rootFolderId, snapshot.items);
    const supabase = await createSupabaseServerClient();
    const { data: sources, error: sourceError } = await supabase
      .from("library_sources")
      .select("id, name, drive_root_folder_id")
      .eq("is_active", true)
      .order("created_at")
      .limit(2)
      .returns<Source[]>();
    if (sourceError) throw new Error("No se pudo consultar la fuente de biblioteca.");
    if ((sources?.length ?? 0) > 1) {
      return respond({ error: "Hay más de una fuente activa. Resuelve esa configuración antes de sincronizar." }, 409);
    }

    const existingSource = sources?.[0] ?? null;
    const pilotRootConfigured = Boolean(
      existingSource?.name.toLocaleLowerCase().includes("prueba"),
    );
    const rootChangeRequired = Boolean(
      existingSource && existingSource.drive_root_folder_id !== config.rootFolderId,
    );
    if (mode === "preview") {
      return respond({
        mode,
        issues: listLibrarySnapshotIssues(snapshot),
        pilotRootConfigured,
        rootChangeRequired,
        sourceExists: Boolean(existingSource),
        summary: snapshot.counters,
        previewFingerprint,
      });
    }
    if (pilotRootConfigured && !rootChangeRequired) {
      return respond({
        error: "La configuración todavía apunta a la raíz piloto. Cambia primero a 100_BIBLIOTECA_DE_CURSOS.",
        pilotRootConfigured: true,
      }, 409);
    }
    if (rootChangeRequired && body.confirmRootChange !== true) {
      return respond({
        error: "La raíz configurada cambió. Previsualiza y confirma la transición antes de publicar.",
        rootChangeRequired: true,
      }, 409);
    }
    if (body.previewFingerprint !== previewFingerprint) {
      return respond({
        error: "Drive cambió desde la última previsualización. Previsualiza de nuevo antes de publicar.",
      }, 409);
    }

    let sourceId = existingSource?.id;
    if (!sourceId) {
      const { data: createdSource, error: createSourceError } = await supabase
        .from("library_sources")
        .insert({ drive_root_folder_id: config.rootFolderId, name: "Biblioteca de cursos" })
        .select("id")
        .single<{ id: string }>();
      if (createSourceError || !createdSource) throw new Error("No se pudo crear la fuente de biblioteca.");
      sourceId = createdSource.id;
    }

    const { data: run, error: runError } = await supabase
      .from("catalog_sync_runs")
      .insert({ initiated_by: access.user.id, source_id: sourceId, status: "running" })
      .select("id")
      .single<{ id: string }>();
    if (runError?.code === "23505") {
      return respond({ error: "Ya existe una sincronización activa para esta biblioteca." }, 409);
    }
    if (runError || !run) throw new Error("No se pudo iniciar la ejecución de sincronización.");

    const { data: summary, error: reconcileError } = await supabase.rpc(
      "reconcile_library_snapshot",
      {
        p_items: snapshot.items,
        p_root_folder_id: config.rootFolderId,
        p_run_id: run.id,
        p_source_id: sourceId,
      },
    );
    if (reconcileError) {
      await supabase
        .from("catalog_sync_runs")
        .update({ error_summary: "La publicación atómica fue rechazada.", finished_at: new Date().toISOString(), status: "failed" })
        .eq("id", run.id);
      await supabase.from("library_sources").update({ last_scan_status: "failed" }).eq("id", sourceId);
      throw new Error("La publicación atómica fue rechazada.");
    }

    return respond({ mode, pilotRootConfigured: false, rootChangeRequired, runId: run.id, summary });
  } catch (error) {
    return respond({
      error: error instanceof Error ? error.message : "La sincronización no pudo completarse.",
    }, 500);
  }
}
