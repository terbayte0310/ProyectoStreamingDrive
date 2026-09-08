# Fase 2 — sincronización integral de Google Drive

**Inicio:** 7 de septiembre de 2026
**Estado:** biblioteca completa publicada, reproducible e idempotente; secciones auxiliares y títulos normalizados; inventario de códecs y tamaños disponible en el panel admin. Falta retirar rutas piloto.
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

Regla refinada para secciones dentro de un curso:

- Una carpeta se presenta como sección solamente si contiene, de forma directa o en un descendiente, al menos una lección reproducible.
- Una carpeta sin lecciones reproducibles (por ejemplo, `Subtitles` o `Recursos`) se conserva en el inventario como `unsupported`, pero no se presenta como módulo del curso.

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
- [x] Añadir acción de previsualización/publicación y mostrar estado y contadores.
- [x] Impedir ejecuciones concurrentes mediante índice único y respuesta `409`.

El endpoint es `POST /api/drive-token/sync` y acepta `{ "mode": "preview" }` o `{ "mode": "publish" }`. Está bajo `/api/drive-token` para recibir las cookies de Drive sin ampliar su alcance. Siempre obtiene un token nuevo antes del recorrido. `preview` no escribe catálogo y devuelve una huella SHA-256 del snapshot. `publish` exige esa misma huella, vuelve a recorrer Drive y rechaza la operación si algo cambió; también exige `confirmRootChange: true` cuando la raíz configurada difiere de la fuente existente.

La publicación usa la sobrecarga RPC de `20260907234000_atomic_source_root_transition.sql`: reconciliación y transición de raíz pertenecen a la misma transacción.

#### Validación real con la raíz piloto

El 7 de septiembre de 2026 se ejecutó `Previsualizar` desde `/admin` con la sesión real de Drive. El recorrido terminó correctamente y mostró:

- 1 categoría, 6 cursos, 0 secciones y 37 lecciones.
- 5 archivos no compatibles, 0 conflictos y 1 archivo ignorado.
- Aviso explícito de que `GOOGLE_DRIVE_ROOT_FOLDER_ID` todavía apunta a la carpeta piloto AWS.
- Ningún botón de publicación disponible (`0` coincidencias en la interfaz).

Estos conteos **no representan todavía la jerarquía final**: al usar AWS como raíz, sus cursos se interpretan como categorías y sus secciones como cursos. La prueba únicamente confirma que el escaneo real funciona y que tanto la interfaz como el servidor impiden publicar esa interpretación incorrecta. `preview` no realizó escrituras en el catálogo.

La interfaz solo conserva el bloqueo mientras la raíz configurada siga siendo la misma raíz piloto. Cuando `.env.local` apunte a la biblioteca completa, mostrará la confirmación de transición. La publicación queda vinculada criptográficamente a la última previsualización; un cambio intermedio en Drive obliga a revisar los contadores otra vez.

#### Validación real con la raíz completa

Después de cambiar `GOOGLE_DRIVE_ROOT_FOLDER_ID`, la previsualización real del 7 de septiembre de 2026 devolvió:

- 2 categorías, 4 cursos, 23 secciones y 144 lecciones reproducibles.
- 0 conflictos estructurales, 70 elementos no compatibles y 1 ignorado.
- Transición de la fuente piloto detectada correctamente; el botón de publicación existe, pero permanece deshabilitado hasta la confirmación explícita.

Se añadió al panel un informe desplegable con nombre, ruta completa y MIME de cada elemento señalado. La revisión de los 70 no compatibles encontró 59 subtítulos `.srt`, 1 RAR, 1 imagen WebP, 1 PDF, 3 accesos `.url` y 5 textos; **no hay videos descartados por formato**. Estos materiales no entran en la cola de reproducción. Algunas carpetas que solo agrupan recursos o subtítulos sí cuentan hoy como secciones administrativas; es una mejora de presentación posterior, no un riesgo para la publicación atómica ni para las lecciones.

#### Publicación e idempotencia reales

La primera publicación completó la ejecución `f0e6c5e5-192e-46a3-a958-b72506a000df`. El catálogo mostró exactamente las 2 categorías y los 4 cursos previstos. Se abrió y reprodujo una lección de Adobe; el avance quedó guardado y la tarjeta pasó a ofrecer `Continuar viendo`.

