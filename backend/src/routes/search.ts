import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { RecruitmentIntelligenceEngine } from "../intelligence/intelligenceEngine.js";
import { syncConnectedIntegrations } from "./integrations.js";
import type { TalentSearchFilters } from "../intelligence/types.js";

export const searchRouter = Router();

const searchSchema = z.object({
  query: z.string().min(1),
  refreshSources: z.boolean().optional().default(false),
  filters: z.object({
    source: z.array(z.string()).optional(),
    seniority: z.string().optional(),
    activeOnly: z.boolean().optional()
  }).default({})
});

function normalizeSearchText(value: string) {
  return value.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function expandedSearchTerms(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const words = normalizedQuery.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  const extras: Record<string, string[]> = {
    vendedor: ["ventas", "comercial", "ejecutivo comercial"],
    vendedora: ["ventas", "comercial", "ejecutiva comercial"],
    ventas: ["vendedor", "vendedora", "comercial"],
    comercial: ["ventas", "vendedor", "vendedora"],
    ingeniero: ["ingenieria", "ingeniería", "engineer"],
    ingeniera: ["ingenieria", "ingeniería", "engineer"],
    desarrollador: ["developer", "programador", "software"],
    desarrolladora: ["developer", "programadora", "software"],
    rrhh: ["recursos humanos", "talento", "seleccion", "selección"],
    seleccion: ["selección", "reclutamiento", "recursos humanos"],
    selección: ["seleccion", "reclutamiento", "recursos humanos"],
    abogado: ["abogada", "legal", "derecho", "juridico", "jurídico", "asesor legal", "asesora legal"],
    abogada: ["abogado", "legal", "derecho", "juridico", "jurídico", "asesor legal", "asesora legal"],
    legal: ["abogado", "abogada", "derecho", "juridico", "jurídico"],
    derecho: ["abogado", "abogada", "legal", "juridico", "jurídico"],
    ingles: ["inglés", "english", "idioma ingles", "idioma inglés"],
    inglés: ["ingles", "english", "idioma ingles", "idioma inglés"],
    english: ["ingles", "inglés"],
    gastronomia: ["gastronomía", "gastonomia", "restaurante", "cocina", "mozo", "moza", "atencion al cliente", "atención al cliente"],
    gastonomia: ["gastronomia", "gastronomía", "restaurante", "cocina", "mozo", "moza"],
    gastronomía: ["gastronomia", "gastonomia", "restaurante", "cocina", "mozo", "moza"],
    restaurante: ["gastronomia", "gastronomía", "cocina", "mozo", "moza"],
    cocina: ["gastronomia", "gastronomía", "restaurante"],
    mozo: ["moza", "gastronomia", "gastronomía", "restaurante"],
    moza: ["mozo", "gastronomia", "gastronomía", "restaurante"]
  };
  return [...new Set([normalizedQuery, ...words, ...words.flatMap((word) => extras[word] ?? [])].map(normalizeSearchText))]
    .map((term) => `%${term}%`);
}

function normalizedSqlText(sql: string) {
  return `translate(lower(${sql}), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')`;
}

function cleanResultContacts(values: unknown, maxItems: number) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map((item) => String(item ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, maxItems);
}

function cleanResultSummary(value: unknown) {
  const text = String(value ?? "")
    .replace(/Ã¡/g, "á").replace(/Ã©/g, "é").replace(/Ã­/g, "í").replace(/Ã³/g, "ó").replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ").replace(/Â/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^%PDF-|endobj|xref|\/FlateDecode|Google Docs Renderer/i.test(text)) return null;
  return text.length > 420 ? `${text.slice(0, 420).trim()}...` : text;
}

export async function findCandidates(query: string, filters: TalentSearchFilters = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const params: unknown[] = [query, `%${query}%`, expandedSearchTerms(query), `%${normalizedQuery}%`];
  let where = "WHERE c.duplicate_of IS NULL";
  if (filters.activeOnly !== false) where += " AND c.status='active'";
  if (filters.seniority) {
    params.push(filters.seniority);
    where += ` AND c.ai_seniority = $${params.length}`;
  }
  if (filters.source?.length) {
    params.push(filters.source);
    where += ` AND EXISTS (SELECT 1 FROM candidate_sources cs WHERE cs.candidate_id=c.id AND cs.source_type = ANY($${params.length}))`;
  }
  const searchText = "coalesce(c.full_name,'') || ' ' || coalesce(c.current_role,'') || ' ' || coalesce(c.ai_summary,'') || ' ' || coalesce(array_to_string(c.ai_tags,' '),'') || ' ' || coalesce(doc.text,'')";
  const normalizedSearchText = normalizedSqlText(searchText);
  const { rows } = await q(
    `SELECT c.*,
      coalesce(src.source_count, 0)::int AS source_count,
      coalesce(doc.document_count, 0)::int AS document_count,
      doc.primary_document_name,
      left(coalesce(doc.text, ''), 1200) AS document_snippet,
      ts_rank_cd(to_tsvector('spanish', ${searchText}), plainto_tsquery('spanish', $1)) AS rank
     FROM candidates c
     LEFT JOIN LATERAL (
       SELECT
         string_agg(coalesce(d.raw_text,'') || ' ' || coalesce(d.file_name,''), ' ') AS text,
         count(*)::int AS document_count,
         (array_agg(d.file_name ORDER BY d.is_primary_cv DESC, d.created_at DESC))[1] AS primary_document_name
       FROM documents d
       WHERE d.candidate_id = c.id
     ) doc ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS source_count
       FROM candidate_sources cs
       WHERE cs.candidate_id = c.id
     ) src ON true
     ${where}
       AND coalesce(doc.document_count, 0) > 0
       AND (
         to_tsvector('spanish', ${searchText}) @@ plainto_tsquery('spanish', $1)
         OR c.full_name ILIKE $2
         OR coalesce(c.current_role,'') ILIKE $2
         OR coalesce(c.ai_summary,'') ILIKE $2
         OR array_to_string(c.ai_tags,' ') ILIKE $2
         OR coalesce(doc.text,'') ILIKE $2
         OR ${normalizedSearchText} ILIKE $4
         OR EXISTS (
           SELECT 1
           FROM unnest($3::text[]) term
           WHERE ${searchText} ILIKE term OR ${normalizedSearchText} ILIKE term
         )
       )
     ORDER BY rank DESC, c.quality_score DESC, c.updated_at DESC
     LIMIT 20`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    currentRole: row.current_role,
    city: row.city,
    country: row.country,
    seniority: row.ai_seniority,
    years: row.ai_seniority_years,
    tags: row.ai_tags ?? [],
    email: cleanResultContacts(row.email, 2),
    phone: cleanResultContacts(row.phone, 2),
    summary: cleanResultSummary(row.ai_summary),
    qualityScore: row.quality_score,
    sourceCount: Number(row.source_count ?? 0),
    documentCount: Number(row.document_count ?? 0),
    primaryDocumentName: row.primary_document_name ?? null,
    documentSnippet: row.document_snippet ?? null,
    score: Math.min(100, Math.max(0, Math.round((Number(row.rank) * 60) + (row.quality_score * 0.4)))),
    matchReason: row.rank > 0 ? "Coincide por texto, rol, competencias o resumen registrado." : "Sin coincidencia semantica directa; ordenado por calidad del perfil."
  }));
}

const intelligenceEngine = new RecruitmentIntelligenceEngine(findCandidates);

export async function searchTalent(query: string, filters: TalentSearchFilters = {}) {
  return intelligenceEngine.search(query, filters);
}

searchRouter.post("/talent", asyncHandler(async (req, res) => {
  const body = searchSchema.parse(req.body);
  const syncResults = body.refreshSources ? await syncConnectedIntegrations() : [];
  await q("INSERT INTO saved_searches (user_id, query, filters) VALUES ($1,$2,$3)", [req.user!.id, body.query, JSON.stringify(body.filters)]);
  const result = await searchTalent(body.query, body.filters);
  res.json({
    data: result.data,
    query: result.query,
    explanation: result.explanation,
    mode: result.mode,
    sync: {
      ran: body.refreshSources,
      sources: syncResults.length,
      imported: syncResults.reduce((sum: number, row: any) => sum + Number(row.new_records ?? 0) + Number(row.updated_records ?? 0), 0),
      errors: syncResults.reduce((sum: number, row: any) => sum + Number(row.errors ?? 0), 0)
    }
  });
}));
