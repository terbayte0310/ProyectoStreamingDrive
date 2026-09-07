"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function DriveAccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const reason = searchParams.get("reason");
  const detail = searchParams.get("detail");

  const errorMessage = error === "state"
    ? "La solicitud OAuth no coincide con la iniciada por este navegador. Vuelve a intentarlo desde esta página."
    : error === "refresh-token"
      ? "Google entregó acceso temporal, pero no la credencial de renovación. Retira el acceso anterior de la aplicación en tu cuenta de Google y vuelve a autorizarlo."
      : error === "configuracion"
        ? "Faltan las credenciales privadas de Google Drive en .env.local."
        : reason === "invalid_client"
          ? "Google rechazó el cliente OAuth. Comprueba que GOOGLE_DRIVE_CLIENT_ID y GOOGLE_DRIVE_CLIENT_SECRET pertenezcan al mismo cliente donde registraste el URI."
          : reason === "invalid_grant"
            ? "Google rechazó el código OAuth. Suele ocurrir si el código ya se usó, expiró o el URI no pertenece al mismo cliente OAuth. Inicia una autorización nueva."
            : reason === "redirect_uri_mismatch"
              ? "El URI usado por la aplicación no coincide exactamente con el registrado en Google Cloud."
              : error === "supabase-exchange"
                ? "Supabase no pudo completar el intercambio OAuth con Google. Inicia una autorización nueva desde esta página."
                : error === "missing-code"
                  ? "La respuesta OAuth no contenía un código. Inicia una autorización nueva desde esta página."
                  : error
                ? "No se pudo completar la autorización de Drive. Vuelve a intentarlo y revisa la configuración OAuth."
                : "";

  async function authorize() {
    const returnTo = searchParams.get("returnTo") ?? "/catalog";
    const callback = new URL("/auth/drive-callback", window.location.origin);
    callback.searchParams.set("returnTo", returnTo);
    const { error: authorizationError } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        queryParams: { access_type: "offline", prompt: "consent" },
        redirectTo: callback.toString(),
        scopes: "https://www.googleapis.com/auth/drive.readonly",
      },
    });
    if (authorizationError) router.replace("/drive-access?error=start");
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Google Drive</p>
        <h1 className="text-3xl font-semibold">Autorizar reproducción</h1>
        <p className="text-slate-300">Google solicitará acceso de solo lectura. La credencial renovable se conserva en una cookie segura y HttpOnly; nunca en la base de datos ni en JavaScript.</p>
        {errorMessage ? <p className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-rose-100">{errorMessage}</p> : null}
        {detail ? <p className="text-xs text-slate-400">Detalle del proveedor OAuth: {detail}</p> : null}
        <button className="w-fit rounded-xl bg-white px-5 py-3 font-semibold text-slate-950" onClick={() => void authorize()} type="button">Autorizar Google Drive</button>
      </section>
    </main>
  );
}

export default function DriveAccessPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950 p-10 text-slate-100">Cargando autorización…</main>}><DriveAccessContent /></Suspense>;
}
