"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { LessonNotes } from "@/components/lesson-notes";
import { buildCoursePlaybackQueue } from "@/lib/catalog/outline";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Lesson = {
  course_id: string;
  custom_title: string | null;
  detected_title: string;
  drive_item_id: string | null;
  id: string;
  position: number;
  section_id: string | null;
};

type Section = {
  course_id: string;
  id: string;
  parent_section_id: string | null;
  position: number;
};

type PlayerState = "error" | "loading" | "needs-drive" | "ready";
const workerRevision = "refresh-token-v1";

async function getDriveWorker() {
  const registration = await navigator.serviceWorker.register(
    `/sw.js?revision=${workerRevision}`,
    { scope: "/" },
  );
  if (registration.active?.scriptURL.includes(`revision=${workerRevision}`)) {
    return registration.active;
  }

  const pending = registration.installing ?? registration.waiting;
  if (!pending) {
    throw new Error("No se pudo actualizar el reproductor de Drive. Recarga normalmente.");
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("La actualización de Drive tardó demasiado.")),
      5000,
    );
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") {
        window.clearTimeout(timeout);
        resolve();
      }
      if (pending.state === "redundant") {
        window.clearTimeout(timeout);
        reject(new Error("No se pudo activar el reproductor de Drive."));
      }
    });
  });
  if (!registration.active?.scriptURL.includes(`revision=${workerRevision}`)) {
    throw new Error("El reproductor de Drive no se actualizó. Recarga normalmente.");
  }
  return registration.active;
}

