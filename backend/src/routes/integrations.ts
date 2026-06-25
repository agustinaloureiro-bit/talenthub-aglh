import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";

export const integrationsRouter = Router();

const DEFAULT_INTEGRATIONS = [
  ["aglh", "AGLH Platform"],
  ["yoiners", "Yoiners"],
  ["buscojobs", "Buscojobs"],
  ["gmail", "Gmail"],
  ["drive", "Google Drive"],
  ["linkedin", "LinkedIn Recruiter"]
] as const;

type CandidateImport = {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string[];
  phone: string[];
  city?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  currentRole?: string | null;
  seniority?: string | null;
  years?: number | null;
  tags: string[];
  summary?: string | null;
  qualityScore: number;
  sourceId?: string | null;
  sourceUrl?: string | null;
  raw: Record<string, unknown>;
};

function maskConfig(config: Record<string, unknown> | null) {
  if (!config) return {};
  const masked = { ...config };
  for (const key of Object.keys(masked)) {
    if (/password|token|secret|cookie|session|key/i.test(key) && masked[key]) {
      masked[key] = "********";
    }
  }
  return masked;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function textOrNull(value: unknown) {
  const text = cleanText(value);
  return text ? text : null;
}

function firstText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = textOrNull(row[key]);
    if (direct) return direct;
    const found = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (found) {
      const value = textOrNull(row[found]);
      if (value) return value;
    }
  }
  return null;
}

function listFrom(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value)
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "a")
    .replace(/&eacute;/g, "e")
    .replace(/&iacute;/g, "i")
    .replace(/&oacute;/g, "o")
    .replace(/&uacute;/g, "u")
    .replace(/&ntilde;/g, "n")
    .replace(/&Aacute;/g, "A")
    .replace(/&Eacute;/g, "E")
    .replace(/&Iacute;/g, "I")
    .replace(/&Oacute;/g, "O")
    .replace(/&Uacute;/g, "U")
    .replace(/&Ntilde;/g, "N");
}

function htmlText(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(href: string, base = "https://www.buscojobs.com.uy") {
  try {
    return new URL(decodeHtml(href), base).toString();
  } catch {
    return null;
  }
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const separator = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(separator).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(separator).map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function cookieHeaderFromConfig(config: Record<string, unknown>) {
  const raw = cleanText(config.sessionCookies ?? config.cookies ?? config.cookie);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const pairs = parsed
        .map((cookie) => `${cleanText(cookie?.name)}=${cleanText(cookie?.value)}`)
        .filter((pair) => !pair.startsWith("="));
      return pairs.length ? pairs.join("; ") : null;
    }
  } catch {
    return raw.includes("=") ? raw : null;
  }

  return raw.includes("=") ? raw : null;
}

