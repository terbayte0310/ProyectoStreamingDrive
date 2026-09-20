import type { Metadata } from "next";
import { redirect } from "next/navigation";

import CoursePlayerContent, { type ClassroomLesson } from "@/components/course-player-content";
import { SiteHeader } from "@/components/site-header";
import { requireModuleAccess } from "@/lib/auth/access";
import { buildCoursePlaybackQueue } from "@/lib/catalog/outline";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aula" };

type LessonRow = {
  course_id: string;
  custom_title: string | null;
  detected_title: string;
  drive_item_id: string | null;
  drive_items: { drive_file_id: string } | null;
  id: string;
  position: number;
  section_id: string | null;
};
type SectionRow = { course_id: string; custom_title: string | null; detected_title: string; id: string; parent_section_id: string | null; position: number };
type ProgressRow = { lesson_id: string; position_seconds: number; state: string };

/**
 * Todo lo necesario para empezar a reproducir se resuelve aquí, en dos rondas
 * paralelas contra Supabase: el navegador ya no encadena consultas antes del
 * primer fotograma y puede cambiar de lección sin volver al servidor.
 */
export default async function CoursePlayerPage({ searchParams }: { searchParams: Promise<{ autoplay?: string; lesson?: string }> }) {
  const { autoplay, lesson: requestedLessonId } = await searchParams;
  if (!requestedLessonId) redirect("/catalog/cursos");
  const supabase = await createSupabaseServerClient();
  const [viewer, requestedResult] = await Promise.all([
    requireModuleAccess("courses"),
    supabase.from("lessons").select("course_id").eq("id", requestedLessonId).eq("is_visible", true).maybeSingle<{ course_id: string }>(),
  ]);
  const courseId = requestedResult.data?.course_id;

  if (!courseId) {
    return (
      <div className="shell">
        <SiteHeader />
        <main className="shell-main container">
          <section className="empty-state" style={{ marginTop: 40 }}>
            <span aria-hidden="true" className="empty-orb" />
            <h1 className="title-l">Esta lección no está disponible</h1>
            <p>Puede que se haya ocultado o movido. Vuelve al catálogo para elegir otra.</p>
            <a className="btn btn-primary" href="/catalog/cursos">Ir a cursos</a>
          </section>
        </main>
      </div>
    );
  }

  const [courseResult, lessonsResult, sectionsResult, progressResult] = await Promise.all([
    supabase.from("courses").select("custom_title, detected_title").eq("id", courseId).maybeSingle<{ custom_title: string | null; detected_title: string }>(),
    supabase.from("lessons").select("id, course_id, detected_title, custom_title, section_id, drive_item_id, position, drive_items(drive_file_id)").eq("course_id", courseId).eq("is_visible", true).order("position").returns<LessonRow[]>(),
    supabase.from("course_sections").select("id, course_id, parent_section_id, position, custom_title, detected_title").eq("course_id", courseId).eq("is_detected_section", true).eq("is_visible", true).order("position").returns<SectionRow[]>(),
    supabase.from("lesson_progress").select("lesson_id, position_seconds, state, lessons!inner(course_id)").eq("user_id", viewer.user.id).eq("lessons.course_id", courseId).returns<ProgressRow[]>(),
  ]);

  const loadError = lessonsResult.error || sectionsResult.error ? "No se pudo cargar la estructura del curso." : "";
  const sections = sectionsResult.data ?? [];
  const sectionTitles = new Map(sections.map((section) => [section.id, section.custom_title ?? section.detected_title]));
  const ordered = buildCoursePlaybackQueue(courseId, lessonsResult.data ?? [], sections);

  // Si la relación embebida no llega (RLS o datos antiguos), se consulta directamente.
  const missingFileIds = ordered.filter((lesson) => lesson.drive_item_id && !lesson.drive_items?.drive_file_id).map((lesson) => lesson.drive_item_id!);
  const fallbackFiles = missingFileIds.length
    ? await supabase.from("drive_items").select("id, drive_file_id").in("id", missingFileIds.slice(0, 200))
    : { data: [] as Array<{ drive_file_id: string; id: string }> };
  const fileByItem = new Map((fallbackFiles.data ?? []).map((item) => [item.id, item.drive_file_id]));
  const progress = new Map((progressResult.data ?? []).map((row) => [row.lesson_id, row]));

  const lessons: ClassroomLesson[] = ordered.map((lesson) => {
    const saved = progress.get(lesson.id);
    return {
      completed: saved?.state === "completed",
      fileId: lesson.drive_items?.drive_file_id ?? (lesson.drive_item_id ? fileByItem.get(lesson.drive_item_id) ?? null : null),
      id: lesson.id,
      position: saved && saved.state !== "completed" ? saved.position_seconds : 0,
      section: lesson.section_id ? sectionTitles.get(lesson.section_id) ?? null : null,
      title: lesson.custom_title ?? lesson.detected_title,
    };
  });

  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell-main container">
        <CoursePlayerContent
          autoplay={autoplay === "1"}
          courseId={courseId}
          courseTitle={courseResult.data?.custom_title ?? courseResult.data?.detected_title ?? "Curso"}
          initialLessonId={requestedLessonId}
          lessons={lessons}
          loadError={loadError}
          userId={viewer.user.id}
        />
      </main>
    </div>
  );
}
