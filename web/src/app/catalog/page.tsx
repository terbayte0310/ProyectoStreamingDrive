import { redirect } from "next/navigation";

import { CatalogCollection } from "@/components/catalog-collection";
import { CourseCard, courseAction, courseTitle, type CourseView } from "@/components/course-card";
import { CourseCover } from "@/components/course-cover";
import { Icon } from "@/components/icons";
import { IntentLink } from "@/components/intent-link";
import { Rail } from "@/components/rail";
import { SiteHeader } from "@/components/site-header";
import { Spotlight, type SpotlightSlide } from "@/components/spotlight";
import { getViewer, type LibraryModule } from "@/lib/auth/access";
import { readMonotonicTime } from "@/lib/server-timing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

const moduleNames: Record<LibraryModule, string> = { courses: "Cursos", movies: "Películas", series: "Series" };
const modulePaths: Record<LibraryModule, string> = { courses: "/catalog/cursos", movies: "/catalog/movies", series: "/catalog/series" };

function toCourseView(course: CatalogHomeRow): CourseView {
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
    percent: lessonCount ? Math.min(100, Math.round((completed / lessonCount) * 100)) : 0,
    platform: course.course_platform,
    resumable: Boolean(course.resumable_lesson_id),
    resumableUpdatedAt: course.resumable_updated_at,
    sectionCount: Number(course.section_count),
  };
}

export const dynamic = "force-dynamic";

export default async function CatalogPage({ forceCourses = false, searchParams }: { forceCourses?: boolean; searchParams: Promise<{ access?: string }> }) {
  const startedAt = readMonotonicTime();
  const { access: accessNotice } = await searchParams;
  const supabase = await createSupabaseServerClient();
  // El viewer (auth.getClaims + perfil + módulos) y el catálogo viajan en paralelo;
  // la cabecera reutiliza el mismo viewer memorizado sin repetir consultas.
  const [viewer, catalogResult] = await Promise.all([
    getViewer(),
    forceCourses ? supabase.rpc("get_catalog_home") : Promise.resolve(null),
  ]);
  console.info(`[startup-performance] catalog total_ms=${(readMonotonicTime() - startedAt).toFixed(1)}`);
  if (!viewer) redirect("/signin");
  if (!viewer.profile?.is_authorized) redirect("/dashboard");

  const { modules } = viewer;
  const hasCourses = modules.includes("courses");
  if (!forceCourses) {
    const suffix = accessNotice ? `?access=${encodeURIComponent(accessNotice)}` : "";
    if (hasCourses) redirect(`/catalog/cursos${suffix}`);
    if (modules[0]) redirect(`${modulePaths[modules[0]]}${suffix}`);
  }

  const deniedNotices: Record<string, LibraryModule> = { "course-denied": "courses", "courses-denied": "courses", "movies-denied": "movies", "series-denied": "series" };
  const deniedModule = accessNotice ? deniedNotices[accessNotice] ?? null : null;
  const courseViews = (hasCourses && catalogResult && !catalogResult.error ? (catalogResult.data ?? []) as CatalogHomeRow[] : []).map(toCourseView);
  const continueWatching = courseViews.filter((course) => course.resumable).sort((a, b) => (b.resumableUpdatedAt ?? "").localeCompare(a.resumableUpdatedAt ?? ""));
  const featured = [...continueWatching, ...courseViews.filter((course) => !course.resumable && course.destinationId)].slice(0, 5);

  const slides: SpotlightSlide[] = featured.map((course, index) => ({
    actions: (
      <>
        {course.destinationId ? <IntentLink className="btn btn-primary btn-lg" href={`/course-player?lesson=${course.destinationId}`} transitionTypes={["nav-forward"]}><Icon name="play" />{courseAction(course)}</IntentLink> : null}
        <a className="btn btn-glass btn-lg" href="#biblioteca">Explorar cursos</a>
      </>
    ),
    badges: [course.category, `${course.lessonCount} lecciones`, ...(course.platform ? [course.platform] : [])],
    description: course.description ?? `Tu avance en ${course.category} se guarda solo mientras reproduces cada lección.`,
    id: course.id,
    kicker: course.resumable ? "Continúa aprendiendo" : "Recomendado de tu biblioteca",
    media: <CourseCover category={course.category} coverUrl={course.cover_url} priority={index === 0} showLabel={false} title={courseTitle(course)} />,
    progress: course.percent,
    progressLabel: `${course.completed}/${course.lessonCount} lecciones`,
    title: courseTitle(course),
  }));

  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell-main container">
        {deniedModule ? (
          <div className="notice notice-warn" style={{ marginTop: 16 }}>
            <span className="notice-icon"><Icon name="lock" /></span>
            <div><strong>No tienes acceso a {moduleNames[deniedModule]}.</strong> Solo verás los módulos asignados a tu cuenta.</div>
          </div>
        ) : null}

        {!modules.length ? (
          <section className="empty-state" style={{ marginTop: 32 }}>
            <span aria-hidden="true" className="empty-orb" />
            <h1 className="title-l">Aún no tienes módulos asignados</h1>
            <p>Pide a un administrador acceso a Cursos, Películas o Series. En cuanto lo haga, aparecerán aquí.</p>
          </section>
        ) : null}

        {viewer.modulesError ? (
          <div className="notice notice-error" style={{ marginTop: 16 }}>
            <span className="notice-icon"><Icon name="warning" /></span>
            <div>No se pudieron comprobar los módulos asignados. Recarga la página en unos segundos.</div>
          </div>
        ) : null}

        {hasCourses ? (
          <>
            {catalogResult?.error ? (
              <div className="notice notice-error" style={{ marginTop: 16 }}>
                <span className="notice-icon"><Icon name="warning" /></span>
                <div>No se pudo cargar el catálogo de cursos todavía. Inténtalo de nuevo en un momento.</div>
              </div>
            ) : null}
            <Spotlight label="Cursos destacados" slides={slides} />
            {continueWatching.length ? (
              <Rail description="Tu progreso más reciente, listo para reproducir." kicker="Tu progreso" title="Continúa donde lo dejaste">
                {continueWatching.map((course) => <CourseCard course={course} key={course.id} />)}
              </Rail>
            ) : null}
            <CatalogCollection
              entries={courseViews.map((course) => ({ category: course.category, content: <CourseCard course={course} />, id: course.id, title: courseTitle(course) }))}
              heading="Todos los cursos"
              kicker={`${courseViews.length} cursos`}
              kind="courses"
            />
          </>
        ) : null}
      </main>
    </div>
  );
}
