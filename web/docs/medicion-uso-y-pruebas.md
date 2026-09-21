# Medición de uso de Nébula

## Objetivo

Conocer el uso de la biblioteca sin presentar como reales cifras que solo son
reservas preventivas. Hay tres conceptos distintos:

| Métrica | Qué responde | Fuente |
| --- | --- | --- |
| Entrega medida | Bytes que Nébula observó pasar hacia el navegador | Aplicación |
| Reserva preventiva | Máximo de bytes solicitado por un `Range` | Base de datos de Nébula |
| Cuota de proveedor | Límites y errores agregados del proyecto | Google Cloud / Drive |

Las reservas nunca se deben mostrar como consumo comprobado. Un MP4 puede
solicitar `bytes=196608-` y el navegador puede detenerse mucho antes.

### Interpretación de DevTools

La columna **Time** de una petición de vídeo `206` no equivale necesariamente al tiempo hasta que aparece la primera imagen. Chrome puede iniciar reproducción tras el primer rango y mantener otra petición abierta para llenar el búfer, o cancelarla al avanzar. El inicio debe medirse desde pulsar reproducir hasta `playing`/primera imagen, o con los eventos `loadedmetadata`, `canplay` y `playing` del reproductor.
## Hallazgo del 20 de septiembre de 2026

El primer intento de medir bytes convirtió la respuesta de Drive en un
`ReadableStream` controlado manualmente y mantuvo el `FetchEvent` vivo con
`event.waitUntil()` hasta que terminara toda la respuesta.

Resultado comprobado durante pruebas locales:

- Series HLS: continuaron funcionando, porque sus segmentos son pequeños.
- Cursos MP4: dejaron de reproducir y mostraron "No se pudo reproducir".

Conclusión: no se puede mantener un evento de Service Worker pendiente durante
una respuesta MP4 larga. El flujo directo probado se restauró en la revisión
del worker `nebula-v5`. La ruta de presupuesto libera una confirmación sin
medición para no volver a contabilizar el tamaño completo del rango.

## Estado actual

- La migración `20260920010000_measured_transfer_usage.sql` conserva el esquema
  necesario para distinguir observación y reserva.
- El reporte `/admin/usage` identifica claramente las reservas históricas como
  no verificadas.
- La entrega directa de cursos no debe envolver su cuerpo hasta que un piloto
  aislado confirme que el navegador sigue reproduciendo correctamente.

## Opciones investigadas

### A. Contabilidad incremental en el Service Worker — descartada

Se probó el 20 de septiembre de 2026 con un único curso y la URL opt-in
`?measurement=pilot`. El Service Worker aplicaba un `TransformStream` nativo y
no esperaba el final de la descarga con `event.waitUntil()`.

Resultado comprobado: el rango de 1 KiB respondió `206`, pero el reproductor
nativo quedó en `0:00` y no inició el MP4. Por tanto, incluso esa envoltura
ligera altera un flujo que este navegador/reproductor necesita conservar
intacto. Se retiró de inmediato y nunca se aplicó a las URLs normales.

### A2. Observación nativa del navegador — piloto actual

`/drive-sw-validation` usa ahora `PerformanceResourceTiming` para observar las
solicitudes que el navegador ya realiza. No envuelve el cuerpo, no usa una
corriente personalizada y no escribe en Supabase. Puede exponer `transferSize`
y `encodedBodySize` por solicitud; si Chrome no los expone, se muestra ese hecho
sin inventar una cifra. Esta observación sirve para validar el dato antes de
crear cualquier persistencia.

Resultado de prueba local del 20 de septiembre de 2026: el MP4 inició, aceptó
un salto a 1,996 s y continuó reproduciendo, pero Chrome informó `transferSize` y`encodedBodySize` como no expuestos para esa respuesta entregada por Service Worker.
Por tanto, este navegador no permite usar Resource Timing como contador confirmado
de bytes para esta arquitectura.
### B. Proxy de streaming en servidor

Nébula/Vercel retransmite cada byte y lo contabiliza en servidor.

Ventaja: es la medición más exacta que puede producir la aplicación.

Desventajas: añade coste/ancho de banda de Vercel, latencia y límites de tiempo;
no es apropiado como arquitectura normal para la biblioteca actual.

### C. Métricas de reproducción del reproductor

Guardar eventos de `play`, pausas, avance y tiempo reproducido.

Ventaja: responde "cuánto se vio", que es más útil para cursos.

Límite: no mide bytes ni cuota de Drive. Debe mostrarse como minutos vistos.

### D. Google Cloud / Drive

Google Cloud es la referencia para cuota agregada del proyecto y errores de
límite. La API de Drive no ofrece un contador de egress por archivo, persona o
sesión. Google Workspace puede tener auditoría de eventos de descarga, pero no
aplica automáticamente a cuentas personales y tampoco sustituye una medición
de bytes por título.

## Regla de despliegue

Ningún piloto de medición se despliega a producción hasta cumplir los cuatro
casos: inicio de curso MP4, avance a mitad/final, cancelación/navegación y HLS.
Cada prueba debe dejarse registrada aquí con fecha, resultado y revisión del
Service Worker.

