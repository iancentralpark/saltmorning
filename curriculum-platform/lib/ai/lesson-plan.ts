import type { CurriculumNode, LessonPlan, ScheduledLesson } from "@/lib/types";
import { getNode } from "@/lib/curriculum/seed-loader";
import { slugId } from "@/lib/utils";

function fallbackPlan(
  lesson: ScheduledLesson,
  skill: CurriculumNode
): Omit<LessonPlan, "id" | "generatedAt" | "model" | "status"> {
  const objective =
    skill.objectives[0]?.statementKo ||
    skill.objectives[0]?.statement ||
    skill.summary ||
    skill.title;

  const code = skill.code ? ` (${skill.code})` : "";

  return {
    scheduledLessonId: lesson.id,
    teacherExternalId: lesson.teacherExternalId,
    classExternalId: lesson.classExternalId,
    skillNodeId: skill.id,
    lessonDate: lesson.scheduledDate,
    period: lesson.period,
    title: `${skill.titleKo || skill.title}${code}`,
    warmUp: `Activate prior knowledge with a 4-minute prompt tied to ${skill.title}. Ask students to write one real-world example related to: ${objective}`,
    instruction: `Direct instruction (12–15 min) on ${skill.title}. Model 2 worked examples. Highlight standard language${code}. Address misconceptions from the warm-up.`,
    guidedPractice: `Students complete 3–4 guided items in pairs. Circulate with targeted questions. Success look-for: ${
      skill.objectives[0]?.masteryCriteriaKo ||
      skill.objectives[0]?.masteryCriteria ||
      "accurate application with explanation"
    }.`,
    formativeAssessment: `Exit check: 2 items (1 procedural, 1 explain-your-thinking) aligned to ${
      skill.code || skill.title
    }. Collect for feedback before next instructional day.`,
    closure: `Student restates today's objective in one sentence. Preview tomorrow's skill in the sequence.`,
    materials: skill.resources.map((r) => r.title).join("; ") || "Whiteboard, student notebooks, exit tickets",
    contentJson: {
      skillCode: skill.code,
      objectives: skill.objectives,
      sections: ["warmUp", "instruction", "guidedPractice", "formativeAssessment", "closure"],
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

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert K-12 lesson planner. Return JSON with keys: title, warmUp, instruction, guidedPractice, formativeAssessment, closure, materials. Keep each section concise (2-4 sentences).",
        },
        {
          role: "user",
          content: JSON.stringify({
            date: lesson.scheduledDate,
            period: lesson.period,
            skill: {
              code: skill.code,
              title: skill.title,
              titleKo: skill.titleKo,
              summary: skill.summary,
              objectives: skill.objectives,
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
  const skill = getNode(lesson.skillNodeId);
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
