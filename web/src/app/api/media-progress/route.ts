import { NextRequest, NextResponse } from "next/server";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== getRequestOrigin(request)) return reply({}, 403);
  if (Number(request.headers.get("content-length")) > 20_000) return reply({}, 413);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return reply({}, 400);
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (authError || !userId) return reply({}, 401);
  if (body.userId !== userId) return reply({}, 403);
  if (body.action === "read") {
    const ids = body.packageIds;
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every((id) => typeof id === "string" && uuid.test(id))) return reply({}, 400);
    if (!ids.length) return reply({ progress: [] });
    const { data: rows, error } = await supabase.from("media_progress").select("package_id, position_seconds, duration_seconds, watched_at").eq("user_id", userId).in("package_id", ids);
    return error ? reply({}, 503) : reply({ progress: rows });
  }
  const { packageId, t, d, at } = body;
  if (body.action !== "save" || typeof packageId !== "string" || !uuid.test(packageId)
    || !Number.isSafeInteger(t) || !Number.isSafeInteger(d) || t < 0 || d <= 0 || t > d || d > 604800
    || !Number.isSafeInteger(at) || at <= 0 || at > Date.now() + 60_000) return reply({}, 400);
  const { error } = await supabase.rpc("save_media_progress", { p_package_id: packageId, p_position: t, p_duration: d, p_watched_at: new Date(at).toISOString() });
  return error ? reply({}, 503) : reply({ saved: true });
}
