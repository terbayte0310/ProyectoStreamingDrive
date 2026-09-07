export default function DriveAwsSafePage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Google Drive · AWS</p>
        <h1 className="text-3xl font-semibold">Lectura de prueba</h1>
        <p className="text-slate-300">Usa el callback de Drive que ya está validado en Google Cloud. No guarda tokens ni modifica Drive.</p>
        <a className="w-fit rounded-xl bg-white px-5 py-3 font-semibold text-slate-950" href="/api/drive/aws-safe">Leer AWS</a>
      </section>
    </main>
  );
}
