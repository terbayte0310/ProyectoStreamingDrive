import { redirect } from "next/navigation";

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

type CourseReference = { course_id: string };

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_authorized")
    .eq("id", userData.user.id)
    .maybeSingle<{ is_authorized: boolean }>();
  if (!profile?.is_authorized) redirect("/dashboard");

  const [categoriesResult, coursesResult, sectionsResult, lessonsResult] = await Promise.all([
    supabase.from("categories").select("id, detected_title, custom_title, position").order("position"),
    supabase.from("courses").select("id, category_id, detected_title, custom_title, position").order("position"),
    supabase.from("course_sections").select("course_id"),
    supabase.from("lessons").select("course_id"),
  ]);

  if (categoriesResult.error || coursesResult.error || sectionsResult.error || lessonsResult.error) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <p>No se pudo cargar el catálogo todavía.</p>
      </main>
    );
  }

  const categories = (categoriesResult.data ?? []) as Category[];
  const courses = (coursesResult.data ?? []) as Course[];
  const sections = (sectionsResult.data ?? []) as CourseReference[];
  const lessons = (lessonsResult.data ?? []) as CourseReference[];

  const courseCards = (categoryId: string) =>
    courses
      .filter((course) => course.category_id === categoryId)
      .map((course) => {
        const sectionCount = sections.filter((section) => section.course_id === course.id).length;
        const lessonCount = lessons.filter((lesson) => lesson.course_id === course.id).length;
        return (
          <article className="rounded-2xl border border-slate-700 bg-slate-900 p-5" key={course.id}>
            <h2 className="text-xl font-semibold">{course.custom_title ?? course.detected_title}</h2>
            <p className="mt-2 text-sm text-slate-300">
              {sectionCount} secciones · {lessonCount} lecciones
            </p>
            <p className="mt-4 text-sm text-sky-300">El reproductor se conectará en el siguiente hito.</p>
          </article>
        );
      });

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto w-full max-w-5xl">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Biblioteca personal</p>
        <h1 className="mt-3 text-4xl font-semibold">Catálogo</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Esta vista procede de la importación de Google Drive. Los nombres personalizados sustituirán a los detectados cuando los agregues desde administración.
        </p>
        <div className="mt-10 flex flex-col gap-10">
          {categories.map((category) => (
            <section key={category.id}>
              <h2 className="text-2xl font-semibold">{category.custom_title ?? category.detected_title}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">{courseCards(category.id)}</div>
            </section>
          ))}
          {categories.length === 0 ? <p className="text-slate-300">Todavía no hay cursos importados.</p> : null}
        </div>
        <a className="mt-10 inline-block text-sky-300 underline" href="/dashboard">Volver al panel</a>
      </section>
    </main>
  );
}
