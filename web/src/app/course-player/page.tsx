"use client";

import { useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Lesson = { custom_title: string | null; detected_title: string; drive_item_id: string | null; id: string; position: number; section_id: string | null };
type Section = { id: string; parent_section_id: string | null; position: number };
type PlayerState = { kind: "loading" } | { kind: "needs-drive" } | { kind: "ready" } | { kind: "error"; message: string };

export default function CoursePlayerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedAt = useRef(0);
  const [state, setState] = useState<PlayerState>({ kind: "loading" });
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [fileId, setFileId] = useState<string>();
  const [userId, setUserId] = useState<string>();

  useEffect(() => {
    async function prepare() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          window.location.href = "/signin";
          return;
        }
        setUserId(userData.user.id);
        const [{ data: lessonRows }, { data: sectionRows }] = await Promise.all([
          supabase.from("lessons").select("id, detected_title, custom_title, section_id, drive_item_id, position").order("position"),
          supabase.from("course_sections").select("id, parent_section_id, position").order("position"),
        ]);
        const rawLessons = (lessonRows ?? []) as Lesson[];
        const sections = (sectionRows ?? []) as Section[];
        const sort = <T extends { position: number }>(items: T[]) => [...items].sort((a, b) => a.position - b.position);
        const ordered: Lesson[] = [...sort(rawLessons.filter((lesson) => !lesson.section_id))];
        const appendSection = (parentId: string | null) => {
          for (const section of sort(sections.filter((item) => item.parent_section_id === parentId))) {
            ordered.push(...sort(rawLessons.filter((lesson) => lesson.section_id === section.id)));
            appendSection(section.id);
          }
        };
        appendSection(null);
        if (!ordered.length) throw new Error("No hay lecciones importadas.");
        const requested = new URLSearchParams(window.location.search).get("lesson");
        const active = ordered.find((lesson) => lesson.id === requested) ?? ordered[0];
        if (!active.drive_item_id) throw new Error("La lección no tiene archivo asociado.");
        const { data: item } = await supabase.from("drive_items").select("drive_file_id").eq("id", active.drive_item_id).maybeSingle<{ drive_file_id: string }>();
        if (!item) throw new Error("No se encontró el archivo de Drive.");

        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const tokenResponse = await fetch("/api/drive-token", { cache: "no-store" });
        if (!tokenResponse.ok) {
          setState({ kind: "needs-drive" });
          return;
        }
        const { accessToken } = (await tokenResponse.json()) as { accessToken: string };
        const worker = registration.active ?? navigator.serviceWorker.controller;
        if (!worker) throw new Error("Recarga la página para activar el reproductor.");
        worker.postMessage({ type: "drive-access-token", token: accessToken });
        setLessons(ordered);
        setSelectedId(active.id);
        setFileId(item.drive_file_id);
        setState({ kind: "ready" });
      } catch (error) {
        setState({ kind: "error", message: error instanceof Error ? error.message : "No se pudo preparar el reproductor." });
      }
    }
    void prepare();
  }, []);

  const selected = lessons.find((lesson) => lesson.id === selectedId);
  const title = selected ? selected.custom_title ?? selected.detected_title : "";

  async function saveProgress(seconds: number, duration: number, completed = false) {
    if (!selectedId || !userId || !Number.isFinite(duration)) return;
    const supabase = createSupabaseBrowserClient();
    await supabase.from("lesson_progress").upsert({
      completed_at: completed ? new Date().toISOString() : null,
      duration_seconds: Math.round(duration),
      lesson_id: selectedId,
      position_seconds: completed ? Math.round(duration) : Math.round(seconds),
      state: completed ? "completed" : seconds > 0 ? "in_progress" : "not_started",
      user_id: userId,
    });
  }

  async function restoreProgress() {
    const video = videoRef.current;
    if (!video || !selectedId || !userId || !Number.isFinite(video.duration)) return;
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("lesson_progress")
      .select("position_seconds, state")
      .eq("lesson_id", selectedId)
      .eq("user_id", userId)
      .maybeSingle<{ position_seconds: number; state: "not_started" | "in_progress" | "completed" }>();
    if (data && data.state !== "completed" && data.position_seconds > 5 && data.position_seconds < video.duration - 5) video.currentTime = data.position_seconds;
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video || video.currentTime - lastSavedAt.current < 10) return;
    lastSavedAt.current = video.currentTime;
    void saveProgress(video.currentTime, video.duration);
  }

  function onEnded() {
    const video = videoRef.current;
    if (!video || !selectedId) return;
    void saveProgress(video.duration, video.duration, true);
    const index = lessons.findIndex((lesson) => lesson.id === selectedId);
    const next = lessons[index + 1];
    if (next) window.location.href = `/course-player?lesson=${next.id}&autoplay=1`;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <section className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Reproductor</p>
          <h1 className="mt-2 text-2xl font-semibold">{title || "Preparando lección…"}</h1>
          {state.kind === "loading" ? <p className="mt-8 text-slate-300">Preparando el reproductor…</p> : null}
          {state.kind === "needs-drive" ? <p className="mt-8 rounded-xl border border-amber-400/40 bg-amber-400/10 p-5 text-amber-100">Debes autorizar Drive en esta sesión antes de reproducir. <a className="underline" href="/drive-access">Autorizar Drive</a></p> : null}
          {state.kind === "error" ? <p className="mt-8 rounded-xl border border-rose-400/40 bg-rose-400/10 p-5 text-rose-100">{state.message}</p> : null}
          {state.kind === "ready" && fileId ? <video autoPlay={new URLSearchParams(window.location.search).get("autoplay") === "1"} className="mt-6 aspect-video w-full rounded-2xl bg-black" controls onEnded={onEnded} onLoadedMetadata={() => void restoreProgress()} onTimeUpdate={onTimeUpdate} preload="metadata" ref={videoRef} src={`/drive-stream/${fileId}`} /> : null}
        </div>
        <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><h2 className="font-semibold">Lecciones</h2><div className="mt-4 flex max-h-[70vh] flex-col gap-1 overflow-y-auto">{lessons.map((lesson) => <a className={`rounded-xl px-3 py-2 text-sm ${lesson.id === selectedId ? "bg-sky-400/15 text-sky-100" : "text-slate-300 hover:bg-slate-800"}`} href={`/course-player?lesson=${lesson.id}`} key={lesson.id}>{lesson.custom_title ?? lesson.detected_title}</a>)}</div></aside>
      </section>
    </main>
  );
}
