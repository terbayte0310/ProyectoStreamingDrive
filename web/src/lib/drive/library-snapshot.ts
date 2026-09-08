const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const ignoredNames = new Set(["desktop.ini", ".ds_store", "thumbs.db"]);
const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export type DriveFile = {
  id: string;
  mimeType: string;
  modifiedTime?: string;
  name: string;
  size?: string;
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
  driveFileId: string;
  isFolder: boolean;
  kind: SnapshotKind;
  mimeType: string;
  modifiedAt: string | null;
  name: string;
  parentDriveFileId: string | null;
  parentSectionDriveFileId: string | null;
  status: "available" | "ignored" | "unsupported";
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
  kind: "conflict" | "ignored" | "unsupported";
  mimeType: string;
  name: string;
  path: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ListChildren = (parentId: string) => Promise<DriveFile[]>;

function sortNaturally(files: DriveFile[]) {
  return [...files].sort((first, second) => naturalOrder.compare(first.name, second.name));
}

function isIgnored(file: DriveFile) {
  return ignoredNames.has(file.name.toLowerCase()) || file.name.startsWith(".");
}

function isPlayable(file: DriveFile) {
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
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
      orderBy: "folder,name_natural",
      pageSize: "1000",
      q: `'${parentId}' in parents and trashed = false`,
    });
    if (pageToken) query.set("pageToken", pageToken);

    const response = await fetchRequest(`https://www.googleapis.com/drive/v3/files?${query}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Drive rechazó la lectura de la carpeta ${parentId}.`);

    const data = (await response.json()) as DriveListResponse;
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return sortNaturally(files);
}

function toSnapshotItem({
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
  return {
    byteSize: file.size ? Number(file.size) : null,
    categoryDriveFileId,
    courseDriveFileId,
    detectedPosition: position,
    driveFileId: file.id,
    isFolder: file.mimeType === FOLDER_MIME_TYPE,
    kind,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedTime ?? null,
    name: file.name,
    parentDriveFileId,
    parentSectionDriveFileId,
    status: kind === "ignored" ? "ignored" : kind === "unsupported" || kind === "conflict" ? "unsupported" : "available",
  };
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
    items.push(toSnapshotItem({
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
      if (isIgnored(child)) {
        append(child, "ignored", position, folderId, categoryDriveFileId, courseDriveFileId, parentSectionDriveFileId);
      } else if (child.mimeType === FOLDER_MIME_TYPE) {
        append(child, "section", position, folderId, categoryDriveFileId, courseDriveFileId, parentSectionDriveFileId);
        await scanCourseFolder(child.id, categoryDriveFileId, courseDriveFileId, child.id);
      } else if (isPlayable(child)) {
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
    if (isIgnored(category)) {
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
      if (isIgnored(course)) {
        append(course, "ignored", coursePosition, category.id, category.id, null, null);
      } else if (course.mimeType !== FOLDER_MIME_TYPE) {
        append(course, "conflict", coursePosition, category.id, category.id, null, null);
      } else {
        append(course, "course", coursePosition, category.id, category.id, course.id, null);
        await scanCourseFolder(course.id, category.id, course.id, null);
      }
    }
  }

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

export function listLibrarySnapshotIssues(snapshot: LibrarySnapshot): LibrarySnapshotIssue[] {
  const itemsById = new Map(snapshot.items.map((item) => [item.driveFileId, item]));

  function buildPath(item: LibrarySnapshotItem) {
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

  return snapshot.items
    .filter((item): item is LibrarySnapshotItem & { kind: LibrarySnapshotIssue["kind"] } => (
      item.kind === "conflict" || item.kind === "ignored" || item.kind === "unsupported"
    ))
    .map((item) => ({
      driveFileId: item.driveFileId,
      kind: item.kind,
      mimeType: item.mimeType,
      name: item.name,
      path: buildPath(item),
    }));
}
