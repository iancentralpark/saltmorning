/**
 * Build COMPLETE official curriculum seed packs from:
 * - Common Standards Project API (CCSS Math, CCSS ELA, NGSS PEs)
 * - Pre-extracted KR JSON rows from NCIC PDFs (imports/kr-*-official.json)
 *
 * Run:
 *   python3 scripts/extract-kr-official.py
 *   npx tsx scripts/build-official-catalogs.ts
 *   npm run test:seed
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const root = process.cwd();
const seedDir = join(root, "prisma/seed");
const importDir = join(root, "imports");

type Std = {
  id: string;
  statementLabel?: string | null;
  statementNotation?: string | null;
  altStatementNotation?: string | null;
  description?: string | null;
  depth?: number;
  position?: number;
  parentId?: string | null;
  ancestorIds?: string[];
  listId?: string | null;
};

type Node = {
  nodeType: string;
  code: string;
  title: string;
  titleKo?: string;
  gradeLevel?: string;
  sortOrder: number;
  summary?: string;
  objectives?: unknown[];
  resources?: unknown[];
  metadata?: Record<string, unknown>;
  children: Node[];
};

const CCSS_JURISDICTION = "67810E9EF6944F9383DCC602A3484C23";
const NGSS_JURISDICTION = "71E5AA409D894EB0B43A8CD82F727BFE";

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchSet(id: string): Promise<{ title: string; standards: Record<string, Std> }> {
  const j = await fetchJson(`https://api.commonstandardsproject.com/api/v1/standard_sets/${id}`);
  return { title: j.data.title, standards: j.data.standards || {} };
}

function cleanCode(notation?: string | null, alt?: string | null): string {
  const raw = (alt || notation || "").trim();
  return raw
    .replace(/^CCSS\.Math\.Content\./i, "")
    .replace(/^CCSS\.ELA-Literacy\./i, "")
    .replace(/^CCSS\.Math\.Practice\./i, "MP.")
    .trim();
}

function gradeFromMathSetTitle(title: string): string | null {
  const t = title.toLowerCase();
  if (t.includes("practice")) return "MP";
  if (t.includes("all topics")) return null;
  if (t.startsWith("grade k") || t === "grade k") return "K";
  const m = title.match(/Grade\s+(\d+)/i);
  if (m) return m[1];
  if (/high school/i.test(title)) return "HS";
  return null;
}

function gradeFromElaSetTitle(title: string): string | null {
  const t = title.toLowerCase().trim();
  if (t === "grade k" || t.startsWith("grade k")) return "K";
  const single = title.match(/^Grade\s+(\d+)$/i);
  if (single) return single[1];
  if (/grades?\s*9\s*,?\s*10\b/i.test(title) || /9-10/.test(title)) return "9";
  if (/grades?\s*11\s*,?\s*12\b/i.test(title) || /11-12/.test(title)) return "11";
  return null;
}

function gradeFromNgssTitle(title: string): string | null {
  const t = title.toLowerCase();
  if (/grade\s*k\b/.test(t) || t === "grade k") return "K";
  const m = title.match(/Grade\s+(\d+)/i);
  if (m) return m[1];
  if (/grades?\s*6.*8/i.test(title)) return "MS";
  if (/grades?\s*9.*12/i.test(title)) return "HS";
  return null;
}

function ensureGrade(
  root: Node,
  gradeLevel: string,
  title: string,
  titleKo: string,
  sortOrder: number
): Node {
  let g = root.children.find((c) => c.gradeLevel === gradeLevel);
  if (!g) {
    g = {
      nodeType: "GRADE",
      code: gradeLevel === "K" ? "GK" : gradeLevel === "HS" ? "GHS" : gradeLevel === "MS" ? "GMS" : gradeLevel === "MP" ? "GMP" : `G${gradeLevel}`,
      title,
      titleKo,
      gradeLevel,
      sortOrder,
      children: [],
    };
    root.children.push(g);
  }
  return g;
}

function ensureDomain(grade: Node, code: string, title: string, titleKo?: string): Node {
  const scoped = `${grade.gradeLevel}:${code}`;
  let d = grade.children.find((c) => c.code === scoped || c.code === code);
  if (!d) {
    d = {
      nodeType: "DOMAIN",
      code: scoped,
      title,
      titleKo: titleKo || title,
      gradeLevel: grade.gradeLevel,
      sortOrder: grade.children.length + 1,
      children: [],
    };
    grade.children.push(d);
  }
  return d;
}

function ensureConcept(domain: Node, code: string, title: string, titleKo?: string): Node {
  const scoped = code.includes(":") ? code : `${domain.gradeLevel}:${code}`;
  let c = domain.children.find((x) => x.code === scoped || x.code === code);
  if (!c) {
    c = {
      nodeType: "CONCEPT",
      code: scoped,
      title,
      titleKo: titleKo || title,
      gradeLevel: domain.gradeLevel,
      sortOrder: domain.children.length + 1,
      children: [],
    };
    domain.children.push(c);
  }
  return c;
}

function addSkill(
  concept: Node,
  code: string,
  title: string,
  summary: string,
  seen: Set<string>,
  titleKo?: string
) {
  if (!code || seen.has(code)) return false;
  seen.add(code);
  concept.children.push({
    nodeType: "SKILL",
    code,
    title: title || code,
    titleKo: titleKo || title || code,
    gradeLevel: concept.gradeLevel,
    sortOrder: concept.children.length + 1,
    summary: summary || title || code,
    objectives: [
      {
        statement: summary || title || code,
        ...(titleKo ? { statementKo: titleKo } : {}),
        masteryCriteria: "Demonstrates the standard with evidence of understanding.",
        bloomLevel: "Apply",
        sortOrder: 1,
      },
    ],
    resources: [],
    children: [],
  });
  return true;
}

function countSkills(n: Node): number {
  let c = n.nodeType === "SKILL" ? 1 : 0;
  for (const ch of n.children) c += countSkills(ch);
  return c;
}

function sortTree(n: Node) {
  n.children.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  for (const ch of n.children) sortTree(ch);
}

function writePack(filename: string, framework: Record<string, unknown>, tree: Node) {
  sortTree(tree);
  const out = join(seedDir, filename);
  writeFileSync(out, JSON.stringify({ framework, tree }, null, 2) + "\n");
  console.log(`✓ ${filename}: ${countSkills(tree)} skills, ${tree.children.length} grades`);
}

// ───────────────── CCSS Math ─────────────────
async function buildMath() {
  const jur = await fetchJson(`https://api.commonstandardsproject.com/api/v1/jurisdictions/${CCSS_JURISDICTION}`);
  const sets = (jur.data.standardSets as Array<{ id: string; title: string; subject: string }>).filter(
    (s) => s.subject === "Mathematics"
  );

  const framework = {
    code: "ccss-math",
    name: "Common Core State Standards — Mathematics (complete)",
    nameKo: "공통핵심기준 — 수학 (전체)",
    subject: "MATH",
    regionStandard: "US-CCSS",
    version: "2010",
    description:
      "Complete CCSS Mathematics: K–8 domains, HS Number/Quantity, Algebra, Functions, Geometry, Statistics & Probability, and Standards for Mathematical Practice. Sourced from Common Standards Project.",
    metadata: {
      source: "https://api.commonstandardsproject.com",
      coverage: "official-complete",
      gradeSpan: "K-8,HS,MP",
      license: "CC BY 3.0 US (ASN/CSP)",
    },
  };

  const tree: Node = {
    nodeType: "ROOT",
    code: "ccss-math",
    title: "CCSS Mathematics",
    titleKo: "CCSS 수학",
    sortOrder: 0,
    children: [],
  };

  const seen = new Set<string>();
  const gradeSort: Record<string, number> = { K: 0, MP: 95, HS: 90 };

  for (const setMeta of sets) {
    const grade = gradeFromMathSetTitle(setMeta.title);
    if (!grade) {
      console.log(`  skip math set: ${setMeta.title}`);
      continue;
    }
    const { standards } = await fetchSet(setMeta.id);
    const byId = standards;
    const list = Object.values(byId);

    const sort =
      gradeSort[grade] ??
      (Number(grade) || 50);
    const gradeNode = ensureGrade(
      tree,
      grade,
      grade === "K" ? "Kindergarten" : grade === "HS" ? "High School" : grade === "MP" ? "Mathematical Practices" : `Grade ${grade}`,
      grade === "K" ? "유치원" : grade === "HS" ? "고등" : grade === "MP" ? "수학적 실천" : `${grade}학년`,
      sort
    );

    const domains = list.filter((s) => s.statementLabel === "Domain");
    const clusters = list.filter((s) => s.statementLabel === "Cluster");
    const standardsAndComponents = list.filter(
      (s) => s.statementLabel === "Standard" || s.statementLabel === "Component"
    );

    // Practices pack has different labels
    const practiceItems =
      grade === "MP"
        ? list.filter((s) => cleanCode(s.statementNotation, s.altStatementNotation).startsWith("MP") || /Practice/i.test(s.statementLabel || ""))
        : [];

    if (grade === "MP") {
      const domain = ensureDomain(gradeNode, "MP", "Standards for Mathematical Practice", "수학적 실천 기준");
      const concept = ensureConcept(domain, "MP.Core", "Mathematical Practices", "수학적 실천");
      for (const s of list.sort((a, b) => (a.position || 0) - (b.position || 0))) {
        const code = cleanCode(s.statementNotation, s.altStatementNotation);
        if (!code || !/^MP\.?\d/i.test(code.replace(/\s/g, ""))) {
          // accept MP1..MP8 style
          const m = (s.description || "").match(/^MP\.?(\d)/i) || (s.listId || "").match(/(\d)/);
          if (s.depth === 0 && s.description) {
            const c = `MP.${(s.listId || "").replace(/\D/g, "") || practiceItems.length + 1}`;
            addSkill(concept, c.replace(/\.\./, "."), s.description.split(/[.!?]/)[0].slice(0, 120), s.description || "", seen);
          }
          continue;
        }
        const normalized = code.replace(/^MP(\d)/i, "MP.$1");
        if (s.description) addSkill(concept, normalized, s.description.split(/[.!?]/)[0].slice(0, 140), s.description, seen);
      }
      // Fallback: any with notation
      for (const s of list) {
        const code = cleanCode(s.statementNotation, s.altStatementNotation);
        if (code && /MP/i.test(code) && s.description) {
          addSkill(concept, code, s.description.split(/[.!?]/)[0].slice(0, 140), s.description, seen);
        }
      }
      continue;
    }

    function findAncestor(std: Std, label: string): Std | undefined {
      for (const aid of std.ancestorIds || []) {
        const a = byId[aid];
        if (a?.statementLabel === label) return a;
      }
      // walk parent
      let pid = std.parentId;
      while (pid) {
        const a = byId[pid];
        if (!a) break;
        if (a.statementLabel === label) return a;
        pid = a.parentId || undefined;
      }
      return undefined;
    }

    for (const s of standardsAndComponents.sort((a, b) => (a.position || 0) - (b.position || 0))) {
      const code = cleanCode(s.statementNotation, s.altStatementNotation);
      if (!code || !s.description) continue;
      const domainStd = findAncestor(s, "Domain") || domains[0];
      const clusterStd = findAncestor(s, "Cluster");
      const domainCode =
        cleanCode(domainStd?.statementNotation, domainStd?.altStatementNotation) ||
        code.split(".").slice(0, grade === "HS" ? 1 : 2).join(".") ||
        `D-${grade}`;
      const domainTitle = domainStd?.description || domainCode;
      const conceptCode =
        cleanCode(clusterStd?.statementNotation, clusterStd?.altStatementNotation) || `${domainCode}.Core`;
      const conceptTitle = clusterStd?.description || conceptCode;
      const domain = ensureDomain(gradeNode, domainCode, domainTitle);
      const concept = ensureConcept(domain, conceptCode, conceptTitle);
      addSkill(concept, code, s.description.split(/[.!?]/)[0].slice(0, 160), s.description, seen);
    }
  }

  writePack("ccss-math-grade-4.json", framework, tree);
}

// ───────────────── CCSS ELA ─────────────────
async function buildEla() {
  const jur = await fetchJson(`https://api.commonstandardsproject.com/api/v1/jurisdictions/${CCSS_JURISDICTION}`);
  const sets = (jur.data.standardSets as Array<{ id: string; title: string; subject: string }>).filter(
    (s) => /English|Literacy/i.test(s.subject || "") && s.id.includes("D10003FC")
  );

  const framework = {
    code: "ccss-ela",
    name: "Common Core State Standards — English Language Arts (complete)",
    nameKo: "공통핵심기준 — 영어 (전체)",
    subject: "ELA",
    regionStandard: "US-CCSS",
    version: "2010",
    description:
      "Complete CCSS ELA/Literacy: K–12 RL/RI/RF/W/SL/L and embedded RH/RST/WHST literacy standards. Sourced from Common Standards Project.",
    metadata: {
      source: "https://api.commonstandardsproject.com",
      coverage: "official-complete",
      gradeSpan: "K-12",
      license: "CC BY 3.0 US (ASN/CSP)",
    },
  };

  const tree: Node = {
    nodeType: "ROOT",
    code: "ccss-ela",
    title: "CCSS English Language Arts",
    titleKo: "CCSS 영어",
    sortOrder: 0,
    children: [],
  };

  const seen = new Set<string>();

  for (const setMeta of sets) {
    const grade = gradeFromElaSetTitle(setMeta.title);
    if (!grade) {
      console.log(`  skip ela set: ${setMeta.title}`);
      continue;
    }
    const { standards } = await fetchSet(setMeta.id);
    const byId = standards;
    const list = Object.values(byId);
    const sort = grade === "K" ? 0 : Number(grade) || 50;
    const gradeNode = ensureGrade(
      tree,
      grade,
      grade === "K" ? "Kindergarten" : grade === "9" ? "Grades 9–10" : grade === "11" ? "Grades 11–12" : `Grade ${grade}`,
      grade === "K" ? "유치원" : grade === "9" ? "9–10학년" : grade === "11" ? "11–12학년" : `${grade}학년`,
      sort
    );

    const skills = list.filter(
      (s) =>
        s.statementLabel === "Standard" ||
        s.statementLabel === "Component" ||
        (!!s.statementNotation && !!s.description && s.depth !== undefined && s.depth >= 2)
    );

    for (const s of skills.sort((a, b) => (a.position || 0) - (b.position || 0))) {
      const code = cleanCode(s.statementNotation, s.altStatementNotation);
      if (!code || !s.description) continue;
      // Strand = first token before grade, e.g. RL.4.1 → RL.4 domain, or RH.6-8.1
      const parts = code.split(".");
      const strand = parts[0] || "ELA";
      let domainCode = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : strand;
      // For components like RL.4.1.a keep domain as RL.4
      if (parts.length >= 3 && /^[A-Za-z]+$/.test(parts[0])) {
        domainCode = `${parts[0]}.${parts[1]}`;
      }
      const domainTitle =
        (
          {
            RL: "Reading Literature",
            RI: "Reading Informational",
            RF: "Reading Foundational Skills",
            W: "Writing",
            SL: "Speaking & Listening",
            L: "Language",
            RH: "Literacy in History/Social Studies",
            RST: "Literacy in Science & Technical Subjects",
            WHST: "Writing in History/Science/Technical",
          } as Record<string, string>
        )[strand] || strand;

      // Find cluster/parent standard for concept
      let conceptCode = parts.length >= 3 ? parts.slice(0, 3).join(".") : code;
      // If this is a component (ends with letter), concept is parent standard
      if (/[a-z]$/i.test(parts[parts.length - 1]) && parts.length >= 4) {
        conceptCode = parts.slice(0, 3).join(".");
      } else if (parts.length === 3) {
        conceptCode = code;
      }

      const domain = ensureDomain(gradeNode, domainCode, domainTitle);
      const concept = ensureConcept(domain, `${conceptCode}.Core`, conceptCode);
      addSkill(concept, code, s.description.split(/[.!?]/)[0].slice(0, 160), s.description, seen);
    }
  }

  writePack("ccss-ela-grade-4.json", framework, tree);
}

// ───────────────── NGSS ─────────────────
async function buildNgss() {
  const peSetIds = [
    "DF7A6322BBB34EE382C1B496230C4FF0", // K
    "BF25C6DE0AE44F06B81A8F9FDF1BC993", // 1
    "16F12824029B4F51B0CDE408A8DBB3B2", // 2
    "2327EF84988E430EB9E5FDD3C8D42CEE", // 3
    "64DE52B2863A40B1A345B408A2C8C545", // 4
    "AEFABECEDDD04745BF8B30494DC375BC", // 5
    "577CE42946E64776BC241B5F7A090F17", // 6-8
    "5A6D43D9EBAC4D8FA3764D2ACBC10272", // 9-12
  ];

  const framework = {
    code: "ngss-science",
    name: "Next Generation Science Standards — Performance Expectations (complete)",
    nameKo: "차세대 과학 표준 — 수행기대 (전체)",
    subject: "SCIENCE",
    regionStandard: "US-NGSS",
    version: "2013",
    description:
      "Complete NGSS Performance Expectations for K–5, Middle School, and High School (including ETS). Sourced from Common Standards Project.",
    metadata: {
      source: "https://api.commonstandardsproject.com",
      coverage: "official-complete",
      gradeSpan: "K-5,MS,HS",
      license: "CC BY 3.0 US (ASN/CSP)",
    },
  };

  const tree: Node = {
    nodeType: "ROOT",
    code: "ngss-science",
    title: "NGSS Science",
    titleKo: "NGSS 과학",
    sortOrder: 0,
    children: [],
  };

  const seen = new Set<string>();
  const sortMap: Record<string, number> = { K: 0, MS: 6, HS: 90 };

  for (const id of peSetIds) {
    const { title, standards } = await fetchSet(id);
    const grade = gradeFromNgssTitle(title);
    if (!grade) {
      console.log(`  skip ngss set: ${title}`);
      continue;
    }
    const list = Object.values(standards);
    const gradeNode = ensureGrade(
      tree,
      grade,
      grade === "K" ? "Kindergarten" : grade === "MS" ? "Middle School (6–8)" : grade === "HS" ? "High School" : `Grade ${grade}`,
      grade === "K" ? "유치원" : grade === "MS" ? "중학교 (6–8)" : grade === "HS" ? "고등" : `${grade}학년`,
      sortMap[grade] ?? (Number(grade) || 50)
    );

    const pes = list.filter((s) => s.statementLabel === "Performance Expectation");
    for (const s of pes.sort((a, b) => (a.position || 0) - (b.position || 0))) {
      const code = (s.statementNotation || s.altStatementNotation || "").trim();
      if (!code || !s.description) continue;
      // Domain from PE prefix: 4-PS3-1 → 4-PS3, MS-LS1-1 → MS-LS1, K-2-ETS1-1 → K-2-ETS1
      const domainCode = code.replace(/-\d+[a-z]?$/i, "");
      const domain = ensureDomain(gradeNode, domainCode, domainCode);
      const concept = ensureConcept(domain, `${domainCode}.Core`, domainCode);
      addSkill(concept, code, s.description.split(/[.!?]/)[0].slice(0, 160), s.description, seen);
    }
  }

  writePack("ngss-science-grade-4.json", framework, tree);
}

// ───────────────── KR from extracted JSON ─────────────────
type KrRow = {
  code: string;
  band: string;
  gradeLevel: string;
  domainCode: string;
  domainTitle: string;
  title: string;
  statement: string;
  subject: string;
};

function buildKrFromRows(
  filename: string,
  framework: Record<string, unknown>,
  rows: KrRow[],
  rootTitle: string,
  rootTitleKo: string
) {
  const tree: Node = {
    nodeType: "ROOT",
    code: String(framework.code),
    title: rootTitle,
    titleKo: rootTitleKo,
    sortOrder: 0,
    children: [],
  };
  const seen = new Set<string>();
  const bandSort: Record<string, number> = {};

  for (const r of rows) {
    if (!r.code || seen.has(r.code)) continue;
    const sort =
      bandSort[r.gradeLevel] ??
      (bandSort[r.gradeLevel] =
        r.gradeLevel === "HS" ? 90 : Number(String(r.gradeLevel).replace(/\D/g, "")) || Object.keys(bandSort).length + 1);
    const gradeNode = ensureGrade(tree, r.gradeLevel, r.band || r.gradeLevel, r.band || r.gradeLevel, sort);
    const domain = ensureDomain(gradeNode, r.domainCode, r.domainTitle, r.domainTitle);
    const concept = ensureConcept(domain, `${r.domainCode}.Core`, r.domainTitle, r.domainTitle);
    addSkill(concept, r.code, r.title || r.statement.slice(0, 80), r.statement, seen, r.title || r.statement.slice(0, 80));
    // Korean objectives
    const skill = concept.children[concept.children.length - 1];
    if (skill?.objectives?.[0]) {
      (skill.objectives[0] as Record<string, unknown>).statementKo = r.statement;
      (skill.objectives[0] as Record<string, unknown>).statement = r.statement;
    }
  }

  writePack(filename, framework, tree);
}

function loadKr(name: string): KrRow[] {
  const path = join(importDir, name);
  if (!existsSync(path)) {
    console.warn(`missing ${path} — run extract-kr-official.py first`);
    return [];
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  mkdirSync(importDir, { recursive: true });
  console.log("Building CCSS Math…");
  await buildMath();
  console.log("Building CCSS ELA…");
  await buildEla();
  console.log("Building NGSS…");
  await buildNgss();

  console.log("Building KR Korean…");
  const ko = loadKr("kr-korean-official.json");
  buildKrFromRows(
    "kr2022-korean-grade-4.json",
    {
      code: "kr2022-korean",
      name: "2022 Revised National Curriculum — Korean Language (complete)",
      nameKo: "2022 개정 교육과정 — 국어 (전체)",
      subject: "KOREAN_LANGUAGE",
      regionStandard: "KR-2022",
      version: "2022",
      description: "2022 개정 국어 성취기준 전체 (초·중 공통 + 고등 선택). NCIC 별책 5.",
      metadata: {
        source: "https://ncic.re.kr/",
        coverage: "official-complete",
        gradeSpan: "1-12",
        noticeSeq: "10003553",
      },
    },
    ko,
    "2022 개정 국어",
    "2022 개정 국어"
  );

  console.log("Building KR Social/History…");
  const hi = loadKr("kr-social-official.json");
  buildKrFromRows(
    "kr2022-history-grade-4.json",
    {
      code: "kr2022-history",
      name: "2022 Revised National Curriculum — Social Studies / History (complete)",
      nameKo: "2022 개정 교육과정 — 사회/역사 (전체)",
      subject: "KOREAN_HISTORY",
      regionStandard: "KR-2022",
      version: "2022",
      description: "2022 개정 사회과 성취기준 전체 (초등 사회, 중학 사회·역사, 고등 선택). NCIC 별책 7.",
      metadata: {
        source: "https://ncic.re.kr/",
        coverage: "official-complete",
        gradeSpan: "3-12",
        noticeSeq: "10003800",
      },
    },
    hi,
    "2022 개정 사회/역사",
    "2022 개정 사회/역사"
  );

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
