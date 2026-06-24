import dotenv from "dotenv";

dotenv.config();

export const config = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  adminEmail: required("ADMIN_EMAIL"),
  adminPassword: required("ADMIN_PASSWORD"),
  adminName: process.env.ADMIN_NAME ?? "Administrador AGLH",
};

function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
}
