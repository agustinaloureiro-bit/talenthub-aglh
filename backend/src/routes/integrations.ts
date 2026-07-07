import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";
import type { AgentSyncResult, CandidateImport, IntegrationAgent } from "../agents/types.js";

export const integrationsRouter = Router();

const DEFAULT_INTEGRATIONS = [
  ["aglh", "AGLH Platform"],
  ["yoiners", "Yoiners"],
  ["buscojobs", "Buscojobs"],
  ["gmail", "Gmail"],
  ["drive", "Google Drive"],
  ["linkedin", "LinkedIn Recruiter"]
] as const;

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

function deepFirstText(value: unknown, keys: string[], depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const row = value as Record<string, unknown>;
  const direct = firstText(row, keys);
  if (direct) return direct;
  for (const child of Object.values(row)) {
    const found = deepFirstText(child, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function firstMatchingKeyText(value: unknown, patterns: RegExp[], depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const row = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(row)) {
    const normalized = key.toLowerCase();
    if (patterns.some((pattern) => pattern.test(normalized))) {
      const text = textOrNull(child);
      if (text) return text;
    }
  }
  for (const child of Object.values(row)) {
    const found = firstMatchingKeyText(child, patterns, depth + 1);
    if (found) return found;
  }
  return null;
}

function hasMatchingKey(value: unknown, patterns: RegExp[], depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 4) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => patterns.some((pattern) => pattern.test(key.toLowerCase())))) return true;
  return Object.values(row).some((child) => hasMatchingKey(child, patterns, depth + 1));
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

function absoluteUrl(href: string, base = "https://buscojobs.com.uy") {
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
  const parseLine = (line: string) => {
    const values: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === "\"" && quoted && next === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = !quoted;
      } else if (char === separator && !quoted) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function cookieHeaderFromConfig(config: Record<string, unknown>) {
  const raw = cleanText(config.sessionCookies ?? config.cookies ?? config.cookie);
  if (!raw) return null;

  const curlCookie = raw.match(/\s-b\s+\^?"([^"]+)"/i)?.[1] ?? raw.match(/\s-b\s+'([^']+)'/i)?.[1];
  if (curlCookie) return curlCookie.replace(/\^/g, "");

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

function authFromConfig(config: Record<string, unknown>) {
  const raw = cleanText(config.sessionCookies ?? config.cookies ?? config.cookie ?? config.apiKey);
  const authorization = raw.match(/authorization:\s*Bearer\s+([^^"\s]+)/i)?.[1]
    ?? raw.match(/-H\s+\^?"authorization:\s*Bearer\s+([^^"\s]+)/i)?.[1]
    ?? raw.match(/Bearer\s+([A-Za-z0-9._-]+)/)?.[1]
    ?? cleanText(config.apiKey).replace(/^Bearer\s+/i, "");
  const sessionId = raw.match(/sessionid:\s*([^^"\s]+)/i)?.[1]
    ?? raw.match(/ASP\.NET_SessionId=([^;"]+)/i)?.[1];
  const empresaId = raw.match(/\/empresas\/(\d+)\//i)?.[1]
    ?? raw.match(/"empresaId":(\d+)/i)?.[1]
    ?? "119341";

  return {
    authorization: authorization || null,
    sessionId: sessionId?.replace(/\^/g, "") || null,
    empresaId
  };
}

function apiUrlFromCurl(config: Record<string, unknown>) {
  const raw = cleanText(config.sessionCookies ?? config.cookies ?? config.cookie);
  return raw.match(/curl\s+\^?"([^"]*api\.buscojobs\.com[^"]+)"/i)?.[1]?.replace(/\^/g, "") ?? null;
}

async function fetchBuscojobsJson(url: string, config: Record<string, unknown>) {
  const auth = authFromConfig(config);
  if (!auth.authorization) throw new Error("Falta authorization Bearer de Buscojobs. Copia una llamada Fetch/XHR como cURL.");

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "es",
      authorization: `Bearer ${auth.authorization}`,
      origin: "https://www.buscojobs.com.uy",
      referer: "https://www.buscojobs.com.uy/",
      "sessionid": auth.sessionId ?? "",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36",
      "x-timezone-offset": "180"
    }
  });
  const text = await response.text();
  if (response.status === 304) {
    throw new Error("Buscojobs devolvio cache 304. Copia otra vez la llamada como cURL con Disable cache activado.");
  }
  if (response.status === 401 && /JWTExpired|INVALID_TOKEN|claim timestamp check failed/i.test(text)) {
    throw new Error("La sesion/API de Buscojobs vencio. Entra otra vez a Buscojobs, copia una llamada Fetch/XHR nueva como cURL y guardala en Configurar.");
  }
  if (!response.ok) throw new Error(`Buscojobs API respondio ${response.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Buscojobs no devolvio JSON: ${text.slice(0, 160)}`);
  }
}

async function tryFetchBuscojobsJson(url: string, config: Record<string, unknown>) {
  try {
    return await fetchBuscojobsJson(url, config);
  } catch (error: any) {
    if (/respondio 40[034]/i.test(error?.message ?? "")) return null;
    if (/respondio 404/i.test(error?.message ?? "")) return null;
    return null;
  }
}

function arrayFromPayload(payload: any): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item) => typeof item === "object" && item !== null);
  for (const key of ["data", "rows", "items", "results", "postulaciones", "postulantes", "candidatos", "curriculums"]) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value.filter((item) => typeof item === "object" && item !== null);
  }
  if (typeof payload === "object" && payload !== null) {
    const nested = Object.values(payload).find((value) => Array.isArray(value)) as unknown[] | undefined;
    if (nested) return nested.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }
  return [];
}

function collectCandidateLikeRows(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!value || depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCandidateLikeRows(item, depth + 1));
  }
  if (typeof value !== "object") return [];

  const row = value as Record<string, unknown>;
  const nested = Object.values(row).flatMap((item) => collectCandidateLikeRows(item, depth + 1));
  const isCandidateLike = hasMatchingKey(row, [
    /postulante/,
    /candidato/,
    /curriculum|curriculo|\bcv\b/,
    /persona/,
    /^email$|^mail$|correo/,
    /telefono|celular|mobile|phone/,
    /linkedin/,
    /fecha.*postul/
  ]);
  return isCandidateLike ? [row, ...nested] : nested;
}

