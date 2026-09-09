# Despliegue, operación y respaldo

## Estado actual

La aplicación corre con `npm run dev` en `http://localhost:3000`. Eso es un entorno de desarrollo, no un servicio doméstico. No hay remoto Git, procedimiento automático de arranque, monitor de salud ni copia lógica verificada de Supabase.

## Opción A: aplicación en la nube

Adecuada si se desea acceso desde teléfono fuera de casa y para amigos autorizados.

- Desplegar Next.js en un proveedor con HTTPS.
- Mantener Supabase y Google Drive como servicios administrados.
- Configurar secretos solo en el proveedor.
- Registrar dominio y callbacks en Supabase/Google.
- Extraer la sincronización de 6,8 minutos a un job durable o ejecutor separado.

Ventaja: disponibilidad y HTTPS sencillos. Riesgo: los procesos largos no deben depender de una función web corta.

## Opción B: servidor doméstico privado

Adecuada para uso propio en dispositivos autorizados.

- Ejecutar `npm run build` y `npm run start`, nunca `npm run dev`.
- Instalarlo como servicio de Windows con reinicio automático.
- Usar Tailscale Serve o un reverse proxy correctamente configurado para HTTPS.
- No abrir directamente el puerto 3000 a Internet.
- Ejecutar sincronizaciones largas en el mismo host mediante una cola persistente.

El Service Worker funciona en `localhost`, pero para un teléfono usando una IP LAN se necesita un origen HTTPS confiable.

## Repositorio y recuperación

Antes de continuar:

1. Crear `.gitignore` en la raíz para `node_modules/`, inventarios privados, logs y caches.
2. Confirmar los cambios de la interfaz en un commit claro.
3. Configurar un remoto privado y empujar la rama estable.
4. Etiquetar versiones que hayan pasado el checklist doméstico.
5. Documentar cómo reconstruir `.env.local` sin guardar sus valores.

## Copia de Supabase

Las migraciones reconstruyen el esquema, pero no recuperan progreso, notas, perfiles ni personalizaciones. Preparar una tarea periódica que genere:

- esquema;
- datos de tablas de aplicación;
- roles necesarios;
- manifiesto con fecha y checksum.

Guardar una copia fuera del PC y fuera del mismo proyecto Supabase. Ejecutar una restauración de prueba en un proyecto o instancia desechable; una copia que nunca se restauró no es un plan comprobado.

## Observabilidad mínima

- logs estructurados sin tokens;
- ID de ejecución de sincronización;
- estado y duración de cada fase;
- errores recientes visibles para el administrador;
- endpoint simple de salud;
- captura de errores del navegador con consentimiento y sin datos sensibles;
- alerta solo cuando el servicio no arranca o una sincronización falla.

## Runbook doméstico

Documentar comandos y decisiones para:

- instalar dependencias desde cero;
- aplicar migraciones pendientes;
- iniciar/detener/reiniciar el servicio;
- autorizar nuevamente Google Drive;
- ejecutar preview y publicar;
- realizar y restaurar backup;
- volver a la versión anterior;
- comprobar espacio libre.

El 9 de septiembre de 2026 había aproximadamente 67,8 GiB libres en `C:` y 109,9 GiB en `D:`. Evitar duplicar medios durante tareas futuras y establecer una alerta de espacio.

