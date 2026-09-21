# Preparación de la biblioteca para Google Drive

## Resultado de la auditoría inicial

La auditoría de solo lectura encontró:

- 21,159 archivos en 78 carpetas de curso.
- 776.98 GB de contenido total.
- 10,672 videos MP4, que ocupan 716.73 GB.
- 1,814 audios MP3, que ocupan 20.85 GB.
- 2,486 subtítulos SRT.
- Recursos valiosos: PDF, ZIP/RAR/7Z, HTML, código fuente, hojas de cálculo e imágenes.
- 1,112 accesos directos `.url` y archivos de sistema como `desktop.ini` y `.DS_Store`.
- Archivos de descarga parcial, como `.download` y `.aria2`.

## Principio de preparación

`D:\\Cursos` seguirá siendo la copia maestra local. No eliminaremos ni renombraremos masivamente el contenido original antes de tener una copia verificada en Drive.

La aplicación puede mostrar títulos, autores, plataformas, orden y portadas editables sin requerir que cada archivo físico tenga un nombre perfecto. Por eso la preparación debe buscar estabilidad y seguridad, no una reestructuración enorme.

## Estructura de Drive recomendada

```text
Biblioteca de Cursos
├── Adobe
├── Angular
├── AWS
├── Docker
├── JavaScript
├── Python
├── React
└── ... demás categorías actuales
```

Se conservará inicialmente la jerarquía interna de cada curso. Los directorios con nombres numerados ya proporcionan una secuencia útil para la sincronización y la reproducción automática.

No se añadirá una capa física artificial como `01 - Videos` o `02 - Recursos` a todos los cursos. Ese cambio movería miles de archivos, puede romper asociaciones existentes de subtítulos y añade trabajo que la aplicación puede resolver mediante metadatos.

## Convención para contenido nuevo

Para cursos añadidos en el futuro se recomienda:

```text
Categoría/
└── Nombre del curso/
    ├── 01 - Nombre de la sección/
    │   ├── 001 - Nombre de la lección.mp4
    │   ├── 001 - Nombre de la lección.es.srt
    │   └── Recursos/
    └── 02 - Siguiente sección/
```

Reglas:

- Usar números con ceros a la izquierda para el orden: `001`, `002`, `010`.
- Mantener el mismo nombre base para video y subtítulo asociado.
- Usar nombres humanos y legibles. La aplicación puede normalizar guiones bajos, guiones y espacios al mostrar títulos.
- Colocar documentos, enlaces, código y archivos comprimidos vinculados a una sección dentro de `Recursos/` cuando sea práctico.
- No renombrar de forma masiva cursos ya existentes solo para cumplir esta convención.

## Clasificación de archivos antes de subir

| Grupo | Acción de subida inicial | Motivo |
| --- | --- | --- |
| Videos y audios (`.mp4`, `.mp3`, `.avi`, `.m4a`) | Subir. | Son lecciones reproducibles. |
| Subtítulos (`.srt`) | Subir junto a su video. | Son parte de la experiencia de reproducción. |
| PDFs, código, hojas, imágenes y comprimidos | Subir. | Son recursos de aprendizaje. |
| Enlaces `.url` | Conservar localmente y revisar en una fase de conversión a enlaces web. | Son recursos potenciales, pero no son lecciones ni se visualizan igual fuera de Windows. |
| `desktop.ini`, `.DS_Store`, `Thumbs.db` | Excluir de la subida. | Son archivos técnicos del sistema operativo. |
| `.download`, `.aria2` y similares | No subir por ahora; revisar si la descarga original está completa. | Indican descargas incompletas o estado temporal. |
| Tipos desconocidos | Conservar y marcar para revisión, sin borrar. | Evita perder recursos posiblemente útiles. |

## Estructura interna del MP4: revisar antes de subir

