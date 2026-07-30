import type { InterpretedTalentQuery, TalentCandidateResult } from "./types.js";
import { extractCvResidence } from "../services/cvAnalysis.js";
import { evaluateUruguayProximity, findUruguayPlace, normalizePlaceName } from "./uruguayGeography.js";

function normalizeSearchValue(value: string) {
  return value.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCredibleCandidateName(value: string) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 4 || name.length > 90 || /[@\d]|https?:|www\.|:/.test(name)) return false;
  if (/\b(?:nombre|nombres|apellido|apellidos|sitio|website|site)\b/i.test(name)) return false;
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 8) return false;
  if (!words.every((word) => /^[\p{L}'-]+$/u.test(word))) return false;
  const place = findUruguayPlace(name);
  if (place && normalizePlaceName(place.name) === normalizePlaceName(name)) return false;
  const genericRoleWords = new Set([
    "administrativo", "administrativa", "auxiliar", "ayudante", "chofer", "conductor",
    "contable", "deposito", "encargado", "encargada", "experiencia", "fabrica", "general",
    "laboral", "operario", "operaria", "operador", "operadora", "practico", "practica",
    "profesional", "repositor", "repositora", "tecnico", "tecnica", "vendedor", "vendedora"
  ]);
  const normalizedWords = words.map(normalizeSearchValue);
  if (normalizedWords.every((word) => genericRoleWords.has(word))) return false;
  return !/(sin t[ií]tulo|sin nombre|preparaci[oó]n|entrega de|[oó]rdenes|experiencia en|responsable de|tareas de|funciones|perfil profesional|objetivo laboral|curr[ií]culum|curriculum vitae|postulaci[oó]n|futuras vacantes)/i.test(name);
}

const EQUIVALENT_TERMS: Record<string, string[]> = {
  "maquinista de refrigeracion": ["tecnico en refrigeracion", "tecnico frigorista", "frigorista", "refrigeracion industrial", "operador de sala de maquinas"],
  "tecnico en refrigeracion": ["maquinista de refrigeracion", "tecnico frigorista", "frigorista", "refrigeracion industrial", "aire acondicionado"],
  "tecnico frigorista": ["frigorista", "tecnico en refrigeracion", "refrigeracion industrial"],
  frigorista: ["tecnico frigorista", "tecnico en refrigeracion", "refrigeracion industrial"],
  "refrigeracion industrial": ["refrigeracion", "frigorista", "sistemas de refrigeracion", "equipos de frio", "maquinas de frio", "camara de frio", "camaras frigorificas", "aire acondicionado", "hvac"],
  "mantenimiento industrial": ["mantenimiento preventivo", "mantenimiento correctivo", "mantenimiento de equipos", "mantenimiento de maquinas", "reparacion de equipos"],
  "refrigerantes industriales": ["freon", "nh3", "amoniaco", "gas refrigerante", "gases refrigerantes"],
  "auxiliar administrativo": ["administrativo", "administrativa", "asistente administrativo", "asistente administrativa", "back office"],
  "chofer de ambulancia": ["conductor de ambulancia", "ambulanciero", "traslado de pacientes", "emergencia movil"],
  "conductor de ambulancia": ["chofer de ambulancia", "ambulanciero", "traslado de pacientes", "emergencia movil"],
  ambulanciero: ["chofer de ambulancia", "conductor de ambulancia", "traslado de pacientes"],
  chofer: ["conductor", "driver"],
  conductor: ["chofer", "driver"],
  ambulancia: ["emergencia movil", "emergencia medica", "traslado de pacientes"],
  abogado: ["abogada", "legal", "derecho", "juridico", "asesor legal", "asesora legal"],
  abogada: ["abogado", "legal", "derecho", "juridico", "asesor legal", "asesora legal"],
  legal: ["abogado", "abogada", "derecho", "juridico"],
  ingles: ["english", "idioma ingles", "nivel ingles"],
  english: ["ingles", "idioma ingles"],
  ventas: ["vendedor", "vendedora", "comercial", "ejecutivo comercial", "ejecutiva comercial"],
  vendedor: ["vendedora", "ventas", "comercial", "ejecutivo comercial", "venta de terreno", "ventas de terreno"],
  "vendedor de terreno": ["vendedora de terreno", "venta de terreno", "ventas de terreno", "vendedor viajante", "ejecutivo comercial", "preventista"],
  "ventas de terreno": ["venta de terreno", "vendedor de terreno", "vendedora de terreno", "visitas comerciales", "venta directa", "preventista"],
  "gestion de cartera": ["cartera de clientes", "manejo de cartera", "desarrollo de clientes", "gestion de cuentas"],
  "consumo masivo": ["fmcg", "retail", "supermercado", "distribucion", "productos de consumo"],
  gastronomia: ["gastonomia", "restaurante", "cocina", "mozo", "moza", "atencion al cliente"],
  gastonomia: ["gastronomia", "restaurante", "cocina", "mozo", "moza"],
  logistica: ["logistica y produccion", "logistica y produccion", "deposito", "almacen"],
  deposito: ["deposito", "almacen", "logistica", "stock", "inventario", "auxiliar de deposito", "operario de deposito"],
  "carga y descarga": ["carga", "descarga", "mercaderia", "contenedores", "deposito", "logistica", "peon"],
  "control de mercaderia": ["control de stock", "inventario", "verificacion", "mercaderia", "contenedores", "recepcion", "despacho"],
  "control documental": ["documentacion", "documentos", "remitos", "facturas", "archivo", "control administrativo"],
  pesaje: ["balanza", "control de peso", "pesaje de mercaderia"],
  "operativa portuaria": ["puerto", "portuario", "contenedores", "terminal de cargas", "deposito", "logistica"],
  apuntador: ["verificador", "controlador de deposito", "auxiliar de deposito", "control de mercaderia", "administrativo de deposito"],
  seleccion: ["reclutamiento", "recursos humanos", "rrhh"],
  liderazgo: ["lider", "jefe", "supervisor", "coordinador", "encargado", "gerente", "team leader", "manejo de equipos", "personal a cargo"],
  organizacion: ["organizacion", "planificacion", "coordinacion", "gestion del tiempo", "seguimiento"],
  comunicacion: ["comunicacion", "trato con clientes", "atencion al cliente", "relaciones interpersonales"],
  negociacion: ["negociacion", "cierre de ventas", "manejo de cuentas", "desarrollo de clientes"],
  "resolucion de problemas": ["resolver problemas", "analitico", "pensamiento critico", "toma de decisiones"],
  adaptabilidad: ["flexibilidad", "entorno dinamico", "trabajo bajo presion"],
  "trabajo en equipo": ["colaboracion", "colaborativo", "equipos multidisciplinarios"],
  supermercado: ["retail", "cajero", "cajera", "repositor", "repositora", "operario", "operaria", "auxiliar", "deposito", "stock", "atencion al cliente"],
  operario: ["operaria", "operador", "operadora", "produccion", "manufactura", "linea de produccion", "auxiliar de produccion", "peon", "maquinista", "envasado", "empaque"],
  operaria: ["operario", "operador", "operadora", "produccion", "manufactura", "linea de produccion", "auxiliar de produccion", "peon", "maquinista", "envasado", "empaque"],
  operador: ["operario", "operaria", "operadora", "produccion", "manufactura", "maquinista", "linea de produccion"],
  operadora: ["operario", "operaria", "operador", "produccion", "manufactura", "maquinista", "linea de produccion"],
  fabrica: ["produccion", "manufactura", "industria", "linea de produccion", "planta industrial", "envasado", "empaque", "control de calidad"],
  "guardia de seguridad": ["vigilante", "vigilancia", "seguridad fisica", "seguridad"],
  vigilante: ["guardia de seguridad", "vigilancia", "seguridad fisica"],
  repositor: ["repositora", "reposicion", "supermercado", "retail"],
  repositora: ["repositor", "reposicion", "supermercado", "retail"],
  cajero: ["cajera", "manejo de caja", "arqueo de caja", "pos"],
  cajera: ["cajero", "manejo de caja", "arqueo de caja", "pos"],
  "auxiliar de deposito": ["operario de deposito", "peon de deposito", "picking", "packing", "preparacion de pedidos", "stock"],
  recepcionista: ["recepcion", "atencion telefonica", "atencion al cliente"],
  electricista: ["electricidad", "electricidad industrial", "instalaciones electricas"],
  mecanico: ["mecanica", "mecanica automotriz", "mantenimiento mecanico"],
  soldador: ["soldadora", "soldadura", "mig", "mag", "tig"],
  enfermero: ["enfermera", "enfermeria", "auxiliar de enfermeria"],
  enfermera: ["enfermero", "enfermeria", "auxiliar de enfermeria"],
  cuidador: ["cuidadora", "cuidados", "acompanante terapeutico", "cuidado de pacientes"],
  cuidadora: ["cuidador", "cuidados", "acompanante terapeutica", "cuidado de pacientes"],
  psicologo: ["psicologa", "psicologia", "licenciado en psicologia"],
  psicologa: ["psicologo", "psicologia", "licenciada en psicologia"],
  "auxiliar de farmacia": ["idoneo en farmacia", "farmacia", "farmaceutico"],
  "call center": ["contact center", "telemarketer", "telemarketing", "operador telefonico"],
  autoelevador: ["montacargas", "forklift"],
  montacargas: ["autoelevador", "forklift"],
  "preparacion de pedidos": ["picking", "deposito", "logistica"],
  "libreta profesional": ["licencia profesional", "libreta categoria c", "libreta categoria d", "libreta categoria e", "libreta categoria f"],
  cobranzas: ["cobranza", "gestion de morosos", "recuperacion de deuda"],
  "liquidacion de sueldos": ["nomina", "payroll", "bops"],
  "ciudad de la costa": ["solymar", "lagomar", "el pinar", "lomas de solymar", "medanos de solymar", "shangrila", "shangri la", "san jose de carrasco", "barra de carrasco"]
};

function equivalentValues(value: string) {
  const normalized = normalizeSearchValue(value);
  return [normalized, ...(EQUIVALENT_TERMS[normalized] ?? [])].map(normalizeSearchValue);
}

function includesAny(text: string, values: string[]) {
  const normalizedText = normalizeSearchValue(text);
  return values.some((value) => {
    const variants = equivalentValues(value);
    if (variants.some((variant) => normalizedText.includes(variant))) return true;
    const normalized = normalizeSearchValue(value);
    if (/[oa]$/.test(normalized)) return normalizedText.includes(`${normalized.slice(0, -1)}a`) || normalizedText.includes(`${normalized.slice(0, -1)}o`);
    return false;
  });
}

function candidateHaystack(candidate: TalentCandidateResult) {
  return [
    candidate.fullName,
    candidate.currentRole ?? "",
    candidate.city ?? "",
    candidate.country ?? "",
    candidate.summary ?? "",
    (candidate.email ?? []).join(" "),
    (candidate.phone ?? []).join(" "),
    (candidate.tags ?? []).join(" "),
    candidate.seniority ?? "",
    candidate.primaryDocumentName ?? "",
    candidate.documentSnippet ?? ""
  ].join(" ");
}

function candidateProfileText(candidate: TalentCandidateResult) {
  return [
    candidate.currentRole ?? "",
    (candidate.tags ?? []).join(" "),
    candidate.city ?? "",
    candidate.country ?? ""
  ].join(" ");
}

function recencyBonus(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 4;
  if (ageDays <= 365) return 2;
  return 0;
}

function primaryRoleMatches(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const requestedAreas = [...interpreted.roles, ...interpreted.skills, ...interpreted.industries];
  return requestedAreas.length === 0 || includesAny(candidate.currentRole ?? "", requestedAreas);
}

function conceptMatchesProfile(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery, concept: string) {
  if (interpreted.roles.some((role) => normalizeSearchValue(role) === normalizeSearchValue(concept))) {
    return includesAny(candidate.currentRole ?? "", [concept]);
  }
  return includesAny(candidateProfileText(candidate), [concept]);
}

function requestedConcepts(interpreted: InterpretedTalentQuery) {
  const values = [
    ...interpreted.roles,
    ...interpreted.skills,
    ...interpreted.languages,
    ...interpreted.industries,
    ...interpreted.locations,
    ...interpreted.keywords
  ];
  const byNormalized = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeSearchValue(value);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, value);
  }
  return [...byNormalized.values()];
}

