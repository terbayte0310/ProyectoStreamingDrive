"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type PlaybackSource = { id: string; is_active: boolean; name: string };

export function PublishReadyMedia({ sources }: { sources: PlaybackSource[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceId = String(new FormData(event.currentTarget).get("sourceId") ?? "");
    if (!sourceId || !window.confirm("Se publicarán únicamente los paquetes HLS listos. ¿Continuar?")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/media-playback/publish", { body: JSON.stringify({ sourceId }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string; published?: { episodes: number; movies: number; seasons: number; series: number } };
      if (!response.ok || !result.published) throw new Error(result.error ?? "No se pudo publicar el contenido listo.");
      const item = result.published;
      setMessage(`Publicado: ${item.movies} películas, ${item.series} series, ${item.seasons} temporadas y ${item.episodes} episodios con HLS listo.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo publicar el contenido listo.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="admin-panel p-6">
    <p className="eyebrow">Publicación</p>
    <h2 className="mt-1 text-xl font-semibold">Publicar paquetes listos</h2>
    <p className="mt-2 text-sm text-slate-500">Hace visible el contenido con paquete HLS validado. Omite automáticamente cualquier película o episodio sin paquete listo.</p>
    <form className="mt-5 flex flex-wrap gap-3" onSubmit={(event) => void publish(event)}>
      <select className="admin-input min-w-64 rounded-lg border px-3 py-2 text-sm" defaultValue="" disabled={busy} name="sourceId" required><option disabled value="">Fuente de Drive</option>{sources.filter((source) => source.is_active).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
      <button className="primary-button text-sm disabled:opacity-50" disabled={busy || !sources.some((source) => source.is_active)} type="submit">{busy ? "Publicando…" : "Publicar todo lo listo"}</button>
    </form>
    {message ? <p className={message.startsWith("Publicado:") ? "mt-4 text-sm text-emerald-700" : "mt-4 text-sm text-rose-600"}>{message}</p> : null}
  </section>;
}
