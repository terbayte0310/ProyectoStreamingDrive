import {
  AdminCourseManager,
  type AdminCourse,
  type AdminLesson,
  type AdminSection,
} from "@/components/admin-course-manager";
import { CatalogSyncPanel } from "@/components/catalog-sync-panel";
import { requireAdminAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminAccess();
  const supabase = await createSupabaseServerClient();
  const [coursesResult, sectionsResult, lessonsResult] = await Promise.all([
    supabase
      .from("courses")
      .select("id, detected_title, custom_title, author, platform, published_on, description, cover_url, is_visible")
      .order("position"),
    supabase
      .from("course_sections")
      .select("id, course_id, parent_section_id, detected_title, custom_title, position, is_visible")
      .eq("is_detected_section", true),
    supabase
      .from("lessons")
      .select("id, course_id, section_id, detected_title, custom_title, position, is_visible"),
  ]);
  const error = coursesResult.error ?? sectionsResult.error ?? lessonsResult.error;
  const courses = (coursesResult.data ?? []) as AdminCourse[];
  const lessons = (lessonsResult.data ?? []) as AdminLesson[];
  const sections = (sectionsResult.data ?? []) as AdminSection[];
  const catalogRevision = JSON.stringify([courses, lessons, sections]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <section className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-[.2em] text-sky-300 uppercase">Administración</p>
            <h1 className="mt-2 text-3xl font-semibold">Catálogo</h1>
            <p className="mt-2 text-slate-300">Los cambios solo afectan la aplicación; nunca modifican archivos de Drive.</p>
          </div>
          <a className="rounded-xl border border-slate-600 px-4 py-2 font-medium hover:bg-slate-800" href="/catalog">Ver catálogo</a>
        </div>
        {error ? (
          <p className="mt-8 text-rose-200">No se pudo cargar el catálogo para editar.</p>
        ) : (
          <>
            <CatalogSyncPanel />
            <AdminCourseManager
              courses={courses}
              key={catalogRevision}
              lessons={lessons}
              sections={sections}
            />
          </>
        )}
      </section>
    </main>
  );
}
