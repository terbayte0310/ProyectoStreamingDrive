import "node:process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const MOVIE_CODE = /^MOV-[0-9]{5,}$/;
const EPISODE_CODE = /^SER-[0-9]{5,}-S[0-9]{2}-E[0-9]{2,3}$/;
const SERIES_CODE = /^SER-[0-9]{5,}$/;
const DEFAULT_CONCURRENCY = 4;
const UPSERT_BATCH_SIZE = 750;
const MAX_RETRIES = 5;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArgument(name) {
  return process.argv.includes(name);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

const options = {
  code: argument("--code"),
  concurrency: Math.min(8, positiveInteger(argument("--concurrency"), DEFAULT_CONCURRENCY)),
  dryRun: hasArgument("--dry-run"),
  limit: positiveInteger(argument("--limit"), Number.MAX_SAFE_INTEGER),
  rescan: hasArgument("--rescan"),
};

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable privada ${name}. Revisa .env.local.`);
  return value;
}

function timestamp() {
  return new Date().toISOString();
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function errorStatus(error) {
  const candidate = /** @type {{ code?: unknown; response?: { status?: unknown } }} */ (error);
  const status = candidate.code ?? candidate.response?.status;
  return typeof status === "number" ? status : undefined;
}

async function withRetry(label, operation) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = errorStatus(error);
      const retryable = status === 403 || status === 408 || status === 429 || (status !== undefined && status >= 500);
      if (!retryable || attempt === MAX_RETRIES - 1) throw error;
      const delay = Math.min(30_000, 800 * 2 ** attempt) + Math.floor(Math.random() * 400);
      console.warn(`${timestamp()}  ${label}: Drive respondió ${status}; reintento ${attempt + 1}/${MAX_RETRIES - 1} en ${Math.ceil(delay / 1000)} s.`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function classify(relativePath, mimeType) {
  const lower = relativePath.toLowerCase();
  if (lower === "master.m3u8") return "master_playlist";
  if (lower.endsWith(".m3u8")) return "media_playlist";
  if (lower.endsWith(".vtt")) return "subtitle";
  if (lower.endsWith(".aac") || lower.endsWith(".m4a")) return "audio";
  if (lower.endsWith(".key")) return "key";
  if (lower.endsWith(".ts") || lower.endsWith(".m4s") || mimeType.startsWith("video/")) return "segment";
  return "other";
}

function languageFor(relativePath) {
  const match = /^(?:audio|subtitles)\/([^/]+)\//i.exec(relativePath);
  if (!match) return null;
  const language = match[1];
  return /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language) ? language : null;
}

function displayError(error) {
  return error instanceof Error ? error.message.slice(0, 500) : "Error desconocido.";
}

async function createDriveClient() {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (serviceAccountPath) {
    const auth = new google.auth.GoogleAuth({ keyFile: serviceAccountPath, scopes: [DRIVE_SCOPE] });
    return google.drive({ version: "v3", auth });
  }

  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();
  if (refreshToken) {
    const client = new google.auth.OAuth2(
      required("GOOGLE_DRIVE_CLIENT_ID"),
      required("GOOGLE_DRIVE_CLIENT_SECRET"),
    );
    client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: "v3", auth: client });
  }

  throw new Error("Configura GOOGLE_APPLICATION_CREDENTIALS (recomendado) o GOOGLE_DRIVE_REFRESH_TOKEN. El migrador no usa cookies del navegador.");
}

async function listChildren(drive, parentId) {
  /** @type {Array<{id: string, name: string, mimeType: string, size?: string}>} */
  const files = [];
  let pageToken;
  do {
    const page = await withRetry(`Listando ${parentId}`, async () => {
      const response = await drive.files.list({
        fields: "nextPageToken,files(id,name,mimeType,size)",
        includeItemsFromAllDrives: true,
        orderBy: "folder,name_natural",
        pageSize: 1000,
        pageToken,
        q: `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`,
        supportsAllDrives: true,
      });
      return response.data;
    });
    files.push(...(page.files ?? []).filter((file) => file.id && file.name && file.mimeType).map((file) => ({
      id: file.id,
      mimeType: file.mimeType,
      name: file.name,
      size: file.size ?? undefined,
    })));
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

async function playlistBody(drive, fileId, relativePath) {
  const response = await withRetry(`Leyendo ${relativePath}`, () => drive.files.get(
    { alt: "media", fileId, supportsAllDrives: true },
    { responseType: "text" },
  ));
  const body = typeof response.data === "string" ? response.data : String(response.data ?? "");
  if (!body.startsWith("#EXTM3U")) throw new Error(`${relativePath} no es una lista HLS válida.`);
  return body;
}

async function scanPackage(drive, packageFolderId) {
  /** @type {Array<{asset_kind: string, byte_size: number | null, content_type: string | null, drive_file_id: string, language_code: string | null, playlist_body: string | null, relative_path: string}>} */
  const assets = [];
  const pending = [{ folderId: packageFolderId, path: "" }];
  while (pending.length) {
    const current = pending.pop();
    const children = await listChildren(drive, current.folderId);
    for (const child of children) {
      const relativePath = current.path ? `${current.path}/${child.name}` : child.name;
      if (child.mimeType === FOLDER_MIME_TYPE) {
        pending.push({ folderId: child.id, path: relativePath });
        continue;
      }
      const assetKind = classify(relativePath, child.mimeType);
      assets.push({
        asset_kind: assetKind,
        byte_size: child.size ? Number(child.size) : null,
        content_type: child.mimeType || null,
        drive_file_id: child.id,
        language_code: languageFor(relativePath),
        playlist_body: assetKind === "master_playlist" || assetKind === "media_playlist" ? await playlistBody(drive, child.id, relativePath) : null,
        relative_path: relativePath,
      });
    }
  }
  const masters = assets.filter((asset) => asset.relative_path === "master.m3u8");
  if (masters.length !== 1) throw new Error("El paquete debe contener exactamente un master.m3u8 en su raíz.");
  if (!assets.some((asset) => asset.asset_kind === "media_playlist")) throw new Error("El paquete no contiene listas HLS de vídeo o audio.");
  return assets;
}

async function discoverPackages(drive, rootFolderId) {
  /** @type {Array<{driveRootFolderId: string, internalCode: string}>} */
  const packages = [];
  for (const node of await listChildren(drive, rootFolderId)) {
    if (node.mimeType !== FOLDER_MIME_TYPE) continue;
    if (MOVIE_CODE.test(node.name) || EPISODE_CODE.test(node.name)) {
      packages.push({ driveRootFolderId: node.id, internalCode: node.name });
      continue;
    }
    if (!SERIES_CODE.test(node.name)) continue;
    for (const episode of await listChildren(drive, node.id)) {
      if (episode.mimeType === FOLDER_MIME_TYPE && EPISODE_CODE.test(episode.name)) {
        packages.push({ driveRootFolderId: episode.id, internalCode: episode.name });
      }
    }
  }
  return packages.sort((first, second) => first.internalCode.localeCompare(second.internalCode, undefined, { numeric: true }));
}

async function inParallel(items, concurrency, operation) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      await operation(items[current], current);
    }
  }));
}

async function main() {
  const rootFolderId = required("HLS_DRIVE_ROOT_FOLDER_ID");
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();`n  if (!supabaseSecretKey) throw new Error("Falta SUPABASE_SECRET_KEY (preferida) o SUPABASE_SERVICE_ROLE_KEY en .env.local.");`n  const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), supabaseSecretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const drive = await createDriveClient();
  const outputDirectory = resolve(process.cwd(), "scripts/output");
  const mapReportPath = resolve(process.cwd(), process.env.HLS_MIGRATION_MAP_PATH?.trim() || "scripts/output/hls-drive-map.jsonl");
  const summaryPath = resolve(process.cwd(), "scripts/output/hls-migration-last-run.json");
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(dirname(mapReportPath), { recursive: true });

  const [sourceResult, moviesResult, episodesResult, packageResult] = await Promise.all([
    supabase.from("media_drive_sources").select("id").eq("drive_root_folder_id", rootFolderId).eq("is_active", true).maybeSingle(),
    supabase.from("movies").select("id, internal_code"),
    supabase.from("series_episodes").select("id, internal_code"),
    supabase.from("media_hls_packages").select("id, movie_id, episode_id, drive_root_folder_id, status"),
  ]);
  if (sourceResult.error || !sourceResult.data) throw new Error("No existe una fuente activa de medios con HLS_DRIVE_ROOT_FOLDER_ID.");
  if (moviesResult.error || episodesResult.error || packageResult.error) throw new Error("No se pudo leer el catálogo de Supabase.");

  const contentByCode = new Map();
  for (const movie of moviesResult.data ?? []) contentByCode.set(movie.internal_code, { id: movie.id, kind: "movie" });
  for (const episode of episodesResult.data ?? []) contentByCode.set(episode.internal_code, { id: episode.id, kind: "episode" });
  const existingByContent = new Map();
  for (const packageRow of packageResult.data ?? []) {
    if (packageRow.movie_id) existingByContent.set(`movie:${packageRow.movie_id}`, packageRow);
    if (packageRow.episode_id) existingByContent.set(`episode:${packageRow.episode_id}`, packageRow);
  }

  console.log(`${timestamp()}  Descubriendo paquetes HLS en Drive…`);
  const allDiscovered = await discoverPackages(drive, rootFolderId);
  const discovered = options.code ? allDiscovered.filter((item) => item.internalCode === options.code) : allDiscovered;
  if (options.code && !discovered.length) throw new Error(`No se encontró ${options.code} dentro de la fuente de Drive.`);

  const unmatched = discovered.filter((item) => !contentByCode.has(item.internalCode));
  const candidates = discovered.filter((item) => {
    const content = contentByCode.get(item.internalCode);
    if (!content) return false;
    const existing = existingByContent.get(`${content.kind}:${content.id}`);
    return options.rescan || !(existing?.status === "ready" && existing.drive_root_folder_id === item.driveRootFolderId);
  }).slice(0, options.limit);

  const summary = {
    completed: [],
    discovered: discovered.length,
    dryRun: options.dryRun,
    failed: [],
    finishedAt: null,
    skippedReady: discovered.length - unmatched.length - candidates.length,
    startedAt: timestamp(),
    unmatchedCodes: unmatched.map((item) => item.internalCode),
  };
  console.log(`${timestamp()}  Encontrados ${discovered.length} paquetes; ${candidates.length} pendientes; ${summary.skippedReady} ya listos; ${unmatched.length} sin contenido en el catálogo.`);
  if (options.dryRun || !candidates.length) {
    summary.finishedAt = timestamp();
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  await inParallel(candidates, options.concurrency, async (folder, index) => {
    const label = `[${index + 1}/${candidates.length}] ${folder.internalCode}`;
    try {
      console.log(`${timestamp()}  ${label}: indexando…`);
      const assets = await scanPackage(drive, folder.driveRootFolderId);
      const content = contentByCode.get(folder.internalCode);
      const relationColumn = content.kind === "movie" ? "movie_id" : "episode_id";
      const relation = { [relationColumn]: content.id };
      const existing = existingByContent.get(`${content.kind}:${content.id}`);
      const packageWrite = existing
        ? await supabase.from("media_hls_packages").update({ drive_root_folder_id: folder.driveRootFolderId, last_error: null, source_id: sourceResult.data.id, status: "draft" }).eq("id", existing.id).select("id").single()
        : await supabase.from("media_hls_packages").insert({ ...relation, drive_root_folder_id: folder.driveRootFolderId, source_id: sourceResult.data.id, status: "draft" }).select("id").single();
      if (packageWrite.error || !packageWrite.data) throw new Error(packageWrite.error?.message || "No se pudo guardar el paquete HLS.");
      const packageId = packageWrite.data.id;
      for (let start = 0; start < assets.length; start += UPSERT_BATCH_SIZE) {
        const rows = assets.slice(start, start + UPSERT_BATCH_SIZE).map((asset) => ({ ...asset, is_active: true, package_id: packageId }));
        const write = await supabase.from("media_hls_assets").upsert(rows, { onConflict: "package_id,relative_path" });
        if (write.error) throw new Error(`No se pudo guardar un bloque de archivos: ${write.error.message}`);
      }
      const master = await supabase.from("media_hls_assets").select("id").eq("package_id", packageId).eq("relative_path", "master.m3u8").eq("is_active", true).maybeSingle();
      if (master.error || !master.data) throw new Error("No se pudo registrar master.m3u8.");
      const ready = await supabase.from("media_hls_packages").update({ last_error: null, manifest_asset_id: master.data.id, scanned_at: timestamp(), status: "ready" }).eq("id", packageId);
      if (ready.error) throw new Error(`No se pudo activar el paquete HLS: ${ready.error.message}`);
      existingByContent.set(`${content.kind}:${content.id}`, { drive_root_folder_id: folder.driveRootFolderId, id: packageId, status: "ready" });
      const map = Object.fromEntries(assets.map((asset) => [asset.relative_path, asset.drive_file_id]));
      await appendFile(mapReportPath, `${JSON.stringify({ assets: map, code: folder.internalCode, driveRootFolderId: folder.driveRootFolderId, migratedAt: timestamp() })}\n`);
      summary.completed.push({ assets: assets.length, code: folder.internalCode });
      console.log(`${timestamp()}  ${label}: listo (${assets.length} archivos).`);
    } catch (error) {
      const message = displayError(error);
      summary.failed.push({ code: folder.internalCode, error: message });
      console.error(`${timestamp()}  ${label}: ERROR — ${message}`);
    } finally {
      summary.finishedAt = timestamp();
      await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    }
  });

  console.log(`${timestamp()}  Terminado: ${summary.completed.length} listos, ${summary.failed.length} con error, ${summary.skippedReady} ya estaban listos.`);
  if (summary.failed.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`${timestamp()}  MIGRACIÓN DETENIDA — ${displayError(error)}`);
  process.exitCode = 1;
});