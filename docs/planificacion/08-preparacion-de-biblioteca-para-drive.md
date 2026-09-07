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

## Plan seguro de subida

1. Crear en Drive la carpeta raíz `Biblioteca de Cursos`.
2. Subir una categoría piloto pequeña y verificar conteo, tamaño y reproducción de varios videos y subtítulos.
3. Subir categorías completas, una por una, conservando la estructura original.
4. Después de cada categoría, comparar cantidad de archivos y tamaño aproximado con el inventario local.
5. Mantener `D:\\Cursos` intacto hasta que todas las categorías estén verificadas.
6. Compartir la carpeta raíz con amigos solo cuando el *spike* de permisos y reproducción esté aprobado.

## Limpieza posterior, nunca automática

Después de tener la copia verificada en Drive, se podrá hacer una segunda auditoría para:

- Detectar duplicados exactos por hash.
- Convertir enlaces `.url` en registros de recurso web dentro de la aplicación.
- Revisar archivos de descarga parcial y extensiones desconocidas.
- Mover recursos a carpetas `Recursos/` solo cuando no rompan una asociación de curso.
- Normalizar selectivamente nombres que afecten de verdad a la navegación.

Cada operación de limpieza debe generar una lista previa, realizarse sobre un conjunto limitado y ser verificable. No se borrará ningún archivo en esta fase sin aprobación explícita.