El curso AWS mantuvo sus 37 lecciones, el progreso previo, la lección reanudable y las dos notas existentes. Esto confirma que la transición promovió la misma fuente y conservó los IDs, en vez de duplicar el piloto.

Se repitieron previsualización y publicación sin cambios. Los conteos permanecieron en 2 categorías, 4 cursos, 23 secciones y 144 lecciones, y la ejecución `f2474874-7fb9-4a39-897b-bc6b8d2b14b7` terminó correctamente. El catálogo continuó mostrando solo cuatro cursos: idempotencia real validada.

Durante esta validación se encontró que `router.refresh()` entregaba datos nuevos al panel, pero `AdminCourseManager` conservaba sus estados iniciales. La página ahora calcula una revisión de los datos recibidos y la usa como `key`: React recrea el editor únicamente cuando el catálogo servido cambia, sin efectos que dupliquen renders.

La primera prueba de Adobe también reveló que el botón `Empezar curso` elegía entre lecciones ordenadas solo por `position`. Como esa posición es local a cada sección, abrió el módulo 3 en vez del primero. El catálogo ahora usa `buildCoursePlaybackQueue`, el mismo recorrido jerárquico y aislado por curso que usa el reproductor; comenzar, repasar y buscar la primera lección pendiente respetan el orden real de secciones y lecciones.

La regresión se comprobó con `Animación Tipográfica Con After Effects`, que no tenía progreso: `Empezar curso` abrió `1806-01 - Presentación`, y la cola visible continuó ordenada hasta `1806-18`.

### 2D — validación real y retiro del piloto

- [x] Cambiar `GOOGLE_DRIVE_ROOT_FOLDER_ID` de `AWS` a `100_BIBLIOTECA_DE_CURSOS`.
- [x] Ejecutar primero un escaneo/previsualización sin publicar.
- [x] Publicar la sincronización completa y revisar conflictos.
- [x] Repetir sin cambios y comprobar idempotencia.
- [x] Renombrar un elemento auxiliar en Drive y comprobar que conserva identidad, jerarquía y lecciones.
- [x] Restaurar el nombre original y comprobar una segunda reconciliación.
- [ ] Consolidar o retirar rutas experimentales del importador piloto.

### 2E — secciones semánticas

- [x] Detectar en el snapshot las carpetas auxiliares sin lecciones reproducibles descendientes.
- [x] Mantener esos elementos en el informe de sincronización, incluidos sus nombres, rutas y MIME.
- [x] Preparar la migración `20260908010000_hide_auxiliary_sections.sql`.
- [x] Aplicar `20260908010000_hide_auxiliary_sections.sql` en Supabase y confirmar `Success. No rows returned`.
- [x] Recargar el esquema de la API con `20260908010100_reload_postgrest_schema.sql`.
- [x] Previsualizar y publicar de nuevo la biblioteca; verificar que los módulos auxiliares ya no se muestran y que las lecciones siguen siendo 144.

La migración añade `course_sections.is_detected_section`. Esta marca es automática y representa la interpretación vigente de Drive; no sustituye `is_visible`, que sigue siendo la decisión manual del administrador. Las filas históricas de `Subtitles`, `Recursos` u otra carpeta auxiliar se marcan como no detectadas en vez de borrarse. De este modo se preservan referencias y personalizaciones, pero catálogo, reproductor y editor no las incorporan al árbol visible.

#### Validación real de secciones semánticas

El 8 de septiembre de 2026 se aplicaron las migraciones de marca semántica y de recarga del esquema de Supabase. La previsualización real devolvió 2 categorías, 4 cursos, **16 secciones**, 144 lecciones, 77 elementos auxiliares/no compatibles, 0 conflictos y 1 ignorado. La publicación `a80bde25-5882-474b-93bc-30d6bdacb1f4` terminó correctamente.

La vista renovada de catálogo confirmó el resultado sin alterar datos privados: Adobe pasó de 11 a 5 secciones y AWS de 6 a 5; Animación conserva 5 y DaVinci 1. Las cuatro tarjetas siguen sumando 144 lecciones, Adobe mantiene avance 1/41 y AWS 1/37. Las carpetas auxiliares no se eliminaron de Drive ni del inventario.

