import { inflateRawSync } from "zlib";
import { PDFParse } from "pdf-parse";

const MAX_TEXT_LENGTH = 50_000;

function decodeXml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'");
}

export function cleanExtractedDocumentText(value: string) {
  const text = String(value ?? "")
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const binarySignals = (lower.match(/%pdf-|endobj|xref|startxref|\/flatedecode|\/xobject|\/font|\/colorspace/g) ?? []).length;
  if (binarySignals >= 3 || /^%pdf-/.test(lower)) return "";
  const alpha = (text.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) ?? []).length;
  const odd = (text.match(/[^\sA-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9@._%+\-:,;()/]/g) ?? []).length;
  if (text.length > 200 && odd > alpha * 0.35) return "";
  return text.slice(0, MAX_TEXT_LENGTH);
}

function extractDocxText(buffer: Buffer) {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < buffer.length - 46) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    offset += 46 + fileNameLength + extraLength + commentLength;
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/i.test(fileName)) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed) : compressed;
    chunks.push(decodeXml(content.toString("utf8")
      .replace(/<w:tab\s*\/>/gi, " ")
      .replace(/<\/w:p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")));
  }
  return cleanExtractedDocumentText(chunks.join("\n"));
}

function extractPdfFallback(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const literals = [...raw.matchAll(/\(([^()]{2,300})\)\s*T[jJ]/g)].map((match) => match[1]);
  const readable = raw
    .replace(/\\[nrtbf()\\]/g, " ")
    .match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9@._%+\-\s]{4,}/g)
    ?.join(" ") ?? "";
  return cleanExtractedDocumentText([...literals, readable].join(" ").replace(/\\([()\\])/g, "$1"));
}

async function extractPdfText(buffer: Buffer) {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return cleanExtractedDocumentText(result.text ?? "");
  } catch {
    return extractPdfFallback(buffer);
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

export async function extractDocumentText(fileName: string, mimeType: string | null | undefined, buffer: Buffer) {
  const lowerName = String(fileName ?? "").toLowerCase();
  const lowerMime = String(mimeType ?? "").toLowerCase();
  if (!buffer.length) return "";
  if (lowerMime.startsWith("text/") || /\.(?:txt|rtf)$/i.test(lowerName)) {
    return cleanExtractedDocumentText(buffer.toString("utf8"));
  }
  if (lowerName.endsWith(".docx") || lowerMime.includes("wordprocessingml")) {
    return extractDocxText(buffer);
  }
  if (lowerName.endsWith(".pdf") || lowerMime.includes("pdf")) {
    return extractPdfText(buffer);
  }
  return "";
}
