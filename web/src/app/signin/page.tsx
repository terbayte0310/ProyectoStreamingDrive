"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function SignInPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    void supabase.auth.getUser().then(({ data, error }) => {
      if (error) setMessage(error.message);
      setUser(data.user);
      setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null),
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signInWithGoogle() {
    setMessage(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) setMessage(error.message);
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(error.message);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl shadow-black/20 sm:p-12">
        <div className="space-y-4">
          <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Biblioteca personal</p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Aprende desde tu biblioteca de cursos.</h1>
          <p className="max-w-xl text-lg leading-8 text-slate-300">Esta pantalla valida el acceso con Google. El catálogo, progreso y notas se incorporarán en los siguientes hitos.</p>
        </div>

        {isLoading ? <p className="text-slate-300">Comprobando sesión…</p> : user ? (
          <div className="flex flex-col gap-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6">
            <div><p className="font-semibold text-emerald-200">Sesión iniciada</p><p className="mt-1 text-slate-200">{user.email}</p></div>
            <button className="w-fit rounded-xl border border-slate-500 px-4 py-2 font-medium transition hover:bg-slate-800" onClick={() => void signOut()} type="button">Cerrar sesión</button>
          </div>
        ) : <button className="w-fit rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-sky-100" onClick={() => void signInWithGoogle()} type="button">Iniciar sesión con Google</button>}

        {message ? <p className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-rose-100">{message}</p> : null}
      </section>
    </main>
  );
}
