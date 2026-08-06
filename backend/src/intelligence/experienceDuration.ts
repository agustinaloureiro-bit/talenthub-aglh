const MONTHS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
  ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
  jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11
};

type Interval = { start: number; end: number };

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function monthNumber(value: string) {
  return MONTHS[normalize(value)] ?? null;
}

function parseDateToken(value: string, isEnd: boolean) {
  const normalized = normalize(value).trim();
  const now = new Date();
  if (/^(?:actualidad|actual|presente|hoy)$/.test(normalized)) {
    return now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  }
  let match = normalized.match(/^(\d{1,2})[\/.\-](\d{4})$/);
  if (match) return Number(match[2]) * 12 + Math.max(0, Math.min(11, Number(match[1]) - 1)) + (isEnd ? 1 : 0);
  match = normalized.match(/^([a-z]+)\.?\s+(?:de\s+)?(\d{4})$/);
  if (match) {
    const month = monthNumber(match[1]);
    if (month != null) return Number(match[2]) * 12 + month + (isEnd ? 1 : 0);
  }
  match = normalized.match(/^(\d{4})$/);
  if (match) return Number(match[1]) * 12 + (isEnd ? 12 : 0);
  return null;
}

function mergeMonths(intervals: Interval[]) {
  const sorted = intervals.filter((item) => item.end > item.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged.reduce((total, item) => total + item.end - item.start, 0);
}

function nearbyArea(text: string, index: number, length: number, areaTerms: string[]) {
  const context = normalize(text.slice(Math.max(0, index - 180), Math.min(text.length, index + length + 180)));
  return areaTerms.some((term) => context.includes(normalize(term)));
}

export function calculateRelevantExperienceMonths(text: string, areaTerms: string[], fallbackYears?: number | null) {
  if (!text.trim() || !areaTerms.length) return null;
  const token = "(?:\\d{1,2}[\\/.\\-]\\d{4}|(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)\\.?\\s+(?:de\\s+)?\\d{4}|\\d{4})";
  const endToken = `(?:${token}|actualidad|actual|presente|hoy)`;
  const rangePattern = new RegExp(`(${token})\\s*(?:-|–|—|a|hasta)\\s*(${endToken})`, "gi");
  const intervals: Interval[] = [];
  for (const match of text.matchAll(rangePattern)) {
    if (match.index == null || !nearbyArea(text, match.index, match[0].length, areaTerms)) continue;
    const start = parseDateToken(match[1], false);
    const end = parseDateToken(match[2], true);
    if (start != null && end != null && end > start && end - start <= 600) intervals.push({ start, end });
  }
  const rangedMonths = mergeMonths(intervals);

  const normalizedText = normalize(text);
  let explicitMonths = 0;
  for (const term of areaTerms.map(normalize)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`(?:${escaped})[^.;\\n]{0,100}?(?:durante|por|con|cuento con|experiencia de|experiencia)\\s*(?:mas de\\s*)?(\\d{1,2})\\s*(anos?|mes(?:es)?)`, "gi"),
      new RegExp(`(?:mas de\\s*)?(\\d{1,2})\\s*(anos?|mes(?:es)?)[^.;\\n]{0,100}?(?:de experiencia|trabajando|como|en el area de|en)\\s*[^.;\\n]{0,35}${escaped}`, "gi")
    ];
    for (const pattern of patterns) {
      for (const match of normalizedText.matchAll(pattern)) {
        const amount = Number(match[1]);
        if (amount > 0 && amount < 60) explicitMonths = Math.max(explicitMonths, /ano/.test(match[2]) ? amount * 12 : amount);
      }
    }
  }
  const fallbackMonths = fallbackYears && fallbackYears > 0 ? Math.round(fallbackYears * 12) : 0;
  const result = Math.max(rangedMonths, explicitMonths, fallbackMonths);
  return result > 0 ? result : null;
}

export function meetsExperienceMinimum(months: number | null, minimum: number, comparator: "at_least" | "more_than") {
  if (months == null) return false;
  return comparator === "more_than" ? months > minimum : months >= minimum;
}