function satisfiesResidualKeywords(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (!interpreted.keywords.length) return true;
  const haystack = candidateHaystack(candidate);
  const normalizedQuery = normalizeSearchValue(interpreted.originalQuery);
  const detailedDescription = normalizedQuery.length >= 180
    || /\b(?:tareas?|funciones?|responsabilidades?|horario|requisitos?)\s*:/.test(normalizedQuery)
    || normalizedQuery.split(/[.;\n]+/).filter((part) => part.trim().length > 20).length >= 3;
  if (detailedDescription) {
    if (interpreted.requiredGroups.length) return true;
    const matched = interpreted.keywords.filter((keyword) => includesAny(haystack, [keyword])).length;
    return matched >= Math.min(2, interpreted.keywords.length);
  }
  return interpreted.keywords.every((keyword) => includesAny(haystack, [keyword]));
}

function conceptMatchesText(text: string, interpreted: InterpretedTalentQuery, concept: string) {
  const isSpecializedRole = interpreted.requiredGroups.length > 1
    && interpreted.roles.some((role) => normalizeSearchValue(role) === normalizeSearchValue(concept));
  if (isSpecializedRole) return interpreted.requiredGroups.every((group) => includesAny(text, group));
  return includesAny(text, [concept]);
}

function isAmbulanceDriverQuery(interpreted: InterpretedTalentQuery) {
  return interpreted.roles.some((role) => ["chofer de ambulancia", "conductor de ambulancia", "ambulanciero"]
    .includes(normalizeSearchValue(role)));
}

