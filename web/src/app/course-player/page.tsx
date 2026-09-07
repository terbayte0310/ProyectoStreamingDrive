"use client";

import { Suspense } from "react";

import CoursePlayerContent from "@/components/course-player-content";

export default function CoursePlayerPage() {
  return (
    <Suspense fallback={<p className="p-6">Preparando el reproductor…</p>}>
      <CoursePlayerContent />
    </Suspense>
  );
}
