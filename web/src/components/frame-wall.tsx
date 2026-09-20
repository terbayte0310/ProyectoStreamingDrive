import type { CSSProperties } from "react";

import { CourseCover } from "@/components/course-cover";

// Fotogramas generativos: no requieren sesión ni red, así que la pantalla de
// acceso se anima desde el primer byte.
const labels = [
  ["Cine de autor", "Películas"], ["Temporada 1", "Series"], ["Diseño esencial", "Cursos"], ["Noche de estreno", "Películas"],
  ["Episodio piloto", "Series"], ["Fotografía", "Cursos"], ["Clásicos", "Películas"], ["Animación", "Series"],
  ["Programación", "Cursos"], ["Documental", "Películas"], ["Final de temporada", "Series"], ["Música", "Cursos"],
];

export function FrameWall() {
  const columns = [0, 1, 2, 3].map((column) => labels.filter((_, index) => index % 4 === column));
  return (
    <div aria-hidden="true" className="frame-wall">
      {columns.map((items, column) => (
        <div className="frame-column" key={column} style={{ "--speed": `${70 + column * 18}s` } as CSSProperties}>
          {/* Se duplica la columna para que el bucle sea continuo. */}
          {[...items, ...items, ...items, ...items].map(([title, category], index) => (
            <div className="frame" key={`${title}-${index}`} style={{ "--ratio": (index + column) % 3 === 0 ? "16 / 10" : "2 / 3" } as CSSProperties}>
              <CourseCover category={category} showLabel={false} title={`${title} ${index % 3}`} />
              <span className="frame-label">{category}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