function isAdministrativeWarehouseQuery(interpreted: InterpretedTalentQuery) {
  const concepts = [...interpreted.roles, ...interpreted.skills].map(normalizeSearchValue);
  return interpreted.requiredGroups.length > 1
    && concepts.some((concept) => ["auxiliar de deposito", "apuntador", "control documental", "control de mercaderia"].includes(concept))
    && interpreted.requiredGroups.some((group) => group.some((value) => /\b(?:deposito|almacen|logistica|stock|mercaderia|contenedor|puerto)\b/.test(normalizeSearchValue(value))));
}

function isIndustrialRefrigerationQuery(interpreted: InterpretedTalentQuery) {
  return [...interpreted.roles, ...interpreted.skills]
    .some((concept) => /\b(?:refrigeracion|frigorista|maquinas? de frio|refrigerantes industriales)\b/.test(normalizeSearchValue(concept)));
}

function industrialRefrigerationFit(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (!isIndustrialRefrigerationQuery(interpreted)) return 0;
  const role = normalizeSearchValue(candidate.currentRole ?? "");
  const evidence = normalizeSearchValue(candidateHaystack(candidate));
  const specializedRole = /\b(?:maquinista de refrigeracion|tecnico (?:en|de) refrigeracion|tecnico frigorista|frigorista|refrigerista)\b/.test(role);
  const industrialCold = /\b(?:refrigeracion industrial|sistemas? de refrigeracion|maquinas? de frio|equipos? de frio|generacion de frio|camaras? frigorificas?)\b/.test(evidence);
  const refrigerants = /\b(?:freon|nh3|amoniaco|gases? refrigerantes?)\b/.test(evidence);
  const maintenance = /\b(?:mantenimiento (?:industrial|preventivo|correctivo)|reparacion de (?:equipos|maquinas|sistemas))\b/.test(evidence);
  if (specializedRole && industrialCold && maintenance) return 6;
  if (specializedRole && maintenance) return 5;
  if (industrialCold && maintenance) return 4;
  if (industrialCold) return 3;
  if (refrigerants && maintenance) return 3;
  return 0;
}

