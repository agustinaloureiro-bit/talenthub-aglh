export type CandidateNameEvidence = {
  value: string;
  source: "cv_label" | "cv_heading" | "file_name" | "sender" | "email" | "structured";
  confidence: number;
};

type NameCleaner = (value: string) => string;
type NameValidator = (value: string) => boolean;

const SECTION_HEADING = /^(?:curr[ií]culum(?: vitae)?|resume|perfil(?: profesional)?|datos personales|informaci[oó]n personal|contacto|experiencia(?: laboral| profesional)?|formaci[oó]n|educaci[oó]n|estudios|habilidades|competencias|idiomas|referencias)(?:\s*:)?$/i;
const FIELD_LINE = /^(?:nombre|name|candidato|postulante|fecha de nacimiento|nacimiento|domicilio|direcci[oó]n|address|c[eé]dula|documento|tel[eé]fono|celular|email|correo|nacionalidad|estado civil)\s*[:\-]/i;

function frontMatterLines(value: string) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .split(/\n+|\s*[|•]\s*/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 35);
}

function collapseRepeatedName(value: string) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 4 && words.length % 2 === 0) {
    const middle = words.length / 2;
    const left = normalizedCandidateName(words.slice(0, middle).join(" "));
    const right = normalizedCandidateName(words.slice(middle).join(" "));
    if (left === right) return words.slice(0, middle).join(" ");
  }
  return value;
}

export function extractCandidateNameEvidence(text: string, clean: NameCleaner, isValid: NameValidator): CandidateNameEvidence | null {
  const lines = frontMatterLines(text);
  for (const line of lines.slice(0, 20)) {
    const labeled = line.match(/^(?:nombre(?: completo)?|name|candidato|postulante)(?:\s*[:\-]\s*|\s+)(.+)$/i)?.[1];
    const value = collapseRepeatedName(clean(labeled ?? ""));
    if (value && isValid(value)) return { value, source: "cv_label", confidence: 100 };
  }

  for (const [index, line] of lines.entries()) {
    if (index > 14) break;
    if (SECTION_HEADING.test(line) || FIELD_LINE.test(line)) continue;
    if (/@|https?:|www\.|\+?\d{5,}/i.test(line)) continue;
    if (/[.!?;]$/.test(line) || line.length > 90) continue;
    const value = collapseRepeatedName(clean(line));
    if (value && isValid(value)) {
      return { value, source: "cv_heading", confidence: index <= 4 ? 95 : 90 };
    }
  }
  return null;
}

export function normalizedCandidateName(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameCompleteness(value: string) {
  const words = normalizedCandidateName(value).split(/\s+/).filter(Boolean);
  return words.length * 10 + Math.min(20, String(value ?? "").length / 4);
}

export function chooseCanonicalCandidateName(
  storedName: string | null | undefined,
  incomingName: string | null | undefined,
  incomingConfidence = 70
) {
  const stored = String(storedName ?? "").trim();
  const incoming = String(incomingName ?? "").trim();
  if (!stored) return incoming;
  if (!incoming) return stored;

  const storedNormalized = normalizedCandidateName(stored);
  const incomingNormalized = normalizedCandidateName(incoming);
  if (storedNormalized === incomingNormalized) {
    return nameCompleteness(incoming) > nameCompleteness(stored) ? incoming : stored;
  }

  const storedWords = storedNormalized.split(/\s+/).filter(Boolean);
  const incomingWords = incomingNormalized.split(/\s+/).filter(Boolean);
  const samePersonVariant = storedWords.every((word) => incomingWords.includes(word))
    || incomingWords.every((word) => storedWords.includes(word));
  if (samePersonVariant) return nameCompleteness(incoming) > nameCompleteness(stored) ? incoming : stored;

  // Confidence alone is not enough to replace a conflicting identity. A CV
  // can contain names of references, recruiters or relatives near its header.
  return stored;
}

export function candidateNameConfidence(raw: Record<string, unknown> | null | undefined) {
  const identity = raw?.identity;
  if (!identity || typeof identity !== "object") return 70;
  const confidence = Number((identity as Record<string, unknown>).nameConfidence);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 70;
}

function nameWords(value: string) {
  return normalizedCandidateName(value)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !["del", "las", "los"].includes(word));
}

export function emailSupportsCandidateName(name: string, emails: string[]) {
  const words = nameWords(name);
  if (!words.length) return false;
  return emails.some((email) => {
    const local = String(email).split("@")[0]?.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() ?? "";
    return words.some((word) => local.includes(word));
  });
}

export function shouldReplaceCandidateName(
  storedName: string,
  evidence: CandidateNameEvidence,
  emails: string[],
  isValid: NameValidator
) {
  const stored = String(storedName ?? "").trim();
  if (!stored || !isValid(stored)) return true;
  const canonical = chooseCanonicalCandidateName(stored, evidence.value, 89);
  if (canonical !== stored) return true;
  return (evidence.source === "cv_label" || evidence.source === "cv_heading")
    && emailSupportsCandidateName(evidence.value, emails)
    && !emailSupportsCandidateName(stored, emails);
}
