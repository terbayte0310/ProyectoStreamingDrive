# Plan de ejecución para agentes

## Instrucción general

Trabajar en hitos pequeños y verificables. Cada hito debe dejar código, migración, pruebas, documentación y una comprobación real. No mezclar una refactorización visual con una migración destructiva o una publicación masiva.

## Hito 0 — Punto seguro

### Acciones

- Revisar `git status` y distinguir cambios del usuario.
- Crear reglas de ignore en la raíz sin ocultar código válido.
- Ejecutar `git diff --check`, tests, lint y build.
- Preparar un commit de la renovación visual y OAuth corregido.
- Configurar remoto privado solo con autorización del usuario.
- Crear backup lógico de Supabase antes de migraciones.

### Salida

Un commit reproducible y una copia restaurable. No incluye publicar Drive.

## Hito 1 — Datos completos

### Acciones

- Migración del trigger de progreso.
- RPC agregada para inicio del catálogo.
- Carga por curso en administrador.
- Paginación reutilizable para consultas potencialmente grandes.
- Tipos generados de Supabase.
- Pruebas con 2.105+ lecciones.

### Salida

El catálogo devuelve todos los cursos con conteos correctos sin descargar todas las lecciones.

## Hito 2 — Sincronización durable

### Acciones

- Modelo persistente de job y cola.
- Concurrencia acotada, reintentos y heartbeat.
- UI de progreso y reanudación.
- Fingerprint final y publicación atómica.
- Historial de ejecuciones.

### Salida

Interrumpir y reanudar un preview real sin perder el trabajo ya completado.

## Hito 3 — Publicación controlada

### Acciones

- Ejecutar preview.
- Revisar los 3.887 auxiliares por clases, no uno por uno sin agrupación.
- Verificar formatos audiovisuales.
- Publicar los 29 cursos actuales.
- Comparar conteos DB/UI/Drive.
- Probar cursos antes y después de la fila 1.000.

### Salida

11 categorías, 29 cursos y 2.115 lecciones reflejadas de manera coherente, salvo diferencias explícitamente justificadas.

## Hito 4 — Seguridad y operación

### Acciones

- Logout completo.
- RLS reforzado.
- CSP y encabezados.
- HTTPS y proceso de producción con autoarranque.
- backups programados, healthcheck y runbook.
- prueba de reinicio del PC.

### Salida

La aplicación vuelve sola después de reiniciar y puede abrirse de forma segura desde el teléfono.

## Hito 5 — MVP de producto

### Acciones

- búsqueda;
- página de curso;
- recursos y subtítulos;
- autoplay configurable;
- estados de guardado/error;
- portadas reales bajo demanda;
- administrador renovado;
- E2E móvil y multiusuario.

### Salida

Todos los requisitos funcionales iniciales se pueden demostrar sin SQL Editor ni DevTools.

## Comandos de verificación por hito

```powershell
cd web
npm test
npm run lint
npm run build
npm audit
```

Añadir al script principal las pruebas SQL y E2E cuando existan. Hasta entonces, `npm test` no significa que RLS o Supabase estén cubiertos.

## Plantilla de cierre para un agente

```text
Objetivo alcanzado:
Archivos cambiados:
Migraciones aplicadas/no aplicadas:
Datos externos modificados:
Pruebas ejecutadas:
Validación real:
Riesgos restantes:
Siguiente acción exacta:
```

## Prohibiciones

- No publicar el snapshot actual antes del Hito 1.
- No subir `.env.local`, tokens o reportes de rutas personales.
- No eliminar rutas piloto hasta confirmar que la ruta estable cubre diagnóstico y recuperación.
- No aumentar límites como sustituto de paginación.
- No afirmar que una portada CSS es un fotograma generado.
- No marcar el proyecto como listo sin prueba de reinicio, HTTPS móvil y restauración.

