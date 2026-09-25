import { Router } from "express";
import { z } from "zod";
import { q, qSearchWithTimeout } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { searchTalent } from "./search.js";
import { candidateDisplayLocation, candidateDisplayName } from "../services/candidatePresentation.js";
import { nearbyUruguayLocations } from "../intelligence/uruguayGeography.js";

export const seasonRouter = Router();

const SEASON_RECENCY_FILTER = "730d" as const;
const SEASON_RESULT_LIMIT = 2500;
const SEASON_BROAD_RETRIEVAL_LIMIT = 2500;
const SEASON_BROAD_POOL_LIMIT = 4500;
const SEASON_RECENT_SOURCE_CONDITION = `EXISTS (
  SELECT 1
  FROM candidate_sources season_recent_source
  WHERE season_recent_source.candidate_id=c.id
    AND season_recent_source.is_active=true
    AND season_recent_source.source_created_at >= now() - interval '2 years'
)`;

const SEASON_STOPWORDS = new Set([
  "de", "del", "la", "las", "los", "el", "un", "una", "para", "por", "con", "sin", "en", "y", "o",
  "perfil", "perfiles", "persona", "personas", "experiencia", "experiencias", "junior", "poca", "poco",
  "nivel", "anos", "años", "ano", "año", "temporada", "verano"
]);

const SEASON_TERM_SYNONYMS: Record<string, string[]> = {
  supermercado: ["retail", "autoservicio", "cajero", "cajera", "caja", "repositor", "repositora", "reposicion", "reposición", "gondolas", "góndolas", "atencion al cliente", "atención al cliente", "deposito", "depósito", "stock"],
  auxiliar: ["ayudante", "asistente", "operario", "operaria", "soporte", "apoyo"],
  repositor: ["repositora", "reposicion", "reposición", "gondolas", "góndolas", "supermercado", "retail", "stock"],
  caja: ["cajero", "cajera", "cobranza", "arqueo", "pos", "supermercado"],
  cajero: ["cajera", "caja", "cobranza", "atencion al cliente", "atención al cliente"],
  cajera: ["cajero", "caja", "cobranza", "atencion al cliente", "atención al cliente"],
  atencion: ["atención", "cliente", "clientes", "publico", "público", "ventas", "mostrador"],
  cliente: ["clientes", "publico", "público", "mostrador", "ventas", "atencion al cliente", "atención al cliente"],
  deposito: ["depósito", "almacen", "almacén", "stock", "logistica", "logística", "carga", "descarga", "preparacion de pedidos", "preparación de pedidos"],
  gondolas: ["góndolas", "reposicion", "reposición", "repositor", "repositora", "supermercado"],
  maldonado: ["punta del este", "san carlos", "piriapolis", "piriápolis", "pan de azucar", "pan de azúcar", "la barra", "manantiales", "maldonado nuevo"]
};

const seasonSearchSchema = z.object({
  name: z.string().trim().min(3),
  department: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  radiusKm: z.number().int().min(0).max(250).optional().nullable(),
  role: z.string().trim().min(2),
  experienceLevel: z.string().trim().optional().nullable(),
  keywords: z.array(z.string().trim()).default([]),
  excludeKeywords: z.array(z.string().trim()).default([])
});

function cleanList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 40);
}

