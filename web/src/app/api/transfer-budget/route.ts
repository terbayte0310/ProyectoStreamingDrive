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
  module?: unknown;
  operation?: unknown;
  observedBytes?: unknown;
  outcome?: unknown;
  range?: unknown;
  reservationId?: unknown;
  items?: unknown;
};

// Tamaño y origen de cada archivo por usuario: un reproductor pide cientos de
// segmentos y la respuesta no cambia entre ellos. La lectura real de Drive sigue
// exigiendo el token, así que la caché solo evita consultas repetidas al contador.
type FileLookup = { byteSize: number; course: boolean; expires: number };
const fileLookups = new Map<string, FileLookup>();
const fileLookupTtlMs = 5 * 60_000;
const fileLookupMax = 2000;
const settleBatchLimit = 100;
const uuidPattern = /^[0-9a-f-]{36}$/i;

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === getRequestOrigin(request);
}

// Se ejecuta antes de cada lectura de vídeo: identidad local por JWT y nada más.
// reserve_transfer_usage exige cuenta autorizada, y las políticas RLS de
// drive_items (Cursos) y media_hls_assets (Películas/Series) limitan qué
// archivos puede medir cada usuario según sus módulos.
async function getAuthorizedClient() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  return error || !data?.claims.sub ? null : { supabase, userId: data.claims.sub };
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ code: "origin", error: "Origen no permitido." }, { status: 403 });

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return noStoreJson({ code: "invalid_request", error: "La solicitud no es válida." }, { status: 400 });
  }

  const authorized = await getAuthorizedClient();
  if (!authorized) return noStoreJson({ code: "unauthorized", error: "Debes iniciar sesión con una cuenta autorizada." }, { status: 401 });
  const { supabase, userId } = authorized;

  // Varias liberaciones en una sola petición: el Service Worker las agrupa.
  if (body.operation === "settle") {
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || items.length > settleBatchLimit) {
      return noStoreJson({ code: "invalid_request", error: "La solicitud no es válida." }, { status: 400 });
    }
    const ids = items
      .map((item) => (item && typeof item === "object" ? (item as { reservationId?: unknown }).reservationId : null))
      .filter((id): id is string => typeof id === "string" && uuidPattern.test(id));
    let completed = 0;
    for (let index = 0; index < ids.length; index += 10) {
      const results = await Promise.all(ids.slice(index, index + 10).map((id) => supabase.rpc("release_transfer_usage", { p_reservation_id: id })));
      if (results.some((result) => result.error)) return noStoreJson({ code: "counter_unavailable", error: "No se pudo actualizar el contador." }, { status: 503 });
      completed += results.filter((result) => Boolean(result.data)).length;
    }
    return noStoreJson({ completed });
  }

  if (body.operation === "confirm" || body.operation === "release") {
    if (typeof body.reservationId !== "string" || !uuidPattern.test(body.reservationId)) {
      return noStoreJson({ code: "invalid_reservation", error: "La reserva no es válida." }, { status: 400 });
    }
    if (body.operation === "confirm") {
      const observedBytes = body.observedBytes;
      const outcome = body.outcome;
      // El flujo de vídeo directo no puede contabilizar de forma fiable un
      // cuerpo MP4 continuo. Las confirmaciones sin medición se liberan: no
      // contaminan el historial con el tamaño completo del rango solicitado.
      if (observedBytes === undefined && outcome === undefined) {
        const { data, error } = await supabase.rpc("release_transfer_usage", { p_reservation_id: body.reservationId });
        if (error) return noStoreJson({ code: "counter_unavailable", error: "No se pudo actualizar el contador." }, { status: 503 });
        return noStoreJson({ completed: Boolean(data) });
      }
      if (
        !Number.isSafeInteger(observedBytes)
        || (observedBytes as number) < 0
        || (outcome !== "completed" && outcome !== "cancelled" && outcome !== "failed")
      ) {
        return noStoreJson({ code: "invalid_measurement", error: "La medición de entrega no es válida." }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("confirm_transfer_usage", {
        p_observed_bytes: observedBytes,
        p_outcome: outcome,
        p_reservation_id: body.reservationId,
      });
      if (error) return noStoreJson({ code: "counter_unavailable", error: "No se pudo actualizar el contador." }, { status: 503 });
      return noStoreJson({ completed: Boolean(data) });
    }
    const { data, error } = await supabase.rpc("release_transfer_usage", { p_reservation_id: body.reservationId });
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

  const lookupKey = `${userId}:${body.fileId}`;
  let lookup = fileLookups.get(lookupKey);
  if (lookup && lookup.expires < Date.now()) { fileLookups.delete(lookupKey); lookup = undefined; }
  if (!lookup) {
    const { data: courseItem, error: courseItemError } = await supabase
      .from("drive_items")
      .select("byte_size")
      .eq("drive_file_id", body.fileId)
      .eq("status", "available")
      .limit(1)
      .maybeSingle<{ byte_size: number | null }>();
    if (courseItemError) return noStoreJson({ code: "counter_unavailable", error: "No se pudo comprobar la transferencia." }, { status: 503 });

    // Los segmentos HLS no forman parte del inventario de Cursos. Su política
    // RLS comprueba el módulo y el contenido antes de permitir la lectura.
    const { data: mediaAsset, error: mediaAssetError } = courseItem
      ? { data: null, error: null }
      : await supabase
        .from("media_hls_assets")
        .select("byte_size")
        .eq("drive_file_id", body.fileId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle<{ byte_size: number | null }>();
    if (mediaAssetError) return noStoreJson({ code: "counter_unavailable", error: "No se pudo comprobar la transferencia." }, { status: 503 });

    const found = courseItem ?? mediaAsset;
    if (found?.byte_size === undefined || found.byte_size === null) return noStoreJson({ code: "file_not_allowed", error: "El archivo no pertenece a la biblioteca disponible." }, { status: 403 });
    lookup = { byteSize: found.byte_size, course: Boolean(courseItem), expires: Date.now() + fileLookupTtlMs };
    if (fileLookups.size >= fileLookupMax) fileLookups.delete(fileLookups.keys().next().value as string);
    fileLookups.set(lookupKey, lookup);
  }
  const isCourse = lookup.course;
  const byteSize = lookup.byteSize;

  let requestBytes: number;
  try {
    requestBytes = calculateTransferBytes(body.kind as TransferKind, body.range as string | null, Number(byteSize));
  } catch (error) {
    const message = error instanceof TransferRangeError ? error.message : "No se pudo calcular la transferencia.";
    return noStoreJson({ code: "invalid_range", error: message }, { status: 416 });
  }

  const { data, error } = await supabase
    .rpc("reserve_transfer_usage", { p_module: isCourse ? "courses" : "media", p_request_bytes: requestBytes })
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
    fileSize: Number(byteSize),
    globalWarningLimitBytes: data.global_warning_limit_bytes,
    globalWarning: data.global_warning,
    reservationId: data.reservation_id,
    userWarningLimitBytes: data.user_warning_limit_bytes,
    userWarning: data.user_warning,
  }, { status: 201 });
}
