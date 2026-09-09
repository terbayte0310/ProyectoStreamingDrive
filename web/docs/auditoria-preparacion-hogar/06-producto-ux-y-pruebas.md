# Producto, experiencia y estrategia de pruebas

## Brecha frente al alcance

La navegación principal promete Inicio, Continuar y Biblioteca, pero todavía falta búsqueda. Las tarjetas llevan directamente al reproductor; no existe una página de curso con descripción, módulos expandibles, recursos y progreso por sección.

## Portadas

`CourseCover` crea una composición visual estable usando hash, paleta e iniciales. Es un buen fallback de carga inmediata, no una portada generada desde el contenido.

Arquitectura sugerida:

1. Mantener el fallback CSS siempre disponible.
2. Crear un job bajo demanda para elegir una lección y descargar solo lo necesario.
3. Extraer un fotograma con `ffmpeg` en un segundo configurable.
4. Guardar WebP/AVIF pequeño en almacenamiento de la aplicación.
5. Registrar origen, lección, segundo, dimensiones y estado.
6. Permitir regenerar o subir una imagen manual.
7. No escribir la imagen en Drive.

## Recursos y subtítulos

Clasificar los 3.887 auxiliares y relacionarlos con curso, sección o lección. Los PDF, ZIP y ejercicios deben poder descargarse si Drive lo permite. Los subtítulos deben convertirse o asociarse como WebVTT y mostrarse con `<track>`.

No convertir automáticamente un recurso en lección. La tabla `drive_items` puede conservar el inventario; añadir entidades de relación para los recursos presentables.

## Reproductor

Pendientes importantes:

- controles visuales propios manteniendo eventos nativos;
- estado de guardado;
- loader y error de red recuperable;
- selector de velocidad;
- autoplay con cuenta regresiva y cancelación;
- preferencia persistente;
- estado final del curso;
- selector futuro de idioma/subtítulos;
- pruebas en Chrome, Edge y Safari móvil o dispositivo equivalente.

El botón de descarga debe consultar una capacidad real, no mostrarse únicamente porque la lección existe.

## Administrador

Rediseñar después de resolver carga incremental. Debe separar:

- estado y salud;
- sincronizaciones;
- biblioteca y metadatos;
- usuarios autorizados;
- archivos señalados;
- portadas;
- historial.

Los formularios necesitan confirmación visible de guardado, errores por campo y protección frente a cambios sin guardar.

## Pirámide de pruebas propuesta

### Unitarias

- orden natural y jerarquía;
- normalización;
- clasificación MIME/firma;
- cálculo de progreso;
- elección de siguiente lección;
- reintentos/backoff.

### Integración PostgreSQL

- migraciones desde cero;
- RLS por rol;
- progreso y notas;
- reconciliación atómica;
- más de 1.000 filas;
- rollback por snapshot inválido.

### API

- autenticación y autorización por ruta;
- validación de cuerpos;
- preview/publicación y fingerprint;
- logout y limpieza de cookies;
- errores de Drive simulados.

### E2E

- Google OAuth mediante entorno de prueba controlado o sesión preparada;
- abrir curso, reproducir, guardar, recargar y reanudar;
- completar y avanzar;
- crear nota;
- cuenta lectora sin Admin;
- teléfono real o viewport móvil;
- conexión lenta y pérdida temporal de red.

## Criterio de salida UX

Una persona que no conoce la implementación debe poder iniciar sesión, buscar un curso, entender su estructura, abrir un recurso, reproducir, verificar que su avance se guardó y recuperar la sesión después de reiniciar el dispositivo sin usar herramientas de desarrollador.

