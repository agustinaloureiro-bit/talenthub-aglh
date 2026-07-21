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

export async function qWithTimeout<T extends QueryResultRow = any>(text: string, params: unknown[] = [], timeoutMs = 15_000) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [`${Math.max(1_000, timeoutMs)}ms`]);
    const result = await client.query<T>(text, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
