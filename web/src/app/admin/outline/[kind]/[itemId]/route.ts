import { NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PATCH(request: Request, context: RouteContext<"/admin/outline/[kind]/[itemId]">) {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized || access.profile.role !== "admin") return NextResponse.json({ error: "No tienes permiso de administrador." }, { status: 403 });

  const { itemId, kind } = await context.params;
  if (kind !== "section" && kind !== "lesson") return NextResponse.json({ error: "Tipo de elemento inválido." }, { status: 400 });
  const body = (await request.json()) as Record<string, unknown>;
  if (typeof body.custom_title !== "string" || typeof body.is_visible !== "boolean") return NextResponse.json({ error: "Los datos del elemento no son válidos." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const table = kind === "section" ? "course_sections" : "lessons";
  const { data, error } = await supabase.from(table).update({ custom_title: body.custom_title.trim() || null, is_visible: body.is_visible }).eq("id", itemId).select("id, custom_title, is_visible").maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudo guardar el elemento." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Elemento no encontrado." }, { status: 404 });
  return NextResponse.json({ item: data });
}
