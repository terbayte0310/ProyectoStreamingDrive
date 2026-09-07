export default function DriveDiagnosticPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Diagnóstico de Drive</p>
        <h1 className="text-3xl font-semibold">Comprobar el intercambio OAuth</h1>
        <p className="text-slate-300">No lee ningún archivo. Al terminar mostrará solamente el código de error de Google, sin secretos.</p>
        <a className="w-fit rounded-xl bg-white px-5 py-3 font-semibold text-slate-950" href="/api/drive/diagnostic">Iniciar diagnóstico</a>
      </section>
    </main>
  );
}
