# Configuración local

1. Copia `.env.local.example` como `.env.local` dentro de la carpeta `web`.
2. En Supabase, abre **Project Settings → API**.
3. Copia la URL del proyecto a `NEXT_PUBLIC_SUPABASE_URL`.
4. Copia la clave **Publishable** a `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Las dos variables `NEXT_PUBLIC_` son identificadores públicos del proyecto y pueden ser leídas por la aplicación web. No son contraseñas.

Nunca incluyas en `.env.local` el archivo JSON de Google, el `client_secret`, una clave `secret` de Supabase, la contraseña de PostgreSQL ni un token de Google Drive. `.env.local` está ignorado por Git.