function administrativeWarehouseFit(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (!isAdministrativeWarehouseQuery(interpreted)) return 0;
  const role = normalizeSearchValue(candidate.currentRole ?? "");
  const evidence = normalizeSearchValue([
    candidate.currentRole ?? "",
    (candidate.tags ?? []).join(" "),
    candidate.summary ?? "",
    candidate.documentSnippet ?? ""
  ].join(" "));
  const exactRole = /\b(?:apuntador|verificador(?: de (?:mercaderia|contenedores?|cargas?))?|controlador de (?:deposito|stock|mercaderia|cargas?)|administrativ[oa] (?:de|en) (?:deposito|logistica)|auxiliar administrativ[oa] (?:de|en) (?:deposito|logistica)|auxiliar de deposito)\b/.test(role);
  const targetExperience = /\b(?:apuntador|verificador(?: de (?:mercaderia|contenedores?|cargas?))?|control (?:de cargas?|de contenedores?)|pesaje de (?:mercaderia|cargas?|contenedores?))\b/.test(evidence);
  const relatedExperience = /\b(?:control (?:documental|de documentacion|de remitos)|administrativ[oa] (?:de|en) (?:deposito|logistica)|auxiliar administrativ[oa] (?:de|en) (?:deposito|logistica))\b/.test(evidence);
  const operationalRole = /\b(?:auxiliar|operari[oa]|peon|recepcionista|expedicion|despacho|deposito|almacen|stock|inventario|carga|descarga)\b/.test(role);
  const managerialRole = /\b(?:director(?:a)?|gerente|jefe|supervisor(?:a)?|coordinador(?:a)?|ingenier[oa])\b/.test(role);

  if (targetExperience) return 6;
  if (exactRole) return 5;
  if (relatedExperience && !managerialRole) return 4;
  if (operationalRole && !managerialRole) return 2;
  if (managerialRole) return -1;
  return 1;
}

