export type EmployerKnowledge = {
  name: string;
  aliases: string[];
  concepts: string[];
  evidenceLabel: string;
};

const EMPLOYERS: EmployerKnowledge[] = [
  {
    name: "Casa Tres",
    aliases: ["casa tres", "casa 3", "casatres"],
    concepts: [
      "telemarketer",
      "telemarketing",
      "call center",
      "contact center",
      "operador telefonico",
      "operadora telefonica",
      "ventas telefonicas"
    ],
    evidenceLabel: "Casa Tres (contact center)"
  }
];

function normalize(value: string) {
  return value.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAlias(text: string, alias: string) {
  const normalizedText = ` ${normalize(text)} `;
  const normalizedAlias = normalize(alias);
  return normalizedAlias.length > 2 && normalizedText.includes(` ${normalizedAlias} `);
}

export function employerKnowledgeInText(text: string) {
  if (!text.trim()) return [];
  return EMPLOYERS.filter((employer) => employer.aliases.some((alias) => containsAlias(text, alias)));
}

export function employerConceptsInText(text: string) {
  return [...new Set(employerKnowledgeInText(text).flatMap((employer) => employer.concepts))];
}

export function employerAliasesForConcepts(concepts: string[]) {
  const requested = new Set(concepts.map(normalize));
  return [...new Set(EMPLOYERS
    .filter((employer) => employer.concepts.some((concept) => requested.has(normalize(concept))))
    .flatMap((employer) => employer.aliases))];
}

export function employerEvidenceForConcepts(text: string, concepts: string[]) {
  const requested = new Set(concepts.map(normalize));
  return employerKnowledgeInText(text)
    .filter((employer) => employer.concepts.some((concept) => requested.has(normalize(concept))));
}

export function enrichWithEmployerConcepts(text: string) {
  const concepts = employerConceptsInText(text);
  return concepts.length ? `${text}\n${concepts.join(" ")}` : text;
}
