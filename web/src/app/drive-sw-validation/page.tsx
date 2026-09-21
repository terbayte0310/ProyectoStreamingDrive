"use client";

import { useEffect, useRef, useState } from "react";

import { getDriveWorker, sendDriveToken, workerControlsPage } from "@/lib/media/drive-worker";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Candidate = { driveItemId: string; title: string };
type DriveItem = { byte_size: number | null; drive_file_id: string; id: string };
type EventLog = { label: string; value: string };

export default function DriveServiceWorkerValidationPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<string>();
  const [title, setTitle] = useState<string>();
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [testingRefresh, setTestingRefresh] = useState(false);

  const addLog = (label: string, value: string) => setLogs((current) => [{ label, value }, ...current].slice(0, 12));


  useEffect(() => {
    if (!source || !("PerformanceObserver" in window)) return;
    const sourceUrl = new URL(source, window.location.href).href;
    const seen = new Set<string>();
    const report = (entry: PerformanceEntry) => {
      if (entry.name !== sourceUrl || entry.entryType !== "resource") return;
      const timing = entry as PerformanceResourceTiming;
      const key = `${timing.startTime}-${timing.duration}-${timing.transferSize}`;
      if (seen.has(key)) return;
      seen.add(key);
      const transferMiB = (timing.transferSize / 1024 / 1024).toFixed(2);
      const payloadMiB = (timing.encodedBodySize / 1024 / 1024).toFixed(2);
      const value = timing.transferSize > 0
        ? `${transferMiB} MiB transferidos; ${payloadMiB} MiB de payload (Performance Resource Timing)`
        : "El navegador no expuso bytes para esta solicitud; la reproducción no se modifica.";
      setLogs((current) => [{ label: "Medición nativa del navegador", value }, ...current].slice(0, 12));
    };
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(report));
    observer.observe({ buffered: true, type: "resource" });
    return () => observer.disconnect();
  }, [source]);
  useEffect(() => {
    async function prepare() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: lessons, error: lessonsError } = await supabase.from("lessons").select("detected_title, custom_title, drive_item_id").eq("is_visible", true);
        if (lessonsError) throw new Error("No se pudieron leer las lecciones.");
        const candidates = (lessons ?? []).flatMap((lesson) => lesson.drive_item_id ? [{ driveItemId: lesson.drive_item_id, title: lesson.custom_title ?? lesson.detected_title }] : []) as Candidate[];
        if (!candidates.length) throw new Error("No hay lecciones importadas.");
        const itemChunks = Array.from({ length: Math.ceil(candidates.length / 200) }, (_, index) => candidates.slice(index * 200, index * 200 + 200).map((candidate) => candidate.driveItemId));
        const itemResults = await Promise.all(itemChunks.map((ids) => supabase.from("drive_items").select("id, drive_file_id, byte_size").in("id", ids)));
        if (itemResults.some((result) => result.error)) throw new Error("No se pudieron leer los archivos de Drive.");
        const itemById = new Map(itemResults.flatMap((result) => (result.data ?? []) as DriveItem[]).filter((item) => Boolean(item.drive_file_id)).map((item) => [item.id, item]));
        const usableCandidates = candidates.filter((candidate) => itemById.has(candidate.driveItemId));
        if (!usableCandidates.length) throw new Error("No hay una lección visible con archivo de Drive disponible.");
        const largestFirst = [...usableCandidates].sort((a, b) => (itemById.get(b.driveItemId)?.byte_size ?? 0) - (itemById.get(a.driveItemId)?.byte_size ?? 0));

        const worker = await getDriveWorker();
        if (!workerControlsPage()) throw new Error("El Service Worker se activó, pero aún no controla esta pestaña. Recarga una vez y vuelve a abrir la prueba.");
        const tokenResponse = await fetch("/api/drive-token", { cache: "no-store" });
        if (!tokenResponse.ok) throw new Error("Primero autoriza Drive en /drive-access.");
        const { accessToken } = (await tokenResponse.json()) as { accessToken: string };
        await sendDriveToken(worker, accessToken, "courses");

        let selected: { item: DriveItem; source: string; title: string } | null = null;
        for (const candidate of largestFirst.slice(0, 25)) {
          const item = itemById.get(candidate.driveItemId);
          if (!item) continue;
          const candidateSource = `/drive-stream/${item.drive_file_id}?measurement=timing`;
          const rangeResponse = await fetch(candidateSource, { headers: { Range: "bytes=0-1023" } });
          if (rangeResponse.status === 206) {
            selected = { item, source: candidateSource, title: candidate.title };
            break;
          }
          await rangeResponse.body?.cancel();
        }
        if (!selected) throw new Error("No se encontró un archivo de Drive accesible entre las 25 lecciones de prueba.");
        setTitle(selected.title);
        setSource(selected.source);
        addLog("Archivo seleccionado", `${Math.round((selected.item.byte_size ?? 0) / 1024 / 1024)} MB`);
        addLog("Solicitud Range", "206 Partial Content ✓");
      } catch (error) {
        addLog("Preparación falló", error instanceof Error ? error.message : "Error desconocido");
      }
    }
    void prepare();
  }, []);

  function seekToMiddle() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = video.duration / 2;
    addLog("Seek solicitado", `minuto ${(video.duration / 2 / 60).toFixed(1)}`);
  }

  async function testRefreshAfter401() {
    if (!source) return;
    setTestingRefresh(true);
    try {
      const worker = await getDriveWorker();
      if (!workerControlsPage()) throw new Error("El Service Worker no controla esta pestaña. Recarga la prueba.");
      await sendDriveToken(worker, "token-invalido-para-validar-renovacion", "courses");
      const response = await fetch(source, { headers: { Range: "bytes=0-1023" } });
      if (response.status !== 206) {
        throw new Error(`Google/Worker respondió ${response.status}; se esperaba 206.`);
      }
      addLog("Renovación tras 401", "token renovado y reintento 206 ✓");
    } catch (error) {
      addLog("Renovación tras 401 falló", error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setTestingRefresh(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-slate-800 bg-slate-900/70 p-8 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Validación de streaming</p>
        <h1 className="mt-3 text-3xl font-semibold">Prueba sobre el video más grande importado</h1>
        <p className="mt-3 text-slate-300">{title ?? "Preparando autorización y archivo…"}. No modifica el catálogo ni guarda mediciones en Supabase.</p>
        {source ? (
          <>
            <video
              className="mt-7 aspect-video w-full rounded-2xl bg-black"
              controls
              onEnded={() => addLog("Evento ended", "Recibido ✓")}
              onPlaying={() => addLog("Evento playing", "El navegador inició reproducción ✓")}
              onLoadedMetadata={(event) => addLog("loadedmetadata", `${event.currentTarget.duration.toFixed(1)} segundos ✓`)}
              onSeeked={(event) => addLog("Evento seeked", `posición ${event.currentTarget.currentTime.toFixed(1)} segundos ✓`)}
              onTimeUpdate={(event) => {
                if (Math.floor(event.currentTarget.currentTime) % 15 === 0) addLog("timeupdate", `${event.currentTarget.currentTime.toFixed(1)} segundos ✓`);
              }}
              preload="metadata"
              ref={videoRef}
              src={source}
            />
            <div className="mt-5 flex flex-wrap gap-3">
              <button className="rounded-xl bg-white px-4 py-2 font-semibold text-slate-950" onClick={seekToMiddle} type="button">Saltar al 50 %</button>
              <button className="rounded-xl border border-slate-600 px-4 py-2 font-semibold disabled:opacity-60" disabled={testingRefresh} onClick={() => void testRefreshAfter401()} type="button">
                {testingRefresh ? "Probando renovación…" : "Probar renovación tras 401"}
              </button>
            </div>
          </>
        ) : null}
        <div className="mt-8 rounded-2xl border border-slate-700 p-5">
          <h2 className="font-semibold">Resultados observados</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-slate-300">
            {logs.map((log, index) => <li key={`${log.label}-${index}`}><span className="font-medium text-slate-100">{log.label}:</span> {log.value}</li>)}
          </ul>
        </div>
      </section>
    </main>
  );
}
