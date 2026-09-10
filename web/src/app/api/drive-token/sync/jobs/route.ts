import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { createRootSnapshotItem } from "@/lib/drive/durable-sync";
import { getDriveConfig } from "@/lib/drive/config";
import { DRIVE_REFRESH_COOKIE, DRIVE_USER_COOKIE } from "@/lib/drive/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TaskProgress = { completed: number; failed: number; job_id: string; processing: number; queued: number };
type CreateMode = "full" | "new_courses";

export async function GET() {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") return NextResponse.json({ error: "Se requiere acceso de administrador." }, { status: 403 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("drive_sync_jobs")
    .select("id, status, mode, counters, heartbeat_at, started_at, finished_at, error_summary")
    .eq("initiated_by", access.user.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return NextResponse.json({ error: "No se pudo consultar el historial de sincronizaciones." }, { status: 500 });
  const jobIds = (data ?? []).map((job) => job.id);
  const { data: tasks, error: tasksError } = jobIds.length
    ? await supabase.rpc("get_drive_sync_job_progress", { p_job_ids: jobIds }).returns<TaskProgress[]>()
    : { data: [] as TaskProgress[], error: null };
  if (tasksError) return NextResponse.json({ error: "No se pudo consultar el avance de las carpetas." }, { status: 500 });
  const progressByJob = new Map<string, { completed: number; failed: number; processing: number; queued: number }>();
  const taskProgress = Array.isArray(tasks) ? tasks as TaskProgress[] : [];
  for (const task of taskProgress) {
    progressByJob.set(task.job_id, { completed: Number(task.completed), failed: Number(task.failed), processing: Number(task.processing), queued: Number(task.queued) });
  }
  return NextResponse.json({ jobs: (data ?? []).map((job) => ({ ...job, task_progress: progressByJob.get(job.id) ?? { completed: 0, failed: 0, processing: 0, queued: 0 } })) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") return NextResponse.json({ error: "Se requiere acceso de administrador." }, { status: 403 });
  if (request.cookies.get(DRIVE_USER_COOKIE)?.value !== access.user.id || !request.cookies.get(DRIVE_REFRESH_COOKIE)?.value) {
    return NextResponse.json({ error: "Debes autorizar Google Drive con esta cuenta." }, { status: 401 });
  }

  const config = getDriveConfig();
  const supabase = await createSupabaseServerClient();
  const body = await request.json().catch(() => ({})) as { mode?: CreateMode };
  const mode = body.mode === "new_courses" ? "new_courses" : "full";

  if (mode === "new_courses") {
    const { data: jobId, error: incrementalError } = await supabase
      .rpc("create_new_courses_drive_sync_job", { p_root_folder_id: config.rootFolderId, p_root_name: "100_BIBLIOTECA_DE_CURSOS" })
      .returns<string>();
    if (incrementalError || !jobId) return NextResponse.json({ error: incrementalError?.message ?? "No se pudo preparar la búsqueda de cursos nuevos." }, { status: 400 });
    const { data: job, error: jobError } = await supabase
      .from("drive_sync_jobs")
      .select("id, status, mode, counters, heartbeat_at, started_at, finished_at, error_summary")
      .eq("id", jobId)
      .single<{ id: string; status: string; counters: Record<string, number>; heartbeat_at: string | null; started_at: string; finished_at: string | null; error_summary: string | null }>();
    if (jobError || !job) return NextResponse.json({ error: "Se preparó la búsqueda, pero no se pudo leer su estado." }, { status: 500 });
    return NextResponse.json({ job }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  }

  const { data: job, error: jobError } = await supabase
    .from("drive_sync_jobs")
    .insert({ initiated_by: access.user.id, root_folder_id: config.rootFolderId, root_name: "100_BIBLIOTECA_DE_CURSOS" })
    .select("id, status, mode, counters, heartbeat_at, started_at, finished_at, error_summary")
    .single<{ id: string; status: string; counters: Record<string, number>; heartbeat_at: string | null; started_at: string; finished_at: string | null; error_summary: string | null }>();
  if (jobError || !job) return NextResponse.json({ error: "No se pudo crear la sincronización." }, { status: 500 });

  const root = createRootSnapshotItem(config.rootFolderId, "100_BIBLIOTECA_DE_CURSOS");
  const { error: itemError } = await supabase.from("drive_sync_job_items").insert({
    byte_size: root.byteSize,
    category_drive_file_id: root.categoryDriveFileId,
    course_drive_file_id: root.courseDriveFileId,
    detected_name: root.name,
    detected_position: root.detectedPosition,
    detected_title: root.detectedTitle,
    drive_file_id: root.driveFileId,
    is_folder: root.isFolder,
    item_status: root.status,
    job_id: job.id,
    kind: root.kind,
    mime_type: root.mimeType,
    modified_at_drive: root.modifiedAt,
    parent_drive_file_id: root.parentDriveFileId,
    parent_section_drive_file_id: root.parentSectionDriveFileId,
  });
  const { error: taskError } = await supabase.from("drive_sync_job_tasks").insert({ folder_drive_file_id: config.rootFolderId, job_id: job.id, kind: "root" });
  if (itemError || taskError) {
    await supabase.from("drive_sync_jobs").update({ error_summary: "No se pudo preparar la cola inicial.", status: "failed" }).eq("id", job.id);
    return NextResponse.json({ error: "No se pudo preparar la cola inicial." }, { status: 500 });
  }
  return NextResponse.json({ job }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
