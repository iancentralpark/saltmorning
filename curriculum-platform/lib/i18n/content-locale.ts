/**
 * Content language policy:
 * - Korean Language & Korean History → Korean (titleKo / statementKo)
 * - All other frameworks (CCSS, NGSS, …) → English (title / statement)
 * UI chrome stays English.
 */

const KOREAN_CONTENT_SUBJECTS = new Set([
  "KOREAN_LANGUAGE",
  "KOREAN_HISTORY",
]);

export function usesKoreanContent(
  subject?: string | null,
  frameworkCode?: string | null
): boolean {
  if (subject && KOREAN_CONTENT_SUBJECTS.has(subject)) return true;
  if (frameworkCode?.startsWith("kr2022-korean")) return true;
  if (frameworkCode?.startsWith("kr2022-history")) return true;
  return false;
}

export function pickLocalized(
  primaryEn: string | null | undefined,
  localizedKo: string | null | undefined,
  useKo: boolean
): string {
  if (useKo) return (localizedKo || primaryEn || "").trim();
  return (primaryEn || localizedKo || "").trim();
}

export function frameworkDisplayName(fw: {
  name: string;
  nameKo?: string | null;
  subject: string;
  code?: string;
}): string {
  return pickLocalized(
    fw.name,
    fw.nameKo,
    usesKoreanContent(fw.subject, fw.code)
  );
}

export function nodeDisplayTitle(
  node: {
    title: string;
    titleKo?: string | null;
  },
  opts: { subject?: string | null; frameworkCode?: string | null }
): string {
  return pickLocalized(
    node.title,
    node.titleKo,
    usesKoreanContent(opts.subject, opts.frameworkCode)
  );
}

export function objectiveDisplayStatement(
  obj: {
    statement: string;
    statementKo?: string | null;
  },
  opts: { subject?: string | null; frameworkCode?: string | null }
): string {
  return pickLocalized(
    obj.statement,
    obj.statementKo,
    usesKoreanContent(opts.subject, opts.frameworkCode)
  );
}

export function masteryDisplay(
  obj: {
    masteryCriteria?: string | null;
    masteryCriteriaKo?: string | null;
  },
  opts: { subject?: string | null; frameworkCode?: string | null }
): string | null {
  const text = pickLocalized(
    obj.masteryCriteria,
    obj.masteryCriteriaKo,
    usesKoreanContent(opts.subject, opts.frameworkCode)
  );
  return text || null;
}
