"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LessonNotes } from "@/components/lesson-notes";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Lesson = { id: string; detected_title: string; custom_title: string | null; drive_item_id: string | null; section_id: string | null; position: number };
type Section = { id: string; parent_section_id: string | null; position: number };
type State = "loading" | "needs-drive" | "ready" | "error";
const workerRevision = "download-link-v1";

function sort<T extends { position: number }>(items: T[]) { return [...items].sort((a, b) => a.position - b.position); }
function orderLessons(lessons: Lesson[], sections: Section[]) {
  const result = sort(lessons.filter((lesson) => !lesson.section_id));
  function visit(parent: string | null) {
    for (const section of sort(sections.filter((item) => item.parent_section_id === parent))) {
      result.push(...sort(lessons.filter((lesson) => lesson.section_id === section.id)));
      visit(section.id);
    }
  }
  visit(null); return result;
}
async function driveWorker(): Promise<ServiceWorker> {
  const registration = await navigator.serviceWorker.register(`/sw.js?revision=${workerRevision}`, { scope: "/" });
  if (registration.active?.scriptURL.includes(`revision=${workerRevision}`)) return registration.active;
  const pending = registration.installing ?? registration.waiting;
  if (!pending) throw new Error("No se pudo actualizar el reproductor de Drive. Recarga normalmente.");
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("La actualización de Drive tardó demasiado.")), 5000);
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") { window.clearTimeout(timeout); resolve(); }
      if (pending.state === "redundant") { window.clearTimeout(timeout); reject(new Error("No se pudo activar el reproductor de Drive.")); }
    });
  });
  if (!registration.active?.scriptURL.includes(`revision=${workerRevision}`)) throw new Error("El reproductor de Drive no se actualizó. Recarga normalmente.");
  return registration.active;
}

