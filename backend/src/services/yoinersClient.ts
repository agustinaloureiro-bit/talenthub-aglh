import type { AgentSyncResult, CandidateDocumentImport, CandidateImport } from "../agents/types.js";

const YOINERS_API_BASE = "https://yoiners-backend.herokuapp.com/api/v1/execute";
const YOINERS_WEB_BASE = "https://www.yoiners.com";
const YOINERS_BACKEND_BASE = "https://yoiners-backend.herokuapp.com";
const KNOWN_HEAD_IDS_LIMIT = 300;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function list(value: unknown) {
  return Array.isArray(value) ? unique(value.map(text)) : [];
}

function sessionValuesFromExport(value: unknown) {
  const result: Record<string, string> = {};
  const collect = (input: unknown, depth = 0) => {
    if (!input || depth > 5) return;
    if (Array.isArray(input)) {
      input.forEach((item) => collect(item, depth + 1));
      return;
    }
    const row = object(input);
    if (row) {
      const name = text(row.name ?? row.key);
      const storedValue = text(row.value);
      if (name && storedValue) result[name.toLowerCase()] = storedValue;
      Object.values(row).forEach((item) => collect(item, depth + 1));
      return;
    }
    const raw = text(input);
    if (!raw) return;
    try {
      collect(JSON.parse(raw), depth + 1);
      return;
    } catch {
      // Cookie-Editor can also export a regular Cookie header.
    }
    for (const part of raw.split(/[;\n]/)) {
      const separator = part.indexOf("=");
      if (separator < 1) continue;
      const name = part.slice(0, separator).trim().toLowerCase();
      const storedValue = part.slice(separator + 1).trim();
      if (name && storedValue) result[name] = storedValue;
    }
  };
  collect(value);
  return result;
}

export function yoinersSessionFromConfig(config: JsonObject) {
  const exported = {
    ...sessionValuesFromExport(config.sessionCookies ?? config.cookies ?? config.cookie),
    ...sessionValuesFromExport(config.browserStorageState)
  };
  return {
    token: text(config.yoinersAccessToken ?? config.accessToken ?? config.apiKey ?? config.token ?? exported.usertoken),
    refreshToken: text(config.yoinersRefreshToken ?? config.refreshToken ?? exported.refreshtoken),
    userId: text(config.yoinersUserId ?? config.userId ?? exported.userid),
    role: text(config.yoinersRole ?? config.role ?? exported.userrole).toUpperCase(),
    companyId: text(config.yoinersCompanyId ?? config.companyId ?? exported.usercompanyid)
  };
}

function deepValuesForKeys(value: unknown, keys: string[], depth = 0): unknown[] {
  if (!value || depth > 6) return [];
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
      const label = text(nested.name ?? nested.nombre ?? nested.label ?? nested.value ?? nested.title);
      if (label) return label;
    }
  }
  return "";
}

function textsFrom(value: unknown, keys: string[]) {
  return unique(deepValuesForKeys(value, keys).flatMap((item): string[] => {
    if (Array.isArray(item)) return item.flatMap((child): string[] => {
      const direct = text(child);
      if (direct) return [direct];
      const nested = object(child);
      return nested ? [text(nested.name ?? nested.nombre ?? nested.label ?? nested.value ?? nested.title)] : [];
    });
    const direct = text(item);
    if (direct) return [direct];
    const nested = object(item);
    return nested ? [text(nested.name ?? nested.nombre ?? nested.label ?? nested.value ?? nested.title)] : [];
  }));
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

function validPersonName(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  return value.length >= 4
    && value.length <= 100
    && words.length >= 2
    && words.length <= 7
    && !/\d|@|curr[ií]cul|vacante|oferta|postulaci[oó]n|talento/i.test(value);
}

function fileUrlFrom(value: unknown) {
  const direct = text(value);
  const nested = object(value);
  const candidate = direct || text(nested?.url ?? nested?.file_url ?? nested?.download_url ?? nested?.path ?? nested?.location);
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith("/")) return `${YOINERS_BACKEND_BASE}${candidate}`;
  if (/\.(?:pdf|docx?|rtf)(?:\?|$)/i.test(candidate)) return `${YOINERS_BACKEND_BASE}/${candidate.replace(/^\/+/, "")}`;
  return "";
}

