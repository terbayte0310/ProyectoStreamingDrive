import assert from "node:assert/strict";
import test from "node:test";

import { createDurableTaskResult, createIncrementalCategoryTaskResult, type DurableSyncTask } from "../src/lib/drive/durable-sync.ts";

const rootTask: DurableSyncTask = {
  category_drive_file_id: null,
  course_drive_file_id: null,
  folder_drive_file_id: "root",
  id: "task-root",
  kind: "root",
  parent_section_drive_file_id: null,
};

test("queues category folders and preserves root conflicts", () => {
  const result = createDurableTaskResult(rootTask, [
    { id: "category", mimeType: "application/vnd.google-apps.folder", name: "01 Cursos" },
    { id: "readme", mimeType: "text/plain", name: "README.txt" },
  ]);

  assert.deepEqual(result.items.map((item) => item.kind), ["category", "conflict"]);
  assert.deepEqual(result.childTasks, [{ categoryDriveFileId: "category", courseDriveFileId: null, folderDriveFileId: "category", kind: "category", parentSectionDriveFileId: null }]);
});

test("queues nested sections while assigning lessons to their course", () => {
  const task: DurableSyncTask = {
    category_drive_file_id: "category",
    course_drive_file_id: "course",
    folder_drive_file_id: "course",
    id: "task-course",
    kind: "course",
    parent_section_drive_file_id: null,
  };
  const result = createDurableTaskResult(task, [
    { id: "section", mimeType: "application/vnd.google-apps.folder", name: "Módulo 1" },
    { id: "lesson", mimeType: "video/mp4", name: "Clase 1.mp4" },
  ]);

  assert.deepEqual(result.items.map((item) => item.kind), ["section", "lesson"]);
  assert.equal(result.items[1].courseDriveFileId, "course");
  assert.equal(result.items[1].parentSectionDriveFileId, null);
  assert.equal(result.childTasks[0].parentSectionDriveFileId, null);
});

test("opens only folders that are new courses during an incremental category scan", () => {
  const task: DurableSyncTask = {
    category_drive_file_id: "category",
    course_drive_file_id: null,
    folder_drive_file_id: "category",
    id: "task-category",
    kind: "category",
    parent_section_drive_file_id: null,
  };
  const result = createIncrementalCategoryTaskResult(task, [
    { id: "old-course", mimeType: "application/vnd.google-apps.folder", name: "Curso existente" },
    { id: "new-course", mimeType: "application/vnd.google-apps.folder", name: "Curso nuevo" },
  ], [{ categoryDriveFileId: "category", driveFileId: "old-course" }]);

  assert.deepEqual(result.items.map((item) => item.driveFileId), ["old-course", "new-course"]);
  assert.deepEqual(result.childTasks, [{ categoryDriveFileId: "category", courseDriveFileId: "new-course", folderDriveFileId: "new-course", kind: "course", parentSectionDriveFileId: null }]);
});
