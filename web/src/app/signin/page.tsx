"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { buildGoogleSignInOptions } from "@/lib/auth/google-oauth";
import { completeSignOut } from "@/lib/auth/sign-out-client";
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
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      setIsLoading(false);
      setMessage("La comprobación de sesión tardó demasiado. Revisa la conexión y recarga la página.");
    }, 8_000);
    void supabase.auth.getUser()
      .then(({ data, error }) => {
        window.clearTimeout(timeout);
        setUser(data.user);
        if (error) setMessage("No se pudo comprobar la sesión. Revisa tu conexión e inténtalo de nuevo.");
      })
      .catch(() => {
        window.clearTimeout(timeout);
        setMessage("No se pudo comprobar la sesión. Revisa tu conexión e inténtalo de nuevo.");
      })
      .finally(() => {
        if (!timedOut) setIsLoading(false);
      });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      window.clearTimeout(timeout);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });
    return () => {
      window.clearTimeout(timeout);
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const error = searchParams.get("error");
    const notice = searchParams.get("notice");
    if (error === "drive_authorization") {
      const timer = window.setTimeout(
        () => setMessage("Google no entregó una autorización renovable para Drive. Cierra esta sesión y vuelve a entrar para conceder el acceso en el mismo inicio de sesión."),
        0,
      );
      return () => window.clearTimeout(timer);
    }
    if (notice === "cleanup-pending") {
      const timer = window.setTimeout(
        () => setMessage("La sesión se cerró en este dispositivo. Vuelve a iniciar sesión si necesitas usar Drive."),
        0,
      );
      return () => window.clearTimeout(timer);
    }
  }, []);

  async function signInWithGoogle() {
    setMessage(null);
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: buildGoogleSignInOptions(window.location.origin),
    });
    if (error) setMessage("Google no pudo iniciar la sesión. Inténtalo nuevamente.");
  }

  async function signOut() {
    await completeSignOut();
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
