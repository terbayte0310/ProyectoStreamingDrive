// Caché y respaldo por cuenta; Supabase sincroniza Películas y Series.

export type LocalProgress = { at: number; d: number; t: number };

const prefix = "nb-progress:";

export function readLocalProgress(packageId: string, userId?: string): LocalProgress | null {
  try {
    const key = prefix + (userId ? `${userId}:` : "") + packageId;
    let raw = localStorage.getItem(key);
    // Adopt the former device-only checkpoint once, for the signed-in account.
    if (!raw && userId) {
      raw = localStorage.getItem(prefix + packageId);
      if (raw) { localStorage.setItem(key, raw); localStorage.removeItem(prefix + packageId); }
    }
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LocalProgress>;
    if (typeof value.t !== "number" || typeof value.d !== "number" || typeof value.at !== "number"
      || !Number.isFinite(value.t) || !Number.isFinite(value.d) || !Number.isFinite(value.at)
      || value.t < 0 || value.d <= 0 || value.t > value.d || value.at <= 0) return null;
    return { at: value.at, d: value.d, t: value.t };
  } catch {
    return null;
  }
}

export function cacheProgress(packageId: string, progress: LocalProgress, userId?: string) {
  try { localStorage.setItem(prefix + (userId ? `${userId}:` : "") + packageId, JSON.stringify(progress)); } catch { /* Storage is optional. */ }
}

export function writeLocalProgress(packageId: string, seconds: number, duration: number, userId?: string) {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return;
  try {
    cacheProgress(packageId, { at: Date.now(), d: Math.round(duration), t: Math.min(Math.round(duration), Math.round(seconds)) }, userId);
  } catch {
    // Sin almacenamiento el reproductor funciona igual; solo no recuerda la posición.
  }
}

export function progressRatio(progress: LocalProgress | null) {
  return progress && progress.d > 0 ? Math.min(1, progress.t / progress.d) : 0;
}

/** Terminado si quedan menos de 3 % o 90 s: los créditos no cuentan. */
export function isFinished(progress: LocalProgress | null) {
  return Boolean(progress && progress.d > 0 && (progress.t >= progress.d * 0.97 || progress.d - progress.t < 90));
}

export function resumePoint(progress: LocalProgress | null) {
  if (!progress || isFinished(progress) || progress.t < 15) return 0;
  return Math.max(0, progress.t - 3);
}