function normalizeForSearch(value: unknown) {
  return normalized(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTerms(values: string[], limit = 120) {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    const key = normalizeForSearch(text);
    if (!key || key.length < 3 || SEASON_STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    terms.push(text);
    if (terms.length >= limit) break;
  }
  return terms;
}

function seasonSearchTerms(search: any) {
  const base = [
    search.role,
    search.experience_level,
    ...(search.keywords ?? [])
  ].filter(Boolean).map(String);
  const splitWords = base.flatMap((value) => normalizeForSearch(value).split(" "));
  const normalizedKeys = [...new Set([...base.map(normalizeForSearch), ...splitWords])];
  const synonyms = normalizedKeys.flatMap((key) => SEASON_TERM_SYNONYMS[key] ?? []);
  return uniqueTerms([...base, ...splitWords, ...synonyms]);
}

function seasonLocationTerms(search: any) {
  const raw = [search.city, search.department].filter(Boolean).map(String);
  const expanded = raw.flatMap((location) => nearbyUruguayLocations(location, Number(search.radius_km ?? 30)));
  const normalizedKeys = [...new Set([...raw, ...expanded].map(normalizeForSearch))];
  const synonyms = normalizedKeys.flatMap((key) => SEASON_TERM_SYNONYMS[key] ?? []);
  return uniqueTerms([...raw, ...expanded, ...synonyms], 80);
}

function likePatterns(values: string[]) {
  return values
    .map((value) => normalizeForSearch(value))
    .filter((value) => value.length >= 3)
    .map((value) => `%${value}%`);
}

function websearchOrQuery(values: string[]) {
  const parts = values
    .map((value) => normalizeForSearch(value))
    .filter((value) => value.length >= 3 && !SEASON_STOPWORDS.has(value))
    .slice(0, 60)
    .map((value) => value.includes(" ") ? `"${value}"` : value);
  return parts.join(" OR ") || "curriculum OR experiencia";
}

function seasonLocationRequirement(search: any) {
  const terms = seasonLocationTerms(search);
  const patterns = likePatterns(terms);
  return { terms, patterns };
}

function seasonQuery(search: any) {
  const parts = [
    search.role,
    search.experience_level,
    cleanList(search.keywords ?? []).join(", "),
    search.city || search.department ? `Ubicacion: ${[search.city, search.department].filter(Boolean).join(", ")}` : "",
    search.radius_km ? `zonas cercanas en un radio aproximado de ${search.radius_km} km` : ""
  ];
  return parts.filter(Boolean).join(". ");
}

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

export function candidateContainsExcluded(candidate: any, excludeKeywords: string[]) {
  const exclusions = cleanList(excludeKeywords).map(normalized).filter(Boolean);
  if (!exclusions.length) return false;
  const primaryProfile = normalized([
    candidate.currentRole,
    ...(candidate.tags ?? []),
    ...(candidate.aiRoles ?? []),
    ...(candidate.roles ?? [])
  ].filter(Boolean).join(" "));
  return exclusions.some((term) => {
    if (!primaryProfile.includes(term)) return false;
    if (term === "encargado") {
      const operationalRole = /\b(repositor|cajer|auxiliar|operari|atencion|atención|ventas|deposit|logistic|stock)\b/.test(primaryProfile);
      return /\bencargad[oa]s?\b/.test(primaryProfile) && !operationalRole;
    }
    return true;
  });
}

function cleanScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function cleanOptionalText(value: unknown, maxLength = 500) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function cleanTextArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, 20);
}

function textIncludesAny(haystack: unknown, terms: string[]) {
  const normalizedHaystack = normalizeForSearch(haystack);
  if (!normalizedHaystack) return [];
  return terms
    .filter((term) => {
      const normalizedTerm = normalizeForSearch(term);
      return normalizedTerm.length >= 3 && normalizedHaystack.includes(normalizedTerm);
    })
    .slice(0, 12);
}

function scoreBroadSeasonCandidate(row: any, terms: string[], locationTerms: string[]) {
  const roleText = [row.current_role, ...(row.ai_tags ?? []), ...(row.ai_roles ?? [])].join(" ");
  const profileText = [
    row.full_name,
    row.current_role,
    row.ai_summary,
    ...(row.ai_tags ?? []),
    ...(row.ai_industries ?? []),
    ...(row.ai_roles ?? []),
    row.primary_document_name,
    row.document_snippet
  ].join(" ");
  const locationText = [row.city, row.country, row.ai_summary, row.document_snippet].join(" ");
  const roleHits = textIncludesAny(roleText, terms);
  const documentHits = textIncludesAny(profileText, terms);
  const locationHits = textIncludesAny(locationText, locationTerms);
  const sourceTypes = cleanTextArray(row.source_types);
  const hasContact = (row.email ?? []).length > 0 || (row.phone ?? []).length > 0;
  const hasDocument = Boolean(row.primary_document_id || row.primary_document_name);
  const roleStrength = roleHits.length ? 28 : 0;
  const documentStrength = Math.min(26, documentHits.length * 5);
  const locationStrength = locationTerms.length ? (locationHits.length ? 22 : 0) : 12;
  const sourceStrength = Math.min(8, sourceTypes.length * 2);
  const recencyStrength = row.latest_source_at ? 8 : 0;
  const contactStrength = hasContact ? 4 : 0;
  const documentStrengthBonus = hasDocument ? 4 : 0;
  const rankBoost = Math.min(10, Math.round(Number(row.rank ?? 0) * 100));
  const score = cleanScore(35 + roleStrength + documentStrength + locationStrength + sourceStrength + recencyStrength + contactStrength + documentStrengthBonus + rankBoost);
  const evidence = [...new Set([...roleHits, ...documentHits, ...locationHits])].slice(0, 8);
  const matchReason = evidence.length
    ? `Coincide con ${evidence.join(", ")}. Evidencia encontrada en perfil, CV o fuentes recientes.`
    : "Coincidencia amplia por perfil estacional y fuente reciente.";
  return { score, matchReason, sourceTypes };
}

