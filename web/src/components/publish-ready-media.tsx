"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";
import { confirmDialog } from "@/components/ui/confirm";

type PlaybackSource = { id: string; is_active: boolean; name: string };
type Published = { episodes: number; movies: number; seasons: number; series: number };

export function PublishReadyMedia({ sources }: { sources: PlaybackSource[] }) {
  const router = useRouter();
  const active = sources.filter((source) => source.is_active);
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Published | null>(null);
  const chosen = sourceId || active[0]?.id || "";

  async function publish() {
    if (!chosen) return;
    if (!(await confirmDialog({ body: "Solo se publican películas y episodios con paquete HLS validado; lo demás se omite automáticamente.", confirmLabel: "Publicar lo listo", title: "¿Publicar el contenido listo?" }))) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/media-playback/publish", { body: JSON.stringify({ sourceId: chosen }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string; published?: Published };
      if (!response.ok || !result.published) throw new Error(result.error ?? "No se pudo publicar el contenido listo.");
      setLast(result.published);
      toast("Publicación completada.", "success");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo publicar el contenido listo.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <div><p className="kicker">Publicación</p><h2 className="title-m">Publicar paquetes listos</h2><p>Hace visible lo que ya tiene HLS validado, en un solo paso.</p></div>
      </div>
      <ol className="op-steps" style={{ marginBottom: 18 }}>
        <li>Importa el inventario o sincroniza Drive.</li>
        <li>Revisa que los paquetes figuren como <span className="badge badge-mint">Listo</span>.</li>
        <li>Publica: los lectores lo verán al instante.</li>
      </ol>
      <div style={{ display: "grid", gap: 12 }}>
        <label className="field">
          <span className="field-label">Fuente de Drive</span>
          <select className="select" disabled={busy || !active.length} onChange={(event) => setSourceId(event.target.value)} value={chosen}>
            {active.length ? active.map((source) => <option key={source.id} value={source.id}>{source.name}</option>) : <option value="">Crea primero una fuente</option>}
          </select>
        </label>
        <button className="btn btn-primary" disabled={busy || !chosen} onClick={() => void publish()} style={{ width: "fit-content" }} type="button"><Icon name="sparkle" />{busy ? "Publicando…" : "Publicar todo lo listo"}</button>
        {last ? (
          <div className="counter-grid">
            <div className="counter"><span>Películas</span><strong>{last.movies}</strong></div>
            <div className="counter"><span>Series</span><strong>{last.series}</strong></div>
            <div className="counter"><span>Temporadas</span><strong>{last.seasons}</strong></div>
            <div className="counter"><span>Episodios</span><strong>{last.episodes}</strong></div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
