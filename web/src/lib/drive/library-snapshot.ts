import { normalizeDetectedTitle } from "./title-normalization.ts";

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const ignoredNames = new Set(["desktop.ini", ".ds_store", "thumbs.db"]);
const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export type DriveFile = {
  id: string;
  mimeType: string;
  modifiedTime?: string;
  name: string;
  size?: string;
  videoMediaMetadata?: {
    durationMillis?: string;
    height?: number;
    width?: number;
  };
};

type DriveListResponse = {
  files?: DriveFile[];
  nextPageToken?: string;
};

export type SnapshotKind =
  | "category"
  | "conflict"
  | "course"
  | "ignored"
  | "lesson"
  | "root"
  | "section"
  | "unsupported";

export type LibrarySnapshotItem = {
  byteSize: number | null;
  categoryDriveFileId: string | null;
  courseDriveFileId: string | null;
  detectedPosition: number;
  detectedTitle: string;
  driveFileId: string;
  durationMillis: number | null;
  isFolder: boolean;
  kind: SnapshotKind;
  mimeType: string;
  modifiedAt: string | null;
  name: string;
  parentDriveFileId: string | null;
  parentSectionDriveFileId: string | null;
  status: "available" | "ignored" | "unsupported";
  videoHeight: number | null;
  videoWidth: number | null;
};

export type LibrarySnapshot = {
  counters: {
    categories: number;
    conflicts: number;
    courses: number;
    files: number;
    folders: number;
    ignored: number;
    lessons: number;
    sections: number;
    unsupported: number;
  };
  items: LibrarySnapshotItem[];
  rootFolderId: string;
};

