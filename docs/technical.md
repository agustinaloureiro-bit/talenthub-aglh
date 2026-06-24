# Documentación técnica

## Módulos

- Frontend: React, TypeScript, TailwindCSS y Vite.
- Backend: Node.js, Express, TypeScript, JWT, validación con Zod y logs HTTP con Pino.
- Base de datos: PostgreSQL 16 con extensión pgvector.
- Infraestructura: Docker Compose con servicios `db`, `api` y `web`.

## Entidades principales

- `users`: usuarios internos con roles `admin`, `recruiter` y `viewer`.
- `candidates`: ficha maestra de candidato.
- `candidate_sources`: trazabilidad de origen por candidato.
- `candidate_work_history`, `candidate_education`, `documents`, `candidate_processes`: detalles funcionales de la ficha.
- `processes`, `interviews`, `evaluations`: procesos de selección e inteligencia histórica.
- `integrations`, `sync_logs`: conectores y auditoría operativa.
- `chat_sessions`, `chat_messages`: AGLH AI persistente.
- `app_settings`: configuración operativa.
- `audit_logs`: acciones críticas.

## Autorización

- `viewer`: lectura.
- `recruiter`: lectura, creación, edición, sincronizaciones y chat.
- `admin`: todas las acciones, incluyendo usuarios, settings e integraciones.

## API REST

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/candidates`
- `POST /api/candidates`
- `GET /api/candidates/:id`
- `PATCH /api/candidates/:id`
- `DELETE /api/candidates/:id`
- `POST /api/candidates/:id/work`
- `POST /api/candidates/:id/education`
- `POST /api/candidates/:id/documents`
- `POST /api/candidates/:id/processes`
- `POST /api/search/talent`
- `GET /api/chat/sessions`
- `POST /api/chat/sessions`
- `GET /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/messages`
- `GET /api/integrations`
- `PATCH /api/integrations/:id`
- `POST /api/integrations/:id/sync`
- `GET /api/settings`
- `PATCH /api/settings/:key`
- `GET /api/users`
- `POST /api/users`

## Manejo de errores y logs

Todas las rutas validan entrada con Zod y responden JSON uniforme. Pino registra requests HTTP en el backend. `audit_logs` conserva acciones relevantes de candidatos.

## Ambigüedades resueltas

- No se sembraron candidatos ficticios. La UI queda lista para datos reales y muestra estados vacíos.
- La búsqueda inicial usa full-text PostgreSQL y ranking por calidad. pgvector queda en el esquema para embeddings reales.
- El chat no simula un LLM externo: persiste mensajes y responde desde búsqueda real de candidatos.
- Las integraciones registran configuración y sincronizaciones. La importación externa queda lista para conectar credenciales reales.
