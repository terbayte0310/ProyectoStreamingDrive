import "server-only";

// Sondeo real de códec para los archivos que buildCodecInventory marcó como "a revisar"
// (contenedor distinto de la ruta segura MP4/H.264/AAC). Requiere ffmpeg/ffprobe instalado
// localmente; si no está disponible, se degrada explícitamente en vez de fallar el resto
// del panel. No escribe en Supabase ni en Drive: descarga solo el prefijo necesario a un
// temporal (no el archivo completo), lo analiza y lo borra.

import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ReviewCandidate } from "./codec-inventory.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_PROBE_LIMIT = 25;
// El códec real de video/audio se identifica leyendo los primeros paquetes del contenedor
// (PAT/PMT + primeros frames en .ts, headers tempranos en .mkv/.avi/.mov), no el archivo
// completo. Traer solo un prefijo evita descargar cientos de GB solo para confirmar códec.
// Excepción conocida: un .mov/.mp4 sin "faststart" con el índice al final puede fallar el
// sondeo con este prefijo; en ese caso queda como probeError, nunca rompe el resto del panel.
const PROBE_PREFIX_BYTES = 16 * 1024 * 1024;

export type ProbedCandidate = ReviewCandidate & {
  audioCodec: string | null;
  probeError: string | null;
  videoCodec: string | null;
};

export type CodecProbeResult = {
  ffprobeAvailable: boolean;
  probed: ProbedCandidate[];
  skippedCount: number;
};

let ffprobeAvailableCache: boolean | null = null;

export function isFfprobeAvailable(): boolean {
  if (ffprobeAvailableCache !== null) return ffprobeAvailableCache;
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    ffprobeAvailableCache = true;
  } catch {
    ffprobeAvailableCache = false;
  }
  return ffprobeAvailableCache;
}

type FfprobeStream = { codec_name?: string; codec_type?: string };
type FfprobeOutput = { streams?: FfprobeStream[] };

async function downloadProbePrefix(accessToken: string, driveFileId: string, directory: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      range: `bytes=0-${PROBE_PREFIX_BYTES - 1}`,
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Drive rechazó la descarga del archivo ${driveFileId}.`);
  }
  const filePath = join(directory, driveFileId);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer.subarray(0, PROBE_PREFIX_BYTES));
  return filePath;
}

async function probeFile(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    filePath,
  ]);
  const output = JSON.parse(stdout) as FfprobeOutput;
  const streams = output.streams ?? [];
  const videoCodec = streams.find((stream) => stream.codec_type === "video")?.codec_name ?? null;
  const audioCodec = streams.find((stream) => stream.codec_type === "audio")?.codec_name ?? null;
  return { audioCodec, videoCodec };
}

// Solo se llama sobre los candidatos ya filtrados por buildCodecInventory (contenedor no seguro),
// nunca sobre toda la biblioteca: son minoría y el límite evita descargar cientos de GB de una vez.
export async function probeReviewCandidates(
  accessToken: string,
  candidates: ReviewCandidate[],
  { limit = DEFAULT_PROBE_LIMIT }: { limit?: number } = {},
): Promise<CodecProbeResult> {
  if (!isFfprobeAvailable()) {
    return { ffprobeAvailable: false, probed: [], skippedCount: candidates.length };
  }

  const toProbe = candidates.slice(0, limit);
  const directory = await mkdtemp(join(tmpdir(), "drive-codec-probe-"));
  const probed: ProbedCandidate[] = [];

  try {
    for (const candidate of toProbe) {
      let filePath: string | null = null;
      try {
        filePath = await downloadProbePrefix(accessToken, candidate.driveFileId, directory);
        const { audioCodec, videoCodec } = await probeFile(filePath);
        probed.push({ ...candidate, audioCodec, probeError: null, videoCodec });
      } catch (error) {
        probed.push({
          ...candidate,
          audioCodec: null,
          probeError: error instanceof Error ? error.message : "No se pudo analizar el archivo.",
          videoCodec: null,
        });
      } finally {
        if (filePath) await rm(filePath, { force: true });
      }
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }

  return { ffprobeAvailable: true, probed, skippedCount: candidates.length - toProbe.length };
}
