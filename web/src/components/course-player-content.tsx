"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { SegmentedThumb } from "@/components/catalog-collection";
import { CourseResources } from "@/components/course-resources";
import { Icon } from "@/components/icons";
import { LessonNotes } from "@/components/lesson-notes";
import { NebulaPlayer, type PlayerStatus } from "@/components/nebula-player";
import { toast } from "@/components/toaster";
import { completeSignOut } from "@/lib/auth/sign-out-client";
import { getDriveWorker, sendDriveToken } from "@/lib/media/drive-worker";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type ClassroomLesson = { completed: boolean; fileId: string | null; id: string; position: number; section: string | null; title: string };

type Props = {
  autoplay: boolean;
  courseId: string;
  courseTitle: string;
  initialLessonId: string;
  lessons: ClassroomLesson[];
  loadError: string;
  userId: string;
};

const theaterKey = "nb-theater";
const theaterListeners = new Set<() => void>();
const readTheater = () => { try { return localStorage.getItem(theaterKey) === "1"; } catch { return false; } };
const subscribeTheater = (listener: () => void) => { theaterListeners.add(listener); return () => { theaterListeners.delete(listener); }; };

export default function CoursePlayerContent({ autoplay, courseId, courseTitle, initialLessonId, lessons: initialLessons, loadError, userId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSavedAt = useRef(0);
  const [lessons, setLessons] = useState(initialLessons);
  const [activeId, setActiveId] = useState(initialLessonId);
  const [autoPlayNext, setAutoPlayNext] = useState(autoplay);
  const [status, setStatus] = useState<PlayerStatus>(loadError ? "error" : "loading");
  const [error, setError] = useState(loadError);
  // Preferencia por dispositivo: el servidor pinta el modo normal y el cliente aplica la guardada.
  const theater = useSyncExternalStore(subscribeTheater, readTheater, () => false);
  const [tab, setTab] = useState<"notes" | "resources">("notes");
  const [downloading, setDownloading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const index = lessons.findIndex((lesson) => lesson.id === activeId);
  const active = index >= 0 ? lessons[index] : undefined;
  const previous = index > 0 ? lessons[index - 1] : undefined;
  const next = index >= 0 ? lessons[index + 1] : undefined;
  const completedCount = lessons.filter((lesson) => lesson.completed).length;
  const percent = lessons.length ? Math.round((completedCount / lessons.length) * 100) : 0;

  // Worker y token de Drive en paralelo; el vídeo se monta en cuanto el worker controla la página.
  useEffect(() => {
    if (loadError) return;
    let cancelled = false;
    async function prepare() {
      setStatus("loading");
      try {
        const [worker, tokenResponse] = await Promise.all([getDriveWorker(), fetch("/api/drive-token", { cache: "no-store" })]);
        if (cancelled) return;
        if (tokenResponse.status === 401) { setStatus("needs-auth"); return; }
        if (!tokenResponse.ok) throw new Error("No se pudo autorizar la reproducción.");
        const { accessToken } = (await tokenResponse.json()) as { accessToken: string };
        await sendDriveToken(worker, accessToken, "courses");
        if (!cancelled) setStatus("ready");
      } catch (caught) {
        if (!cancelled) { setError(caught instanceof Error ? caught.message : "No se pudo preparar el reproductor."); setStatus("error"); }
      }
    }
    void prepare();
    return () => { cancelled = true; };
  }, [attempt, loadError]);

  // Atrás/adelante del navegador vuelven a la lección correspondiente.
  useEffect(() => {
    const onPop = () => {
      const lesson = new URLSearchParams(window.location.search).get("lesson");
      if (lesson && lessons.some((item) => item.id === lesson)) setActiveId(lesson);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [lessons]);

  // La lección activa se mantiene visible en la lista.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const saveProgress = useCallback(async (lessonId: string, seconds: number, duration: number, completed = false) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const { error: saveError } = await createSupabaseBrowserClient().from("lesson_progress").upsert({
      completed_at: completed ? new Date().toISOString() : null,
      duration_seconds: Math.round(duration),
      lesson_id: lessonId,
      position_seconds: Math.round(completed ? duration : seconds),
      state: completed ? "completed" : "in_progress",
      user_id: userId,
    });
    if (saveError) toast("No se pudo guardar tu avance. Revisa la conexión.", "warn");
    setLessons((current) => current.map((lesson) => lesson.id === lessonId ? { ...lesson, completed: lesson.completed || completed, position: completed ? 0 : Math.round(seconds) } : lesson));
  }, [userId]);

  const saveCurrent = useCallback(async () => {
    const video = videoRef.current;
    if (video && active && !video.ended && Number.isFinite(video.duration) && video.currentTime > 3) await saveProgress(active.id, video.currentTime, video.duration);
  }, [active, saveProgress]);

  const select = useCallback((lessonId: string, play = true) => {
    if (lessonId === activeId) return;
    void saveCurrent();
    setAutoPlayNext(play);
    setActiveId(lessonId);
    window.history.pushState(null, "", `/course-player?lesson=${lessonId}`);
  }, [activeId, saveCurrent]);

  async function onEnded() {
    const video = videoRef.current;
    if (!video || !active) return;
    await saveProgress(active.id, video.duration, video.duration, true);
    if (!next) toast(`¡Terminaste “${courseTitle}”! Tu progreso quedó guardado.`, "success", 7000);
  }

  function toggleTheater(value: boolean) {
    try { localStorage.setItem(theaterKey, value ? "1" : "0"); } catch { /* Preferencia opcional. */ }
    theaterListeners.forEach((listener) => listener());
  }

  async function download() {
    if (!active?.fileId) return;
    setDownloading(true);
    try {
      const response = await fetch(`/drive-download/${active.fileId}`, { cache: "no-store" });
      const data = (await response.json()) as { webContentLink?: string };
      if (!response.ok || !data.webContentLink) throw new Error("Drive no entregó un enlace de descarga para esta lección.");
      window.location.assign(data.webContentLink);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "No se pudo preparar la descarga.", "error");
    } finally {
      setDownloading(false);
    }
  }

  const groups = useMemo(() => {
    const result: Array<{ lessons: Array<ClassroomLesson & { number: number }>; section: string | null }> = [];
    lessons.forEach((lesson, position) => {
      const last = result[result.length - 1];
      if (!last || last.section !== lesson.section) result.push({ lessons: [], section: lesson.section });
      result[result.length - 1].lessons.push({ ...lesson, number: position + 1 });
    });
    return result;
  }, [lessons]);

  const playerStatus: PlayerStatus = status === "ready" && !active?.fileId ? "error" : status;
  const playerError = status === "ready" && !active?.fileId ? "Esta lección no tiene un archivo reproducible." : error;

  return (
    <div className="classroom" data-theater={theater ? "" : undefined}>
      <div className="classroom-stage">
        <div className="classroom-head">
          <div>
            <Link className="back-link" href="/catalog/cursos"><Icon name="arrowLeft" />{courseTitle}</Link>
            <h1 className="title-m">{active?.title ?? "Lección"}</h1>
          </div>
          <div className="classroom-nav">
            <button className="btn btn-ghost btn-sm" disabled={!previous} onClick={() => previous && select(previous.id)} type="button"><Icon name="chevronLeft" />Anterior</button>
            <button className="btn btn-primary btn-sm" disabled={!next} onClick={() => next && select(next.id)} type="button">Siguiente<Icon name="chevronRight" /></button>
            <button aria-label="Descargar lección" className="btn btn-ghost btn-sm btn-icon" disabled={downloading || !active?.fileId} onClick={() => void download()} title="Descargar lección" type="button"><Icon name="download" /></button>
          </div>
        </div>

        <NebulaPlayer
          autoPlay={autoPlayNext}
          error={playerError}
          key={`${activeId}:${attempt}`}
          nextLabel={next ? `Siguiente: ${next.title}` : undefined}
          onEnded={() => void onEnded()}
          onNext={next ? () => select(next.id) : undefined}
          onPause={() => void saveCurrent()}
          onPrevious={previous ? () => select(previous.id) : undefined}
          onReauthorize={() => void completeSignOut()}
          onRetry={() => setAttempt((value) => value + 1)}
          onTheaterChange={toggleTheater}
          onTimeUpdate={(event) => {
            const video = videoRef.current;
            if (video && active && event.timeStamp - lastSavedAt.current >= 10_000) {
              lastSavedAt.current = event.timeStamp;
              void saveProgress(active.id, video.currentTime, video.duration);
            }
          }}
          playsInline
          preload="metadata"
          previousLabel={previous ? `Anterior: ${previous.title}` : undefined}
          resumeAt={active?.position && active.position > 5 ? active.position : undefined}
          src={playerStatus === "ready" && active?.fileId ? `/drive-stream/${active.fileId}` : undefined}
          stage={{ index: 0, labels: ["Abriendo el canal seguro de Drive"] }}
          status={playerStatus}
          subtitle={`Lección ${index + 1} de ${lessons.length}`}
          theater={theater}
          title={active?.title ?? "Lección"}
          upNext={next ? { onPlay: () => select(next.id), title: next.title } : null}
          videoRef={videoRef}
        />

        <section className="classroom-tabs card" style={{ padding: "1.2rem" }}>
          <div aria-label="Herramientas de la lección" className="segmented" role="tablist" style={{ width: "fit-content" }}>
            <SegmentedThumb index={tab === "notes" ? 0 : 1} />
            <button aria-selected={tab === "notes"} onClick={() => setTab("notes")} role="tab" type="button">Notas</button>
            <button aria-selected={tab === "resources"} onClick={() => setTab("resources")} role="tab" type="button">Recursos</button>
          </div>
          <div className="tab-panel" key={tab} role="tabpanel">
            {tab === "notes" && active ? (
              <LessonNotes key={active.id} lessonId={active.id} readSecond={() => videoRef.current?.currentTime ?? 0} seekTo={(seconds) => { if (videoRef.current) videoRef.current.currentTime = seconds; }} />
            ) : null}
            {tab === "resources" ? <CourseResources courseId={courseId} /> : null}
          </div>
        </section>
      </div>

      <aside aria-label="Contenido del curso" className="playlist">
        <div className="playlist-head">
          <p className="kicker kicker-plain">Contenido del curso</p>
          <span className="meter"><span style={{ width: `${percent}%` }} /></span>
          <div className="playlist-stats"><span>{completedCount}/{lessons.length} completadas</span><span>{percent}%</span></div>
        </div>
        <div className="playlist-list" ref={listRef}>
          {groups.map((group, groupIndex) => (
            <div key={`${group.section ?? "root"}-${groupIndex}`}>
              {group.section ? <div className="playlist-section">{group.section}</div> : null}
              {group.lessons.map((lesson) => (
                <button aria-current={lesson.id === activeId} className="lesson-row" data-done={lesson.completed ? "" : undefined} key={lesson.id} onClick={() => select(lesson.id)} type="button">
                  <span className="lesson-index">
                    {lesson.id === activeId ? <span aria-hidden="true" className="lesson-bars"><i /><i /><i /></span> : lesson.completed ? <Icon name="check" strokeWidth={2.6} /> : String(lesson.number).padStart(2, "0")}
                  </span>
                  <span>{lesson.title}{!lesson.fileId ? <span className="subtle"> · sin vídeo</span> : null}</span>
                </button>
              ))}
            </div>
          ))}
          {!lessons.length ? <p className="muted" style={{ padding: "1rem" }}>Este curso todavía no tiene lecciones visibles.</p> : null}
        </div>
      </aside>
    </div>
  );
}
