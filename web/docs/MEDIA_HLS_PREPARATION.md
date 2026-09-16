# Preparación de medios HLS

Esta guía define la preparación local para Movies y Series antes de subirlos a
Drive. Los originales no se modifican; la conversión se hace a una carpeta de
salida temporal independiente y solo el paquete validado se sube. Las rutas de
los discos y los detalles de la auditoría viven exclusivamente en
`docs/MEDIA_HLS_LOCAL.md`, archivo ignorado por Git.

## Identidad e inventario local

Cada paquete se nombra con el código interno de la aplicación, nunca con el
nombre del MKV:

- Película: `MOV-00001`.
- Episodio: `SER-00001-S01-E01` (los episodios 100–999 usan tres dígitos, por ejemplo `SER-00003-S01-E100`).

Un código legible administrativo, por ejemplo `HPPF-00001`, puede conservarse
como referencia opcional, pero no sustituye al código interno.

Antes de convertir, mantener un inventario local que relacione
`archivo-origen → código-interno`. No se debe derivar el código solo a partir
del nombre del archivo. El inventario y cualquier ruta local son datos privados
y no se versionan.

## Decisión de formato

- No reproducir MKV directamente en el navegador.
- No generar un MP4 completo por idioma: duplicaría el video.
- Generar HLS VOD con una sola rendición de video y rendiciones de audio
  independientes para Español e Inglés cuando existan.
- Usar H.264 como video web compatible y AAC como audio de salida.
- Usar WebVTT para subtítulos preparados. SubRip y ASS requieren conversión;
  PGS requiere revisión específica.
- El español será el audio predeterminado cuando exista.
- El destino son navegadores modernos de escritorio y móvil: Safari en iPhone
  y iPad mediante HLS nativo; Chrome, Edge y Firefox mediante `hls.js`.

La salida esperada mantiene las películas directamente en la raíz temporal y
agrupa los episodios bajo el código de su serie:

```text
MOV-00001/
  master.m3u8
  video/
  audio/es/
  audio/en/
  subtitles/

SER-00001/
  SER-00001-S01-E01/
    master.m3u8
    video/
    audio/es/
    audio/en/
    subtitles/
```

El manifiesto maestro enlaza una sola línea de video con las rendiciones de
audio. Cambiar idioma no reinicia el contenido ni duplica la descarga de video.

## Auditoría local inicial

Se analizaron 187 archivos MKV (239.45 GiB) sin modificar los originales.

| Hallazgo | Cantidad | Preparación |
| --- | ---: | --- |
| Video H.264 | 178 | Conservar video al empaquetar HLS. |
| HEVC/x265 | 5 | Validar reproducción; recodificar a H.264 solo si hace falta. |
| Dos o más audios | 130 | Declarar rendiciones separadas. |
| Español + inglés etiquetados | 46 | Crear selector ES/EN. |
| Con subtítulos | 72 | Preparar WebVTT cuando sea posible. |
| Sin cabecera legible para ffprobe | 4 | Bloquear hasta reparar o reemplazar. |

Los nuevos MKV pasan por el mismo análisis antes de entrar a la biblioteca.
Los idiomas mal etiquetados deben confirmarse por el título de la pista o por
revisión humana: no se debe asumir que `lat` significa español sin validarlo.

## Piloto obligatorio

El destino final es toda la colección, pero la configuración se valida primero
con 5 a 8 archivos que incluyan, como mínimo:

- Un medio con audio ES/EN.
- Un medio con subtítulos ASS.
- Un medio con subtítulos PGS.
- Un episodio de serie.
- Un medio HEVC.

Solo después de que el piloto supere la validación se procesa el resto de la
colección con esa misma configuración. Los PGS no bloquean el vídeo ni el audio:
pueden omitirse del primer paquete y quedar en estado `review`.

## Flujo de conversión recomendado

1. Conservar el MKV original como fuente y analizarlo con `ffprobe`.
2. Elegir la primera pista de video útil; ignorar imágenes adjuntas de portada.
3. Comprobar el perfil y nivel del H.264 contra los navegadores objetivo. Si es
   compatible, copiarlo al paquete sin recodificar. Para HEVC, evaluar primero
   la reproducción en HLS en esos dispositivos; recodificar a H.264 solo si no
   se reproduce correctamente. Otros códecs se convierten a H.264.
4. Seleccionar las pistas de audio Español e Inglés disponibles y convertirlas
   a AAC. No inventar una pista ausente: el reproductor muestra solo idiomas
   presentes.
5. Extraer o convertir subtítulos de texto a WebVTT. Convertir ASS cuando el
   texto se conserve bien; los estilos avanzados no son prioritarios. Dejar los
   PGS en estado `review` hasta tener una conversión fiable.
6. Crear un paquete HLS VOD con un `master.m3u8`, video y audios separados.
7. Validar el manifiesto, la duración de cada rendición, el cambio ES/EN y la
   reproducción en los navegadores objetivo antes de subir.
8. Subir únicamente el paquete validado a la raíz de Medios de Drive y
   escanearlo en la aplicación. Solo entonces se puede eliminar su copia
   temporal, si hace falta espacio.

FFmpeg soporta la agrupación de un video con varias rendiciones de audio
mediante `-var_stream_map` y `-master_pl_name`. Los índices de `-map` deben
salir del `ffprobe` de cada archivo; no se debe reutilizar un comando fijo para
toda la colección. Consulta la documentación oficial de
[HLS de FFmpeg](https://ffmpeg.org/ffmpeg-formats.html) para la plantilla de
audio alternativo.

## Validación mínima por paquete

- `master.m3u8` existe y referencia archivos relativos del paquete.
- Las rendiciones de audio cubren la duración del video.
- Español es predeterminado si existe; Inglés aparece si existe.
- Cambiar audio mantiene aproximadamente el mismo segundo de reproducción.
- No hay enlaces públicos de Drive ni credenciales dentro de manifiestos.
- El paquete se marca `ready` solo después de validar archivos y reproducción.
- El paquete aparece correctamente tras el escaneo de la aplicación.

## Límites intencionales

- La conversión se ejecuta localmente y bajo demanda, nunca en el servidor web.
- La aplicación no almacenará una copia de video en Supabase.
- Los paquetes temporales no se mezclan con los MKV originales.
- Los cuatro MKV sin cabecera legible no se publican automáticamente.
- El soporte para nuevos códecs, más idiomas o PGS se decide por revisión, no
  por una conversión masiva implícita.

