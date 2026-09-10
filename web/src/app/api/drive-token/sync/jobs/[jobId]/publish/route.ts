import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Job = { root_folder_id: string; status: string };
type Source = { drive_root_folder_id: string; id: string; name: string };

export async function POST(request: NextRequest, context: RouteContext<"/api/drive-token/sync/jobs/[jobId]/publish">) {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") return NextResponse.json({ error: "Se requiere acceso de administrador." }, { status: 403 });

  const { jobId } = await context.params;
  const body = await request.json().catch(() => null) as { confirmRootChange?: unknown } | null;
  const supabase = await createSupabaseServerClient();
  const { data: job, error: jobError } = await supabase
    .from("drive_sync_jobs")
    .select("root_folder_id, status")
    .eq("id", jobId)
    .maybeSingle<Job>();
  if (jobError || !job) return NextResponse.json({ error: "Sincronización no encontrada." }, { status: 404 });
  if (job.status !== "ready") return NextResponse.json({ error: "La sincronización debe terminar antes de publicar." }, { status: 409 });

  const { data: sources, error: sourceError } = await supabase
    .from("library_sources")
    .select("id, name, drive_root_folder_id")
    .eq("is_active", true)
    .order("created_at")
    .limit(2)
    .returns<Source[]>();
  if (sourceError) return NextResponse.json({ error: "No se pudo consultar la fuente de biblioteca." }, { status: 500 });
  if ((sources?.length ?? 0) > 1) return NextResponse.json({ error: "Hay más de una fuente activa. Resuelve esa configuración antes de publicar." }, { status: 409 });

  const existingSource = sources?.[0] ?? null;
  const rootChangeRequired = Boolean(existingSource && existingSource.drive_root_folder_id !== job.root_folder_id);
  if (rootChangeRequired && body?.confirmRootChange !== true) {
    return NextResponse.json({ error: "La raíz configurada cambió. Confirma la transición antes de publicar.", rootChangeRequired: true }, { status: 409 });
  }

  let sourceId = existingSource?.id;
  if (!sourceId) {
    const { data: createdSource, error: createSourceError } = await supabase
      .from("library_sources")
      .insert({ drive_root_folder_id: job.root_folder_id, name: "Biblioteca de cursos" })
      .select("id")
      .single<{ id: string }>();
    if (createSourceError || !createdSource) return NextResponse.json({ error: "No se pudo crear la fuente de biblioteca." }, { status: 500 });
    sourceId = createdSource.id;
  }

  const { data: run, error: runError } = await supabase
    .from("catalog_sync_runs")
    .insert({ initiated_by: access.user.id, source_id: sourceId, status: "running" })
    .select("id")
    .single<{ id: string }>();
  if (runError?.code === "23505") return NextResponse.json({ error: "Ya existe una publicación activa para esta biblioteca." }, { status: 409 });
  if (runError || !run) return NextResponse.json({ error: "No se pudo iniciar la publicación." }, { status: 500 });

  const { data: summary, error: publishError } = await supabase.rpc("publish_drive_sync_job", {
    p_job_id: jobId,
    p_root_folder_id: job.root_folder_id,
    p_run_id: run.id,
    p_source_id: sourceId,
  });
  if (publishError) {
    const detail = publishError.message.slice(0, 500);
    await supabase.from("catalog_sync_runs").update({ error_summary: detail, finished_at: new Date().toISOString(), status: "failed" }).eq("id", run.id);
    return NextResponse.json({ error: `La publicación durable fue rechazada: ${detail}` }, { status: 400 });
  }
  const { error: resourceError } = await supabase.rpc("sync_course_resources_from_drive_sync_job", { p_job_id: jobId, p_source_id: sourceId });
  if (resourceError) return NextResponse.json({ error: "El catálogo fue publicado, pero no se pudieron clasificar sus recursos." }, { status: 500 });
  return NextResponse.json({ runId: run.id, summary }, { headers: { "Cache-Control": "private, no-store" } });
}
