import type { AgentSyncResult, CandidateDocumentImport, CandidateImport } from "../agents/types.js";

const AGLH_AUTH_API = "https://prod-aglh-auth-service.herokuapp.com/api/v1/auth";
const AGLH_TALENT_API = "https://prod-aglh-backend.herokuapp.com/api/v1/execute/talent";
const AGLH_PROFILE_BASE = "https://aglh.com.uy";
const DEFAULT_PAGES_PER_SYNC = 60;
const DEFAULT_PAGE_CONCURRENCY = 6;
const DEFAULT_CV_DOWNLOADS_PER_SYNC = 8;
const MAX_CV_BYTES = 8 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

function text(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function deepValuesForKeys(value: unknown, keys: string[], depth = 0): unknown[] {
  if (!value || depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((item) => deepValuesForKeys(item, keys, depth + 1));
  const row = object(value);
  if (!row) return [];
  const wanted = new Set(keys.map(normalizedKey));
  const direct = Object.entries(row)
    .filter(([key]) => wanted.has(normalizedKey(key)))
    .map(([, child]) => child);
  return [...direct, ...Object.values(row).flatMap((child) => deepValuesForKeys(child, keys, depth + 1))];
}

function firstDeepText(value: unknown, keys: string[]) {
  for (const item of deepValuesForKeys(value, keys)) {
    const direct = text(item);
    if (direct) return direct;
    const nested = object(item);
    if (nested) {
      const label = text(nested.name ?? nested.nombre ?? nested.label ?? nested.value);
      if (label) return label;
    }
  }
  return "";
}

function textsFrom(value: unknown, keys: string[]): string[] {
  const values: string[] = deepValuesForKeys(value, keys).flatMap((item): string[] => {
    if (Array.isArray(item)) return item.flatMap((child): string[] => textsFrom(child, ["name", "nombre", "label", "value"]));
    const direct = text(item);
    if (direct) return [direct];
    const nested = object(item);
    return nested ? [text(nested.name ?? nested.nombre ?? nested.label ?? nested.value)] : [];
  });
  return unique(values);
}

function emailsFrom(value: unknown) {
  return unique(deepValuesForKeys(value, ["email", "mail", "correo", "contact_email"])
    .flatMap((item) => text(item).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
    .map((email) => email.toLowerCase()));
}

function phonesFrom(value: unknown) {
  return unique(deepValuesForKeys(value, ["phone", "telephone", "telefono", "cellphone", "mobile", "celular", "whatsapp"])
    .flatMap((item) => text(item).match(/(?:\+?598\s?)?(?:0?9\d|2\d|4\d)[\s.-]?\d{3}[\s.-]?\d{3,4}/g) ?? [])
    .filter((phone) => phone.replace(/\D/g, "").length >= 7));
}

function urlFrom(value: unknown) {
  const candidate = text(value) || firstDeepText(value, ["url", "file_url", "download_url", "location", "path"]);
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith("/")) return `${AGLH_PROFILE_BASE}${candidate}`;
  return "";
}

function cvDocumentFromTalent(talent: JsonObject): CandidateDocumentImport | null {
  const cvValues = deepValuesForKeys(talent, [
    "cv", "cv_url", "cv_file", "cv_path", "talent_cv", "talent_cv_url", "curriculum", "curriculum_url", "curriculum_vitae",
    "resume", "resume_url", "document", "document_url"
  ]);
  for (const value of cvValues) {
    const fileUrl = urlFrom(value);
    const row = object(value);
    const fileName = text(row?.file_name ?? row?.filename ?? row?.name ?? row?.nombre)
      || (fileUrl ? decodeURIComponent(fileUrl.split("?")[0].split("/").pop() || "CV AGLH.pdf") : "");
    const rawText = firstDeepText(value, ["raw_text", "text", "content", "texto"]);
    if (!fileUrl && rawText.length < 80) continue;
    return {
      type: "cv",
      fileName: fileName || "CV AGLH",
      fileUrl: fileUrl || null,
      rawText: rawText || null,
      mimeType: text(row?.mime_type ?? row?.content_type) || null,
      sourceId: text(row?.id ?? row?._id) || firstDeepText(talent, ["user_id", "talent_id", "id", "_id"]),
      isPrimaryCv: true
    };
  }
  return null;
}

function validPersonName(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  return value.length >= 4 && value.length <= 100 && words.length >= 2 && words.length <= 7 && !/\d|@|curr[ií]cul|vacante|oferta|postulaci[oó]n/i.test(value);
}

export function aglhCandidateFromTalent(input: unknown): CandidateImport | null {
  const talent = object(input);
  if (!talent) return null;

  const firstName = firstDeepText(talent, ["first_name", "firstname", "nombre", "nombres"]);
  const lastName = firstDeepText(talent, ["last_name", "lastname", "apellido", "apellidos"]);
  const explicitFullName = firstDeepText(talent, ["full_name", "fullname", "nombre_completo"]);
  const fullName = explicitFullName || unique([firstName, lastName]).join(" ");
  const document = cvDocumentFromTalent(talent);
  if (!validPersonName(fullName) || !document) return null;

  const experienceAreas = textsFrom(talent, ["area", "job_area", "professional_area"]);
  const positions = textsFrom(talent, ["position", "position_name", "job_title", "cargo", "puesto"]);
  const knowledge = textsFrom(talent, ["knowledge", "knowledges", "expertise", "skills", "habilidades"]);
  const tools = textsFrom(talent, ["tools", "technological_tools", "technological_tool"]);
  const languages = textsFrom(talent, ["language", "languages", "idioma", "idiomas"]);
  const formations = textsFrom(talent, ["career", "degree", "formation", "academic_level", "study_area"]);
  const summaryParts = unique([
    positions.length ? `Experiencia/cargos: ${positions.slice(0, 5).join(", ")}.` : "",
    experienceAreas.length ? `Áreas: ${experienceAreas.slice(0, 5).join(", ")}.` : "",
    knowledge.length ? `Conocimientos: ${knowledge.slice(0, 8).join(", ")}.` : "",
    formations.length ? `Formación: ${formations.slice(0, 5).join(", ")}.` : "",
    languages.length ? `Idiomas: ${languages.slice(0, 5).join(", ")}.` : ""
  ]);
  const sourceId = firstDeepText(talent, ["user_id", "talent_id", "id", "_id"]);
  const profileUrl = sourceId ? `${AGLH_PROFILE_BASE}/talent/profile?user_id=${encodeURIComponent(sourceId)}` : null;

  return {
    fullName,
    firstName: firstName || null,
    lastName: lastName || null,
    email: emailsFrom(talent),
    phone: phonesFrom(talent),
    city: firstDeepText(talent, ["city", "ciudad", "district", "barrio"]) || null,
    country: firstDeepText(talent, ["country", "pais"]) || "Uruguay",
    linkedinUrl: firstDeepText(talent, ["linkedin", "linkedin_url"]) || null,
    currentRole: positions[0] || experienceAreas[0] || null,
    seniority: firstDeepText(talent, ["seniority", "experience_level"]) || null,
    tags: unique(["aglh", ...experienceAreas, ...positions, ...knowledge, ...tools, ...languages]).slice(0, 12),
    languages: languages.slice(0, 8).map((lang: string) => ({ lang })),
    summary: summaryParts.join(" ") || "Perfil registrado en AGLH con CV disponible.",
    qualityScore: 0,
    sourceId: sourceId ? `aglh:${sourceId}` : `aglh:${fullName.toLowerCase().replace(/\s+/g, "-")}`,
    sourceUrl: profileUrl,
    documents: [document],
    raw: talent
  };
}

function talentRows(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) return payload.filter((item): item is JsonObject => Boolean(object(item)));
  const root = object(payload);
  if (!root) return [];
  for (const key of ["talents", "data", "results", "items", "rows"]) {
    const value = root[key];
    if (Array.isArray(value)) return value.filter((item): item is JsonObject => Boolean(object(item)));
    const nested = object(value);
    if (nested) {
      const found = talentRows(nested);
      if (found.length) return found;
    }
  }
  return [];
}

function totalFromPayload(payload: unknown) {
  const root = object(payload);
  const data = object(root?.data) ?? root;
  const hits = object(data?.hits);
  const total = Number(hits?.totalDocs ?? data?.totalDocs ?? data?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

async function jsonRequest(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = text(object(payload)?.message ?? object(object(payload)?.error)?.message) || `HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export async function loginAglh(config: JsonObject) {
  const email = text(config.username ?? config.email ?? config.user).toLowerCase();
  const password = text(config.password);
  if (!email || !password) throw new Error("AGLH necesita usuario/email y contraseña.");
  const payload = await jsonRequest(`${AGLH_AUTH_API}/login`, {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const data = object(object(payload)?.data) ?? object(payload) ?? {};
  const token = text(data.token ?? data.access_token ?? data.accessToken);
  if (!token) throw new Error("AGLH inició sesión pero no devolvió un token utilizable.");
  return {
    token,
    refreshToken: text(data.refresh_token ?? data.refreshToken),
    userId: text(data.user_id ?? data.userId),
    role: text(data.role)
  };
}

async function attachAglhCvData(candidate: CandidateImport, token: string) {
  const document = candidate.documents?.[0];
  if (!document?.fileUrl || document.rawText || document.fileDataBase64) return;
  try {
    const response = await fetch(document.fileUrl, { headers: { Authorization: `bearer ${token}` } });
    if (!response.ok) return;
    const size = Number(response.headers.get("content-length") || 0);
    if (size > MAX_CV_BYTES) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_CV_BYTES) return;
    document.fileDataBase64 = buffer.toString("base64");
    document.sizeBytes = buffer.length;
    document.mimeType = response.headers.get("content-type") || document.mimeType || null;
  } catch {
    // The source URL remains available when AGLH does not allow a direct download.
  }
}

export async function syncAglh(config: JsonObject): Promise<AgentSyncResult> {
  let session;
  try {
    session = await loginAglh(config);
  } catch (error: any) {
    const rejected = Number(error?.status) === 401;
    const message = rejected
      ? "AGLH rechazó el usuario o la contraseña guardados. Abrí Configurar AGLH y guardá la clave actual de esa cuenta."
      : `AGLH no pudo iniciar sesión: ${text(error?.message) || "error desconocido"}`;
    return {
      rows: [],
      configUpdate: {
        sessionStatus: rejected ? "requires_credentials" : "error",
        sessionFailedAt: new Date().toISOString(),
        sessionLastError: message
      },
      message
    };
  }

  const startPage = Math.max(1, Number(config.aglhNextPage ?? 1) || 1);
  const maxPages = Math.min(100, Math.max(1, Number(config.maxPagesPerSync ?? DEFAULT_PAGES_PER_SYNC) || DEFAULT_PAGES_PER_SYNC));
  const pageConcurrency = Math.min(10, Math.max(1, Number(config.aglhPageConcurrency ?? DEFAULT_PAGE_CONCURRENCY) || DEFAULT_PAGE_CONCURRENCY));
  const cvDownloads = Math.min(30, Math.max(0, Number(config.aglhCvDownloadsPerSync ?? DEFAULT_CV_DOWNLOADS_PER_SYNC) || 0));
  const candidates = new Map<string, CandidateImport>();
  let total = 0;
  let pagesRead = 0;
  let nextPage = startPage;
  let lastPageSize = 0;

  try {
    const readPage = async (page: number) => {
      const payload = await jsonRequest(`${AGLH_TALENT_API}/getTalentsPaginated`, {
        method: "POST",
        headers: { Authorization: `bearer ${session.token}` },
        body: JSON.stringify({ page })
      });
      return { page, total: totalFromPayload(payload), rows: talentRows(payload) };
    };

    const first = await readPage(startPage);
    total = first.total || total;
    const pageSize = first.rows.length;
    const totalPages = total > 0 && pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const lastRequestedPage = totalPages > 0
      ? Math.min(startPage + maxPages - 1, totalPages)
      : startPage + maxPages - 1;
    const remainingPages = Array.from(
      { length: Math.max(0, lastRequestedPage - startPage) },
      (_, index) => startPage + index + 1
    );
    const pageResults = [first, ...await mapWithConcurrency(remainingPages, pageConcurrency, readPage)];

    for (const result of pageResults) {
      total = result.total || total;
      const rows = result.rows;
      lastPageSize = rows.length;
      pagesRead += 1;
      for (const row of rows) {
        const candidate = aglhCandidateFromTalent(row);
        if (!candidate) continue;
        candidates.set(candidate.sourceId || candidate.fullName, candidate);
      }
    }

    const reachedEnd = pageResults.some((result) => result.rows.length === 0)
      || (totalPages > 0 && lastRequestedPage >= totalPages);
    nextPage = reachedEnd ? 1 : lastRequestedPage + 1;
    if (cvDownloads > 0) {
      await mapWithConcurrency(
        [...candidates.values()].slice(0, cvDownloads),
        Math.min(4, cvDownloads),
        (candidate) => attachAglhCvData(candidate, session.token)
      );
    }
  } catch (error: any) {
    const message = `AGLH inició sesión pero no pudo leer talentos: ${text(error?.message) || "error desconocido"}`;
    return {
      rows: [],
      configUpdate: {
        sessionStatus: Number(error?.status) === 401 ? "requires_credentials" : "error",
        sessionFailedAt: new Date().toISOString(),
        sessionLastError: message
      },
      message
    };
  }

  const complete = nextPage === 1 || lastPageSize === 0;
  return {
    rows: [...candidates.values()],
    configUpdate: {
      aglhAccessToken: session.token,
      aglhRefreshToken: session.refreshToken || null,
      aglhUserId: session.userId || null,
      aglhRole: session.role || null,
      aglhNextPage: nextPage,
      aglhTotalAvailable: total,
      ...(complete ? { aglhBackfillCompleteAt: new Date().toISOString() } : {}),
      sessionStatus: "connected",
      sessionRefreshedAt: new Date().toISOString(),
      sessionLastError: null
    },
    message: `AGLH: sesión renovada, ${pagesRead} páginas revisadas, ${candidates.size} perfiles reales con CV detectados${total ? ` de ${total} talentos disponibles` : ""}.${complete ? " Recorrido completo." : ` La próxima sincronización continúa en la página ${nextPage}.`}`
  };
}
