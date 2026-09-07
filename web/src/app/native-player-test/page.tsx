import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type Lesson = { custom_title: string | null; detected_title: string; drive_item_id: string | null };
type DriveItem = { drive_file_id: string; id: string };

export const dynamic = "force-dynamic";

export default async function NativePlayerTestPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/signin");

  const { data: lesson } = await supabase
    .from("lessons")
    .select("detected_title, custom_title, drive_item_id")
    .order("created_at")
    .limit(1)
    .maybeSingle<Lesson>();
  if (!lesson?.drive_item_id) redirect("/catalog");

  const { data: item } = await supabase
    .from("drive_items")
    .select("id, drive_file_id")
    .eq("id", lesson.drive_item_id)
    .maybeSingle<DriveItem>();
  if (!item) redirect("/catalog");

  const title = lesson.custom_title ?? lesson.detected_title;
  const contentUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(item.drive_file_id)}`;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-800 bg-slate-900/70 p-8 sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-sky-300 uppercase">Prueba técnica</p>
        <h1 className="mt-3 text-3xl font-semibold">Reproductor HTML5 nativo</h1>
        <p className="mt-3 text-slate-300">Lección de prueba: {title}</p>
        <video className="mt-8 aspect-video w-full rounded-2xl bg-black" controls preload="metadata" src={contentUrl}>
          Tu navegador no admite reproducción HTML5.
        </video>
        <p className="mt-5 text-sm text-slate-400">Si el video carga, podremos registrar su progreso y detectar cuándo termina. Si se descarga o falla, conservaremos el visor de Drive mientras evaluamos otra estrategia.</p>
        <a className="mt-6 inline-block text-sky-300 underline" href="/course-demo">Volver a la prueba con visor de Drive</a>
      </section>
    </main>
  );
}
