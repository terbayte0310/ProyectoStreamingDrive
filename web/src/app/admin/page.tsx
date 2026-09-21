import type { Metadata } from "next";
import Link from "next/link";

import { AdminCourseManager, type AdminCourse } from "@/components/admin-course-manager";
import { CatalogSyncPanel } from "@/components/catalog-sync-panel";
import { CodecInventoryPanel } from "@/components/codec-inventory-panel";
import { Icon } from "@/components/icons";
import { SiteHeader } from "@/components/site-header";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { requireAdminAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administrar cursos" };

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const [, coursesResult] = await Promise.all([
    requireAdminAccess(),
    supabase.from("courses").select("id, detected_title, custom_title, author, platform, published_on, description, cover_url, is_visible").eq("is_detected_course", true).order("position").order("id"),
  ]);
  const courses = (coursesResult.data ?? []) as AdminCourse[];
  const visibleCourses = courses.filter((course) => course.is_visible).length;

  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell-main container">
        <section className="admin-hero rise">
          <div>
            <p className="kicker">Administración · Cursos</p>
            <h1 className="display" style={{ fontSize: "clamp(2.2rem, 4.6vw, 4.2rem)" }}>Tu catálogo,<br />bajo control.</h1>
            <p className="lede">Sincroniza Drive, ajusta títulos y portadas, ordena lecciones arrastrándolas y decide qué se ve.</p>
          </div>
          <div style={{ display: "grid", gap: 12, justifyItems: "end" }}>
            <div className="stat-row">
              <div className="stat"><strong>{courses.length}</strong><span>Cursos</span></div>
              <div className="stat"><strong>{visibleCourses}</strong><span>Visibles</span></div>
              <div className="stat"><strong>{courses.length - visibleCourses}</strong><span>Ocultos</span></div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className="btn btn-ghost btn-sm" href="/admin/media"><Icon name="film" />Películas y Series</Link>
              <Link className="btn btn-ghost btn-sm" href="/admin/usage"><Icon name="settings" />Uso y cuotas</Link>
              <Link className="btn btn-ghost btn-sm" href="/catalog/cursos"><Icon name="eye" />Ver catálogo</Link>
            </div>
          </div>
        </section>

        {coursesResult.error ? (
          <div className="notice notice-error" style={{ marginTop: 20 }}><span className="notice-icon"><Icon name="warning" /></span><div>No se pudo cargar el catálogo para editar.</div></div>
        ) : (
          <AdminTabs
            tabs={[
              { content: <AdminCourseManager courses={courses} />, icon: "layers", id: "catalogo", label: "Catálogo" },
              { content: <CatalogSyncPanel />, icon: "refresh", id: "sincronizar", label: "Sincronizar Drive" },
              { content: <CodecInventoryPanel />, icon: "search", id: "diagnostico", label: "Diagnóstico" },
            ]}
          />
        )}
      </main>
    </div>
  );
}
