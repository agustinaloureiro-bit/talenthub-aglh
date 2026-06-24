import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(__dirname, "../../migrations");

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const files = (await fs.readdir(migrationDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(migrationDir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      console.log(`Applied migration ${file}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, lower($2), $3, 'admin')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = 'admin', is_active = true, updated_at = now()`,
    [config.adminName, config.adminEmail, passwordHash]
  );
}

migrate()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