function extractEmails(value: unknown) {
  return unique([
    ...listFrom(value),
    ...(cleanText(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
  ]);
}

function extractPhones(value: unknown) {
  return unique([
    ...listFrom(value),
    ...(cleanText(value).match(/(?:\+?\d{1,3}\s?)?(?:0?9\d|2\d|4\d|[1-9]\d{1,3})[\s.-]?\d{3}[\s.-]?\d{3,4}/g) ?? [])
  ]);
}

function offerIdFromRow(row: Record<string, unknown>) {
  return deepFirstText(row, ["Id", "id", "OfertaId", "ofertaId", "OfertaID", "ofertaID", "IdOferta", "idOferta", "Codigo", "codigo"])
    ?? firstMatchingKeyText(row, [/^id$/, /oferta.*id/, /id.*oferta/, /codigo/]);
}

function offerTitleFromRow(row: Record<string, unknown>) {
  return deepFirstText(row, ["Titulo", "titulo", "Nombre", "nombre", "Cargo", "cargo", "Puesto", "puesto", "Descripcion", "descripcion"])
    ?? firstMatchingKeyText(row, [/titulo/, /nombre/, /cargo/, /puesto/])
    ?? "Oferta Buscojobs";
}

function candidateDocumentsFromRow(row: Record<string, unknown>, sourceType: string) {
  const cvUrl = deepFirstText(row, ["CVUrl", "cvUrl", "CurriculumUrl", "curriculumUrl", "UrlCv", "urlCv", "ArchivoUrl", "archivoUrl", "FileUrl", "fileUrl", "DownloadUrl", "downloadUrl", "DocumentoUrl", "documentoUrl", "CV", "cv", "Curriculum", "curriculum"]);
  const profileUrl = deepFirstText(row, ["PerfilUrl", "perfilUrl", "ProfileUrl", "profileUrl", "Url", "url"]);
  const cvText = deepFirstText(row, ["CvTexto", "cvTexto", "TextoCV", "textoCV", "RawText", "rawText", "ResumenCV", "resumenCV", "CVTexto", "cv_texto", "CurriculumTexto", "Experiencia", "experiencia", "Formacion", "formacion", "Educacion", "educacion"]);
  const fileName = deepFirstText(row, ["FileName", "fileName", "NombreArchivo", "nombreArchivo", "CvNombre", "cvNombre"]);
  const documents = [];

  const looksLikeUrl = cvUrl && /^https?:\/\//i.test(cvUrl);
  const inlineCvText = cvText ?? (cvUrl && !looksLikeUrl && cvUrl.length > 80 ? cvUrl : null);

  if (looksLikeUrl || inlineCvText) {
    documents.push({
      type: "cv",
      fileName: fileName || "CV importado",
      fileUrl: looksLikeUrl ? cvUrl : null,
      rawText: inlineCvText,
      sourceId: deepFirstText(row, ["CurriculumId", "curriculumId", "CvId", "cvId", "Id", "id"]),
      isPrimaryCv: true
    });
  }

  if (profileUrl && profileUrl !== cvUrl) {
    documents.push({
      type: "profile",
      fileName: `${sourceType} ficha`,
      fileUrl: profileUrl,
      sourceId: deepFirstText(row, ["PostulanteId", "postulanteId", "CandidatoId", "candidatoId", "Id", "id"]),
      isPrimaryCv: false
    });
  }

  return documents;
}

function looksLikeOfferText(value: unknown) {
  return /buscamos|estamos buscando|importante empresa|requisitos|principales tareas|tareas:|jornada|carnet|perfil psicografico|postulantes|candidatos|oferta|\[object Object\]/i.test(cleanText(value));
}

function candidateNameLooksReal(name: string) {
  const cleaned = name.replace(/\s+/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!cleaned || cleaned.length < 5 || cleaned.length > 90) return false;
  if (words.length < 2 || words.length > 6) return false;
  if (/[/{}<>]|\[object Object\]/i.test(cleaned)) return false;
  if (looksLikeOfferText(cleaned)) return false;
  if (/^(autodromo|barra de carrasco|ciudad de la costa|comercial|comercial mercadeo|el pinar|fray bentos|jose pedro varela|libertad|lomas de solymar|malvin|melo|montevideo|neptunia|playa pascual|rivera|salinas|salto|solymar|suarez|toledo|treinta y tres|administracion de empresas|asistencia social|diseno grafico)$/i.test(cleaned)) return false;
  return true;
}

function compactLabel(value: unknown, fallback = "") {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (!text || looksLikeOfferText(text) || text.length > 70) return fallback;
  return text;
}

function safeTags(items: unknown[], sourceType: string) {
  return unique([sourceType, ...items.map((item) => compactLabel(item)).filter(Boolean)]).slice(0, 6);
}

function candidateSummaryLooksLikeOffer(candidate: CandidateImport) {
  return looksLikeOfferText(`${candidate.fullName} ${candidate.currentRole ?? ""} ${candidate.summary ?? ""}`);
}

function isUsableCandidate(candidate: CandidateImport, sourceType = "") {
  const hasContact = candidate.email.length > 0 || candidate.phone.length > 0 || Boolean(candidate.linkedinUrl);
  const hasDocument = (candidate.documents ?? []).some((document) => Boolean(document.fileUrl || document.rawText));
  const hasRealName = candidateNameLooksReal(candidate.fullName);

  if (sourceType === "buscojobs") {
    if (!hasRealName) return false;
    if (candidateSummaryLooksLikeOffer(candidate) && !hasContact && !hasDocument) return false;
    return true;
  }

  if (hasContact) return true;
  if (!hasRealName) return false;
  if (candidateSummaryLooksLikeOffer(candidate)) return false;
  return true;
}
function isAgentCandidate(row: unknown): row is CandidateImport {
  const candidate = row as CandidateImport;
  return Boolean(candidate && typeof candidate === "object" && typeof candidate.fullName === "string" && Array.isArray(candidate.email) && Array.isArray(candidate.phone) && Array.isArray(candidate.tags));
}
function applicantFromRow(row: Record<string, unknown>, offer: Record<string, unknown>): CandidateImport | null {
  const personContainer = row.Postulante ?? row.postulante ?? row.Candidato ?? row.candidato ?? row.Curriculum ?? row.curriculum ?? row.Persona ?? row.persona;
  const rowLooksApplicant = hasMatchingKey(row, [
    /postulante/,
    /candidato(nombre|id|apellido|email|telefono|celular)/,
    /curriculum|curriculo/,
    /\bcv(url|id|texto|nombre)?\b/,
    /persona/,
    /^email$|^mail$|correo/,
    /telefono|celular|mobile|phone/,
    /fecha.*postul/,
    /adecuacion/
  ]);
  if (!personContainer && !rowLooksApplicant) return null;

  const person = (personContainer ?? row) as Record<string, unknown>;
  const fullNameKeys = personContainer
    ? ["NombreCompleto", "nombreCompleto", "FullName", "fullName", "PostulanteNombre", "postulanteNombre", "CandidatoNombre", "candidatoNombre", "Nombre", "nombre"]
    : ["NombreCompleto", "nombreCompleto", "FullName", "fullName", "PostulanteNombre", "postulanteNombre", "CandidatoNombre", "candidatoNombre"];
  const firstName = deepFirstText(person, ["PrimerNombre", "Nombres", "NombrePila", "firstName", "FirstName"]);
  const lastName = deepFirstText(person, ["Apellido", "Apellidos", "lastName", "LastName"]);
  const fullName = deepFirstText(person, fullNameKeys)
    ?? unique([firstName, lastName].filter(Boolean) as string[]).join(" ")
    ?? firstMatchingKeyText(person, [/nombre.*completo/, /full.*name/, /postulante.*nombre/, /candidat.*nombre/]);
  const email = unique(listFrom(deepFirstText(person, ["Email", "email", "Mail", "mail", "Correo", "correo"]) ?? deepFirstText(row, ["Email", "email", "Mail", "mail", "Correo", "correo"])));
  const phone = unique(listFrom(deepFirstText(person, ["Telefono", "telefono", "Celular", "celular", "Mobile", "mobile", "Phone", "phone"]) ?? deepFirstText(row, ["Telefono", "telefono", "Celular", "celular", "Mobile", "mobile", "Phone", "phone"])));
  const sourceId = deepFirstText(row, ["PostulacionId", "postulacionId", "PostulanteId", "postulanteId", "CandidatoId", "candidatoId", "CurriculumId", "curriculumId"])
    ?? firstMatchingKeyText(row, [/postul.*id/, /candidat.*id/, /curriculum.*id/])
    ?? deepFirstText(person, ["Id", "id"]);

  const cleanedName = fullName?.replace(/\s+/g, " ").trim() ?? "";
  const offerTitle = offerTitleFromRow(offer);
  if (cleanedName && compactLabel(cleanedName) === compactLabel(offerTitle)) return null;
  if (!candidateNameLooksReal(cleanedName) && email.length === 0 && phone.length === 0) return null;

  const scoreText = deepFirstText(row, ["Adecuacion", "adecuacion", "Score", "score", "Puntaje", "puntaje"]);
  const qualityScore = scoreText && Number.isFinite(Number(scoreText)) ? Math.max(0, Math.min(100, Number(scoreText))) : 0;
  const sourceUrl = deepFirstText(row, ["PerfilUrl", "perfilUrl", "ProfileUrl", "profileUrl", "Url", "url", "CVUrl", "cvUrl"]);
  const documents = candidateDocumentsFromRow(row, "buscojobs");
  const city = deepFirstText(person, ["Ciudad", "ciudad", "Localidad", "localidad", "Ubicacion", "ubicacion"]) ?? deepFirstText(row, ["Ciudad", "ciudad"]);
  const summaryParts = [
    offerTitle ? `Postulante a ${offerTitle}` : null,
    city ? `Ubicacion: ${city}` : null,
    documents.find((document) => document.rawText)?.rawText?.slice(0, 700) ?? null
  ].filter(Boolean);

  const candidate: CandidateImport = {
    fullName: candidateNameLooksReal(cleanedName) ? cleanedName : (email[0] || phone[0]),
    firstName,
    lastName,
    email,
    phone,
    city,
    country: "Uruguay",
    linkedinUrl: deepFirstText(person, ["Linkedin", "linkedin", "LinkedInUrl", "linkedinUrl"]),
    currentRole: compactLabel(offerTitle, "Postulante Buscojobs"),
    seniority: null,
    years: null,
    tags: safeTags([offerTitle], "buscojobs"),
    summary: summaryParts.join(". ") || null,
    qualityScore,
    sourceId: sourceId ? `buscojobs:${sourceId}` : `buscojobs:${offerIdFromRow(offer)}:${cleanedName || email[0] || phone[0]}`,
    sourceUrl,
    documents,
    raw: { offer, applicant: row }
  };

  return isUsableCandidate(candidate, "buscojobs") ? candidate : null;
}
function applicantEndpointUrls(empresaId: string, offerId: string, limit: number, skip: number) {
  const filter = encodeURIComponent(JSON.stringify({ order: ["FechaPostulacion DESC"], limit, skip }));
  const whereFilter = encodeURIComponent(JSON.stringify({ where: { OfertaId: Number(offerId) }, order: ["FechaPostulacion DESC"], limit, skip }));
  return [
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas/${offerId}/Postulaciones?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas/${offerId}/Postulantes?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas/${offerId}/Candidatos?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas/${offerId}/Curriculums?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/ofertas/${offerId}/Postulaciones?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/ofertas/${offerId}/Postulantes?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/PostulacionOfertaTodas?filter=${whereFilter}`,
    `https://api.buscojobs.com/v3/uy/api/PostulacionesOfertaTodas?filter=${whereFilter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/PostulacionOfertaTodas?filter=${whereFilter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/PostulacionesOfertaTodas?filter=${whereFilter}`
  ];
}

async function fetchApplicantsForOffer(config: Record<string, unknown>, offer: Record<string, unknown>) {
  const auth = authFromConfig(config);
  const offerId = offerIdFromRow(offer);
  if (!offerId) return { rows: [] as CandidateImport[], route: `sin-id ${JSON.stringify(offer).slice(0, 180)}` };

  const maxPages = Number(config.maxPagesPerOffer ?? 20);
  const limit = Number(config.pageSize ?? 50);
  const collected: CandidateImport[] = [];
  let workingRoute = "";

  for (let page = 0; page < maxPages; page += 1) {
    const skip = page * limit;
    const urls = applicantEndpointUrls(auth.empresaId, offerId, limit, skip);
    let pageRows: Record<string, unknown>[] = [];

    for (const url of urls) {
      const payload = await tryFetchBuscojobsJson(url, config);
      const rows = payload ? arrayFromPayload(payload) : [];
      if (rows.length > 0) {
        pageRows = rows;
        workingRoute = url.replace(/\?.*$/, "");
        break;
      }
    }

    if (pageRows.length === 0) break;
    for (const row of pageRows) {
      const candidate = applicantFromRow(row, offer);
      if (candidate) collected.push(candidate);
    }
    if (pageRows.length < limit) break;
  }

  return { rows: collected, route: workingRoute || "sin-ruta" };
}

function candidatesFromBuscojobsPayload(payload: unknown, offer: Record<string, unknown> = {}) {
  const directRows = arrayFromPayload(payload);
  const nestedRows = collectCandidateLikeRows(payload);
  const candidates: CandidateImport[] = [];
  const seenRows = new Set<Record<string, unknown>>();

  for (const row of [...directRows, ...nestedRows]) {
    if (seenRows.has(row)) continue;
    seenRows.add(row);
    const candidate = applicantFromRow(row, offer) ?? normalizeCandidate(row, "buscojobs");
    if (candidate && isUsableCandidate(candidate, "buscojobs")) candidates.push(candidate);
  }

  const bySource = new Map<string, CandidateImport>();
  for (const candidate of candidates) bySource.set(candidate.sourceId ?? `${candidate.fullName}:${candidate.email[0] ?? ""}:${candidate.phone[0] ?? ""}`, candidate);
  return [...bySource.values()];
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
  if (!response.ok && response.status !== 404) throw new Error(`Buscojobs respondio ${response.status} en ${url}`);
  if (/login|iniciar sesi[oó]n|acceder/i.test(text) && !/Mi Panel|Mis Ofertas|Postulantes|Candidatos/i.test(text)) {
    throw new Error("La sesion de Buscojobs no entro al panel. Exporta cookies nuevas desde Chrome y guardalas otra vez.");
  }
  return text;
}

function extractLinks(html: string, base = "https://buscojobs.com.uy") {
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
    `https://buscojobs.com.uy/app/empresa/oferta-${id}/candidatos`,
    `https://buscojobs.com.uy/app/empresa/oferta-${id}/postulantes`,
    `https://buscojobs.com.uy/app/empresa/oferta-${id}/curriculums`
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
  const auth = authFromConfig(config);
  const apiUrl = apiUrlFromCurl(config);
  if (auth.authorization) {
    const baseUrl = apiUrl ?? `https://api.buscojobs.com/v3/uy/api/empresas/${auth.empresaId}/OfertasActivas?filter=${encodeURIComponent(JSON.stringify({ order: ["FechaInicio DESC"], limit: Number(config.maxOffers ?? 50), skip: 0 }))}`;
    const payload = await fetchBuscojobsJson(baseUrl, config);
    const offers = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.rows) ? payload.rows : [];
    const directCandidates = candidatesFromBuscojobsPayload(payload);
    const baseLooksLikeApplicants = directCandidates.length > 0 && (
      /postul|candidat|curriculum|cv/i.test(baseUrl)
      || directCandidates.length >= Math.max(1, Math.floor(offers.length * 0.5))
    );
    if (baseLooksLikeApplicants) {
      return {
        rows: directCandidates,
        message: `Buscojobs: ${directCandidates.length} postulantes detectados directamente desde la llamada/API pegada.`
      };
    }
    const candidates: CandidateImport[] = [];
    const routeNotes: string[] = [];
    const maxOffers = Number(config.maxOffers ?? 50);

    for (const offer of offers.slice(0, maxOffers)) {
      const result = await fetchApplicantsForOffer(config, offer);
      candidates.push(...result.rows);
      const offerTitle = compactLabel(offerTitleFromRow(offer), `Oferta ${offerIdFromRow(offer) || "sin id"}`);
      routeNotes.push(`${offerTitle}: ${result.rows.length}`);
    }

    const deduped = new Map<string, CandidateImport>();
    for (const candidate of candidates) deduped.set(candidate.sourceId ?? candidate.fullName, candidate);

    return {
      rows: [...deduped.values()],
      message: `Buscojobs: ${offers.length} ofertas leidas, ${deduped.size} candidatos detectados. ${routeNotes.slice(0, 6).join(" | ")}`
    };
  }

  const cookieHeader = cookieHeaderFromConfig(config);
  if (!cookieHeader) {
    return { rows: [] as CandidateImport[], message: "Falta pegar la sesion/cookies exportadas de Buscojobs." };
  }

  const panelHtml = await fetchBuscojobs("https://buscojobs.com.uy/app/empresa/panel", cookieHeader);
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

      notes.push(`${compactLabel(offerTitle, "Oferta Buscojobs") || "Oferta Buscojobs"}: ${foundForOffer}`);
    } catch {
      notes.push(`${offerUrl}: error`);
    }
  }

  const bySource = new Map<string, CandidateImport>();
  for (const candidate of allCandidates) bySource.set(candidate.sourceId ?? candidate.fullName, candidate);
  return {
    rows: [...bySource.values()],
    message: `Buscojobs: ${offerUrls.length} ofertas revisadas, ${bySource.size} candidatos reales detectados. ${notes.slice(0, 6).join(" | ")}`
  };
}

