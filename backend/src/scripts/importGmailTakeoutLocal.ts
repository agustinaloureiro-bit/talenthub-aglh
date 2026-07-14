import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { candidatesFromGmailRawMessage, isUsableCandidate } from "../routes/integrations.js";
import { importCandidate } from "../services/candidateIngestion.js";
import { q, pool } from "../db/pool.js";

type ImportState = {
  file: string;
  entry: string;
  processedMessages: number;
  newRecords: number;
  updatedRecords: number;
  skipped: number;
  reviewedAttachments: number;
  candidateAttachments: number;
  updatedAt: string;
};

type Counters = Omit<ImportState, "file" | "entry" | "updatedAt">;

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Uso:
  pnpm local:import-gmail -- --file "/ruta/takeout.zip"
  pnpm local:import-gmail -- --file "/ruta/mail.mbox"

Opciones:
  --state "./gmail-import-state.json"  Archivo de progreso para reanudar.
  --limit 1000                        Procesa solo N mails y frena.
  --dry-run                           Revisa y cuenta sin guardar en Supabase.
`);
}

async function readState(statePath: string): Promise<ImportState | null> {
  try {
    return JSON.parse(await fsp.readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeState(statePath: string, state: ImportState) {
  await fsp.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function listZipEntries(filePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-Z1", filePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `unzip -Z1 fallo con codigo ${code}`));
      else resolve(stdout.split(/\r?\n/).filter((line) => /\.mbox$/i.test(line)));
    });
  });
}

function streamForFile(filePath: string, entry?: string) {
  if (entry) {
    const child = spawn("unzip", ["-p", filePath, entry], { stdio: ["ignore", "pipe", "inherit"] });
    child.on("error", (error) => {
      console.error("No se pudo abrir el zip:", error.message);
      process.exitCode = 1;
    });
    return child.stdout;
  }
  return fs.createReadStream(filePath);
}

async function processMboxStream(input: NodeJS.ReadableStream, sourceName: string, initial: Counters, options: { statePath: string; filePath: string; entry: string; limit: number; dryRun: boolean }) {
  const counters = { ...initial };
  let current = "";
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  async function flush() {
    if (!current.trim()) return false;
    counters.processedMessages += 1;
    const messageNumber = counters.processedMessages;
    const raw = current;
    current = "";

    if (messageNumber <= initial.processedMessages) return false;
    const parsed = candidatesFromGmailRawMessage(raw, sourceName, messageNumber);
    counters.reviewedAttachments += parsed.stats.reviewedAttachments;
    counters.candidateAttachments += parsed.stats.candidateAttachments;
    counters.skipped += parsed.stats.skipped;

    for (const candidate of parsed.rows) {
      if (options.dryRun) {
        counters.newRecords += 1;
        continue;
      }
      const result = await importCandidate("gmail", candidate, isUsableCandidate);
      if (result === "new") counters.newRecords += 1;
      if (result === "updated") counters.updatedRecords += 1;
      if (result === "skipped") counters.skipped += 1;
    }

    if (messageNumber % 100 === 0) {
      await writeState(options.statePath, {
        file: options.filePath,
        entry: options.entry,
        ...counters,
        updatedAt: new Date().toISOString()
      });
      console.log(`Procesados ${messageNumber} mails | CVs detectados ${counters.candidateAttachments} | nuevos ${counters.newRecords} | actualizados ${counters.updatedRecords} | omitidos ${counters.skipped}`);
    }

    return options.limit > 0 && messageNumber >= initial.processedMessages + options.limit;
  }

  for await (const line of rl) {
    if (line.startsWith("From ") && current.length > 0) {
      if (await flush()) break;
    }
    current += `${line}\n`;
  }
  if (current.length > 0 && (options.limit <= 0 || counters.processedMessages < initial.processedMessages + options.limit)) {
    await flush();
  }
  return counters;
}

async function main() {
  const filePath = path.resolve(arg("--file"));
  if (!filePath || filePath === process.cwd()) {
    usage();
    process.exit(1);
  }

  const statePath = path.resolve(arg("--state") || path.join(process.cwd(), "gmail-takeout-import-state.json"));
  const limit = Number(arg("--limit") || 0);
  const dryRun = hasFlag("--dry-run");
  const state = await readState(statePath);
  const lower = filePath.toLowerCase();
  const entries = lower.endsWith(".zip") ? await listZipEntries(filePath) : [""];
  if (entries.length === 0) throw new Error("No encontre archivos .mbox dentro del .zip.");

  let totals: Counters = {
    processedMessages: 0,
    newRecords: 0,
    updatedRecords: 0,
    skipped: 0,
    reviewedAttachments: 0,
    candidateAttachments: 0
  };

  console.log(`Importando Gmail Takeout local: ${filePath}`);
  if (dryRun) console.log("Modo prueba: no guarda en Supabase.");
  for (const entry of entries) {
    const canResumeEntry = state && state.file === filePath && state.entry === entry;
    const initial: Counters = canResumeEntry ? {
      processedMessages: state.processedMessages,
      newRecords: state.newRecords,
      updatedRecords: state.updatedRecords,
      skipped: state.skipped,
      reviewedAttachments: state.reviewedAttachments,
      candidateAttachments: state.candidateAttachments
    } : {
      processedMessages: 0,
      newRecords: 0,
      updatedRecords: 0,
      skipped: 0,
      reviewedAttachments: 0,
      candidateAttachments: 0
    };
    console.log(entry ? `Leyendo ${entry}` : "Leyendo MBOX");
    if (initial.processedMessages > 0) console.log(`Reanudando desde mail ${initial.processedMessages + 1}`);
    const counters = await processMboxStream(
      streamForFile(filePath, entry || undefined),
      entry ? `${path.basename(filePath)}/${entry}` : path.basename(filePath),
      initial,
      { statePath, filePath, entry, limit, dryRun }
    );
    totals = counters;
    await writeState(statePath, { file: filePath, entry, ...counters, updatedAt: new Date().toISOString() });
  }

  if (!dryRun) {
    const message = `Gmail Takeout local: ${totals.processedMessages} mails procesados, ${totals.reviewedAttachments} adjuntos revisados, ${totals.candidateAttachments} CVs detectados. Importados: ${totals.newRecords} nuevos, ${totals.updatedRecords} actualizados, ${totals.skipped} omitidos.`;
    await q(
      "INSERT INTO sync_logs (integration_id, source, finished_at, duration_ms, status, new_records, updated_records, errors, message) VALUES ('gmail','Gmail Takeout local',now(),0,$1,$2,$3,$4,$5)",
      [totals.skipped > 0 ? "warning" : "success", totals.newRecords, totals.updatedRecords, totals.skipped, message]
    );
    await q(
      "UPDATE integrations SET last_sync_at=now(), total_imported=total_imported+$1, status='connected', config=config || $2::jsonb, updated_at=now() WHERE id='gmail'",
      [totals.newRecords + totals.updatedRecords, JSON.stringify({
        sessionStatus: "connected",
        sessionLastError: null,
        lastAgentMessage: message,
        gmailTakeoutLocalImportedAt: new Date().toISOString(),
        gmailTakeoutLocalLastFile: path.basename(filePath)
      })]
    );
  }

  console.log(`Listo. Mails ${totals.processedMessages}, adjuntos ${totals.reviewedAttachments}, CVs ${totals.candidateAttachments}, nuevos ${totals.newRecords}, actualizados ${totals.updatedRecords}, omitidos ${totals.skipped}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
