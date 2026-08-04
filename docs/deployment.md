# Documentación de despliegue

## Despliegue con Docker Compose

1. Crear archivo `.env` desde `.env.example`.
2. Configurar `SESSION_SECRET`, las credenciales OAuth de Google y `POSTGRES_PASSWORD`.
3. Ejecutar:

```bash
docker compose --env-file .env up --build
```

4. Verificar:

```bash
curl http://localhost:4000/health
```

5. Abrir:

```text
http://localhost:5173
```

## Persistencia

PostgreSQL usa el volumen `postgres_data`. Para reiniciar la base desde cero:

```bash
docker compose down -v
```

## Producción

- Usar secretos fuertes en `.env`.
- Colocar el frontend detrás de HTTPS.
- Configurar en Google Cloud el callback exacto `https://talenthub-aglh.onrender.com/api/auth/google/callback`.
- Limitar `ALLOWED_GOOGLE_DOMAINS` a `aglh.com.uy,yoiners.com`.
- Configurar backups del volumen o usar PostgreSQL administrado compatible con pgvector.
- No habilitar accesos alternativos por contraseña.