**Regla:** antes de subir un curso nuevo a Drive, revisa la estructura interna de sus MP4 y reempaqueta los que la necesiten. Con Drive, un vídeo mal estructurado puede tardar **25-90 s** en arrancar en vez de **1-3 s**, aunque tenga buen tamaño y la conexión sea buena.

### Por qué ocurre

Un MP4 contiene un índice (`moov`) y los datos de vídeo y audio (`mdat`). Chrome necesita el `moov` para empezar y lo busca recorriendo los bloques del archivo. Con Drive, cada salto a otro punto del archivo es una petición nueva de rango, y cada una tarda **~1-2 s** (latencia de Drive). Lo que importa es cuántas peticiones seguidas hace el navegador antes de poder reproducir.

| Estructura | Peticiones hasta arrancar | Arranque medido | ¿Hay que arreglarlo? |
| --- | --- | --- | --- |
| `moov` al inicio y un solo `mdat` | 1-3 | 1-3 s | No. Es el objetivo. |
| `moov` **al final** | unas 4-7 | ~4 s | Opcional. Cuesta 2-3 s extra por vídeo. |
| **Varios `mdat`** (vídeo troceado en decenas de bloques) | 25-77 | 25-88 s | **Sí, siempre.** |

En el mismo archivo, con una latencia simulada de 1 s por petición, pasar de 90 bloques `mdat` a 1 solo bajó el arranque de 45,7 s a 1,0 s. Tras reempaquetar seis cursos en Drive, todos arrancan en 0,8-2,9 s.

### Cómo revisar y arreglar un curso nuevo

Necesitas `ffmpeg` y `ffprobe` (la ruta está fijada al inicio de `web/scripts/faststart-courses.ps1`; ajústala si cambia).

1. **Revisar sin escribir nada:**

   ```powershell
   .\web\scripts\faststart-courses.ps1 -CoursePath 'D:\Subidos\Categoria\Curso' -CheckOnly
   ```

   Imprime cada archivo que no esté en estado `ok` y un resumen. Si todo sale `ok`, no hay que hacer nada más.

2. **Reempaquetar** los que lo necesiten. Es rápido (~5 s por archivo, limitado por el disco) y no recodifica, así que no pierde calidad:

   ```powershell
   .\web\scripts\faststart-courses.ps1 -CoursePath 'D:\Subidos\Categoria\Curso' -Mode All
   ```

   Los resultados van a `D:\_FASTSTART_CURSOS`, con la misma estructura de carpetas. Cada archivo se verifica antes de darse por bueno: un solo `mdat`, `moov` antes del `mdat`, mismas pistas y misma duración. Los que ya estaban bien se omiten, y el original **nunca se modifica**. Es reanudable.

3. **Subir a Drive los reempaquetados** (junto con los archivos que estaban bien y los recursos). Si el curso aún no está en Drive, esto es todo: no hay IDs ni tamaños que corregir.

4. Comprobar la reproducción de un par de lecciones antes de subir la siguiente categoría.

Si el script marca un archivo como `no-mp4-estandar`, no es un MP4 normal (otro formato con extensión `.mp4`, un archivo corrupto o vídeo fragmentado). No se toca: revísalo a mano.

### Si el curso ya está subido y ya importado en Nébula

Se puede reemplazar sin cambiar los IDs de Drive, pero exige más cuidado:

