import Link from "next/link";
import type { CSSProperties } from "react";

import { CourseCover } from "@/components/course-cover";
import { Icon } from "@/components/icons";

export type CourseView = {
  category: string;
  category_id: string | null;
  completed: number;
  cover_url: string | null;
  custom_title: string | null;
  description: string | null;
  destinationId: string | null;
  detected_title: string;
  id: string;
  lessonCount: number;
  percent: number;
  platform: string | null;
  resumable: boolean;
  resumableUpdatedAt: string | null;
  sectionCount: number;
};

export const courseTitle = (item: { custom_title: string | null; detected_title: string }) => item.custom_title ?? item.detected_title;

export function courseAction(course: CourseView) {
  if (course.resumable) return "Continuar";
  if (course.percent >= 100) return "Repasar";
  if (course.completed) return "Seguir";
  return "Empezar";
}

export function CourseCard({ course }: { course: CourseView }) {
  const title = courseTitle(course);
  return (
    <article className="course-card" data-spotlight="" data-tilt="5">
      <div className="course-card-media">
        <CourseCover category={course.category} coverUrl={course.cover_url} title={title} />
        {course.percent > 0 ? <span className="course-card-ring ring" style={{ "--p": course.percent } as CSSProperties}><span>{course.percent}%</span></span> : null}
        {course.destinationId ? <span aria-hidden="true" className="course-card-play"><Icon name="play" /></span> : null}
      </div>
      <div className="course-card-body">
        <h3>{title}</h3>
        <p className="course-card-meta">
          <span>{course.sectionCount} secciones</span>
          <span>{course.lessonCount} lecciones</span>
          {course.platform ? <span>{course.platform}</span> : null}
        </p>
        <div className="course-card-foot">
          {course.destinationId ? <span>{courseAction(course)} <span aria-hidden="true">→</span></span> : <span className="subtle">Sin vídeos todavía</span>}
          {course.percent > 0 ? <span aria-label={`${course.percent}% completado`} className="meter" role="img"><span style={{ width: `${course.percent}%` }} /></span> : null}
        </div>
      </div>
      {course.destinationId ? <Link aria-label={`${courseAction(course)} ${title}`} className="course-card-link" href={`/course-player?lesson=${course.destinationId}`} /> : null}
    </article>
  );
}
