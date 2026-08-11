/**
 * Load curriculum seed packs into PostgreSQL via Prisma.
 *
 * Usage:
 *   npx prisma db seed
 *   # or
 *   npm run db:seed
 *
 * Requires DATABASE_URL and `npx prisma generate`.
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

type SeedObjective = {
  code?: string;
  statement: string;
  statementKo?: string;
  masteryCriteria?: string;
  masteryCriteriaKo?: string;
  bloomLevel?: string;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
};

type SeedResource = {
  title: string;
  type: string;
  url?: string;
  mimeType?: string;
  description?: string;
  storageKey?: string;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
};

type SeedNode = {
  nodeType: string;
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

async function insertNodeTree(
  frameworkId: string,
  node: SeedNode,
  parentId: string | null
): Promise<void> {
  const created = await prisma.curriculumNode.create({
    data: {
      frameworkId,
      parentId,
      nodeType: node.nodeType as never,
      code: node.code ?? null,
      title: node.title,
      titleKo: node.titleKo ?? null,
      summary: node.summary ?? null,
      gradeLevel: node.gradeLevel ?? null,
      sortOrder: node.sortOrder ?? 0,
      positionX: node.positionX ?? null,
      positionY: node.positionY ?? null,
      metadata: (node.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  for (const [i, obj] of (node.objectives ?? []).entries()) {
    await prisma.learningObjective.create({
      data: {
        nodeId: created.id,
        code: obj.code ?? null,
        statement: obj.statement,
        statementKo: obj.statementKo ?? null,
        masteryCriteria: obj.masteryCriteria ?? null,
        masteryCriteriaKo: obj.masteryCriteriaKo ?? null,
        bloomLevel: obj.bloomLevel ?? null,
        sortOrder: obj.sortOrder ?? i,
        metadata: (obj.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  const resources = node.resources ?? [];
  if (resources.length > 0) {
    await prisma.resource.createMany({
      data: resources.map((r, i) => ({
        nodeId: created.id,
        title: r.title,
        type: r.type as never,
        url: r.url ?? null,
        mimeType: r.mimeType ?? null,
        description: r.description ?? null,
        storageKey: r.storageKey ?? null,
        sortOrder: r.sortOrder ?? i,
        metadata: (r.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
  }

  for (const child of node.children ?? []) {
    await insertNodeTree(frameworkId, child, created.id);
  }
}

async function loadPack(pack: SeedPack): Promise<void> {
  const existing = await prisma.framework.findUnique({
    where: { code: pack.framework.code },
  });
  if (existing) {
    console.log(`↻ Replacing framework ${pack.framework.code}`);
    await prisma.framework.delete({ where: { id: existing.id } });
  }

  const framework = await prisma.framework.create({
    data: {
      code: pack.framework.code,
      name: pack.framework.name,
      nameKo: pack.framework.nameKo ?? null,
      subject: pack.framework.subject as never,
      regionStandard: pack.framework.regionStandard,
      version: pack.framework.version ?? "1.0",
      description: pack.framework.description ?? null,
      metadata: (pack.framework.metadata ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
    },
  });

  await insertNodeTree(framework.id, pack.tree, null);
  console.log(`✓ Loaded ${pack.framework.code}`);
}

async function main() {
  const seedDir = join(__dirname, "seed");
  const files = readdirSync(seedDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No JSON seed packs in ${seedDir}`);
  }

  for (const file of files) {
    const raw = readFileSync(join(seedDir, file), "utf8");
    const pack = JSON.parse(raw) as SeedPack;
    if (!pack.tree) {
      throw new Error(`${file}: missing top-level "tree"`);
    }
    await loadPack(pack);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