function mapBroadSeasonCandidate(row: any, search: any, terms: string[], locationTerms: string[]) {
  const scored = scoreBroadSeasonCandidate(row, terms, locationTerms);
  return {
    id: row.id,
    fullName: candidateDisplayName(row.full_name),
    email: row.email ?? [],
    phone: row.phone ?? [],
    city: candidateDisplayLocation(row.city),
    country: row.country,
    linkedinUrl: row.linkedin_url,
    profileUrl: row.profile_url ?? null,
    currentRole: row.current_role,
    seniority: row.ai_seniority,
    years: row.ai_seniority_years,
    tags: row.ai_tags ?? [],
    languages: row.ai_languages ?? [],
    summary: row.ai_summary,
    strengths: row.ai_strengths ?? [],
    weaknesses: row.ai_weaknesses ?? [],
    qualityScore: row.quality_score,
    sourceCount: Number(row.source_count ?? 0),
    sourceTypes: scored.sourceTypes,
    documentCount: Number(row.document_count ?? 0),
    primaryDocumentName: row.primary_document_name ?? null,
    primaryDocumentId: row.primary_document_id ?? null,
    primaryDocumentMimeType: row.primary_document_mime_type ?? null,
    primaryDocumentSourceType: row.primary_document_source_type ?? null,
    documentSnippet: row.document_snippet ?? null,
    status: row.status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? row.updated_at,
    latestSourceAt: row.latest_source_at ?? null,
    score: scored.score,
    matchReason: scored.matchReason,
    rankSignals: {
      seasonRole: search.role,
      seasonLocation: search.city || search.department || null
    }
  };
}

