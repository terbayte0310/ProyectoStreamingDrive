import {
  createSnapshotItem,
  FOLDER_MIME_TYPE,
  isIgnoredDriveFile,
  isPlayableDriveFile,
  type DriveFile,
  type LibrarySnapshotItem,
  type SnapshotKind,
} from "./library-snapshot.ts";

export type DurableSyncTaskKind = "root" | "category" | "course" | "section";

export type DurableSyncTask = {
  category_drive_file_id: string | null;
  course_drive_file_id: string | null;
  folder_drive_file_id: string;
  id: string;
  kind: DurableSyncTaskKind;
  parent_section_drive_file_id: string | null;
};

export type DurableSyncChildTask = {
  categoryDriveFileId: string | null;
  courseDriveFileId: string | null;
  folderDriveFileId: string;
  kind: DurableSyncTaskKind;
  parentSectionDriveFileId: string | null;
};

export type KnownDurableCourse = {
  categoryDriveFileId: string | null;
  driveFileId: string;
};

export function createRootSnapshotItem(rootFolderId: string, rootName: string) {
  return createSnapshotItem({
    categoryDriveFileId: null,
    courseDriveFileId: null,
    file: { id: rootFolderId, mimeType: FOLDER_MIME_TYPE, name: rootName },
    kind: "root",
    parentDriveFileId: null,
    parentSectionDriveFileId: null,
    position: 0,
  });
}

export function createDurableTaskResult(task: DurableSyncTask, children: DriveFile[]) {
  const items: LibrarySnapshotItem[] = [];
  const childTasks: DurableSyncChildTask[] = [];

  function append(file: DriveFile, kind: SnapshotKind, position: number, categoryDriveFileId: string | null, courseDriveFileId: string | null, parentSectionDriveFileId: string | null) {
    items.push(createSnapshotItem({
      categoryDriveFileId,
      courseDriveFileId,
      file,
      kind,
      parentDriveFileId: task.folder_drive_file_id,
      parentSectionDriveFileId,
      position,
    }));
  }

  function enqueue(file: DriveFile, kind: DurableSyncTaskKind, categoryDriveFileId: string | null, courseDriveFileId: string | null, parentSectionDriveFileId: string | null) {
    childTasks.push({
      categoryDriveFileId,
      courseDriveFileId,
      folderDriveFileId: file.id,
      kind,
      parentSectionDriveFileId,
    });
  }

  for (let position = 0; position < children.length; position += 1) {
    const child = children[position];
    if (task.kind === "root") {
      if (isIgnoredDriveFile(child)) append(child, "ignored", position, null, null, null);
      else if (child.mimeType !== FOLDER_MIME_TYPE) append(child, "conflict", position, null, null, null);
      else {
        append(child, "category", position, child.id, null, null);
        enqueue(child, "category", child.id, null, null);
      }
      continue;
    }

    if (task.kind === "category") {
      if (isIgnoredDriveFile(child)) append(child, "ignored", position, task.category_drive_file_id, null, null);
      else if (child.mimeType !== FOLDER_MIME_TYPE) append(child, "conflict", position, task.category_drive_file_id, null, null);
      else {
        append(child, "course", position, task.category_drive_file_id, child.id, null);
        enqueue(child, "course", task.category_drive_file_id, child.id, null);
      }
      continue;
    }

    const parentSectionDriveFileId = task.kind === "section" ? task.folder_drive_file_id : null;
    if (isIgnoredDriveFile(child)) {
      append(child, "ignored", position, task.category_drive_file_id, task.course_drive_file_id, parentSectionDriveFileId);
    } else if (child.mimeType === FOLDER_MIME_TYPE) {
      append(child, "section", position, task.category_drive_file_id, task.course_drive_file_id, parentSectionDriveFileId);
      enqueue(child, "section", task.category_drive_file_id, task.course_drive_file_id, parentSectionDriveFileId);
    } else if (isPlayableDriveFile(child)) {
      append(child, "lesson", position, task.category_drive_file_id, task.course_drive_file_id, parentSectionDriveFileId);
    } else {
      append(child, "unsupported", position, task.category_drive_file_id, task.course_drive_file_id, parentSectionDriveFileId);
    }
  }

  return { childTasks, items };
}

export function createIncrementalCategoryTaskResult(task: DurableSyncTask, children: DriveFile[], knownCourses: KnownDurableCourse[]) {
  if (task.kind !== "category") throw new Error("Solo una categoría puede agregar cursos incrementalmente.");
  const items: LibrarySnapshotItem[] = [];
  const childTasks: DurableSyncChildTask[] = [];
  const knownIds = new Set(knownCourses.map((course) => course.driveFileId));

  for (let position = 0; position < children.length; position += 1) {
    const child = children[position];
    if (isIgnoredDriveFile(child)) {
      items.push(createSnapshotItem({ categoryDriveFileId: task.category_drive_file_id, courseDriveFileId: null, file: child, kind: "ignored", parentDriveFileId: task.folder_drive_file_id, parentSectionDriveFileId: null, position }));
    } else if (child.mimeType !== FOLDER_MIME_TYPE) {
      items.push(createSnapshotItem({ categoryDriveFileId: task.category_drive_file_id, courseDriveFileId: null, file: child, kind: "conflict", parentDriveFileId: task.folder_drive_file_id, parentSectionDriveFileId: null, position }));
    } else {
      items.push(createSnapshotItem({ categoryDriveFileId: task.category_drive_file_id, courseDriveFileId: child.id, file: child, kind: "course", parentDriveFileId: task.folder_drive_file_id, parentSectionDriveFileId: null, position }));
      if (!knownIds.has(child.id)) {
        childTasks.push({ categoryDriveFileId: task.category_drive_file_id, courseDriveFileId: child.id, folderDriveFileId: child.id, kind: "course", parentSectionDriveFileId: null });
      }
    }
  }

  return { childTasks, items };
}
