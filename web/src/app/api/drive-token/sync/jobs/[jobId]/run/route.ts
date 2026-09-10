import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { createDurableTaskResult, createIncrementalCategoryTaskResult, type DurableSyncTask, type KnownDurableCourse } from "@/lib/drive/durable-sync";
import { DriveApiError, FOLDER_MIME_TYPE, listDriveChildren, type DriveFile } from "@/lib/drive/library-snapshot";
import { DRIVE_REFRESH_COOKIE, DRIVE_USER_COOKIE, refreshDriveAccessToken, setDriveSessionCookies } from "@/lib/drive/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TASKS_PER_BATCH = 4;
type SyncMode = "full" | "new_courses";
type StoredCourse = { category_drive_file_id: string | null; drive_file_id: string };

class IncrementalSyncError extends Error {}

function assertRootKeepsKnownCategories(children: DriveFile[], knownCourses: KnownDurableCourse[], knownCategoryIds: Set<string>) {
  const currentCategoryIds = new Set(children.filter((child) => !child.name.startsWith(".") && child.mimeType === FOLDER_MIME_TYPE).map((child) => child.id));
  if ([...knownCategoryIds].some((id) => !currentCategoryIds.has(id))) {
    throw new IncrementalSyncError("Se detectó que una categoría existente fue movida o eliminada. Para proteger el catálogo, usa una sincronización completa.");
  }
  if (knownCourses.length === 0) throw new IncrementalSyncError("No existe una base publicada válida para comparar cursos.");
}

function assertCategoryKeepsKnownCourses(task: DurableSyncTask, children: DriveFile[], knownCourses: KnownDurableCourse[]) {
  const allKnown = new Set(knownCourses.map((course) => course.driveFileId));
  const expected = new Set(knownCourses.filter((course) => course.categoryDriveFileId === task.category_drive_file_id).map((course) => course.driveFileId));
  const current = new Set(children.filter((child) => !child.name.startsWith(".") && child.mimeType === FOLDER_MIME_TYPE).map((child) => child.id));
  if ([...expected].some((id) => !current.has(id))) {
    throw new IncrementalSyncError("Se detectó que un curso existente fue movido o eliminado. Para proteger el catálogo, usa una sincronización completa.");
  }
  if (children.some((child) => child.mimeType === FOLDER_MIME_TYPE && allKnown.has(child.id) && !expected.has(child.id))) {
    throw new IncrementalSyncError("Se detectó que un curso existente cambió de categoría. Para proteger el catálogo, usa una sincronización completa.");
  }
}

export async function POST(request: NextRequest, context: RouteContext<"/api/drive-token/sync/jobs/[jobId]/run">) {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") return NextResponse.json({ error: "Se requiere acceso de administrador." }, { status: 403 });
  const refreshToken = request.cookies.get(DRIVE_REFRESH_COOKIE)?.value;
  if (request.cookies.get(DRIVE_USER_COOKIE)?.value !== access.user.id || !refreshToken) {
    return NextResponse.json({ error: "Debes autorizar Google Drive con esta cuenta." }, { status: 401 });
  }

  const { jobId } = await context.params;
  const supabase = await createSupabaseServerClient();
  const token = await refreshDriveAccessToken(refreshToken);
  const { data: job, error: jobError } = await supabase.from("drive_sync_jobs").select("mode").eq("id", jobId).maybeSingle<{ mode: SyncMode }>();
  if (jobError || !job) return respond({ error: "No se encontró la sincronización solicitada." }, 404, token, access.user.id);
  const incremental = job.mode === "new_courses";
  const { data: storedCourses, error: storedCoursesError } = incremental
    ? await supabase.from("drive_sync_job_items").select("drive_file_id, category_drive_file_id").eq("job_id", jobId).eq("kind", "course").returns<StoredCourse[]>()
    : { data: [] as StoredCourse[], error: null };
  if (storedCoursesError) return respond({ error: "No se pudo preparar la comparación con el catálogo actual." }, 500, token, access.user.id);
  const knownCourses = (storedCourses ?? []).map((course) => ({ categoryDriveFileId: course.category_drive_file_id, driveFileId: course.drive_file_id }));
  const { data: storedCategories, error: storedCategoriesError } = incremental
    ? await supabase.from("drive_sync_job_items").select("drive_file_id").eq("job_id", jobId).eq("kind", "category").returns<Array<{ drive_file_id: string }>>()
    : { data: [] as Array<{ drive_file_id: string }>, error: null };
  if (storedCategoriesError) return respond({ error: "No se pudo preparar la comparación de categorías." }, 500, token, access.user.id);
  const knownCategoryIds = new Set((storedCategories ?? []).map((category) => category.drive_file_id));
  const { data: tasks, error: claimError } = await supabase
    .rpc("claim_drive_sync_tasks", { p_job_id: jobId, p_limit: TASKS_PER_BATCH })
    .returns<DurableSyncTask[]>();
  if (claimError) return respond({ error: `No se pudo reclamar el siguiente lote de carpetas: ${claimError.message}` }, 400, token, access.user.id);

  const claimedTasks = Array.isArray(tasks) ? tasks as DurableSyncTask[] : [];
  const results = await Promise.all(claimedTasks.map(async (task: DurableSyncTask) => {
    try {
      const children = await listDriveChildren(token.access_token!, task.folder_drive_file_id);
      if (incremental && task.kind === "root") assertRootKeepsKnownCategories(children, knownCourses, knownCategoryIds);
      const isKnownCategory = task.kind === "category" && task.category_drive_file_id !== null && knownCategoryIds.has(task.category_drive_file_id);
      if (incremental && isKnownCategory) assertCategoryKeepsKnownCourses(task, children, knownCourses);
      const result = incremental && isKnownCategory
        ? createIncrementalCategoryTaskResult(task, children, knownCourses)
        : createDurableTaskResult(task, children);
      const { error } = await supabase.rpc("complete_drive_sync_task", {
        p_child_tasks: result.childTasks,
        p_items: result.items,
        p_task_id: task.id,
      });
      if (error) throw new Error("No se pudo guardar el resultado de una carpeta.");
      return { completed: true };
    } catch (error) {
      const retryable = error instanceof DriveApiError && (error.status === 429 || error.status >= 500);
      await supabase.rpc("fail_drive_sync_task", {
        p_error: error instanceof Error ? error.message : "Drive no pudo procesar la carpeta.",
        p_retryable: retryable,
        p_task_id: task.id,
      });
      return { completed: false };
    }
  }));

  const { data: status, error: refreshError } = await supabase.rpc("refresh_drive_sync_job", { p_job_id: jobId });
  if (refreshError) return respond({ error: "El lote terminó, pero no se pudo actualizar su estado." }, 500, token, access.user.id);
  return respond({ completedTasks: results.filter((result: { completed: boolean }) => result.completed).length, status }, 200, token, access.user.id);
}

function respond(payload: unknown, status: number, token: Awaited<ReturnType<typeof refreshDriveAccessToken>>, userId: string) {
  const response = NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
  setDriveSessionCookies(response, token, userId);
  return response;
}
