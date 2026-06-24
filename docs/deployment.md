# Documentación de despliegue

## Despliegue con Docker Compose

1. Crear archivo `.env` desde `.env.example`.
2. Cambiar `JWT_SECRET`, `POSTGRES_PASSWORD` y credenciales del administrador.
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
- Restringir `CORS_ORIGIN` al dominio real.
- Configurar backups del volumen o usar PostgreSQL administrado compatible con pgvector.
- Rotar `ADMIN_PASSWORD` luego del primer ingreso si se usa una contraseña temporal.
