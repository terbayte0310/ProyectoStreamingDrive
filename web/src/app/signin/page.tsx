import type { Metadata } from "next";

import { Brand } from "@/components/brand";
import { FrameWall } from "@/components/frame-wall";
import { SignInPanel } from "@/components/sign-in-panel";

export const metadata: Metadata = { title: "Acceso" };

// El escenario es de servidor (sin JS); solo la tarjeta de acceso hidrata.
export default function SignInPage() {
  return (
    <main className="auth">
      <section className="auth-stage">
        <FrameWall />
        <Brand href="/signin" />
        <div className="auth-copy">
          <p className="kicker">Tu biblioteca privada</p>
          <h1 className="display">Dale play<br />a tu <span className="text-gradient">mundo.</span></h1>
          <p>Películas para desconectar. Series para quedarte. Cursos para ir más lejos. Todo en un solo lugar, solo para tu círculo.</p>
        </div>
        <div className="auth-foot"><span>Historias</span><span>Ideas</span><span>Nuevos comienzos</span></div>
      </section>
      <section className="auth-panel">
        <SignInPanel />
      </section>
    </main>
  );
}
