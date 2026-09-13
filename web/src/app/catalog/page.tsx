import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CourseCover } from "@/components/course-cover";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Profile = { email: string; is_authorized: boolean; role: "admin" | "reader" };
type LibraryModule = "courses" | "movies" | "series";
type ModuleAccessRow = { module: LibraryModule };
type CatalogHomeRow = {
  category_custom_title: string | null;
  category_detected_title: string | null;
  category_id: string | null;
  category_position: number | null;
  completed_lesson_count: number;
  course_author: string | null;
  course_cover_url: string | null;
  course_custom_title: string | null;
  course_description: string | null;
  course_detected_title: string;
  course_id: string;
  course_platform: string | null;
  course_position: number;
  first_lesson_id: string | null;
  first_pending_lesson_id: string | null;
  lesson_count: number;
  resumable_lesson_id: string | null;
  resumable_updated_at: string | null;
  section_count: number;
};
type CourseView = {
  category: string;
  category_id: string | null;
  completed: number;
  cover_url: string | null;
  custom_title: string | null;
  description: string | null;
  destinationId: string | null;
  detected_title: string;
  id: string;
  lessonCount: number;
  percent: number;
  platform: string | null;
  resumable: boolean;
  resumableUpdatedAt: string | null;
  sectionCount: number;
};

const titleOf = (item: { custom_title: string | null; detected_title: string }) => item.custom_title ?? item.detected_title;

