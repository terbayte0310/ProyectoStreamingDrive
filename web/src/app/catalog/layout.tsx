import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";

/**
 * La cabecera vive aquí y no en cada página: un layout no se desmonta al navegar
 * entre Cursos, Películas, Series y sus fichas. Así el navbar permanece mientras
 * el esqueleto de carga sustituye solo el contenido de debajo, y la píldora activa
 * se desliza de una pestaña a otra en lugar de reaparecer.
 */
export default function CatalogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <SiteHeader />
      {children}
    </div>
  );
}