function hasAmbulanceDriverEvidence(candidate: TalentCandidateResult) {
  const role = normalizeSearchValue(candidate.currentRole ?? "");
  if (/\b(?:chofer|conductor)\s+de\s+ambulancia\b|\bambulanciero\b/.test(role)) return true;

  const evidence = normalizeSearchValue([
    candidate.summary ?? "",
    candidate.documentSnippet ?? ""
  ].join(" "));
  if (/\b(?:chofer|conductor)\s+de\s+ambulancia\b|\bambulanciero\b/.test(evidence)) return true;

  const driver = "(?:chofer|conductor|driver|manejo|conduccion)";
  const medicalTransport = "(?:ambulancia|emergencia (?:movil|medica)|traslado de pacientes|transporte de pacientes)";
  const nearby = new RegExp(`\\b${driver}\\b.{0,100}\\b${medicalTransport}\\b|\\b${medicalTransport}\\b.{0,100}\\b${driver}\\b`);
  if (nearby.test(evidence)) return true;

  return includesAny(role, ["chofer", "conductor"])
    && /\b(?:traslado|transporte) de pacientes\b|\bambulancia\b|\bemergencia (?:movil|medica)\b/.test(evidence);
}

function coverage(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = candidateHaystack(candidate);
  const concepts = requestedConcepts(interpreted);
  const requestedLocations = new Set(interpreted.locations.map(normalizeSearchValue));
  const locationMatch = candidateLocationMatch(candidate, interpreted);
  const matchedConcepts = concepts.filter((concept) => {
    if (!requestedLocations.has(normalizeSearchValue(concept))) {
      return conceptMatchesText(haystack, interpreted, concept);
    }
    return locationMatch.matches && !["unknown", "broad"].includes(locationMatch.confidence);
  });
  return { required: concepts.length, matched: matchedConcepts.length, ratio: concepts.length ? matchedConcepts.length / concepts.length : 1, concepts, matchedConcepts };
}

const FACTORY_OPERATION_ROLE_PATTERN = /\b(?:operari[oa]|operador(?:a)?|auxiliar de producci[oó]n|pe[oó]n|maquinista|producci[oó]n|manufactura|l[ií]nea de producci[oó]n|envasad[oa]|empaquetad[oa]|armador(?:a)?|control de calidad)\b/i;
const EXPLICIT_FACTORY_EXPERIENCE_PATTERN = /\b(?:operari[oa]|operador(?:a)?|auxiliar de producci[oó]n|pe[oó]n|maquinista|l[ií]nea de producci[oó]n|envasad[oa]|empaquetad[oa]|armador(?:a)?|control de calidad|manejo de maquinarias?|operaci[oó]n de maquinarias?)\b/i;
const CLEARLY_NON_OPERATIONAL_ROLE_PATTERN = /\b(?:administrativ[oa]|contador(?:a)?|abogad[oa]|ingenier[oa]|arquitect[oa]|psic[oó]log[oa]|recursos humanos|marketing|comercial|ventas|secretari[oa])\b/i;

