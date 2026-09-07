"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { LessonNotes } from "@/components/lesson-notes";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Lesson = {
  custom_title: string | null;
  detected_title: string;
  drive_item_id: string | null;
  id: string;
  position: number;
  section_id: string | null;
};

type Section = {
  id: string;
  parent_section_id: string | null;
  position: number;
};

type PlayerState = "loading" | "needs-drive" | "ready" | "error";

function sortByPosition<T extends { position: number }>(items: T[]) {
  return [...items].sort((first, second) => first.position - second.position);
}

function orderLessons(lessons: Lesson[], sections: Section[]) {
  const ordered = sortByPosition(lessons.filter((lesson) => !lesson.section_id));

  function addChildren(parentSectionId: string | null) {
    const children = sortByPosition(
      sections.filter((section) => section.parent_section_id === parentSectionId),
    );

    for (const section of children) {
      ordered.push(
        ...sortByPosition(
          lessons.filter((lesson) => lesson.section_id === section.id),
        ),
      );
      addChildren(section.id);
    }
  }

  addChildren(null);
  return ordered;
}

export default function CoursePlayerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedAt = useRef(0);

  const [state, setState] = useState<PlayerState>("loading");
  const [error, setError] = useState("");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [fileId, setFileId] = useState<string>();
  const [userId, setUserId] = useState<string>();

  const requestedLessonId = searchParams.get("lesson");
  const shouldAutoplay = searchParams.get("autoplay") === "1";

  useEffect(() => {
    let cancelled = false;

    async function preparePlayer() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: userData } = await supabase.auth.getUser();

        if (!userData.user) {
          router.replace("/signin");
          return;
        }

        const [{ data: lessonRows }, { data: sectionRows }] = await Promise.all([
          supabase
            .from("lessons")
            .select("id, detected_title, custom_title, section_id, drive_item_id, position")
            .order("position"),
          supabase
            .from("course_sections")
            .select("id, parent_section_id, position")
            .order("position"),
        ]);

        const orderedLessons = orderLessons(
          (lessonRows ?? []) as Lesson[],
          (sectionRows ?? []) as Section[],
        );
        const activeLesson =
          orderedLessons.find((lesson) => lesson.id === requestedLessonId) ??
          orderedLessons[0];

        if (!activeLesson?.drive_item_id) {
          throw new Error("No hay lecciones importadas para reproducir.");
        }

        const { data: driveItem } = await supabase
          .from("drive_items")
          .select("drive_file_id")
          .eq("id", activeLesson.drive_item_id)
          .maybeSingle<{ drive_file_id: string }>();

        if (!driveItem) {
          throw new Error("No se encontró el archivo de Drive de esta lección.");
        }

        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        await navigator.serviceWorker.ready;

        const tokenResponse = await fetch("/api/drive-token", { cache: "no-store" });
        if (!tokenResponse.ok) {
          if (!cancelled) setState("needs-drive");
          return;
        }

        const { accessToken } = (await tokenResponse.json()) as { accessToken: string };
        const worker = registration.active ?? navigator.serviceWorker.controller;
        if (!worker) {
          throw new Error("Recarga una vez para activar el reproductor.");
        }
        worker.postMessage({ type: "drive-access-token", token: accessToken });

        if (!cancelled) {
          setUserId(userData.user.id);
          setLessons(orderedLessons);
          setSelectedId(activeLesson.id);
          setFileId(driveItem.drive_file_id);
          setState("ready");
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "No se pudo preparar el reproductor.",
          );
          setState("error");
        }
      }
    }

    void preparePlayer();
    return () => {
      cancelled = true;
    };
  }, [requestedLessonId, router]);

  const selectedLesson = lessons.find((lesson) => lesson.id === selectedId);
  const lessonTitle = selectedLesson
    ? (selectedLesson.custom_title ?? selectedLesson.detected_title)
    : "";

  async function saveProgress(seconds: number, duration: number, completed = false) {
    if (!selectedId || !userId || !Number.isFinite(duration)) return;

    const supabase = createSupabaseBrowserClient();
    await supabase.from("lesson_progress").upsert({
      completed_at: completed ? new Date().toISOString() : null,
      duration_seconds: Math.round(duration),
      lesson_id: selectedId,
      position_seconds: Math.round(completed ? duration : seconds),
      state: completed ? "completed" : seconds > 0 ? "in_progress" : "not_started",
      user_id: userId,
    });
  }

  async function restoreProgress() {
    const video = videoRef.current;
    if (!video || !selectedId || !userId) return;

    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
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

  function playNextLesson() {
    const video = videoRef.current;
    if (!video || !selectedId) return;

    void saveProgress(video.duration, video.duration, true);
    const selectedIndex = lessons.findIndex((lesson) => lesson.id === selectedId);
    const nextLesson = lessons[selectedIndex + 1];

    if (nextLesson) {
      router.push(`/course-player?lesson=${nextLesson.id}&autoplay=1`);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <section className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <p className="text-sm font-semibold tracking-[.2em] text-sky-300 uppercase">
            Reproductor
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {lessonTitle || "Preparando lección…"}
          </h1>

          {state === "loading" && <p className="mt-8">Preparando el reproductor…</p>}
          {state === "needs-drive" && (
            <p className="mt-8">
              Debes{" "}
              <a className="text-sky-300 underline" href="/drive-access">
                autorizar Drive
              </a>{" "}
              para esta sesión.
            </p>
          )}
          {state === "error" && <p className="mt-8 text-rose-200">{error}</p>}

          {state === "ready" && fileId && (
            <>
              <video
                autoPlay={shouldAutoplay}
                className="mt-6 aspect-video w-full rounded-2xl bg-black"
                controls
                onEnded={playNextLesson}
                onLoadedMetadata={() => void restoreProgress()}
                onTimeUpdate={() => {
                  const video = videoRef.current;
                  if (video && video.currentTime - lastSavedAt.current >= 10) {
                    lastSavedAt.current = video.currentTime;
                    void saveProgress(video.currentTime, video.duration);
                  }
                }}
                preload="metadata"
                ref={videoRef}
                src={`/drive-stream/${fileId}`}
              />

              {selectedId && (
                <LessonNotes
                  lessonId={selectedId}
                  readSecond={() => videoRef.current?.currentTime ?? 0}
                  seekTo={(seconds) => {
                    if (videoRef.current) videoRef.current.currentTime = seconds;
                  }}
                />
              )}
            </>
          )}
        </div>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="font-semibold">Lecciones</h2>
          <div className="mt-4 flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
            {lessons.map((lesson) => (
              <button
                className={`rounded-xl px-3 py-2 text-left text-sm ${
                  lesson.id === selectedId
                    ? "bg-sky-400/15 text-sky-100"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
                key={lesson.id}
                onClick={() => router.push(`/course-player?lesson=${lesson.id}`)}
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
