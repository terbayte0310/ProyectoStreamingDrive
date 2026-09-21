"use client";

import { useEffect } from "react";

import { toast } from "@/components/toaster";

const noticeKinds = ["counter-unavailable", "drive-unavailable", "emergency-fuse", "global-warning", "user-warning"] as const;

type NoticeKind = typeof noticeKinds[number];
type Notice = { kind: NoticeKind; limitBytes?: number };

function formatGiB(bytes: number | undefined, fallback: number) {
  return Math.round((bytes ?? fallback * 1024 ** 3) / 1024 ** 3);
}

function messageFor(notice: Notice) {
  switch (notice.kind) {
    case "counter-unavailable": return "La medición está temporalmente indisponible. La transferencia no comenzó; inténtalo nuevamente en unos minutos.";
    case "drive-unavailable": return "Google Drive está temporalmente indisponible. Nébula aplicó reintentos acotados sin multiplicar el tráfico.";
    case "emergency-fuse": return `El fusible global de ${formatGiB(notice.limitBytes, 750)} GiB detuvo nuevas transferencias. Las reproducciones ya iniciadas pueden terminar.`;
    case "global-warning": return `La biblioteca superó ${formatGiB(notice.limitBytes, 150)} GiB en reservas de rango en 24 horas. Es solo un aviso preventivo: puedes continuar reproduciendo.`;
    case "user-warning": return `Se solicitaron más de ${formatGiB(notice.limitBytes, 25)} GiB en rangos en 24 horas. Es un aviso preventivo, no una medición de consumo real de Drive.`;
  }
}

/** Traduce los avisos del service worker a toasts. */
export function TransferUsageNotice() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "transfer-usage-notice" || typeof event.data.kind !== "string" || !noticeKinds.includes(event.data.kind as NoticeKind)) return;
      const notice: Notice = {
        kind: event.data.kind as NoticeKind,
        limitBytes: Number(event.data.warningLimitBytes ?? event.data.emergencyLimitBytes) || undefined,
      };
      const blocking = notice.kind === "counter-unavailable" || notice.kind === "drive-unavailable" || notice.kind === "emergency-fuse";
      toast(messageFor(notice), blocking ? "error" : "warn", blocking ? 9000 : 6000);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  return null;
}
