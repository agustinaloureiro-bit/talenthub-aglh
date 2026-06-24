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
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`
- `VITE_API_URL`
