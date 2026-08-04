# Scripts de instalación

## Instalación productiva local

```bash
cp .env.example .env
docker compose --env-file .env up --build
```

## Desarrollo sin Docker

Requiere PostgreSQL 16 con pgvector.

```bash
cd backend
npm install
npm run migrate
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

## Variables obligatorias

- `DATABASE_URL`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `ALLOWED_GOOGLE_DOMAINS`

Para producción, el callback es:

```text
https://talenthub-aglh.onrender.com/api/auth/google/callback
```
