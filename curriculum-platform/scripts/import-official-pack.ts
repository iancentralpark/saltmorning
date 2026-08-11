/**
 * Import a flat CSV/JSON catalog into a CurricuMap seed pack skeleton.
 *
 * CSV columns (header required):
 *   grade,domainCode,domainTitle,conceptCode,conceptTitle,skillCode,skillTitle,summary,objective,mastery,bloom
 *
 * JSON: array of the same fields (camelCase).
 *
 * Usage:
 *   npx tsx scripts/import-official-pack.ts \
 *     --in ./imports/sample-catalog.csv \
 *     --out ./prisma/seed/imported-demo.json \
 *     --code imported-demo --name "Imported Demo" --subject MATH --region US-CCSS
 *
 * PDF: pass --pdf ./file.pdf to extract raw text into a sidecar .txt for manual mapping
 * (full PDF→standards parsing needs human review; this only extracts text).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { basename, extname, join } from "path";

type Row = {
  grade: string;
  domainCode: string;
  domainTitle: string;
  conceptCode: string;
  conceptTitle: string;
  skillCode: string;
  skillTitle: string;
  summary?: string;
  objective?: string;
  mastery?: string;
  bloom?: string;
};

function arg(name: string, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}

function parseCsv(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] || "";
    });
    return obj as unknown as Row;
  });
}

function nest(rows: Row[], framework: Record<string, unknown>) {
  type N = {
    nodeType: string;
    code: string;
    title: string;
    gradeLevel?: string;
    sortOrder: number;
    summary?: string;
    objectives?: unknown[];
    children: N[];
  };

  const root: N = {
    nodeType: "ROOT",
    code: String(framework.code),
    title: String(framework.name),
    sortOrder: 0,
    children: [],
  };

  const gradeMap = new Map<string, N>();
  const domainMap = new Map<string, N>();
  const conceptMap = new Map<string, N>();

  for (const r of rows) {
    if (!r.grade || !r.skillCode) continue;
    let grade = gradeMap.get(r.grade);
    if (!grade) {
      grade = {
        nodeType: "GRADE",
        code: r.grade === "K" ? "GK" : `G${r.grade}`,
        title: r.grade === "HS" ? "High School" : `Grade ${r.grade}`,
        gradeLevel: r.grade,
        sortOrder: Number(r.grade) || (r.grade === "K" ? 0 : 90),
        children: [],
      };
      gradeMap.set(r.grade, grade);
      root.children.push(grade);
    }
    const dKey = `${r.grade}:${r.domainCode}`;
    let domain = domainMap.get(dKey);
    if (!domain) {
      domain = {
        nodeType: "DOMAIN",
        code: r.domainCode || `D-${r.grade}`,
        title: r.domainTitle || r.domainCode,
        gradeLevel: r.grade,
        sortOrder: domainMap.size + 1,
        children: [],
      };
      domainMap.set(dKey, domain);
      grade.children.push(domain);
    }
    const cKey = `${dKey}:${r.conceptCode}`;
    let concept = conceptMap.get(cKey);
    if (!concept) {
      concept = {
        nodeType: "CONCEPT",
        code: r.conceptCode || `C-${r.skillCode}`,
        title: r.conceptTitle || r.conceptCode,
        gradeLevel: r.grade,
        sortOrder: conceptMap.size + 1,
        children: [],
      };
      conceptMap.set(cKey, concept);
      domain.children.push(concept);
    }
    concept.children.push({
      nodeType: "SKILL",
      code: r.skillCode,
      title: r.skillTitle || r.skillCode,
      gradeLevel: r.grade,
      sortOrder: concept.children.length + 1,
      summary: r.summary || r.skillTitle,
      objectives: [
        {
          statement: r.objective || r.skillTitle,
          masteryCriteria: r.mastery || "Meets objective with evidence.",
          bloomLevel: r.bloom || "Apply",
          sortOrder: 1,
        },
      ],
      children: [],
    });
  }

  root.children.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return { framework, tree: root };
}

async function maybeExtractPdf(pdfPath: string) {
  // Minimal: copy bytes length note — full PDF parse needs pdf libs; write placeholder sidecar
  const buf = readFileSync(pdfPath);
  const out = pdfPath.replace(/\.pdf$/i, ".extracted.txt");
  writeFileSync(
    out,
    `# Extracted placeholder for ${basename(pdfPath)}\n# bytes=${buf.length}\n# Install a PDF text extractor and replace this file, then map rows into CSV for import-official-pack.\n`
  );
  console.log(`✓ wrote PDF sidecar ${out} (${buf.length} bytes source)`);
}

async function main() {
  const pdf = arg("--pdf");
  if (pdf) {
    if (!existsSync(pdf)) throw new Error(`PDF not found: ${pdf}`);
    await maybeExtractPdf(pdf);
    if (!arg("--in")) return;
  }

  const input = arg("--in");
  const out = arg("--out", join("prisma/seed", "imported-catalog.json"));
  if (!input) {
    console.log(
      "Usage: npx tsx scripts/import-official-pack.ts --in catalog.csv --out prisma/seed/x.json --code x --name Name --subject MATH"
    );
    process.exit(0);
  }

  const raw = readFileSync(input, "utf8");
  const rows =
    extname(input).toLowerCase() === ".json"
      ? (JSON.parse(raw) as Row[])
      : parseCsv(raw);

  const framework = {
    code: arg("--code", "imported-catalog"),
    name: arg("--name", "Imported catalog"),
    nameKo: arg("--nameKo", ""),
    subject: arg("--subject", "CUSTOM"),
    regionStandard: arg("--region", "CUSTOM"),
    version: "1.0",
    description: "Generated by import-official-pack.ts — review before seeding.",
    metadata: { importedFrom: basename(input), importedAt: new Date().toISOString() },
  };

  const pack = nest(rows, framework);
  writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");
  console.log(`✓ wrote ${out} (${rows.length} rows)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
