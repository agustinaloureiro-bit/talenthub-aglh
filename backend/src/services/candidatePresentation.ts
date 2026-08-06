import { findUruguayPlace } from "../intelligence/uruguayGeography.js";

function cleanInlineText(value: unknown) {
  return String(value ?? "")
    .replace(/Ã¡/g, "á").replace(/Ã©/g, "é").replace(/Ã­/g, "í").replace(/Ã³/g, "ó").replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ").replace(/Â/g, "")
    .replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function candidateDisplayName(value: unknown) {
  const text = cleanInlineText(value)
    // OCR sometimes separates the final "es" in surnames such as Quiñones.
    .replace(/\b([\p{L}]{4,}(?:on|ón|ñon))\s+es\b/giu, "$1es");
  if (!text || text.length > 120 || !/[\p{L}]/u.test(text)) return "Candidato sin nombre";
  return text;
}

export function candidateDisplayLocation(value: unknown) {
  const text = cleanInlineText(value);
  if (!text) return null;
  const looksLikeAddress = /\b(?:calle|av(?:enida)?|ruta|camino|esq(?:uina)?|apto|bis|km|manzana|solar|barrio)\b|\d{2,}/i.test(text);
  const looksLikeContact = /@|\b(?:cel(?:ular)?|tel(?:efono)?|credencial|cedula|documento)\b/i.test(text);
  if (looksLikeAddress || looksLikeContact) return null;
  const place = findUruguayPlace(text);
  if (place) return place.name;

  const simpleLocality = /^[\p{L}][\p{L} .'-]{1,38}(?:,\s*(?:Uruguay|UY))?$/iu.test(text)
    && text.split(/\s+/).length <= 5;
  if (!simpleLocality || looksLikeAddress || looksLikeContact) return null;
  return text;
}
