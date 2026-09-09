import { NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PAGE_SIZE = 500;

type OutlineSection = {
  course_id: string;
  custom_title: string | null;
  detected_title: string;
  id: string;
  is_visible: boolean;
  parent_section_id: string | null;
  position: number;
};

type OutlineLesson = {
  course_id: string;
  custom_title: string | null;
  detected_title: string;
  id: string;
  is_visible: boolean;
  position: number;
  section_id: string | null;
};

export async function GET(_request: Request, context: RouteContext<"/admin/courses/[courseId]/outline">) {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") return NextResponse.json({ error: "No tienes permiso de administrador." }, { status: 403 });

  const { courseId } = await context.params;
  const supabase = await createSupabaseServerClient();
  const [courseResult, sectionsResult, lessonsResult] = await Promise.all([
    supabase.from("courses").select("id").eq("id", courseId).maybeSingle(),
    fetchSections(supabase, courseId),
    fetchLessons(supabase, courseId),
  ]);

  if (courseResult.error) return NextResponse.json({ error: "No se pudo consultar el curso." }, { status: 500 });
  if (!courseResult.data) return NextResponse.json({ error: "Curso no encontrado." }, { status: 404 });
  if (sectionsResult.error || lessonsResult.error) return NextResponse.json({ error: "No se pudo cargar el contenido del curso." }, { status: 500 });

  return NextResponse.json({ lessons: lessonsResult.data, sections: sectionsResult.data }, { headers: { "Cache-Control": "private, no-store" } });
}

async function fetchSections(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, courseId: string) {
  const data: OutlineSection[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await supabase
      .from("course_sections")
      .select("id, course_id, parent_section_id, detected_title, custom_title, position, is_visible")
      .eq("course_id", courseId)
      .eq("is_detected_section", true)
      .order("position")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) return { data, error: result.error };
    data.push(...(result.data as OutlineSection[]));
    if (result.data.length < PAGE_SIZE) return { data, error: null };
  }
}

async function fetchLessons(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, courseId: string) {
  const data: OutlineLesson[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await supabase
      .from("lessons")
      .select("id, course_id, section_id, detected_title, custom_title, position, is_visible")
      .eq("course_id", courseId)
      .order("position")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) return { data, error: result.error };
    data.push(...(result.data as OutlineLesson[]));
    if (result.data.length < PAGE_SIZE) return { data, error: null };
  }
}
