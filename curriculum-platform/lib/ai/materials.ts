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

type MaterialItem = {
  section?: string;
  kind?: string;
  student: string;
  teacher?: string;
};

/** Classroom-ready fallbacks teachers can print when Gemini is unavailable. */
function classroomReadyItems(
  type: MaterialType,
  displayTitle: string,
  code: string | null | undefined,
  objective: string,
  useKo: boolean
): MaterialItem[] {
  const label = code || displayTitle;
  if (useKo) {
    if (type === "WORKSHEET") {
      return [
        {
          kind: "지시",
          student: `이름: __________  날짜: __________\n\n오늘의 목표 (${label})\n${objective}\n\n1) 오늘 배울 내용을 한 문장으로 적어 보세요.`,
          teacher: "학생이 목표를 자기 말로 재진술했는지 확인",
        },
        {
          kind: "활동",
          student:
            "2) 본문/문제를 읽고 핵심 근거 두 가지를 찾아 밑줄을 긋거나 메모하세요.\n근거 ①: ______________________________\n근거 ②: ______________________________",
          teacher: "텍스트/문제에서 목표와 직접 연결된 근거인지 확인",
        },
        {
          kind: "적용",
          student:
            "3) 짝과 함께: 이 기능을 교실 상황에 적용한 예시를 만들고 발표할 문장을 쓰세요.\n예시: ______________________________",
          teacher: "목표·숙달 기준과 연결된 예시인지 피드백",
        },
        {
          kind: "점검",
          student:
            "4) 나가기 전 점검\n· 잘된 점: ________________\n· 아직 헷갈리는 점: ________________\n· 다음에 물어볼 질문: ________________",
          teacher: "오개념을 모아 다음 수업 warm-up에 반영",
        },
      ];
    }
    if (type === "FORMATIVE_TEST") {
      return [
        {
          section: "1부",
          student: `1. ${label}의 핵심을 학생 언어로 설명하세요. (2~3문장)`,
          teacher: objective,
        },
        {
          section: "1부",
          student: "2. 이 기능이 드러나는 예시를 하나 쓰고, 왜 맞는지 근거를 적으세요.",
          teacher: "예시 + 목표 연결 근거",
        },
        {
          section: "1부",
          student: "3. 참/거짓: 정확한 용어 없이도 숙달을 완전히 보여줄 수 있다. → 이유:",
          teacher: "거짓 — 정확한 언어 사용도 숙달의 일부",
        },
        {
          section: "2부",
          student:
            "4. 서술형: 오늘 배운 기능을 친구 교실 장면에 적용하는 방법을 단계적으로 설명하세요.",
          teacher: "단계(준비→실행→점검)와 목표 연결",
        },
      ];
    }
    return [
      {
        student: `1. 한 문장으로: ${label}에서 오늘 꼭 기억할 점은?`,
        teacher: objective,
      },
      {
        student: "2. 보기 중 목표에 가장 잘 맞는 활동을 고르고 이유를 쓰세요.\n(a) 암기만 하기  (b) 근거 들어 설명하기  (c) 관련 없는 이야기하기",
        teacher: "(b) — 목표에 맞는 근거 기반 설명",
      },
      {
        student: "3. 나가기 티켓: 아직 헷갈리는 점 한 가지와, 내일 확인할 방법을 적으세요.",
        teacher: "오개념·다음 질문 수집",
      },
    ];
  }

  // English
  if (type === "WORKSHEET") {
    return [
      {
        kind: "Directions",
        student: `Name: __________  Date: __________\n\nToday's goal (${label})\n${objective}\n\n1) Restate today's goal in your own words (1 sentence).`,
        teacher: "Check that the student paraphrase matches the objective",
      },
      {
        kind: "Practice",
        student:
          "2) Read the assigned text/problem. Underline or note two pieces of evidence that connect to the goal.\nEvidence 1: ______________________________\nEvidence 2: ______________________________",
        teacher: "Evidence must directly support the standard",
      },
      {
        kind: "Apply",
        student:
          "3) With a partner: invent a short classroom example that uses this skill. Write the sentence you will share.\nExample: ______________________________",
        teacher: "Example must show the skill in action",
      },
      {
        kind: "Check",
        student:
          "4) Exit check\n· One thing I did well: ________________\n· One thing still confusing: ________________\n· One question for next class: ________________",
        teacher: "Collect misconceptions for next warm-up",
      },
    ];
  }
  if (type === "FORMATIVE_TEST") {
    return [
      {
        section: "Part 1",
        student: `1. In 2–3 sentences, explain the core idea of ${label} in student-friendly language.`,
        teacher: objective,
      },
      {
        section: "Part 1",
        student: "2. Give one example that shows this skill. Explain why your example fits.",
        teacher: "Example + explicit link to the standard",
      },
      {
        section: "Part 1",
        student:
          "3. True/False + why: Students can fully show mastery without using precise vocabulary.",
        teacher: "False — precise language is part of mastery",
      },
      {
        section: "Part 2",
        student:
          "4. Written response: Describe how you would apply today's skill in a short classroom scenario (steps).",
        teacher: "Clear steps (prepare → do → check) tied to the objective",
      },
    ];
  }
  return [
    {
      student: `1. One sentence: What is the most important idea in ${label} today?`,
      teacher: objective,
    },
    {
      student:
        "2. Choose the best activity for this goal and explain why.\n(a) Memorize only  (b) Explain with evidence  (c) Tell an unrelated story",
      teacher: "(b) — evidence-based explanation matches the goal",
    },
    {
      student:
        "3. Exit ticket: One thing still confusing + how you will check it tomorrow.",
      teacher: "Collect misconceptions / next questions",
    },
  ];
}