async function broadSeasonCandidates(search: any) {
  const terms = seasonSearchTerms(search);
  const location = seasonLocationRequirement(search);
  const locationTerms = location.terms;
  const termPatterns = likePatterns(terms);
  const locationPatterns = location.patterns;
  if (!termPatterns.length) return [];
  const query = websearchOrQuery(terms);
  const { rows } = await qSearchWithTimeout(
    `WITH source_summary AS MATERIALIZED (
       SELECT cs.candidate_id,
         count(DISTINCT cs.source_type)::int AS source_count,
         array_agg(DISTINCT cs.source_type ORDER BY cs.source_type) AS source_types,
         max(cs.source_created_at) AS latest_source_at,
         max(cs.source_url) FILTER (WHERE nullif(cs.source_url, '') IS NOT NULL) AS profile_url
       FROM candidate_sources cs
       WHERE cs.is_active=true
         AND cs.source_created_at >= now() - interval '2 years'
       GROUP BY cs.candidate_id
     ), candidate_pool AS MATERIALIZED (
       SELECT c.*,
         coalesce(source_summary.source_count, 0)::int AS source_count,
         coalesce(source_summary.source_types, '{}'::text[]) AS source_types,
         source_summary.latest_source_at,
         source_summary.profile_url,
         to_tsvector(
           'spanish'::regconfig,
           coalesce(c.full_name, '') || ' ' ||
           coalesce(c.current_role, '') || ' ' ||
           coalesce(c.ai_summary, '') || ' ' ||
           array_to_string(coalesce(c.ai_tags, '{}'::text[]), ' ') || ' ' ||
           array_to_string(coalesce(c.ai_industries, '{}'::text[]), ' ') || ' ' ||
           array_to_string(coalesce(c.ai_roles, '{}'::text[]), ' ')
         ) AS search_vector,
         translate(lower(
           coalesce(c.full_name, '') || ' ' ||
           coalesce(c.current_role, '') || ' ' ||
           coalesce(c.city, '') || ' ' ||
           coalesce(c.country, '') || ' ' ||
           coalesce(c.ai_summary, '') || ' ' ||
           array_to_string(coalesce(c.ai_tags, '{}'::text[]), ' ') || ' ' ||
           array_to_string(coalesce(c.ai_industries, '{}'::text[]), ' ') || ' ' ||
           array_to_string(coalesce(c.ai_roles, '{}'::text[]), ' ')
         ), 'áéíóúüñ', 'aeiouun') AS searchable_text,
         translate(lower(
           coalesce(c.city, '') || ' ' ||
           coalesce(c.country, '') || ' ' ||
           coalesce(c.ai_summary, '')
         ), 'áéíóúüñ', 'aeiouun') AS location_text
       FROM candidates c
       JOIN source_summary ON source_summary.candidate_id=c.id
       WHERE c.duplicate_of IS NULL
         AND c.status='active'
         AND (
           cardinality($3::text[]) = 0
           OR translate(lower(coalesce(c.city, '') || ' ' || coalesce(c.country, '') || ' ' || coalesce(c.ai_summary, '')), 'áéíóúüñ', 'aeiouun') LIKE ANY($3::text[])
         )
         AND (
           to_tsvector(
             'spanish'::regconfig,
             coalesce(c.full_name, '') || ' ' ||
             coalesce(c.current_role, '') || ' ' ||
             coalesce(c.ai_summary, '') || ' ' ||
             array_to_string(coalesce(c.ai_tags, '{}'::text[]), ' ') || ' ' ||
             array_to_string(coalesce(c.ai_industries, '{}'::text[]), ' ') || ' ' ||
             array_to_string(coalesce(c.ai_roles, '{}'::text[]), ' ')
           ) @@ websearch_to_tsquery('spanish'::regconfig, $1)
           OR translate(lower(
             coalesce(c.full_name, '') || ' ' ||
             coalesce(c.current_role, '') || ' ' ||
             coalesce(c.ai_summary, '') || ' ' ||
             array_to_string(coalesce(c.ai_tags, '{}'::text[]), ' ') || ' ' ||
             array_to_string(coalesce(c.ai_industries, '{}'::text[]), ' ') || ' ' ||
             array_to_string(coalesce(c.ai_roles, '{}'::text[]), ' ')
           ), 'áéíóúüñ', 'aeiouun') LIKE ANY($2::text[])
         )
       ORDER BY source_summary.latest_source_at DESC NULLS LAST, c.quality_score DESC, c.updated_at DESC
       LIMIT $5
     ), primary_documents AS MATERIALIZED (
       SELECT DISTINCT ON (d.candidate_id)
         d.candidate_id,
         d.id,
         d.file_name,
         d.mime_type,
         d.source_type,
         left(coalesce(d.raw_text, ''), 6000) AS raw_text
       FROM documents d
       JOIN candidate_pool ON candidate_pool.id=d.candidate_id
       WHERE length(coalesce(d.raw_text, '')) >= 80
       ORDER BY d.candidate_id, d.is_primary_cv DESC, d.created_at DESC
     )
     SELECT candidate_pool.*,
       primary_documents.id AS primary_document_id,
       primary_documents.file_name AS primary_document_name,
       primary_documents.mime_type AS primary_document_mime_type,
       primary_documents.source_type AS primary_document_source_type,
       left(coalesce(primary_documents.raw_text, ''), 1500) AS document_snippet,
       CASE WHEN primary_documents.id IS NULL THEN 0 ELSE 1 END AS document_count,
       ts_rank_cd(candidate_pool.search_vector, websearch_to_tsquery('spanish'::regconfig, $1)) AS rank
     FROM candidate_pool
     LEFT JOIN primary_documents ON primary_documents.candidate_id=candidate_pool.id
     ORDER BY
       rank DESC,
       candidate_pool.latest_source_at DESC NULLS LAST,
       candidate_pool.quality_score DESC,
       candidate_pool.updated_at DESC
     LIMIT $4`,
    [query, termPatterns, locationPatterns, SEASON_BROAD_RETRIEVAL_LIMIT, SEASON_BROAD_POOL_LIMIT],
    10_000
  );
  return rows.map((row) => mapBroadSeasonCandidate(row, search, terms, locationTerms));
}

