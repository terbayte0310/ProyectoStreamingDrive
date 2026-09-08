// Agrupa las lecciones de un snapshot de Drive por contenedor (mimeType) para detectar,
// antes de una importación masiva, cuáles ya son la ruta segura para el navegador
// (MP4 con H.264/AAC, según ESTADO_Y_BACKLOG.md) y cuáles necesitan revisión de códec real.
// No escribe en Supabase ni en Drive: es un reporte efímero, igual que listLibrarySnapshotIssues.

import { buildSnapshotItemPath, type LibrarySnapshot, type LibrarySnapshotItem } from "./library-snapshot.ts";

const SAFE_MIME_TYPES = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
]);

export type ContainerGroup = {
  byteSize: number;
  durationMillis: number;
  lessonCount: number;
  mimeType: string;
};

export type ReviewCandidate = {
  byteSize: number | null;
  driveFileId: string;
  durationMillis: number | null;
  mimeType: string;
  name: string;
  path: string;
};

export type CodecInventory = {
  reviewCandidates: ReviewCandidate[];
  reviewContainers: ContainerGroup[];
  safeContainers: ContainerGroup[];
  totalReviewLessons: number;
  totalSafeLessons: number;
};

function isSafeContainer(mimeType: string) {
  return SAFE_MIME_TYPES.has(mimeType);
}

function groupByContainer(items: LibrarySnapshotItem[]): ContainerGroup[] {
  const groups = new Map<string, ContainerGroup>();
  for (const item of items) {
    const group = groups.get(item.mimeType) ?? { byteSize: 0, durationMillis: 0, lessonCount: 0, mimeType: item.mimeType };
    group.lessonCount += 1;
    group.byteSize += item.byteSize ?? 0;
    group.durationMillis += item.durationMillis ?? 0;
    groups.set(item.mimeType, group);
  }
  return [...groups.values()].sort((first, second) => second.byteSize - first.byteSize);
}

export function buildCodecInventory(snapshot: LibrarySnapshot): CodecInventory {
  const lessons = snapshot.items.filter((item) => item.kind === "lesson");
  const safeLessons = lessons.filter((item) => isSafeContainer(item.mimeType));
  const reviewLessons = lessons.filter((item) => !isSafeContainer(item.mimeType));

  return {
    reviewCandidates: reviewLessons.map((item) => ({
      byteSize: item.byteSize,
      driveFileId: item.driveFileId,
      durationMillis: item.durationMillis,
      mimeType: item.mimeType,
      name: item.name,
      path: buildSnapshotItemPath(snapshot, item),
    })),
    reviewContainers: groupByContainer(reviewLessons),
    safeContainers: groupByContainer(safeLessons),
    totalReviewLessons: reviewLessons.length,
    totalSafeLessons: safeLessons.length,
  };
}
