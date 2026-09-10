"use client";

import { useEffect, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AccessProfile = {
  email: string;
  is_authorized: boolean;
  role: "admin" | "reader";
};

type ViewState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "denied"; email: string }
  | { kind: "authorized"; profile: AccessProfile }
  | { kind: "error"; message: string };

export default function DashboardPage() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function loadAccess() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const user = userData.user;

      if (userError) {
        setView({ kind: "error", message: userError.message });
        return;
      }

      if (!user) {
        setView({ kind: "signed-out" });
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("email, role, is_authorized")
        .eq("id", user.id)
        .single<AccessProfile>();

      if (profileError || !profile) {
        setView({
          kind: "error",
          message: profileError?.message ?? "No se encontró un perfil para esta cuenta.",
        });
        return;
      }

      if (!profile.is_authorized) {
        setView({ kind: "denied", email: profile.email });
        return;
      }

      setView({ kind: "authorized", profile });
    }

    void loadAccess();
  }, []);

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    setView({ kind: "signed-out" });
  }

  return (
    <div className="app-shell">
      <AppHeader admin={view.kind === "authorized" && view.profile.role === "admin"} email={view.kind === "authorized" ? view.profile.email : undefined} />
      <main className="account-page page-width">
      <section className="account-panel">
        <p className="eyebrow">Mi cuenta</p>

        {view.kind === "loading" ? <p className="muted">Comprobando autorización…</p> : null}

        {view.kind === "signed-out" ? (
          <>
            <h1 className="text-3xl font-semibold">Necesitas iniciar sesión.</h1>
            <a className="primary-button w-fit" href="/signin">
              Ir al acceso
            </a>
          </>
        ) : null}

        {view.kind === "denied" ? (
          <>
            <h1 className="text-3xl font-semibold">Acceso no autorizado</h1>
            <p className="muted">
              La cuenta {view.email} inició sesión correctamente, pero todavía no está en la lista de acceso.
            </p>
            <button className="secondary-button w-fit" onClick={() => void signOut()} type="button">
              Cerrar sesión
            </button>
          </>
        ) : null}

        {view.kind === "authorized" ? (
          <>
            <div className="account-authorized">
              <p className="font-semibold text-blue-500">Acceso autorizado</p>
              <p className="mt-1">{view.profile.email}</p>
              <p className="mt-3 text-sm muted">
                Rol actual: {view.profile.role === "admin" ? "administrador" : "lector"}.
              </p>
            </div>
            <p className="muted">Tu biblioteca está lista para usar.</p>
            <div className="flex flex-wrap gap-3">
              <a className="primary-button w-fit" href="/catalog">Abrir catálogo</a>
              {view.profile.role === "admin" ? <a className="secondary-button w-fit" href="/admin">Administrar catálogo</a> : null}
            </div>
            <button className="secondary-button w-fit" onClick={() => void signOut()} type="button">
              Cerrar sesión
            </button>
          </>
        ) : null}

        {view.kind === "error" ? (
          <div className="auth-message p-6">
            <h1 className="font-semibold">No se pudo comprobar el acceso</h1>
            <p className="mt-2">{view.message}</p>
          </div>
        ) : null}
      </section>
      </main>
    </div>
  );
}
