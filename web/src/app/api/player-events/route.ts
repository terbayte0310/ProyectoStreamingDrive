import { NextRequest, NextResponse } from "next/server";

import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const maxEvents = 30;
const uuidPattern = /^[0-9a-f-]{36}$/i;

type IncomingEvent = { at?: unknown; detail?: unknown; event?: unknown; packageId?: unknown };

function reply(status: number, body: object = {}) {
  const response = NextResponse.json(body, { status });
  response.headers.set("cache-control", "private, no-store");
  return response;
}

// Telemetría del reproductor. Nunca debe estorbar la reproducción: responde sin
// cuerpo útil, acota tamaños y descarta lo que no reconoce.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== getRequestOrigin(request)) return reply(403);

  let body: { events?: unknown };
  try {
    body = await request.json() as { events?: unknown };
  } catch {
    return reply(400);
  }
  if (!Array.isArray(body.events) || body.events.length === 0) return reply(400);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (error || !userId) return reply(401);

  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 300) || null;
  const rows = (body.events as IncomingEvent[]).slice(0, maxEvents).flatMap((item) => {
    if (!item || typeof item.event !== "string" || !/^[a-z0-9-]{1,40}$/.test(item.event)) return [];
    const detail = item.detail && typeof item.detail === "object" && !Array.isArray(item.detail) ? item.detail : {};
    if (JSON.stringify(detail).length > 1800) return [];
    const at = typeof item.at === "number" && Number.isFinite(item.at) ? new Date(item.at) : null;
    return [{
      client_time: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
      detail,
      event: item.event,
      package_id: typeof item.packageId === "string" && uuidPattern.test(item.packageId) ? item.packageId : null,
      user_agent: userAgent,
      user_id: userId,
    }];
  });
  if (!rows.length) return reply(400);

  const { error: insertError } = await supabase.from("player_events").insert(rows);
  return insertError ? reply(503) : reply(201, { saved: rows.length });
}
