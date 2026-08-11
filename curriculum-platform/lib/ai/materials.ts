import { getCurriculumRepository } from "@/lib/curriculum/repository";
import {
  masteryDisplay,
  nodeDisplayTitle,
  objectiveDisplayStatement,
  usesKoreanContent,
} from "@/lib/i18n/content-locale";
import {
  askGemini,
  isGeminiConfigured,
  materialsModel,
  parseGeminiJson,
} from "@/lib/ai/gemini";
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

function deterministicItems(
  type: MaterialType,
  displayTitle: string,
  code: string | null | undefined,
  objective: string,
  useKo: boolean
) {
  return useKo
    ? type === "DAILY_QUIZ" || type === "EXIT_TICKET"
      ? [
          {
            q: `간단 점검: ${code || displayTitle}의 핵심을 한 문장으로 설명하세요.`,
            a: objective,
          },
          {
            q: `${code || displayTitle}를 짧은 교실 상황에 적용해 보세요.`,
            a: "숙달 기준에 맞는 예시 답안",
          },
          {
            q: "참/거짓: 표준 용어 없이도 숙달을 보여줄 수 있다.",
            a: "거짓 — 정확한 언어 사용도 숙달의 일부이다.",
          },
        ]
      : type === "WORKSHEET"
        ? [
            { prompt: `${displayTitle} 연습 세트 A`, items: 6 },
            { prompt: `${objective}와 연결된 도전 문제`, items: 1 },
          ]
        : [
            {
              section: "1부",
              prompt: `${code || displayTitle} 형성평가 문항`,
              count: 5,
            },
            {
              section: "2부",
              prompt: "생각을 설명하는 서술형",
              count: 1,
            },
          ]
    : type === "DAILY_QUIZ" || type === "EXIT_TICKET"
      ? [
          {
            q: `Quick check: explain the core idea of ${code || displayTitle} in one sentence.`,
            a: objective,
          },
          {
            q: `Apply ${code || displayTitle} to a short classroom scenario.`,
            a: "Sample response aligned to mastery criteria.",
          },
          {
            q: `True/False: students can demonstrate mastery without using standard vocabulary.`,
            a: "False — precise language is part of mastery.",
          },
        ]
      : type === "WORKSHEET"
        ? [
            { prompt: `Practice set A for ${displayTitle}`, items: 6 },
            { prompt: `Challenge problem tied to ${objective}`, items: 1 },
          ]
        : [
            {
              section: "Part 1",
              prompt: `Formative items for ${code || displayTitle}`,
              count: 5,
            },
            {
              section: "Part 2",
              prompt: "Explain-your-thinking written response",
              count: 1,
            },
          ];
}

export async function generateAiMaterial(
  nodeId: string,
  type: MaterialType
): Promise<AiMaterial> {
  const node = await getCurriculumRepository().getNode(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  const localeOpts = { frameworkCode: node.frameworkCode };
  const useKo = usesKoreanContent(null, node.frameworkCode);
  const displayTitle = nodeDisplayTitle(node, localeOpts);
  const objective =
    objectiveDisplayStatement(
      node.objectives[0] || { statement: node.summary || node.title },
      localeOpts
    ) ||
    node.summary ||
    displayTitle;

  let items: unknown = deterministicItems(
    type,
    displayTitle,
    node.code,
    objective,
    useKo
  );
  let model = "deterministic-v1";

  if (isGeminiConfigured()) {
    try {
      const systemInstruction = useKo
        ? `K-12 형성평가 문항을 만드세요. JSON만 반환: { "items": [...] }. 유형=${type}. 문항 3~6개.`
        : `Create K-12 formative items. Return JSON only: { "items": [...] }. type=${type}. 3-6 items.`;
      const { text, model: used } = await askGemini(
        JSON.stringify({
          type,
          language: useKo ? "ko" : "en",
          skill: {
            code: node.code,
            title: displayTitle,
            objective,
            masteryCriteria: masteryDisplay(
              node.objectives[0] || {},
              localeOpts
            ),
          },
        }),
        {
          model: materialsModel(),
          systemInstruction,
          json: true,
          temperature: 0.5,
          maxOutputTokens: 2048,
        }
      );
      const parsed = parseGeminiJson<{ items?: unknown }>(text);
      if (parsed.items) {
        items = parsed.items;
        model = used || materialsModel();
      }
    } catch {
      // keep deterministic items
    }
  }

  return {
    id: slugId("mat", nodeId, type, Date.now()),
    nodeId,
    type,
    title: `${type.replaceAll("_", " ")} · ${node.code || displayTitle}`,
    contentJson: {
      locale: useKo ? "ko" : "en",
      provider: isGeminiConfigured() ? "gemini" : "deterministic",
      standardCode: node.code,
      objective,
      masteryCriteria: masteryDisplay(node.objectives[0] || {}, localeOpts),
      items,
    },
    model,
    createdAt: new Date().toISOString(),
  };
}