function mergeSeasonCandidates(primary: any[], broad: any[]) {
  const byId = new Map<string, any>();
  for (const candidate of [...primary, ...broad]) {
    const id = cleanOptionalText(candidate.id, 80);
    if (!id) continue;
    const current = byId.get(id);
    if (!current || cleanScore(candidate.score) > cleanScore(current.score)) {
      byId.set(id, {
        ...candidate,
        sourceTypes: cleanTextArray([...(current?.sourceTypes ?? []), ...(candidate.sourceTypes ?? [])]),
        profileUrl: candidate.profileUrl ?? current?.profileUrl ?? null
      });
    } else if (current && candidate.sourceTypes?.length) {
      current.sourceTypes = cleanTextArray([...(current.sourceTypes ?? []), ...candidate.sourceTypes]);
      current.profileUrl ??= candidate.profileUrl ?? null;
    }
  }
  return [...byId.values()]
    .sort((left, right) => {
      const scoreDiff = cleanScore(right.score) - cleanScore(left.score);
      if (scoreDiff !== 0) return scoreDiff;
      return String(right.latestSourceAt ?? "").localeCompare(String(left.latestSourceAt ?? ""));
    });
}

function mapSeason(row: any) {
  return {
    id: row.id,
    name: row.name,
    department: row.department,
    city: row.city,
    radiusKm: row.radius_km,
    role: row.role,
    experienceLevel: row.experience_level,
    keywords: row.keywords ?? [],
    excludeKeywords: row.exclude_keywords ?? [],
    queryText: row.query_text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    resultCount: Number(row.result_count ?? 0),
    reservedCount: Number(row.reserved_count ?? 0),
    myReservedCount: Number(row.my_reserved_count ?? 0)
  };
}

function mapSeasonResult(row: any, viewerId?: string) {
  return {
    id: row.result_id,
    score: Number(row.score ?? 0),
    matchReason: row.match_reason,
    sourceTypes: row.result_source_types ?? [],
    profileUrl: row.profile_url,
    firstFoundAt: row.first_found_at,
    lastFoundAt: row.last_found_at,
    reservedAt: row.reserved_at,
    reservedBy: row.reserved_by,
    reservedByName: row.reserved_by_name,
    reservedByEmail: row.reserved_by_email,
    isReservedByMe: Boolean(row.reserved_by && viewerId && row.reserved_by === viewerId),
    candidate: {
      id: row.candidate_id,
      fullName: candidateDisplayName(row.full_name),
      email: row.email ?? [],
      phone: row.phone ?? [],
      city: candidateDisplayLocation(row.city),
      country: row.country,
      linkedinUrl: row.linkedin_url,
      currentRole: row.current_role,
      seniority: row.ai_seniority,
      years: row.ai_seniority_years,
      tags: row.ai_tags ?? [],
      languages: row.ai_languages ?? [],
      summary: row.ai_summary,
      strengths: row.ai_strengths ?? [],
      weaknesses: row.ai_weaknesses ?? [],
      qualityScore: row.quality_score,
      sourceCount: Number(row.source_count ?? 0),
      sourceTypes: row.candidate_source_types ?? row.result_source_types ?? [],
      documentCount: Number(row.document_count ?? 0),
      primaryDocumentName: row.primary_document_name ?? null,
      primaryDocumentId: row.primary_document_id ?? null,
      primaryDocumentMimeType: row.primary_document_mime_type ?? null,
      primaryDocumentSourceType: row.primary_document_source_type ?? null,
      documentSnippet: row.document_snippet ?? null,
      status: row.status,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at ?? row.updated_at,
      latestSourceAt: row.latest_source_at ?? null
    }
  };
}

async function getSeasonList(viewerId: string) {
  const { rows } = await q(
    `SELECT ss.*,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION})::int AS result_count,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION} AND ssr.reserved_at IS NOT NULL)::int AS reserved_count,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION} AND ssr.reserved_by=$1)::int AS my_reserved_count
     FROM season_searches ss
     LEFT JOIN season_search_results ssr ON ssr.season_search_id=ss.id
     LEFT JOIN candidates c ON c.id=ssr.candidate_id AND c.duplicate_of IS NULL
     WHERE ss.status <> 'archived'
     GROUP BY ss.id
     ORDER BY ss.updated_at DESC, ss.created_at DESC`,
    [viewerId]
  );
  return rows.map(mapSeason);
}

