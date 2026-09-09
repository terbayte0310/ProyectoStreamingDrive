"use client";

import { useState } from "react";

type ContainerGroup = {
  byteSize: number;
  durationMillis: number;
  lessonCount: number;
  mimeType: string;
};

type ProbedCandidate = {
  audioCodec: string | null;
  byteSize: number | null;
  driveFileId: string;
  mimeType: string;
  name: string;
  path: string;
  probeError: string | null;
  videoCodec: string | null;
};

type CodecInventoryResult = {
  error?: string;
  inventory?: {
    reviewCandidates: Array<{ byteSize: number | null; driveFileId: string; mimeType: string; name: string; path: string }>;
    reviewContainers: ContainerGroup[];
    safeContainers: ContainerGroup[];
    totalReviewLessons: number;
    totalSafeLessons: number;
  };
  probe?: { ffprobeAvailable: boolean; probed: ProbedCandidate[]; skippedCount: number } | null;
};

function gb(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(2);
}

function isRiskyCodec(codec: string | null) {
  return codec !== null && codec !== "h264" && codec !== "aac";
}

export function CodecInventoryPanel() {
  const [busy, setBusy] = useState<"probe" | "scan" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CodecInventoryResult | null>(null);

  async function analyze(probeCodecs: boolean) {
    setBusy(probeCodecs ? "probe" : "scan");
    setError("");
    try {
      const response = await fetch("/api/drive-token/sync", {
        body: JSON.stringify({ mode: "codec-inventory", probeCodecs }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as CodecInventoryResult;
      if (!response.ok || data.error) throw new Error(data.error ?? "No se pudo analizar la biblioteca.");
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo analizar la biblioteca.");
    } finally {
      setBusy(null);
    }
  }

  const inventory = result?.inventory;
  const probe = result?.probe;

  return (
    <section className="admin-panel admin-reveal mt-8 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Códecs y tamaños</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Solo lectura de Drive: agrupa las lecciones por contenedor antes de una importación masiva y, si pides el
            sondeo, confirma el códec real de los contenedores que no son MP4/H.264/AAC.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-xl border border-sky-400/50 px-4 py-2 text-sm font-semibold text-sky-100 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void analyze(false)}
            type="button"
          >
            {busy === "scan" ? "Escaneando…" : "Analizar tamaños"}
          </button>
          <button
            className="rounded-xl border border-amber-400/50 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void analyze(true)}
            type="button"
          >
            {busy === "probe" ? "Sondeando…" : "Sondear códecs a revisar"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-xl border border-rose-400/40 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p> : null}

      {inventory ? (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase">Contenedores seguros (MP4/AAC ya validados)</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {inventory.safeContainers.map((group) => (
                <div className="rounded-xl bg-slate-950 p-3" key={group.mimeType}>
                  <p className="text-xs text-slate-400">{group.mimeType}</p>
                  <p className="mt-1 text-lg font-semibold">{group.lessonCount} lecciones</p>
                  <p className="text-xs text-slate-500">{gb(group.byteSize)} GB</p>
                </div>
              ))}
              {inventory.safeContainers.length === 0 ? <p className="text-sm text-slate-500">Ninguna todavía.</p> : null}
            </div>
          </div>

          {inventory.totalReviewLessons > 0 ? (
            <div>
              <p className="text-xs font-semibold text-amber-300 uppercase">
                Contenedores a revisar ({inventory.totalReviewLessons})
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {inventory.reviewContainers.map((group) => (
                  <div className="rounded-xl border border-amber-400/30 bg-slate-950 p-3" key={group.mimeType}>
                    <p className="text-xs text-slate-400">{group.mimeType}</p>
                    <p className="mt-1 text-lg font-semibold">{group.lessonCount} lecciones</p>
                    <p className="text-xs text-slate-500">{gb(group.byteSize)} GB</p>
                  </div>
                ))}
              </div>

              {probe ? (
                probe.ffprobeAvailable ? (
                  <ul className="mt-3 space-y-2">
                    {probe.probed.map((candidate) => (
                      <li className="rounded-lg bg-slate-950 p-3" key={candidate.driveFileId}>
                        <p className="text-sm font-medium text-slate-100">{candidate.name}</p>
                        <p className="mt-1 break-all text-xs text-slate-400">{candidate.path}</p>
                        {candidate.probeError ? (
                          <p className="mt-1 text-xs text-rose-300">No se pudo analizar: {candidate.probeError}</p>
                        ) : (
                          <p className="mt-1 text-xs">
                            <span className={isRiskyCodec(candidate.videoCodec) ? "text-amber-300" : "text-emerald-300"}>
                              video: {candidate.videoCodec ?? "desconocido"}
                            </span>
                            {" · "}
                            <span className={isRiskyCodec(candidate.audioCodec) ? "text-amber-300" : "text-emerald-300"}>
                              audio: {candidate.audioCodec ?? "desconocido"}
                            </span>
                          </p>
                        )}
                      </li>
                    ))}
                    {probe.skippedCount > 0 ? (
                      <p className="text-xs text-slate-500">
                        {probe.skippedCount} archivo(s) más no se sondearon en esta ejecución.
                      </p>
                    ) : null}
                  </ul>
                ) : (
                  <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
                    ffprobe no está instalado localmente (o no está en el PATH). Instala ffmpeg para confirmar el
                    códec real; mientras tanto solo se muestran los contenedores sospechosos por tipo.
                  </p>
                )
              ) : (
                <ul className="mt-3 space-y-1">
                  {inventory.reviewCandidates.map((candidate) => (
                    <li className="break-all text-xs text-slate-400" key={candidate.driveFileId}>
                      {candidate.path} — {candidate.mimeType}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-emerald-300">Ninguna lección usa un contenedor fuera de la ruta segura MP4.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
