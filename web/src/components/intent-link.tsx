"use client";

import Link from "next/link";
import { type ComponentProps, useEffect, useRef, useState } from "react";

const dwellMs = 700;

/**
 * Enlace que precarga la página completa en cuanto hay intención de abrirla:
 * ratón encima, foco de teclado o primer toque.
 *
 * Por defecto Next solo precarga hasta el esqueleto de una ruta dinámica, así
 * que al pulsar la animación no puede empezar hasta que llegan los datos del
 * servidor. Con la página ya en caché, la transición y el morfismo de la portada
 * arrancan al instante. Precargar así todas las tarjetas de un catálogo sería
 * demasiado; por eso solo se hace para la que el usuario está a punto de abrir.
 *
 * En pantallas táctiles no hay «ratón encima». Con `dwellPrefetch`, una tarjeta
 * que permanece visible y quieta durante un momento se considera candidata y se
 * precarga: quien la toca justo después la abre sin esperar.
 */
export function IntentLink({ dwellPrefetch = false, onFocus, onPointerDown, onPointerEnter, prefetch = null, ...props }: ComponentProps<typeof Link> & { dwellPrefetch?: boolean }) {
  const [intent, setIntent] = useState(false);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!dwellPrefetch || intent || !node || !window.matchMedia("(hover: none)").matches) return;
    let timer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timer);
      if (entry?.isIntersecting) timer = window.setTimeout(() => setIntent(true), dwellMs);
    }, { threshold: 0.85 });
    observer.observe(node);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [dwellPrefetch, intent]);

  return (
    <Link
      {...props}
      onFocus={(event) => { setIntent(true); onFocus?.(event); }}
      onPointerDown={(event) => { setIntent(true); onPointerDown?.(event); }}
      onPointerEnter={(event) => { setIntent(true); onPointerEnter?.(event); }}
      prefetch={intent ? true : prefetch}
      ref={ref}
    />
  );
}