function CourseCard({ course }: { course: CourseView }) {
  return (
    <article className="course-card">
      <CourseCover category={course.category} coverUrl={course.cover_url} title={titleOf(course)} />
      <div className="course-card-body">
        <h3>{titleOf(course)}</h3>
        <p className="course-card-meta">{course.sectionCount} secciones · {course.lessonCount} lecciones</p>
        <div aria-label={`${course.percent}% completado`} className="progress-line" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={course.percent}><span style={{ width: `${course.percent}%` }} /></div>
        <div className="course-card-footer">
          {course.destinationId ? <Link href={`/course-player?lesson=${course.destinationId}`}>{course.resumable ? "Continuar" : course.completed ? "Repasar" : "Empezar"} <span aria-hidden="true">→</span></Link> : <span className="muted text-xs">Sin vídeos</span>}
          <span className="percentage">{course.percent}%</span>
        </div>
      </div>
    </article>
  );
}

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ access?: string }> }) {
  const { access: accessNotice } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/signin");

  const { data: profile } = await supabase.from("profiles").select("email, is_authorized, role").eq("id", userData.user.id).maybeSingle<Profile>();
  if (!profile?.is_authorized) redirect("/dashboard");

  const moduleResult = await supabase.rpc("get_my_module_access");
  if (moduleResult.error) {
    return <main className="app-shell grid min-h-screen place-items-center"><div className="status-card">No se pudieron comprobar los módulos asignados.</div></main>;
  }
  const moduleRows = Array.isArray(moduleResult.data) ? moduleResult.data as unknown as ModuleAccessRow[] : [];
  const modules = new Set(moduleRows.flatMap((row) => row.module === "courses" || row.module === "movies" || row.module === "series" ? [row.module] : []));
  const hasCourses = modules.has("courses");
  const catalogResult = hasCourses ? await supabase.rpc("get_catalog_home") : { data: [], error: null };
  if (catalogResult.error) {
    return <main className="app-shell grid min-h-screen place-items-center"><div className="status-card">No se pudo cargar el catálogo todavía.</div></main>;
  }

  const courseViews: CourseView[] = ((catalogResult.data ?? []) as CatalogHomeRow[]).map((course) => {
    const completed = Number(course.completed_lesson_count);
    const lessonCount = Number(course.lesson_count);
    return {
      category: course.category_custom_title ?? course.category_detected_title ?? "Biblioteca",
      category_id: course.category_id,
      completed,
      cover_url: course.course_cover_url,
      custom_title: course.course_custom_title,
      description: course.course_description,
      destinationId: course.resumable_lesson_id ?? course.first_pending_lesson_id ?? course.first_lesson_id,
      detected_title: course.course_detected_title,
      id: course.course_id,
      lessonCount,
      percent: lessonCount ? Math.round((completed / lessonCount) * 100) : 0,
      platform: course.course_platform,
      resumable: Boolean(course.resumable_lesson_id),
      resumableUpdatedAt: course.resumable_updated_at,
      sectionCount: Number(course.section_count),
    };
  });

  const continueWatching = courseViews.filter((course) => course.resumable).sort((a, b) => (b.resumableUpdatedAt ?? "").localeCompare(a.resumableUpdatedAt ?? ""));
  const featured = continueWatching[0] ?? courseViews[0];

  return (
    <div className="app-shell">
      <AppHeader admin={profile.role === "admin"} email={profile.email} showNavigation={hasCourses} />
      <main className="catalog-main page-width">
        {accessNotice === "course-denied" ? <div className="status-card mb-8">No tienes acceso al módulo Cursos. El catálogo muestra únicamente los módulos asignados a tu cuenta.</div> : null}
        {!modules.size ? (
          <section className="status-card">
            <p className="eyebrow">Acceso pendiente</p>
            <h1 className="mt-2 text-3xl font-semibold">Todavía no tienes módulos asignados.</h1>
            <p className="mt-3 muted">Solicita a un administrador acceso a Cursos, Películas o Series.</p>
          </section>
        ) : null}
        {!hasCourses && modules.size ? (
          <section className="status-card mb-8">
            <p className="eyebrow">Módulos autorizados</p>
            <h1 className="mt-2 text-3xl font-semibold">{[...modules].map((module) => module === "movies" ? "Películas" : module === "series" ? "Series" : "Cursos").join(" y ")}</h1>
            <p className="mt-3 muted">Solo verás contenido de los módulos que tengas asignados. Sus catálogos aparecerán aquí cuando estén publicados.</p>
          </section>
        ) : null}

        {hasCourses ? <>
        {featured ? (
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">{featured.resumable ? "Continúa aprendiendo" : "Selección de tu biblioteca"}</p>
              <h1>{titleOf(featured)}</h1>
              <p className="hero-description">{featured.description ?? `Retoma tu aprendizaje en ${featured.category}. Tu avance se guarda automáticamente mientras reproduces cada lección.`}</p>
              <div className="hero-meta"><span className="meta-pill">{featured.category}</span><span className="meta-pill">{featured.lessonCount} lecciones</span><span className="meta-pill">{featured.percent}% completado</span>{featured.platform ? <span className="meta-pill">{featured.platform}</span> : null}</div>
              <div className="hero-actions">{featured.destinationId ? <Link className="primary-button" href={`/course-player?lesson=${featured.destinationId}`}><span aria-hidden="true">▶</span> {featured.resumable ? "Continuar viendo" : "Comenzar curso"}</Link> : null}<a className="secondary-button" href="#biblioteca">Explorar biblioteca</a></div>
            </div>
            <div aria-hidden="true" className="hero-art"><CourseCover category={featured.category} coverUrl={featured.cover_url} title={titleOf(featured)} /></div>
          </section>
        ) : null}

        {continueWatching.length ? (
          <section className="section-block" id="continuar"><div className="section-heading"><div><h2>Continúa donde lo dejaste</h2><p>Tu progreso más reciente, listo para reproducir.</p></div></div><div className="course-rail">{continueWatching.map((course) => <CourseCard course={course} key={course.id} />)}</div></section>
        ) : null}

        <div id="biblioteca">
          {Array.from(new Map(courseViews.filter((course) => course.category_id).map((course) => [course.category_id!, course.category])).entries()).map(([categoryId, categoryTitle]) => {
            const categoryCourses = courseViews.filter((course) => course.category_id === categoryId);
            if (!categoryCourses.length) return null;
            return <section className="section-block" key={categoryId}><div className="section-heading"><div><h2>{categoryTitle}</h2><p>{categoryCourses.length} {categoryCourses.length === 1 ? "curso" : "cursos"}</p></div></div><div className="course-rail">{categoryCourses.map((course) => <CourseCard course={course} key={course.id} />)}</div></section>;
          })}
          {courseViews.some((course) => !course.category_id) ? <section className="section-block"><div className="section-heading"><div><h2>Más de tu biblioteca</h2></div></div><div className="course-rail">{courseViews.filter((course) => !course.category_id).map((course) => <CourseCard course={course} key={course.id} />)}</div></section> : null}
          {!courseViews.length ? <div className="status-card">Todavía no hay cursos importados.</div> : null}
        </div>
        </> : null}
      </main>
    </div>
  );
}
