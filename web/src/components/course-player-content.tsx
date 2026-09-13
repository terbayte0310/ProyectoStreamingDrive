"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CourseResources } from "@/components/course-resources";
import { LessonNotes } from "@/components/lesson-notes";
import { completeSignOut } from "@/lib/auth/sign-out-client";
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
const workerRevision = "budget-v1";

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
  const selectedIndex = lessons.findIndex((lesson) => lesson.id === selectedId);
  const previous = selectedIndex > 0 ? lessons[selectedIndex - 1] : undefined;
  const next = selectedIndex >= 0 ? lessons[selectedIndex + 1] : undefined;
  const title = selected ? selected.custom_title ?? selected.detected_title : "";
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
    <div className="app-shell player-page">
      <AppHeader />
      <main className="player-layout">
        <section className="player-stage">
          <div className="player-titlebar">
            <div><p className="eyebrow">Lección {selectedIndex >= 0 ? selectedIndex + 1 : "—"} de {lessons.length || "—"}</p><h1>{title || "Preparando lección…"}</h1></div>
            <Link className="secondary-button" href="/catalog">Salir del aula</Link>
          </div>

          {state === "loading" ? <div className="status-card">Preparando una reproducción segura desde Drive…</div> : null}
          {state === "needs-drive" ? (
            <div className="status-card">
              <p>Esta sesión se creó antes de habilitar el acceso integrado a Drive.</p>
              <button className="secondary-button mt-4" onClick={() => void completeSignOut()} type="button">
                Volver a iniciar sesión
              </button>
            </div>
          ) : null}
          {state === "error" ? <div className="status-card text-rose-500">{error}</div> : null}

          {state === "ready" && fileId ? (
            <>
              <div className="video-shell">
                <video
                  autoPlay={shouldAutoplay}
                  controls
                  onEnded={() => void playNext()}
                  onLoadedMetadata={() => void restoreProgress()}
                  onPause={() => void saveCurrentPosition()}
                  onTimeUpdate={(event) => {
                    const video = videoRef.current;
                    if (video && event.timeStamp - lastSavedAt.current >= 10_000) {
                      lastSavedAt.current = event.timeStamp;
                      void saveProgress(video.currentTime, video.duration);
                    }
                  }}
                  playsInline
                  preload="metadata"
                  ref={videoRef}
                  src={`/drive-stream/${fileId}`}
                />
              </div>
              <div className="player-tools">
                <button className="secondary-button" disabled={!previous} onClick={() => previous && void selectLesson(previous.id)} type="button">← Anterior</button>
                <button className="primary-button" disabled={!next} onClick={() => next && void selectLesson(next.id)} type="button">Siguiente →</button>
                <button className="secondary-button" disabled={downloading} onClick={() => void download()} type="button">{downloading ? "Preparando…" : "↓ Descargar"}</button>
              </div>
              {downloadError ? <p className="auth-message">{downloadError}</p> : null}
              {courseComplete ? <div className="status-card"><strong>Curso completado</strong><p className="muted mt-1">Buen trabajo. Tu progreso quedó guardado.</p></div> : null}
              {selected ? <CourseResources courseId={selected.course_id} /> : null}
              {selectedId ? <LessonNotes lessonId={selectedId} readSecond={() => videoRef.current?.currentTime ?? 0} seekTo={(seconds) => { if (videoRef.current) videoRef.current.currentTime = seconds; }} /> : null}
            </>
          ) : null}
        </section>

        <aside className="player-sidebar">
          <div className="sidebar-head"><h2>Contenido del curso</h2><p>{lessons.length} lecciones en orden</p></div>
          <div className="lesson-list">
            {lessons.map((lesson, index) => (
              <button className={`lesson-button ${lesson.id === selectedId ? "lesson-button-active" : ""}`} key={lesson.id} onClick={() => void selectLesson(lesson.id)} type="button">
                <span className="lesson-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="lesson-name">{lesson.custom_title ?? lesson.detected_title}</span>
              </button>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
