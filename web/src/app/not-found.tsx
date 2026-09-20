import Link from "next/link";

import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="shell container" style={{ display: "grid", placeContent: "center", justifyItems: "center", gap: "1.2rem", textAlign: "center" }}>
      <Brand />
      <p className="kicker kicker-plain">Error 404</p>
      <h1 className="display">Esta escena<br /><span className="text-gradient">no existe.</span></h1>
      <p className="lede">Puede que el título se haya despublicado o que el enlace esté incompleto.</p>
      <Link className="btn btn-primary btn-lg" href="/catalog">Volver a la biblioteca</Link>
    </main>
  );
}
