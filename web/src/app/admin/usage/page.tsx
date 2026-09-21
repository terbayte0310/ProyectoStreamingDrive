import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/icons";
import { SiteHeader } from "@/components/site-header";
import { requireAdminAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Uso y cuotas" };

type UsageBucket = {
  bucket_start: string;
  cancelled_delivery_count: number;
  completed_delivery_count: number;
  confirmed_bytes: number;
  failed_delivery_count: number;
  observed_bytes: number;
  released_bytes: number;
  reserved_bytes: number;
  user_id: string;
};

type ModuleBucket = {
  cancelled_delivery_count: number;
  completed_delivery_count: number;
  failed_delivery_count: number;
  module: "courses" | "media";
  observed_bytes: number;
};

type Settings = {
  global_emergency_bytes: number;
  global_warning_bytes: number;
  retention_days: number;
  user_warning_bytes: number;
};

type Profile = { email: string; id: string };

const moduleNames = { courses: "Cursos", media: "Películas y series" } as const;

function number(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let current = value;
  let index = -1;
  while (current >= 1024 && index < units.length - 1) { current /= 1024; index += 1; }
  return `${current >= 10 ? current.toFixed(1) : current.toFixed(2)} ${units[index]}`;
}

function localDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function AdminUsagePage() {
  const supabase = await createSupabaseServerClient();
  const [, settingsResult, bucketsResult, moduleResult, profilesResult] = await Promise.all([
    requireAdminAccess(),
    supabase.from("transfer_usage_settings").select("user_warning_bytes, global_warning_bytes, global_emergency_bytes, retention_days").eq("id", 1).maybeSingle<Settings>(),
    supabase.from("transfer_usage_buckets").select("user_id, bucket_start, reserved_bytes, confirmed_bytes, released_bytes, observed_bytes, completed_delivery_count, cancelled_delivery_count, failed_delivery_count").order("bucket_start", { ascending: false }),
    supabase.from("transfer_usage_module_buckets").select("module, observed_bytes, completed_delivery_count, cancelled_delivery_count, failed_delivery_count"),
    supabase.from("profiles").select("id, email"),
  ]);

  const buckets = (bucketsResult.data ?? []) as UsageBucket[];
  const moduleBuckets = (moduleResult.data ?? []) as ModuleBucket[];
  const profiles = new Map(((profilesResult.data ?? []) as Profile[]).map((profile) => [profile.id, profile.email]));
  const settings = settingsResult.data;
  const measuredBytes = buckets.reduce((total, bucket) => total + number(bucket.observed_bytes), 0);
  const historicalReservations = buckets.reduce((total, bucket) => total + Math.max(number(bucket.reserved_bytes) - number(bucket.released_bytes), 0), 0);
  const finished = buckets.reduce((total, bucket) => total + number(bucket.completed_delivery_count), 0);
  const latestMeasuredBucket = buckets.find((bucket) => number(bucket.observed_bytes) > 0);

  const modules = (Object.keys(moduleNames) as ModuleBucket["module"][]).map((module) => moduleBuckets
    .filter((bucket) => bucket.module === module)
    .reduce((total, bucket) => ({
      cancelled: total.cancelled + number(bucket.cancelled_delivery_count),
      completed: total.completed + number(bucket.completed_delivery_count),
      failed: total.failed + number(bucket.failed_delivery_count),
      measured: total.measured + number(bucket.observed_bytes),
    }), { cancelled: 0, completed: 0, failed: 0, measured: 0 }));

  const users = Array.from(new Map(buckets.map((bucket) => [bucket.user_id, bucket])).keys()).map((userId) => {
    const rows = buckets.filter((bucket) => bucket.user_id === userId);
    return {
      email: profiles.get(userId) ?? "Cuenta eliminada",
      historical: rows.reduce((total, bucket) => total + Math.max(number(bucket.reserved_bytes) - number(bucket.released_bytes), 0), 0),
      measured: rows.reduce((total, bucket) => total + number(bucket.observed_bytes), 0),
    };
  }).sort((a, b) => b.measured - a.measured || b.historical - a.historical);

  const dataError = settingsResult.error ?? bucketsResult.error ?? moduleResult.error ?? profilesResult.error;

  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell-main container">
        <section className="admin-hero rise">
          <div>
            <p className="kicker">Administración · Observabilidad</p>
            <h1 className="display" style={{ fontSize: "clamp(2.2rem, 4.6vw, 4.2rem)" }}>Uso<br />comprobado.</h1>
            <p className="lede">Separa bytes entregados al navegador de reservas preventivas. No confunde transferencia con minutos vistos ni con una factura de Google.</p>
          </div>
          <div style={{ display: "grid", gap: 12, justifyItems: "end" }}>
            <div className="stat-row">
              <div className="stat"><strong>{bytes(measuredBytes)}</strong><span>Medido · 30 días</span></div>
              <div className="stat"><strong>{finished}</strong><span>Entregas completas</span></div>
            </div>
            <Link className="btn btn-ghost btn-sm" href="/admin"><Icon name="layers" />Administrar cursos</Link>
          </div>
        </section>

        {dataError ? (
          <div className="notice notice-error" style={{ marginTop: 20 }}><span className="notice-icon"><Icon name="warning" /></span><div>No se pudo leer el reporte. Aplica la migración de uso comprobado y vuelve a cargar.</div></div>
        ) : (
          <>
            <section className="usage-grid section">
              <article className="panel panel-pad usage-card usage-card-good">
                <p className="kicker">Fuente interna medida</p>
                <h2 className="title-m">Bytes entregados</h2>
                <strong className="usage-value">{bytes(measuredBytes)}</strong>
                <p>El Service Worker contó bytes que leyó de la respuesta de Drive y entregó al navegador. La medición comienza al desplegar esta versión.</p>
                <small>{latestMeasuredBucket ? `Última entrega registrada: ${localDate(latestMeasuredBucket.bucket_start)}` : "Aún no hay entregas medidas por esta versión."}</small>
              </article>
              <article className="panel panel-pad usage-card">
                <p className="kicker">Control preventivo histórico</p>
                <h2 className="title-m">Reservas de rango</h2>
                <strong className="usage-value">{bytes(historicalReservations)}</strong>
                <p>Es un máximo solicitado por el navegador para activar el fusible. No representa bytes reales ni debe usarse para juzgar consumo.</p>
                <small>Incluye registros anteriores a la medición comprobada.</small>
              </article>
              <article className="panel panel-pad usage-card">
                <p className="kicker">Fuente externa</p>
                <h2 className="title-m">Cuota Google Cloud</h2>
                <strong className="usage-value">Proyecto</strong>
                <p>Google es la autoridad para cuotas globales del proyecto, respuestas 429 y límites diarios. Drive no expone un contador por vídeo o persona.</p>
                <a className="text-link" href="https://console.cloud.google.com/apis/api/drive.googleapis.com/quotas" rel="noreferrer" target="_blank">Abrir cuotas de Drive <span aria-hidden="true">↗</span></a>
              </article>
            </section>

            <section className="panel panel-pad section usage-section">
              <div className="panel-head"><div><p className="kicker">Desglose medido · últimos 30 días</p><h2 className="title-m">Por biblioteca</h2></div><span className="code-pill">Retención: {settings?.retention_days ?? 30} días</span></div>
              <div className="usage-breakdown">
                {(Object.keys(moduleNames) as ModuleBucket["module"][]).map((module, index) => {
                  const result = modules[index];
                  return <div className="usage-row" key={module}><div><strong>{moduleNames[module]}</strong><span>{result.completed} completas · {result.cancelled} canceladas · {result.failed} fallidas</span></div><b>{bytes(result.measured)}</b></div>;
                })}
              </div>
            </section>

            <section className="panel panel-pad section usage-section">
              <div className="panel-head"><div><p className="kicker">Cuentas autorizadas · últimos 30 días</p><h2 className="title-m">Por persona</h2></div></div>
              {users.length ? <div className="usage-breakdown">
                {users.map((user) => <div className="usage-row" key={user.email}><div><strong>{user.email}</strong><span>Reserva histórica: {bytes(user.historical)} · no equivale a entrega</span></div><b>{bytes(user.measured)}</b></div>)}
              </div> : <p className="subtle">Aún no hay actividad en el período conservado.</p>}
            </section>

            <section className="notice notice-warn usage-note section">
              <span className="notice-icon"><Icon name="info" /></span>
              <div><strong>Cómo interpretar este reporte.</strong> “Completas” significa que el navegador terminó de leer una respuesta, no que alguien vio el video entero. La red puede retransmitir paquetes fuera de esta medición; solo Google puede conocer ese tráfico de infraestructura. Los límites actuales son aviso personal {bytes(settings?.user_warning_bytes ?? 25 * 1024 ** 3)}, aviso global {bytes(settings?.global_warning_bytes ?? 150 * 1024 ** 3)} y fusible {bytes(settings?.global_emergency_bytes ?? 750 * 1024 ** 3)}.</div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
