import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { databaseErrorDetail, isDatabaseUnavailableError, setDatabaseStatus } from "../db/status.js";

export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(400).json({ error: "Datos inválidos", details: error.flatten() });
  if (isDatabaseUnavailableError(error)) {
    setDatabaseStatus("unavailable", databaseErrorDetail(error));
    console.error("Database unavailable", error);
    return res.status(503).json({
      error: "La base de candidatos no está disponible en este momento.",
      code: "DATABASE_UNAVAILABLE"
    });
  }
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor" });
}
