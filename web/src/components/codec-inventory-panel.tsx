"use client";

import { type CSSProperties, useState } from "react";

import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";

type ContainerGroup = { byteSize: number; durationMillis: number; lessonCount: number; mimeType: string };
type ProbedCandidate = { audioCodec: string | null; byteSize: number | null; driveFileId: string; mimeType: string; name: string; path: string; probeError: string | null; videoCodec: string | null };
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

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);
const isRiskyCodec = (codec: string | null) => codec !== null && codec !== "h264" && codec !== "aac";

function Group({ group, warn }: { group: ContainerGroup; warn?: boolean }) {
  return (
    <div className="counter" style={warn ? { boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--gold) 40%, transparent)" } : undefined}>
      <span className="mono">{group.mimeType}</span>
      <strong>{group.lessonCount}</strong>
      <span>{gb(group.byteSize)} GB</span>
    </div>
  );
}

export function CodecInventoryPanel() {
  const [busy, setBusy] = useState<"probe" | "scan" | null>(null);
  const [result, setResult] = useState<CodecInventoryResult | null>(null);

  async function analyze(probeCodecs: boolean) {
    setBusy(probeCodecs ? "probe" : "scan");
    try {
      const response = await fetch("/api/drive-token/sync", { body: JSON.stringify({ mode: "codec-inventory", probeCodecs }), headers: { "content-type": "application/json" }, method: "POST" });
      const data = (await response.json()) as CodecInventoryResult;
      if (!response.ok || data.error) throw new Error(data.error ?? "No se pudo analizar la biblioteca.");
      setResult(data);
      toast("Análisis completado.", "success");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "No se pudo analizar la biblioteca.", "error");
    } finally {
      setBusy(null);
    }
  }

  const inventory = result?.inventory;
  const probe = result?.probe;

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <div>
          <p className="kicker">Diagnóstico</p>
          <h2 className="title-m">Códecs y tamaños</h2>
          <p>Solo lectura. Agrupa las lecciones por contenedor y, con el sondeo, confirma el códec real de lo que no es MP4/H.264/AAC.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void analyze(false)} type="button"><Icon name="grid" />{busy === "scan" ? "Escaneando…" : "Analizar tamaños"}</button>
          <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void analyze(true)} type="button"><Icon name="search" />{busy === "probe" ? "Sondeando…" : "Sondear códecs"}</button>
        </div>
      </div>

      {busy ? <div className="progress-block"><div className="progress-meta"><span>Leyendo Drive…</span><span className="orbit-loader" style={{ "--size": "22px" } as CSSProperties}><span /></span></div></div> : null}

      {inventory ? (
        <div style={{ display: "grid", gap: 18 }}>
          <div>
            <p className="kicker kicker-plain" style={{ marginBottom: 8 }}>Contenedores seguros · {inventory.totalSafeLessons}</p>
            <div className="counter-grid">{inventory.safeContainers.map((group) => <Group group={group} key={group.mimeType} />)}</div>
          </div>
          {inventory.totalReviewLessons > 0 ? (
            <div>
              <p className="kicker kicker-plain" style={{ color: "var(--gold)", marginBottom: 8 }}>A revisar · {inventory.totalReviewLessons}</p>
              <div className="counter-grid">{inventory.reviewContainers.map((group) => <Group group={group} key={group.mimeType} warn />)}</div>
              {probe ? (
                probe.ffprobeAvailable ? (
                  <ul className="probe-list">
                    {probe.probed.map((candidate) => (
                      <li key={candidate.driveFileId}>
                        <strong>{candidate.name}</strong>
                        <small>{candidate.path}</small>
                        {candidate.probeError ? <small style={{ color: "var(--rose)" }}>No se pudo analizar: {candidate.probeError}</small> : (
                          <small>
                            <span style={{ color: isRiskyCodec(candidate.videoCodec) ? "var(--gold)" : "var(--mint)" }}>vídeo: {candidate.videoCodec ?? "desconocido"}</span>{" · "}
                            <span style={{ color: isRiskyCodec(candidate.audioCodec) ? "var(--gold)" : "var(--mint)" }}>audio: {candidate.audioCodec ?? "desconocido"}</span>
                          </small>
                        )}
                      </li>
                    ))}
                    {probe.skippedCount > 0 ? <li className="subtle">{probe.skippedCount} archivo(s) más no se sondearon en esta ejecución.</li> : null}
                  </ul>
                ) : <div className="notice notice-warn" style={{ marginTop: 12 }}><span className="notice-icon"><Icon name="warning" /></span><div>ffprobe no está en el PATH. Instala ffmpeg para confirmar el códec real.</div></div>
              ) : (
                <ul className="probe-list">{inventory.reviewCandidates.map((candidate) => <li key={candidate.driveFileId}><small>{candidate.path} — {candidate.mimeType}</small></li>)}</ul>
              )}
            </div>
          ) : <div className="notice notice-ok"><span className="notice-icon"><Icon name="check" /></span><div>Ninguna lección usa un contenedor fuera de la ruta segura MP4.</div></div>}
        </div>
      ) : null}
    </section>
  );
}
