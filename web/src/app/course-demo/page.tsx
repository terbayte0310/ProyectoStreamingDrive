import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type Course = { custom_title: string | null; detected_title: string; id: string };
type Lesson = { custom_title: string | null; detected_title: string; drive_item_id: string | null; id: string; position: number; section_id: string | null };
type Section = { custom_title: string | null; detected_title: string; id: string; parent_section_id: string | null; position: number };
type DriveItem = { drive_file_id: string; id: string };

export const dynamic = "force-dynamic";

export default async function CourseDemoPage({ searchParams }: { searchParams: Promise<{ lesson?: string }> }) {
  const { lesson: requestedLessonId } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/signin");

  const { data: course } = await supabase
    .from("courses")
    .select("id, detected_title, custom_title")
    .order("created_at")
    .limit(1)
    .maybeSingle<Course>();
  if (!course) redirect("/catalog");

  const [sectionsResult, lessonsResult] = await Promise.all([
    supabase.from("course_sections").select("id, detected_title, custom_title, parent_section_id, position").eq("course_id", course.id).order("position"),
    supabase.from("lessons").select("id, detected_title, custom_title, section_id, drive_item_id, position").eq("course_id", course.id).order("position"),
  ]);
  const sections = (sectionsResult.data ?? []) as Section[];
  const lessons = (lessonsResult.data ?? []) as Lesson[];
  const itemIds = lessons.flatMap((lesson) => (lesson.drive_item_id ? [lesson.drive_item_id] : []));
  const { data: itemRows } = itemIds.length
    ? await supabase.from("drive_items").select("id, drive_file_id").in("id", itemIds)
    : { data: [] as DriveItem[] };
  const fileIdByItemId = new Map(((itemRows ?? []) as DriveItem[]).map((item) => [item.id, item.drive_file_id]));
  const selected = lessons.find((lesson) => lesson.id === requestedLessonId) ?? lessons[0];
  const selectedFileId = selected?.drive_item_id ? fileIdByItemId.get(selected.drive_item_id) : undefined;

  const sortByPosition = <T extends { position: number }>(items: T[]) => [...items].sort((a, b) => a.position - b.position);
  const titleOf = (item: { custom_title: string | null; detected_title: string }) => item.custom_title ?? item.detected_title;
  const lessonsIn = (sectionId: string | null) => sortByPosition(lessons.filter((lesson) => lesson.section_id === sectionId));
  const sectionsIn = (sectionId: string | null) => sortByPosition(sections.filter((section) => section.parent_section_id === sectionId));

  const lessonLink = (lesson: Lesson) => (
    <a
      className={`block rounded-xl px-3 py-2 text-sm ${lesson.id === selected?.id ? "bg-sky-400/15 text-sky-100" : "text-slate-300 hover:bg-slate-800"}`}
      href={`/course-demo?lesson=${lesson.id}`}
      key={lesson.id}
    >
      {titleOf(lesson)}
    </a>
  );

  const sectionTree = (parentSectionId: string | null, level = 0): React.ReactNode[] =>
    sectionsIn(parentSectionId).flatMap((section) => [
      <div className="mt-3" key={`section-${section.id}`} style={{ marginLeft: `${level * 8}px` }}>
        <p className="px-2 text-xs font-semibold tracking-wide text-sky-300 uppercase">{titleOf(section)}</p>
        <div className="mt-1 flex flex-col gap-1">{lessonsIn(section.id).map(lessonLink)}</div>
      </div>,
      ...sectionTree(section.id, level + 1),
    ]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <section className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Prueba de reproducción</p>
          <h1 className="mt-2 text-3xl font-semibold">{titleOf(course)}</h1>
          {selected && selectedFileId ? (
            <>
              <h2 className="mt-6 text-xl font-medium">{titleOf(selected)}</h2>
              <div className="mt-4 aspect-video overflow-hidden rounded-2xl border border-slate-700 bg-black">
                <iframe allow="autoplay" className="h-full w-full" src={`https://drive.google.com/file/d/${selectedFileId}/preview`} title={titleOf(selected)} />
              </div>
              <p className="mt-3 text-sm text-slate-400">Drive verifica la cuenta de Google del navegador. La aplicación no entrega el contenido del video.</p>
            </>
          ) : <p className="mt-8 text-slate-300">No hay una lección reproducible disponible.</p>}
        </div>
        <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="font-semibold">Lecciones</h2>
          <div className="mt-4 max-h-[70vh] overflow-y-auto">
            {lessonsIn(null).length > 0 ? <div className="flex flex-col gap-1">{lessonsIn(null).map(lessonLink)}</div> : null}
            {sectionTree(null)}
          </div>
        </aside>
      </section>
      <a className="mx-auto mt-8 block w-full max-w-7xl text-sky-300 underline" href="/catalog">Volver al catálogo</a>
    </main>
  );
}
