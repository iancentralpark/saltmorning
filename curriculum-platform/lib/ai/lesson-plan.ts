import type { CurriculumNode, LessonPlan, ScheduledLesson } from "@/lib/types";
import { getCurriculumRepository } from "@/lib/curriculum/repository";
import {
  masteryDisplay,
  nodeDisplayTitle,
  objectiveDisplayStatement,
  usesKoreanContent,
} from "@/lib/i18n/content-locale";
import { slugId } from "@/lib/utils";

function fallbackPlan(
  lesson: ScheduledLesson,
  skill: CurriculumNode
): Omit<LessonPlan, "id" | "generatedAt" | "model" | "status"> {
  const localeOpts = { frameworkCode: skill.frameworkCode };
  const useKo = usesKoreanContent(null, skill.frameworkCode);
  const objective =
    objectiveDisplayStatement(
      skill.objectives[0] || { statement: skill.summary || skill.title },
      localeOpts
    ) ||
    skill.summary ||
    skill.title;

  const displayTitle = nodeDisplayTitle(skill, localeOpts);
  const code = skill.code ? ` (${skill.code})` : "";
  const mastery =
    masteryDisplay(skill.objectives[0] || {}, localeOpts) ||
    (useKo
      ? "정확한 적용과 설명"
      : "accurate application with explanation");

  return {
    scheduledLessonId: lesson.id,
    teacherExternalId: lesson.teacherExternalId,
    classExternalId: lesson.classExternalId,
    skillNodeId: skill.id,
    lessonDate: lesson.scheduledDate,
    period: lesson.period,
    title: `${displayTitle}${code}`,
    warmUp: useKo
      ? `${displayTitle}와 관련된 4분 활성화 활동. 학습 목표 예시: ${objective}`
      : `Activate prior knowledge with a 4-minute prompt tied to ${displayTitle}. Ask students to write one real-world example related to: ${objective}`,
    instruction: useKo
      ? `${displayTitle} 직접 교수(12–15분). 예제 2개 시범. 표준 코드${code} 언어를 강조한다.`
      : `Direct instruction (12–15 min) on ${displayTitle}. Model 2 worked examples. Highlight standard language${code}. Address misconceptions from the warm-up.`,
    guidedPractice: useKo
      ? `짝 활동으로 안내 연습 3–4문항. 순회 지도. 성공 기준: ${mastery}`
      : `Students complete 3–4 guided items in pairs. Circulate with targeted questions. Success look-for: ${mastery}.`,
    formativeAssessment: useKo
      ? `출구 점검: ${skill.code || displayTitle}에 맞춘 문항 2개(절차 1, 설명 1).`
      : `Exit check: 2 items (1 procedural, 1 explain-your-thinking) aligned to ${
          skill.code || displayTitle
        }. Collect for feedback before next instructional day.`,
    closure: useKo
      ? `오늘 학습 목표를 한 문장으로 말해 보게 하고 다음 차시를 예고한다.`
      : `Student restates today's objective in one sentence. Preview tomorrow's skill in the sequence.`,
    materials:
      skill.resources.map((r) => r.title).join("; ") ||
      (useKo
        ? "칠판, 학습장, 출구 티켓"
        : "Whiteboard, student notebooks, exit tickets"),
    contentJson: {
      skillCode: skill.code,
      locale: useKo ? "ko" : "en",
      objectives: skill.objectives,
      sections: [
        "warmUp",
        "instruction",
        "guidedPractice",
        "formativeAssessment",
        "closure",
      ],
    },
  };
}

async function tryOpenAIPlan(
  lesson: ScheduledLesson,
  skill: CurriculumNode
): Promise<(Omit<LessonPlan, "id" | "generatedAt" | "status"> & { model: string }) | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const useKo = usesKoreanContent(null, skill.frameworkCode);
    const localeOpts = { frameworkCode: skill.frameworkCode };

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: useKo
            ? "당신은 K-12 수업 설계 전문가입니다. JSON 키: title, warmUp, instruction, guidedPractice, formativeAssessment, closure, materials. 각 섹션은 2–4문장으로 한국어로 작성하세요."
            : "You are an expert K-12 lesson planner. Return JSON with keys: title, warmUp, instruction, guidedPractice, formativeAssessment, closure, materials. Keep each section concise (2-4 sentences) in English.",
        },
        {
          role: "user",
          content: JSON.stringify({
            date: lesson.scheduledDate,
            period: lesson.period,
            language: useKo ? "ko" : "en",
            skill: {
              code: skill.code,
              title: nodeDisplayTitle(skill, localeOpts),
              summary: skill.summary,
              objectives: skill.objectives.map((o) => ({
                code: o.code,
                statement: objectiveDisplayStatement(o, localeOpts),
                masteryCriteria: masteryDisplay(o, localeOpts),
              })),
            },
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    const base = fallbackPlan(lesson, skill);

    return {
      ...base,
      title: parsed.title || base.title,
      warmUp: parsed.warmUp || base.warmUp,
      instruction: parsed.instruction || base.instruction,
      guidedPractice: parsed.guidedPractice || base.guidedPractice,
      formativeAssessment: parsed.formativeAssessment || base.formativeAssessment,
      closure: parsed.closure || base.closure,
      materials: parsed.materials || base.materials,
      contentJson: { ...base.contentJson, ai: parsed },
      model: completion.model,
    };
  } catch {
    return null;
  }
}

export async function generateLessonPlan(
  lesson: ScheduledLesson
): Promise<LessonPlan> {
  const skill = await getCurriculumRepository().getNode(lesson.skillNodeId);
  if (!skill) {
    throw new Error(`Skill node not found: ${lesson.skillNodeId}`);
  }

  const ai = await tryOpenAIPlan(lesson, skill);
  const body = ai ?? { ...fallbackPlan(lesson, skill), model: "deterministic-v1" };

  return {
    id: slugId("lp", lesson.id),
    ...body,
    status: "GENERATED",
    generatedAt: new Date().toISOString(),
  };
}
