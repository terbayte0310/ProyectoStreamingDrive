# Validación de cierre — fase 1

**Fecha:** 7 de septiembre de 2026
**Objetivo:** cerrar autenticación, reproducción, renovación de Drive, progreso, notas y aislamiento antes de comenzar la sincronización integral.

## Resultado actual

| Área | Prueba | Resultado |
| --- | --- | --- |
| Calidad automática | `npm test` | 4/4 pruebas aprobadas. |
| Calidad automática | `npm run lint` | Sin errores. |
| Calidad automática | `npm run build` | Compilación de producción aprobada. |
| Reproducción | Abrir una lección real desde el catálogo | Video listo, duración 1113.578 s y reproducción desde Drive confirmada. |
| Progreso | Reproducir, pausar y recargar | Posición guardada alrededor de 29 s y restaurada en 30 s. |
| Notas | Guardar y recargar | Nota de control persistida en el segundo 0:29. |
| Sesión expirada | Solicitudes sin cookies a `/`, `/catalog`, `/admin` y `/api/drive-token` | Páginas privadas redirigen a `/signin`; API responde 401. |
| Renovación directa | Solicitar renovación forzada con la sesión real | Google entregó un nuevo token; no se registró ni mostró su valor. |
| Renovación tras 401 | Inyectar un token inválido solo en memoria y pedir un rango | El Worker recibió 401, renovó y el reintento devolvió `206 Partial Content`. |
| Aislamiento | Construir una cola con lecciones mezcladas de dos cursos | La cola conserva únicamente el curso solicitado; prueba automática aprobada. |
| Cuenta lectora | Repetir reproducción, progreso y notas con el perfil de prueba | Reproducción correcta; progreso y nota persisten tras recargar; la administración no aparece. |
| Permiso revocado | Revocar acceso en Google y comprobar el error recuperable | Google rechazó la credencial antigua; el servidor devolvió 401, limpió las cookies y el reproductor pidió autorizar Drive. |
| Recuperación | Autorizar Drive nuevamente y repetir reproducción y renovación tras 401 | Reproducción restaurada y reintento `206 Partial Content` aprobado. |

## Evidencia de aislamiento

La consulta del reproductor ya limita lecciones y secciones por `course_id`. Además, `buildCoursePlaybackQueue` vuelve a filtrar ambos conjuntos antes de calcular “siguiente”, de modo que una consulta accidentalmente mezclada tampoco puede saltar a otro curso.

## Datos de control

Se creó esta nota real para comprobar persistencia:

```text
[CIERRE FASE 1] Nota de validación E2E — 2026-09-07
```

Permanece en la lección `1. Ejecuta tu función Lambda dentro de una VPC.mp4`, segundo 0:29, como evidencia manual identificable.

## Criterio para crear el commit estable

El cierre quedó completo:

1. La cuenta lectora reproduce, guarda progreso y conserva una nota después de recargar.
2. Una autorización revocada produce un mensaje comprensible, elimina las cookies de Drive inválidas y permite volver a autorizar.
3. La reautorización recupera la reproducción y la renovación automática.
4. Las pruebas, lint y build permanecen en verde.