function cvDocumentFromTalent(talent: JsonObject): CandidateDocumentImport | null {
  const values = deepValuesForKeys(talent, [
    "talent_cv", "talent_cv_url", "cv", "cv_url", "cv_file", "cv_path", "curriculum", "curriculum_url",
    "curriculum_vitae", "resume", "resume_url", "document", "document_url"
  ]);
  for (const value of values) {
    const row = object(value);
    const fileUrl = fileUrlFrom(value);
    const rawText = text(row?.raw_text ?? row?.text ?? row?.content ?? row?.texto);
    if (!fileUrl && rawText.length < 80) continue;
    const fromUrl = fileUrl ? decodeURIComponent(fileUrl.split("?")[0].split("/").pop() || "") : "";
    return {
      type: "cv",
      fileName: text(row?.file_name ?? row?.filename ?? row?.name ?? row?.nombre) || fromUrl || "CV Yoiners",
      fileUrl: fileUrl || null,
      rawText: rawText || null,
      mimeType: text(row?.mime_type ?? row?.content_type) || null,
      sourceId: text(row?.id ?? row?._id) || null,
      isPrimaryCv: true
    };
  }
  return null;
}

export function yoinersCandidateFromTalent(input: unknown): CandidateImport | null {
  const talent = object(input);
  if (!talent) return null;
  const firstName = firstDeepText(talent, ["first_name", "firstname", "nombre", "nombres"]);
  const lastName = firstDeepText(talent, ["last_name", "lastname", "apellido", "apellidos"]);
  const explicitFullName = firstDeepText(talent, ["full_name", "fullname", "nombre_completo"]);
  const fullName = explicitFullName || unique([firstName, lastName]).join(" ");
  const document = cvDocumentFromTalent(talent);
  if (!validPersonName(fullName) || !document) return null;

  const roles = textsFrom(talent, ["position", "position_name", "job_title", "current_role", "cargo", "puesto", "profession"]);
  const areas = textsFrom(talent, ["area", "job_area", "professional_area", "category", "sector"]);
  const skills = textsFrom(talent, ["skill", "skills", "knowledge", "knowledges", "expertise", "habilidades", "tools"]);
  const languages = textsFrom(talent, ["language", "languages", "idioma", "idiomas"]);
  const formations = textsFrom(talent, ["career", "degree", "formation", "education", "academic_level", "study_area"]);
  const summary = unique([
    roles.length ? `Experiencia/cargos: ${roles.slice(0, 5).join(", ")}.` : "",
    areas.length ? `Áreas: ${areas.slice(0, 5).join(", ")}.` : "",
    skills.length ? `Conocimientos: ${skills.slice(0, 8).join(", ")}.` : "",
    formations.length ? `Formación: ${formations.slice(0, 5).join(", ")}.` : "",
    languages.length ? `Idiomas: ${languages.slice(0, 5).join(", ")}.` : ""
  ]).join(" ") || "Perfil registrado en Yoiners con CV disponible.";
  const rawId = firstDeepText(talent, ["talent_id", "talentid", "user_id", "userid", "id", "_id"]);
  const sourceId = rawId ? `yoiners:${rawId}` : `yoiners:${fullName.toLowerCase().replace(/\s+/g, "-")}`;

  return {
    fullName,
    firstName: firstName || null,
    lastName: lastName || null,
    email: emailsFrom(talent),
    phone: phonesFrom(talent),
    city: firstDeepText(talent, ["city", "ciudad", "district", "barrio", "location"]) || null,
    country: firstDeepText(talent, ["country", "pais"]) || "Uruguay",
    linkedinUrl: firstDeepText(talent, ["linkedin", "linkedin_url"]) || null,
    currentRole: roles[0] || areas[0] || null,
    seniority: firstDeepText(talent, ["seniority", "experience_level"]) || null,
    tags: unique(["yoiners", ...roles, ...areas, ...skills, ...languages]).slice(0, 14),
    languages: languages.slice(0, 8).map((lang) => ({ lang })),
    summary,
    qualityScore: 0,
    sourceId,
    sourceUrl: rawId ? `${YOINERS_WEB_BASE}/yoiners/view-talent/cv/${encodeURIComponent(rawId)}` : null,
    documents: [document],
    raw: talent
  };
}

