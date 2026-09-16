# 02 · Registro de errores

## Corregidos

| ID / prioridad | Evidencia y disparador | Cambio | Validación |
| --- | --- | --- | --- |
| ERR-01 / P1 | `lib/drive/session.ts:58` limita cookies a `/api/drive-token`; el gestor enviaba escaneo a `/api/admin/media-playback`, que necesita esas cookies | Nueva ruta `/api/drive-token/media-playback` delega handlers existentes; gestor actualizado sin ampliar cookies | Revisión de rutas y build. Escaneo real pendiente |
| ERR-02 / P1 | Error HLS fatal solo actualizaba `error`, mientras seguía `ready` y no mostraba mensaje | Error visible, alerta y reintento | Handler y tipos revisados; prueba real pendiente |
| ERR-03 / P2 | `prepare()` podía terminar el import de hls.js tras desmontaje e instalar instancia sin limpieza | Guardas `disposed` tras operaciones asíncronas | Ciclo de vida y tipos |
| ERR-04 / P2 | Cursos usaba revisión `budget-v1` y HLS `media-hls-v1` para mismo worker/scope | Ambos usan `media-hls-v1` | Consumidores revisados; tests del worker pasan |
| ERR-05 / P2 | Cabecera enlazaba siempre a cursos y hashes inexistentes en otras pantallas | Navegación global y módulos según permisos | Prueba visual y enlaces |
| ERR-06 / P2 | Ausencia normal de sesión mostrada como error de conexión | Se distingue `AuthSessionMissingError` en acceso y cuenta | Acceso sin sesión comprobado |
| ERR-07 / P2 | `saveProgress` ignoraba el error de Supabase | Aviso visible al fallar el guardado | Rama revisada; sin cola de reintento |
| ERR-08 / P3 | Tema podía fallar con almacenamiento bloqueado | Escritura protegida | Flujo normal probado; almacenamiento bloqueado pendiente |
| ERR-09 / P3 | Notas con placeholder sin etiqueta; estado podía permanecer al cambiar lección | Nombre accesible y montaje por ID de lección | Integración y lint |

## Pendientes confirmados por código

### ERR-10 · P1 · Activos HLS sin paginación explícita

**Evidencia:** `src/app/api/media-hls/packages/[packageId]/manifest/route.ts` y `src/app/api/media-hls/assets/[assetId]/manifest/route.ts` consultan todos los activos con un solo `select`. El escáner admite 50 000 archivos (`lib/drive/media-hls.ts`).

**Condición:** un paquete supera el máximo de filas por respuesta configurado en PostgREST. No se verificó el límite remoto. El mapa queda incompleto, algunas referencias no se reescriben y el vídeo puede fallar.

**Reproducción:** base de prueba con máximo conocido y paquete mayor; pedir manifiesto y comprobar cada URI. **Solución:** paginar con orden estable o resolver referencias mediante operación acotada. **Aceptación:** ninguna referencia interna queda sin resolver.

### ERR-11 · P1 · Sustitución HLS no atómica

**Evidencia:** `api/admin/media-playback/route.ts:68` pone paquete en `draft`, desactiva activos y ejecuta lotes de 500. Un error termina en `catch` sin restaurar el conjunto anterior.

**Impacto:** reescaneo fallido puede retirar un paquete funcional. Confirmado por orden de escrituras; no se provocó en base real.

**Solución:** versiones con staging y activación transaccional, conservando la publicada hasta validar la nueva. **Prueba:** fallar segundo lote y seguir reproduciendo versión anterior.

### ERR-12 · P2 · Repasar puede quitar el estado completado

**Evidencia:** `course-player-content.tsx:194`, `saveProgress(..., completed = false)` escribe `completed_at: null` y `state: in_progress` en actualizaciones normales. Pausar una lección completada puede degradarla.

**Solución:** transición monotónica en base/RPC; reiniciar solo mediante acción explícita. **Aceptación:** completar, abrir, pausar y mantener 100 %.

### ERR-13 · P2 · Progreso sin secuenciación

**Evidencia:** `onTimeUpdate`, `onPause` y `onEnded` pueden disparar escrituras independientes. El aviso nuevo no serializa solicitudes ni garantiza entrega al cerrar pestaña.

**Impacto:** bajo red lenta una escritura previa podría llegar después de completar; cerrar puede perder últimos segundos. Reproducción pendiente con latencia artificial.

**Solución:** guardado ordenado, versión monotónica y estrategia de visibilidad; no depender solo de temporizadores.

### ERR-14 · P1 · Paquete listo con validación incompleta

**Evidencia:** `scanHlsPackage` verifica `#EXTM3U`, un master y otra lista; no confirma todas las referencias a segmentos. `rewriteReference` conserva referencias externas y las internas desconocidas.

**Impacto:** paquete listo con referencias rotas o destinos externos. La administración está restringida; no se demostró explotación ni fuga de tokens.

**Solución:** validar grafo, rutas, claves y segmentos; política explícita de destinos externos; diagnosticar faltantes antes de activar.

## Riesgo que requiere reproducción

**ERR-15 / P2:** `public/sw.js:1–5` comparte token/módulo entre clientes del mismo scope. Dos pestañas podrían cambiar `driveModule` entre petición y renovación. Hipótesis de concurrencia basada en estado global; probar módulos simultáneos, expiración y cierre de sesión antes de atribuir un fallo real.
