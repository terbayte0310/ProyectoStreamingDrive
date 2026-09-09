"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const ascii = String.raw`
             .         *          .
        *        ╭──────────╮             .
   .          ╭─┤  LEARN   ├─╮       *
       ╭──────┘ ╰──────────╯ └──────╮
       │    +    +    +    +    +   │
  *    │  +   ╭────────────╮  +     │   .
       │    + │  01 10 01  │    +   │
       │  +   │  PLAY  ▶   │ +      │
   .   │    + ╰────────────╯    +   │
       ╰────────────┬───────────────╯
             .      │       *
                  ──┴──                 .
      *       YOUR NEXT CHAPTER
`;

export default function SignInPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setIsLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signInWithGoogle() {
    setMessage(null);
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setMessage("Google no pudo iniciar la sesión. Inténtalo nuevamente.");
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    setUser(null);
  }

  return (
    <main className="login-page">
      <section className="login-visual">
        <Brand />
        <pre aria-hidden="true" className="ascii-art">{ascii}</pre>
        <div className="login-copy">
          <p className="eyebrow">Tu biblioteca privada</p>
          <h2 className="display-title">Aprende a tu ritmo.</h2>
          <p>Cursos, avance y notas en un espacio diseñado para entrar, concentrarte y continuar exactamente donde estabas.</p>
        </div>
        <p className="muted">Nébula · Un espacio, todo tu aprendizaje.</p>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Acceso privado</p>
            <ThemeToggle />
          </div>
          <h1>Bienvenido de vuelta</h1>
          <p>Ingresa con una cuenta autorizada para abrir tu biblioteca.</p>

          {isLoading ? <p className="muted">Comprobando sesión…</p> : user ? (
            <div className="auth-session">
              <div><strong>Sesión activa</strong><p className="muted">{user.email}</p></div>
              <Link className="primary-button" href="/">Abrir mi biblioteca <span aria-hidden="true">→</span></Link>
              <button className="secondary-button" onClick={() => void signOut()} type="button">Cerrar sesión</button>
            </div>
          ) : (
            <>
              <button className="primary-button google-button" onClick={() => void signInWithGoogle()} type="button">
                <span aria-hidden="true" className="google-mark">G</span>
                Continuar con Google
              </button>
            </>
          )}
          {message ? <p className="auth-message" role="alert">{message}</p> : null}
          <p className="mt-6 text-xs muted">Google es el único método de acceso. Solo las cuentas aprobadas pueden entrar.</p>
        </div>
      </section>
    </main>
  );
}
