# Estado, alcance y veredicto

## Qué funciona hoy

- Inicio de sesión únicamente con Google mediante Supabase.
- Separación entre usuario autenticado, usuario autorizado y administrador.
- Catálogo real con categorías, cursos, progreso y continuación.
- Reproducción directa desde Drive mediante Service Worker y peticiones `Range`.
- Renovación del token de Drive después de un `401`.
- Progreso por usuario, reanudación, notas por segundo y paso a la siguiente lección.
- Sincronización atómica que conserva identidad de Drive, personalizaciones, progreso y notas.
- Orden jerárquico probado, normalización de títulos e inventario de códecs.
- RLS habilitado y separación básica de información por usuario.
- Interfaz clara/oscura renovada para login, catálogo y reproductor.

En la auditoría, una lección real alcanzó `readyState = 4`, informó 163,96 segundos de duración y no produjo errores de consola. `npm test`, `npm run lint`, `npm run build` y `npm audit` finalizaron correctamente; existen 20 pruebas Node y no se encontraron vulnerabilidades conocidas en las dependencias instaladas.

## Qué significa el veredicto

Para estudiar hoy uno de los cuatro cursos publicados desde el Chrome de este PC, la aplicación es utilizable. Para considerarla completa según el alcance documentado —biblioteca masiva, teléfono, progreso fiable, búsqueda y operación cotidiana— todavía faltan bloqueadores.

## Bloqueadores de salida

| Prioridad | Problema | Efecto |
| --- | --- | --- |
| P0 | Consultas de catálogo y administración sin paginación | Más de 1.000 lecciones pueden truncarse silenciosamente. |
| P0 | Catálogo publicado muy por detrás de Drive | 25 cursos subidos aún no aparecen; otros 44 cursos siguen solo en disco. |
| P0 | Sincronización síncrona de 6,8 minutos | Una caída obliga a recomenzar y un host serverless puede agotar su tiempo. |
| P1 | `lesson_progress.updated_at` no se actualiza | “Continuar viendo” puede ordenar por una fecha antigua. |
| P1 | No existe despliegue HTTPS estable | El teléfono no puede depender de `localhost` y el Service Worker exige contexto seguro. |
| P1 | Logout no limpia Drive ni el Service Worker | Las credenciales pueden sobrevivir al cierre de sesión. |

## Deuda de producto, no bloqueante para cuatro cursos

- No existe búsqueda.
- Las portadas automáticas son composiciones CSS, no fotogramas persistentes.
- Recursos, PDF, subtítulos y archivos de ejercicios no aparecen en la experiencia de curso.
- El administrador conserva la interfaz anterior y carga demasiados elementos juntos.
- No hay vista de curso con módulos expandibles ni progreso por sección.
- Autoplay no ofrece preferencia persistente ni cuenta regresiva.
- No hay exportación, edición o eliminación de notas.
- Siguen presentes rutas piloto y páginas de diagnóstico.

## Principio de implementación

No solucionar la escala aumentando el límite global de filas de Supabase. Reducir cada consulta al mínimo necesario, agregar en PostgreSQL y paginar explícitamente. La interfaz de inicio necesita resúmenes por curso; las lecciones completas solo deben cargarse al abrir un curso.

