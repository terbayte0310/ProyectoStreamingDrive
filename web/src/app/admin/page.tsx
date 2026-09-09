import Link from "next/link";

import {
  AdminCourseManager,
  type AdminCourse,
} from "@/components/admin-course-manager";
import { AppHeader } from "@/components/app-header";
import { CatalogSyncPanel } from "@/components/catalog-sync-panel";
import { CodecInventoryPanel } from "@/components/codec-inventory-panel";
import { requireAdminAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const access = await requireAdminAccess();
  const supabase = await createSupabaseServerClient();
  const coursesResult = await supabase
    .from("courses")
    .select("id, detected_title, custom_title, author, platform, published_on, description, cover_url, is_visible")
    .order("position")
    .order("id");
  const error = coursesResult.error;
  const courses = (coursesResult.data ?? []) as AdminCourse[];
  const visibleCourses = courses.filter((course) => course.is_visible).length;

  return (
    <div className="admin-page app-shell">
      <AppHeader email={access.profile.email} showNavigation={false} />
      <main className="admin-main page-width">
        <section className="admin-hero admin-reveal">
          <div>
            <p className="eyebrow">Control de biblioteca</p>
            <h1>Tu catálogo, bajo control.</h1>
            <p>Gestiona metadatos, orden y visibilidad desde una interfaz diseñada para que cada cambio se sienta claro y seguro.</p>
          </div>
          <div className="admin-hero-actions">
            <div className="admin-stat"><strong>{courses.length}</strong><span>Cursos</span></div>
            <div className="admin-stat"><strong>{visibleCourses}</strong><span>Publicados</span></div>
            <div className="admin-stat"><strong>Por curso</strong><span>Carga bajo demanda</span></div>
            <Link className="secondary-button" href="/catalog">Ver catálogo <span aria-hidden="true">↗</span></Link>
          </div>
        </section>

        {error ? (
          <p className="admin-alert admin-alert-error">No se pudo cargar el catálogo para editar.</p>
        ) : (
          <>
            <CatalogSyncPanel />
            <CodecInventoryPanel />
            <AdminCourseManager
              courses={courses}
            />
          </>
        )}
      </main>
    </div>
  );
}
