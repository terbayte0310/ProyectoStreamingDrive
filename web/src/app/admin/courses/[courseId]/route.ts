import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const textFields = ["custom_title", "author", "platform", "description", "cover_url", "published_on"] as const;
export async function PATCH(request: Request, context: RouteContext<"/admin/courses/[courseId]">) {
  const { courseId } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;
  const update: Record<string, string | boolean | null> = {};

  for (const field of textFields) {
    if (!(field in body)) continue;
    if (body[field] !== null && typeof body[field] !== "string") return NextResponse.json({ error: `Campo inválido: ${field}.` }, { status: 400 });
    const value = typeof body[field] === "string" ? body[field].trim() : null;
    if (field === "published_on" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NextResponse.json({ error: "La fecha debe ser AAAA-MM-DD." }, { status: 400 });
    update[field] = value || null;
  }
  if ("is_visible" in body) {
    if (typeof body.is_visible !== "boolean") return NextResponse.json({ error: "Visibilidad inválida." }, { status: 400 });
    update.is_visible = body.is_visible;
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role, is_authorized").eq("id", userData.user.id).maybeSingle<{ role: string; is_authorized: boolean }>();
  if (!profile?.is_authorized || profile.role !== "admin") return NextResponse.json({ error: "No tienes permiso de administrador." }, { status: 403 });

  const { data, error } = await supabase.from("courses").update(update).eq("id", courseId).select("id, detected_title, custom_title, author, platform, published_on, description, cover_url, is_visible").maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudieron guardar los cambios." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Curso no encontrado." }, { status: 404 });
  return NextResponse.json({ course: data });
}
