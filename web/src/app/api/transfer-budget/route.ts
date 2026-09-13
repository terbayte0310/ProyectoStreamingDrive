import { NextRequest, NextResponse } from "next/server";

import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateTransferBytes, TransferRangeError, type TransferKind } from "@/lib/transfer-budget";

export const dynamic = "force-dynamic";

type ReserveResult = {
  allowed: boolean;
  emergency_limit_bytes: number;
  global_warning_limit_bytes: number;
  global_used_bytes: number;
  global_warning: boolean;
  reservation_id: string | null;
  retry_after_seconds: number;
  user_used_bytes: number;
  user_warning: boolean;
  user_warning_limit_bytes: number;
};

type RequestBody = {
  fileId?: unknown;
  kind?: unknown;
  operation?: unknown;
  range?: unknown;
  reservationId?: unknown;
};

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === getRequestOrigin(request);
}

async function getAuthorizedClient() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_authorized")
    .eq("id", userData.user.id)
    .maybeSingle<{ is_authorized: boolean }>();
  return profile?.is_authorized ? supabase : null;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ code: "origin", error: "Origen no permitido." }, { status: 403 });

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return noStoreJson({ code: "invalid_request", error: "La solicitud no es válida." }, { status: 400 });
  }

  const supabase = await getAuthorizedClient();
  if (!supabase) return noStoreJson({ code: "unauthorized", error: "Debes iniciar sesión con una cuenta autorizada." }, { status: 401 });

  if (body.operation === "confirm" || body.operation === "release") {
    if (typeof body.reservationId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.reservationId)) {
      return noStoreJson({ code: "invalid_reservation", error: "La reserva no es válida." }, { status: 400 });
    }
    const functionName = body.operation === "confirm" ? "confirm_transfer_usage" : "release_transfer_usage";
    const { data, error } = await supabase.rpc(functionName, { p_reservation_id: body.reservationId });
    if (error) return noStoreJson({ code: "counter_unavailable", error: "No se pudo actualizar el contador." }, { status: 503 });
    return noStoreJson({ completed: Boolean(data) });
  }

  if (
    body.operation !== "reserve"
    || typeof body.fileId !== "string"
    || body.fileId.length < 1
    || body.fileId.length > 250
    || (body.kind !== "stream" && body.kind !== "download")
    || (body.range !== null && typeof body.range !== "string")
  ) {
    return noStoreJson({ code: "invalid_request", error: "La solicitud de transferencia no es válida." }, { status: 400 });
  }

  const { data: item, error: itemError } = await supabase
    .from("drive_items")
    .select("byte_size")
    .eq("drive_file_id", body.fileId)
    .eq("status", "available")
    .limit(1)
    .maybeSingle<{ byte_size: number | null }>();
  if (itemError) return noStoreJson({ code: "counter_unavailable", error: "No se pudo comprobar la transferencia." }, { status: 503 });
  if (!item) return noStoreJson({ code: "file_not_allowed", error: "El archivo no pertenece a la biblioteca disponible." }, { status: 403 });

  let requestBytes: number;
  try {
    requestBytes = calculateTransferBytes(body.kind as TransferKind, body.range as string | null, Number(item.byte_size));
  } catch (error) {
    const message = error instanceof TransferRangeError ? error.message : "No se pudo calcular la transferencia.";
    return noStoreJson({ code: "invalid_range", error: message }, { status: 416 });
  }

  const { data, error } = await supabase
    .rpc("reserve_transfer_usage", { p_request_bytes: requestBytes })
    .single<ReserveResult>();
  if (error || !data) return noStoreJson({ code: "counter_unavailable", error: "El contador está temporalmente indisponible." }, { status: 503 });

  if (!data.allowed || !data.reservation_id) {
    const retryAfter = Math.max(60, Number(data.retry_after_seconds) || 3600);
    return noStoreJson(
      {
        code: "emergency_fuse",
        emergencyLimitBytes: data.emergency_limit_bytes,
        error: "El fusible global de transferencia está activo.",
        retryAfterSeconds: retryAfter,
      },
      { headers: { "retry-after": String(retryAfter) }, status: 429 },
    );
  }

  return noStoreJson({
    allowed: true,
    emergencyLimitBytes: data.emergency_limit_bytes,
    globalWarningLimitBytes: data.global_warning_limit_bytes,
    globalWarning: data.global_warning,
    reservationId: data.reservation_id,
    userWarningLimitBytes: data.user_warning_limit_bytes,
    userWarning: data.user_warning,
  }, { status: 201 });
}
