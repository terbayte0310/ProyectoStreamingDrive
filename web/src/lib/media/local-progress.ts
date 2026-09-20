// Progreso de Películas y Series por dispositivo. No existe tabla de progreso
// para medios, así que se guarda en localStorage: gratis, instantáneo y sin
// consultas extra. Los cursos siguen usando lesson_progress en Supabase.

export type LocalProgress = { at: number; d: number; t: number };

const prefix = "nb-progress:";

export function readLocalProgress(packageId: string): LocalProgress | null {
  try {
    const raw = localStorage.getItem(prefix + packageId);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LocalProgress>;
    if (typeof value.t !== "number" || typeof value.d !== "number" || typeof value.at !== "number") return null;
    return { at: value.at, d: value.d, t: value.t };
  } catch {
    return null;
  }
}

export function writeLocalProgress(packageId: string, seconds: number, duration: number) {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return;
  try {
    localStorage.setItem(prefix + packageId, JSON.stringify({ at: Date.now(), d: Math.round(duration), t: Math.round(seconds) }));
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
