export type OutlineLesson = {
  id: string;
  position: number;
  section_id: string | null;
};

export type OutlineSection = {
  id: string;
  parent_section_id: string | null;
  position: number;
};

type CourseScoped = {
  course_id: string;
};

/** Flattens mixed section/lesson siblings into the exact playback order. */
export function flattenCourseLessons<
  TLesson extends OutlineLesson,
  TSection extends OutlineSection,
>(lessons: TLesson[], sections: TSection[]) {
  const result: TLesson[] = [];
  const visitedSections = new Set<string>();

  function visit(parentSectionId: string | null) {
    const children = [
      ...sections
        .filter((section) => section.parent_section_id === parentSectionId)
        .map((section) => ({ id: section.id, kind: "section" as const, position: section.position, section })),
      ...lessons
        .filter((lesson) => lesson.section_id === parentSectionId)
        .map((lesson) => ({ id: lesson.id, kind: "lesson" as const, lesson, position: lesson.position })),
    ].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

    for (const child of children) {
      if (child.kind === "lesson") {
        result.push(child.lesson);
        continue;
      }
      if (visitedSections.has(child.section.id)) {
        throw new Error("El catálogo contiene un ciclo entre secciones.");
      }
      visitedSections.add(child.section.id);
      visit(child.section.id);
    }
  }

  visit(null);
  return result;
}

/** Builds a playback queue that cannot include items belonging to another course. */
export function buildCoursePlaybackQueue<
  TLesson extends OutlineLesson & CourseScoped,
  TSection extends OutlineSection & CourseScoped,
>(courseId: string, lessons: TLesson[], sections: TSection[]) {
  return flattenCourseLessons(
    lessons.filter((lesson) => lesson.course_id === courseId),
    sections.filter((section) => section.course_id === courseId),
  );
}
