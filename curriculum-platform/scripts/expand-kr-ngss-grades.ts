/**
 * Add KR Korean G3 and NGSS G5 sample grades.
 * Run: npx tsx scripts/expand-kr-ngss-grades.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const seed = join(process.cwd(), "prisma/seed");

function koSkill(
  code: string,
  title: string,
  titleKo: string,
  grade: string,
  summary: string,
  statement: string,
  statementKo: string,
  mastery: string,
  masteryKo: string,
  bloom: string,
  sort: number
) {
  return {
    nodeType: "SKILL",
    code,
    title,
    titleKo,
    gradeLevel: grade,
    sortOrder: sort,
    summary,
    objectives: [
      {
        statement,
        statementKo,
        masteryCriteria: mastery,
        masteryCriteriaKo: masteryKo,
        bloomLevel: bloom,
        sortOrder: 1,
      },
    ],
    resources: [],
  };
}

const koreanPath = join(seed, "kr2022-korean-grade-4.json");
const korean = JSON.parse(readFileSync(koreanPath, "utf8"));

if (!korean.tree.children.some((c: { gradeLevel: string }) => c.gradeLevel === "3")) {
  korean.tree.children.unshift({
    nodeType: "GRADE",
    code: "G3",
    title: "Grade 3 / 초등학교 3학년",
    titleKo: "초등학교 3학년",
    gradeLevel: "3",
    sortOrder: 3,
    metadata: { gradeBand: "3-4" },
    children: [
      {
        nodeType: "DOMAIN",
        code: "3국01",
        title: "Listening · Speaking / 듣기·말하기",
        titleKo: "듣기·말하기",
        gradeLevel: "3",
        sortOrder: 1,
        children: [
          {
            nodeType: "CONCEPT",
            code: "3국01-대화",
            title: "Listening with care",
            titleKo: "상대를 배려하며 듣기",
            gradeLevel: "3",
            sortOrder: 1,
            children: [
              koSkill(
                "3국01-01",
                "Listen carefully and retell key points",
                "집중하여 듣고 핵심 내용 말하기",
                "3",
                "상대의 말을 집중하여 듣고 핵심 내용을 간단히 말한다.",
                "Students retell 2–3 key points after listening.",
                "들은 내용의 핵심을 2–3가지로 말한다.",
                "Retell includes ≥2 accurate key points.",
                "핵심 내용 2가지 이상 정확히 포함.",
                "Understand",
                1
              ),
              koSkill(
                "3국01-02",
                "Ask a clarifying question in conversation",
                "대화에서 확인 질문하기",
                "3",
                "대화 중 이해가 부족한 부분을 정중히 묻는다.",
                "Students ask one clarifying question related to the speaker’s message.",
                "상대 말과 관련된 확인 질문을 한 가지 한다.",
                "Question is on-topic and politely phrased.",
                "주제와 관련되고 예절 바른 질문.",
                "Apply",
                2
              ),
            ],
          },
        ],
      },
      {
        nodeType: "DOMAIN",
        code: "3국02",
        title: "Reading / 읽기",
        titleKo: "읽기",
        gradeLevel: "3",
        sortOrder: 2,
        children: [
          {
            nodeType: "CONCEPT",
            code: "3국02-내용",
            title: "Finding main ideas",
            titleKo: "중심 내용 찾기",
            gradeLevel: "3",
            sortOrder: 1,
            children: [
              koSkill(
                "3국02-01",
                "Identify the main idea of a short text",
                "짧은 글의 중심 내용 찾기",
                "3",
                "짧은 글에서 중심 내용을 찾아 말한다.",
                "Students state the main idea of a short grade-level text.",
                "짧은 글의 중심 내용을 한 문장으로 말한다.",
                "Main-idea statement is text-supported.",
                "글에 근거한 중심 내용 진술.",
                "Understand",
                1
              ),
            ],
          },
        ],
      },
    ],
  });
  korean.framework.description =
    "대한민국 2022 개정 교육과정 국어과 성취기준 샘플. 초등학교 3–4학년군 샘플(듣기·말하기·읽기 등). 실제 고시 문언은 교육부 PDF를 기준으로 검수·확장하세요.";
  korean.framework.metadata = {
    ...(korean.framework.metadata || {}),
    gradeBand: "3-4",
  };
  writeFileSync(koreanPath, JSON.stringify(korean, null, 2) + "\n");
  console.log("✓ korean grades:", korean.tree.children.map((c: { gradeLevel: string }) => c.gradeLevel).join(","));
} else {
  console.log("korean G3 already present");
}

const ngssPath = join(seed, "ngss-science-grade-4.json");
const ngss = JSON.parse(readFileSync(ngssPath, "utf8"));

if (!ngss.tree.children.some((c: { gradeLevel: string }) => c.gradeLevel === "5")) {
  function pe(
    code: string,
    title: string,
    titleKo: string,
    summary: string,
    statement: string,
    mastery: string,
    bloom: string,
    sort: number
  ) {
    return {
      nodeType: "SKILL",
      code,
      title,
      titleKo,
      gradeLevel: "5",
      sortOrder: sort,
      summary,
      objectives: [
        {
          statement,
          masteryCriteria: mastery,
          bloomLevel: bloom,
          sortOrder: 1,
        },
      ],
      resources: [],
    };
  }

  ngss.tree.children.push({
    nodeType: "GRADE",
    code: "G5",
    title: "Grade 5",
    titleKo: "5학년",
    gradeLevel: "5",
    sortOrder: 5,
    children: [
      {
        nodeType: "DOMAIN",
        code: "5-PS1",
        title: "Matter and Its Interactions",
        titleKo: "물질과 그 상호작용",
        gradeLevel: "5",
        sortOrder: 1,
        children: [
          {
            nodeType: "CONCEPT",
            code: "5-PS1-A",
            title: "Structure and Properties of Matter",
            titleKo: "물질의 구조와 성질",
            gradeLevel: "5",
            sortOrder: 1,
            children: [
              pe(
                "5-PS1-1",
                "Develop a model that matter is made of particles too small to be seen",
                "눈에 보이지 않는 입자로 물질을 모형화하기",
                "Develop a model to describe that matter is made of particles too small to be seen.",
                "Students use a particle model to explain a phenomenon (e.g., dissolving, air).",
                "Model + explanation cites particles for 1 phenomenon.",
                "Understand",
                1
              ),
              pe(
                "5-PS1-3",
                "Make observations to identify materials based on properties",
                "성질을 관찰해 물질 구별하기",
                "Make observations and measurements to identify materials based on their properties.",
                "Students identify a material using ≥2 measurable/observable properties.",
                "Correct identification with 2 property citations.",
                "Apply",
                2
              ),
            ],
          },
        ],
      },
      {
        nodeType: "DOMAIN",
        code: "5-ESS2",
        title: "Earth's Systems",
        titleKo: "지구의 시스템",
        gradeLevel: "5",
        sortOrder: 2,
        children: [
          {
            nodeType: "CONCEPT",
            code: "5-ESS2-A",
            title: "Earth Materials and Systems",
            titleKo: "지구 물질과 시스템",
            gradeLevel: "5",
            sortOrder: 1,
            children: [
              pe(
                "5-ESS2-1",
                "Develop a model of ways the geosphere, biosphere, hydrosphere, and/or atmosphere interact",
                "지구 영역 간 상호작용 모형 만들기",
                "Develop a model using an example to describe ways the geosphere, biosphere, hydrosphere, and/or atmosphere interact.",
                "Students diagram an interaction between at least two Earth systems.",
                "Diagram names ≥2 systems and one interaction.",
                "Apply",
                1
              ),
            ],
          },
        ],
      },
    ],
  });
  ngss.framework.description =
    "NGSS sample pack for Grade 4 (energy + Earth) and Grade 5 (matter + Earth systems). Expand with full PE/DCI/CCC/SEP metadata as needed.";
  writeFileSync(ngssPath, JSON.stringify(ngss, null, 2) + "\n");
  console.log("✓ ngss grades:", ngss.tree.children.map((c: { gradeLevel: string }) => c.gradeLevel).join(","));
} else {
  console.log("ngss G5 already present");
}
