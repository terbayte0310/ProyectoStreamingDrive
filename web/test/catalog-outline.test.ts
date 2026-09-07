import assert from "node:assert/strict";
import test from "node:test";

import { buildCoursePlaybackQueue, flattenCourseLessons } from "../src/lib/catalog/outline.ts";

test("interleaves root lessons and sections by their shared position", () => {
  const lessons = [
    { id: "root-last", position: 3, section_id: null },
    { id: "inside", position: 0, section_id: "section-a" },
    { id: "root-first", position: 0, section_id: null },
  ];
  const sections = [{ id: "section-a", parent_section_id: null, position: 1 }];

  assert.deepEqual(flattenCourseLessons(lessons, sections).map(({ id }) => id), [
    "root-first",
    "inside",
    "root-last",
  ]);
});

test("walks nested sections depth-first", () => {
  const lessons = [
    { id: "deep", position: 0, section_id: "child" },
    { id: "after-child", position: 2, section_id: "parent" },
  ];
  const sections = [
    { id: "parent", parent_section_id: null, position: 0 },
    { id: "child", parent_section_id: "parent", position: 1 },
  ];

  assert.deepEqual(flattenCourseLessons(lessons, sections).map(({ id }) => id), ["deep", "after-child"]);
});

test("rejects a reachable section cycle", () => {
  const sections = [
    { id: "duplicate", parent_section_id: null, position: 0 },
    { id: "duplicate", parent_section_id: "duplicate", position: 0 },
  ];

  assert.throws(() => flattenCourseLessons([], sections), /ciclo/);
});

test("keeps the playback queue isolated to the requested course", () => {
  const lessons = [
    { course_id: "course-a", id: "a-root", position: 0, section_id: null },
    { course_id: "course-b", id: "b-root", position: 0, section_id: null },
    { course_id: "course-a", id: "a-section", position: 0, section_id: "section-a" },
    { course_id: "course-b", id: "b-section", position: 0, section_id: "section-b" },
  ];
  const sections = [
    { course_id: "course-a", id: "section-a", parent_section_id: null, position: 1 },
    { course_id: "course-b", id: "section-b", parent_section_id: null, position: 1 },
  ];

  assert.deepEqual(
    buildCoursePlaybackQueue("course-a", lessons, sections).map(({ id }) => id),
    ["a-root", "a-section"],
  );
});
