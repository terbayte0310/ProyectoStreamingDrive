"use client";

import { useRouter } from "next/navigation";
import { type DragEvent, useState } from "react";

import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";
import { reconnectGoogleDrive } from "@/lib/auth/drive-oauth";

type PlaybackSource = { id: string; is_active: boolean; name: string };
type ImportResult = { created?: { episodes: number; movies: number; seasons: number; series: number }; error?: string; errors?: string[] };
type Phase = { label: string; percent: number } | null;

function parseCsv(source: string) {
  const rows: string[][] = [];
  let cell = "";
  let inQuotes = false;
  let row: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') inQuotes = false;
      else cell += character;
      continue;
    }
    if (character === '"') { inQuotes = true; continue; }
    if (character === ",") { row.push(cell); cell = ""; continue; }
    if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; continue; }
    cell += character;
  }
  if (inQuotes) throw new Error("El CSV tiene una comilla sin cerrar.");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("El CSV debe tener encabezados y al menos una fila.");
  const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^﻿/, "") : header).trim());
  for (const required of ["CodigoInterno", "Tipo", "TituloProvisional"]) {
    if (!headers.includes(required)) throw new Error(`El CSV debe incluir la columna ${required}.`);
  }
  return rows.slice(1).filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function MediaInventoryImport({ onFinished, sources }: { onFinished?: () => Promise<void> | void; sources: PlaybackSource[] }) {
  const router = useRouter();
  const active = sources.filter((source) => source.is_active);
  const [sourceId, setSourceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<Phase>(null);
  const [needsDrive, setNeedsDrive] = useState(false);
  const chosenSource = sourceId || active[0]?.id || "";
  const busy = phase !== null;

  async function synchronize(source: string, base: number) {
    let packages = 0; let assets = 0; let remaining = 0; let errors = 0; let duplicates = 0;
    const attempted = new Set<string>();
    do {
      const response = await fetch("/api/admin/media-playback/batch", { body: JSON.stringify({ refresh: true, skipCodes: Array.from(attempted), sourceId: source }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const result = await response.json().catch(() => ({})) as { duplicateCodes?: string[]; error?: string; errors?: Array<{ internalCode: string }>; remaining?: number; scanned?: Array<{ assets: number; internalCode: string }> };
      if (!response.ok) throw new Error(result.error ?? "No se pudieron vincular los paquetes de Drive.");
      const current = result.scanned ?? [];
      packages += current.length;
      assets += current.reduce((total, item) => total + item.assets, 0);
      errors += result.errors?.length ?? 0;
      duplicates = result.duplicateCodes?.length ?? 0;
      remaining = result.remaining ?? 0;
      for (const item of current) attempted.add(item.internalCode);
      for (const item of result.errors ?? []) attempted.add(item.internalCode);
      const total = packages + remaining;
      setPhase({ label: `Vinculando Drive: ${packages} paquetes · ${assets} archivos`, percent: base + (total ? (packages / total) * (100 - base) : 0) });
      if (!current.length) break;
    } while (remaining > 0);
    return { assets, duplicates, errors, packages };
  }

  function handleFailure(error: unknown, fallback: string) {
    const detail = error instanceof Error ? error.message : fallback;
    toast(detail, "error", 9000);
    setNeedsDrive(/drive/i.test(detail) && /(autorizar|autorización|venció|revocada)/i.test(detail));
  }

  async function importAndSync() {
    if (!chosenSource || !file) return;
    setNeedsDrive(false);
    try {
      setPhase({ label: "Leyendo el CSV…", percent: 5 });
      const rows = parseCsv(await file.text());
      setPhase({ label: `Creando ${rows.length} registros del catálogo…`, percent: 15 });
      const response = await fetch("/api/admin/media/import", { body: JSON.stringify({ rows }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const result = await response.json().catch(() => ({})) as ImportResult;
      if (!response.ok) throw new Error(result.errors?.slice(0, 3).join(" ") || result.error || "No se pudo importar el inventario.");
      const created = result.created ?? { episodes: 0, movies: 0, seasons: 0, series: 0 };
      setPhase({ label: "Catálogo creado. Buscando paquetes HLS en Drive…", percent: 35 });
      const synced = await synchronize(chosenSource, 35);
      const notes = [synced.errors ? `${synced.errors} con error` : "", synced.duplicates ? `${synced.duplicates} códigos duplicados` : ""].filter(Boolean);
      toast(`Listo: ${created.movies} películas, ${created.series} series, ${created.seasons} temporadas y ${created.episodes} episodios. ${synced.packages} paquetes vinculados.${notes.length ? ` Revisión: ${notes.join(", ")}.` : ""}`, notes.length ? "warn" : "success", 10_000);
      setFile(null);
      await onFinished?.();
      router.refresh();
    } catch (error) {
      handleFailure(error, "No se pudo importar el inventario.");
    } finally {
      setPhase(null);
    }
  }

  async function syncOnly() {
    if (!chosenSource) return;
    setNeedsDrive(false);
    try {
      setPhase({ label: "Buscando carpetas HLS en Drive…", percent: 5 });
      const synced = await synchronize(chosenSource, 5);
      const notes = [synced.errors ? `${synced.errors} con error` : "", synced.duplicates ? `${synced.duplicates} códigos duplicados` : ""].filter(Boolean);
      toast(`Drive sincronizado: ${synced.packages} paquetes y ${synced.assets} archivos.${notes.length ? ` Revisión: ${notes.join(", ")}.` : ""}`, notes.length ? "warn" : "success", 8000);
      await onFinished?.();
      router.refresh();
    } catch (error) {
      handleFailure(error, "No se pudo sincronizar Drive.");
    } finally {
      setPhase(null);
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped && /\.csv$/i.test(dropped.name)) setFile(dropped);
    else toast("Suelta un archivo .csv del inventario de conversión.", "warn");
  }

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <div><p className="kicker">Carga masiva</p><h2 className="title-m">Importar inventario y vincular Drive</h2><p>Usa solo códigos, títulos y estructura de serie; ignora las rutas de tus discos. No duplica ni sobrescribe contenido existente.</p></div>
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        <label className="field">
          <span className="field-label">Fuente de Drive</span>
          <select className="select" disabled={busy || !active.length} onChange={(event) => setSourceId(event.target.value)} value={chosenSource}>
            {active.length ? active.map((source) => <option key={source.id} value={source.id}>{source.name}</option>) : <option value="">Crea primero una fuente</option>}
          </select>
        </label>
        <label className="dropzone" data-over={over ? "" : undefined} onDragLeave={() => setOver(false)} onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDrop={onDrop}>
          <input accept=".csv,text/csv" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
          <Icon name="upload" />
          {file ? <><strong>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · listo para importar</span></> : <><strong>Arrastra el CSV aquí</strong><span>o haz clic para elegirlo</span></>}
        </label>
        {phase ? (
          <div className="progress-block" role="status">
            <span className="meter"><span style={{ width: `${Math.round(phase.percent)}%` }} /></span>
            <div className="progress-meta"><span>{phase.label}</span><span className="mono">{Math.round(phase.percent)}%</span></div>
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-primary" disabled={busy || !file || !chosenSource} onClick={() => void importAndSync()} type="button"><Icon name="upload" />Importar y sincronizar</button>
          <button className="btn btn-ghost" disabled={busy || !chosenSource} onClick={() => void syncOnly()} title="Cuando el inventario ya está importado" type="button"><Icon name="refresh" />Solo sincronizar Drive</button>
        </div>
        {needsDrive ? (
          <div className="notice notice-warn" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <span className="notice-icon"><Icon name="lock" /></span>
            <div style={{ flex: 1 }}>La autorización de Drive venció o fue revocada.</div>
            <button className="btn btn-ghost btn-sm" onClick={() => void reconnectGoogleDrive("/admin/media#carga").catch((error: unknown) => toast(error instanceof Error ? error.message : "No se pudo reconectar Google Drive.", "error"))} type="button">Reconectar Google Drive</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