#### Validación controlada de cambio en Drive — primer sentido

El 8 de septiembre de 2026 se renombró manualmente la carpeta auxiliar `Subtitles` del curso Adobe a `Subtitles - PRUEBA`, sin moverla. La previsualización conservó exactamente 2 categorías, 4 cursos, 16 secciones, 144 lecciones, 77 auxiliares/no compatibles, 0 conflictos y 1 ignorado. El informe mostró el nombre y la ruta nuevos, incluidos todos los descendientes, y la publicación `50f016e1-2987-4a65-a441-afd304c82cbd` terminó correctamente.

Esto confirma que la identidad se apoya en el ID estable de Drive, no en el nombre: el catálogo actualiza el inventario del elemento sin crear duplicados ni perder datos privados.

#### Validación controlada de cambio en Drive — recorrido inverso

La carpeta se restauró manualmente a `Subtitles`. La segunda previsualización mantuvo los mismos contadores: 2 categorías, 4 cursos, 16 secciones, 144 lecciones, 77 auxiliares/no compatibles, 0 conflictos y 1 ignorado. La publicación `4ac7a8ea-8bb3-40b8-9405-4a59c02865f5` terminó correctamente.

Con los dos sentidos publicados, se validó que un renombrado reversible de Drive actualiza y restaura el inventario por identidad estable, sin duplicar entidades ni modificar el orden manual, progreso, notas o la cola de reproducción.

### 2F — normalización de títulos y códecs/tamaños

- [x] Separar `detected_name` (nombre crudo de Drive, para identidad/auditoría) de `detected_title` (título normalizado mostrado en catálogo).
- [x] Añadir `normalizeDetectedTitle` (`src/lib/drive/title-normalization.ts`): quita extensión, quita un prefijo numérico inequívoco (`01 - `, `001.`), convierte `_`/`-` a espacio solo cuando unen palabras (no cuando ya se usan como separador visual, p. ej. `"Módulo 1 - Fundamentos"` permanece igual), y nunca toca mayúsculas ni siglas.
- [x] Migrar `reconcile_library_snapshot` (`20260908020000_normalize_detected_titles.sql`) para que `categories`, `courses`, `course_sections` y `lessons` usen `detected_title` normalizado; `drive_items.detected_name` sigue siendo el nombre real de Drive.
- [x] Ampliar `listDriveChildren` con `videoMediaMetadata(durationMillis,width,height)` y añadir `buildCodecInventory` (`src/lib/drive/codec-inventory.ts`): agrupa lecciones por contenedor y separa `safeContainers` (MP4/AAC ya validados) de `reviewContainers`.
- [x] Añadir sondeo real opcional con `ffprobe` (`src/lib/drive/codec-probe.ts`), acotado a los contenedores de `reviewContainers` (nunca a toda la biblioteca), con degradación explícita si `ffprobe` no está instalado localmente.
- [x] Exponer todo en el panel admin: nuevo modo `codec-inventory` en `POST /api/drive-token/sync` (solo lectura, no toca `library_sources` ni `catalog_sync_runs`) y el componente `CodecInventoryPanel`.
- [ ] Publicar de nuevo la biblioteca real (tras aplicar la migración `20260908020000` en Supabase) y confirmar visualmente que los títulos ya no muestran prefijos numéricos ni guiones bajos, y que un curso con `custom_title` ya definido no cambia.
- [x] Ejecutar "Sondear códecs a revisar" contra la biblioteca real con `ffprobe` instalado.

#### Validación real del sondeo de códecs

El 8 de septiembre de 2026 se ejecutó "Sondear códecs a revisar" contra la biblioteca real. `buildCodecInventory` separó correctamente 96 lecciones `video/mp4` (5.82 GB, contenedor seguro) de 48 lecciones `video/mp2t` (2.97 GB) pertenecientes a `DaVinci_Resolve_20_Masterclass...`. `ffprobe` confirmó, en los 25 archivos sondeados (límite por ejecución), video H.264 y audio AAC reales — el códec ya es compatible, pero el contenedor `.ts` no es la ruta segura documentada para `<video>` en navegador.

