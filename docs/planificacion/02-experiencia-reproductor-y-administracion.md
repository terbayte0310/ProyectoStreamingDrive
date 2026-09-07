# Experiencia de reproducción y administración

## Descarga en el dispositivo actual

### Decisión

La aplicación mostrará un botón de descarga por lección. Al pulsarlo, abrirá el enlace de descarga que Google Drive habilite para ese archivo; el navegador y el sistema operativo del usuario decidirán la carpeta local de destino.

La aplicación no almacenará ni intermediará los archivos de video. Solo iniciará una descarga explícita solicitada por el usuario.

### Motivo

Esto permite guardar una lección para verla fuera de la aplicación sin convertir el MVP en un sistema de almacenamiento offline, sincronización o limpieza de archivos locales.

### Regla de acceso

El botón solo se mostrará cuando Google Drive indique que el usuario puede descargar el archivo. Si Drive restringe la descarga, la aplicación explicará que esa lección no está disponible para descargar.

## Reproducción automática

### Comportamiento esperado

Cuando termina una lección, la aplicación iniciará la siguiente lección disponible del mismo curso. Antes de que termine, mostrará una cuenta regresiva y una opción visible para cancelar.

El usuario también podrá desactivar la reproducción automática en sus preferencias. La opción estará activada por defecto.

### Cómo se elige la siguiente lección

La aplicación no asumirá que la siguiente lección es un archivo hermano de la carpeta actual. Primero transformará toda la estructura del curso en una lista de reproducción ordenada.

Ejemplo:

```text
Curso 1
├── Fase 1
│   ├── 001 Introducción.mp4
│   └── 002 Fundamentos.mp4
└── Fase 2
    ├── 001 Práctica.mp4
    └── 002 Cierre.mp4
```

La lista resultante será: Introducción → Fundamentos → Práctica → Cierre. Por ello, tras la última lección de Fase 1 se abrirá la primera lección de Fase 2.

### Regla de orden inicial

1. Recorrer los directorios de un curso en profundidad, de arriba hacia abajo.
2. Ordenar carpetas y archivos mediante orden natural: `2` antes de `10`.
3. Tratar archivos audiovisuales compatibles como lecciones.
4. Asociar subtítulos y recursos al archivo audiovisual correspondiente, sin convertirlos en lecciones independientes.
5. Ignorar archivos técnicos, como `desktop.ini`, como contenido reproducible.

La regla se probará con la estructura real de `D:\\Cursos`. El panel de administración permitirá corregir manualmente el orden cuando los nombres de carpetas no expresen el orden deseado.

## Panel de administración

## Acceso

Solo el propietario tendrá el rol `administrador`. Este rol se asignará explícitamente en la base de datos y no solo por cómo se vea la interfaz.

Los demás usuarios serán `lectores`: pueden navegar, reproducir, descargar si Drive lo permite y guardar únicamente su propio progreso.

## Funciones del MVP administrativo

### Panel de estado

- Número de usuarios autorizados.
- Usuarios activos recientemente.
- Cursos, temas y lecciones detectados.
- Última sincronización con Google Drive.
- Archivos que ya no se encuentran o que no se pueden reproducir.
- Errores recientes de sincronización o reproducción.

### Gestión de catálogo y experiencia

- Ejecutar una sincronización manual del catálogo desde la carpeta raíz configurada de Google Drive.
- Ocultar o mostrar cursos y lecciones en la aplicación sin borrarlos de Drive.
- Corregir el orden de cursos, temas o lecciones cuando el orden automático no sea correcto.
- Definir una portada para categorías, cursos y temas.
- Marcar una portada como automática o personalizada.

### Portadas

Para crear una portada automática, el sistema podrá extraer un fotograma de una lección elegida del curso. La imagen resultante se guardará como metadato de la aplicación, no se añadirá ni modificará en Google Drive.

El administrador podrá reemplazarla por una imagen oficial personalizada. La imagen personalizada también será un metadato de la aplicación.

## Modelo de permisos inicial

| Rol | Acceso |
| --- | --- |
| Administrador | Todo lo disponible para lectores y la gestión del catálogo, portadas, orden, sincronización y usuarios autorizados. |
| Lector | Biblioteca compartida, reproducción, descarga permitida por Drive y progreso propio. |

## Requisitos añadidos

| ID | Requisito |
| --- | --- |
| RF-10 | El sistema debe permitir al usuario descargar una lección cuando Google Drive le conceda permiso de descarga. |
| RF-11 | El sistema debe iniciar la siguiente lección ordenada al terminar la actual, salvo que el usuario cancele o desactive la reproducción automática. |
| RF-12 | El sistema debe calcular una secuencia reproducible de lecciones a partir de las carpetas y archivos de cada curso. |
| RF-13 | El sistema debe permitir al administrador ejecutar la sincronización de la biblioteca. |
| RF-14 | El sistema debe permitir al administrador ajustar el orden visible del catálogo sin modificar Google Drive. |
| RF-15 | El sistema debe permitir al administrador asignar o reemplazar portadas de categorías, cursos y temas. |
| RF-16 | El sistema debe mostrar al administrador el estado básico de catálogo, usuarios y errores. |

## Decisiones para una fase posterior

- Confirmar los formatos de video y subtítulos que se admitirán.
- Definir cuándo una lección se considera terminada para calcular el progreso del curso.
- Elegir si la creación automática de portadas se ejecuta durante la sincronización o bajo demanda desde el panel administrativo.
