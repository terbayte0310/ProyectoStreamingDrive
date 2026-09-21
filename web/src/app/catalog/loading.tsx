import type { CSSProperties } from "react";

// Límite de Suspense del catálogo: estas siluetas ocupan el lugar del contenido
// mientras llega la consulta. La cabecera no forma parte del esqueleto: vive en
// catalog/layout.tsx y permanece en pantalla. Cubre /catalog/cursos, /movies,
// /series y sus fichas.
export default function CatalogLoading() {
  return (
    <>
      <main aria-busy="true" className="shell-main container">
        <span className="sr-only">Cargando tu biblioteca…</span>
        <section aria-hidden="true" className="spotlight" style={{ display: "grid", alignItems: "end" }}>
          <div className="spotlight-copy" style={{ width: "100%" }}>
            <div className="skeleton" style={{ width: 160, height: 12, opacity: 0.4 }} />
            <div className="skeleton" style={{ width: "min(100%, 560px)", height: 72, opacity: 0.35 }} />
            <div className="skeleton" style={{ width: "min(100%, 420px)", height: 16, opacity: 0.3 }} />
            <div style={{ display: "flex", gap: 12 }}>
              <div className="skeleton" style={{ width: 170, height: 54, borderRadius: 99, opacity: 0.4 }} />
              <div className="skeleton" style={{ width: 150, height: 54, borderRadius: 99, opacity: 0.25 }} />
            </div>
          </div>
          <div style={{ position: "absolute", top: 28, right: 28 }}><span className="orbit-loader" style={{ "--size": "40px" } as CSSProperties}><span /></span></div>
        </section>
        <section aria-hidden="true" className="section">
          <div className="skeleton" style={{ width: 280, height: 36, marginBottom: 24 }} />
          <div className="course-grid">
            {Array.from({ length: 8 }, (_, index) => (
              <div className="course-card" key={index} style={{ opacity: 1 - index * 0.08 }}>
                <div className="skeleton" style={{ aspectRatio: "16 / 9", borderRadius: 0 }} />
                <div className="course-card-body">
                  <div className="skeleton" style={{ width: "82%", height: 18 }} />
                  <div className="skeleton" style={{ width: "50%", height: 12 }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
