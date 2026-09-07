"use client";

import { FormEvent, ReactNode, useState } from "react";

export type AdminCourse = {
  author: string | null;
  cover_url: string | null;
  custom_title: string | null;
  description: string | null;
  detected_title: string;
  id: string;
  is_visible: boolean;
  platform: string | null;
  published_on: string | null;
};

export type AdminSection = {
  course_id: string;
  custom_title: string | null;
  detected_title: string;
  id: string;
  is_visible: boolean;
  parent_section_id: string | null;
  position: number;
};

export type AdminLesson = {
  course_id: string;
  custom_title: string | null;
  detected_title: string;
  id: string;
  is_visible: boolean;
  position: number;
  section_id: string | null;
};

type OutlineItem = (AdminSection & { kind: "section" }) | (AdminLesson & { kind: "lesson" });

export function AdminCourseManager({
  courses: initialCourses,
  lessons: initialLessons,
  sections: initialSections,
}: {
  courses: AdminCourse[];
  lessons: AdminLesson[];
  sections: AdminSection[];
}) {
  const [courses, setCourses] = useState(initialCourses);
  const [lessons, setLessons] = useState(initialLessons);
  const [sections, setSections] = useState(initialSections);
  const [selectedId, setSelectedId] = useState(initialCourses[0]?.id ?? "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const selected = courses.find((course) => course.id === selectedId);

  function siblings(parentSectionId: string | null): OutlineItem[] {
    const childSections = sections
      .filter((section) => section.course_id === selectedId && section.parent_section_id === parentSectionId)
      .map((section) => ({ ...section, kind: "section" as const }));
    const childLessons = lessons
      .filter((lesson) => lesson.course_id === selectedId && lesson.section_id === parentSectionId)
      .map((lesson) => ({ ...lesson, kind: "lesson" as const }));
    return [...childSections, ...childLessons].sort((a, b) => a.position - b.position || a.detected_title.localeCompare(b.detected_title));
  }

  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(`course:${selected.id}`);
    setMessage("");
    try {
      const response = await fetch(`/admin/courses/${selected.id}`, {
        body: JSON.stringify({
          author: form.get("author"),
          cover_url: form.get("cover_url"),
          custom_title: form.get("custom_title"),
          description: form.get("description"),
          is_visible: form.get("is_visible") === "on",
          platform: form.get("platform"),
          published_on: form.get("published_on"),
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json()) as { course?: AdminCourse; error?: string };
      if (!response.ok || !result.course) throw new Error(result.error ?? "No se pudo guardar el curso.");
      setCourses((current) => current.map((course) => course.id === selected.id ? result.course! : course));
      setMessage("Curso guardado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el curso.");
    } finally {
      setBusy("");
    }
  }

  async function saveOutlineItem(event: FormEvent<HTMLFormElement>, item: OutlineItem) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const busyKey = `${item.kind}:${item.id}`;
    setBusy(busyKey);
    setMessage("");
    try {
      const response = await fetch(`/admin/outline/${item.kind}/${item.id}`, {
        body: JSON.stringify({ custom_title: form.get("custom_title"), is_visible: form.get("is_visible") === "on" }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json()) as { item?: { custom_title: string | null; id: string; is_visible: boolean }; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error ?? "No se pudo guardar el elemento.");
      const apply = <T extends AdminSection | AdminLesson>(items: T[]) => items.map((current) => current.id === item.id ? { ...current, ...result.item } : current);
      if (item.kind === "section") setSections(apply);
      else setLessons(apply);
      setMessage("Elemento guardado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el elemento.");
    } finally {
      setBusy("");
    }
  }

  async function move(item: OutlineItem, direction: -1 | 1) {
    const group = siblings(item.kind === "section" ? item.parent_section_id : item.section_id);
    const currentIndex = group.findIndex((candidate) => candidate.kind === item.kind && candidate.id === item.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= group.length) return;
    const reordered = [...group];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    const parentSectionId = item.kind === "section" ? item.parent_section_id : item.section_id;
    setBusy(`order:${parentSectionId ?? "root"}`);
    setMessage("");
    try {
      const response = await fetch("/admin/outline/reorder", {
        body: JSON.stringify({ courseId: selectedId, items: reordered.map(({ id, kind }) => ({ id, kind })), parentSectionId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo guardar el orden.");
      const positions = new Map(reordered.map((candidate, index) => [`${candidate.kind}:${candidate.id}`, index]));
      setSections((current) => current.map((section) => positions.has(`section:${section.id}`) ? { ...section, position: positions.get(`section:${section.id}`)! } : section));
      setLessons((current) => current.map((lesson) => positions.has(`lesson:${lesson.id}`) ? { ...lesson, position: positions.get(`lesson:${lesson.id}`)! } : lesson));
      setMessage("Orden guardado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el orden.");
    } finally {
      setBusy("");
    }
  }

  function renderGroup(parentSectionId: string | null, depth = 0): ReactNode {
    const group = siblings(parentSectionId);
    return group.map((item, index) => (
      <div className={depth ? "ml-5 border-l border-slate-700 pl-3" : ""} key={`${item.kind}:${item.id}`}>
        <div className="my-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <span className="w-16 text-xs font-semibold uppercase text-slate-400">{item.kind === "section" ? "Sección" : "Lección"}</span>
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={(event) => void saveOutlineItem(event, item)}>
            <input aria-label={`Título de ${item.detected_title}`} className="min-w-48 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm" defaultValue={item.custom_title ?? ""} name="custom_title" placeholder={item.detected_title} />
            <label className="flex items-center gap-1 text-xs"><input defaultChecked={item.is_visible} name="is_visible" type="checkbox" />Visible</label>
            <button className="rounded-lg border border-slate-600 px-3 py-2 text-xs disabled:opacity-50" disabled={Boolean(busy)} type="submit">Guardar</button>
          </form>
          <button aria-label="Subir" className="rounded-lg border border-slate-700 px-2 py-1 disabled:opacity-30" disabled={Boolean(busy) || index === 0} onClick={() => void move(item, -1)} type="button">↑</button>
          <button aria-label="Bajar" className="rounded-lg border border-slate-700 px-2 py-1 disabled:opacity-30" disabled={Boolean(busy) || index === group.length - 1} onClick={() => void move(item, 1)} type="button">↓</button>
        </div>
        {item.kind === "section" ? renderGroup(item.id, depth + 1) : null}
      </div>
    ));
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
        <h2 className="px-2 pb-2 font-semibold">Cursos</h2>
        <div className="flex max-h-[65vh] flex-col gap-1 overflow-y-auto">
          {courses.map((course) => (
            <button className={`rounded-xl px-3 py-3 text-left text-sm ${course.id === selectedId ? "bg-sky-400/15 text-sky-100" : "text-slate-300 hover:bg-slate-800"}`} key={course.id} onClick={() => { setSelectedId(course.id); setMessage(""); }} type="button">
              {course.custom_title ?? course.detected_title}
              {!course.is_visible ? <span className="ml-2 text-xs text-amber-300">Oculto</span> : null}
            </button>
          ))}
        </div>
      </aside>

      {selected ? (
        <div className="flex min-w-0 flex-col gap-6">
          <form className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6" key={selected.id} onSubmit={saveCourse}>
            <h2 className="text-xl font-semibold">Datos del curso</h2>
            <p className="mt-1 text-sm text-slate-400">Detectado en Drive: {selected.detected_title}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">Título<input className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" defaultValue={selected.custom_title ?? ""} name="custom_title" /></label>
              <label className="flex flex-col gap-1 text-sm">Autor<input className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" defaultValue={selected.author ?? ""} name="author" /></label>
              <label className="flex flex-col gap-1 text-sm">Plataforma<input className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" defaultValue={selected.platform ?? ""} name="platform" /></label>
              <label className="flex flex-col gap-1 text-sm">Fecha<input className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" defaultValue={selected.published_on ?? ""} name="published_on" placeholder="AAAA-MM-DD" /></label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">Portada (URL)<input className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" defaultValue={selected.cover_url ?? ""} name="cover_url" type="url" /></label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">Descripción<textarea className="min-h-28 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" defaultValue={selected.description ?? ""} name="description" /></label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input defaultChecked={selected.is_visible} name="is_visible" type="checkbox" />Visible en el catálogo</label>
            </div>
            <button className="mt-6 rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 disabled:opacity-60" disabled={Boolean(busy)} type="submit">{busy === `course:${selected.id}` ? "Guardando…" : "Guardar curso"}</button>
          </form>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-xl font-semibold">Secciones y lecciones</h2>
            <p className="mt-1 text-sm text-slate-400">Edita los nombres visibles y usa las flechas para ordenar elementos dentro de su sección.</p>
            <div className="mt-4">{renderGroup(null)}</div>
          </section>
          {message ? <p className={message.includes("guardado") ? "text-emerald-300" : "text-rose-200"}>{message}</p> : null}
        </div>
      ) : <p className="text-slate-300">Todavía no hay cursos importados.</p>}
    </div>
  );
}
