# Fase 2 — sincronización integral de Google Drive

**Inicio:** 7 de septiembre de 2026
**Estado:** checkpoints 2A y 2B validados; 2C en implementación.
**Commit base estable:** `f21967c`

Este documento es el punto de reanudación de la fase. Debe actualizarse después de cada checkpoint y antes de terminar una sesión.

## Objetivo

Convertir el importador piloto de AWS en una sincronización completa, repetible e idempotente de `100_BIBLIOTECA_DE_CURSOS`, sin modificar archivos de Drive y sin destruir personalizaciones, progreso ni notas.

## Situación inicial

- `GOOGLE_DRIVE_ROOT_FOLDER_ID` apunta temporalmente a la carpeta `AWS`.
- `importAwsPilotCatalog` trata esa carpeta como una categoría fija y escribe en Supabase mientras recorre Drive.
- Una ejecución repetida actualiza elementos existentes por `drive_item_id`, pero no detecta ausencias.
- Un fallo a mitad del recorrido puede dejar una mezcla de datos nuevos y antiguos.
- Secciones y lecciones ya separan `detected_position` de `position`: una resincronización no debe sobrescribir el orden manual.
- Los nombres detectados y personalizados ya están separados en `detected_title` y `custom_title`.

## Jerarquía contractual

```text
100_BIBLIOTECA_DE_CURSOS   ← library_source / raíz configurada
├── AWS                    ← category
│   ├── Curso A            ← course
│   │   ├── 01 Introducción.mp4       ← lesson raíz
│   │   └── Módulo 1                  ← course_section
│   │       ├── 01 Lección.mp4        ← lesson
│   │       └── Recursos              ← course_section anidada
│   └── Curso B
└── Otra categoría
```

Reglas iniciales:

- Las carpetas directamente bajo la raíz son categorías.
- Las carpetas directamente bajo una categoría son cursos.
- Dentro de un curso, cualquier carpeta es una sección y puede anidarse.
- Archivos `video/*` y `audio/*` dentro de un curso son lecciones.
- Archivos conocidos como basura (`desktop.ini`, `.DS_Store`, `Thumbs.db` y nombres ocultos) quedan `ignored`.
- Otros archivos se inventarían como `unsupported`; no se borran ni se convierten todavía en lecciones.
- Los archivos sueltos en la raíz o directamente dentro de una categoría son conflictos estructurales y se registran, no se adivina su destino.

## Invariantes no negociables

1. **Drive es de solo lectura.** La sincronización nunca renombra, mueve ni elimina archivos.
2. **Identidad estable.** `source_id + drive_file_id` identifica el mismo elemento aunque cambie de nombre o carpeta.
3. **Idempotencia.** Dos snapshots iguales producen el mismo catálogo, sin duplicados ni cambios de orden manual.
4. **Personalizaciones protegidas.** Nunca se sobrescriben `custom_title`, metadatos administrativos, `position` manual ni `is_visible` manual.
5. **Datos privados protegidos.** No se eliminan filas de lecciones por ausencia; así sobreviven `lesson_progress` y `lesson_notes`.
6. **Ausencia no equivale a borrado.** Un elemento no visto en un snapshot completo pasa a `drive_items.status = 'missing'`.
7. **No hay falsos ausentes.** Solo se marcan ausencias después de completar todo el escaneo de Drive.
8. **Publicación atómica.** El catálogo visible cambia dentro de una única transacción de PostgreSQL.
9. **Fallo observable.** Cada ejecución termina como `completed` o `failed`, con contadores y un resumen seguro, sin tokens.
10. **Una fuente, una ejecución activa.** Debe impedirse que dos sincronizaciones de la misma biblioteca se pisen.

## Arquitectura escogida

### Paso A — escaneo sin mutar el catálogo

El servidor recorre Drive y construye un snapshot normalizado en memoria. Cada entrada contiene como mínimo:

- `driveFileId`
- `parentDriveFileId`
- `kind`: `root | category | course | section | lesson | ignored | unsupported | conflict`
- `name`, `mimeType`, `size`, `modifiedTime`
- `detectedPosition`
- referencias lógicas a categoría, curso y sección padre mediante IDs de Drive

Si Drive falla, el snapshot se descarta y el catálogo no cambia.

### Paso B — reconciliación atómica

Una función PostgreSQL recibe el snapshot JSON y, en una sola transacción:

1. Bloquea la fuente para evitar ejecuciones simultáneas.
2. Inserta o actualiza `drive_items` por `(source_id, drive_file_id)`.
3. Marca como `missing` solamente los elementos anteriores no presentes en el snapshot completo.
4. Reconcilia categorías, cursos, secciones y lecciones conservando campos manuales.
5. Actualiza la ejecución y la fuente como `completed`.

La API no debe intentar simular una transacción con muchas llamadas independientes a Supabase.

## Política ante cambios

| Cambio en Drive | Resultado esperado |
| --- | --- |
| Archivo/carpeta nuevo | Se crea con título y posición detectados. |
| Renombrado | Cambian `detected_name`/`detected_title`; `custom_title` permanece. |
| Movido dentro del mismo curso | Cambian padre y `detected_position`; el orden manual existente permanece. |
| Lección movida a otro curso | Se conserva la identidad de la lección y sus datos privados; cambia su relación de catálogo. |
| Elemento ausente | `drive_items.status = 'missing'`; no se elimina la entidad asociada. |
| Elemento reaparece | Vuelve a `available` conservando personalizaciones y datos privados. |
| Tipo no reproducible | `unsupported`; se muestra en resultados de sincronización, no en el reproductor. |
| Estructura ambigua | `conflict`; no se convierte silenciosamente en categoría/curso/lección. |

