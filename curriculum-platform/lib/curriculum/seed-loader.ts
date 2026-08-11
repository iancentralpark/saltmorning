import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type {
  CurriculumNode,
  FrameworkSummary,
  LearningObjective,
  NodeType,
  ResourceItem,
} from "@/lib/types";
import { slugId } from "@/lib/utils";

type SeedObjective = {
  code?: string;
  statement: string;
  statementKo?: string;
  masteryCriteria?: string;
  masteryCriteriaKo?: string;
  bloomLevel?: string;
  sortOrder?: number;
};

type SeedResource = {
  title: string;
  type: string;
  url?: string;
  mimeType?: string;
  description?: string;
  sortOrder?: number;
};

type SeedNode = {
  nodeType: NodeType;
  code?: string;
  title: string;
  titleKo?: string;
  summary?: string;
  gradeLevel?: string;
  sortOrder?: number;
  positionX?: number;
  positionY?: number;
  metadata?: Record<string, unknown>;
  objectives?: SeedObjective[];
  resources?: SeedResource[];
  children?: SeedNode[];
};

type SeedPack = {
  framework: {
    code: string;
    name: string;
    nameKo?: string;
    subject: string;
    regionStandard: string;
    version?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  };
  tree: SeedNode;
};

export type LoadedFramework = {
  summary: FrameworkSummary;
  root: CurriculumNode;
  byId: Map<string, CurriculumNode>;
};

function mapNode(
  frameworkCode: string,
  node: SeedNode,
  parentId: string | null,
  path: string[],
  byId: Map<string, CurriculumNode>
): CurriculumNode {
  const id = slugId(frameworkCode, ...path, node.code ?? node.title, node.nodeType);
  const objectives: LearningObjective[] = (node.objectives ?? []).map((o, i) => ({
    id: slugId(id, "obj", o.code ?? i),
    code: o.code ?? null,
    statement: o.statement,
    statementKo: o.statementKo ?? null,
    masteryCriteria: o.masteryCriteria ?? null,
    masteryCriteriaKo: o.masteryCriteriaKo ?? null,
    bloomLevel: o.bloomLevel ?? null,
    sortOrder: o.sortOrder ?? i,
  }));

  const resources: ResourceItem[] = (node.resources ?? []).map((r, i) => ({
    id: slugId(id, "res", i),
    type: r.type,
    title: r.title,
    description: r.description ?? null,
    url: r.url ?? null,
    mimeType: r.mimeType ?? null,
    sortOrder: r.sortOrder ?? i,
  }));

  const mapped: CurriculumNode = {
    id,
    frameworkCode,
    parentId,
    nodeType: node.nodeType,
    code: node.code ?? null,
    title: node.title,
    titleKo: node.titleKo ?? null,
    summary: node.summary ?? null,
    gradeLevel: node.gradeLevel ?? null,
    sortOrder: node.sortOrder ?? 0,
    positionX: node.positionX ?? null,
    positionY: node.positionY ?? null,
    metadata: node.metadata ?? null,
    objectives,
    resources,
    children: [],
  };

  mapped.children = (node.children ?? []).map((child, index) =>
    mapNode(
      frameworkCode,
      child,
      id,
      [...path, String(node.sortOrder ?? 0), String(index)],
      byId
    )
  );

  byId.set(id, mapped);
  return mapped;
}

function collectGradesAndSkills(root: CurriculumNode) {
  const grades = new Set<string>();
  let skillCount = 0;

  const walk = (n: CurriculumNode) => {
    if (n.gradeLevel) grades.add(n.gradeLevel);
    if (n.nodeType === "SKILL") skillCount += 1;
    n.children.forEach(walk);
  };
  walk(root);

  return {
    gradeLevels: [...grades].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
    skillCount,
  };
}

let cache: Map<string, LoadedFramework> | null = null;

export function loadAllFrameworks(): Map<string, LoadedFramework> {
  if (cache) return cache;

  const seedDir = join(process.cwd(), "prisma", "seed");
  const files = readdirSync(seedDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const map = new Map<string, LoadedFramework>();

  for (const file of files) {
    const pack = JSON.parse(readFileSync(join(seedDir, file), "utf8")) as SeedPack;
    const byId = new Map<string, CurriculumNode>();
    const root = mapNode(pack.framework.code, pack.tree, null, [], byId);
    const { gradeLevels, skillCount } = collectGradesAndSkills(root);

    map.set(pack.framework.code, {
      summary: {
        code: pack.framework.code,
        name: pack.framework.name,
        nameKo: pack.framework.nameKo ?? null,
        subject: pack.framework.subject,
        regionStandard: pack.framework.regionStandard,
        version: pack.framework.version ?? "1.0",
        description: pack.framework.description ?? null,
        gradeLevels,
        skillCount,
      },
      root,
      byId,
    });
  }

  cache = map;
  return map;
}

export function listFrameworks(): FrameworkSummary[] {
  return [...loadAllFrameworks().values()].map((f) => f.summary);
}

export function getFramework(code: string): LoadedFramework | null {
  return loadAllFrameworks().get(code) ?? null;
}

export function getNode(nodeId: string): CurriculumNode | null {
  for (const fw of loadAllFrameworks().values()) {
    const hit = fw.byId.get(nodeId);
    if (hit) return hit;
  }
  return null;
}

/** Depth-first skills under an optional grade filter. */
export function listSkills(
  frameworkCode: string,
  gradeLevel?: string
): CurriculumNode[] {
  const fw = getFramework(frameworkCode);
  if (!fw) return [];

  const skills: CurriculumNode[] = [];

  const walk = (n: CurriculumNode, underTargetGrade: boolean) => {
    const inGrade = gradeLevel
      ? n.nodeType === "GRADE"
        ? n.gradeLevel === gradeLevel
        : underTargetGrade
      : true;

    if (n.nodeType === "SKILL" && inGrade) {
      skills.push(n);
    }

    for (const child of n.children) {
      walk(child, inGrade);
    }
  };

  walk(fw.root, false);
  return skills;
}
