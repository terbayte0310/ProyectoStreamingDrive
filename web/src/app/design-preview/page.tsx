import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CatalogCollection } from "@/components/catalog-collection";
import { CourseCard, type CourseView } from "@/components/course-card";
import { CourseCover } from "@/components/course-cover";
import { PreviewPlayer } from "@/components/design-preview";
import { Icon } from "@/components/icons";
import { PosterCard } from "@/components/media-catalog";
import { Rail } from "@/components/rail";
import { SeasonBrowser, type SeasonView } from "@/components/season-browser";
import { Spotlight } from "@/components/spotlight";

// Vitrina del sistema de diseño con datos ficticios. Solo en desarrollo:
// permite revisar tema, animaciones y reproductor sin sesión ni Supabase.
const sample: Array<[string, string, number]> = [
  ["El arte de observar", "Creatividad", 64], ["Diseñar lo esencial", "Diseño", 12], ["Un mundo en movimiento", "Animación", 0],
  ["Arquitectura de las ideas", "Diseño", 100], ["Fotografía nocturna", "Fotografía", 38], ["Tipografía viva", "Diseño", 0],
  ["Programar con calma", "Programación", 81], ["Sonido para cine", "Música", 0],
];

const courses: CourseView[] = sample.map(([title, category, percent], index) => ({
  category, category_id: null, completed: Math.round(percent / 10), cover_url: null, custom_title: title, description: null,
  destinationId: `demo-${index}`, detected_title: title, id: `course-${index}`, lessonCount: 10 + index, percent, platform: index % 2 ? "Domestika" : null,
  resumable: percent > 0 && percent < 100, resumableUpdatedAt: null, sectionCount: 3 + (index % 4),
}));

const seasons: SeasonView[] = [1, 2].map((number) => ({
  episodes: Array.from({ length: 5 }, (_, index) => ({ id: `s${number}e${index}`, number: index + 1, overview: "Una historia que se queda contigo, contada en capítulos que no quieres dejar.", packageId: index === 4 ? null : `pkg-${number}-${index}`, runtime: 42 + index, stillPath: null, title: `Capítulo ${index + 1}` })),
  id: `season-${number}`, number, overview: null, title: `Temporada ${number}`,
}));

export default function DesignPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className="shell">
      <AppHeader admin email="demo@nebula.app" modules={["courses", "movies", "series"]} />
      <main className="shell-main container">
        <Spotlight
          slides={courses.slice(0, 3).map((course, index) => ({
            actions: <><a className="btn btn-primary btn-lg" href="#reproductor"><Icon name="play" />Continuar</a><a className="btn btn-glass btn-lg" href="#biblioteca">Explorar</a></>,
            badges: [course.category, `${course.lessonCount} lecciones`],
            description: "Las mejores ideas empiezan mirando de otra manera. Haz espacio para la curiosidad y descubre tu próxima gran idea.",
            id: course.id,
            kicker: index ? "Recomendado" : "Continúa aprendiendo",
            media: <CourseCover category={course.category} priority={index === 0} showLabel={false} title={course.custom_title ?? ""} />,
            progress: course.percent,
            progressLabel: `${course.completed}/${course.lessonCount} lecciones`,
            title: course.custom_title ?? "",
          }))}
        />
        <Rail description="Tu progreso más reciente." kicker="Tu progreso" title="Continúa donde lo dejaste">
          {courses.filter((course) => course.resumable).map((course) => <CourseCard course={course} key={course.id} />)}
        </Rail>
        <section className="section" id="reproductor">
          <div className="section-head"><div><p className="kicker">Sala privada</p><h2 className="title-l">Reproductor Nébula</h2><p>Coloca un MP4 en <span className="mono">public/dev-preview.mp4</span> para probarlo. Pulsa <kbd>?</kbd> para ver los atajos.</p></div></div>
          <PreviewPlayer />
        </section>
        <CatalogCollection entries={courses.map((course) => ({ category: course.category, content: <CourseCard course={course} />, id: course.id, title: course.custom_title ?? "" }))} heading="Todos los cursos" kicker="8 cursos" kind="courses" />
        <section className="section">
          <div className="section-head"><div><p className="kicker">Películas</p><h2 className="title-l">Pósters</h2></div></div>
          <div className="poster-grid">
            {["Noche de estreno", "La ciudad dormida", "Marea alta", "Últimos días", "Cometa", "El faro"].map((title, index) => <PosterCard href="/design-preview" id={`poster-${index}`} index={index} key={title} title={title} />)}
          </div>
        </section>
        <SeasonBrowser seasons={seasons} />
      </main>
    </div>
  );
}