const AGENTS: Record<string, IntegrationAgent> = {
  buscojobs: {
    id: "buscojobs",
    name: "Buscojobs",
    sync: scrapeBuscojobs
  }
};

function rowsFromConfig(config: Record<string, unknown>) {
  const direct = config.records ?? config.candidates;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  const raw = cleanText(config.historicalData ?? config.rawData ?? config.exportData);
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
    const nested = collectCandidateLikeRows(parsed);
    if (nested.length > 0) return nested;
  } catch {
    return parseCsv(raw);
  }

  return [];
}

function normalizeCandidate(row: Record<string, unknown>, sourceType: string): CandidateImport | null {
  const fullName = firstText(row, ["fullName", "full_name", "name", "nombre", "Nombre", "Nombre completo", "nombre completo", "Postulante", "postulante", "Candidato", "candidato", "Persona", "persona"]);
  const firstName = firstText(row, ["firstName", "first_name", "primerNombre", "PrimerNombre", "nombres", "Nombres", "nombre"]);
  const lastName = firstText(row, ["lastName", "last_name", "apellido", "Apellido", "apellidos", "Apellidos"]);
  const email = extractEmails(deepFirstText(row, ["email", "emails", "mail", "Mail", "correo", "Correo", "Correo electronico", "Email"]));
  const phone = extractPhones(deepFirstText(row, ["phone", "phones", "telefono", "Telefono", "teléfono", "Teléfono", "celular", "Celular", "mobile", "Mobile", "whatsapp", "WhatsApp"]));
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
    currentRole: compactLabel(firstText(row, ["currentRole", "current_role", "role", "cargo", "Cargo", "puesto", "Puesto", "position", "Postulacion", "postulacion", "Oferta", "oferta", "Vacante", "vacante"])),
    seniority: firstText(row, ["seniority", "seniorityLevel", "nivel"]),
    years,
    tags: safeTags(listFrom(row.tags ?? row.skills ?? row.habilidades ?? row.competencias ?? row.area ?? row.Area), sourceType),
    summary: firstText(row, ["summary", "resumen", "Resumen", "notes", "notas", "Notas", "experiencia", "Experiencia", "cvTexto", "textoCV"]),
    qualityScore: 0,
    sourceId: firstText(row, ["id", "Id", "sourceId", "source_id", "candidateId", "candidate_id", "PostulanteId", "postulanteId", "CandidatoId", "candidatoId", "PostulacionId", "postulacionId"]),
    sourceUrl: firstText(row, ["url", "sourceUrl", "source_url", "profileUrl", "profile_url"]),
    documents: candidateDocumentsFromRow(row, sourceType),
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

async function recordRejectedImport(sourceType: string, candidate: CandidateImport | null, reason: string, payload?: Record<string, unknown>) {
  await q(
    `INSERT INTO rejected_imports (source_type, source_id, source_url, extracted_name, reason, payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      sourceType,
      candidate?.sourceId ?? null,
      candidate?.sourceUrl ?? null,
      candidate?.fullName ?? null,
      reason,
      JSON.stringify(payload ?? candidate?.raw ?? {})
    ]
  );
}
async function saveDocuments(candidateId: string, sourceType: string, candidate: CandidateImport) {
  for (const document of candidate.documents ?? []) {
    if (!document.fileUrl && !document.rawText) continue;
    const fileName = document.fileName || `${candidate.fullName} - ${document.type}`;
    const existing = await q<{ id: string }>(
      `SELECT id FROM documents
       WHERE candidate_id=$1
         AND type=$2
         AND coalesce(file_url,'')=coalesce($3,'')
         AND coalesce(source_id,'')=coalesce($4,'')
       LIMIT 1`,
      [candidateId, document.type, document.fileUrl, document.sourceId]
    );

    if (existing.rows[0]) {
      await q(
        `UPDATE documents SET
          file_name=$1,
          file_url=coalesce($2,file_url),
          raw_text=coalesce($3,raw_text),
          mime_type=coalesce($4,mime_type),
          source_path=coalesce($5,source_path),
          is_primary_cv=$6
         WHERE id=$7`,
        [fileName, document.fileUrl, document.rawText, document.mimeType, document.sourcePath, Boolean(document.isPrimaryCv), existing.rows[0].id]
      );
    } else {
      await q(
        `INSERT INTO documents (candidate_id, type, file_name, file_url, raw_text, mime_type, source_type, source_id, source_path, is_primary_cv)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [candidateId, document.type, fileName, document.fileUrl, document.rawText, document.mimeType, sourceType, document.sourceId, document.sourcePath, Boolean(document.isPrimaryCv)]
      );
    }
  }
}
async function importCandidate(sourceType: string, candidate: CandidateImport) {
  if (!isUsableCandidate(candidate, sourceType)) {
    await recordRejectedImport(sourceType, candidate, "No parece una persona real o parece una oferta, barrio o categoria.");
    return "skipped";
  }
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
    const stillExists = await q<{ id: string }>("SELECT id FROM candidates WHERE id=$1 LIMIT 1", [existingId]);
    if (!stillExists.rows[0]) {
      existingId = null;
    }
  }

  if (existingId) {
    const updated = await q<{ id: string }>(
      `UPDATE candidates SET
        full_name=coalesce($1, full_name),
        first_name=coalesce($2, first_name),
        last_name=coalesce($3, last_name),
        email=coalesce((SELECT array_agg(DISTINCT value) FROM unnest(email || $4::text[]) AS value), '{}'::text[]),
        phone=coalesce((SELECT array_agg(DISTINCT value) FROM unnest(phone || $5::text[]) AS value), '{}'::text[]),
        city=coalesce($6, city),
        country=coalesce($7, country),
        linkedin_url=coalesce($8, linkedin_url),
        "current_role"=coalesce($9, "current_role"),
        ai_seniority=coalesce($10, ai_seniority),
        ai_seniority_years=coalesce($11, ai_seniority_years),
        ai_tags=coalesce((SELECT array_agg(DISTINCT value) FROM unnest(ai_tags || $12::text[]) AS value), '{}'::text[]),
        ai_summary=coalesce($13, ai_summary),
        updated_at=now(),
        last_seen_at=now()
       WHERE id=$14
       RETURNING id`,
      [candidate.fullName, candidate.firstName, candidate.lastName, candidate.email, candidate.phone, candidate.city,
        candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.seniority, candidate.years,
        candidate.tags, candidate.summary, existingId]
    );
    const updatedId = updated.rows[0]?.id;
    if (updatedId) {
      await saveSource(updatedId, sourceType, candidate);
      await saveDocuments(updatedId, sourceType, candidate);
      return "updated";
    }
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
  await saveDocuments(inserted.rows[0].id, sourceType, candidate);
  return "new";
}

