"use client";

import { useEffect } from "react";

import { registerDriveWorker } from "@/lib/media/drive-worker";

/**
 * Instala el canal seguro antes de que alguien abra una lección o una película.
 * No solicita tokens ni puede leer Drive: solo evita que la primera reproducción
 * pague el coste de instalar y activar el Service Worker.
 */
export function DriveWorkerWarmup() {
  useEffect(() => {
    void registerDriveWorker()?.catch(() => undefined);
  }, []);

  return null;
}