import { createHash } from "node:crypto";
import type { CandidateImport } from "../agents/types.js";

function cleanText(value: string | null | undefined) {
  const text = value == null ? null : String(value).replace(/\u0000/g, "").trim();
  return text || null;
}

function documentFileBuffer(value: string | null | undefined) {
  if (!value) return null;
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

export function documentContentHash(fileData: Buffer | null, rawText: string | null | undefined) {
  if (fileData?.length) return createHash("sha256").update(fileData).digest("hex");
  const text = cleanText(rawText);
  return text ? `text-sha256:${createHash("sha256").update(text).digest("hex")}` : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

export function candidateContentHash(candidate: CandidateImport) {
  const documents = (candidate.documents ?? []).map((document) => {
    const fileData = documentFileBuffer(document.fileDataBase64);
    return {
      type: document.type,
      fileName: document.fileName,
      fileUrl: document.fileUrl ?? null,
      mimeType: document.mimeType ?? null,
      sourceId: document.sourceId ?? null,
      sourcePath: document.sourcePath ?? null,
      isPrimaryCv: Boolean(document.isPrimaryCv),
      sizeBytes: document.sizeBytes ?? fileData?.byteLength ?? null,
      fileHash: cleanText(document.fileHash) ?? documentContentHash(fileData, document.rawText)
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const payload = stableValue({
    fullName: candidate.fullName,
    firstName: candidate.firstName ?? null,
    lastName: candidate.lastName ?? null,
    email: [...candidate.email].sort(),
    phone: [...candidate.phone].sort(),
    city: candidate.city ?? null,
    country: candidate.country ?? null,
    linkedinUrl: candidate.linkedinUrl ?? null,
    currentRole: candidate.currentRole ?? null,
    seniority: candidate.seniority ?? null,
    years: candidate.years ?? null,
    tags: [...candidate.tags].sort(),
    languages: candidate.languages ?? [],
    summary: candidate.summary ?? null,
    sourceUrl: candidate.sourceUrl ?? null,
    sourceCreatedAt: candidate.sourceCreatedAt ?? null,
    documents
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
