/**
 * Curriculum repository port — seed-backed by default; Prisma when CURRICULUM_STORE=prisma.
 */

import type { CurriculumNodeType, FrameworkSubject } from "@prisma/client";
import {
  getFramework as getSeedFramework,
  getNode as getSeedNode,
  listFrameworks as listSeedFrameworks,
  listSkills as listSeedSkills,
  type LoadedFramework,
} from "@/lib/curriculum/seed-loader";
import { getPrisma } from "@/lib/db";
import type {
  CurriculumNode,
  FrameworkSummary,
  LearningObjective,
  NodeType,
  ResourceItem,
} from "@/lib/types";

export interface CurriculumRepository {
  listFrameworks(): Promise<FrameworkSummary[]>;
  getFramework(code: string): Promise<LoadedFramework | null>;
  getNode(nodeId: string): Promise<CurriculumNode | null>;
  listSkills(
    frameworkCode: string,
    gradeLevel?: string
  ): Promise<CurriculumNode[]>;
}

class SeedCurriculumRepository implements CurriculumRepository {
  async listFrameworks() {
    return listSeedFrameworks();
  }
  async getFramework(code: string) {
    return getSeedFramework(code);
  }
  async getNode(nodeId: string) {
    return getSeedNode(nodeId);
  }
  async listSkills(frameworkCode: string, gradeLevel?: string) {
    return listSeedSkills(frameworkCode, gradeLevel);
  }
}

type DbNode = {
  id: string;
  frameworkId: string;
  parentId: string | null;
  nodeType: CurriculumNodeType;
  code: string | null;
  title: string;
  titleKo: string | null;
  summary: string | null;
  gradeLevel: string | null;
  sortOrder: number;
  positionX: number | null;
  positionY: number | null;
  metadata: unknown;
  objectives: Array<{
    id: string;
    code: string | null;
    statement: string;
    statementKo: string | null;
    masteryCriteria: string | null;
    masteryCriteriaKo: string | null;
    bloomLevel: string | null;
    sortOrder: number;
  }>;
  resources: Array<{
    id: string;
    type: string;
    title: string;
    description: string | null;
    url: string | null;
    mimeType: string | null;
    sortOrder: number;
  }>;
};

function mapObjectives(
  rows: DbNode["objectives"]
): LearningObjective[] {
  return rows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((o) => ({
      id: o.id,
      code: o.code,
      statement: o.statement,
      statementKo: o.statementKo,
      masteryCriteria: o.masteryCriteria,
      masteryCriteriaKo: o.masteryCriteriaKo,
      bloomLevel: o.bloomLevel,
      sortOrder: o.sortOrder,
    }));
}

function mapResources(rows: DbNode["resources"]): ResourceItem[] {
  return rows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description,
      url: r.url,
      mimeType: r.mimeType,
      sortOrder: r.sortOrder,
    }));
}

function buildTree(
  frameworkCode: string,
  flat: DbNode[]
): { root: CurriculumNode; byId: Map<string, CurriculumNode> } {
  const byId = new Map<string, CurriculumNode>();

  for (const row of flat) {
    byId.set(row.id, {
      id: row.id,
      frameworkCode,
      parentId: row.parentId,
      nodeType: row.nodeType as NodeType,
      code: row.code,
      title: row.title,
      titleKo: row.titleKo,
      summary: row.summary,
      gradeLevel: row.gradeLevel,
      sortOrder: row.sortOrder,
      positionX: row.positionX,
      positionY: row.positionY,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      objectives: mapObjectives(row.objectives),
      resources: mapResources(row.resources),
      children: [],
    });
  }

  let root: CurriculumNode | null = null;
  for (const node of byId.values()) {
    if (!node.parentId) {
      root = node;
      continue;
    }
    const parent = byId.get(node.parentId);
    if (parent) parent.children.push(node);
  }

  for (const node of byId.values()) {
    node.children.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  if (!root) {
    throw new Error(`Framework ${frameworkCode} has no ROOT node`);
  }

  return { root, byId };
}

function summarize(
  code: string,
  name: string,
  nameKo: string | null,
  subject: FrameworkSubject,
  regionStandard: string,
  version: string,
  description: string | null,
  root: CurriculumNode
): FrameworkSummary {
  const grades = new Set<string>();
  let skillCount = 0;
  const walk = (n: CurriculumNode) => {
    if (n.gradeLevel) grades.add(n.gradeLevel);
    if (n.nodeType === "SKILL") skillCount += 1;
    n.children.forEach(walk);
  };
  walk(root);

  return {
    code,
    name,
    nameKo,
    subject,
    regionStandard,
    version,
    description,
    gradeLevels: [...grades].sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b)
    ),
    skillCount,
  };
}

