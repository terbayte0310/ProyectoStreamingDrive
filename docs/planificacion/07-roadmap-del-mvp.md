# Roadmap del MVP

## Cómo leer este roadmap

Un **hito** es una entrega con resultado comprobable. Una **épica** agrupa trabajo relacionado. Una **historia de usuario** expresa una necesidad desde el punto de vista de quien usará el producto.

Ejemplo: «Como lector, quiero retomar una lección para no buscar manualmente el punto donde la dejé».

No se pasa al hito siguiente solo por haber escrito código: se pasa cuando se cumple su criterio de aceptación.

## Orden de construcción

```text
0. Validación de Drive
→ 1. Fundación y acceso
→ 2. Catálogo sincronizado
→ 3. Reproducción y progreso
→ 4. Aprendizaje personal
→ 5. Administración
→ 6. Calidad y entrega privada
```

## Hito 0 — Validación técnica de Google Drive

### Objetivo

Eliminar las incertidumbres de mayor riesgo antes de crear toda la aplicación.

### Entregables

- Carpeta de prueba de Drive compartida con una cuenta amiga.
- Prototipo mínimo que abra un video sin exponer el token del propietario.
- Prueba de lectura de metadatos de una carpeta con la autorización del propietario.
- Prueba de descarga de un archivo permitido.
- Registro de resultados, errores y decisión sobre el mecanismo de reproducción.

### Criterio de aceptación

Una cuenta amiga autorizada puede reproducir y descargar un video de prueba desde el mecanismo elegido, y el servidor puede listar la carpeta sin transferir el video a través de sí mismo.

## Hito 1 — Fundación y acceso

### Objetivo

Crear una aplicación segura que reconozca quién entra y qué puede hacer.

### Historias principales

- Como visitante, quiero iniciar sesión con Google.
- Como administrador, quiero permitir o bloquear correos concretos.
- Como lector, quiero ver un mensaje claro si no tengo autorización.
- Como administrador, quiero que mi rol sea distinto al de un lector.

### Entregables

- Proyecto Next.js con TypeScript, configuración de entorno y Docker para desarrollo.
- Proyecto de Supabase con autenticación de Google y PostgreSQL.
- Modelo inicial de usuario, roles y lista de acceso.
- Reglas de seguridad por fila para aislar los datos personales.
- Pantallas de inicio de sesión, acceso autorizado y acceso denegado.

### Criterio de aceptación

Un lector autorizado entra; un correo no autorizado no accede al catálogo; el administrador puede acceder a rutas administrativas protegidas.

## Hito 2 — Catálogo sincronizado

### Objetivo

Convertir una carpeta raíz de Drive en una biblioteca navegable dentro de la aplicación.

### Historias principales

- Como administrador, quiero sincronizar la biblioteca desde Drive.
- Como lector, quiero explorar categorías, cursos, módulos y lecciones.
- Como administrador, quiero corregir nombres y orden sin modificar Drive.

### Entregables

- Tablas de categoría, curso, módulo, lección y estado de sincronización.
- Adaptador de Drive de solo lectura.
- Algoritmo de estructura, orden natural y lista de reproducción.
- Página de catálogo y página de curso.
- Base de metadatos detectados y personalizados.

### Criterio de aceptación

Una sincronización crea un catálogo coherente desde una carpeta real de Drive y conserva las correcciones manuales tras repetirse.

## Hito 3 — Reproducción y progreso

### Objetivo

Completar el recorrido principal de aprendizaje.

### Historias principales

- Como lector, quiero reproducir una lección disponible para mí.
- Como lector, quiero volver al segundo donde la dejé.
- Como lector, quiero que continúe la siguiente lección al terminar la actual.
- Como lector, quiero desactivar la reproducción automática si lo prefiero.

### Entregables

- Página de reproductor integrada con el mecanismo validado en el Hito 0.
- Guardado periódico y restauración de progreso.
- Lista «Continuar viendo» y porcentaje por curso.
- Secuenciación automática entre módulos.
- Preferencia personal de reproducción automática.

### Criterio de aceptación

Un usuario puede abrir una lección, salir a mitad, volver desde otro dispositivo y continuar desde un punto cercano. Al terminar, se propone la siguiente lección correcta incluso si pertenece a otro módulo.

## Hito 4 — Aprendizaje personal

### Objetivo

Añadir las herramientas que acompañan el estudio sin ampliar el producto innecesariamente.

### Historias principales

- Como lector, quiero buscar cursos y lecciones.
- Como lector, quiero descargar una lección si Drive lo permite.
- Como lector, quiero escribir una nota vinculada al instante actual del video.
- Como lector, quiero pulsar una nota y volver al momento asociado.

### Entregables

- Búsqueda por título y metadatos.
- Botón de descarga condicionado por permisos de Drive.
- Notas privadas por lección y segundo de reproducción.
- Edición y eliminación de notas propias.

### Criterio de aceptación

El usuario encuentra contenido por texto, descarga una lección permitida y crea una nota que lo lleva de vuelta al instante correcto.

## Hito 5 — Panel administrativo

### Objetivo

Dar al administrador control de la experiencia sin tocar Drive.

### Entregables

- Panel de estado de biblioteca, usuarios y últimas sincronizaciones.
- Gestión de usuarios autorizados.
- Edición de metadatos, visibilidad y orden.
- Gestión de portadas automáticas y personalizadas.
- Registro de errores y archivos no encontrados.

### Criterio de aceptación

Solo el administrador puede cambiar catálogo, usuarios o portadas; un lector no puede acceder a ninguna de esas acciones.

## Hito 6 — Calidad y entrega privada

### Objetivo

Preparar una versión estable para el uso cotidiano de un grupo pequeño.

### Entregables

- Pruebas de permisos, progreso, orden y sincronización.
- Diseño responsive validado en teléfono y escritorio.
- Manejo de errores de red, Drive y sesión expirada.
- Variables secretas configuradas en despliegue.
- Copia de seguridad de base de datos y guía breve de operación.

### Criterio de aceptación

La aplicación puede ser usada de forma repetida por el administrador y amigos autorizados sin pérdida de progreso ni exposición de datos entre usuarios.

## Fuera del roadmap actual

- Exportación de notas.
- Reproducción offline dentro de la aplicación.
- Funciones sociales, pagos, catálogo público y compartir desde la app.
- Migración a laptop propia, Oracle Cloud o almacenamiento de videos propio.

Estas iniciativas permanecen documentadas como evolución futura, pero no bloquean el MVP.
