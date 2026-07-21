import { Router } from "express";
import { z } from "zod";
import { q, qWithTimeout } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { RecruitmentIntelligenceEngine } from "../intelligence/intelligenceEngine.js";
import type { TalentSearchFilters } from "../intelligence/types.js";

export const searchRouter = Router();

const searchSchema = z.object({
  query: z.string().min(1),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(10).max(100).optional().default(50),
  filters: z.object({
    source: z.array(z.string()).optional(),
    seniority: z.string().optional(),
    location: z.string().trim().max(100).optional(),
    contact: z.enum(["email", "phone", "both"]).optional(),
    minScore: z.number().min(0).max(100).optional(),
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
  const ignoredWords = new Set(["busco", "buscar", "necesito", "persona", "alguien", "perfil", "candidato", "candidata", "con", "sin", "para", "experiencia", "experiencias", "tener", "tenga", "que", "una", "uno"]);
  const words = normalizedQuery.split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !ignoredWords.has(word));
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
    compras: ["abastecimiento", "procurement", "proveedores", "negociacion", "negociación"],
    chofer: ["conductor", "driver", "libreta profesional"],
    conductor: ["chofer", "driver", "libreta profesional"],
    ambulanciero: ["chofer de ambulancia", "conductor de ambulancia", "ambulancia", "traslado de pacientes"],
    ambulancia: ["chofer de ambulancia", "conductor de ambulancia", "ambulanciero", "emergencia movil", "emergencia médica", "traslado de pacientes"]
  };
  const terms = [...new Set([...words, ...words.flatMap((word) => extras[word] ?? [])].map(normalizeSearchText))]
    .filter(Boolean);
  return terms.length ? terms : [normalizedQuery];
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
    candidateFilter += ` AND EXISTS (SELECT 1 FROM candidate_sources cs WHERE cs.candidate_id=c.id AND cs.is_active=true AND cs.source_type = ANY($${params.length}))`;
  }
  if (filters.location) {
    params.push(`%${filters.location}%`);
    candidateFilter += ` AND (coalesce(c.city,'') ILIKE $${params.length} OR coalesce(c.country,'') ILIKE $${params.length})`;
  }
  if (filters.contact === "email") candidateFilter += " AND cardinality(coalesce(c.email, '{}'::text[])) > 0";
  if (filters.contact === "phone") candidateFilter += " AND cardinality(coalesce(c.phone, '{}'::text[])) > 0";
  if (filters.contact === "both") candidateFilter += " AND cardinality(coalesce(c.email, '{}'::text[])) > 0 AND cardinality(coalesce(c.phone, '{}'::text[])) > 0";
  const candidateText = "coalesce(c.full_name,'') || ' ' || coalesce(c.current_role,'') || ' ' || coalesce(c.ai_summary,'')";
  const documentText = "coalesce(d.raw_text,'') || ' ' || coalesce(d.file_name,'')";
  const { rows } = await qWithTimeout(
    `WITH search_terms AS MATERIALIZED (
       SELECT plainto_tsquery('spanish', $1) AS exact_query,
         websearch_to_tsquery('spanish', $2) AS broad_query
     ), candidate_hits AS (
       SELECT c.id,
         0.02 + ts_rank_cd(to_tsvector('spanish', ${candidateText}), search_terms.broad_query)
           + CASE WHEN to_tsvector('spanish', ${candidateText}) @@ search_terms.exact_query THEN 1 ELSE 0 END AS rank
       FROM candidates c CROSS JOIN search_terms
       WHERE ${candidateFilter}
         AND to_tsvector('spanish', ${candidateText}) @@ search_terms.broad_query

       UNION ALL

       SELECT d.candidate_id AS id,
         max(0.02 + ts_rank_cd(to_tsvector('spanish', ${documentText}), search_terms.broad_query)
           + CASE WHEN to_tsvector('spanish', ${documentText}) @@ search_terms.exact_query THEN 1 ELSE 0 END) AS rank
       FROM documents d
       JOIN candidates c ON c.id=d.candidate_id
       CROSS JOIN search_terms
       WHERE ${candidateFilter}
         AND to_tsvector('spanish', ${documentText}) @@ search_terms.broad_query
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
       LIMIT 1200
     )
     SELECT c.*,
      coalesce(src.source_count, 0)::int AS source_count,
      coalesce(src.source_types, '{}'::text[]) AS source_types,
      coalesce(doc_count.document_count, 0)::int AS document_count,
      primary_doc.file_name AS primary_document_name,
      primary_doc.id AS primary_document_id,
      primary_doc.mime_type AS primary_document_mime_type,
      primary_doc.source_type AS primary_document_source_type,
      left(coalesce(primary_doc.raw_text, ''), 1200) AS document_snippet,
      top_matches.rank
     FROM top_matches
     JOIN candidates c ON c.id=top_matches.id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS document_count
       FROM documents d
       WHERE d.candidate_id = c.id
     ) doc_count ON true
     LEFT JOIN LATERAL (
       SELECT d.id, d.file_name, d.mime_type, d.source_type, d.raw_text
       FROM documents d
       WHERE d.candidate_id = c.id
       ORDER BY d.is_primary_cv DESC, d.created_at DESC
       LIMIT 1
     ) primary_doc ON true
     LEFT JOIN LATERAL (
       SELECT count(DISTINCT source_type)::int AS source_count,
         array_agg(DISTINCT source_type ORDER BY source_type) AS source_types
       FROM candidate_sources cs
       WHERE cs.candidate_id = c.id AND cs.is_active=true
     ) src ON true
     ORDER BY top_matches.rank DESC, c.quality_score DESC, c.updated_at DESC`,
    params,
    9_000
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
  await q("INSERT INTO saved_searches (user_id, query, filters) VALUES ($1,$2,$3)", [req.user!.id, body.query, JSON.stringify(body.filters)]);
  let result;
  try {
    result = await searchTalent(body.query, body.filters);
  } catch (error: any) {
    if (error?.code === "57014") return res.status(503).json({ error: "La búsqueda demoró demasiado. Probá con un cargo o competencia más específica." });
    throw error;
  }
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
    }
  });
}));