export default function CoursePlayerContent() {
  const router = useRouter(); const params = useSearchParams(); const videoRef = useRef<HTMLVideoElement>(null); const lastSavedAt = useRef(0);
  const [state, setState] = useState<State>("loading"); const [error, setError] = useState(""); const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false); const [lessons, setLessons] = useState<Lesson[]>([]); const [selectedId, setSelectedId] = useState<string>(); const [fileId, setFileId] = useState<string>(); const [userId, setUserId] = useState<string>();
  const requestedLessonId = params.get("lesson"); const shouldAutoplay = params.get("autoplay") === "1";

  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      try {
        const db = createSupabaseBrowserClient(); const { data: userData } = await db.auth.getUser();
        if (!userData.user) { router.replace("/signin"); return; }
        const [{ data: lessonRows }, { data: sectionRows }] = await Promise.all([
          db.from("lessons").select("id, detected_title, custom_title, section_id, drive_item_id, position").order("position"),
          db.from("course_sections").select("id, parent_section_id, position").order("position"),
        ]);
        const ordered = orderLessons((lessonRows ?? []) as Lesson[], (sectionRows ?? []) as Section[]);
        const active = ordered.find((lesson) => lesson.id === requestedLessonId) ?? ordered[0];
        if (!active?.drive_item_id) throw new Error("No hay lecciones importadas para reproducir.");
        const { data: item } = await db.from("drive_items").select("drive_file_id").eq("id", active.drive_item_id).maybeSingle<{ drive_file_id: string }>();
        if (!item) throw new Error("No se encontró el archivo de Drive de esta lección.");
        const worker = await driveWorker(); const response = await fetch("/api/drive-token", { cache: "no-store" });
        if (!response.ok) { if (!cancelled) setState("needs-drive"); return; }
        const { accessToken } = (await response.json()) as { accessToken: string }; worker.postMessage({ type: "drive-access-token", token: accessToken });
        if (!cancelled) { setUserId(userData.user.id); setLessons(ordered); setSelectedId(active.id); setFileId(item.drive_file_id); setState("ready"); }
      } catch (caught) { if (!cancelled) { setError(caught instanceof Error ? caught.message : "No se pudo preparar el reproductor."); setState("error"); } }
    }
    void prepare(); return () => { cancelled = true; };
  }, [requestedLessonId, router]);

  const selected = lessons.find((lesson) => lesson.id === selectedId); const title = selected ? (selected.custom_title ?? selected.detected_title) : "";
  async function save(seconds: number, duration: number, completed = false) {
    if (!selectedId || !userId || !Number.isFinite(duration)) return;
    await createSupabaseBrowserClient().from("lesson_progress").upsert({ user_id: userId, lesson_id: selectedId, position_seconds: Math.round(completed ? duration : seconds), duration_seconds: Math.round(duration), state: completed ? "completed" : "in_progress", completed_at: completed ? new Date().toISOString() : null });
  }
  async function restore() {
    const video = videoRef.current; if (!video || !selectedId || !userId) return;
    const { data } = await createSupabaseBrowserClient().from("lesson_progress").select("position_seconds, state").eq("lesson_id", selectedId).eq("user_id", userId).maybeSingle<{ position_seconds: number; state: string }>();
    if (data && data.state !== "completed" && data.position_seconds > 5 && data.position_seconds < video.duration - 5) video.currentTime = data.position_seconds;
  }
  async function download() {
    if (!fileId) return; setDownloading(true); setDownloadError("");
    try { const response = await fetch(`/drive-download/${fileId}`, { cache: "no-store" }); const data = await response.json() as { webContentLink?: string }; if (!response.ok || !data.webContentLink) throw new Error("Drive no entregó un enlace de descarga para esta lección."); window.location.assign(data.webContentLink); }
    catch (caught) { setDownloadError(caught instanceof Error ? caught.message : "No se pudo preparar la descarga."); setDownloading(false); }
  }
  function next() { const video = videoRef.current; if (!video || !selectedId) return; void save(video.duration, video.duration, true); const following = lessons[lessons.findIndex((lesson) => lesson.id === selectedId) + 1]; if (following) router.push(`/course-player?lesson=${following.id}&autoplay=1`); }

  return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100"><section className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]"><div><p className="text-sm font-semibold tracking-[.2em] text-sky-300 uppercase">Reproductor</p><h1 className="mt-2 text-2xl font-semibold">{title || "Preparando lección…"}</h1>{state === "loading" && <p className="mt-8">Preparando el reproductor…</p>}{state === "needs-drive" && <p className="mt-8">Debes <a className="text-sky-300 underline" href="/drive-access">autorizar Drive</a> para esta sesión.</p>}{state === "error" && <p className="mt-8 text-rose-200">{error}</p>}{state === "ready" && fileId && <><video autoPlay={shouldAutoplay} className="mt-6 aspect-video w-full rounded-2xl bg-black" controls onEnded={next} onLoadedMetadata={() => void restore()} onTimeUpdate={() => { const video = videoRef.current; if (video && video.currentTime - lastSavedAt.current >= 10) { lastSavedAt.current = video.currentTime; void save(video.currentTime, video.duration); } }} preload="metadata" ref={videoRef} src={`/drive-stream/${fileId}`} /><div className="mt-4"><button className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60" disabled={downloading} onClick={() => void download()} type="button">{downloading ? "Preparando descarga…" : "Descargar en este dispositivo"}</button>{downloadError && <p className="mt-2 text-sm text-rose-200">{downloadError}</p>}</div>{selectedId && <LessonNotes lessonId={selectedId} readSecond={() => videoRef.current?.currentTime ?? 0} seekTo={(seconds) => { if (videoRef.current) videoRef.current.currentTime = seconds; }} />}</>}</div><aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><h2 className="font-semibold">Lecciones</h2><div className="mt-4 flex max-h-[70vh] flex-col gap-1 overflow-y-auto">{lessons.map((lesson) => <button className={`rounded-xl px-3 py-2 text-left text-sm ${lesson.id === selectedId ? "bg-sky-400/15 text-sky-100" : "text-slate-300 hover:bg-slate-800"}`} key={lesson.id} onClick={() => router.push(`/course-player?lesson=${lesson.id}`)} type="button">{lesson.custom_title ?? lesson.detected_title}</button>)}</div></aside></section></main>;
}
