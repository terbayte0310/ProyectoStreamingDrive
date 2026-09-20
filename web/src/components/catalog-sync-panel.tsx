"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";
import { confirmDialog } from "@/components/ui/confirm";

type SyncSummary = { categories?: number; conflicts?: number; courses?: number; files?: number; folders?: number; ignored?: number; lessons?: number; sections?: number; unsupported?: number };
type SyncStatus = "queued" | "scanning" | "ready" | "publishing" | "completed" | "failed" | "cancelled";
type TaskProgress = { completed: number; failed: number; processing: number; queued: number };
type SyncJob = { counters: SyncSummary; error_summary: string | null; finished_at: string | null; heartbeat_at: string | null; id: string; mode?: "full" | "new_courses"; started_at: string; status: SyncStatus; task_progress?: TaskProgress };

const labels: Array<[keyof SyncSummary, string]> = [["categories", "Categorías"], ["courses", "Cursos"], ["sections", "Secciones"], ["lessons", "Lecciones"], ["unsupported", "No compatibles"], ["conflicts", "Conflictos"], ["ignored", "Ignorados"]];
const statusLabel: Record<SyncStatus, string> = { cancelled: "Cancelada", completed: "Publicada", failed: "Con error", publishing: "Publicando", queued: "En cola", ready: "Lista para publicar", scanning: "Escaneando Drive" };
const statusBadge: Record<SyncStatus, string> = { cancelled: "badge", completed: "badge badge-mint badge-dot", failed: "badge badge-rose badge-dot", publishing: "badge badge-iris badge-dot", queued: "badge badge-gold badge-dot", ready: "badge badge-accent badge-dot", scanning: "badge badge-iris badge-dot" };

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min ${seconds % 60} s`;
}

export function CatalogSyncPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<"create" | "publish" | "run" | null>(null);
  const [job, setJob] = useState<SyncJob | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  async function fetchJob(jobId?: string) {
    const response = await fetch("/api/drive-token/sync/jobs", { cache: "no-store" });
    const result = (await response.json()) as { error?: string; jobs?: SyncJob[] };
    if (!response.ok || !result.jobs) throw new Error(result.error ?? "No se pudo consultar la sincronización.");
    return jobId ? result.jobs.find((candidate) => candidate.id === jobId) ?? null : result.jobs[0] ?? null;
  }

  async function loadJobs(jobId?: string) {
    const next = await fetchJob(jobId);
    setJob(next);
    return next;
  }

  useEffect(() => {
    let active = true;
    void fetchJob().then(
      (next) => { if (active) { setJob(next); setLoaded(true); } },
      (caught: unknown) => { if (active) { setLoaded(true); toast(caught instanceof Error ? caught.message : "No se pudo consultar la sincronización.", "error"); } },
    );
    return () => { active = false; };
  }, []);

  const isRunning = job?.status === "queued" || job?.status === "scanning" || job?.status === "publishing";
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  async function runBatches(jobId: string) {
    setBusy("run");
    try {
      let status: SyncStatus = "queued";
      do {
        const response = await fetch(`/api/drive-token/sync/jobs/${jobId}/run`, { method: "POST" });
        const result = (await response.json()) as { completedTasks?: number; error?: string; status?: SyncStatus };
        if (!response.ok || !result.status) throw new Error(result.error ?? "No se pudo procesar el siguiente lote.");
        status = result.status;
        await loadJobs(jobId);
        if (status === "scanning" && result.completedTasks === 0) await new Promise((resolve) => window.setTimeout(resolve, 2500));
      } while (status === "queued" || status === "scanning");
      if (status === "ready") toast("Escaneo completo. Revisa los conteos y publica.", "success");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "No se pudo continuar la sincronización.", "error");
      await loadJobs(jobId).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function createJob(mode: "full" | "new_courses") {
    if (mode === "full" && !(await confirmDialog({ body: "Recorre toda la carpeta de Drive y puede tardar varios minutos. Podrás reanudarla si cierras la página.", confirmLabel: "Empezar", title: "¿Sincronización completa?" }))) return;
    setBusy("create");
    try {
      const response = await fetch("/api/drive-token/sync/jobs", { body: JSON.stringify({ mode }), headers: { "content-type": "application/json" }, method: "POST" });
      const result = (await response.json()) as { error?: string; job?: SyncJob };
      if (!response.ok || !result.job) throw new Error(result.error ?? "No se pudo crear la sincronización.");
      setJob(result.job);
      await runBatches(result.job.id);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "No se pudo crear la sincronización.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function publishJob() {
    if (!job) return;
    if (!(await confirmDialog({ body: "Publicar es atómico: el catálogo pasa a reflejar exactamente este escaneo. No vuelve a recorrer Drive.", confirmLabel: "Publicar ahora", title: "¿Publicar esta sincronización?" }))) return;
    setBusy("publish");
    try {
      const response = await fetch(`/api/drive-token/sync/jobs/${job.id}/publish`, { body: JSON.stringify({ confirmRootChange: false }), headers: { "content-type": "application/json" }, method: "POST" });
      const result = (await response.json()) as { error?: string; rootChangeRequired?: boolean };
      if (!response.ok) throw new Error(result.rootChangeRequired ? "La raíz de Drive cambió; confirma primero la transición." : result.error ?? "No se pudo publicar la sincronización.");
      await loadJobs(job.id);
      router.refresh();
      toast("Catálogo publicado.", "success");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "No se pudo publicar la sincronización.", "error");
    } finally {
      setBusy(null);
    }
  }

  const canResume = job?.status === "queued" || job?.status === "scanning";
  const progress = job?.task_progress ?? { completed: 0, failed: 0, processing: 0, queued: 0 };
  const known = progress.completed + progress.failed + progress.processing + progress.queued;
  const percent = known ? Math.round((progress.completed / known) * 100) : 0;
  const elapsed = job ? formatDuration((job.finished_at ? new Date(job.finished_at).getTime() : now) - new Date(job.started_at).getTime()) : null;

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <div>
          <p className="kicker">Google Drive</p>
          <h2 className="title-m">Sincronización durable</h2>
          <p>Avanza por lotes y guarda el estado en Supabase: si cierras la página o reinicias el equipo, se reanuda donde quedó.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => void createJob("new_courses")} type="button"><Icon name="sparkle" />{busy === "create" ? "Preparando…" : "Buscar cursos nuevos"}</button>
          <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void createJob("full")} type="button"><Icon name="refresh" />Sincronización completa</button>
        </div>
      </div>

      {!loaded ? <div className="skeleton" style={{ height: 120 }} /> : null}
      {loaded && !job ? <div className="empty-state"><span aria-hidden="true" className="empty-orb" /><h3 className="title-m">Aún no hay sincronizaciones</h3><p>Empieza buscando cursos nuevos: es la opción más rápida.</p></div> : null}

      {job ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="progress-block">
            <div className="progress-meta">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className={statusBadge[job.status]}>{statusLabel[job.status]}</span>{job.mode === "new_courses" ? <span className="badge">Solo cursos nuevos</span> : null}</span>
              <span className="mono">{job.finished_at ? "Duración" : "Transcurrido"}: {elapsed}</span>
            </div>
            {isRunning || job.status === "ready" || job.status === "completed" ? (
              <>
                <span aria-label={`${percent}% de carpetas procesadas`} className="meter" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></span>
                <div className="progress-meta"><span>{progress.completed} de {known || "?"} carpetas</span><span className="mono">{percent}%</span></div>
              </>
            ) : null}
            {canResume ? <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void runBatches(job.id)} style={{ width: "fit-content" }} type="button"><Icon name="play" />{busy === "run" ? "Procesando…" : "Reanudar"}</button> : null}
          </div>
          <div className="counter-grid">
            {labels.map(([key, label]) => <div className="counter" key={key}><span>{label}</span><strong>{job.counters[key] ?? 0}</strong></div>)}
          </div>
          <p className="field-hint" style={{ margin: 0 }}>{job.mode === "new_courses" ? "Abre solo cursos y categorías nuevos. Si moviste o borraste cursos existentes, usa la sincronización completa." : "El total crece mientras Drive revela subcarpetas; por eso no se estima una hora de fin hasta conocer toda la estructura."}</p>
          {job.error_summary ? <div className="notice notice-error"><span className="notice-icon"><Icon name="warning" /></span><div>{job.error_summary}</div></div> : null}
          {job.status === "ready" ? (
            <div className="notice notice-ok" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="notice-icon"><Icon name="check" /></span><div><strong>Listo para publicar.</strong> Revisa los conteos antes de continuar.</div></div>
              <button className="btn btn-primary" disabled={busy !== null} onClick={() => void publishJob()} type="button">{busy === "publish" ? "Publicando…" : "Publicar sincronización"}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
