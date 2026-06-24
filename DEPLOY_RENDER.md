# Publicar Talent Hub AGLH en Render

Esta configuración deja la aplicación completa en internet con:

- 1 servicio web Render para frontend + API.
- 1 base PostgreSQL administrada por Render.
- Migraciones automáticas al iniciar el servicio.

## Pasos

1. Crear cuenta o iniciar sesión en Render:
   https://dashboard.render.com

2. Subir este proyecto a GitHub.

3. En Render, elegir:
   **New +** → **Blueprint**

4. Conectar el repositorio de GitHub donde esté este proyecto.

5. Render va a detectar `render.yaml`.

6. Cuando pida `ADMIN_PASSWORD`, escribir una contraseña segura.

7. Crear el Blueprint.

8. Al finalizar, abrir la URL pública del servicio `talenthub-aglh`.

## Usuario inicial

- Email: `admin@aglh.com`
- Contraseña: la que ingresaste en Render como `ADMIN_PASSWORD`

## Notas

- La app no depende de tu computadora una vez desplegada.
- La base de datos vive en Render.
- Cada cambio futuro se publica subiendo cambios al repositorio conectado.
