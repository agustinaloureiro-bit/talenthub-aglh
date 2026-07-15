import pg, { type QueryResultRow } from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRead(text: string, error: unknown) {
  const message = String((error as Error)?.message ?? error);
  return /^\s*(select|with)\b/i.test(text)
    && /Connection terminated unexpectedly|ECONNRESET|ETIMEDOUT|timeout|terminating connection|Connection ended unexpectedly/i.test(message);
}

export async function q<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await pool.query<T>(text, params);
      return result;
    } catch (error) {
      if (!isRetryableRead(text, error) || attempt === 2) throw error;
      await sleep(250 * (attempt + 1));
    }
  }
  return pool.query<T>(text, params);
}