function geminiSystemPrompt(type: MaterialType, useKo: boolean): string {
  if (useKo) {
    return `당신은 초·중등 교사입니다. 학생이 받아 바로 풀 수 있는 ${type} 자료를 JSON으로만 만드세요.
형식: { "items": [ { "section?": string, "kind?": string, "student": "학생용 문항/지문/지시 (개행 포함 가능)", "teacher": "교사 정답·채점 포인트" } ] }
규칙:
- 메타 지시("핵심을 설명하세요"만) 금지. 실제 풀 문항·짧은 지문·연습 활동을 넣을 것.
- 문항 4~6개. student 필드는 수업 유인물에 그대로 인쇄 가능해야 함.
- teacher 필드에만 정답/채점 기준.`;
  }
  return `You are a K-12 classroom teacher. Create a printable ${type} students can complete in class. JSON only.
Shape: { "items": [ { "section?": string, "kind?": string, "student": "student-facing prompt/passage/item", "teacher": "answer key / scoring note" } ] }
Rules:
- No meta prompts like "restate the standard code". Write real tasks (short passage, questions, practice steps).
- 4–6 items. "student" must be handout-ready.
- Put answers only in "teacher".`;
}

function normalizeItems(raw: unknown, fallback: MaterialItem[]): MaterialItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const out: MaterialItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const student =
      (typeof r.student === "string" && r.student) ||
      (typeof r.q === "string" && r.q) ||
      (typeof r.question === "string" && r.question) ||
      (typeof r.prompt === "string" && r.prompt) ||
      (typeof r.text === "string" && r.text) ||
      "";
    if (!student.trim()) continue;
    const teacher =
      (typeof r.teacher === "string" && r.teacher) ||
      (typeof r.a === "string" && r.a) ||
      (typeof r.answer === "string" && r.answer) ||
      (typeof r.sampleAnswer === "string" && r.sampleAnswer) ||
      undefined;
    out.push({
      section: typeof r.section === "string" ? r.section : undefined,
      kind: typeof r.kind === "string" ? r.kind : undefined,
      student: student.trim(),
      teacher: teacher?.trim(),
    });
  }
  return out.length > 0 ? out : fallback;
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
  const mastery = masteryDisplay(node.objectives[0] || {}, localeOpts);

  const fallback = classroomReadyItems(
    type,
    displayTitle,
    node.code,
    objective,
    useKo
  );
  let items: MaterialItem[] = fallback;
  let model = "classroom-template-v2";
  let provider: "gemini" | "template" = "template";

  if (isGeminiConfigured()) {
    try {
      const { text, model: used } = await askGemini(
        JSON.stringify({
          type,
          language: useKo ? "ko" : "en",
          gradeLevel: node.gradeLevel,
          skill: {
            code: node.code,
            title: displayTitle,
            summary: node.summary,
            objective,
            masteryCriteria: mastery,
          },
        }),
        {
          model: materialsModel(),
          systemInstruction: geminiSystemPrompt(type, useKo),
          json: true,
          temperature: 0.55,
          maxOutputTokens: 3072,
        }
      );
      const parsed = parseGeminiJson<{ items?: unknown }>(text);
      items = normalizeItems(parsed.items, fallback);
      if (parsed.items) {
        model = used || materialsModel();
        provider = "gemini";
      }
    } catch {
      // keep classroom templates
    }
  }

  return {
    id: slugId("mat", nodeId, type, Date.now()),
    nodeId,
    type,
    title: `${type.replaceAll("_", " ")} · ${node.code || displayTitle}`,
    contentJson: {
      locale: useKo ? "ko" : "en",
      provider,
      standardCode: node.code,
      objective,
      masteryCriteria: mastery,
      handout: "student",
      items,
    },
    model,
    createdAt: new Date().toISOString(),
  };
}