**Confirmado en el navegador real:** una lección `.ts` de ese curso se quedó bloqueada al reproducir desde `/catalog` (no avanza más allá de `0:00`). Esto confirma que el contenedor `.ts`, aunque el códec interno sea H.264/AAC, no es viable tal cual para el reproductor HTML5 actual y sí requiere remux a `.mp4` (`ffmpeg -c copy`, sin recodificar) antes de que esas 48 lecciones sean reproducibles.

La primera ejecución descargaba el archivo completo antes de analizarlo y tardó más de 2 minutos para 25 archivos de ~9 GB en conjunto, un ritmo que no escala a los ~700 GB pendientes en `D:\Cursos`. Se corrigió `probeReviewCandidates` para descargar solo un prefijo de 16 MB por archivo (con `Range`, igual que ya usa el reproductor) en vez del archivo completo; es suficiente para que `ffprobe` identifique el códec real en contenedores como `.ts`/`.mkv`/`.avi`. Límite conocido: un `.mov`/`.mp4` sin `faststart` con el índice al final podría fallar el sondeo con un prefijo truncado; en ese caso queda como `probeError` por archivo, sin romper el resto del panel.

#### Auditoría local completa de `D:\Cursos` (antes de la importación masiva)

El 8 de septiembre de 2026 se auditó todo `D:\Cursos` (20,839 archivos, 776.8 GB, coincide con la auditoría original de `docs/planificacion/08-preparacion-de-biblioteca-para-drive.md`) por extensión y, para los contenedores de riesgo, por códec real (`ffprobe`) y por firma de archivo (byte mágico `0x47` para distinguir `.ts` de video real de `.ts` de código fuente TypeScript). Resultado:

| Extensión | Archivos | Tamaño | Diagnóstico |
| --- | --- | --- | --- |
| `.mp4` | 10,672 | 716.73 GB | Ya seguro |
| `.mp3` | 1,814 | 20.85 GB | Ya seguro |
| `.ts` (video real) | 227 | ~25 GB | H.264/AAC confirmado, solo falta remux — 10 cursos afectados (el mayor: `PC/Curso robótica`, 70 archivos) |
| `.avi` | 13 | 7.78 GB | Códec real `mpeg4`+`mp3` (no H.264), necesita recodificar de verdad — todos en `Idiomas/Inglés` |
| `.ts` (código fuente, no video) | 7 | ~0 GB | Recurso de programación del curso de Astro; riesgo de que Drive lo etiquete como `video/mp2t` por extensión y aparezca como lección falsa |
| `.mkv` | 0 | — | No existe ninguno en `D:\Cursos` |
| Basura de macOS / ayuda embebida | 9 | ~0 GB | Ya ignorados por prefijo `.` o irrelevantes (`hilfe.flv` de un instalador de Excel) |

Solo ~4.3% del contenido (33 GB de 776.8 GB) necesita alguna conversión antes de subir el resto de la biblioteca. Reporte completo por archivo (ruta, tamaño, tipo, códec) entregado como CSV al usuario; no versionado en el repo por ser una auditoría de una ruta local (`D:\Cursos`) específica de esta máquina.

**Pendiente de decidir/ejecutar:** el script de remux (`.ts`→`.mp4`, `-c copy`) y el de recodificación (`.avi`→`.mp4`, `mpeg4`→`h264`) todavía no se generaron ni corrieron — quedó pausado a la espera de decisión del usuario.

#### Fuera de esta fase: auditoría de películas (`E:\Entretenimiento\...\PELICULAS`, `G:\PELIS\HP`)

`docs/planificacion/00-vision-del-producto.md` ya contempla que la misma arquitectura sirva películas/series; hoy no existe todavía ninguna `library_source` para ese contenido. Como preparación temprana se auditaron 50 archivos (112.79 GB) con `ffprobe` completo (video + **todas** las pistas de audio + subtítulos, no solo la primera):

