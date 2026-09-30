import { cacheProgress, readLocalProgress, type LocalProgress } from "./local-progress.ts";

type Row = { package_id: string; position_seconds: number; duration_seconds: number; watched_at: string };
const pendingReads = new Map<string, Promise<Map<string, LocalProgress>>>();

/** Batch reads shared by the episode list and its Continue button. */
export function loadMediaProgress(packageIds: string[], userId: string, timeoutMs = 5000) {
  const ids = [...new Set(packageIds)].sort();
  const key = `${userId}:${ids.join(",")}`;
  const pending = pendingReads.get(key);
  if (pending) return pending;
  const request = (async () => {
    const result = new Map<string, LocalProgress>();
    for (const id of ids) { const local = readLocalProgress(id, userId); if (local) result.set(id, local); }
    try {
      for (let offset = 0; offset < ids.length; offset += 200) {
        const response = await fetch("/api/media-progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "read", packageIds: ids.slice(offset, offset + 200), userId }), signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) continue;
        const { progress } = await response.json() as { progress: Row[] };
        for (const row of progress) {
          const remote = { at: Date.parse(row.watched_at), d: row.duration_seconds, t: row.position_seconds };
          const local = readLocalProgress(row.package_id, userId);
          const latest = local && local.at > remote.at ? local : remote;
          result.set(row.package_id, latest);
          cacheProgress(row.package_id, latest, userId);
        }
      }
    } catch { /* Resume from the account's local cache while offline. */ }
    return result;
  })();
  pendingReads.set(key, request);
  void request.finally(() => pendingReads.delete(key));
  return request;
}

/** Throttle writes and retry failures without an unbounded queue. */
export function createProgressSync(packageId: string, userId: string) {
  let lastAttempt = 0;
  let saved: LocalProgress | null = null;
  let inFlight = false;
  let queued: LocalProgress | null = null;
  const sync = async (progress: LocalProgress | null, force = false): Promise<void> => {
    if (!progress || (saved?.t === progress.t && saved.d === progress.d)) return;
    if (inFlight) { if (force && (!queued || progress.at > queued.at)) queued = progress; return; }
    if (!force && Date.now() - lastAttempt < 30_000) return;
    lastAttempt = Date.now();
    inFlight = true;
    try {
      const response = await fetch("/api/media-progress", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", packageId, userId, ...progress }) });
      if (response.ok) saved = progress;
    } catch { /* The next interval retries the local checkpoint. */ }
    finally {
      inFlight = false;
      const next = queued;
      queued = null;
      if (next) await sync(next, true);
    }
  };
  return sync;
}
