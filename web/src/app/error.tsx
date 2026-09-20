"use client";

import { useEffect } from "react";

import { Icon } from "@/components/icons";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="shell container" style={{ display: "grid", placeContent: "center", justifyItems: "center", gap: "1.2rem", textAlign: "center" }}>
      <span className="empty-orb" aria-hidden="true" />
      <h1 className="title-l">Se cortó la proyección</h1>
      <p className="lede">Algo falló al cargar esta página. Suele resolverse al reintentar; si persiste, revisa tu conexión.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button className="btn btn-primary" onClick={reset} type="button"><Icon name="refresh" />Reintentar</button>
        <a className="btn btn-ghost" href="/catalog">Ir a la biblioteca</a>
      </div>
      {error.digest ? <span className="mono subtle" style={{ fontSize: "0.72rem" }}>Ref. {error.digest}</span> : null}
    </main>
  );
}
