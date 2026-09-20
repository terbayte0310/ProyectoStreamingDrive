"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { type CSSProperties, useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { buildGoogleSignInOptions } from "@/lib/auth/google-oauth";
import { completeSignOut } from "@/lib/auth/sign-out-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function GoogleG() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48">
      <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" fill="#FFC107" />
      <path d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00" />
      <path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" fill="#4CAF50" />
      <path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" fill="#1976D2" />
    </svg>
  );
}

export function SignInPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    // getSession lee la sesión local al instante; no hace falta esperar a la red para pintar el botón.
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setChecking(false);
    }).catch(() => setChecking(false));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setChecking(false);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const notice = params.get("notice");
    let next: { kind: "error" | "info"; text: string } | null = null;
    if (error === "drive_authorization") next = { kind: "error", text: "Google no entregó una autorización renovable para Drive. Cierra sesión y vuelve a entrar concediendo el acceso." };
    else if (error === "oauth_callback") next = { kind: "error", text: "No se pudo completar el inicio de sesión con Google. Inténtalo de nuevo." };
    else if (notice === "cleanup-pending") next = { kind: "info", text: "La sesión se cerró en este dispositivo. Vuelve a entrar si necesitas ver algo." };
    else if (notice === "signed-out") next = { kind: "info", text: "Sesión cerrada. ¡Hasta pronto!" };
    if (!next) return;
    const timer = window.setTimeout(() => setMessage(next), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function signInWithGoogle() {
    setMessage(null);
    setRedirecting(true);
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: buildGoogleSignInOptions(window.location.origin),
    });
    if (error) {
      setRedirecting(false);
      setMessage({ kind: "error", text: "Google no pudo iniciar la sesión. Inténtalo nuevamente." });
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <p className="kicker">Acceso privado</p>
        <ThemeToggle />
      </div>
      <h1>Bienvenido de vuelta</h1>
      <p>Entra con una cuenta autorizada para abrir tu biblioteca.</p>

      {checking ? (
        <div className="auth-checking" role="status"><span className="orbit-loader" style={{ "--size": "28px" } as CSSProperties}><span /></span>Comprobando tu sesión…</div>
      ) : user ? (
        <div className="auth-session">
          <div><strong>Sesión activa</strong><span className="muted">{user.email}</span></div>
          <Link className="btn btn-primary btn-lg" href="/catalog">Abrir mi biblioteca <Icon className="btn-arrow" name="arrowRight" /></Link>
          <button className="btn btn-ghost" onClick={() => void completeSignOut()} type="button">Usar otra cuenta</button>
        </div>
      ) : (
        <button className="btn btn-light btn-lg btn-block google-button" disabled={redirecting} onClick={() => void signInWithGoogle()} style={{ border: "1px solid var(--line-2)" }} type="button">
          <span className="google-g"><GoogleG /></span>
          {redirecting ? "Abriendo Google…" : "Continuar con Google"}
        </button>
      )}

      {message ? (
        <div className={`notice ${message.kind === "error" ? "notice-error" : ""}`} role={message.kind === "error" ? "alert" : "status"}>
          <span className="notice-icon"><Icon name={message.kind === "error" ? "warning" : "info"} /></span>
          <div>{message.text}</div>
        </div>
      ) : null}

      <p className="auth-legal"><Icon name="shield" />Solo las cuentas aprobadas pueden entrar. Nébula lee tus vídeos de Drive en modo solo lectura.</p>
    </div>
  );
}
