# Talent Hub AGLH

Aplicación web productiva para inteligencia de talento, construida con React, TypeScript, TailwindCSS, Vite, Node.js, Express, JWT y PostgreSQL.

## Ejecución local

1. Copiar `.env.example` a `.env` y cambiar secretos.
2. Ejecutar:

```bash
docker compose --env-file .env up --build
```

3. Abrir `http://localhost:5173`.
4. Iniciar sesión con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

El contenedor API ejecuta migraciones SQL y crea el usuario administrador configurado por variables de entorno.

## Decisiones implementadas

- No se cargan candidatos ni logs de ejemplo. La base queda vacía salvo el administrador real configurado.
- `pgvector` está habilitado sobre PostgreSQL 16 para soportar embeddings cuando se conecte el proveedor de IA.
- El chat AGLH AI persiste conversaciones y responde con búsqueda determinística sobre datos reales de la base. La integración con LLM queda preparada mediante settings, sin simular respuestas externas.
- Las integraciones guardan configuración cifrable por backend y registran cada sincronización. No importan datos inventados.

## Comandos útiles

```bash
docker compose --env-file .env up --build
docker compose down
docker compose down -v
```
