# Prueba de lectura de Google Drive

Esta prueba confirma que la aplicación puede listar los elementos dentro de la carpeta raíz de la biblioteca. Es de solo lectura y no conserva tokens de Google.

## 1. Completa las variables locales

En `web/.env.local`, completa una sola vez estas líneas que ya existen:

```env
GOOGLE_DRIVE_CLIENT_ID=tu_client_id_de_google
GOOGLE_DRIVE_CLIENT_SECRET=tu_client_secret_de_google
GOOGLE_DRIVE_ROOT_FOLDER_ID=id_de_100_BIBLIOTECA_DE_CURSOS
```

No envíes esos valores por chat y no agregues `NEXT_PUBLIC_` a ninguno: el navegador nunca debe recibirlos.

Para obtener el último valor, abre la carpeta `100_BIBLIOTECA_DE_CURSOS` en Drive. La parte posterior a `/folders/` de su URL es el identificador de carpeta. Copia únicamente esa parte a tu archivo local.

## 2. Registra el retorno temporal en Google Cloud

En Google Cloud Console: APIs y servicios → Credenciales → tu cliente OAuth web → *Authorized redirect URIs*, agrega exactamente:

```text
http://localhost:3000/api/drive/pilot/callback
```

Conserva también el retorno de Supabase que ya configuraste. Ambos son necesarios y son distintos: uno inicia sesión y el otro obtiene permiso temporal para leer Drive.

## 3. Ejecuta la prueba

Con el servidor local activo, visita `http://localhost:3000/drive-pilot` y usa **Conectar y leer la carpeta raíz**. Elige la cuenta propietaria de la biblioteca cuando Google la solicite.

El resultado será JSON con los elementos directos de `100_BIBLIOTECA_DE_CURSOS`. Ese resultado permite comprobar la clasificación inicial antes de crear la sincronización persistente.