function hasFactoryOperationsRoleEvidence(candidate: TalentCandidateResult) {
  const currentRole = candidate.currentRole ?? "";
  if (!CLEARLY_NON_OPERATIONAL_ROLE_PATTERN.test(currentRole) && FACTORY_OPERATION_ROLE_PATTERN.test(currentRole)) return true;
  const cvEvidence = [candidate.summary ?? "", candidate.documentSnippet ?? ""].join(" ");
  if (EXPLICIT_FACTORY_EXPERIENCE_PATTERN.test(cvEvidence)) return true;
  return !currentRole.trim() && FACTORY_OPERATION_ROLE_PATTERN.test((candidate.tags ?? []).join(" "));
}

function satisfiesRequiredGroups(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (!interpreted.requiredGroups.length) return true;
  if (isAmbulanceDriverQuery(interpreted) && !hasAmbulanceDriverEvidence(candidate)) return false;
  const requiresOperationalRole = interpreted.roles
    .some((role) => ["operario", "operaria"].includes(normalizeSearchValue(role)));
  if (requiresOperationalRole && !hasFactoryOperationsRoleEvidence(candidate)) return false;
  const evidence = candidateHaystack(candidate);
  return interpreted.requiredGroups.every((group) => {
    if (isAmbulanceDriverQuery(interpreted)
      && (group.includes("ambulanciero") || group.includes("ambulancia"))) return true;
    return includesAny(evidence, group);
  });
}

function candidateResidence(candidate: TalentCandidateResult) {
  const cvResidence = extractCvResidence(candidate.documentSnippet ?? "");
  const structuredResidence = [candidate.city ?? "", candidate.country ?? ""].join(" ").trim();
  if (!cvResidence) return structuredResidence;

  const cvResidenceText = [cvResidence.city, cvResidence.country].filter(Boolean).join(" ");
  const cvPlace = findUruguayPlace(cvResidenceText);
  const structuredPlace = findUruguayPlace(structuredResidence);
  const cvIsBroader = cvPlace
    && structuredPlace
    && cvPlace.department === structuredPlace.department
    && normalizePlaceName(cvPlace.name) === normalizePlaceName(cvPlace.department)
    && normalizePlaceName(structuredPlace.name) !== normalizePlaceName(cvPlace.name);
  return cvIsBroader ? structuredResidence : cvResidenceText;
}

function candidateLocationMatch(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (!interpreted.locations.length) return { matches: true, distanceKm: null, confidence: "not_requested" as const };
  const residence = candidateResidence(candidate);
  if (!residence) return { matches: !interpreted.locationStrict, distanceKm: null, confidence: "unknown" as const };

  for (const requestedLocation of interpreted.locations) {
    const candidatePlace = findUruguayPlace(residence);
    const requestedPlace = findUruguayPlace(requestedLocation);
    const candidateIsBroadMontevideo = candidatePlace
      && requestedPlace
      && normalizePlaceName(candidatePlace.name) === "montevideo"
      && candidatePlace.department === requestedPlace.department;
    if (candidateIsBroadMontevideo) {
      return { matches: !interpreted.locationStrict, distanceKm: null, confidence: "broad" as const };
    }

    const proximity = evaluateUruguayProximity(residence, requestedLocation);
    if (proximity?.matches) return { matches: true, distanceKm: proximity.distanceKm, confidence: "nearby" as const };
  }

  const fallbackMatch = interpreted.locationGroups
    .some((group) => includesAny(residence, group));
  if (fallbackMatch) return { matches: true, distanceKm: null, confidence: "text" as const };

  const knownResidence = findUruguayPlace(residence);
  const knownRequestedLocation = interpreted.locations.some((location) => findUruguayPlace(location));
  return knownResidence && knownRequestedLocation
    ? { matches: false, distanceKm: null, confidence: "incompatible" as const }
    : { matches: !interpreted.locationStrict, distanceKm: null, confidence: "unknown" as const };
}

const BASIC_WORK_PATTERN = /\b(?:operari[oa]|cajer[oa]|repositor[oa]|auxiliar|pe[oó]n|deposito|dep[oó]sito|stock|almac[eé]n|limpieza|atenci[oó]n al cliente|ventas|mozo|moza|cocina|producci[oó]n|log[ií]stica|supermercado|retail)\b/i;
const PROFESSIONAL_ROLE_PATTERN = /\b(?:contador(?:a)?|abogad[oa]|ingenier[oa]|arquitect[oa]|m[eé]dic[oa]|psic[oó]log[oa]|licenciad[oa]|director(?:a)?|gerente|consultor(?:a) senior)\b/i;