async function fetchBuscojobs(url: string, cookieHeader: string) {
  const response = await fetch(url, {
    headers: {
      cookie: cookieHeader,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Buscojobs respondio ${response.status} en ${url}`);
  if (/login|iniciar sesi[oó]n|acceder/i.test(text) && !/Mi Panel|Mis Ofertas|Postulantes|Candidatos/i.test(text)) {
    throw new Error("La sesion de Buscojobs no entro al panel. Exporta cookies nuevas desde Chrome y guardalas otra vez.");
  }
  return text;
}

function extractLinks(html: string, base = "https://www.buscojobs.com.uy") {
  const links: Array<{ url: string; text: string }> = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html))) {
    const url = absoluteUrl(match[1], base);
    const text = htmlText(match[2]);
    if (url) links.push({ url, text });
  }
  return links;
}

function extractOfferLinks(html: string) {
  return unique(extractLinks(html)
    .filter((link) => /\/app\/empresa\/oferta-\d+/i.test(link.url))
    .map((link) => link.url.split(/[?#]/)[0]));
}

function candidateListUrls(offerUrl: string, offerHtml: string) {
  const fromLinks = extractLinks(offerHtml, offerUrl)
    .filter((link) => /ver candidatos|candidato|postulante|curriculum|cv/i.test(`${link.text} ${link.url}`))
    .map((link) => link.url);
  const id = offerUrl.match(/oferta-(\d+)/)?.[1];
  const guessed = id ? [
    `https://www.buscojobs.com.uy/app/empresa/oferta-${id}/candidatos`,
    `https://www.buscojobs.com.uy/app/empresa/oferta-${id}/postulantes`,
    `https://www.buscojobs.com.uy/app/empresa/oferta-${id}/curriculums`
  ] : [];
  return unique([...fromLinks, ...guessed]);
}

function looksLikePersonName(value: string) {
  const text = value.trim();
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{5,80}$/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return !/panel|oferta|candidato|postulado|preseleccionado|finalista|leer|mover|descargar|buscar|adecuacion|perfil/i.test(text);
}

function extractCandidatesFromHtml(html: string, sourceUrl: string, offerTitle: string) {
  const candidates: CandidateImport[] = [];
  const seen = new Set<string>();
  const links = extractLinks(html, sourceUrl);

  for (const link of links) {
    if (!looksLikePersonName(link.text)) continue;
    const position = html.indexOf(link.text);
    const around = position >= 0 ? html.slice(Math.max(0, position - 500), position + 1500) : "";
    const context = htmlText(around);
    const email = unique(context.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []);
    const phone = unique(context.match(/(?:\+?598\s?)?(?:0?9\d|2\d)\s?\d{3}\s?\d{3}/g) ?? []);
    const ageText = context.match(/(\d{2})\s*a[nñ]os/i)?.[1];
    const city = context.match(/(?:Montevideo|Canelones|Maldonado|San Jose|Colonia|Florida|Rocha|Paysandu|Salto|Rivera|Tacuarembo|Durazno|Soriano|Lavalleja|Artigas|Cerro Largo|Flores|Rio Negro|Treinta y Tres)(?:,\s*[^,|]+)?/i)?.[0] ?? null;
    const scoreText = context.match(/Adecuaci[oó]n\s*(\d{1,3})%/i)?.[1];
    const key = `${link.text}|${link.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      fullName: link.text,
      email,
      phone,
      city,
      country: "Uruguay",
      currentRole: offerTitle || null,
      years: null,
      tags: unique(["buscojobs", offerTitle].filter(Boolean)),
      summary: ageText ? `${ageText} anos. ${context.slice(0, 300)}` : context.slice(0, 300),
      qualityScore: scoreText ? Math.max(0, Math.min(100, Number(scoreText))) : 0,
      sourceId: link.url,
      sourceUrl: link.url,
      raw: { sourceUrl, profileUrl: link.url, offerTitle, context }
    });
  }

  return candidates;
}

async function scrapeBuscojobs(config: Record<string, unknown>) {
  const cookieHeader = cookieHeaderFromConfig(config);
  if (!cookieHeader) {
    return { rows: [] as CandidateImport[], message: "Falta pegar la sesion/cookies exportadas de Buscojobs." };
  }

  const panelHtml = await fetchBuscojobs("https://www.buscojobs.com.uy/app/empresa/panel", cookieHeader);
  const offerUrls = extractOfferLinks(panelHtml).slice(0, Number(config.maxOffers ?? 80));
  const allCandidates: CandidateImport[] = [];
  const notes: string[] = [];

  for (const offerUrl of offerUrls) {
    try {
      const offerHtml = await fetchBuscojobs(offerUrl, cookieHeader);
      const offerTitle = htmlText(offerHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") || htmlText(offerHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const listUrls = candidateListUrls(offerUrl, offerHtml).slice(0, 4);
      let foundForOffer = 0;

      for (const listUrl of listUrls) {
        try {
          const listHtml = await fetchBuscojobs(listUrl, cookieHeader);
          const pageCandidates = extractCandidatesFromHtml(listHtml, listUrl, offerTitle);
          foundForOffer += pageCandidates.length;
          allCandidates.push(...pageCandidates);

          const paginationUrls = unique(extractLinks(listHtml, listUrl)
            .filter((link) => /pagina|page|p=\d+|offset|desde/i.test(link.url))
            .map((link) => link.url))
            .slice(0, Number(config.maxPagesPerOffer ?? 5));
          for (const pageUrl of paginationUrls) {
            const pageHtml = await fetchBuscojobs(pageUrl, cookieHeader);
            const extra = extractCandidatesFromHtml(pageHtml, pageUrl, offerTitle);
            foundForOffer += extra.length;
            allCandidates.push(...extra);
          }
        } catch {
          continue;
        }
      }

      notes.push(`${offerTitle || offerUrl}: ${foundForOffer}`);
    } catch {
      notes.push(`${offerUrl}: error`);
    }
  }

  const bySource = new Map<string, CandidateImport>();
  for (const candidate of allCandidates) bySource.set(candidate.sourceId ?? candidate.fullName, candidate);
  return {
    rows: [...bySource.values()],
    message: `Buscojobs: ${offerUrls.length} ofertas revisadas. ${notes.slice(0, 8).join(" | ")}`
  };
}

function rowsFromConfig(config: Record<string, unknown>) {
  const direct = config.records ?? config.candidates;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  const raw = cleanText(config.historicalData ?? config.rawData ?? config.exportData ?? config.sessionCookies);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
    if (Array.isArray(parsed?.candidates)) {
      return parsed.candidates.filter((item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
    if (Array.isArray(parsed?.records)) {
      return parsed.records.filter((item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
  } catch {
    return parseCsv(raw);
  }

  return [];
}

function normalizeCandidate(row: Record<string, unknown>, sourceType: string): CandidateImport | null {
  const fullName = firstText(row, ["fullName", "full_name", "name", "nombre", "candidate", "candidato"]);
  const firstName = firstText(row, ["firstName", "first_name", "nombre"]);
  const lastName = firstText(row, ["lastName", "last_name", "apellido"]);
  const email = unique(listFrom(row.email ?? row.emails ?? row.mail ?? row.correo));
  const phone = unique(listFrom(row.phone ?? row.phones ?? row.telefono ?? row.celular ?? row.mobile));
  const resolvedName = fullName ?? unique([firstName ?? "", lastName ?? ""]).join(" ").trim();

  if (!resolvedName && email.length === 0 && phone.length === 0) return null;

  const yearsText = firstText(row, ["years", "yearsExperience", "experiencia_anios", "anos", "anios"]);
  const years = yearsText && Number.isFinite(Number(yearsText)) ? Number(yearsText) : null;

  return {
    fullName: resolvedName || email[0] || phone[0],
    firstName,
    lastName,
    email,
    phone,
    city: firstText(row, ["city", "ciudad", "location", "ubicacion"]),
    country: firstText(row, ["country", "pais"]),
    linkedinUrl: firstText(row, ["linkedinUrl", "linkedin_url", "linkedin"]),
    currentRole: firstText(row, ["currentRole", "current_role", "role", "cargo", "puesto", "position"]),
    seniority: firstText(row, ["seniority", "seniorityLevel", "nivel"]),
    years,
    tags: unique(listFrom(row.tags ?? row.skills ?? row.habilidades ?? sourceType)),
    summary: firstText(row, ["summary", "resumen", "notes", "notas"]),
    qualityScore: 0,
    sourceId: firstText(row, ["id", "sourceId", "source_id", "candidateId", "candidate_id"]),
    sourceUrl: firstText(row, ["url", "sourceUrl", "source_url", "profileUrl", "profile_url"]),
    raw: row
  };
}

async function saveSource(candidateId: string, sourceType: string, candidate: CandidateImport) {
  const existing = await q<{ id: string }>(
    "SELECT id FROM candidate_sources WHERE candidate_id=$1 AND source_type=$2 AND coalesce(source_id,'')=coalesce($3,'') LIMIT 1",
    [candidateId, sourceType, candidate.sourceId]
  );

  if (existing.rows[0]) {
    await q(
      "UPDATE candidate_sources SET source_url=coalesce($1,source_url), source_data=$2::jsonb, last_synced_at=now(), is_active=true WHERE id=$3",
      [candidate.sourceUrl, JSON.stringify(candidate.raw), existing.rows[0].id]
    );
  } else {
    await q(
      "INSERT INTO candidate_sources (candidate_id, source_type, source_id, source_url, source_data) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [candidateId, sourceType, candidate.sourceId, candidate.sourceUrl, JSON.stringify(candidate.raw)]
    );
  }

  await q(
    "UPDATE candidates SET source_count=(SELECT count(*)::int FROM candidate_sources WHERE candidate_id=$1) WHERE id=$1",
    [candidateId]
  );
}

async function importCandidate(sourceType: string, candidate: CandidateImport) {
  let existingId: string | null = null;

  if (candidate.sourceId) {
    const bySource = await q<{ candidate_id: string }>(
      "SELECT candidate_id FROM candidate_sources WHERE source_type=$1 AND source_id=$2 LIMIT 1",
      [sourceType, candidate.sourceId]
    );
    existingId = bySource.rows[0]?.candidate_id ?? null;
  }

  if (!existingId && candidate.email.length > 0) {
    const byEmail = await q<{ id: string }>("SELECT id FROM candidates WHERE email && $1::text[] LIMIT 1", [candidate.email]);
    existingId = byEmail.rows[0]?.id ?? null;
  }

  if (!existingId && candidate.phone.length > 0) {
    const byPhone = await q<{ id: string }>("SELECT id FROM candidates WHERE phone && $1::text[] LIMIT 1", [candidate.phone]);
    existingId = byPhone.rows[0]?.id ?? null;
  }

  if (existingId) {
    await q(
      `UPDATE candidates SET
        full_name=coalesce($1, full_name),
        first_name=coalesce($2, first_name),
        last_name=coalesce($3, last_name),
        email=(SELECT array_agg(DISTINCT value) FROM unnest(email || $4::text[]) AS value),
        phone=(SELECT array_agg(DISTINCT value) FROM unnest(phone || $5::text[]) AS value),
        city=coalesce($6, city),
        country=coalesce($7, country),
        linkedin_url=coalesce($8, linkedin_url),
        "current_role"=coalesce($9, "current_role"),
        ai_seniority=coalesce($10, ai_seniority),
        ai_seniority_years=coalesce($11, ai_seniority_years),
        ai_tags=(SELECT array_agg(DISTINCT value) FROM unnest(ai_tags || $12::text[]) AS value),
        ai_summary=coalesce($13, ai_summary),
        updated_at=now(),
        last_seen_at=now()
       WHERE id=$14`,
      [candidate.fullName, candidate.firstName, candidate.lastName, candidate.email, candidate.phone, candidate.city,
        candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.seniority, candidate.years,
        candidate.tags, candidate.summary, existingId]
    );
    await saveSource(existingId, sourceType, candidate);
    return "updated";
  }

  const inserted = await q<{ id: string }>(
    `INSERT INTO candidates (full_name, first_name, last_name, email, phone, city, country, linkedin_url, "current_role",
      ai_seniority, ai_seniority_years, ai_tags, ai_summary, quality_score, status, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',now())
     RETURNING id`,
    [candidate.fullName, candidate.firstName, candidate.lastName, candidate.email, candidate.phone, candidate.city,
      candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.seniority, candidate.years,
      candidate.tags, candidate.summary, candidate.qualityScore]
  );
  await saveSource(inserted.rows[0].id, sourceType, candidate);
  return "new";
}

async function ensureDefaultIntegrations() {
  for (const [id, name] of DEFAULT_INTEGRATIONS) {
    await q("INSERT INTO integrations (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [id, name]);
  }
}

integrationsRouter.get("/", asyncHandler(async (_req, res) => {
  await ensureDefaultIntegrations();
  const [integrations, logs] = await Promise.all([
    q("SELECT * FROM integrations ORDER BY name"),
    q("SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20")
  ]);
  res.json({ data: integrations.rows.map((row) => ({ ...row, config: maskConfig(row.config) })), logs: logs.rows });
}));

integrationsRouter.patch("/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const body = z.object({
    status: z.enum(["not_configured", "connected", "warning", "error", "soon"]).optional(),
    config: z.record(z.any()).optional()
  }).parse(req.body);
  const { rows } = await q(
    `INSERT INTO integrations (id, name, status, config)
     VALUES ($3,$4,coalesce($1,'connected'),coalesce($2::jsonb,'{}'::jsonb))
     ON CONFLICT (id) DO UPDATE SET
       status=coalesce($1,integrations.status),
       config=integrations.config || coalesce($2::jsonb,'{}'::jsonb),
       updated_at=now()
     RETURNING *`,
    [body.status, body.config ? JSON.stringify(body.config) : null, req.params.id, DEFAULT_INTEGRATIONS.find(([id]) => id === req.params.id)?.[1] ?? req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Integracion no encontrada" });
  res.json({ data: { ...rows[0], config: maskConfig(rows[0].config) } });
}));

integrationsRouter.post("/:id/sync", requireRole("recruiter"), asyncHandler(async (req, res) => {
  const integrationId = String(req.params.id);
  const integration = await q("SELECT * FROM integrations WHERE id=$1", [integrationId]);
  if (!integration.rowCount) return res.status(404).json({ error: "Integracion no encontrada" });

  const started = Date.now();
  const config = integration.rows[0].config ?? {};
  const hasConfig = Object.values(config).some((value) => String(value ?? "").trim().length > 0);
  let scraperResult: Awaited<ReturnType<typeof scrapeBuscojobs>> | null = null;
  let scraperError: string | null = null;
  if (integrationId === "buscojobs") {
    try {
      scraperResult = await scrapeBuscojobs(config);
    } catch (error: any) {
      scraperError = error?.message ?? "Error desconocido leyendo Buscojobs.";
    }
  }
  const rowsToImport = scraperResult?.rows ?? rowsFromConfig(config);
  let status = integration.rows[0].status === "connected" && hasConfig ? "warning" : "error";
  let message = status === "warning"
    ? "Credenciales guardadas. Para traer historico ahora, pega un exportado JSON o CSV en Datos historicos y volve a sincronizar."
    : "La integracion necesita estado Conectado y al menos una credencial, sesion o exportado guardado.";
  let newRecords = 0;
  let updatedRecords = 0;
  let errors = 0;

  if (rowsToImport.length > 0) {
    for (const row of rowsToImport) {
      const candidate = normalizeCandidate(row, integrationId);
      if (!candidate) {
        errors += 1;
        continue;
      }
      const result = await importCandidate(integrationId, candidate);
      if (result === "new") newRecords += 1;
      if (result === "updated") updatedRecords += 1;
    }
    status = errors > 0 ? "warning" : "success";
    message = `Historico procesado: ${newRecords} nuevos, ${updatedRecords} actualizados, ${errors} omitidos.`;
  } else if (scraperResult) {
    message = scraperResult.message;
  } else if (scraperError) {
    status = "error";
    errors = 1;
    message = `Buscojobs no pudo sincronizar: ${scraperError}`;
  }

  const { rows } = await q(
    "INSERT INTO sync_logs (integration_id, source, finished_at, duration_ms, status, new_records, updated_records, errors, message) VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8) RETURNING *",
    [integrationId, integration.rows[0].name, Date.now() - started, status, newRecords, updatedRecords, errors, message]
  );
  await q(
    "UPDATE integrations SET last_sync_at=now(), total_imported=total_imported+$1, updated_at=now(), status=$2 WHERE id=$3",
    [newRecords, status === "error" ? "error" : "connected", integrationId]
  );
  res.status(201).json({ data: rows[0] });
}));
