import type { CandidateImport } from "../agents/types.js";
import { analyzeCvText } from "./cvAnalysis.js";
import { selectCandidateEmails } from "./candidateIdentity.js";

function unique(values: string[]) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

export function humanCandidateField(value: unknown) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(cleaned) ? cleaned : null;
}

export function extractCvCandidateEvidence(rawText: string, fullName?: string | null) {
  const text = String(rawText ?? "");
  const analysis = analyzeCvText(text);
  const emails = selectCandidateEmails(
    unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((email) => email.toLowerCase()),
    fullName
  );
  const phones = unique(text.match(/(?:\+?598\s?)?(?:0?9\d|2\d|4\d)[\s.-]?\d{3}[\s.-]?\d{3,4}/g) ?? [])
    .filter((phone) => {
      const digits = phone.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 11 && !/^0+$/.test(digits);
    })
    .slice(0, 2);
  return { analysis, emails, phones };
}

export function enrichCandidateFromCv(candidate: CandidateImport) {
  const rawText = String(candidate.documents?.find((document) => document.isPrimaryCv && document.rawText)?.rawText
    ?? candidate.documents?.find((document) => document.rawText)?.rawText
    ?? "");
  if (!rawText) return candidate;

  const { analysis, emails, phones } = extractCvCandidateEvidence(rawText, candidate.fullName);
  if (!analysis.hasReadableText) return candidate;
  candidate.email = unique([...emails, ...candidate.email]);
  candidate.phone = unique([...phones, ...candidate.phone]);
  candidate.currentRole = analysis.primaryRole || humanCandidateField(candidate.currentRole);
  candidate.city = analysis.city || humanCandidateField(candidate.city);
  candidate.country = analysis.country || humanCandidateField(candidate.country);
  candidate.years = analysis.years ?? candidate.years;
  candidate.languages = analysis.languages.length ? analysis.languages : candidate.languages;
  candidate.tags = unique([
    ...candidate.tags.filter((tag) => Boolean(humanCandidateField(tag))),
    ...analysis.roles,
    ...analysis.skills,
    ...analysis.languages.map((language) => language.lang)
  ]).slice(0, 18);
  candidate.summary = analysis.summary || candidate.summary;
  candidate.qualityScore = Math.min(100,
    20
    + (candidate.email.length ? 15 : 0)
    + (candidate.phone.length ? 15 : 0)
    + 15
    + (analysis.roles.length ? 15 : 0)
    + (analysis.experienceHighlights.length ? 10 : 0)
    + (analysis.educationHighlights.length ? 5 : 0)
    + (analysis.languages.length ? 5 : 0)
  );
  return candidate;
}
