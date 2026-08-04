import dotenv from "dotenv";

dotenv.config();

export const config = {
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: required("SESSION_SECRET"),
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  googleCallbackUrl: required("GOOGLE_CALLBACK_URL"),
  allowedGoogleDomains: required("ALLOWED_GOOGLE_DOMAINS")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean),
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  isProduction: process.env.NODE_ENV === "production"
};

export function isAllowedGoogleEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return false;
  return config.allowedGoogleDomains.includes(normalized.slice(separator + 1));
}

function required(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
}