| Grupo | Archivos | Tamaño | Diagnóstico |
| --- | --- | --- | --- |
| Solo remux (H.264 + ya trae una pista AAC) | 28 | 16.96 GB | Todos los "Pokémon Generations"/"Origins" y 6 de 8 películas de Harry Potter |
| Video OK, audio no (H.264 + solo AC3/EAC3, sin AAC) | 21 | 94.98 GB | Las 20 películas grandes de Pokémon + Harry Potter 6 — solo hay que recodificar el audio (`-c:v copy -c:a aac`), el video se copia tal cual |
| Video incompatible de verdad | 1 | 0.85 GB | `Pelicula_01_Mew_Vs_Mewtwo...avi`, códec `mpeg4` |
| Sin escanear (comprimido) | 1 | 1.63 GB | `HP1 [2001].rar`, pendiente de extraer |

**Decisión de arquitectura tomada (no implementada todavía):** no usar el truco `<source src="x.mkv" type="video/mp4">` (no confiable entre navegadores, mismo tipo de falla que ya se confirmó con `.ts`) ni transcodificación en servidor al vuelo (como hace Google Drive o Plex Web) por ahora, para no añadir infraestructura de cómputo permanente. En su lugar: multi-idioma de audio se resuelve generando **un `.mp4` por idioma** (mismo video copiado sin recodificar, solo la pista de audio correspondiente transcodificada a AAC) con un selector en los controles propios del reproductor (punto 4 del backlog); multi-subtítulo se resuelve extrayendo cada pista a `.vtt` (WebVTT) y usando `<track>` nativo, uno por idioma. Ambas extracciones pueden hacerse en la misma pasada de `ffmpeg` que ya hace falta para arreglar el audio AC3. Esto es trabajo del punto 4 (experiencia de reproductor), todavía no iniciado.

## Archivos principales

- `src/lib/drive/catalog-importer.ts`: importador piloto que se reemplazará gradualmente.
- `src/lib/drive/library-snapshot.ts`: escáner puro y paginado implementado en 2A.
- `test/library-snapshot.test.ts`: contrato ejecutable de clasificación y jerarquía.
- `src/lib/drive/session.ts`: renovación segura de Drive en servidor.
- `src/app/api/drive/diagnostic-import/callback/route.ts`: entrada temporal del importador piloto.
- `supabase/migrations/20260906230000_catalog_foundation.sql`: esquema base.
- `supabase/migrations/20260907160000_atomic_outline_reorder.sql`: separación de orden detectado/manual.
- `src/lib/drive/title-normalization.ts`: regla pura de normalización de `detected_title` (2F).
- `src/lib/drive/codec-inventory.ts`: agrupación de lecciones por contenedor seguro/a revisar (2F).
- `src/lib/drive/codec-probe.ts`: sondeo real con `ffprobe`, acotado a los contenedores a revisar (2F).
- `supabase/migrations/20260908020000_normalize_detected_titles.sql`: `detected_title` normalizado sin tocar `detected_name` (2F).
- `docs/ESTADO_Y_BACKLOG.md`: estado general del producto.

## Siguiente acción exacta

1. Confirmar que la migración `20260908020000_normalize_detected_titles.sql` ya se aplicó en Supabase y volver a publicar para verificar títulos normalizados en producción (único punto abierto de 2F).
2. Decidir y, si se aprueba, generar los scripts de conversión pendientes: remux `.ts`→`.mp4` y recodificación `.avi`→`.mp4` para `D:\Cursos` (233 archivos, ~33 GB); remux/recodificación de audio para las películas de `E:\Entretenimiento\...\PELICULAS` y `G:\PELIS\HP` (50 archivos, 112.79 GB) con extracción de audio multi-idioma y subtítulos `.vtt` en la misma pasada.
3. Consolidar o retirar las rutas experimentales del importador piloto AWS (`/api/drive/diagnostic-import` y las rutas de diagnóstico que ya no aporten soporte operativo), sin tocar la ruta estable `/api/drive-token/sync`.
4. Empezar la siguiente capa del producto: experiencia de curso y reproductor con árbol expandible, progreso por sección, pantalla final y controles propios — incluyendo el selector de idioma de audio y de subtítulos que ya se decidió arquitectónicamente arriba.
5. Añadir pruebas automáticas de progreso, notas y orden completo.
