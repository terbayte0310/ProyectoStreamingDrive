"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SyncSummary = { categories?: number; conflicts?: number; courses?: number; files?: number; folders?: number; ignored?: number; lessons?: number; sections?: number; unsupported?: number };
type SyncStatus = "queued" | "scanning" | "ready" | "publishing" | "completed" | "failed" | "cancelled";
type TaskProgress = { completed: number; failed: number; processing: number; queued: number };
type SyncJob = { counters: SyncSummary; error_summary: string | null; finished_at: string | null; heartbeat_at: string | null; id: string; mode?: "full" | "new_courses"; started_at: string; status: SyncStatus; task_progress?: TaskProgress };

const labels: Array<[keyof SyncSummary, string]> = [["categories", "Categorías"], ["courses", "Cursos"], ["sections", "Secciones"], ["lessons", "Lecciones"], ["unsupported", "No compatibles"], ["conflicts", "Conflictos"], ["ignored", "Ignorados"]];
const statusLabel: Record<SyncStatus, string> = { cancelled: "Cancelada", completed: "Publicada", failed: "Con error", publishing: "Publicando", queued: "En cola", ready: "Lista para publicar", scanning: "Escaneando Drive" };

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours} h ${minutes} min` : `${minutes} min ${remainder} s`;
}

export function CatalogSyncPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<"create" | "publish" | "run" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<SyncJob | null>(null);
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
      (next) => { if (active) setJob(next); },
      (caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "No se pudo consultar la sincronización."); },
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
    setError("");
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo continuar la sincronización.");
      await loadJobs(jobId).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function createJob(mode: "full" | "new_courses") {
    setBusy("create");
    setError("");
    setConfirmed(false);
    try {
      const response = await fetch("/api/drive-token/sync/jobs", { body: JSON.stringify({ mode }), headers: { "content-type": "application/json" }, method: "POST" });
      const result = (await response.json()) as { error?: string; job?: SyncJob };
      if (!response.ok || !result.job) throw new Error(result.error ?? "No se pudo crear la sincronización.");
      setJob(result.job);
      await runBatches(result.job.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo crear la sincronización.");
    } finally {
      setBusy(null);
    }
  }

  async function publishJob() {
    if (!job) return;
    setBusy("publish");
    setError("");
    try {
      const response = await fetch(`/api/drive-token/sync/jobs/${job.id}/publish`, { body: JSON.stringify({ confirmRootChange: false }), headers: { "content-type": "application/json" }, method: "POST" });
      const result = (await response.json()) as { error?: string; rootChangeRequired?: boolean };
      if (!response.ok) throw new Error(result.rootChangeRequired ? "La raíz de Drive cambió; confirma primero la transición." : result.error ?? "No se pudo publicar la sincronización.");
      await loadJobs(job.id);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo publicar la sincronización.");
    } finally {
      setBusy(null);
    }
  }

  const canResume = job?.status === "queued" || job?.status === "scanning";
  const taskProgress = job?.task_progress ?? { completed: 0, failed: 0, processing: 0, queued: 0 };
  const knownFolders = taskProgress.completed + taskProgress.failed + taskProgress.processing + taskProgress.queued;
  const completedPercent = knownFolders ? Math.round((taskProgress.completed / knownFolders) * 100) : 0;
  const elapsed = job ? formatDuration((job.finished_at ? new Date(job.finished_at).getTime() : now) - new Date(job.started_at).getTime()) : null;

  return (
    <section className="admin-panel admin-reveal mt-8 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Sincronización durable de Drive</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">La importación avanza por lotes de carpetas y guarda el estado en Supabase. Si cierras esta página o reinicias el PC, puedes reanudarla después sin empezar de cero.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-xl bg-sky-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" disabled={busy !== null} onClick={() => void createJob("new_courses")} type="button">{busy === "create" ? "Preparando…" : "Buscar solo cursos nuevos"}</button>
          <button className="rounded-xl border border-sky-400/50 px-4 py-2 text-sm font-semibold text-sky-100 disabled:opacity-50" disabled={busy !== null} onClick={() => void createJob("full")} type="button">Sincronización completa</button>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-xl border border-rose-400/40 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p> : null}

      {job ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-950 p-4 text-sm">
            <div><strong>{statusLabel[job.status]}{job.mode === "new_courses" ? " · Solo cursos nuevos" : ""}</strong><p className="mt-1 text-slate-400">Inicio: {new Date(job.started_at).toLocaleString()} · {job.finished_at ? "Duración final" : "Tiempo transcurrido"}: {elapsed}</p></div>
            {canResume ? <button className="rounded-xl border border-slate-600 px-4 py-2 font-semibold disabled:opacity-50" disabled={busy !== null} onClick={() => void runBatches(job.id)} type="button">{busy === "run" ? "Procesando…" : "Reanudar"}</button> : null}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {labels.map(([key, label]) => <div className="rounded-xl bg-slate-950 p-3" key={key}><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-semibold">{job.counters[key] ?? 0}</p></div>)}
          </div>
          {isRunning || job.status === "ready" || job.status === "completed" ? (
            <div className="mt-4 rounded-xl bg-slate-950 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-medium">Carpetas procesadas</span><span className="text-slate-300">{taskProgress.completed} de {knownFolders || "?"} descubiertas · {completedPercent}%</span></div>
              <div aria-label={`${completedPercent}% de carpetas descubiertas procesadas`} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={completedPercent}><div className="h-full rounded-full bg-sky-400" style={{ width: `${completedPercent}%` }} /></div>
              <p className="mt-2 text-xs text-slate-400">{job.mode === "new_courses" ? "Se abrirán los cursos nuevos y las categorías nuevas completas. Si moviste, eliminaste o cambiaste de categoría un curso existente, usa la sincronización completa." : "El total puede crecer mientras Drive revela subcarpetas; por eso no estimamos una hora de finalización hasta conocer toda la estructura."}</p>
            </div>
          ) : null}
          {job.error_summary ? <p className="mt-3 text-sm text-rose-200">{job.error_summary}</p> : null}
          {job.status === "ready" ? (
            <div className="mt-5 flex flex-col gap-3">
              <p className="text-sm text-amber-100">Revisa estos conteos antes de publicar. Publicar es atómico y no vuelve a recorrer Drive.</p>
              <label className="flex items-start gap-2 text-sm text-slate-300"><input checked={confirmed} className="mt-1" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />Revisé la previsualización y autorizo publicar este snapshot.</label>
              <button className="w-fit rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 disabled:opacity-40" disabled={!confirmed || busy !== null} onClick={() => void publishJob()} type="button">{busy === "publish" ? "Publicando…" : "Publicar sincronización"}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
