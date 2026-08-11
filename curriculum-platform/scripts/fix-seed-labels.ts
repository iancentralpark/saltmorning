/**
 * Post-process seed packs:
 * - Drop empty DOMAIN/CONCEPT shells (e.g. CCR anchors with 0 skills)
 * - Replace code-only concept titles with first skill title
 * - Give CCR domains human names if any remain
 *
 * Run: npx tsx scripts/fix-seed-labels.ts
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const seedDir = join(process.cwd(), "prisma/seed");

type Node = {
  nodeType?: string;
  code?: string;
  title?: string;
  titleKo?: string;
  summary?: string;
  children?: Node[];
  [k: string]: unknown;
};

const CCR_NAMES: Record<string, string> = {
  "CCR.R": "College & Career Readiness — Reading",
  "CCR.W": "College & Career Readiness — Writing",
  "CCR.SL": "College & Career Readiness — Speaking & Listening",
  "CCR.L": "College & Career Readiness — Language",
  CCR: "College & Career Readiness",
};

function skillCount(n: Node): number {
  let c = n.nodeType === "SKILL" ? 1 : 0;
  for (const ch of n.children || []) c += skillCount(ch);
  return c;
}

function firstSkillTitle(n: Node): string | null {
  if (n.nodeType === "SKILL" && n.title) return n.title;
  for (const ch of n.children || []) {
    const t = firstSkillTitle(ch);
    if (t) return t;
  }
  return null;
}

function shortTitle(full: string, max = 72): string {
  const t = full.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
}

function unscoped(code?: string): string {
  if (!code) return "";
  const i = code.indexOf(":");
  return i >= 0 ? code.slice(i + 1) : code;
}

function fixDomainTitle(d: Node) {
  const raw = unscoped(d.code);
  const head = raw.split(".").slice(0, 2).join("."); // CCR.R
  if (CCR_NAMES[head]) {
    d.title = CCR_NAMES[head];
    d.titleKo = d.title;
    return;
  }
  if (CCR_NAMES[raw.split(".")[0]]) {
    d.title = CCR_NAMES[raw.split(".")[0]];
    d.titleKo = d.title;
  }
}

function pruneAndLabel(n: Node): Node | null {
  if (n.children) {
    n.children = n.children
      .map((c) => pruneAndLabel(c))
      .filter((c): c is Node => c != null);
  }

  if (n.nodeType === "DOMAIN" || n.nodeType === "CONCEPT") {
    if (skillCount(n) === 0) return null;
  }

  if (n.nodeType === "DOMAIN") {
    fixDomainTitle(n);
    // If title is still a bare code-like token
    if (!n.title || n.title === "CCR" || /^[A-Z]{1,4}(\.\d)?$/.test(n.title)) {
      fixDomainTitle(n);
    }
  }

  if (n.nodeType === "CONCEPT") {
    const looksLikeCode =
      !n.title ||
      n.title === n.code ||
      unscoped(n.code).replace(/\.Core$/i, "") === n.title ||
      /^[A-Z]{1,5}(\.[A-Za-z0-9-]+){1,4}$/.test(n.title);
    if (looksLikeCode) {
      const sk = firstSkillTitle(n);
      if (sk) {
        n.title = shortTitle(sk);
        n.titleKo = n.title;
      }
    }
  }

  return n;
}

let files = 0;
for (const file of readdirSync(seedDir).filter((f) => f.endsWith(".json"))) {
  const path = join(seedDir, file);
  const pack = JSON.parse(readFileSync(path, "utf8"));
  if (!pack.tree) continue;
  const before = skillCount(pack.tree);
  pruneAndLabel(pack.tree);
  // Also prune empty grades
  if (pack.tree.children) {
    pack.tree.children = pack.tree.children.filter(
      (g: Node) => skillCount(g) > 0
    );
  }
  const after = skillCount(pack.tree);
  writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
  files += 1;
  console.log(`✓ ${file}: skills ${before}→${after}`);
}
console.log(`fixed ${files} packs`);
