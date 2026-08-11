/**
 * Validate all prisma/seed/*.json packs against SEED_FORMAT rules.
 * Run: npm run test:seed
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import assert from "node:assert/strict";

const seedDir = join(process.cwd(), "prisma", "seed");
const NODE_TYPES = new Set([
  "ROOT",
  "GRADE",
  "DOMAIN",
  "CONCEPT",
  "SKILL",
  "CUSTOM",
]);

type AnyNode = {
  nodeType?: string;
  code?: string;
  title?: string;
  gradeLevel?: string;
  children?: AnyNode[];
  objectives?: unknown[];
};

function walk(
  node: AnyNode,
  path: string[],
  codes: Set<string>,
  skills: { n: number }
) {
  assert.ok(node.nodeType && NODE_TYPES.has(node.nodeType), `bad nodeType at ${path.join("/")}`);
  assert.ok(node.title, `missing title at ${path.join("/")}`);
  if (node.code) {
    const key = `${node.nodeType}:${node.code}`;
    assert.ok(!codes.has(key), `duplicate code ${key}`);
    codes.add(key);
  }
  if (node.nodeType === "SKILL") {
    skills.n += 1;
    assert.ok(
      Array.isArray(node.objectives) && node.objectives.length > 0,
      `SKILL missing objectives at ${path.join("/")}`
    );
  }
  for (const [i, child] of (node.children || []).entries()) {
    walk(child, [...path, String(i)], codes, skills);
  }
}

const files = readdirSync(seedDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

assert.ok(files.length > 0, "no seed JSON files");

let totalSkills = 0;
for (const file of files) {
  const pack = JSON.parse(readFileSync(join(seedDir, file), "utf8")) as {
    framework?: { code?: string; name?: string; subject?: string };
    tree?: AnyNode;
  };
  assert.ok(pack.framework?.code, `${file}: framework.code`);
  assert.ok(pack.framework?.name, `${file}: framework.name`);
  assert.ok(pack.framework?.subject, `${file}: framework.subject`);
  assert.ok(pack.tree, `${file}: tree`);
  const codes = new Set<string>();
  const skills = { n: 0 };
  walk(pack.tree!, [file], codes, skills);
  assert.ok(skills.n > 0, `${file}: no skills`);
  totalSkills += skills.n;
  console.log(`✓ ${file} — ${skills.n} skills`);
}

console.log(`✓ seed validate OK — ${files.length} packs, ${totalSkills} skills`);
