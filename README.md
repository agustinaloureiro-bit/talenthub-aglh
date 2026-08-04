# Talent Hub AGLH

Aplicación web productiva para inteligencia de talento, construida con React, TypeScript, TailwindCSS, Vite, Node.js, Express, Google OAuth y PostgreSQL.

## Ejecución local

1. Configurar las variables de entorno indicadas en `DEPLOY_RENDER.md`.
2. Ejecutar:

```bash
docker compose --env-file .env up --build
```

3. Abrir `http://localhost:5173`.
4. Iniciar sesión con una cuenta Google de `aglh.com.uy` o `yoiners.com`.

El contenedor API ejecuta las migraciones SQL automáticamente. En una instalación vacía, la primera cuenta corporativa válida queda como administradora; las siguientes ingresan con acceso de consulta hasta que un administrador cambie su rol.

## Decisiones implementadas

- No se cargan candidatos ni logs de ejemplo.
- `pgvector` está habilitado sobre PostgreSQL 16 para soportar embeddings cuando se conecte el proveedor de IA.
- El chat AGLH AI persiste conversaciones y responde con búsqueda determinística sobre datos reales de la base. La integración con LLM queda preparada mediante settings, sin simular respuestas externas.
- Las integraciones guardan configuración cifrable por backend y registran cada sincronización. No importan datos inventados.

## Comandos útiles

```bash
docker compose --env-file .env up --build
docker compose down
docker compose down -v
```