function basicProfileSuitability(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (interpreted.profileLevel !== "basic") return { allowed: true, bonus: 0 };
  const role = candidate.currentRole ?? "";
  const evidence = [role, (candidate.tags ?? []).join(" "), candidate.summary ?? "", candidate.documentSnippet ?? ""].join(" ");
  const operationalEvidence = BASIC_WORK_PATTERN.test(evidence);
  const clearlyProfessional = PROFESSIONAL_ROLE_PATTERN.test(role)
    || /\b(?:contador(?:a)?|abogad[oa]|ingenier[oa]|arquitect[oa]|m[eé]dic[oa])\s+(?:p[uú]blic[oa]|recibid[oa]|titulad[oa])\b/i.test(evidence);
  return { allowed: !clearlyProfessional, bonus: operationalEvidence ? 12 : 0 };
}

export function explainCandidateMatch(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = candidateHaystack(candidate);
  const profileText = candidateProfileText(candidate);
  const resultCoverage = coverage(candidate, interpreted);
  const evidenceText = candidate.documentSnippet ?? "";
  const evidenceConcepts = resultCoverage.concepts.filter((concept) => conceptMatchesText(evidenceText, interpreted, concept));
  const reasons: string[] = [];
  if (interpreted.roles.length && primaryRoleMatches(candidate, interpreted)) reasons.push("área principal alineada");
  else if (interpreted.roles.length && includesAny(evidenceText, interpreted.roles)) reasons.push("el área aparece en el CV, pero no como perfil principal");
  if (interpreted.skills.length && includesAny(profileText, interpreted.skills)) reasons.push("competencias principales alineadas");
  else if (interpreted.skills.length && includesAny(evidenceText, interpreted.skills)) reasons.push("competencias mencionadas en el CV");
  if (interpreted.languages.length && includesAny(haystack, interpreted.languages)) reasons.push("idioma solicitado");
  const locationMatch = candidateLocationMatch(candidate, interpreted);
  if (interpreted.locations.length && locationMatch.matches) {
    if (locationMatch.distanceKm != null) reasons.push(`ubicación solicitada (a ${locationMatch.distanceKm} km)`);
    else if (locationMatch.confidence === "broad") reasons.push("vive en Montevideo, pero el barrio no está declarado");
    else if (locationMatch.confidence === "unknown") reasons.push("ubicación pendiente de verificar");
    else reasons.push("ubicación solicitada");
  } else if (interpreted.locations.length && locationMatch.confidence === "broad") {
    reasons.push("vive en Montevideo, pero falta confirmar el barrio");
  } else if (interpreted.locations.length && locationMatch.confidence === "unknown") {
    reasons.push("ubicación pendiente de verificar");
  }
  if (interpreted.seniority && normalizeSearchValue(haystack).includes(normalizeSearchValue(interpreted.seniority))) reasons.push("seniority compatible");
  const matched = resultCoverage.matchedConcepts.length ? resultCoverage.matchedConcepts.join(", ") : "coincidencia textual parcial";
  const evidence = evidenceConcepts.length ? " Evidencia encontrada en el CV." : " La coincidencia proviene de los datos indexados; conviene revisar el CV.";
  return `Coincide con: ${matched}.${reasons.length ? ` ${reasons.join(", ")}.` : ""}${evidence}`;
}

