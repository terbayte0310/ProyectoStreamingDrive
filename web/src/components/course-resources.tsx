"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Resource = {
  custom_title: string | null;
  detected_title: string;
  drive_items: { drive_file_id: string } | null;
  group_name: string;
  id: string;
  resource_kind: "archive" | "document" | "other" | "project" | "subtitle";
};

const kindLabel: Record<Resource["resource_kind"], string> = { archive: "Archivo", document: "Documento", other: "Recurso", project: "Proyecto", subtitle: "Subtítulo" };

export function CourseResources({ courseId }: { courseId: string }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    let active = true;
    void createSupabaseBrowserClient().from("course_resources")
      .select("id, detected_title, custom_title, group_name, resource_kind, drive_items(drive_file_id)")
      .eq("course_id", courseId)
      .eq("is_available", true)
      .eq("is_visible", true)
      .order("group_name")
      .order("detected_title")
      .returns<Resource[]>()
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError("No se pudieron cargar los recursos.");
        else setResources(data ?? []);
      });
    return () => { active = false; };
  }, [courseId]);

  async function download(resource: Resource) {
    const fileId = resource.drive_items?.drive_file_id;
    if (!fileId) return;
    setDownloading(resource.id);
    setError("");
    try {
      const response = await fetch(`/drive-download/${fileId}`, { cache: "no-store" });
      const data = (await response.json()) as { webContentLink?: string };
      if (!response.ok || !data.webContentLink) throw new Error("Drive no entregó un enlace de descarga.");
      window.location.assign(data.webContentLink);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo preparar la descarga.");
    } finally {
      setDownloading("");
    }
  }

  if (!resources.length && !error) return null;
  const groups = new Map<string, Resource[]>();
  for (const resource of resources) groups.set(resource.group_name, [...(groups.get(resource.group_name) ?? []), resource]);

  return (
    <section className="course-resources">
      <div className="sidebar-head"><h2>Recursos descargables</h2><p>Archivos complementarios del curso</p></div>
      {Array.from(groups.entries()).map(([group, groupResources]) => <div className="resource-group" key={group}><h3>{group}</h3>{groupResources.map((resource) => <div className="resource-row" key={resource.id}><div><strong>{resource.custom_title ?? resource.detected_title}</strong><span>{kindLabel[resource.resource_kind]}</span></div><button className="secondary-button" disabled={downloading === resource.id || !resource.drive_items} onClick={() => void download(resource)} type="button">{downloading === resource.id ? "Preparando…" : "↓ Descargar"}</button></div>)}</div>)}
      {error ? <p className="auth-message">{error}</p> : null}
    </section>
  );
}