async function ensureDefaultIntegrations() {
  for (const [id, name] of DEFAULT_INTEGRATIONS) {
    await q("INSERT INTO integrations (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [id, name]);
  }
}

async function removeCookieCandidates() {
  await q(
    `DELETE FROM candidates
     WHERE EXISTS (
       SELECT 1 FROM candidate_sources cs
       WHERE cs.candidate_id = candidates.id
         AND cs.source_type = 'buscojobs'
         AND (
           cs.source_data ? 'domain'
           OR cs.source_data ? 'expirationDate'
           OR candidates.full_name IN ('_gads','_gpi','_eoi','isiframeenabled','buscojobs-_zldt','buscojobs-_zldp','_hjSession_1333623','_hjSessionUser_1333623')
         )
     )`
  );

}

integrationsRouter.get("/", asyncHandler(async (_req, res) => {
  await ensureDefaultIntegrations();
  await removeCookieCandidates();
  const [integrations, logs, rejected] = await Promise.all([
    q("SELECT * FROM integrations ORDER BY name"),
    q("SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20"),
    q("SELECT source_type, extracted_name, reason, source_url, created_at FROM rejected_imports ORDER BY created_at DESC LIMIT 30")
  ]);
  res.json({ data: integrations.rows.map((row) => ({ ...row, config: maskConfig(row.config) })), logs: logs.rows, rejected: rejected.rows });
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
  const agent = AGENTS[integrationId];
  let scraperResult: AgentSyncResult | null = null;
  let scraperError: string | null = null;
  if (agent) {
    try {
      scraperResult = await agent.sync(config);
    } catch (error: any) {
      scraperError = error?.message ?? `Error desconocido leyendo ${agent.name}.`;
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
      const candidate = scraperResult && isAgentCandidate(row)
        ? row
        : integrationId === "buscojobs"
          ? (applicantFromRow(row as Record<string, unknown>, {}) ?? normalizeCandidate(row as Record<string, unknown>, integrationId))
          : normalizeCandidate(row as Record<string, unknown>, integrationId);
      if (!candidate) {
        errors += 1;
        continue;
      }
      const result = await importCandidate(integrationId, candidate);
      if (result === "new") newRecords += 1;
      if (result === "updated") updatedRecords += 1;
      if (result === "skipped") { /* omitted: no real identity/contact/CV */ }
    }
    status = errors > 0 ? "warning" : "success";
    message = `Historico procesado: ${newRecords} nuevos, ${updatedRecords} actualizados, ${errors} omitidos.`;
  } else if (scraperResult) {
    message = scraperResult.message;
  } else if (scraperError) {
    status = "error";
    errors = 1;
    message = `${agent?.name ?? integration.rows[0].name} no pudo sincronizar: ${scraperError}`;
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
