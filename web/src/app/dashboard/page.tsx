"use client";

import { useEffect, useState } from "react";

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
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl shadow-black/20 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">
          Biblioteca personal
        </p>

        {view.kind === "loading" ? <p className="text-slate-300">Comprobando autorización…</p> : null}

        {view.kind === "signed-out" ? (
          <>
            <h1 className="text-3xl font-semibold">Necesitas iniciar sesión.</h1>
            <a className="w-fit rounded-xl bg-white px-5 py-3 font-semibold text-slate-950" href="/signin">
              Ir al acceso
            </a>
          </>
        ) : null}

        {view.kind === "denied" ? (
          <>
            <h1 className="text-3xl font-semibold">Acceso no autorizado</h1>
            <p className="text-slate-300">
              La cuenta {view.email} inició sesión correctamente, pero todavía no está en la lista de acceso.
            </p>
            <button className="w-fit rounded-xl border border-slate-500 px-4 py-2" onClick={() => void signOut()} type="button">
              Cerrar sesión
            </button>
          </>
        ) : null}

        {view.kind === "authorized" ? (
          <>
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6">
              <p className="font-semibold text-emerald-200">Acceso autorizado</p>
              <p className="mt-1 text-slate-100">{view.profile.email}</p>
              <p className="mt-3 text-sm text-slate-300">
                Rol actual: {view.profile.role === "admin" ? "administrador" : "lector"}.
              </p>
            </div>
            <p className="text-slate-300">Tu biblioteca está lista para usar.</p>
            <div className="flex flex-wrap gap-3">
              <a className="w-fit rounded-xl bg-white px-4 py-2 font-semibold text-slate-950" href="/catalog">Abrir catálogo</a>
              {view.profile.role === "admin" ? <a className="w-fit rounded-xl border border-slate-500 px-4 py-2" href="/admin">Administrar catálogo</a> : null}
            </div>
            <button className="w-fit rounded-xl border border-slate-500 px-4 py-2" onClick={() => void signOut()} type="button">
              Cerrar sesión
            </button>
          </>
        ) : null}

        {view.kind === "error" ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-400/10 p-6">
            <h1 className="font-semibold text-rose-100">No se pudo comprobar el acceso</h1>
            <p className="mt-2 text-rose-100">{view.message}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