export type LibrarySnapshotIssue = {
  driveFileId: string;
  isFolder: boolean;
  kind: "conflict" | "ignored" | "unsupported";
  mimeType: string;
  name: string;
  path: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ListChildren = (parentId: string) => Promise<DriveFile[]>;

export class DriveApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function sortNaturally(files: DriveFile[]) {
  return [...files].sort((first, second) => naturalOrder.compare(first.name, second.name));
}

export function isIgnoredDriveFile(file: DriveFile) {
  return ignoredNames.has(file.name.toLowerCase()) || file.name.startsWith(".");
}

export function isPlayableDriveFile(file: DriveFile) {
  return file.mimeType.startsWith("video/") || file.mimeType.startsWith("audio/");
}

export async function listDriveChildren(
  accessToken: string,
  parentId: string,
  fetchRequest: FetchLike = fetch,
) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,videoMediaMetadata(durationMillis,width,height))",
      orderBy: "folder,name_natural",
      pageSize: "1000",
      q: `'${parentId}' in parents and trashed = false`,
    });
    if (pageToken) query.set("pageToken", pageToken);

    const response = await fetchRequest(`https://www.googleapis.com/drive/v3/files?${query}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new DriveApiError(`Drive rechazó la lectura de la carpeta ${parentId}.`, response.status);

    const data = (await response.json()) as DriveListResponse;
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return sortNaturally(files);
}

export function createSnapshotItem({
  categoryDriveFileId,
  courseDriveFileId,
  file,
  kind,
  parentDriveFileId,
  parentSectionDriveFileId,
  position,
}: {
  categoryDriveFileId: string | null;
  courseDriveFileId: string | null;
  file: DriveFile;
  kind: SnapshotKind;
  parentDriveFileId: string | null;
  parentSectionDriveFileId: string | null;
  position: number;
}): LibrarySnapshotItem {
  const isFolder = file.mimeType === FOLDER_MIME_TYPE;
  return {
    byteSize: file.size ? Number(file.size) : null,
    categoryDriveFileId,
    courseDriveFileId,
    detectedPosition: position,
    detectedTitle: normalizeDetectedTitle(file.name, isFolder),
    driveFileId: file.id,
    durationMillis: file.videoMediaMetadata?.durationMillis ? Number(file.videoMediaMetadata.durationMillis) : null,
    isFolder,
    kind,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedTime ?? null,
    name: file.name,
    parentDriveFileId,
    parentSectionDriveFileId,
    status: kind === "ignored" ? "ignored" : kind === "unsupported" || kind === "conflict" ? "unsupported" : "available",
    videoHeight: file.videoMediaMetadata?.height ?? null,
    videoWidth: file.videoMediaMetadata?.width ?? null,
  };
}

function demoteAuxiliarySections(items: LibrarySnapshotItem[]) {
  const itemsById = new Map(items.map((item) => [item.driveFileId, item]));
  const teachingSectionIds = new Set<string>();

  for (const lesson of items.filter((item) => item.kind === "lesson")) {
    let ancestorId = lesson.parentDriveFileId;
    const visited = new Set<string>();
    while (ancestorId && !visited.has(ancestorId)) {
      visited.add(ancestorId);
      const ancestor = itemsById.get(ancestorId);
      if (!ancestor) break;
      if (ancestor.kind === "section") teachingSectionIds.add(ancestor.driveFileId);
      ancestorId = ancestor.parentDriveFileId;
    }
  }

  for (const item of items) {
    if (item.kind === "section" && !teachingSectionIds.has(item.driveFileId)) {
      item.kind = "unsupported";
      item.parentSectionDriveFileId = null;
      item.status = "unsupported";
    }
  }

  for (const item of items) {
    if (
      item.parentSectionDriveFileId &&
      itemsById.get(item.parentSectionDriveFileId)?.kind !== "section"
    ) {
      item.parentSectionDriveFileId = null;
    }
  }
}

export async function scanDriveLibrary({
  listChildren,
  rootFolderId,
  rootName = "100_BIBLIOTECA_DE_CURSOS",
}: {
  listChildren: ListChildren;
  rootFolderId: string;
  rootName?: string;
}): Promise<LibrarySnapshot> {
  const items: LibrarySnapshotItem[] = [];
  const visitedFolders = new Set<string>();

  function append(
    file: DriveFile,
    kind: SnapshotKind,
    position: number,
    parentDriveFileId: string | null,
    categoryDriveFileId: string | null,
    courseDriveFileId: string | null,
    parentSectionDriveFileId: string | null,
  ) {
    items.push(createSnapshotItem({
      categoryDriveFileId,
      courseDriveFileId,
      file,
      kind,
      parentDriveFileId,
      parentSectionDriveFileId,
      position,
    }));
  }

  async function readFolder(folderId: string) {
    if (visitedFolders.has(folderId)) {
      throw new Error(`Drive devolvió una carpeta repetida o cíclica: ${folderId}.`);
    }
    visitedFolders.add(folderId);
    return sortNaturally(await listChildren(folderId));
  }

  async function scanCourseFolder(
    folderId: string,
    categoryDriveFileId: string,
    courseDriveFileId: string,
    parentSectionDriveFileId: string | null,
  ): Promise<void> {
    const children = await readFolder(folderId);
    for (let position = 0; position < children.length; position += 1) {
      const child = children[position];
      if (isIgnoredDriveFile(child)) {
        append(child, "ignored", position, folderId, categoryDriveFileId, courseDriveFileId, parentSectionDriveFileId);
      } else if (child.mimeType === FOLDER_MIME_TYPE) {
        append(child, "section", position, folderId, categoryDriveFileId, courseDriveFileId, parentSectionDriveFileId);
        await scanCourseFolder(child.id, categoryDriveFileId, courseDriveFileId, child.id);
      } else if (isPlayableDriveFile(child)) {
        append(child, "lesson", position, folderId, categoryDriveFileId, courseDriveFileId, parentSectionDriveFileId);
      } else {
        append(child, "unsupported", position, folderId, categoryDriveFileId, courseDriveFileId, parentSectionDriveFileId);
      }
    }
  }

  const root: DriveFile = { id: rootFolderId, mimeType: FOLDER_MIME_TYPE, name: rootName };
  append(root, "root", 0, null, null, null, null);
  const rootChildren = await readFolder(rootFolderId);

  for (let categoryPosition = 0; categoryPosition < rootChildren.length; categoryPosition += 1) {
    const category = rootChildren[categoryPosition];
    if (isIgnoredDriveFile(category)) {
      append(category, "ignored", categoryPosition, rootFolderId, null, null, null);
      continue;
    }
    if (category.mimeType !== FOLDER_MIME_TYPE) {
      append(category, "conflict", categoryPosition, rootFolderId, null, null, null);
      continue;
    }

    append(category, "category", categoryPosition, rootFolderId, category.id, null, null);
    const categoryChildren = await readFolder(category.id);
    for (let coursePosition = 0; coursePosition < categoryChildren.length; coursePosition += 1) {
      const course = categoryChildren[coursePosition];
      if (isIgnoredDriveFile(course)) {
        append(course, "ignored", coursePosition, category.id, category.id, null, null);
      } else if (course.mimeType !== FOLDER_MIME_TYPE) {
        append(course, "conflict", coursePosition, category.id, category.id, null, null);
      } else {
        append(course, "course", coursePosition, category.id, category.id, course.id, null);
        await scanCourseFolder(course.id, category.id, course.id, null);
      }
    }
  }

  demoteAuxiliarySections(items);

  const count = (kind: SnapshotKind) => items.filter((item) => item.kind === kind).length;
  return {
    counters: {
      categories: count("category"),
      conflicts: count("conflict"),
      courses: count("course"),
      files: items.filter((item) => !item.isFolder).length,
      folders: items.filter((item) => item.isFolder).length,
      ignored: count("ignored"),
      lessons: count("lesson"),
      sections: count("section"),
      unsupported: count("unsupported"),
    },
    items,
    rootFolderId,
  };
}

export function buildSnapshotItemPath(snapshot: LibrarySnapshot, item: LibrarySnapshotItem): string {
  const itemsById = new Map(snapshot.items.map((entry) => [entry.driveFileId, entry]));
  const names: string[] = [];
  const visited = new Set<string>();
  let current: LibrarySnapshotItem | undefined = item;

  while (current && !visited.has(current.driveFileId)) {
    visited.add(current.driveFileId);
    names.push(current.name);
    current = current.parentDriveFileId
      ? itemsById.get(current.parentDriveFileId)
      : undefined;
  }

  return names.reverse().join(" / ");
}

export function listLibrarySnapshotIssues(snapshot: LibrarySnapshot): LibrarySnapshotIssue[] {
  return snapshot.items
    .filter((item): item is LibrarySnapshotItem & { kind: LibrarySnapshotIssue["kind"] } => (
      item.kind === "conflict" || item.kind === "ignored" || item.kind === "unsupported"
    ))
    .map((item) => ({
      driveFileId: item.driveFileId,
      isFolder: item.isFolder,
      kind: item.kind,
      mimeType: item.mimeType,
      name: item.name,
      path: buildSnapshotItemPath(snapshot, item),
    }));
}
