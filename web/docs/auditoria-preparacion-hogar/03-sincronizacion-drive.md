# Sincronización masiva de Google Drive

## Hallazgo medido

El modo `preview` recorrió la biblioteca real en 6,8 minutos y devolvió:

- 11 categorías;
- 29 cursos;
- 242 secciones;
- 2.115 lecciones;
- 3.887 auxiliares/no compatibles;
- 39 ignorados;
- 0 conflictos.

El recorrido actual hace una petición por carpeta y espera cada subárbol antes de continuar. Construye todo el snapshot en memoria y lo envía como un JSON único a `reconcile_library_snapshot`.

## Riesgos

- Reinicio del PC o pérdida de red: el avance desaparece.
- Dos pestañas: el bloqueo existe al publicar, pero no evita escaneos costosos simultáneos.
- Host serverless: la petición puede superar el tiempo máximo.
- Snapshot grande: consumo elevado de memoria, tamaño de cuerpo y tiempo de transacción.
- El usuario solo ve “Escaneando…”, sin saber si existe avance.
- Un cambio de Drive durante varios minutos puede hacer que el snapshot mezcle momentos diferentes.

## Arquitectura objetivo

Separar el proceso en cuatro etapas persistentes:

```text
crear ejecución
→ enumerar carpetas por lotes
→ finalizar y validar snapshot
→ publicar atómicamente
```

Agregar tablas o campos para:

- cola de carpetas pendientes;
- carpetas completadas;
- número de elementos encontrados;
- heartbeat y fecha de última actividad;
- cursor/página de Drive pendiente;
- error recuperable;
- fingerprint final;
- estado `queued | scanning | ready | publishing | completed | failed | cancelled`.

## Concurrencia segura

Procesar varias carpetas en paralelo con un límite pequeño y configurable. No usar `Promise.all` sin límite sobre miles de carpetas. Reintentar errores `429` y `5xx` con backoff y jitter; no reintentar indefinidamente errores de permisos o configuración.

Drive conserva IDs estables, por lo que cada lote debe poder hacerse idempotente. La publicación final continuará siendo atómica y debe conservar personalizaciones, progreso y notas.

## Tratamiento de auxiliares

“No compatible” no equivale automáticamente a basura. Los 3.887 elementos deben clasificarse en:

- subtítulos (`.srt`, `.vtt`);
- documentos y ejercicios (`.pdf`, Office, texto);
- archivos descargables (`.zip`, proyectos);
- enlaces (`.url`, HTML);
- código fuente, incluido `.ts` de TypeScript;
- formatos audiovisuales realmente incompatibles;
- metadatos/basura ignorables.

Un archivo `.ts` no debe convertirse en lección solo por el MIME de Drive. Verificar firma de MPEG-TS o extensión/contexto antes de clasificarlo como video.

## Flujo de publicación seguro

1. Ejecutar preview reanudable.
2. Mostrar conteos y diferencias respecto al catálogo publicado.
3. Mostrar altas, ausencias, restaurados y cambios de ubicación.
4. Exigir confirmación explícita del fingerprint.
5. Publicar en una transacción.
6. Verificar conteos posteriores por consultas independientes.
7. Conservar historial consultable y exportable.

## Pruebas de aceptación

- Interrumpir el proceso al 30 %, reiniciarlo y continuar sin repetir todo.
- Recibir un `429` simulado y recuperarse.
- Ejecutar preview dos veces sin cambios y obtener el mismo fingerprint.
- Renombrar o mover un fixture y conservar su identidad.
- Escanear más de 20.000 elementos con memoria acotada.
- Mostrar progreso actualizado al usuario al menos cada pocos segundos.
- Publicar 2.115 lecciones y comprobar que catálogo y administrador muestran todas.

