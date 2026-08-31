export type DatabaseState = "starting" | "migrating" | "ready" | "unavailable";

type DatabaseStatus = {
  state: DatabaseState;
  checkedAt: string | null;
  detail: string | null;
};

const status: DatabaseStatus = {
  state: "starting",
  checkedAt: null,
  detail: null
};

export function setDatabaseStatus(state: DatabaseState, detail: string | null = null) {
  status.state = state;
  status.checkedAt = new Date().toISOString();
  status.detail = detail;
}

export function getDatabaseStatus(): DatabaseStatus {
  return { ...status };
}

export function databaseErrorDetail(error: unknown) {
  const code = String((error as { code?: unknown })?.code ?? "").trim();
  const raw = String((error as Error)?.message ?? error ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database]");
  const message = raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
  return [code, message].filter(Boolean).join(": ") || "No se pudo conectar con la base de datos";
}

export function isDatabaseUnavailableError(error: unknown) {
  const code = String((error as { code?: unknown })?.code ?? "");
  const message = String((error as Error)?.message ?? error ?? "");
  return [
    "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
    "57P01", "57P02", "57P03", "53300", "XX000", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"
  ].includes(code) || /tenant\/user .* not found|connection terminated|connect econn|database .* does not exist|timeout expired|ENOTFOUND/i.test(message);
}
