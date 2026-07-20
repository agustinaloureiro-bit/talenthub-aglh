function normalizedWords(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !["de", "del", "la", "las", "los", "y"].includes(word));
}

export function normalizePhoneIdentity(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 7) return "";
  if (digits.startsWith("598") && digits.length === 11) return `0${digits.slice(3)}`;
  return digits;
}

export function namesLikelySame(left: string | null | undefined, right: string | null | undefined) {
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  if (!leftWords.length || !rightWords.length) return false;
  if (leftWords.join(" ") === rightWords.join(" ")) return true;

  const shared = leftWords.filter((word) => rightWords.includes(word));
  const shortest = Math.min(leftWords.length, rightWords.length);
  if (shortest === 1) return leftWords.length === 1 && rightWords.length === 1 && shared.length === 1;
  return shared.length >= 2 && shared.length / shortest >= 0.66;
}

export function selectCandidateEmails(values: string[], fullName: string | null | undefined, senderEmail?: string | null) {
  const unique = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return [];

  const nameWords = normalizedWords(fullName).filter((word) => word.length >= 3);
  const scored = unique.map((email, index) => {
    const local = email.split("@")[0]?.replace(/[^a-z0-9]/g, " ") ?? "";
    const nameMatches = nameWords.filter((word) => local.includes(word)).length;
    const senderMatch = senderEmail && email === senderEmail.trim().toLowerCase() ? 10 : 0;
    return { email, index, score: senderMatch + nameMatches };
  });
  const matched = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return (matched.length ? matched : scored.slice(0, 1)).slice(0, 2).map((item) => item.email);
}
