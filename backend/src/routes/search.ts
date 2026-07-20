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
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(10).max(100).optional().default(50),
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
    moza: ["mozo", "gastronomia", "gastronomía", "restaurante"],
    liderazgo: ["lider", "líder", "jefe", "supervisor", "coordinador", "encargado", "gerente", "team leader", "manejo de equipos"],
    organizacion: ["organización", "planificacion", "planificación", "coordinacion", "coordinación", "gestion", "gestión"],
    comunicacion: ["comunicación", "trato con clientes", "atencion al cliente", "atención al cliente", "relaciones interpersonales"],
    negociacion: ["negociación", "ventas", "comercial", "compras", "cuentas"],
    administrativo: ["administrativa", "administracion", "administración", "auxiliar administrativo", "back office", "oficina"],
    administracion: ["administración", "administrativo", "administrativa", "auxiliar administrativo", "back office", "oficina"],
    logistica: ["logística", "deposito", "depósito", "almacen", "almacén", "inventario", "distribucion", "distribución", "supply chain"],
    contable: ["contador", "contadora", "contabilidad", "finanzas", "tesoreria", "tesorería", "facturacion", "facturación"],
    marketing: ["mercadeo", "comunicacion", "comunicación", "redes sociales", "contenido", "publicidad"],
    tecnologia: ["tecnología", "sistemas", "software", "informatica", "informática", "it", "soporte tecnico", "soporte técnico"],
    mantenimiento: ["mecanica", "mecánica", "electromecanica", "electromecánica", "tecnico", "técnico"],
    compras: ["abastecimiento", "procurement", "proveedores", "negociacion", "negociación"]
  };
  return [...new Set([normalizedQuery, ...words, ...words.flatMap((word) => extras[word] ?? [])].map(normalizeSearchText))]
    .filter(Boolean);
}

