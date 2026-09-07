"use client";

import { useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Candidate = { driveItemId: string; title: string };
type EventLog = { label: string; value: string };
const workerRevision = "refresh-token-v1";

function sendToken(worker: ServiceWorker, token: string) {
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => reject(new Error("El Service Worker no confirmó el token.")), 3000);
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    worker.postMessage({ type: "drive-access-token", token }, [channel.port2]);
  });
}

export default function DriveServiceWorkerValidationPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<string>();
  const [title, setTitle] = useState<string>();
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [testingRefresh, setTestingRefresh] = useState(false);

  const addLog = (label: string, value: string) => setLogs((current) => [{ label, value }, ...current].slice(0, 12));

  useEffect(() => {
    async function prepare() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: lessons } = await supabase.from("lessons").select("detected_title, custom_title, drive_item_id");
        const candidates = (lessons ?? []).flatMap((lesson) => lesson.drive_item_id ? [{ driveItemId: lesson.drive_item_id, title: lesson.custom_title ?? lesson.detected_title }] : []) as Candidate[];
        if (!candidates.length) throw new Error("No hay lecciones importadas.");
        const { data: items } = await supabase.from("drive_items").select("id, drive_file_id, byte_size").in("id", candidates.map((candidate) => candidate.driveItemId));
        const itemById = new Map((items ?? []).map((item) => [item.id, item]));
        const largest = [...candidates].sort((a, b) => (itemById.get(b.driveItemId)?.byte_size ?? 0) - (itemById.get(a.driveItemId)?.byte_size ?? 0))[0];
        const item = itemById.get(largest.driveItemId);
        if (!item) throw new Error("No se encontró el archivo de Drive.");

        const registration = await navigator.serviceWorker.register(`/sw.js?revision=${workerRevision}`, { scope: "/" });
        await navigator.serviceWorker.ready;
        const tokenResponse = await fetch("/api/drive-token", { cache: "no-store" });
        if (!tokenResponse.ok) throw new Error("Primero autoriza Drive en /drive-access.");
        const { accessToken } = (await tokenResponse.json()) as { accessToken: string };
        const worker = registration.active ?? navigator.serviceWorker.controller;
        if (!worker) throw new Error("Recarga una vez para activar el Service Worker.");
        await sendToken(worker, accessToken);
        const streamSource = `/drive-stream/${item.drive_file_id}`;
        setTitle(largest.title);
        setSource(streamSource);
        addLog("Archivo seleccionado", `${Math.round((item.byte_size ?? 0) / 1024 / 1024)} MB`);

        const rangeResponse = await fetch(streamSource, { headers: { Range: "bytes=0-1023" } });
        addLog("Solicitud Range", `${rangeResponse.status} ${rangeResponse.status === 206 ? "Partial Content ✓" : "(se esperaba 206)"}`);
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
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active ?? navigator.serviceWorker.controller;
      if (!worker) throw new Error("El Service Worker no está activo.");
      await sendToken(worker, "token-invalido-para-validar-renovacion");
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
        <p className="mt-3 text-slate-300">{title ?? "Preparando autorización y archivo…"}</p>
        {source ? (
          <>
            <video
              className="mt-7 aspect-video w-full rounded-2xl bg-black"
              controls
              onEnded={() => addLog("Evento ended", "Recibido ✓")}
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