## Cambios de esquema previstos

- Añadir posiciones detectadas a categorías y cursos si sus órdenes también serán editables.
- Ampliar los resultados de `catalog_sync_runs` con contadores de nuevos, actualizados, ausentes, restaurados, no compatibles y conflictos.
- Crear una función RPC de reconciliación atómica.
- Hacer que catálogo y reproductor excluyan entidades cuyo `drive_item` no esté `available`, sin modificar `is_visible`.
- Mantener las filas históricas para recuperar progreso y notas si el archivo reaparece.

## Transición del piloto a la raíz completa

No se debe crear otra `library_source` al cambiar la variable de `AWS` a `100_BIBLIOTECA_DE_CURSOS`. La transición debe conservar el `id` de la fuente piloto y actualizar únicamente su `drive_root_folder_id` y su nombre antes de publicar el primer snapshot completo.

Esto permite que el ID de Drive de la carpeta `AWS`, que hoy representa la raíz/categoría piloto, pase a ser la categoría `AWS` de la biblioteca completa dentro de la misma fuente. Los cursos y lecciones ya importados conservan sus `drive_item_id`, personalizaciones, progreso y notas. Crear una fuente nueva duplicaría todo el catálogo AWS.

## Checkpoints

### 2A — snapshot puro y probado

- [x] Extraer el recorrido de Drive a un módulo que no escribe en Supabase.
- [x] Modelar clasificación y jerarquía completa.
- [x] Probar paginación, orden natural, carpetas anidadas, ignorados, no compatibles, conflictos y ciclos.

Implementación: `src/lib/drive/library-snapshot.ts`. El módulo recibe `listChildren` como dependencia, lo que permite probar la interpretación del árbol sin red ni base de datos. `listDriveChildren` resuelve todas las páginas de la API y nunca incluye el token en la URL o en errores.

Pruebas: `test/library-snapshot.test.ts`. Al terminar 2A existen 8 pruebas totales en el proyecto y pasan junto con lint y build.

### Registro de prueba 2B

- Primer intento de `atomic_library_sync_test.sql`: falló con `42P07 relation "sync_snapshot" already exists` en la segunda llamada.
- Causa: el arnés ejecuta cuatro RPC dentro de una sola transacción para revertir fixtures; `ON COMMIT DROP` conserva la tabla temporal hasta el `ROLLBACK`. En producción cada petición/RPC usa una transacción independiente.
- Corrección: el arnés elimina `pg_temp.sync_snapshot` entre llamadas. La función instalada y los datos reales no se modificaron.
- Seguridad: el error abortó la transacción inicial, por lo que no quedaron fixtures.

### 2B — reconciliación transaccional

- [x] Redactar migración y RPC atómica (`20260907230000_atomic_library_sync.sql`).
- [x] Aplicar la migración en Supabase (`Success. No rows returned`).
- [x] Ejecutar pruebas transaccionales controladas (`Success. No rows returned`).
- [x] Preservar campos manuales y datos privados.
- [x] Marcar ausentes y restaurados sin borrar entidades.
- [x] Probar dos ejecuciones idénticas y una ejecución con cambios.

### 2C — operación administrativa

- [x] Crear endpoint exclusivo para administrador usando la sesión renovable de Drive.
- [ ] Añadir acción de sincronización y mostrar ejecución, estado y contadores.
- [x] Impedir ejecuciones concurrentes mediante índice único y respuesta `409`.

El endpoint es `POST /api/drive-token/sync` y acepta `{ "mode": "preview" }` o `{ "mode": "publish" }`. Está bajo `/api/drive-token` para recibir las cookies de Drive sin ampliar su alcance. Siempre obtiene un token nuevo antes del recorrido. `preview` no escribe catálogo; `publish` exige `confirmRootChange: true` cuando la raíz configurada difiere de la fuente existente.

La publicación usa la sobrecarga RPC de `20260907234000_atomic_source_root_transition.sql`: reconciliación y transición de raíz pertenecen a la misma transacción.

### 2D — validación real y retiro del piloto

- [ ] Cambiar `GOOGLE_DRIVE_ROOT_FOLDER_ID` de `AWS` a `100_BIBLIOTECA_DE_CURSOS`.
- [ ] Ejecutar primero un escaneo/previsualización sin publicar.
- [ ] Publicar la sincronización completa y revisar conflictos.
- [ ] Repetir sin cambios y comprobar idempotencia.
- [ ] Renombrar/mover/agregar un elemento de prueba en Drive y comprobar reconciliación.
- [ ] Consolidar o retirar rutas experimentales del importador piloto.

## Archivos principales

- `src/lib/drive/catalog-importer.ts`: importador piloto que se reemplazará gradualmente.
- `src/lib/drive/library-snapshot.ts`: escáner puro y paginado implementado en 2A.
- `test/library-snapshot.test.ts`: contrato ejecutable de clasificación y jerarquía.
- `src/lib/drive/session.ts`: renovación segura de Drive en servidor.
- `src/app/api/drive/diagnostic-import/callback/route.ts`: entrada temporal del importador piloto.
- `supabase/migrations/20260906230000_catalog_foundation.sql`: esquema base.
- `supabase/migrations/20260907160000_atomic_outline_reorder.sql`: separación de orden detectado/manual.
- `docs/ESTADO_Y_BACKLOG.md`: estado general del producto.

## Siguiente acción exacta

Aplicar `supabase/migrations/20260907234000_atomic_source_root_transition.sql`, ejecutar pruebas/lint/build y después construir el panel administrativo de previsualización. No cambiar todavía la variable raíz ni publicar sobre el catálogo real.
