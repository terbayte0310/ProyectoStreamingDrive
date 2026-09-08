import assert from "node:assert/strict";
import test from "node:test";

import {
  type DriveFile,
  listDriveChildren,
  listLibrarySnapshotIssues,
  scanDriveLibrary,
} from "../src/lib/drive/library-snapshot.ts";

const folder = (id: string, name: string): DriveFile => ({
  id,
  mimeType: "application/vnd.google-apps.folder",
  name,
});
const file = (id: string, name: string, mimeType = "video/mp4"): DriveFile => ({ id, mimeType, name });

function fakeDrive(entries: Record<string, DriveFile[]>) {
  return async (parentId: string) => entries[parentId] ?? [];
}

test("scans categories, courses and nested sections in deterministic natural order", async () => {
  const snapshot = await scanDriveLibrary({
    listChildren: fakeDrive({
      root: [folder("category-10", "10 Backend"), folder("category-2", "2 Frontend")],
      "category-2": [folder("course", "Curso React")],
      course: [file("lesson-10", "10 Final.mp4"), folder("section", "2 Módulo"), file("lesson-1", "1 Inicio.mp4")],
      section: [file("nested", "1 Hooks.mp4")],
    }),
    rootFolderId: "root",
  });

  assert.deepEqual(snapshot.items.map(({ driveFileId, kind }) => `${kind}:${driveFileId}`), [
    "root:root",
    "category:category-2",
    "course:course",
    "lesson:lesson-1",
    "section:section",
    "lesson:nested",
    "lesson:lesson-10",
    "category:category-10",
  ]);
  assert.equal(snapshot.counters.categories, 2);
  assert.equal(snapshot.counters.courses, 1);
  assert.equal(snapshot.counters.sections, 1);
  assert.equal(snapshot.counters.lessons, 3);
});

test("classifies ignored, unsupported and structurally conflicting files", async () => {
  const snapshot = await scanDriveLibrary({
    listChildren: fakeDrive({
      root: [file("root-file", "suelto.mp4"), file("root-trash", "desktop.ini", "application/octet-stream"), folder("category", "AWS")],
      category: [file("category-file", "portada.jpg", "image/jpeg"), folder("course", "Lambda")],
      course: [file("document", "guia.pdf", "application/pdf"), file("audio", "audio.mp3", "audio/mpeg"), file("hidden", ".cache")],
    }),
    rootFolderId: "root",
  });

  const kinds = new Map(snapshot.items.map((item) => [item.driveFileId, item.kind]));
  assert.equal(kinds.get("root-file"), "conflict");
  assert.equal(kinds.get("category-file"), "conflict");
  assert.equal(kinds.get("document"), "unsupported");
  assert.equal(kinds.get("audio"), "lesson");
  assert.equal(kinds.get("root-trash"), "ignored");
  assert.equal(kinds.get("hidden"), "ignored");
  assert.equal(snapshot.counters.conflicts, 2);
  assert.equal(snapshot.counters.unsupported, 1);
  assert.equal(snapshot.counters.ignored, 2);

  const issues = new Map(listLibrarySnapshotIssues(snapshot).map((issue) => [issue.name, issue]));
  assert.equal(issues.size, 5);
  assert.equal(issues.get("suelto.mp4")?.path, "100_BIBLIOTECA_DE_CURSOS / suelto.mp4");
  assert.equal(issues.get("portada.jpg")?.path, "100_BIBLIOTECA_DE_CURSOS / AWS / portada.jpg");
  assert.equal(issues.get("guia.pdf")?.path, "100_BIBLIOTECA_DE_CURSOS / AWS / Lambda / guia.pdf");
});

test("loads every Drive page and returns natural order", async () => {
  const requestedUrls: string[] = [];
  const responses = [
    { files: [file("ten", "10.mp4")], nextPageToken: "page-2" },
    { files: [file("two", "2.mp4")] },
  ];
  const fetchRequest = async (input: string) => {
    requestedUrls.push(input);
    return Response.json(responses.shift());
  };

  const files = await listDriveChildren("secret-token", "parent", fetchRequest);

  assert.deepEqual(files.map(({ id }) => id), ["two", "ten"]);
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[1], /pageToken=page-2/);
  assert.doesNotMatch(requestedUrls.join(" "), /secret-token/);
});

test("rejects a repeated folder instead of scanning an ambiguous cycle", async () => {
  await assert.rejects(
    scanDriveLibrary({
      listChildren: fakeDrive({ root: [folder("category", "AWS")], category: [folder("root", "Curso circular")] }),
      rootFolderId: "root",
    }),
    /repetida o cíclica/,
  );
});
