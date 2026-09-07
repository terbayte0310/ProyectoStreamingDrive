"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function DriveAccessContent() {
  const searchParams = useSearchParams();

  async function authorize() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/drive-callback`,
        scopes: "https://www.googleapis.com/auth/drive.readonly",
        queryParams: { prompt: "consent" },
      },
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Prueba de Drive</p>
        <h1 className="text-3xl font-semibold">Autorizar reproducción nativa</h1>
        <p className="text-slate-300">Google mostrará un permiso de lectura de Drive para tu cuenta. El token se usa durante esta sesión de prueba y no se guarda en la base de datos.</p>
        {searchParams.get("error") ? <p className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-rose-100">Google no devolvió el token de Drive. Revisa el scope y vuelve a intentarlo.</p> : null}
        <button className="w-fit rounded-xl bg-white px-5 py-3 font-semibold text-slate-950" onClick={() => void authorize()} type="button">Autorizar mi Drive para la prueba</button>
      </section>
    </main>
  );
}

export default function DriveAccessPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950 p-10 text-slate-100">Cargando autorización…</main>}><DriveAccessContent /></Suspense>;
}