function candidateRows(payload: unknown): JsonObject[] {
  const rows: JsonObject[] = [];
  const visited = new Set<unknown>();
  const identities = new Set<string>();
  const immediateValues = (value: JsonObject, keys: string[]) => {
    const wanted = new Set(keys.map(normalizedKey));
    const containers = [value, object(value.user), object(value.talent), object(value.profile)].filter(Boolean) as JsonObject[];
    for (const container of containers) {
      for (const [key, child] of Object.entries(container)) {
        if (!wanted.has(normalizedKey(key))) continue;
        const direct = text(child);
        if (direct) return direct;
      }
    }
    return "";
  };
  const looksLikeTalent = (value: JsonObject) => {
    const firstName = immediateValues(value, ["first_name", "firstname", "nombre", "nombres"]);
    const lastName = immediateValues(value, ["last_name", "lastname", "apellido", "apellidos"]);
    const fullName = immediateValues(value, ["full_name", "fullname", "nombre_completo"]);
    const id = immediateValues(value, ["talent_id", "talentid", "user_id", "userid", "id", "_id"]);
    return Boolean(id && (fullName || (firstName && lastName)));
  };
  const collect = (value: unknown, depth = 0) => {
    if (!value || depth > 8 || visited.has(value)) return;
    if (typeof value === "object") visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, depth + 1));
      return;
    }
    const row = object(value);
    if (!row) return;
    if (looksLikeTalent(row)) {
      const id = immediateValues(row, ["talent_id", "talentid", "user_id", "userid", "id", "_id"]);
      if (!identities.has(id)) {
        identities.add(id);
        rows.push(row);
      }
      return;
    }
    Object.values(row).forEach((child) => collect(child, depth + 1));
  };
  collect(payload);
  return rows;
}

