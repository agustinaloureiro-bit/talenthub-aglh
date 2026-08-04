# Publicar Talent Hub AGLH en Render

La aplicación usa exclusivamente Google OAuth. No existe un usuario o contraseña propios de TalentHub.

## Variables de entorno

Configurar en Render:

- `DATABASE_URL`: conexión PostgreSQL/Supabase.
- `GOOGLE_CLIENT_ID`: ID del cliente OAuth de Google Cloud.
- `GOOGLE_CLIENT_SECRET`: secreto del cliente OAuth de Google Cloud.
- `GOOGLE_CALLBACK_URL`: `https://talenthub-aglh.onrender.com/api/auth/google/callback`
- `ALLOWED_GOOGLE_DOMAINS`: `aglh.com.uy,yoiners.com`
- `SESSION_SECRET`: valor aleatorio largo; Render puede generarlo.
- `CORS_ORIGIN`: `https://talenthub-aglh.onrender.com`
- `SERVE_STATIC`: `true`

No guardar estos valores en Git.

## Google Cloud

Crear un cliente OAuth 2.0 de tipo **Aplicación web** y registrar exactamente esta URI de redirección autorizada:

`https://talenthub-aglh.onrender.com/api/auth/google/callback`

En la pantalla de consentimiento, configurar la aplicación como interna si ambas cuentas pertenecen a la misma organización de Google Workspace. Si pertenecen a organizaciones distintas, agregar los usuarios permitidos según la modalidad de publicación elegida en Google Cloud.

## Acceso

- Solo se aceptan emails verificados terminados exactamente en `@aglh.com.uy` o `@yoiners.com`.
- La primera cuenta válida de una base vacía se crea como administradora.
- Las cuentas nuevas posteriores se crean con rol de consulta y un administrador puede asignarles otro rol.
- Los tokens de Google usados para iniciar sesión no se guardan.
