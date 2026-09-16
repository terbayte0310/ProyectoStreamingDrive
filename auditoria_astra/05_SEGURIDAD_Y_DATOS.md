# 05 · Seguridad, permisos y datos

## Controles observados

- Helpers separan autenticación, autorización y rol administrador.
- Migraciones definen RLS para módulos, publicaciones, progreso y notas.
- Rutas administrativas inspeccionadas verifican perfil/rol y origen en escrituras.
- Cookies de Drive: HttpOnly, SameSite lax y Secure en producción; ligadas al usuario y limitadas a `/api/drive-token`.
- Tokens y manifiestos usan `no-store` en los flujos inspeccionados.
- Worker elimina credenciales al cerrar sesión; existen pruebas contra token antiguo.
- Reserva de transferencia y fusible global cubiertos por pruebas existentes.

Describen el código, no certifican las políticas desplegadas en Supabase.

## Corrección aplicada

El gestor HLS llama a `/api/drive-token/media-playback`. La ruta delega los mismos handlers administrativos y mantiene verificación de usuario y origen. Permite enviar cookies en su alcance original sin ampliarlo a toda la aplicación.

## Riesgos y verificación pendiente

| Área | Riesgo / estado | Validación |
| --- | --- | --- |
| RLS remota | Migraciones no prueban despliegue | Sin sesión, lector, otro módulo y admin |
| Referencias HLS | Destinos externos/desconocidos conservados | Política de esquemas/destinos y paquetes completos |
| Publicación | Varias escrituras no atómicas | Error de lote, caída y concurrencia |
| Progreso | Completado puede retroceder | RPC monotónica y latencia |
| Worker | Módulo/token global por scope | Dos pestañas, renovación y sign-out |
| Origen | Se permite ausencia de Origin en rutas inspeccionadas | Pruebas cruzadas y compatibilidad antes de endurecer |
| Diagnóstico | Rutas piloto `src/app/drive-*` presentes | Decidir cuáles necesita producción y asegurar roles |
| Protección | Lectura autorizada no equivale a DRM | Documentar límites del transporte |

No se afirma fuga de credenciales ni vulnerabilidad explotable por la sola presencia de estos riesgos.

## Dependencias

`npm audit --omit=dev --json`: **0 vulnerabilidades** reportadas en producción en esta ejecución. Evidencia: `evidencias/dependencias.json`. No se actualizaron versiones automáticamente. Depende de la base de avisos consultada; no sustituye pruebas ni evalúa dependencias de desarrollo.

## Información

Capturas con ejemplos y vídeo sintético. No se publicaron secretos, copiaron valores de entorno ni cambiaron datos remotos. Preview devuelve 404 fuera de desarrollo.