async function jsonRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${YOINERS_API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const root = object(payload);
    const message = text(root?.message ?? object(root?.error)?.message) || `HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function sessionFromPayload(payload: unknown) {
  const root = object(payload) ?? {};
  const data = object(root.data) ?? root;
  return {
    token: text(data.token ?? data.access_token ?? data.accessToken) || firstDeepText(data, ["token", "access_token", "accessToken"]),
    refreshToken: text(data.refresh_token ?? data.refreshToken) || firstDeepText(data, ["refresh_token", "refreshToken"]),
    userId: text(data.user_id ?? data.userId ?? object(data.user)?.id ?? object(data.user)?._id)
      || firstDeepText(data, ["user_id", "userId"]),
    role: (text(data.role ?? object(data.user)?.role) || firstDeepText(data, ["role", "user_role", "userRole"])).toUpperCase(),
    companyId: text(data.company_id ?? data.companyId ?? object(data.company)?.id ?? object(data.company)?._id)
      || firstDeepText(data, ["company_id", "companyId", "user_company_id", "userCompanyId"])
  };
}

async function loginYoiners(config: JsonObject) {
  const email = text(config.username ?? config.email ?? config.user).toLowerCase();
  const password = text(config.password);
  if (!email || !password) throw new Error("Yoiners necesita usuario/email y contraseña.");
  const payload = await jsonRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, gReCaptchaToken: text(config.gReCaptchaToken) })
  });
  const session = sessionFromPayload(payload);
  if (!session.token || !session.userId) throw new Error("Yoiners inició sesión pero no devolvió una sesión utilizable.");
  return session;
}

async function refreshYoiners(config: JsonObject) {
  const saved = yoinersSessionFromConfig(config);
  const refreshToken = saved.refreshToken;
  const userId = saved.userId;
  if (!refreshToken || !userId) return null;
  const payload = await jsonRequest("/auth/refreshToken", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken, user_id: userId })
  });
  const session = sessionFromPayload(payload);
  if (!session.token) return null;
  return {
    ...session,
    refreshToken: session.refreshToken || refreshToken,
    userId: session.userId || userId,
    role: session.role || saved.role,
    companyId: session.companyId || saved.companyId
  };
}

async function resolveSession(config: JsonObject) {
  const saved = yoinersSessionFromConfig(config);
  if (saved.token && saved.userId) return saved;
  try {
    const refreshed = await refreshYoiners(config);
    if (refreshed) return refreshed;
  } catch {
    // A saved refresh token can expire; credentials are the durable fallback.
  }
  return loginYoiners(config);
}

async function authorizedRequest(path: string, token: string, init: RequestInit = {}) {
  return jsonRequest(path, {
    ...init,
    headers: { Authorization: `bearer ${token}`, ...(init.headers ?? {}) }
  });
}

function updatedAt(candidate: CandidateImport) {
  return firstDeepText(candidate.raw, ["updated_at", "updatedat", "modified_at", "modifiedat", "created_at", "createdat", "date"]);
}

export function selectYoinersIncrementalCandidates(candidates: CandidateImport[], knownHeadIds: string[], lastSyncAt = "") {
  const known = new Set(knownHeadIds);
  const lastSync = Date.parse(lastSyncAt);
  const rows: CandidateImport[] = [];
  let overlapFound = false;
  for (const candidate of candidates) {
    const id = text(candidate.sourceId);
    if (id && known.has(id)) {
      overlapFound = true;
      break;
    }
    const changedAt = Date.parse(updatedAt(candidate));
    if (!Number.isFinite(lastSync) || !Number.isFinite(changedAt) || changedAt > lastSync) rows.push(candidate);
  }
  return {
    rows,
    overlapFound,
    headIds: unique([...candidates.map((candidate) => text(candidate.sourceId)), ...knownHeadIds]).slice(0, KNOWN_HEAD_IDS_LIMIT)
  };
}

function paginationFromPayload(payload: unknown) {
  const root = object(payload) ?? {};
  const data = object(root.data) ?? root;
  const hits = object(data.hits) ?? object(root.hits) ?? {};
  const rawTotalPages = hits.totalPages ?? hits.total_pages ?? data.totalPages ?? data.total_pages ?? root.totalPages;
  return {
    page: Number(hits.page ?? data.page ?? root.page ?? 1),
    totalPages: rawTotalPages == null ? null : Number(rawTotalPages)
  };
}

type ResolvedSession = Awaited<ReturnType<typeof resolveSession>>;

async function fetchFilteredTalents(
  session: ResolvedSession,
  path: string,
  accountRole: string
) {
  const payloads: unknown[] = [];
  const seenPages = new Set<string>();
  const maxPages = 500;
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await authorizedRequest(path, session.token, {
      method: "POST",
      body: JSON.stringify({
        role: accountRole,
        company_id: session.companyId || undefined,
        yoiner_user_id: session.userId,
        prefetch: true,
        page,
        pageMine: page,
        pageTalents: page,
        pageOthers: page,
        pageFree: page,
        limit: 100
      })
    });
    const rows = candidateRows(payload);
    if (!rows.length) break;
    const fingerprint = rows
      .map((row) => firstDeepText(row, ["talent_id", "talentid", "user_id", "userid", "id", "_id"]))
      .filter(Boolean)
      .sort()
      .join("|");
    if (fingerprint && seenPages.has(fingerprint)) break;
    if (fingerprint) seenPages.add(fingerprint);
    payloads.push(payload);
    const pagination = paginationFromPayload(payload);
    if (pagination.totalPages != null && page >= pagination.totalPages) break;
  }
  return payloads;
}

async function fetchTalentPayloads(session: Awaited<ReturnType<typeof resolveSession>>) {
  const payloads: unknown[] = [];
  const failures: string[] = [];
  let authorizationFailures = 0;

  const role = session.role.toUpperCase();
  const companyAccount = role === "COMPANY" || role === "COMPANY_TEAM" || Boolean(session.companyId);
  const companyTarget = session.companyId || session.userId;
  const filteredViews = companyAccount
    ? [
        { label: "talentos de empresa", path: `/company/getTalentsByFiltersCompany/${encodeURIComponent(companyTarget)}`, role: role || "COMPANY" },
        { label: "talentos de yoiner", path: `/yoiner/getTalentsByFilters/${encodeURIComponent(session.userId)}`, role: "YOINER" }
      ]
    : [
        { label: "talentos de yoiner", path: `/yoiner/getTalentsByFilters/${encodeURIComponent(session.userId)}`, role: role || "YOINER" },
        { label: "talentos de empresa", path: `/company/getTalentsByFiltersCompany/${encodeURIComponent(companyTarget)}`, role: "COMPANY" }
      ];

  // Some older sessions do not contain the account role. An empty successful
  // response is therefore not conclusive: try the other official account view.
  for (const view of filteredViews) {
    try {
      const viewPayloads = await fetchFilteredTalents(session, view.path, view.role);
      if (viewPayloads.length) payloads.push(...viewPayloads);
    } catch (error: any) {
      if (Number(error?.status) === 401 || Number(error?.status) === 403) authorizationFailures += 1;
      failures.push(`${view.label}: ${text(error?.message) || "error"}`);
    }
  }

  if (!payloads.length) {
    try {
      const legacy = await authorizedRequest(`/yoiner/getTalents/${encodeURIComponent(session.userId)}/false`, session.token);
      if (candidateRows(legacy).length) payloads.push(legacy);
    } catch (error: any) {
      if (Number(error?.status) === 401 || Number(error?.status) === 403) authorizationFailures += 1;
      failures.push(`talentos anteriores: ${text(error?.message) || "error"}`);
    }
  }

  try {
    const sharedPath = companyAccount
      ? `/company/getSharedTalents/${encodeURIComponent(companyTarget)}`
      : `/yoiner/getYoinerSharedTalents/${encodeURIComponent(session.userId)}`;
    const shared = await authorizedRequest(sharedPath, session.token, companyAccount ? { method: "POST" } : {});
    if (candidateRows(shared).length) payloads.push(shared);
  } catch (error: any) {
    failures.push(`talentos compartidos: ${text(error?.message) || "error"}`);
  }

  if (!payloads.length) {
    const error = new Error(failures.join(" | ") || "Yoiners no devolvió talentos.") as Error & { status?: number };
    if (authorizationFailures >= 2) error.status = 401;
    throw error;
  }
  return { payloads, failures };
}

export async function syncYoiners(config: JsonObject): Promise<AgentSyncResult> {
  let session;
  try {
    session = await resolveSession(config);
  } catch (error: any) {
    const detail = text(error?.message) || "error desconocido";
    const captcha = /captcha|recaptcha/i.test(detail);
    const rejected = Number(error?.status) === 401 || Number(error?.status) === 403;
    const message = captcha
      ? "Yoiners exige validar el inicio de sesión en su sitio. Completá el CAPTCHA una sola vez en Yoiners y guardá la sesión exportada en Configurar Yoiners; luego TalentHub la renueva automáticamente."
      : rejected
        ? "Yoiners rechazó el usuario o la contraseña guardados. Abrí Configurar Yoiners y guardá la clave actual."
        : `Yoiners no pudo iniciar sesión: ${detail}`;
    return {
      rows: [],
      configUpdate: {
        sessionStatus: captcha ? "requires_manual_validation" : rejected ? "requires_credentials" : "error",
        sessionFailedAt: new Date().toISOString(),
        sessionLastError: message
      },
      message
    };
  }

  try {
    let result;
    try {
      result = await fetchTalentPayloads(session);
    } catch (error: any) {
      if (Number(error?.status) !== 401) throw error;
      session = await refreshYoiners({
        ...config,
        yoinersRefreshToken: session.refreshToken,
        yoinersUserId: session.userId
      }) ?? await loginYoiners(config);
      result = await fetchTalentPayloads(session);
    }
    const byId = new Map<string, CandidateImport>();
    let sourceRows = 0;
    for (const payload of result.payloads) {
      const rows = candidateRows(payload);
      sourceRows += rows.length;
      for (const row of rows) {
        const candidate = yoinersCandidateFromTalent(row);
        if (candidate) byId.set(candidate.sourceId || candidate.fullName, candidate);
      }
    }
    const candidates = [...byId.values()];
    const previousHeads = list(config.yoinersHeadSourceIds);
    const incremental = selectYoinersIncrementalCandidates(candidates, previousHeads, text(config.yoinersLastSyncAt));
    const firstSync = !text(config.yoinersLastSyncAt) && previousHeads.length === 0;
    const rows = firstSync ? candidates : incremental.rows;
    const now = new Date().toISOString();
    return {
      rows,
      configUpdate: {
        yoinersAccessToken: session.token,
        yoinersRefreshToken: session.refreshToken || null,
        yoinersUserId: session.userId,
        yoinersRole: session.role || null,
        yoinersCompanyId: session.companyId || null,
        yoinersHeadSourceIds: incremental.headIds,
        yoinersLastSyncAt: now,
        yoinersTotalVisible: sourceRows,
        sessionStatus: "connected",
        sessionRefreshedAt: now,
        sessionLastError: null
      },
      message: `Yoiners: sesión renovada, ${sourceRows} perfiles visibles revisados, ${candidates.length} perfiles reales con CV detectados, ${rows.length} perfiles nuevos o actualizados para importar.${result.failures.length ? ` Algunas vistas no estuvieron disponibles: ${result.failures.join(" | ")}` : ""}`
    };
  } catch (error: any) {
    const message = `Yoiners inició sesión pero no pudo leer los talentos de la cuenta: ${text(error?.message) || "error desconocido"}`;
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
}
