import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon, type IconName } from "@/components/icons";
import { libraryModuleLinks, type LibraryModule } from "@/components/media-catalog";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteHeader } from "@/components/site-header";
import { getViewer } from "@/lib/auth/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mi espacio" };

const moduleIcons: Record<LibraryModule, IconName> = { courses: "course", movies: "film", series: "tv" };

// Antes era una página cliente que consultaba la sesión y el perfil desde el
// navegador; ahora llega ya resuelta en el HTML inicial.
export default async function DashboardPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  const profile = viewer.profile;
  const authorized = Boolean(profile?.is_authorized);
  const isAdmin = authorized && profile?.role === "admin";
  const initial = (profile?.email?.[0] ?? "N").toUpperCase();

  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell-main container">
        <section className="account-hero rise">
          <span aria-hidden="true" className="account-avatar">{initial}</span>
          <div style={{ display: "grid", gap: "0.5rem", minWidth: 0 }}>
            <p className="kicker">Mi espacio</p>
            <h1 className="title-l">{profile?.email ?? "Tu cuenta"}</h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {authorized ? <span className="badge badge-mint badge-dot">Acceso autorizado</span> : <span className="badge badge-gold badge-dot">Pendiente de aprobación</span>}
              {authorized ? <span className="badge badge-iris">{isAdmin ? "Administrador" : "Lector"}</span> : null}
            </div>
          </div>
          <SignOutButton />
        </section>

        {!authorized ? (
          <section className="section">
            <div className="notice notice-warn">
              <span className="notice-icon"><Icon name="lock" /></span>
              <div><strong>Tu cuenta inició sesión, pero aún no está en la lista de acceso.</strong> Pide a un administrador que la apruebe; después vuelve a entrar.</div>
            </div>
          </section>
        ) : (
          <>
            <section className="section">
              <div className="section-head"><div><p className="kicker">Tus módulos</p><h2 className="title-l">¿Qué te apetece hoy?</h2></div></div>
              <div className="module-grid">
                {libraryModuleLinks.map((item, index) => {
                  const enabled = viewer.modules.includes(item.module);
                  const content = (
                    <>
                      <span className="module-card-icon"><Icon name={moduleIcons[item.module]} /></span>
                      <div>
                        <h3 className="title-m">{item.label}</h3>
                        <p>{enabled ? item.description : "No está asignado a tu cuenta."}</p>
                      </div>
                      {enabled ? <span className="link-arrow">Abrir <span aria-hidden="true">→</span></span> : <span className="subtle">Sin acceso</span>}
                    </>
                  );
                  return enabled
                    ? <Link className="module-card rise" data-spotlight="" data-tilt="4" href={item.href} key={item.module} style={{ "--i": index } as CSSProperties}>{content}</Link>
                    : <div aria-disabled="true" className="module-card rise" key={item.module} style={{ "--i": index } as CSSProperties}>{content}</div>;
                })}
              </div>
            </section>
            {isAdmin ? (
              <section className="section">
                <div className="section-head"><div><p className="kicker">Administración</p><h2 className="title-l">Gestiona la biblioteca</h2></div></div>
                <div className="module-grid">
                  <Link className="module-card" data-spotlight="" data-tilt="4" href="/admin">
                    <span className="module-card-icon"><Icon name="layers" /></span>
                    <div><h3 className="title-m">Cursos</h3><p>Sincroniza Drive, edita metadatos, orden y visibilidad.</p></div>
                    <span className="link-arrow">Administrar <span aria-hidden="true">→</span></span>
                  </Link>
                  <Link className="module-card" data-spotlight="" data-tilt="4" href="/admin/media">
                    <span className="module-card-icon"><Icon name="film" /></span>
                    <div><h3 className="title-m">Películas y Series</h3><p>Importa inventarios, vincula TMDB y publica paquetes HLS.</p></div>
                    <span className="link-arrow">Administrar <span aria-hidden="true">→</span></span>
                  </Link>
                  <Link className="module-card" data-spotlight="" data-tilt="4" href="/admin/usage">
                    <span className="module-card-icon"><Icon name="settings" /></span>
                    <div><h3 className="title-m">Uso y cuotas</h3><p>Revisa entregas medidas, reservas preventivas y límites de Drive.</p></div>
                    <span className="link-arrow">Abrir reporte <span aria-hidden="true">→</span></span>
                  </Link>
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
