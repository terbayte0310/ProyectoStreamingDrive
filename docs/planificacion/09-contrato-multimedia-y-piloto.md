# Contrato multimedia y piloto controlado

**Estado:** aprobado para el piloto del Issue #3.  
**Ámbito:** películas y series nuevas. No modifica la biblioteca de cursos, no autoriza conversiones o cargas masivas y no contiene títulos, rutas, IDs ni enlaces privados.

## Objetivo

Validar un único perfil de reproducción antes de ampliar la biblioteca: MP4/H.264/AAC, organizado con claves internas y probado con tres muestras representativas. Google Drive seguirá siendo una fuente de solo lectura para la aplicación.

## Dispositivos mínimos

| Dispositivo | Navegador o reproductor a validar |
| --- | --- |
| TV LG 55SM8000PSA (2020) | Reproductor o navegador integrado, con firmware actualizado |
| TV Xiaomi con Android TV | Reproductor disponible en el dispositivo |
| PC con Windows | Chrome estable actualizado |
| iPhone 15 Pro Max | Chrome y Safari actualizados |
| iPad con M3 | Safari actualizado |

La evidencia del piloto anotará la versión concreta del sistema, firmware y navegador el día de la prueba. Microsoft Edge no es requisito del MVP.

## Perfil admitido

| Parte | Regla |
| --- | --- |
| Contenedor | MP4 con `faststart` |
| Vídeo | H.264, SDR, progresivo y como máximo 1920 × 1080 |
| Audio | Una pista en español, AAC estéreo a 48 kHz |
| Subtítulos | WebVTT externo en español; apagado inicialmente y, cuando exista el reproductor, recordado por usuario |
| Forzados | Archivo WebVTT separado con sufijo `.forced.es.vtt` |

Se puede conservar el vídeo sin recodificar únicamente si ya es H.264, SDR, progresivo y no supera 1080p. HEVC/H.265, HDR, vídeo entrelazado o mayor resolución se recodifican. AC3, E-AC3, DTS u otro audio no compatible se convierten a AAC. PGS y VobSub no entran en el piloto: requieren tratamiento posterior y no se publican como subtítulos del MVP.

## Estructura de Drive y claves

Una clave se forma con las iniciales de las dos primeras palabras significativas del título y cuatro dígitos. Los artículos se ignoran; una colisión recibe el siguiente número disponible. La clave es organizativa, no controla permisos ni derechos.

```text
200_PELICULAS/
  AB0001/
    AB0001.es.mp4
    AB0001.es.vtt
    AB0001.forced.es.vtt

300_SERIES/
  CD0001/
    S01/
      CD0001.S01E01.es.mp4
      CD0001.S01E01.es.vtt
```

- Las temporadas usan dos dígitos; los especiales usan `S00`.
- La estructura se aplica solo a contenido nuevo.
- El sincronizador futuro rechazará, marcará como `no disponible` para administración y no publicará cualquier ruta o archivo que no cumpla este contrato. No se renombra ni mueve contenido existente en este piloto.

## Límites y seguridad del piloto

- La preparación usa la unidad local acordada, con aproximadamente 364 GB libres.
- Se procesa una muestra cada vez y el espacio temporal total no puede superar 100 GB.
- El piloto puede aumentar el uso de Drive como máximo 100 GB.
- No se usa `-y`, operaciones de borrado ni comandos que alteren un archivo original.
- Si una muestra no cabe dentro del límite, se detiene y se registra como no disponible; no se sustituye ni se elimina la fuente.

## Muestras y comandos reproducibles

Se seleccionan privadamente tres muestras: una película H.264 con audio sencillo, una película cuyo audio exija conversión y un episodio con subtítulo. En los informes se denominan `M1`, `M2` y `M3`.

Antes de preparar una muestra, inspeccionar todas sus pistas sin publicar la salida:

```powershell
ffprobe -v error -show_entries format=duration,size,format_name -show_streams -of json -- "RUTA_PRIVADA_DE_ORIGEN"
```

Elegir explícitamente el índice de la pista de audio española después de esa inspección. Para una fuente cuyo vídeo ya cumpla el perfil, conservar el vídeo y convertir solo el audio:

```powershell
ffmpeg -n -i "RUTA_PRIVADA_DE_ORIGEN" -map 0:v:0 -map 0:a:INDICE_ESPANOL -c:v copy -c:a aac -ac 2 -ar 48000 -b:a 192k -movflags +faststart "RUTA_PRIVADA_DE_SALIDA.mp4"
```

Cuando el vídeo no cumpla el perfil, recodificarlo a H.264, manteniendo las mismas reglas de audio:

```powershell
ffmpeg -n -i "RUTA_PRIVADA_DE_ORIGEN" -map 0:v:0 -map 0:a:INDICE_ESPANOL -vf "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p" -c:v libx264 -preset medium -crf 20 -c:a aac -ac 2 -ar 48000 -b:a 192k -movflags +faststart "RUTA_PRIVADA_DE_SALIDA.mp4"
```

Para un subtítulo de texto compatible, extraerlo de forma independiente:

```powershell
ffmpeg -n -i "RUTA_PRIVADA_DE_ORIGEN" -map 0:s:INDICE_SUBTITULO -c:s webvtt "RUTA_PRIVADA_DE_SALIDA.es.vtt"
```

Tras cada operación, comprobar el resultado y el espacio usado:

```powershell
ffprobe -v error -show_entries format=duration,size,format_name -show_entries stream=codec_type,codec_name,width,height,field_order -of json -- "RUTA_PRIVADA_DE_SALIDA.mp4"
Get-PSDrive -Name E | Select-Object Name,Used,Free
```

Los comandos son una receta de piloto: cada índice de pista debe salir de `ffprobe`; no se sustituyen valores ni se ejecutan en lote.

## Evidencia requerida para cerrar el piloto

| Muestra | Vídeo y audio de entrada | Salida | Tamaño antes/después | Tiempo | LG | Xiaomi | Windows/Chrome | iPhone Chrome | iPhone Safari | iPad Safari | Búsqueda |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| M2 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| M3 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |

Cada reproducción debe iniciar, permitir saltar al menos a 10 %, 50 % y 90 % de la duración, y terminar sin error. El registro solo contendrá los identificadores anónimos de esta tabla. Si una prueba falla, el elemento queda `no disponible` para administración y el issue documentará el fallo antes de ampliar el alcance.