export default function CoursePlayerContent() {
  const router = useRouter();
  const params = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedAt = useRef(0);
  const [state, setState] = useState<PlayerState>("loading");
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [courseComplete, setCourseComplete] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [fileId, setFileId] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const requestedLessonId = params.get("lesson");
  const shouldAutoplay = params.get("autoplay") === "1";

  useEffect(() => {
    let cancelled = false;

    async function prepare() {
      setState("loading");
      setError("");
      setCourseComplete(false);
      lastSavedAt.current = 0;
      try {
        const db = createSupabaseBrowserClient();
        const { data: userData, error: userError } = await db.auth.getUser();
        if (userError) throw new Error("No se pudo comprobar tu sesión.");
        if (!userData.user) {
          router.replace("/signin");
          return;
        }
        if (!requestedLessonId) {
          router.replace("/catalog");
          return;
        }

        const { data: requestedLesson, error: requestedError } = await db
          .from("lessons")
          .select("course_id")
          .eq("id", requestedLessonId)
          .eq("is_visible", true)
          .maybeSingle<{ course_id: string }>();
        if (requestedError) throw new Error("No se pudo consultar la lección solicitada.");
        if (!requestedLesson) throw new Error("La lección solicitada no existe o no está visible.");

        const [lessonResult, sectionResult] = await Promise.all([
          db
            .from("lessons")
            .select("id, course_id, detected_title, custom_title, section_id, drive_item_id, position")
            .eq("course_id", requestedLesson.course_id)
            .eq("is_visible", true)
            .order("position"),
          db
            .from("course_sections")
            .select("id, course_id, parent_section_id, position")
            .eq("course_id", requestedLesson.course_id)
            .eq("is_detected_section", true)
            .eq("is_visible", true)
            .order("position"),
        ]);
        if (lessonResult.error || sectionResult.error) {
          throw new Error("No se pudo cargar la estructura del curso.");
        }

        const ordered = buildCoursePlaybackQueue(
          requestedLesson.course_id,
          (lessonResult.data ?? []) as Lesson[],
          (sectionResult.data ?? []) as Section[],
        );
        const active = ordered.find((lesson) => lesson.id === requestedLessonId);
        if (!active?.drive_item_id) throw new Error("No hay un archivo reproducible para esta lección.");

        const { data: item, error: itemError } = await db
          .from("drive_items")
          .select("drive_file_id")
          .eq("id", active.drive_item_id)
          .maybeSingle<{ drive_file_id: string }>();
        if (itemError || !item) throw new Error("No se encontró el archivo de Drive de esta lección.");

        const worker = await getDriveWorker();
        const tokenResponse = await fetch("/api/drive-token", { cache: "no-store" });
        if (tokenResponse.status === 401) {
          if (!cancelled) setState("needs-drive");
          return;
        }
        if (!tokenResponse.ok) throw new Error("No se pudo autorizar la reproducción.");
        const { accessToken } = (await tokenResponse.json()) as { accessToken: string };
        worker.postMessage({ token: accessToken, type: "drive-access-token" });

        if (!cancelled) {
          setFileId(item.drive_file_id);
          setLessons(ordered);
          setSelectedId(active.id);
          setState("ready");
          setUserId(userData.user.id);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "No se pudo preparar el reproductor.");
          setState("error");
        }
      }
    }

    void prepare();
    return () => {
      cancelled = true;
    };
  }, [requestedLessonId, router]);

  const selected = lessons.find((lesson) => lesson.id === selectedId);
  const title = selected ? selected.custom_title ?? selected.detected_title : "";
  const returnTo = `/course-player?lesson=${requestedLessonId ?? ""}`;

  async function saveProgress(seconds: number, duration: number, completed = false) {
    if (!selectedId || !userId || !Number.isFinite(duration)) return;
    await createSupabaseBrowserClient().from("lesson_progress").upsert({
      completed_at: completed ? new Date().toISOString() : null,
      duration_seconds: Math.round(duration),
      lesson_id: selectedId,
      position_seconds: Math.round(completed ? duration : seconds),
      state: completed ? "completed" : "in_progress",
      user_id: userId,
    });
  }

  async function restoreProgress() {
    const video = videoRef.current;
    if (!video || !selectedId || !userId) return;
    const { data } = await createSupabaseBrowserClient()
      .from("lesson_progress")
      .select("position_seconds, state")
      .eq("lesson_id", selectedId)
      .eq("user_id", userId)
      .maybeSingle<{ position_seconds: number; state: string }>();
    if (
      data &&
      data.state !== "completed" &&
      data.position_seconds > 5 &&
      data.position_seconds < video.duration - 5
    ) {
      video.currentTime = data.position_seconds;
    }
  }

  async function saveCurrentPosition() {
    const video = videoRef.current;
    if (video && !video.ended && Number.isFinite(video.duration)) {
      await saveProgress(video.currentTime, video.duration);
    }
  }

  async function download() {
    if (!fileId) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(`/drive-download/${fileId}`, { cache: "no-store" });
      const data = (await response.json()) as { webContentLink?: string };
      if (!response.ok || !data.webContentLink) {
        throw new Error("Drive no entregó un enlace de descarga para esta lección.");
      }
      window.location.assign(data.webContentLink);
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : "No se pudo preparar la descarga.");
      setDownloading(false);
    }
  }

  async function selectLesson(lessonId: string) {
    await saveCurrentPosition();
    router.push(`/course-player?lesson=${lessonId}`);
  }

  async function playNext() {
    const video = videoRef.current;
    if (!video || !selectedId) return;
    await saveProgress(video.duration, video.duration, true);
    const following = lessons[lessons.findIndex((lesson) => lesson.id === selectedId) + 1];
    if (following) {
      router.push(`/course-player?lesson=${following.id}&autoplay=1`);
    } else {
      setCourseComplete(true);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <section className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <p className="text-sm font-semibold tracking-[.2em] text-sky-300 uppercase">Reproductor</p>
          <h1 className="mt-2 text-2xl font-semibold">{title || "Preparando lección…"}</h1>

          {state === "loading" ? <p className="mt-8">Preparando el reproductor…</p> : null}
          {state === "needs-drive" ? (
            <p className="mt-8">
              Debes <Link className="text-sky-300 underline" href={`/drive-access?returnTo=${encodeURIComponent(returnTo)}`}>autorizar Drive</Link> para reproducir.
            </p>
          ) : null}
          {state === "error" ? <p className="mt-8 text-rose-200">{error}</p> : null}

          {state === "ready" && fileId ? (
            <>
              <video
                autoPlay={shouldAutoplay}
                className="mt-6 aspect-video w-full rounded-2xl bg-black"
                controls
                onEnded={() => void playNext()}
                onLoadedMetadata={() => void restoreProgress()}
                onPause={() => void saveCurrentPosition()}
                onTimeUpdate={(event) => {
                  const video = videoRef.current;
                  const now = event.timeStamp;
                  if (video && now - lastSavedAt.current >= 10_000) {
                    lastSavedAt.current = now;
                    void saveProgress(video.currentTime, video.duration);
                  }
                }}
                preload="metadata"
                ref={videoRef}
                src={`/drive-stream/${fileId}`}
              />
              {courseComplete ? (
                <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                  <p className="font-semibold text-emerald-200">Curso completado</p>
                  <Link className="mt-2 inline-block text-sky-300 underline" href="/catalog">Volver al catálogo</Link>
                </div>
              ) : null}
              <div className="mt-4">
                <button className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60" disabled={downloading} onClick={() => void download()} type="button">
                  {downloading ? "Preparando descarga…" : "Descargar en este dispositivo"}
                </button>
                {downloadError ? <p className="mt-2 text-sm text-rose-200">{downloadError}</p> : null}
              </div>
              {selectedId ? (
                <LessonNotes
                  lessonId={selectedId}
                  readSecond={() => videoRef.current?.currentTime ?? 0}
                  seekTo={(seconds) => {
                    if (videoRef.current) videoRef.current.currentTime = seconds;
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="font-semibold">Lecciones</h2>
          <div className="mt-4 flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
            {lessons.map((lesson) => (
              <button
                className={`rounded-xl px-3 py-2 text-left text-sm ${lesson.id === selectedId ? "bg-sky-400/15 text-sky-100" : "text-slate-300 hover:bg-slate-800"}`}
                key={lesson.id}
                onClick={() => void selectLesson(lesson.id)}
                type="button"
              >
                {lesson.custom_title ?? lesson.detected_title}
              </button>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
