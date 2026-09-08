import assert from "node:assert/strict";
import test from "node:test";

import { buildCodecInventory } from "../src/lib/drive/codec-inventory.ts";
import type { LibrarySnapshot, LibrarySnapshotItem } from "../src/lib/drive/library-snapshot.ts";

function lessonItem(overrides: Partial<LibrarySnapshotItem>): LibrarySnapshotItem {
  return {
    byteSize: null,
    categoryDriveFileId: "category",
    courseDriveFileId: "course",
    detectedPosition: 0,
    detectedTitle: overrides.name ?? "Lección",
    driveFileId: "lesson",
    durationMillis: null,
    isFolder: false,
    kind: "lesson",
    mimeType: "video/mp4",
    modifiedAt: null,
    name: "Lección.mp4",
    parentDriveFileId: "course",
    parentSectionDriveFileId: null,
    status: "available",
    videoHeight: null,
    videoWidth: null,
    ...overrides,
  };
}

function snapshotOf(items: LibrarySnapshotItem[]): LibrarySnapshot {
  return {
    counters: {
      categories: 0, conflicts: 0, courses: 0, files: items.length, folders: 0,
      ignored: 0, lessons: items.length, sections: 0, unsupported: 0,
    },
    items,
    rootFolderId: "root",
  };
}

test("groups safe MP4 lessons together and totals their size", () => {
  const inventory = buildCodecInventory(snapshotOf([
    lessonItem({ byteSize: 1000, driveFileId: "a", mimeType: "video/mp4", name: "a.mp4" }),
    lessonItem({ byteSize: 2000, driveFileId: "b", mimeType: "video/mp4", name: "b.mp4" }),
  ]));

  assert.equal(inventory.totalSafeLessons, 2);
  assert.equal(inventory.totalReviewLessons, 0);
  assert.equal(inventory.safeContainers.length, 1);
  assert.equal(inventory.safeContainers[0]?.byteSize, 3000);
  assert.equal(inventory.safeContainers[0]?.lessonCount, 2);
});

test("routes non-safe containers to reviewCandidates with a readable path", () => {
  const inventory = buildCodecInventory(snapshotOf([
    lessonItem({ byteSize: 500, driveFileId: "mkv", mimeType: "video/x-matroska", name: "Clase.mkv" }),
  ]));

  assert.equal(inventory.totalReviewLessons, 1);
  assert.equal(inventory.totalSafeLessons, 0);
  assert.equal(inventory.reviewContainers[0]?.mimeType, "video/x-matroska");
  assert.equal(inventory.reviewCandidates[0]?.name, "Clase.mkv");
  assert.equal(inventory.reviewCandidates[0]?.path, "Clase.mkv");
});

test("ignores non-lesson items and tolerates a missing byte size", () => {
  const inventory = buildCodecInventory(snapshotOf([
    lessonItem({ byteSize: null, driveFileId: "no-size", mimeType: "video/mp4", name: "sin-tamano.mp4" }),
    { ...lessonItem({}), driveFileId: "section", kind: "section", mimeType: "application/vnd.google-apps.folder" },
  ]));

  assert.equal(inventory.totalSafeLessons, 1);
  assert.equal(inventory.safeContainers[0]?.byteSize, 0);
});
