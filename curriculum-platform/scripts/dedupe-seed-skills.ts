/**
 * Remove duplicate SKILL codes within each seed pack.
 * Prefer the skill whose nearest DOMAIN code is a prefix of the skill code.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const seedDir = join(process.cwd(), "prisma/seed");

type Node = {
  nodeType?: string;
  code?: string;
  children?: Node[];
  [k: string]: unknown;
};

function nearestDomain(stack: Node[]): Node | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].nodeType === "DOMAIN") return stack[i];
  }
  return undefined;
}

function score(skillCode: string, domainCode?: string): number {
  if (!domainCode) return 0;
  if (skillCode === domainCode || skillCode.startsWith(domainCode + ".") || skillCode.startsWith(domainCode + "-")) {
    return 100 + domainCode.length;
  }
  // loose: share leading token (e.g. RI.5 vs RI.5.1, 4-PS3 vs 4-PS3-1, A-REI vs A-REI.B.3)
  const d = domainCode.replace(/\.[A-Za-z]+$/, ""); // strip trailing letter cluster for A-REI-like
  if (skillCode.startsWith(d)) return 50 + d.length;
  const skillHead = skillCode.split(/[.-]/)[0];
  const domainHead = domainCode.split(/[.-]/)[0];
  if (skillHead && skillHead === domainHead) return 10;
  return 0;
}

function collect(
  node: Node,
  stack: Node[],
  out: Array<{ skill: Node; parent: Node; domain?: Node; path: string }>
) {
  const next = [...stack, node];
  if (node.nodeType === "SKILL" && node.code) {
    const parent = stack[stack.length - 1];
    out.push({
      skill: node,
      parent,
      domain: nearestDomain(stack),
      path: next.map((n) => n.code || n.nodeType).join("/"),
    });
  }
  for (const c of node.children || []) collect(c, next, out);
}

function removeChild(parent: Node, child: Node) {
  if (!parent.children) return;
  parent.children = parent.children.filter((c) => c !== child);
}

for (const file of readdirSync(seedDir).filter((f) => f.endsWith(".json"))) {
  const path = join(seedDir, file);
  const pack = JSON.parse(readFileSync(path, "utf8"));
  const entries: Array<{ skill: Node; parent: Node; domain?: Node; path: string }> = [];
  collect(pack.tree, [], entries);

  const byCode = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byCode.get(e.skill.code!) || [];
    list.push(e);
    byCode.set(e.skill.code!, list);
  }

  let removed = 0;
  for (const [code, list] of byCode) {
    if (list.length < 2) continue;
    list.sort((a, b) => score(code, b.domain?.code) - score(code, a.domain?.code));
    const keep = list[0];
    for (const drop of list.slice(1)) {
      removeChild(drop.parent, drop.skill);
      removed += 1;
      console.log(`${file}: drop duplicate ${code} at ${drop.path} (keep ${keep.path})`);
    }
  }

  if (removed > 0) {
    writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
    console.log(`✓ ${file}: removed ${removed} duplicates`);
  } else {
    console.log(`· ${file}: no duplicates`);
  }
}
