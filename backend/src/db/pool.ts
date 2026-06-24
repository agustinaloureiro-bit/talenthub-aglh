import pg, { type QueryResultRow } from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function q<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
  const result = await pool.query<T>(text, params);
  return result;
}
