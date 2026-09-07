"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type State = { kind: "loading" } | { kind: "ready"; title: string; source: string } | { kind: "error"; message: string };

export default function DriveServiceWorkerTestPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    async function start() {
      try {
        if (!("serviceWorker" in navigator)) throw new Error("Este navegador no admite Service Workers.");
        const supabase = createSupabaseBrowserClient();
        const { data: lesson } = await supabase
          .from("lessons")
          .select("detected_title, custom_title, drive_item_id")
          .order("created_at")
          .limit(1)
          .maybeSingle<{ detected_title: string; custom_title: string | null; drive_item_id: string | null }>();
        if (!lesson?.drive_item_id) throw new Error("No se encontró una lección para probar.");

        const { data: item } = await supabase
          .from("drive_items")
          .select("drive_file_id")
          .eq("id", lesson.drive_item_id)
          .maybeSingle<{ drive_file_id: string }>();
        if (!item) throw new Error("No se encontró el archivo de Drive.");

        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const tokenResponse = await fetch("/api/drive-token", { cache: "no-store" });
        if (!tokenResponse.ok) throw new Error("No hay una autorización de Drive activa. Vuelve a autorizar.");
        const { accessToken } = (await tokenResponse.json()) as { accessToken: string };
        const worker = registration.active ?? navigator.serviceWorker.controller;
        if (!worker) throw new Error("El Service Worker aún no está activo. Recarga esta página una vez.");
        worker.postMessage({ type: "drive-access-token", token: accessToken });
        setState({ kind: "ready", source: `/drive-stream/${item.drive_file_id}`, title: lesson.custom_title ?? lesson.detected_title });
      } catch (error) {
        setState({ kind: "error", message: error instanceof Error ? error.message : "Falló la preparación de la prueba." });
      }
    }
    void start();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-800 bg-slate-900/70 p-8 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Spike: Service Worker</p>
        <h1 className="mt-3 text-3xl font-semibold">Reproducción con token del propio usuario</h1>
        {state.kind === "loading" ? <p className="mt-6 text-slate-300">Preparando autorización temporal…</p> : null}
        {state.kind === "error" ? <p className="mt-6 rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-rose-100">{state.message}</p> : null}
        {state.kind === "ready" ? (
          <>
            <p className="mt-5 text-slate-300">Lección de prueba: {state.title}</p>
            <video className="mt-7 aspect-video w-full rounded-2xl bg-black" controls preload="metadata" src={state.source} />
            <p className="mt-4 text-sm text-slate-400">Prueba: duración, adelantar el video, y comprobar que termina. No se guarda progreso todavía.</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
