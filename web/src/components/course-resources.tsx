"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Resource = {
  custom_title: string | null;
  detected_title: string;
  drive_items: { drive_file_id: string } | null;
  group_name: string;
  id: string;
  resource_kind: "archive" | "document" | "other" | "project" | "subtitle";
};

const kindLabel: Record<Resource["resource_kind"], string> = { archive: "Archivo comprimido", document: "Documento", other: "Recurso", project: "Proyecto", subtitle: "Subtítulo" };

export function CourseResources({ courseId }: { courseId: string }) {
  const [resources, setResources] = useState<Resource[] | null>(null);
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
      .then(({ data, error }) => {
        if (!active) return;
        if (error) toast("No se pudieron cargar los recursos.", "error");
        setResources(data ?? []);
      });
    return () => { active = false; };
  }, [courseId]);

  async function download(resource: Resource) {
    const fileId = resource.drive_items?.drive_file_id;
    if (!fileId) return;
    setDownloading(resource.id);
    try {
      const response = await fetch(`/drive-download/${fileId}`, { cache: "no-store" });
      const data = (await response.json()) as { webContentLink?: string };
      if (!response.ok || !data.webContentLink) throw new Error("Drive no entregó un enlace de descarga.");
      window.location.assign(data.webContentLink);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "No se pudo preparar la descarga.", "error");
    } finally {
      setDownloading("");
    }
  }

  if (resources === null) return <div style={{ display: "grid", gap: 8 }}>{[0, 1, 2].map((key) => <div className="skeleton" key={key} style={{ height: 52 }} />)}</div>;
  if (!resources.length) return <p className="muted" style={{ margin: 0 }}>Este curso no incluye archivos complementarios.</p>;

  const groups = new Map<string, Resource[]>();
  for (const resource of resources) groups.set(resource.group_name, [...(groups.get(resource.group_name) ?? []), resource]);

  return (
    <div>
      {Array.from(groups.entries()).map(([group, items]) => (
        <div className="resource-group" key={group}>
          <h3>{group}</h3>
          {items.map((resource) => (
            <div className="resource-row" key={resource.id}>
              <div><strong>{resource.custom_title ?? resource.detected_title}</strong><span>{kindLabel[resource.resource_kind]}</span></div>
              <button className="btn btn-ghost btn-sm" disabled={downloading === resource.id || !resource.drive_items} onClick={() => void download(resource)} type="button">
                <Icon name="download" />{downloading === resource.id ? "Preparando…" : "Descargar"}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
