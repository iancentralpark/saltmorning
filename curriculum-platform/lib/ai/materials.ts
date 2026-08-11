import { getNode } from "@/lib/curriculum/seed-loader";
import type { AiMaterial } from "@/lib/types";
import { slugId } from "@/lib/utils";

const MATERIAL_TYPES = [
  "DAILY_QUIZ",
  "FORMATIVE_TEST",
  "WORKSHEET",
  "EXIT_TICKET",
  "WARM_UP",
] as const;

export type MaterialType = (typeof MATERIAL_TYPES)[number];

export function isMaterialType(v: string): v is MaterialType {
  return (MATERIAL_TYPES as readonly string[]).includes(v);
}

export async function generateAiMaterial(
  nodeId: string,
  type: MaterialType
): Promise<AiMaterial> {
  const node = getNode(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  const objective =
    node.objectives[0]?.statementKo ||
    node.objectives[0]?.statement ||
    node.summary ||
    node.title;

  const items =
    type === "DAILY_QUIZ" || type === "EXIT_TICKET"
      ? [
          {
            q: `Quick check: explain the core idea of ${node.code || node.title} in one sentence.`,
            a: objective,
          },
          {
            q: `Apply ${node.code || node.title} to a short classroom scenario.`,
            a: "Sample response aligned to mastery criteria.",
          },
          {
            q: `True/False: students can demonstrate mastery without using standard vocabulary.`,
            a: "False — precise language is part of mastery.",
          },
        ]
      : type === "WORKSHEET"
        ? [
            { prompt: `Practice set A for ${node.title}`, items: 6 },
            { prompt: `Challenge problem tied to ${objective}`, items: 1 },
          ]
        : [
            {
              section: "Part 1",
              prompt: `Formative items for ${node.code || node.title}`,
              count: 5,
            },
            {
              section: "Part 2",
              prompt: "Explain-your-thinking written response",
              count: 1,
            },
          ];

  return {
    id: slugId("mat", nodeId, type, Date.now()),
    nodeId,
    type,
    title: `${type.replaceAll("_", " ")} · ${node.code || node.title}`,
    contentJson: {
      standardCode: node.code,
      objective,
      masteryCriteria:
        node.objectives[0]?.masteryCriteriaKo ||
        node.objectives[0]?.masteryCriteria ||
        null,
      items,
    },
    model: process.env.OPENAI_API_KEY ? "openai-or-fallback" : "deterministic-v1",
    createdAt: new Date().toISOString(),
  };
}
