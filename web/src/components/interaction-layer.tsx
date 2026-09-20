"use client";

import { useEffect } from "react";

/**
 * Micro-interacciones delegadas: un solo listener para toda la app en lugar de
 * un componente cliente por tarjeta. Tarjetas con [data-tilt] se inclinan y
 * siguen el cursor; los .btn emiten una onda desde el punto de pulsación.
 */
export function InteractionLayer() {
  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active: HTMLElement | null = null;
    let frame = 0;

    const reset = (element: HTMLElement) => {
      element.style.removeProperty("--rx");
      element.style.removeProperty("--ry");
      delete element.dataset.tilting;
    };

    const onMove = (event: PointerEvent) => {
      if (!finePointer.matches || reduced.matches || event.pointerType !== "mouse") return;
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-tilt]") ?? null;
      if (active && active !== target) reset(active);
      active = target;
      if (!target) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const strength = Number(target.dataset.tilt) || 7;
        target.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        target.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
        target.style.setProperty("--rx", `${((0.5 - y) * strength).toFixed(2)}deg`);
        target.style.setProperty("--ry", `${((x - 0.5) * strength).toFixed(2)}deg`);
        target.dataset.tilting = "";
      });
    };

    const onLeaveWindow = () => {
      if (active) reset(active);
      active = null;
    };

    const onDown = (event: PointerEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLElement>(".btn");
      if (!button || button.matches(":disabled")) return;
      const rect = button.getBoundingClientRect();
      button.style.setProperty("--px", `${event.clientX - rect.left}px`);
      button.style.setProperty("--py", `${event.clientY - rect.top}px`);
      delete button.dataset.ripple;
      void button.offsetWidth;
      button.dataset.ripple = "";
      window.setTimeout(() => { delete button.dataset.ripple; }, 600);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeaveWindow);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeaveWindow);
    };
  }, []);

  return null;
}
