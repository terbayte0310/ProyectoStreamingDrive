import { redirect } from "next/navigation";

import { buildCoursePlaybackQueue } from "@/lib/catalog/outline";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Category = {
  custom_title: string | null;
  detected_title: string;
  id: string;
  position: number;
};

type Course = {
  category_id: string | null;
  custom_title: string | null;
  detected_title: string;
  id: string;
  position: number;
};

type Lesson = {
  course_id: string;
  custom_title: string | null;
  detected_title: string;
  id: string;
  position: number;
  section_id: string | null;
};

type SectionReference = {
  course_id: string;
  id: string;
  parent_section_id: string | null;
  position: number;
};

type Progress = {
  lesson_id: string;
  position_seconds: number;
  state: "not_started" | "in_progress" | "completed";
  updated_at: string;
};

type Profile = { is_authorized: boolean; role: "admin" | "reader" };

function courseTitle(course: Course) {
  return course.custom_title ?? course.detected_title;
}

function lessonTitle(lesson: Lesson) {
  return lesson.custom_title ?? lesson.detected_title;
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      aria-label={`${percent}% completado`}
      className="h-2 overflow-hidden rounded-full bg-slate-700"
      role="progressbar"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
    >
      <div className="h-full rounded-full bg-sky-400" style={{ width: `${percent}%` }} />
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_authorized, role")
    .eq("id", userData.user.id)
    .maybeSingle<Profile>();
  if (!profile?.is_authorized) redirect("/dashboard");

  const [categoriesResult, coursesResult, sectionsResult, lessonsResult, progressResult] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, detected_title, custom_title, position")
        .eq("is_visible", true)
        .order("position"),
      supabase
        .from("courses")
        .select("id, category_id, detected_title, custom_title, position")
        .eq("is_visible", true)
        .order("position"),
      supabase
        .from("course_sections")
        .select("id, course_id, parent_section_id, position")
        .eq("is_detected_section", true)
        .eq("is_visible", true),
      supabase
        .from("lessons")
        .select("id, course_id, detected_title, custom_title, section_id, position")
        .eq("is_visible", true)
        .order("position"),
      supabase
        .from("lesson_progress")
        .select("lesson_id, position_seconds, state, updated_at")
        .eq("user_id", userData.user.id),
    ]);

  if (
    categoriesResult.error ||
    coursesResult.error ||
    sectionsResult.error ||
    lessonsResult.error ||
    progressResult.error
  ) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <p>No se pudo cargar el catálogo todavía.</p>
      </main>
    );
  }

  const categories = (categoriesResult.data ?? []) as Category[];
  const courses = (coursesResult.data ?? []) as Course[];
  const sections = (sectionsResult.data ?? []) as SectionReference[];
  const lessons = (lessonsResult.data ?? []) as Lesson[];
  const progressByLesson = new Map(
    ((progressResult.data ?? []) as Progress[]).map((progress) => [progress.lesson_id, progress]),
  );

  function renderCourseCard(course: Course) {
    const courseLessons = buildCoursePlaybackQueue(course.id, lessons, sections);
    const sectionCount = sections.filter((section) => section.course_id === course.id).length;
    const completedCount = courseLessons.filter(
      (lesson) => progressByLesson.get(lesson.id)?.state === "completed",
    ).length;
    const percent = courseLessons.length
      ? Math.round((completedCount / courseLessons.length) * 100)
      : 0;
    const resumableLesson = courseLessons
      .map((lesson) => ({ lesson, progress: progressByLesson.get(lesson.id) }))
      .filter(({ progress }) => progress?.state === "in_progress")
      .sort(
        (first, second) =>
          new Date(second.progress!.updated_at).getTime() -
          new Date(first.progress!.updated_at).getTime(),
      )[0]?.lesson;
    const firstUncompletedLesson = courseLessons.find(
      (lesson) => progressByLesson.get(lesson.id)?.state !== "completed",
    );
    const destination = resumableLesson ?? firstUncompletedLesson ?? courseLessons[0];

    return (
      <article className="rounded-2xl border border-slate-700 bg-slate-900 p-5" key={course.id}>
        <h3 className="text-xl font-semibold">{courseTitle(course)}</h3>
        <p className="mt-2 text-sm text-slate-300">
          {sectionCount} secciones · {courseLessons.length} lecciones
        </p>

        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-slate-200">Tu avance</span>
            <span className="text-sky-300">
              {completedCount}/{courseLessons.length} · {percent}%
            </span>
          </div>
          <ProgressBar percent={percent} />
        </div>

        {resumableLesson ? (
          <p className="mt-4 text-sm text-slate-300">
            Continúa: {lessonTitle(resumableLesson)}
          </p>
        ) : null}

        {destination ? (
          <a
            className="mt-5 inline-flex rounded-xl bg-white px-4 py-2 font-semibold text-slate-950"
            href={`/course-player?lesson=${destination.id}`}
          >
            {resumableLesson ? "Continuar viendo" : completedCount ? "Repasar curso" : "Empezar curso"}
          </a>
        ) : (
          <p className="mt-5 text-sm text-slate-400">Este curso todavía no tiene videos disponibles.</p>
        )}
      </article>
    );
  }

  const uncategorizedCourses = courses.filter((course) => !course.category_id);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto w-full max-w-5xl">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">
          Biblioteca personal
        </p>
        <h1 className="mt-3 text-4xl font-semibold">Catálogo</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Tu avance es privado. Se calcula a partir de las lecciones terminadas y se actualiza al
          reproducir desde la aplicación.
        </p>

        <div className="mt-10 flex flex-col gap-10">
          {categories.map((category) => {
            const categoryCourses = courses.filter((course) => course.category_id === category.id);
            if (!categoryCourses.length) return null;

            return (
              <section key={category.id}>
                <h2 className="text-2xl font-semibold">
                  {category.custom_title ?? category.detected_title}
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {categoryCourses.map(renderCourseCard)}
                </div>
              </section>
            );
          })}

          {uncategorizedCourses.length ? (
            <section>
              <h2 className="text-2xl font-semibold">Sin categoría</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {uncategorizedCourses.map(renderCourseCard)}
              </div>
            </section>
          ) : null}

          {courses.length === 0 ? <p className="text-slate-300">Todavía no hay cursos importados.</p> : null}
        </div>

        <nav className="mt-10 flex flex-wrap gap-4 text-sky-300 underline">
          <a href="/dashboard">Mi cuenta</a>
          {profile.role === "admin" ? <a href="/admin">Administrar catálogo</a> : null}
        </nav>
      </section>
    </main>
  );
}