function expandedWebsearchQuery(query: string) {
  return expandedSearchTerms(query)
    .map((term) => `"${term.replace(/"/g, " ")}"`)
    .join(" OR ");
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
  const params: unknown[] = [query, expandedWebsearchQuery(query)];
  let candidateFilter = "c.duplicate_of IS NULL";
  if (filters.activeOnly !== false) candidateFilter += " AND c.status='active'";
  if (filters.seniority) {
    params.push(filters.seniority);
    candidateFilter += ` AND c.ai_seniority = $${params.length}`;
  }
  if (filters.source?.length) {
    params.push(filters.source);
    candidateFilter += ` AND EXISTS (SELECT 1 FROM candidate_sources cs WHERE cs.candidate_id=c.id AND cs.source_type = ANY($${params.length}))`;
  }
  const candidateText = "coalesce(c.full_name,'') || ' ' || coalesce(c.current_role,'') || ' ' || coalesce(c.ai_summary,'')";
  const candidateExpandedText = `${candidateText} || ' ' || coalesce(array_to_string(c.ai_tags,' '),'')`;
  const documentText = "coalesce(d.raw_text,'') || ' ' || coalesce(d.file_name,'')";
  const { rows } = await q(
    `WITH candidate_hits AS (
       SELECT c.id,
         greatest(
           CASE
             WHEN to_tsvector('spanish', ${candidateText}) @@ plainto_tsquery('spanish', $1)
             THEN 1 + ts_rank_cd(to_tsvector('spanish', ${candidateText}), plainto_tsquery('spanish', $1))
             ELSE 0
           END,
           0.02 + ts_rank_cd(to_tsvector('spanish', ${candidateExpandedText}), websearch_to_tsquery('spanish', $2))
         ) AS rank
       FROM candidates c
       WHERE ${candidateFilter}
         AND (
           to_tsvector('spanish', ${candidateText}) @@ plainto_tsquery('spanish', $1)
           OR to_tsvector('spanish', ${candidateExpandedText}) @@ websearch_to_tsquery('spanish', $2)
         )

       UNION ALL

       SELECT d.candidate_id AS id,
         max(greatest(
           CASE
             WHEN to_tsvector('spanish', ${documentText}) @@ plainto_tsquery('spanish', $1)
             THEN 1 + ts_rank_cd(to_tsvector('spanish', ${documentText}), plainto_tsquery('spanish', $1))
             ELSE 0
           END,
           0.02 + ts_rank_cd(to_tsvector('spanish', ${documentText}), websearch_to_tsquery('spanish', $2))
         )) AS rank
       FROM documents d
       JOIN candidates c ON c.id=d.candidate_id
       WHERE ${candidateFilter}
         AND (
           to_tsvector('spanish', ${documentText}) @@ plainto_tsquery('spanish', $1)
           OR to_tsvector('spanish', ${documentText}) @@ websearch_to_tsquery('spanish', $2)
         )
       GROUP BY d.candidate_id
     ), matched AS (
       SELECT id, max(rank) AS rank
       FROM candidate_hits
       GROUP BY id
     ), top_matches AS (
       SELECT m.id, m.rank
       FROM matched m
       JOIN candidates c ON c.id=m.id
       WHERE EXISTS (SELECT 1 FROM documents available_doc WHERE available_doc.candidate_id=c.id)
       ORDER BY m.rank DESC, c.quality_score DESC, c.updated_at DESC
     )
     SELECT c.*,
      coalesce(src.source_count, 0)::int AS source_count,
      coalesce(src.source_types, '{}'::text[]) AS source_types,
      coalesce(doc.document_count, 0)::int AS document_count,
      doc.primary_document_name,
      doc.primary_document_id,
      doc.primary_document_mime_type,
      doc.primary_document_source_type,
      left(coalesce(doc.document_snippet, ''), 1200) AS document_snippet,
      top_matches.rank
     FROM top_matches
     JOIN candidates c ON c.id=top_matches.id
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS document_count,
         (array_agg(d.file_name ORDER BY
           (to_tsvector('spanish', ${documentText}) @@ websearch_to_tsquery('spanish', $2)) DESC,
           d.is_primary_cv DESC,
           d.created_at DESC
         ))[1] AS primary_document_name,
         (array_agg(d.id ORDER BY
           (to_tsvector('spanish', ${documentText}) @@ websearch_to_tsquery('spanish', $2)) DESC,
           d.is_primary_cv DESC,
           d.created_at DESC
         ))[1] AS primary_document_id,
         (array_agg(d.mime_type ORDER BY
           (to_tsvector('spanish', ${documentText}) @@ websearch_to_tsquery('spanish', $2)) DESC,
           d.is_primary_cv DESC,
           d.created_at DESC
         ))[1] AS primary_document_mime_type,
         (array_agg(d.source_type ORDER BY
           (to_tsvector('spanish', ${documentText}) @@ websearch_to_tsquery('spanish', $2)) DESC,
           d.is_primary_cv DESC,
           d.created_at DESC
         ))[1] AS primary_document_source_type,
         (array_agg(d.raw_text ORDER BY
           (to_tsvector('spanish', ${documentText}) @@ websearch_to_tsquery('spanish', $2)) DESC,
           d.is_primary_cv DESC,
           d.created_at DESC
         ) FILTER (WHERE nullif(d.raw_text, '') IS NOT NULL))[1] AS document_snippet
       FROM documents d
       WHERE d.candidate_id = c.id
     ) doc ON true
     LEFT JOIN LATERAL (
       SELECT count(DISTINCT source_type)::int AS source_count,
         array_agg(DISTINCT source_type ORDER BY source_type) AS source_types
       FROM candidate_sources cs
       WHERE cs.candidate_id = c.id
     ) src ON true
     ORDER BY top_matches.rank DESC, c.quality_score DESC, c.updated_at DESC`,
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
    sourceTypes: row.source_types ?? [],
    documentCount: Number(row.document_count ?? 0),
    primaryDocumentName: row.primary_document_name ?? null,
    primaryDocumentId: row.primary_document_id ?? null,
    primaryDocumentMimeType: row.primary_document_mime_type ?? null,
    primaryDocumentSourceType: row.primary_document_source_type ?? null,
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
  const offset = (body.page - 1) * body.pageSize;
  const pageData = result.data.slice(offset, offset + body.pageSize);
  res.json({
    data: pageData,
    query: result.query,
    explanation: result.explanation,
    mode: result.mode,
    meta: {
      total: result.data.length,
      returned: pageData.length,
      page: body.page,
      pageSize: body.pageSize,
      hasMore: offset + pageData.length < result.data.length
    },
    sync: {
      ran: body.refreshSources,
      sources: syncResults.length,
      imported: syncResults.reduce((sum: number, row: any) => sum + Number(row.new_records ?? 0) + Number(row.updated_records ?? 0), 0),
      errors: syncResults.reduce((sum: number, row: any) => sum + Number(row.errors ?? 0), 0)
    }
  });
}));
