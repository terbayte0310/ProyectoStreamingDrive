// Sin este archivo Next no envía un solo byte hasta que la consulta del
// catálogo termina, así que el navegador se queda en blanco todo ese tiempo.
// Un loading.tsx crea el límite de Suspense del segmento: el shell sale de
// inmediato y esto ocupa su lugar. Cubre también /catalog/cursos, /movies y
// /series, que no definen el suyo.
export default function CatalogLoading() {
  return (
    <div className="app-shell" aria-busy="true">
      <main className="catalog-main page-width">
        <span className="sr-only">Cargando tu biblioteca…</span>
        <section aria-hidden="true" className="hero">
          <div className="hero-copy">
            <div className="skeleton" style={{ width: "9rem", height: ".8rem" }} />
            <div className="skeleton" style={{ width: "min(100%, 28rem)", height: "4rem", marginTop: "1.2rem" }} />
            <div className="skeleton" style={{ width: "min(100%, 34rem)", height: "1rem", marginTop: "1.2rem" }} />
            <div className="skeleton" style={{ width: "min(100%, 22rem)", height: "1rem", marginTop: ".5rem" }} />
            <div className="hero-actions" style={{ marginTop: "1.8rem" }}>
              <div className="skeleton" style={{ width: "11rem", height: "2.8rem" }} />
            </div>
          </div>
        </section>

        <section aria-hidden="true" className="section-block">
          <div className="section-heading">
            <div className="skeleton" style={{ width: "16rem", height: "1.6rem" }} />
          </div>
          <div className="course-rail">
            {Array.from({ length: 6 }, (_, index) => (
              <article className="course-card" key={index}>
                <div className="skeleton" style={{ aspectRatio: "16 / 9", borderRadius: 0 }} />
                <div className="course-card-body">
                  <div className="skeleton" style={{ width: "80%", height: "1.1rem" }} />
                  <div className="skeleton" style={{ width: "55%", height: ".8rem", marginTop: ".7rem" }} />
                  <div className="skeleton" style={{ width: "100%", height: "3px", marginTop: ".9rem" }} />
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
