import { NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") return NextResponse.json({ error: "No tienes permiso de administrador." }, { status: 403 });

  const body = (await request.json()) as { courseId?: unknown; parentSectionId?: unknown; items?: unknown };
  if (typeof body.courseId !== "string" || (body.parentSectionId !== null && typeof body.parentSectionId !== "string") || !Array.isArray(body.items)) return NextResponse.json({ error: "La solicitud de orden no es válida." }, { status: 400 });
  const items = body.items.map((item) => item as Record<string, unknown>);
  if (items.some((item) => (item.kind !== "section" && item.kind !== "lesson") || typeof item.id !== "string")) return NextResponse.json({ error: "La lista contiene elementos inválidos." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reorder_course_outline", {
    p_course_id: body.courseId,
    p_items: items.map(({ id, kind }) => ({ id, kind })),
    p_parent_section_id: body.parentSectionId,
  });
  if (error) return NextResponse.json({ error: "No se pudo guardar el orden completo." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
