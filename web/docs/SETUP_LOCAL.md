# Configuración local

1. Copia `.env.local.example` como `.env.local` dentro de la carpeta `web`.
2. En Supabase, abre **Project Settings → API**.
3. Copia la URL del proyecto a `NEXT_PUBLIC_SUPABASE_URL`.
4. Copia la clave **Publishable** a `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Las dos variables `NEXT_PUBLIC_` son identificadores públicos del proyecto y pueden ser leídas por la aplicación web. No son contraseñas.

Las credenciales OAuth de Drive sí se configuran mediante `GOOGLE_DRIVE_CLIENT_ID` y `GOOGLE_DRIVE_CLIENT_SECRET`, como muestra `.env.local.example`. Son variables privadas del servidor: no uses el prefijo `NEXT_PUBLIC_`, no las compartas y no confirmes `.env.local` en Git. Nunca guardes allí una clave secreta de Supabase, la contraseña de PostgreSQL ni un token obtenido de Google Drive.