export function rerankCandidates(candidates: TalentCandidateResult[], interpreted: InterpretedTalentQuery) {
  const qualified = candidates
    .filter((candidate) => isCredibleCandidateName(candidate.fullName))
    .filter((candidate) => satisfiesRequiredGroups(candidate, interpreted))
    .filter((candidate) => satisfiesResidualKeywords(candidate, interpreted))
    .filter((candidate) => basicProfileSuitability(candidate, interpreted).allowed);
  const hasVerifiedLocationMatch = qualified.some((candidate) => {
    const location = candidateLocationMatch(candidate, interpreted);
    return location.matches && !["unknown", "broad"].includes(location.confidence);
  });
  const allowUnverifiedLocationFallback = interpreted.locationStrict
    && interpreted.locations.length > 0
    && !hasVerifiedLocationMatch;

  return qualified
    .filter((candidate) => {
      if (!interpreted.locationStrict) return true;
      const location = candidateLocationMatch(candidate, interpreted);
      return location.matches
        || (allowUnverifiedLocationFallback && ["unknown", "broad"].includes(location.confidence));
    })
    .map((candidate) => {
      const locationMatch = candidateLocationMatch(candidate, interpreted);
      const conceptCoverage = coverage(candidate, interpreted);
      const documentText = candidate.documentSnippet ?? "";
      const requestedLocations = new Set(interpreted.locations.map(normalizeSearchValue));
      const documentMatches = conceptCoverage.concepts
        .filter((concept) => !requestedLocations.has(normalizeSearchValue(concept)))
        .filter((concept) => conceptMatchesText(documentText, interpreted, concept))
        .length;
      const documentRatio = conceptCoverage.required ? documentMatches / conceptCoverage.required : 0;
      const profileText = candidateProfileText(candidate);
      const profileMatches = conceptCoverage.concepts.filter((concept) => conceptMatchesProfile(candidate, interpreted, concept)).length;
      const profileRatio = conceptCoverage.required ? profileMatches / conceptCoverage.required : 0;
      const hasContact = Boolean(candidate.email?.length || candidate.phone?.length);
      const warehouseFit = administrativeWarehouseFit(candidate, interpreted);
      const refrigerationFit = industrialRefrigerationFit(candidate, interpreted);
      const seniorityMatch = interpreted.seniority
        ? normalizeSearchValue(candidateHaystack(candidate)).includes(normalizeSearchValue(interpreted.seniority))
        : true;
      const rawScore = Math.min(100, Math.max(0, Math.round(
        conceptCoverage.ratio * 55
        + documentRatio * 25
        + profileRatio * 10
        + ((candidate.documentCount ?? 0) > 0 ? 5 : 0)
        + (hasContact ? 5 : 0)
        + (interpreted.seniority && seniorityMatch ? 5 : 0)
        + (locationMatch.distanceKm == null ? 0 : Math.max(0, 12 - locationMatch.distanceKm * 0.5))
        + (locationMatch.confidence === "broad" ? 2 : 0)
        - (locationMatch.confidence === "unknown" ? 5 : 0)
        + recencyBonus(candidate.latestSourceAt)
        + basicProfileSuitability(candidate, interpreted).bonus
        + (warehouseFit >= 6 ? 24 : warehouseFit === 5 ? 20 : warehouseFit === 4 ? 14 : warehouseFit === 2 ? 6 : warehouseFit < 0 ? -16 : 0)
        + (refrigerationFit >= 6 ? 24 : refrigerationFit === 5 ? 20 : refrigerationFit === 4 ? 16 : refrigerationFit === 3 ? 10 : 0)
      )));
      const primaryAligned = primaryRoleMatches(candidate, interpreted);
      const exactSpecializedRole = isAmbulanceDriverQuery(interpreted) && primaryAligned;
      const roleScore = exactSpecializedRole
        ? Math.max(98, rawScore)
        : interpreted.roles.length > 0 && !primaryAligned
          ? Math.min(69, rawScore)
          : rawScore;
      const locationVerified = !interpreted.locations.length
        || (locationMatch.matches && !["unknown", "broad"].includes(locationMatch.confidence));
      const score = interpreted.locationStrict && !locationVerified
        ? Math.min(69, roleScore)
        : roleScore;
      return {
        ...candidate,
        matchDistanceKm: locationMatch.distanceKm,
        score,
        matchReason: explainCandidateMatch({ ...candidate, score }, interpreted),
        matchCoverage: conceptCoverage,
        primaryRoleAligned: primaryAligned,
        warehouseFit,
        refrigerationFit
      };
    })
    .sort((a, b) => b.refrigerationFit - a.refrigerationFit
      || b.warehouseFit - a.warehouseFit
      || Number(b.primaryRoleAligned) - Number(a.primaryRoleAligned)
      || (b.matchCoverage?.ratio ?? 0) - (a.matchCoverage?.ratio ?? 0)
      || b.score - a.score
      || b.qualityScore - a.qualityScore)
    .map(({ matchCoverage, primaryRoleAligned, warehouseFit, refrigerationFit, ...candidate }) => candidate);
}