async function getSeasonDetail(id: string, viewerId: string) {
  const { rows: searchRows } = await q(
    `SELECT ss.*,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION})::int AS result_count,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION} AND ssr.reserved_at IS NOT NULL)::int AS reserved_count,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION} AND ssr.reserved_by=$2)::int AS my_reserved_count
     FROM season_searches ss
     LEFT JOIN season_search_results ssr ON ssr.season_search_id=ss.id
     LEFT JOIN candidates c ON c.id=ssr.candidate_id AND c.duplicate_of IS NULL
     WHERE ss.id=$1
       AND ss.status <> 'archived'
     GROUP BY ss.id`,
    [id, viewerId]
  );
  const search = searchRows[0];
  if (!search) return null;
  const { rows: resultRows } = await q(
    `WITH document_counts AS (
       SELECT d.candidate_id, count(*)::int AS document_count
       FROM documents d
       JOIN season_search_results ssr ON ssr.candidate_id=d.candidate_id
       WHERE ssr.season_search_id=$1
       GROUP BY d.candidate_id
     ), primary_documents AS (
       SELECT DISTINCT ON (d.candidate_id)
         d.candidate_id,
         d.id,
         d.file_name,
         d.mime_type,
         d.source_type,
         d.raw_text
       FROM documents d
       JOIN season_search_results ssr ON ssr.candidate_id=d.candidate_id
       WHERE ssr.season_search_id=$1
       ORDER BY d.candidate_id, d.is_primary_cv DESC, d.created_at DESC
     ), source_summary AS (
       SELECT cs.candidate_id,
         count(DISTINCT cs.source_type)::int AS source_count,
         array_agg(DISTINCT cs.source_type ORDER BY cs.source_type) AS source_types,
         max(cs.source_created_at) AS latest_source_at
       FROM candidate_sources cs
       JOIN season_search_results ssr ON ssr.candidate_id=cs.candidate_id
       WHERE ssr.season_search_id=$1 AND cs.is_active=true
       GROUP BY cs.candidate_id
     )
     SELECT ssr.id AS result_id,
       ssr.score,
       ssr.match_reason,
       ssr.source_types AS result_source_types,
       ssr.profile_url,
       ssr.first_found_at,
       ssr.last_found_at,
       ssr.reserved_at,
       ssr.reserved_by,
       reserved_user.name AS reserved_by_name,
       reserved_user.email AS reserved_by_email,
       c.id AS candidate_id,
       c.*,
       coalesce(source_summary.source_count, 0)::int AS source_count,
       coalesce(source_summary.source_types, '{}'::text[]) AS candidate_source_types,
       source_summary.latest_source_at,
       coalesce(document_counts.document_count, 0)::int AS document_count,
       primary_documents.id AS primary_document_id,
       primary_documents.file_name AS primary_document_name,
       primary_documents.mime_type AS primary_document_mime_type,
       primary_documents.source_type AS primary_document_source_type,
       left(coalesce(primary_documents.raw_text, ''), 1200) AS document_snippet
     FROM season_search_results ssr
     JOIN candidates c ON c.id=ssr.candidate_id
     LEFT JOIN users reserved_user ON reserved_user.id=ssr.reserved_by
     LEFT JOIN document_counts ON document_counts.candidate_id=c.id
     LEFT JOIN primary_documents ON primary_documents.candidate_id=c.id
     LEFT JOIN source_summary ON source_summary.candidate_id=c.id
     WHERE ssr.season_search_id=$1
       AND c.duplicate_of IS NULL
       AND ${SEASON_RECENT_SOURCE_CONDITION}
     ORDER BY
       CASE
         WHEN ssr.reserved_at IS NULL THEN 0
         WHEN ssr.reserved_by=$2 THEN 1
         ELSE 2
       END,
       ssr.score DESC,
       ssr.last_found_at DESC
     LIMIT ${SEASON_RESULT_LIMIT}`,
    [id, viewerId]
  );
  return { search: mapSeason(search), results: resultRows.map((row) => mapSeasonResult(row, viewerId)) };
}

