"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { reconnectGoogleDrive } from "@/lib/auth/drive-oauth";

type PlaybackSource = { id: string; is_active: boolean; name: string };
type ImportResult = {
  created?: { episodes: number; movies: number; seasons: number; series: number };
  error?: string;
  errors?: string[];
};

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
  const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
  for (const required of ["CodigoInterno", "Tipo", "TituloProvisional"]) {
    if (!headers.includes(required)) throw new Error(`El CSV debe incluir la columna ${required}.`);
  }
  return rows.slice(1).filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function MediaInventoryImport({ sources }: { sources: PlaybackSource[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsDrive, setNeedsDrive] = useState(false);

  async function synchronize(sourceId: string) {
    let packages = 0;
    let assets = 0;
    let remaining = 0;
    let errors = 0;
    let duplicates = 0;
    const attemptedCodes = new Set<string>();
    do {
      const response = await fetch("/api/admin/media-playback/batch", { body: JSON.stringify({ refresh: true, skipCodes: Array.from(attemptedCodes), sourceId }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const result = await response.json().catch(() => ({})) as { duplicateCodes?: string[]; error?: string; errors?: Array<{ internalCode: string }>; remaining?: number; scanned?: Array<{ assets: number; internalCode: string }> };
      if (!response.ok) throw new Error(result.error ?? "No se pudieron vincular los paquetes de Drive.");
      const current = result.scanned ?? [];
      packages += current.length;
      assets += current.reduce((total, item) => total + item.assets, 0);
      errors += result.errors?.length ?? 0;
      duplicates = result.duplicateCodes?.length ?? 0;
      remaining = result.remaining ?? 0;
      for (const item of current) attemptedCodes.add(item.internalCode);
      for (const item of result.errors ?? []) attemptedCodes.add(item.internalCode);
      setMessage(`Vinculando Drive: ${packages} paquetes y ${assets} archivos registrados…`);
      if (!current.length) break;
    } while (remaining > 0);
    return { assets, duplicates, errors, packages };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sourceId = String(form.get("sourceId") ?? "");
    const file = form.get("inventory");
    if (!sourceId || !(file instanceof File) || !file.size) return;
    setBusy(true);
    setMessage("");
    setNeedsDrive(false);
    try {
      const rows = parseCsv(await file.text());
      const response = await fetch("/api/admin/media/import", { body: JSON.stringify({ rows }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const result = await response.json().catch(() => ({})) as ImportResult;
      if (!response.ok) throw new Error(result.errors?.slice(0, 3).join(" ") || result.error || "No se pudo importar el inventario.");
      const created = result.created ?? { episodes: 0, movies: 0, seasons: 0, series: 0 };
      setMessage("Catálogo creado. Buscando paquetes HLS en Drive…");
      const synced = await synchronize(sourceId);
      const notes = [synced.errors ? `${synced.errors} con error` : "", synced.duplicates ? `${synced.duplicates} códigos duplicados` : ""].filter(Boolean);
      setMessage(`Listo: creados ${created.movies} películas, ${created.series} series, ${created.seasons} temporadas y ${created.episodes} episodios. Vinculados ${synced.packages} paquetes.${notes.length ? ` Revisión: ${notes.join(", ")}.` : ""}`);
      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "No se pudo importar el inventario.";
      setMessage(detail);
      setNeedsDrive(/drive/i.test(detail) && /(autorizar|autorización|venció|revocada)/i.test(detail));
    } finally {
      setBusy(false);
    }
  }

  async function reconnectDrive() {
    setBusy(true);
    setMessage("");
    try {
      await reconnectGoogleDrive("/admin/media");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo reconectar Google Drive.");
      setBusy(false);
    }
  }

  return <section className="admin-panel p-6">
    <p className="eyebrow">Carga masiva</p>
    <h2 className="mt-1 text-xl font-semibold">Importar inventario y sincronizar Drive</h2>
    <p className="mt-2 text-sm text-slate-500">Carga el CSV de conversión. Solo usa códigos, títulos y estructura de serie; las rutas de tus discos se ignoran. No duplica ni sobrescribe contenido existente.</p>
    <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={(event) => void submit(event)}>
      <select className="admin-input rounded-lg border px-3 py-2 text-sm" defaultValue="" disabled={busy} name="sourceId" required><option disabled value="">Fuente de Drive</option>{sources.filter((source) => source.is_active).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
      <input accept=".csv,text/csv" className="admin-input rounded-lg border px-3 py-2 text-sm" disabled={busy} name="inventory" required type="file" />
      <button className="primary-button text-sm disabled:opacity-50" disabled={busy || !sources.some((source) => source.is_active)} type="submit">{busy ? "Importando y sincronizando…" : "Importar y sincronizar"}</button>
    </form>
    {message ? <p className={message.startsWith("Listo:") || message.startsWith("Catálogo") || message.startsWith("Vinculando") ? "mt-4 text-sm text-emerald-700" : "mt-4 text-sm text-rose-600"}>{message}</p> : null}
    {needsDrive ? <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><span>La autorización de Drive venció o fue revocada.</span><button className="secondary-button text-sm" disabled={busy} onClick={() => void reconnectDrive()} type="button">Reconectar Google Drive</button></div> : null}
  </section>;
}
