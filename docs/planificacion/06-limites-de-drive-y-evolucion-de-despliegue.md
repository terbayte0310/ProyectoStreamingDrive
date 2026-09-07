# Límites de Google Drive y evolución de despliegue

## Por qué revisamos límites antes de construir

Un límite no es necesariamente un bloqueo. Es una condición de diseño: nos indica qué operaciones deben ser poco frecuentes, qué errores debemos manejar y qué suposiciones no podemos hacer.

Para este proyecto, los límites relevantes se separan en tres grupos: uso de API, autorización de Google y entrega de archivos.

## Límites de Google Drive que afectan el diseño

### Uso de la API

Google mide las operaciones de Drive API con unidades de cuota. Según la documentación vigente consultada en septiembre de 2026, los proyectos nuevos tienen un límite de 1,000,000 unidades por minuto por proyecto, 325,000 unidades por minuto por usuario y 1 TB diario de salida por proyecto. Una lectura individual consume menos que listar contenido y descargar mediante la API consume más.

El inventario actual tiene aproximadamente 21,102 archivos. Esta escala es razonable para sincronizaciones periódicas, pero no para escanear toda la biblioteca cada vez que una persona abre una página.

### Decisión de diseño

- El catálogo se lee desde PostgreSQL, no directamente desde Drive en cada visita.
- Solo el administrador puede iniciar la sincronización en el MVP.
- La sincronización solicitará únicamente los campos necesarios y procesará resultados paginados.
- Los errores 403 o 429 de cuota deben reintentarse con espera exponencial, no con peticiones continuas.
- Reproducción y descarga serán accesos directos del navegador a Drive; no se deben implementar como descargas repetidas desde el servidor de la aplicación.

### Descarga y reproducción

Cada usuario necesita permiso de lectura en la carpeta compartida. La aplicación comprobará la capacidad de descarga antes de mostrar el botón, pero Google Drive sigue siendo la autoridad final al entregar el archivo.

No asumiremos un ancho de banda, límite de reproducción o descarga diario específico para los enlaces directos: lo validaremos con una cuenta amiga durante el *spike* y supervisaremos errores reales. Si se accede por la API, el límite de salida de la API sí aplica.

## Límites y requisitos de OAuth

### Aplicación para unos pocos amigos conocidos

La documentación de Google contempla como excepción de verificación los usos personales o con pocas personas conocidas. Esto encaja inicialmente con este proyecto.

Sin embargo, una aplicación externa en estado de prueba con permisos de Drive que no sean solo identidad recibe tokens de actualización con vida limitada a siete días. Por ello, durante desarrollo el propietario deberá volver a autorizar la conexión de biblioteca con cierta frecuencia.

### Al crecer

El permiso `drive.readonly` es restringido. Si la aplicación deja de ser un uso personal limitado o si un servidor externo almacena o transmite datos de alcance restringido, Google puede exigir verificación y una evaluación de seguridad.

No construiremos basándonos en una excepción sin comprobarla. Antes de invitar a más personas, revisaremos el estado de consentimiento en Google Cloud Console, la cantidad de usuarios y el uso exacto del token del propietario.

## Riesgos y respuesta planificada

| Riesgo | Cómo lo reducimos |
| --- | --- |
| La sincronización excede cuota | Catálogo local, sincronización manual y reintentos con espera. |
| El token de lectura vence o se revoca | Panel administrativo muestra el estado y permite reconectar solo al administrador. |
| Un amigo no puede abrir un video | Comprobar que su correo esté autorizado en la app y compartido como lector en Drive. |
| Drive rechaza una descarga | Ocultar o desactivar el botón de descarga e indicar el motivo. |
| El modo de reproducción elegido no funciona para usuarios externos | Resolverlo en el *spike* antes de crear el reproductor completo. |

## Arquitectura portable a futuro

La primera implementación puede usar servicios gestionados para aprender y avanzar rápido. Eso no significa quedar atrapado en ellos.

### Principios de portabilidad

- Base de datos PostgreSQL estándar, sin depender de extensiones innecesarias del proveedor.
- Migraciones de base de datos guardadas en el repositorio.
- Aplicación ejecutable como contenedor Docker.
- Configuración mediante variables de entorno, no valores fijos del proveedor.
- Adaptadores aislados para identidad, portadas y Google Drive.
- Videos siempre fuera de la aplicación, en Google Drive, hasta que se decida cambiar explícitamente de fuente.

### Ruta de evolución

```text
MVP gestionado
Next.js + Supabase + Google Drive
        │
        ├── Aprender despliegue y observabilidad
        │
        └── Migración opcional
             ├── Laptop personal: Docker Compose + PostgreSQL + almacenamiento local
             └── Oracle Cloud u otro VPS: Docker + PostgreSQL + almacenamiento compatible
```

En ambas rutas, Next.js y PostgreSQL pueden mantenerse. El cambio principal sería sustituir los servicios administrados por equivalentes autoalojados: autenticación, almacenamiento de portadas, base de datos y tareas programadas.

Google Drive seguirá siendo una dependencia mientras almacene los cursos. Lograr independencia total requeriría, en una fase posterior, mover los videos a almacenamiento propio; esa decisión implicaría coste, copias de seguridad, ancho de banda y responsabilidades nuevas.

## Decisiones futuras anotadas

- Evaluar Docker Compose desde el desarrollo local para practicar despliegue autoalojado.
- Comparar laptop personal y Oracle Cloud cuando se necesite disponibilidad permanente fuera de casa.
- Definir copias de seguridad, dominio, HTTPS y acceso remoto antes de publicar un servidor propio.
- Considerar una migración de Google Drive a almacenamiento propio solo si los beneficios justifican la operación adicional.
