/**
 * Load curriculum packs + demo org/teacher/class/calendar/timetable into PostgreSQL.
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  DEMO_CLASS_ID,
  DEMO_SCHEDULE,
  DEMO_TEACHER_ID,
  buildDemoCalendar,
} from "../lib/schedule/demo-data";

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
    const nodeIds = (
      await prisma.curriculumNode.findMany({
        where: { frameworkId: existing.id },
        select: { id: true },
      })
    ).map((n) => n.id);
    if (nodeIds.length > 0) {
      await prisma.lessonPlan.deleteMany({
        where: { skillNodeId: { in: nodeIds } },
      });
      await prisma.scheduledLesson.deleteMany({
        where: { skillNodeId: { in: nodeIds } },
      });
      await prisma.aiMaterial.deleteMany({
        where: { nodeId: { in: nodeIds } },
      });
    }
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

async function seedDemoSchool(): Promise<void> {
  const org =
    (await prisma.organization.findUnique({ where: { code: "salt-morning" } })) ||
    (await prisma.organization.create({
      data: {
        name: "Salt Morning Academy",
        code: "salt-morning",
        timezone: "Asia/Seoul",
      },
    }));

  const teacher =
    (await prisma.teacher.findFirst({
      where: { organizationId: org.id, externalId: DEMO_TEACHER_ID },
    })) ||
    (await prisma.teacher.create({
      data: {
        externalId: DEMO_TEACHER_ID,
        organizationId: org.id,
        displayName: "Demo Teacher",
        email: "teacher@saltmorning.demo",
      },
    }));

  const klass =
    (await prisma.class.findFirst({
      where: { organizationId: org.id, externalId: DEMO_CLASS_ID },
    })) ||
    (await prisma.class.create({
      data: {
        externalId: DEMO_CLASS_ID,
        organizationId: org.id,
        name: "Grade 4A",
        gradeLevel: "4",
      },
    }));

  // Reset timetable + calendar for idempotent demo seed
  await prisma.scheduledLesson.deleteMany({
    where: { teacherId: teacher.id, classId: klass.id },
  });
  await prisma.teacherSchedule.deleteMany({
    where: { teacherId: teacher.id, classId: klass.id },
  });

  for (const slot of DEMO_SCHEDULE) {
    await prisma.teacherSchedule.create({
      data: {
        teacherId: teacher.id,
        classId: klass.id,
        dayOfWeek: slot.dayOfWeek,
        period: slot.period,
        periodLabel: slot.periodLabel ?? null,
        startTime: slot.startTime ?? null,
        endTime: slot.endTime ?? null,
        subject: slot.subject ?? null,
        frameworkCode: slot.frameworkCode ?? null,
      },
    });
  }

  const existingCal = await prisma.schoolCalendar.findFirst({
    where: { organizationId: org.id, academicYear: "2025-2026" },
  });
  if (existingCal) {
    await prisma.schoolCalendar.delete({ where: { id: existingCal.id } });
  }

  const days = buildDemoCalendar("2026-03-02", 28);
  const start = new Date(`${days[0].date}T00:00:00.000Z`);
  const end = new Date(`${days[days.length - 1].date}T00:00:00.000Z`);

  await prisma.schoolCalendar.create({
    data: {
      organizationId: org.id,
      name: "Demo Spring Window",
      academicYear: "2025-2026",
      startDate: start,
      endDate: end,
      days: {
        create: days.map((d) => ({
          date: new Date(`${d.date}T00:00:00.000Z`),
          dayType: d.dayType,
          title: d.title ?? null,
          isInstructional: d.isInstructional,
        })),
      },
    },
  });

  console.log(
    `✓ Demo school ready — teacher ${DEMO_TEACHER_ID}, class ${DEMO_CLASS_ID}`
  );
}

async function seedSecondOrgPrivatePack(): Promise<void> {
  const org =
    (await prisma.organization.findUnique({ where: { code: "acme-academy" } })) ||
    (await prisma.organization.create({
      data: {
        name: "Acme Academy",
        code: "acme-academy",
        timezone: "America/Los_Angeles",
      },
    }));

  const fw = await prisma.framework.findUnique({
    where: { code: "custom-acme-sel" },
  });
  if (fw) {
    await prisma.framework.update({
      where: { id: fw.id },
      data: {
        organizationId: org.id,
        isPublic: false,
      },
    });
    console.log(`✓ Linked custom-acme-sel → org ${org.code} (private)`);
  }
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

  await seedDemoSchool();
  await seedSecondOrgPrivatePack();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