export class PrismaCurriculumRepository implements CurriculumRepository {
  async listFrameworks(): Promise<FrameworkSummary[]> {
    const prisma = getPrisma();
    const frameworks = await prisma.framework.findMany({
      orderBy: { code: "asc" },
      include: {
        organization: { select: { code: true } },
        nodes: {
          select: { nodeType: true, gradeLevel: true },
        },
      },
    });

    return frameworks.map((fw) => {
      const grades = new Set(
        fw.nodes.map((n) => n.gradeLevel).filter(Boolean) as string[]
      );
      return {
        code: fw.code,
        name: fw.name,
        nameKo: fw.nameKo,
        subject: fw.subject,
        regionStandard: fw.regionStandard,
        version: fw.version,
        description: fw.description,
        gradeLevels: [...grades].sort(
          (a, b) => Number(a) - Number(b) || a.localeCompare(b)
        ),
        skillCount: fw.nodes.filter((n) => n.nodeType === "SKILL").length,
        organizationCode: fw.organization?.code ?? null,
        isPublic: fw.isPublic,
      };
    });
  }

  async getFramework(code: string): Promise<LoadedFramework | null> {
    const prisma = getPrisma();
    const fw = await prisma.framework.findUnique({
      where: { code },
      include: {
        nodes: {
          include: {
            objectives: true,
            resources: true,
          },
        },
      },
    });
    if (!fw) return null;

    const { root, byId } = buildTree(fw.code, fw.nodes);
    return {
      summary: summarize(
        fw.code,
        fw.name,
        fw.nameKo,
        fw.subject,
        fw.regionStandard,
        fw.version,
        fw.description,
        root
      ),
      root,
      byId,
    };
  }

  async getNode(nodeId: string): Promise<CurriculumNode | null> {
    const prisma = getPrisma();
    const row = await prisma.curriculumNode.findUnique({
      where: { id: nodeId },
      include: {
        framework: true,
        objectives: true,
        resources: true,
        children: { select: { id: true } },
      },
    });
    if (!row) return null;

    return {
      id: row.id,
      frameworkCode: row.framework.code,
      parentId: row.parentId,
      nodeType: row.nodeType as NodeType,
      code: row.code,
      title: row.title,
      titleKo: row.titleKo,
      summary: row.summary,
      gradeLevel: row.gradeLevel,
      sortOrder: row.sortOrder,
      positionX: row.positionX,
      positionY: row.positionY,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      objectives: mapObjectives(row.objectives),
      resources: mapResources(row.resources),
      children: row.children.map((c) => ({
        id: c.id,
        frameworkCode: row.framework.code,
        parentId: row.id,
        nodeType: "CUSTOM" as NodeType,
        title: "",
        sortOrder: 0,
        objectives: [],
        resources: [],
        children: [],
      })),
    };
  }

  async listSkills(
    frameworkCode: string,
    gradeLevel?: string
  ): Promise<CurriculumNode[]> {
    const loaded = await this.getFramework(frameworkCode);
    if (!loaded) return [];
    return listSeedSkillsFromTree(loaded.root, gradeLevel);
  }
}

function listSeedSkillsFromTree(
  root: CurriculumNode,
  gradeLevel?: string
): CurriculumNode[] {
  const skills: CurriculumNode[] = [];
  const walk = (n: CurriculumNode, underTargetGrade: boolean) => {
    const inGrade = gradeLevel
      ? n.nodeType === "GRADE"
        ? n.gradeLevel === gradeLevel
        : underTargetGrade
      : true;
    if (n.nodeType === "SKILL" && inGrade) skills.push(n);
    for (const child of n.children) walk(child, inGrade);
  };
  walk(root, false);
  return skills;
}

/**
 * Prefer Prisma when configured; on connection/query failure fall back to seed.
 */
class AutoCurriculumRepository implements CurriculumRepository {
  private seed = new SeedCurriculumRepository();
  private prisma = new PrismaCurriculumRepository();

  private async withFallback<T>(fn: () => Promise<T>, fallback: () => Promise<T>) {
    try {
      return await fn();
    } catch {
      return fallback();
    }
  }

  listFrameworks() {
    if ((process.env.CURRICULUM_STORE || "seed") === "seed") {
      return this.seed.listFrameworks();
    }
    return this.withFallback(
      () => this.prisma.listFrameworks(),
      () => this.seed.listFrameworks()
    );
  }

  getFramework(code: string) {
    if ((process.env.CURRICULUM_STORE || "seed") === "seed") {
      return this.seed.getFramework(code);
    }
    return this.withFallback(
      () => this.prisma.getFramework(code),
      () => this.seed.getFramework(code)
    );
  }

  getNode(nodeId: string) {
    if ((process.env.CURRICULUM_STORE || "seed") === "seed") {
      return this.seed.getNode(nodeId);
    }
    return this.withFallback(
      () => this.prisma.getNode(nodeId),
      () => this.seed.getNode(nodeId)
    );
  }

  listSkills(frameworkCode: string, gradeLevel?: string) {
    if ((process.env.CURRICULUM_STORE || "seed") === "seed") {
      return this.seed.listSkills(frameworkCode, gradeLevel);
    }
    return this.withFallback(
      () => this.prisma.listSkills(frameworkCode, gradeLevel),
      () => this.seed.listSkills(frameworkCode, gradeLevel)
    );
  }
}

let singleton: CurriculumRepository | null = null;

export function getCurriculumRepository(): CurriculumRepository {
  if (!singleton) singleton = new AutoCurriculumRepository();
  return singleton;
}
