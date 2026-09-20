"use client";

import { useEffect, useState } from "react";

import { Icon, type IconName } from "@/components/icons";

type ToastKind = "error" | "info" | "success" | "warn";
type ToastItem = { id: number; kind: ToastKind; leaving?: boolean; message: string };

const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];
let nextId = 1;

function publish(next: ToastItem[]) {
  items = next;
  listeners.forEach((listener) => listener(items));
}

function dismiss(id: number) {
  publish(items.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
  window.setTimeout(() => publish(items.filter((item) => item.id !== id)), 240);
}

/** Muestra una notificación efímera desde cualquier componente cliente. */
export function toast(message: string, kind: ToastKind = "info", durationMs = kind === "error" ? 7000 : 4200) {
  const id = nextId++;
  publish([...items.slice(-3), { id, kind, message }]);
  window.setTimeout(() => dismiss(id), durationMs);
  return id;
}

const marks: Record<ToastKind, IconName> = { error: "warning", info: "info", success: "check", warn: "warning" };

export function Toaster() {
  const [current, setCurrent] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setCurrent);
    return () => { listeners.delete(setCurrent); };
  }, []);

  return (
    <div aria-live="polite" className="toaster" role="status">
      {current.map((item) => (
        <div className={`toast toast-${item.kind}`} data-leaving={item.leaving ? "" : undefined} key={item.id} role={item.kind === "error" ? "alert" : undefined}>
          <span className="toast-mark"><Icon name={marks[item.kind]} strokeWidth={2.4} /></span>
          <p>{item.message}</p>
          <button aria-label="Cerrar notificación" onClick={() => dismiss(item.id)} type="button"><Icon name="close" width={14} /></button>
        </div>
      ))}
    </div>
  );
}
