"use client";

import { type DragEvent, type FormEvent, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { SegmentedThumb } from "@/components/catalog-collection";
import { CourseCover } from "@/components/course-cover";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";
import { Switch } from "@/components/ui/switch";

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
export type AdminSection = { course_id: string; custom_title: string | null; detected_title: string; id: string; is_visible: boolean; parent_section_id: string | null; position: number };
export type AdminLesson = { course_id: string; custom_title: string | null; detected_title: string; id: string; is_visible: boolean; position: number; section_id: string | null };

type OutlineItem = (AdminSection & { kind: "section" }) | (AdminLesson & { kind: "lesson" });
type CourseForm = { author: string; cover_url: string; custom_title: string; description: string; is_visible: boolean; platform: string; published_on: string };

const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
const toForm = (course: AdminCourse): CourseForm => ({ author: course.author ?? "", cover_url: course.cover_url ?? "", custom_title: course.custom_title ?? "", description: course.description ?? "", is_visible: course.is_visible, platform: course.platform ?? "", published_on: course.published_on ?? "" });

export function AdminCourseManager({ courses: initialCourses }: { courses: AdminCourse[] }) {
  const [courses, setCourses] = useState(initialCourses);
  const [selectedId, setSelectedId] = useState(initialCourses[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "hidden" | "visible">("all");
  const deferredQuery = useDeferredValue(query);
  const selected = courses.find((course) => course.id === selectedId);

  const visible = useMemo(() => {
    const needle = normalized(deferredQuery.trim());
    return courses.filter((course) => {
      if (filter === "visible" && !course.is_visible) return false;
      if (filter === "hidden" && course.is_visible) return false;
      return !needle || normalized(`${course.custom_title ?? ""} ${course.detected_title} ${course.platform ?? ""}`).includes(needle);
    });
  }, [courses, deferredQuery, filter]);

  return (
    <div className="workspace">
      <aside aria-label="Cursos" className="panel master">
        <div className="master-tools">
          <label className="search-box">
            <Icon name="search" />
            <span className="sr-only">Buscar curso</span>
            <input className="input" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar curso" type="search" value={query} />
          </label>
          <div aria-label="Filtrar cursos" className="segmented" role="group" style={{ width: "100%" }}>
            <SegmentedThumb count={3} index={filter === "all" ? 0 : filter === "visible" ? 1 : 2} />
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")} type="button">Todos</button>
            <button aria-pressed={filter === "visible"} onClick={() => setFilter("visible")} type="button">Visibles</button>
            <button aria-pressed={filter === "hidden"} onClick={() => setFilter("hidden")} type="button">Ocultos</button>
          </div>
        </div>
        <div className="master-list">
          {visible.map((course) => (
            <button aria-current={course.id === selectedId} className="master-item" key={course.id} onClick={() => setSelectedId(course.id)} type="button">
              <span>{course.custom_title ?? course.detected_title}</span>
              <span className="status-dot" data-status={course.is_visible ? "visible" : "hidden"} title={course.is_visible ? "Visible" : "Oculto"} />
            </button>
          ))}
          {!visible.length ? <p className="muted" style={{ padding: "0.8rem", margin: 0 }}>Ningún curso coincide.</p> : null}
        </div>
        <div className="master-foot result-count">{visible.length} de {courses.length} cursos</div>
      </aside>

      {selected ? (
        <div style={{ minWidth: 0 }}>
          <CourseEditor course={selected} key={selected.id} onSaved={(course) => setCourses((current) => current.map((item) => (item.id === course.id ? course : item)))} />
          <OutlineEditor courseId={selected.id} key={`outline-${selected.id}`} />
        </div>
      ) : (
        <div className="empty-state"><span aria-hidden="true" className="empty-orb" /><h2 className="title-m">Todavía no hay cursos importados</h2><p>Ejecuta una sincronización de Drive para detectar tu biblioteca.</p></div>
      )}
    </div>
  );
}

function CourseEditor({ course, onSaved }: { course: AdminCourse; onSaved: (course: AdminCourse) => void }) {
  const [original, setOriginal] = useState(() => toForm(course));
  const [form, setForm] = useState(() => toForm(course));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const set = <K extends keyof CourseForm>(key: K, value: CourseForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!dirty) return;
    if (form.published_on && !/^\d{4}-\d{2}-\d{2}$/.test(form.published_on)) { toast("La fecha debe tener el formato AAAA-MM-DD.", "warn"); return; }
    setSaving(true);
    try {
      const response = await fetch(`/admin/courses/${course.id}`, { body: JSON.stringify(form), headers: { "Content-Type": "application/json" }, method: "PATCH" });
      const result = (await response.json()) as { course?: AdminCourse; error?: string };
      if (!response.ok || !result.course) throw new Error(result.error ?? "No se pudo guardar el curso.");
      onSaved(result.course);
      const next = toForm(result.course);
      setOriginal(next);
      setForm(next);
      toast("Curso guardado.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo guardar el curso.", "error");
    } finally {
      setSaving(false);
    }
  }

  // Ctrl/Cmd + S guarda sin buscar el botón.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <form className="panel panel-pad" onSubmit={save}>
      <div className="detail-head">
        <CourseCover category={form.platform || "Curso"} coverUrl={form.cover_url || null} title={form.custom_title || course.detected_title} />
        <div style={{ display: "grid", gap: "0.4rem", minWidth: 0 }}>
          <p className="kicker">Datos del curso</p>
          <h2 className="title-m">{form.custom_title || course.detected_title}</h2>
          <span className="subtle" style={{ fontSize: "0.8rem" }}>Detectado en Drive: <span className="mono">{course.detected_title}</span></span>
        </div>
      </div>
      <div className="form-grid">
        <label className="field"><span className="field-label">Título visible</span><input className="input" onChange={(event) => set("custom_title", event.target.value)} placeholder={course.detected_title} value={form.custom_title} /></label>
        <label className="field"><span className="field-label">Autor</span><input className="input" onChange={(event) => set("author", event.target.value)} value={form.author} /></label>
        <label className="field"><span className="field-label">Plataforma</span><input className="input" onChange={(event) => set("platform", event.target.value)} placeholder="Udemy, Domestika…" value={form.platform} /></label>
        <label className="field"><span className="field-label">Fecha de publicación</span><input className="input" onChange={(event) => set("published_on", event.target.value)} type="date" value={form.published_on} /></label>
        <label className="field span-2"><span className="field-label">Portada (URL de imagen)</span><input className="input" onChange={(event) => set("cover_url", event.target.value)} placeholder="https://…" type="url" value={form.cover_url} /><span className="field-hint">La vista previa de arriba se actualiza mientras escribes.</span></label>
        <label className="field span-2"><span className="field-label">Descripción</span><textarea className="textarea" onChange={(event) => set("description", event.target.value)} value={form.description} /></label>
        <div className="span-2"><Switch checked={form.is_visible} onChange={(event) => set("is_visible", event.target.checked)}>Visible en el catálogo</Switch></div>
      </div>
      {dirty ? (
        <div className="save-bar" role="status">
          <span>Cambios sin guardar</span>
          <div>
            <button className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setForm(original)} type="button">Descartar</button>
            <button className="btn btn-primary btn-sm" disabled={saving} type="submit"><Icon name="check" />{saving ? "Guardando…" : "Guardar"} <kbd style={{ marginLeft: 4 }}>Ctrl S</kbd></button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function OutlineEditor({ courseId }: { courseId: string }) {
  const [lessons, setLessons] = useState<AdminLesson[]>([]);
  const [sections, setSections] = useState<AdminSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [dragging, setDragging] = useState<{ id: string; kind: OutlineItem["kind"]; parent: string | null } | null>(null);
  const [drop, setDrop] = useState<{ key: string; place: "after" | "before" } | null>(null);
  const reorderBusy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/admin/courses/${courseId}/outline`, { cache: "no-store" });
        const result = (await response.json()) as { error?: string; lessons?: AdminLesson[]; sections?: AdminSection[] };
        if (!response.ok || !result.lessons || !result.sections) throw new Error(result.error ?? "No se pudo cargar el contenido del curso.");
        if (!cancelled) { setLessons(result.lessons); setSections(result.sections); }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "No se pudo cargar el contenido del curso.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [courseId]);

  function siblings(parentSectionId: string | null): OutlineItem[] {
    const childSections = sections.filter((section) => section.parent_section_id === parentSectionId).map((section) => ({ ...section, kind: "section" as const }));
    const childLessons = lessons.filter((lesson) => lesson.section_id === parentSectionId).map((lesson) => ({ ...lesson, kind: "lesson" as const }));
    return [...childSections, ...childLessons].sort((a, b) => a.position - b.position || a.detected_title.localeCompare(b.detected_title));
  }

  async function saveItem(item: OutlineItem, patch: { custom_title?: string; is_visible?: boolean }) {
    const next = { custom_title: patch.custom_title ?? item.custom_title ?? "", is_visible: patch.is_visible ?? item.is_visible };
    if (next.custom_title === (item.custom_title ?? "") && next.is_visible === item.is_visible) return;
    const key = `${item.kind}:${item.id}`;
    setSavingKey(key);
    // Optimista: la interfaz cambia al instante y se revierte si el servidor falla.
    const apply = (value: { custom_title: string | null; is_visible: boolean }) => {
      const update = <T extends AdminSection | AdminLesson>(items: T[]) => items.map((current) => (current.id === item.id ? { ...current, ...value } : current));
      if (item.kind === "section") setSections(update); else setLessons(update);
    };
    apply({ custom_title: next.custom_title.trim() || null, is_visible: next.is_visible });
    try {
      const response = await fetch(`/admin/outline/${item.kind}/${item.id}`, { body: JSON.stringify(next), headers: { "Content-Type": "application/json" }, method: "PATCH" });
      const result = (await response.json()) as { error?: string; item?: { custom_title: string | null; is_visible: boolean } };
      if (!response.ok || !result.item) throw new Error(result.error ?? "No se pudo guardar el elemento.");
      apply(result.item);
      toast(patch.is_visible === undefined ? "Título guardado." : next.is_visible ? "Ahora es visible." : "Ocultado del catálogo.", "success", 2200);
    } catch (error) {
      apply({ custom_title: item.custom_title, is_visible: item.is_visible });
      toast(error instanceof Error ? error.message : "No se pudo guardar el elemento.", "error");
    } finally {
      setSavingKey("");
    }
  }

  async function persistOrder(parentSectionId: string | null, reordered: OutlineItem[]) {
    if (reorderBusy.current) return;
    reorderBusy.current = true;
    const previousSections = sections;
    const previousLessons = lessons;
    const positions = new Map(reordered.map((candidate, index) => [`${candidate.kind}:${candidate.id}`, index]));
    setSections((current) => current.map((section) => (positions.has(`section:${section.id}`) ? { ...section, position: positions.get(`section:${section.id}`)! } : section)));
    setLessons((current) => current.map((lesson) => (positions.has(`lesson:${lesson.id}`) ? { ...lesson, position: positions.get(`lesson:${lesson.id}`)! } : lesson)));
    try {
      const response = await fetch("/admin/outline/reorder", { body: JSON.stringify({ courseId, items: reordered.map(({ id, kind }) => ({ id, kind })), parentSectionId }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo guardar el orden.");
      toast("Orden guardado.", "success", 2000);
    } catch (error) {
      setSections(previousSections);
      setLessons(previousLessons);
      toast(error instanceof Error ? error.message : "No se pudo guardar el orden.", "error");
    } finally {
      reorderBusy.current = false;
    }
  }

  function move(item: OutlineItem, direction: -1 | 1) {
    const parent = item.kind === "section" ? item.parent_section_id : item.section_id;
    const group = siblings(parent);
    const from = group.findIndex((candidate) => candidate.kind === item.kind && candidate.id === item.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= group.length) return;
    const reordered = [...group];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    void persistOrder(parent, reordered);
  }

  function onDrop(event: DragEvent, target: OutlineItem, parent: string | null) {
    event.preventDefault();
    const place = drop?.place ?? "before";
    setDrop(null);
    if (!dragging || dragging.parent !== parent) return;
    const group = siblings(parent);
    const moving = group.find((candidate) => candidate.kind === dragging.kind && candidate.id === dragging.id);
    if (!moving || (moving.id === target.id && moving.kind === target.kind)) return;
    const rest = group.filter((candidate) => candidate !== moving);
    const targetIndex = rest.findIndex((candidate) => candidate.kind === target.kind && candidate.id === target.id);
    rest.splice(place === "after" ? targetIndex + 1 : targetIndex, 0, moving);
    void persistOrder(parent, rest);
  }

  function renderGroup(parent: string | null): ReactNode {
    const group = siblings(parent);
    return group.map((item, index) => {
      const key = `${item.kind}:${item.id}`;
      return (
        <div key={key} style={{ display: "grid", gap: 6 }}>
          <div
            className="outline-row"
            data-drop={drop?.key === key ? drop.place : undefined}
            data-dragging={dragging?.id === item.id ? "" : undefined}
            data-hidden={item.is_visible ? undefined : ""}
            data-kind={item.kind}
            data-saving={savingKey === key ? "" : undefined}
            onDragOver={(event) => {
              if (!dragging || dragging.parent !== parent) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setDrop({ key, place: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
            }}
            onDrop={(event) => onDrop(event, item, parent)}
          >
            <button
              aria-label="Arrastrar para reordenar"
              className="drag-handle"
              draggable
              onDragEnd={() => { setDragging(null); setDrop(null); }}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", key); setDragging({ id: item.id, kind: item.kind, parent }); }}
              title="Arrastra dentro de su mismo nivel"
              type="button"
            ><Icon name="drag" strokeWidth={3} /></button>
            <span className="outline-kind" title={item.kind === "section" ? "Sección" : "Lección"}><Icon name={item.kind === "section" ? "layers" : "play"} /></span>
            <input
              aria-label={`Título de ${item.detected_title}`}
              className="outline-title"
              defaultValue={item.custom_title ?? ""}
              key={`${key}:${item.custom_title ?? ""}`}
              onBlur={(event) => void saveItem(item, { custom_title: event.target.value })}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = item.custom_title ?? ""; event.currentTarget.blur(); } }}
              placeholder={item.detected_title}
            />
            <div className="order-buttons">
              <button aria-label="Subir" className="icon-mini" disabled={index === 0} onClick={() => move(item, -1)} type="button"><Icon name="chevronDown" style={{ transform: "rotate(180deg)" }} /></button>
              <button aria-label="Bajar" className="icon-mini" disabled={index === group.length - 1} onClick={() => move(item, 1)} type="button"><Icon name="chevronDown" /></button>
            </div>
            <Switch aria-label={item.is_visible ? "Ocultar" : "Mostrar"} checked={item.is_visible} onChange={(event) => void saveItem(item, { is_visible: event.target.checked })} small />
          </div>
          {item.kind === "section" && siblings(item.id).length ? <div className="outline-children">{renderGroup(item.id)}</div> : null}
        </div>
      );
    });
  }

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <div>
          <p className="kicker">Estructura</p>
          <h2 className="title-m">Secciones y lecciones</h2>
          <p>Edita el título en línea (se guarda al salir del campo), arrastra para ordenar y usa el interruptor para mostrar u ocultar.</p>
        </div>
        <span className="result-count">{sections.length} secciones · {lessons.length} lecciones</span>
      </div>
      {loading ? <div style={{ display: "grid", gap: 6 }}>{Array.from({ length: 6 }, (_, index) => <div className="skeleton" key={index} style={{ height: 46, marginLeft: index % 3 ? 36 : 0 }} />)}</div> : null}
      {loadError ? <div className="notice notice-error"><span className="notice-icon"><Icon name="warning" /></span><div>{loadError}</div></div> : null}
      {!loading && !loadError ? <div className="outline">{renderGroup(null)}</div> : null}
    </section>
  );
}
