export default async function DrivePilotPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl shadow-black/20 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Google Drive</p>
        <h1 className="text-3xl font-semibold">Prueba de lectura del catálogo</h1>
        <p className="text-slate-300">
          Esta prueba pide permiso temporal para leer los metadatos de la carpeta raíz configurada. No sube,
          descarga, modifica ni guarda archivos o tokens.
        </p>
        {params.error === "configuracion" ? (
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-amber-100">
            Faltan las variables locales de Drive. Revisa la guía de configuración antes de intentarlo.
          </p>
        ) : null}
        {params.status ? (
          <p className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-rose-100">
            La prueba no pudo completarse ({params.status}). No se modificó Drive.
          </p>
        ) : null}
        <a className="w-fit rounded-xl bg-white px-5 py-3 font-semibold text-slate-950" href="/api/drive/pilot">
          Conectar y leer la carpeta raíz
        </a>
        <a className="w-fit text-sky-300 underline" href="/dashboard">Volver al panel</a>
      </section>
    </main>
  );
}
