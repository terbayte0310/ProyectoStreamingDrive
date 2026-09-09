"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncSummary = {
  categories: number;
  conflicts: number;
  courses: number;
  files: number;
  folders: number;
  ignored: number;
  lessons: number;
  missing?: number;
  new?: number;
  restored?: number;
  sections: number;
  unsupported: number;
  updated?: number;
};

type SyncResult = {
  error?: string;
  issues?: Array<{
    driveFileId: string;
    isFolder: boolean;
    kind: "conflict" | "ignored" | "unsupported";
    mimeType: string;
    name: string;
    path: string;
  }>;
  mode?: "preview" | "publish";
  pilotRootConfigured?: boolean;
  previewFingerprint?: string;
  rootChangeRequired?: boolean;
  runId?: string;
  summary?: SyncSummary;
};

const labels: Array<[keyof SyncSummary, string]> = [
  ["categories", "Categorías"],
  ["courses", "Cursos"],
  ["sections", "Secciones"],
  ["lessons", "Lecciones"],
  ["unsupported", "No compatibles"],
  ["conflicts", "Conflictos"],
  ["ignored", "Ignorados"],
];

const issueGroups = [
  { kind: "conflict" as const, label: "Conflictos estructurales" },
  { kind: "unsupported" as const, label: "Elementos auxiliares o no compatibles" },
  { kind: "ignored" as const, label: "Archivos ignorados" },
];

export function CatalogSyncPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);

  async function synchronize(mode: "preview" | "publish") {
    setBusy(mode);
    setError("");
    try {
      const response = await fetch("/api/drive-token/sync", {
        body: JSON.stringify({
          confirmRootChange: mode === "publish" && result?.rootChangeRequired === true,
          mode,
          previewFingerprint: mode === "publish" ? result?.previewFingerprint : undefined,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as SyncResult;
      if (!response.ok || data.error) throw new Error(data.error ?? "La sincronización fue rechazada.");
      setResult(data);
      setConfirmed(false);
      if (mode === "publish") router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo sincronizar.");
    } finally {
      setBusy(null);
    }
  }

  const previewReady = result?.mode === "preview" && Boolean(result.summary);
  const publishingBlocked = result?.pilotRootConfigured === true && result.rootChangeRequired !== true;

  return (
    <section className="admin-panel admin-reveal mt-8 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Sincronización de Drive</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Previsualizar recorre Drive sin modificar el catálogo. Publicar aplica exactamente el último snapshot de forma atómica.
          </p>
        </div>
        <button
          className="rounded-xl border border-sky-400/50 px-4 py-2 text-sm font-semibold text-sky-100 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void synchronize("preview")}
          type="button"
        >
          {busy === "preview" ? "Escaneando…" : "Previsualizar"}
        </button>
      </div>

      {error ? <p className="mt-4 rounded-xl border border-rose-400/40 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p> : null}

      {previewReady && result.summary ? (
        <div className="mt-5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {labels.map(([key, label]) => (
              <div className="rounded-xl bg-slate-950 p-3" key={key}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-1 text-xl font-semibold">{result.summary?.[key] ?? 0}</p>
              </div>
            ))}
          </div>

          {result.issues?.length ? (
            <div className="mt-4 space-y-2">
              {issueGroups.map(({ kind, label }) => {
                const issues = result.issues?.filter((issue) => issue.kind === kind) ?? [];
                if (!issues.length) return null;
                return (
                  <details className="rounded-xl border border-slate-700 bg-slate-950" key={kind} open={kind === "conflict"}>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200">
                      {label} ({issues.length})
                    </summary>
                    <ul className="max-h-96 space-y-2 overflow-y-auto border-t border-slate-800 p-3">
                      {issues.map((issue) => (
                        <li className="rounded-lg bg-slate-900 p-3" key={issue.driveFileId}>
                          <p className="text-sm font-medium text-slate-100">{issue.name}</p>
                          <p className="mt-1 break-all text-xs text-slate-400">{issue.path}</p>
                          <p className="mt-1 break-all text-xs text-slate-500">
                            {issue.isFolder ? "Carpeta auxiliar" : issue.mimeType}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          ) : null}

          {publishingBlocked ? (
            <p className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
              Publicación bloqueada: la variable local todavía apunta a la carpeta piloto AWS. Configura primero la raíz 100_BIBLIOTECA_DE_CURSOS.
            </p>
          ) : (
            <div className="mt-5 flex flex-col gap-3">
              {result.rootChangeRequired ? (
                <p className="text-sm text-amber-200">La publicación promoverá la fuente piloto a la raíz completa sin cambiar su identidad.</p>
              ) : null}
              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input checked={confirmed} className="mt-1" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
                Revisé los contadores y los archivos señalados; autorizo publicar este snapshot en el catálogo.
              </label>
              <button
                className="w-fit rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 disabled:opacity-40"
                disabled={!confirmed || busy !== null}
                onClick={() => void synchronize("publish")}
                type="button"
              >
                {busy === "publish" ? "Publicando…" : "Publicar sincronización"}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {result?.mode === "publish" ? (
        <p className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          Sincronización publicada correctamente. Ejecución: {result.runId}
        </p>
      ) : null}
    </section>
  );
}