seasonRouter.get("/", asyncHandler(async (req, res) => {
  res.json({ data: await getSeasonList(req.user!.id) });
}));

seasonRouter.post("/", asyncHandler(async (req, res) => {
  const body = seasonSearchSchema.parse(req.body);
  const values = {
    ...body,
    keywords: cleanList(body.keywords),
    excludeKeywords: cleanList(body.excludeKeywords)
  };
  const queryText = seasonQuery({
    role: values.role,
    experience_level: values.experienceLevel,
    department: values.department,
    city: values.city,
    radius_km: values.radiusKm,
    keywords: values.keywords
  });
  const { rows } = await q(
    `INSERT INTO season_searches (name, department, city, radius_km, role, experience_level, keywords, exclude_keywords, query_text, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [values.name, values.department ?? null, values.city ?? null, values.radiusKm ?? null, values.role, values.experienceLevel ?? null, values.keywords, values.excludeKeywords, queryText, req.user!.id]
  );
  res.status(201).json({ data: mapSeason({ ...rows[0], result_count: 0, reserved_count: 0, my_reserved_count: 0 }) });
}));

seasonRouter.get("/:id", asyncHandler(async (req, res) => {
  const detail = await getSeasonDetail(routeParam(req.params.id), req.user!.id);
  if (!detail) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  res.json({ data: detail });
}));

seasonRouter.patch("/:id", asyncHandler(async (req, res) => {
  const body = seasonSearchSchema.partial().parse(req.body);
  const id = routeParam(req.params.id);
  const { rows } = await q("SELECT * FROM season_searches WHERE id=$1 AND status <> 'archived'", [id]);
  const current = rows[0];
  if (!current) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  const next = {
    name: body.name ?? current.name,
    department: body.department ?? current.department,
    city: body.city ?? current.city,
    radiusKm: body.radiusKm ?? current.radius_km,
    role: body.role ?? current.role,
    experienceLevel: body.experienceLevel ?? current.experience_level,
    keywords: body.keywords ? cleanList(body.keywords) : current.keywords,
    excludeKeywords: body.excludeKeywords ? cleanList(body.excludeKeywords) : current.exclude_keywords
  };
  const queryText = seasonQuery({
    role: next.role,
    experience_level: next.experienceLevel,
    department: next.department,
    city: next.city,
    radius_km: next.radiusKm,
    keywords: next.keywords
  });
  const updated = await q(
    `UPDATE season_searches
     SET name=$2, department=$3, city=$4, radius_km=$5, role=$6, experience_level=$7, keywords=$8, exclude_keywords=$9, query_text=$10, updated_at=now()
     WHERE id=$1
     RETURNING *`,
    [id, next.name, next.department, next.city, next.radiusKm, next.role, next.experienceLevel, next.keywords, next.excludeKeywords, queryText]
  );
  res.json({ data: mapSeason({ ...updated.rows[0], result_count: 0, reserved_count: 0, my_reserved_count: 0 }) });
}));

seasonRouter.delete("/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const { rows } = await q(
    `UPDATE season_searches
     SET status='archived', updated_at=now()
     WHERE id=$1 AND status <> 'archived'
     RETURNING *`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  await q(
    "INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1,'archive','season_search',$2)",
    [req.user!.id, id]
  );
  res.json({ data: mapSeason({ ...rows[0], result_count: 0, reserved_count: 0, my_reserved_count: 0 }) });
}));

seasonRouter.post("/:id/run", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const { rows } = await q("SELECT * FROM season_searches WHERE id=$1 AND status <> 'archived'", [id]);
  const search = rows[0];
  if (!search) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  const queryText = seasonQuery(search);
  let result;
  let broadCandidates: any[] = [];
  try {
    const [rankedResult, broadResult] = await Promise.all([
      searchTalent(queryText, {
        location: search.city || search.department || undefined,
        activeOnly: true,
        recency: SEASON_RECENCY_FILTER,
        sort: "relevance",
        maxResults: SEASON_RESULT_LIMIT
      }),
      broadSeasonCandidates(search)
    ]);
    result = rankedResult;
    broadCandidates = broadResult;
  } catch (error: any) {
    if (error?.code === "57014") return res.status(503).json({ error: "La búsqueda demoró demasiado. Probá ejecutar con menos palabras clave." });
    throw error;
  }
  const merged = mergeSeasonCandidates(result.data, broadCandidates);
  const candidates = merged
    .filter((candidate) => !candidateContainsExcluded(candidate, search.exclude_keywords ?? []))
    .slice(0, SEASON_RESULT_LIMIT);
  let imported = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const candidateId = cleanOptionalText(candidate.id, 80);
    if (!candidateId) {
      skipped += 1;
      continue;
    }
    try {
      await q(
        `INSERT INTO season_search_results (season_search_id, candidate_id, score, match_reason, source_types, profile_url)
         VALUES ($1,$2,$3,$4,$5::text[],$6)
         ON CONFLICT (season_search_id, candidate_id)
         DO UPDATE SET score=EXCLUDED.score,
           match_reason=EXCLUDED.match_reason,
           source_types=EXCLUDED.source_types,
           profile_url=coalesce(EXCLUDED.profile_url, season_search_results.profile_url),
           last_found_at=now()`,
        [
          search.id,
          candidateId,
          cleanScore(candidate.score),
          cleanOptionalText(candidate.matchReason, 1000),
          cleanTextArray(candidate.sourceTypes),
          cleanOptionalText(candidate.profileUrl, 1000)
        ]
      );
      imported += 1;
    } catch (error) {
      skipped += 1;
      console.error("Season candidate import skipped", {
        seasonSearchId: search.id,
        candidateId,
        error
      });
    }
  }
  await q(
    "UPDATE season_searches SET query_text=$2, last_run_at=now(), updated_at=now() WHERE id=$1",
    [search.id, queryText]
  );
  const detail = await getSeasonDetail(search.id, req.user!.id);
  res.json({
    data: detail,
    meta: {
      reviewed: merged.length,
      rankedReviewed: result.data.length,
      broadReviewed: broadCandidates.length,
      imported,
      excluded: merged.length - candidates.length,
      skipped
    }
  });
}));

seasonRouter.post("/:id/results/:candidateId/reserve", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const candidateId = routeParam(req.params.candidateId);
  const activeSearch = await q("SELECT id FROM season_searches WHERE id=$1 AND status <> 'archived'", [id]);
  if (!activeSearch.rows[0]) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  const { rows } = await q(
    `INSERT INTO season_search_results (season_search_id, candidate_id, reserved_at, reserved_by)
     VALUES ($1,$2,now(),$3)
     ON CONFLICT (season_search_id, candidate_id)
     DO UPDATE SET reserved_at=now(),
       reserved_by=EXCLUDED.reserved_by,
       last_found_at=now()
     WHERE season_search_results.reserved_by IS NULL
       OR season_search_results.reserved_by=EXCLUDED.reserved_by
     RETURNING *`,
    [id, candidateId, req.user!.id]
  );
  if (!rows[0]) {
    const existing = await q(
      `SELECT users.name AS reserved_by_name, users.email AS reserved_by_email
       FROM season_search_results ssr
       LEFT JOIN users ON users.id=ssr.reserved_by
       WHERE ssr.season_search_id=$1 AND ssr.candidate_id=$2`,
      [id, candidateId]
    );
    const reservation = existing.rows[0];
    const reserver = reservation?.reserved_by_name || reservation?.reserved_by_email || "otro reclutador";
    return res.status(409).json({ error: `Este candidato ya fue reservado por ${reserver}.` });
  }
  res.json({ data: rows[0] });
}));

seasonRouter.delete("/:id/results/:candidateId/reserve", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const candidateId = routeParam(req.params.candidateId);
  const activeSearch = await q("SELECT id FROM season_searches WHERE id=$1 AND status <> 'archived'", [id]);
  if (!activeSearch.rows[0]) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  const { rows } = await q(
    `UPDATE season_search_results
     SET reserved_at=NULL, reserved_by=NULL, last_found_at=now()
     WHERE season_search_id=$1 AND candidate_id=$2 AND reserved_by=$3
     RETURNING *`,
    [id, candidateId, req.user!.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "No encontré una reserva tuya para liberar." });
  res.json({ data: rows[0] });
}));