- **Sobrescribe el archivo en la unidad de Drive para escritorio** (`G:`), sin borrarlo antes ni renombrarlo. Drive lo sube como nueva versión del mismo archivo y conserva su ID. Se comprobó con 396 archivos: ningún ID cambió. Si borras y vuelves a subir, el ID cambia y la lección deja de funcionar hasta reindexar.
- **Actualiza `drive_items.byte_size`** de cada archivo reemplazado. El reempaquetado cambia el tamaño (menos de un 1 % más) y `calculateTransferBytes` (`web/src/lib/transfer-budget.ts`) rechaza con error 416 los rangos que empiezan después del tamaño guardado, es decir, los últimos KB del vídeo. El importador de catálogo (`web/src/lib/drive/catalog-importer.ts`) hace `upsert` de `byte_size` y `modified_at_drive`, así que una re-sincronización debería corregirlo. **Eso no se ha probado**: en el trabajo de septiembre de 2026 se actualizó `byte_size` a mano, archivo por archivo, y `modified_at_drive` quedó con la fecha antigua.
- **Verifica cada archivo en Drive** antes de tocar la base de datos: mismo ID, no está en la papelera, el tamaño coincide con el reempaquetado y la estructura leída desde Drive tiene un solo `mdat` con `moov` antes.
- Trabaja **curso por curso** y detente al primer ID que cambie. Conserva los originales locales hasta terminar y no cuentes con el historial de versiones de Drive como respaldo permanente.

### Errores de diagnóstico que hay que evitar

Estos fueron los caminos equivocados o engañosos al investigar la lentitud:

- **No es el tamaño, la antigüedad ni el dueño del archivo.** Los archivos lentos y los rápidos eran del mismo dueño, del mismo tipo y de tamaños parecidos. Los metadatos de Drive no distinguen nada.
- **`moov` al inicio no basta.** Un curso tenía el `moov` en el byte 32 y aun así tardaba 25 s, porque el vídeo estaba troceado en 38 bloques `mdat`. Hay que contar los bloques `mdat`, no solo mirar dónde está el `moov`.
- **La latencia de Drive es la misma para todos los archivos** (~0,7-2,6 s al primer byte). Si un archivo tarda mucho más, cuenta las peticiones seguidas, no el tiempo de una sola.
- **Mide el arranque como pulsar reproducir hasta `playing`**, no con la columna Time de DevTools ni con el tiempo de una sola petición 206.
- **Chrome no descarga vídeo si la pestaña está oculta** (`document.visibilityState === "hidden"`) y las pruebas se quedan colgadas o dan tiempos falsos. Mide con la ventana de Chrome al frente.
- **Prueba en dos pasadas.** El primer arranque puede ser más lento por latencia puntual de Drive; repite la medición antes de concluir.
- **Al contar vídeos en PowerShell** con `Get-ChildItem -LiteralPath ... -Recurse -Include *.mp4`, `-Include` se ignora y cuentas todos los archivos (`.url`, `.pdf`…). Filtra la extensión con `Where-Object`.
- **Contrasta los recuentos locales con los de Nébula** (número de lecciones y bytes totales por curso) antes de emparejar archivos con IDs de Drive.

## Plan seguro de subida

1. Crear en Drive la carpeta raíz `Biblioteca de Cursos`.
2. Subir una categoría piloto pequeña y verificar conteo, tamaño y reproducción de varios videos y subtítulos.
3. **Antes de subir cada curso, revisar la estructura de sus MP4** con `faststart-courses.ps1 -CheckOnly` y reempaquetar los que no estén en `ok` (ver la sección anterior).
4. Subir categorías completas, una por una, conservando la estructura original.
5. Después de cada categoría, comparar cantidad de archivos y tamaño aproximado con el inventario local.
6. Mantener `D:\\Cursos` intacto hasta que todas las categorías estén verificadas.
7. Compartir la carpeta raíz con amigos solo cuando el *spike* de permisos y reproducción esté aprobado.

## Limpieza posterior, nunca automática

Después de tener la copia verificada en Drive, se podrá hacer una segunda auditoría para:

- Detectar duplicados exactos por hash.
- Convertir enlaces `.url` en registros de recurso web dentro de la aplicación.
- Revisar archivos de descarga parcial y extensiones desconocidas.
- Mover recursos a carpetas `Recursos/` solo cuando no rompan una asociación de curso.
- Normalizar selectivamente nombres que afecten de verdad a la navegación.

Cada operación de limpieza debe generar una lista previa, realizarse sobre un conjunto limitado y ser verificable. No se borrará ningún archivo en esta fase sin aprobación explícita.
