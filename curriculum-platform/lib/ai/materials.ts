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
  const label = code || displayTitle;
  if (useKo) {
    if (type === "WORKSHEET") {
      return [
        {
          prompt: `${label} — 핵심 개념을 자신의 말로 정리하세요.`,
          sampleAnswer: objective,
        },
        {
          prompt: `${label}를 활용한 연습 문제 하나를 풀고 풀이 과정을 쓰세요.`,
          sampleAnswer: "풀이 과정과 최종 답을 제시한다.",
        },
        {
          prompt: "오늘 배운 내용을 친구 상황에 적용한 예시를 쓰세요.",
          sampleAnswer: "숙달 기준에 맞는 예시 답안",
        },
        {
          prompt: "아직 헷갈리는 점과 다음에 확인할 질문을 적으세요.",
          sampleAnswer: "자기 점검 질문 1개 이상",
        },
      ];
    }
    if (type === "FORMATIVE_TEST") {
      return [
        {
          section: "1부",
          q: `${label}의 핵심을 설명하세요.`,
          a: objective,
        },
        {
          section: "1부",
          q: `${label}와 관련된 예를 하나 드세요.`,
          a: "표준과 연결된 구체적 예시",
        },
        {
          section: "1부",
          q: "참/거짓: 정확한 용어 없이도 숙달을 보여줄 수 있다.",
          a: "거짓 — 정확한 언어 사용도 숙달의 일부이다.",
        },
        {
          section: "2부",
          q: "생각을 설명하는 서술형: 이 기능을 교실 상황에 어떻게 적용할까요?",
          a: "숙달 기준에 맞는 근거 있는 설명",
        },
      ];
    }
    // DAILY_QUIZ / EXIT_TICKET / WARM_UP
    return [
      {
        q: `간단 점검: ${label}의 핵심을 한 문장으로 설명하세요.`,
        a: objective,
      },
      {
        q: `${label}를 짧은 교실 상황에 적용해 보세요.`,
        a: "숙달 기준에 맞는 예시 답안",
      },
      {
        q: "참/거짓: 표준 용어 없이도 숙달을 보여줄 수 있다.",
        a: "거짓 — 정확한 언어 사용도 숙달의 일부이다.",
      },
    ];
  }

  if (type === "WORKSHEET") {
    return [
      {
        prompt: `${label} — restate the core idea in your own words.`,
        sampleAnswer: objective,
      },
      {
        prompt: `Solve one practice problem that uses ${label}. Show your work.`,
        sampleAnswer: "Work + final answer aligned to the standard.",
      },
      {
        prompt: "Give a real-world or classroom example that applies today's skill.",
        sampleAnswer: "Concrete example tied to mastery criteria.",
      },
      {
        prompt: "Write one question you still have and how you will check it.",
        sampleAnswer: "Self-check question + next step.",
      },
    ];
  }
  if (type === "FORMATIVE_TEST") {
    return [
      {
        section: "Part 1",
        q: `Explain the core idea of ${label}.`,
        a: objective,
      },
      {
        section: "Part 1",
        q: `Give one example that shows ${label} in action.`,
        a: "Concrete example connected to the standard.",
      },
      {
        section: "Part 1",
        q: `True/False: students can demonstrate mastery without using standard vocabulary.`,
        a: "False — precise language is part of mastery.",
      },
      {
        section: "Part 2",
        q: "Explain-your-thinking: How would you apply this skill in a short classroom scenario?",
        a: "Evidence-based response aligned to mastery criteria.",
      },
    ];
  }
  return [
    {
      q: `Quick check: explain the core idea of ${label} in one sentence.`,
      a: objective,
    },
    {
      q: `Apply ${label} to a short classroom scenario.`,
      a: "Sample response aligned to mastery criteria.",
    },
    {
      q: `True/False: students can demonstrate mastery without using standard vocabulary.`,
      a: "False — precise language is part of mastery.",
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
