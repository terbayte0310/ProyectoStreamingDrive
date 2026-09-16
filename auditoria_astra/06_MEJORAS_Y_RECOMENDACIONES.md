# 06 · Mejoras y recomendaciones

## Orden de trabajo

| Fase | Trabajo | Dependencias | Aceptación |
| --- | --- | --- | --- |
| 1 · HLS | Paginación y validación del grafo | Fixtures grandes y manifiestos anonimizados | Ninguna URI interna sin resolver; inválidos no activos |
| 1 · Publicación | Staging y activación atómica | RPC/migración y rollback | Error de lote conserva paquete anterior |
| 1 · Persistencia | Progreso monotónico y ordenado | Contrato de finalización | Repasar no quita completado; respuesta tardía no revierte |
| 2 · Pruebas reales | Supabase de prueba, Google y perfiles | Cuentas y contenido de ensayo | Acceso cruzado denegado, renovación, seek y sign-out |
| 2 · Continuidad | Progreso de medios y siguiente episodio | Modelo por contenido | Reanudar entre dispositivos, autoplay cancelable |
| 2 · Escala | Búsqueda paginada, filtros en URL | Contrato de consultas | Resultados completos sin cargar todo |
| 3 · Pulido | Miniaturas, estado de guardado y diagnóstico | Sprites/VTT y eventos seguros | Acciones claras y errores diagnosticables |
| 3 · Mantenimiento | Consolidar CSS y dividir gestores | Regresión visual | Menos especificidad sin cambiar comportamiento |

## Recomendaciones

1. Centralizar registro/revisión del worker. La revisión se unificó, pero el helper sigue duplicado. Gestionar activación, timeout, control del cliente y limpieza.
2. Mantener `CinemaPlayer` independiente del origen; no introducir consultas o tokens en sus controles.
3. Generar variantes/pistas reales antes de ampliar opciones. No mostrar calidad ficticia.
4. Migrar estilos administrativos desde selectores de clases utilitarias hacia componentes semánticos. `redesign.css` es una capa revisable, no el destino definitivo de todo el CSS.
5. Ejecutar RLS y RPC en base desechable. Varias pruebas actuales solo examinan cadenas SQL/TS.
6. Registrar fallos por fase: autenticación, manifiesto, segmento, codec y guardado. Excluir credenciales y datos privados innecesarios.
7. Actualizar README operativo: su introducción centra el proyecto en cursos aunque existen películas, series y HLS.
8. Definir navegadores objetivo y ensayar dispositivos antes de prometer compatibilidad universal.

## Medición

Tiempo a primer frame, errores fatales, segundos de buffering por minuto, éxito de guardado, tiempo de búsqueda y publicaciones válidas. Establecer línea base antes de fijar objetivos numéricos.

Resolver integridad y medir carga antes de proponer cambio de proveedor o infraestructura.
