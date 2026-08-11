/**
 * Broaden sample packs toward fuller K–12 coverage (still sample depth).
 * - CCSS Math G7–G8
 * - CCSS ELA G3 + G5
 * - KR 국어 G5–G6 band
 * - KR 한국사 middle-school slice (G5)
 * Run: npx tsx scripts/expand-k12-breadth.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const seed = join(process.cwd(), "prisma/seed");

function skill(
  code: string,
  title: string,
  titleKo: string,
  grade: string,
  summary: string,
  statement: string,
  mastery: string,
  bloom = "Apply",
  sort = 1,
  extra: Record<string, unknown> = {}
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
        masteryCriteria: mastery,
        bloomLevel: bloom,
        sortOrder: 1,
        ...extra,
      },
    ],
    resources: [],
  };
}

function gradeBand(
  level: string,
  sortOrder: number,
  title: string,
  titleKo: string,
  domainCode: string,
  domainTitle: string,
  domainTitleKo: string,
  skills: ReturnType<typeof skill>[],
  metadata?: Record<string, unknown>
) {
  return {
    nodeType: "GRADE",
    code: `G${level}`,
    title,
    titleKo,
    gradeLevel: level,
    sortOrder,
    metadata,
    children: [
      {
        nodeType: "DOMAIN",
        code: domainCode,
        title: domainTitle,
        titleKo: domainTitleKo,
        gradeLevel: level,
        sortOrder: 1,
        children: [
          {
            nodeType: "CONCEPT",
            code: `${domainCode}.Core`,
            title: domainTitle,
            titleKo: domainTitleKo,
            gradeLevel: level,
            sortOrder: 1,
            children: skills,
          },
        ],
      },
    ],
  };
}

function ensureGrade(
  pack: { tree: { children: Array<{ gradeLevel?: string }> } },
  node: ReturnType<typeof gradeBand>
) {
  if (pack.tree.children.some((c) => c.gradeLevel === node.gradeLevel)) return false;
  pack.tree.children.push(node);
  pack.tree.children.sort(
    (a, b) => Number(a.gradeLevel) - Number(b.gradeLevel)
  );
  return true;
}

// —— Math G7–G8 ——
const mathPath = join(seed, "ccss-math-grade-4.json");
const math = JSON.parse(readFileSync(mathPath, "utf8"));
let added = 0;
if (
  ensureGrade(
    math,
    gradeBand(
      "7",
      7,
      "Grade 7",
      "7학년",
      "7.RP",
      "Ratios & Proportional Relationships",
      "비와 비례 관계",
      [
        skill(
          "7.RP.A.2",
          "Recognize and represent proportional relationships",
          "비례 관계 인식·표현하기",
          "7",
          "Recognize and represent proportional relationships between quantities.",
          "Students identify a proportional relationship and write an equation y=kx.",
          "Correct constant of proportionality for 4 of 5 tables.",
          "Analyze",
          1
        ),
        skill(
          "7.EE.B.4",
          "Use variables to represent quantities in real-world problems",
          "실생활 문제에서 변수로 양 나타내기",
          "7",
          "Use variables to represent quantities and construct simple equations and inequalities.",
          "Students write and solve a one-variable equation for a word problem.",
          "Correct equation + solution for 4 of 5 items.",
          "Apply",
          2
        ),
        skill(
          "7.NS.A.3",
          "Solve real-world problems with rational numbers",
          "유리수로 실생활 문제 해결하기",
          "7",
          "Solve real-world and mathematical problems involving the four operations with rational numbers.",
          "Students compute with signed rationals in a multi-step context.",
          "≥80% on mixed rational-number set.",
          "Apply",
          3
        ),
      ]
    )
  )
)
  added += 1;

if (
  ensureGrade(
    math,
    gradeBand(
      "8",
      8,
      "Grade 8",
      "8학년",
      "8.F",
      "Functions",
      "함수",
      [
        skill(
          "8.F.A.1",
          "Understand that a function assigns exactly one output",
          "함수가 하나의 출력을 대응시킴을 이해하기",
          "8",
          "Understand that a function is a rule that assigns to each input exactly one output.",
          "Students decide whether a relation is a function and justify.",
          "Correct function/non-function decisions for 4 of 5 relations.",
          "Understand",
          1
        ),
        skill(
          "8.EE.B.5",
          "Graph proportional relationships and interpret slope",
          "비례 관계를 그래프로 그리고 기울기 해석하기",
          "8",
          "Graph proportional relationships, interpreting the unit rate as the slope.",
          "Students graph y=kx and interpret slope as unit rate.",
          "Correct graph + slope interpretation for 3 of 3.",
          "Apply",
          2
        ),
        skill(
          "8.G.B.7",
          "Apply the Pythagorean Theorem",
          "피타고라스 정리 적용하기",
          "8",
          "Apply the Pythagorean Theorem to determine unknown side lengths in right triangles.",
          "Students find a missing side using a²+b²=c².",
          "Correct missing side for 4 of 5 right triangles.",
          "Apply",
          3
        ),
      ]
    )
  )
)
  added += 1;

math.framework.description =
  "CCSS Mathematics sample spanning Kindergarten–Grade 8. Sample depth — not a full standards dump.";
math.framework.name =
  "Common Core State Standards — Mathematics (K–8 sample)";
math.framework.nameKo = "공통핵심기준 — 수학 (K–8 샘플)";
math.framework.metadata = {
  ...(math.framework.metadata || {}),
  gradeSpan: "K-8",
};
writeFileSync(mathPath, JSON.stringify(math, null, 2) + "\n");
console.log("math +grades", added, "now", math.tree.children.map((c: { gradeLevel: string }) => c.gradeLevel).join(","));

// —— ELA G3 + G5 ——
const elaPath = join(seed, "ccss-ela-grade-4.json");
const ela = JSON.parse(readFileSync(elaPath, "utf8"));
added = 0;
if (
  ensureGrade(
    ela,
    gradeBand(
      "3",
      3,
      "Grade 3",
      "3학년",
      "RL.3",
      "Reading Literature",
      "문학 읽기",
      [
        skill(
          "RL.3.1",
          "Ask and answer questions to demonstrate understanding of a text",
          "글 이해를 위한 질문하고 답하기",
          "3",
          "Ask and answer questions to demonstrate understanding of a text, referring explicitly to the text.",
          "Students answer a text-based question with an explicit citation.",
          "Answer + citation for 3 of 3 questions.",
          "Understand",
          1
        ),
        skill(
          "RL.3.3",
          "Describe characters and explain how their actions contribute to events",
          "인물과 행동이 사건에 미치는 영향 설명하기",
          "3",
          "Describe characters in a story and explain how their actions contribute to the sequence of events.",
          "Students describe a character trait tied to an action and event.",
          "Trait–action–event link for 2 characters.",
          "Analyze",
          2
        ),
      ]
    )
  )
)
  added += 1;

if (
  ensureGrade(
    ela,
    gradeBand(
      "5",
      5,
      "Grade 5",
      "5학년",
      "RI.5",
      "Reading Informational Text",
      "정보 텍스트 읽기",
      [
        skill(
          "RI.5.1",
          "Quote accurately when explaining and drawing inferences",
          "설명·추론 시 정확히 인용하기",
          "5",
          "Quote accurately from a text when explaining what the text says explicitly and when drawing inferences.",
          "Students support an inference with an accurate quotation.",
          "Inference + accurate quote for 3 of 3 prompts.",
          "Analyze",
          1
        ),
        skill(
          "RI.5.2",
          "Determine two or more main ideas and explain how they are supported",
          "둘 이상의 중심 생각과 뒷받침 설명하기",
          "5",
          "Determine two or more main ideas of a text and explain how they are supported by key details.",
          "Students state ≥2 main ideas with supporting details.",
          "Two main ideas + ≥1 detail each.",
          "Understand",
          2
        ),
        skill(
          "W.5.1",
          "Write opinion pieces supporting a point of view with reasons and information",
          "이유와 정보로 뒷받침하는 의견문 쓰기",
          "5",
          "Write opinion pieces on topics or texts, supporting a point of view with reasons and information.",
          "Students write an opinion with reasons and a concluding statement.",
          "Claim + ≥2 reasons + conclusion.",
          "Create",
          3
        ),
      ]
    )
  )
)
  added += 1;

ela.framework.description =
  "CCSS ELA Grades 3–5 sample (RL/RI/W slices). Sample depth — expand with full grade bands as needed.";
ela.framework.metadata = { ...(ela.framework.metadata || {}), gradeSpan: "3-5" };
writeFileSync(elaPath, JSON.stringify(ela, null, 2) + "\n");
console.log("ela +grades", added, "now", ela.tree.children.map((c: { gradeLevel: string }) => c.gradeLevel).join(","));

// —— KR Korean G5–G6 ——
const koPath = join(seed, "kr2022-korean-grade-4.json");
const ko = JSON.parse(readFileSync(koPath, "utf8"));
added = 0;

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

if (!ko.tree.children.some((c: { gradeLevel: string }) => c.gradeLevel === "5")) {
  ko.tree.children.push({
    nodeType: "GRADE",
    code: "G5",
    title: "Grade 5 / 초등학교 5학년",
    titleKo: "초등학교 5학년",
    gradeLevel: "5",
    sortOrder: 5,
    metadata: { gradeBand: "5-6" },
    children: [
      {
        nodeType: "DOMAIN",
        code: "5국01",
        title: "Listening · Speaking / 듣기·말하기",
        titleKo: "듣기·말하기",
        gradeLevel: "5",
        sortOrder: 1,
        children: [
          {
            nodeType: "CONCEPT",
            code: "5국01-토의",
            title: "Discussing with evidence",
            titleKo: "근거를 들어 토의하기",
            gradeLevel: "5",
            sortOrder: 1,
            children: [
              koSkill(
                "5국01-01",
                "Support a claim with reasons in a discussion",
                "토의에서 이유와 함께 주장하기",
                "5",
                "토의에서 자신의 주장을 이유와 함께 말한다.",
                "Students state a claim with at least one reason in a short discussion.",
                "짧은 토의에서 주장과 이유 한 가지 이상을 말한다.",
                "Claim + reason present; on-topic.",
                "주제와 관련된 주장·이유 포함.",
                "Apply",
                1
              ),
              koSkill(
                "5국01-02",
                "Summarize others’ viewpoints fairly",
                "상대 의견을 공정하게 요약하기",
                "5",
                "상대의 의견을 왜곡 없이 요약한다.",
                "Students paraphrase a peer’s viewpoint without distortion.",
                "상대 의견을 왜곡 없이 한두 문장으로 요약한다.",
                "Paraphrase accepted by peer or teacher as fair.",
                "동료·교사가 공정하다고 인정하는 요약.",
                "Understand",
                2
              ),
            ],
          },
        ],
      },
      {
        nodeType: "DOMAIN",
        code: "5국02",
        title: "Reading / 읽기",
        titleKo: "읽기",
        gradeLevel: "5",
        sortOrder: 2,
        children: [
          {
            nodeType: "CONCEPT",
            code: "5국02-추론",
            title: "Inferring from text",
            titleKo: "글에서 추론하기",
            gradeLevel: "5",
            sortOrder: 1,
            children: [
              koSkill(
                "5국02-01",
                "Infer the author’s purpose with text evidence",
                "글의 목적을 근거와 함께 추론하기",
                "5",
                "글의 목적을 추론하고 근거를 제시한다.",
                "Students infer author’s purpose and cite evidence.",
                "글의 목적과 근거를 함께 말한다.",
                "Purpose claim + ≥1 evidence sentence.",
                "목적 주장과 근거 문장 1개 이상.",
                "Analyze",
                1
              ),
            ],
          },
        ],
      },
    ],
  });
  added += 1;
}

if (!ko.tree.children.some((c: { gradeLevel: string }) => c.gradeLevel === "6")) {
  ko.tree.children.push({
    nodeType: "GRADE",
    code: "G6",
    title: "Grade 6 / 초등학교 6학년",
    titleKo: "초등학교 6학년",
    gradeLevel: "6",
    sortOrder: 6,
    metadata: { gradeBand: "5-6" },
    children: [
      {
        nodeType: "DOMAIN",
        code: "6국03",
        title: "Writing / 쓰기",
        titleKo: "쓰기",
        gradeLevel: "6",
        sortOrder: 1,
        children: [
          {
            nodeType: "CONCEPT",
            code: "6국03-설득",
            title: "Persuasive writing",
            titleKo: "설득하는 글쓰기",
            gradeLevel: "6",
            sortOrder: 1,
            children: [
              koSkill(
                "6국03-01",
                "Write a persuasive paragraph with claim and reasons",
                "주장과 이유가 있는 설득 문단 쓰기",
                "6",
                "주장과 이유를 갖춘 설득 문단을 쓴다.",
                "Students write a persuasive paragraph with a claim and ≥2 reasons.",
                "주장과 이유 2가지 이상이 있는 설득 문단을 쓴다.",
                "Claim + ≥2 reasons + closing.",
                "주장·이유 2개 이상·맺음말 포함.",
                "Create",
                1
              ),
              koSkill(
                "6국03-02",
                "Revise for clarity using peer feedback",
                "동료 피드백으로 명확하게 고쳐 쓰기",
                "6",
                "동료 피드백을 반영해 글을 고쳐 쓴다.",
                "Students revise one paragraph based on peer feedback.",
                "동료 피드백을 반영해 문단을 한 번 고쳐 쓴다.",
                "Revision log shows ≥1 feedback-driven change.",
                "피드백 반영 수정 1회 이상 기록.",
                "Evaluate",
                2
              ),
            ],
          },
        ],
      },
    ],
  });
  added += 1;
}

ko.tree.children.sort(
  (a: { gradeLevel: string }, b: { gradeLevel: string }) =>
    Number(a.gradeLevel) - Number(b.gradeLevel)
);
ko.framework.description =
  "대한민국 2022 개정 교육과정 국어과 성취기준 샘플. 초 3–6학년 샘플 밴드. 실제 고시 문언은 교육부 PDF를 기준으로 검수·확장하세요.";
ko.framework.metadata = { ...(ko.framework.metadata || {}), gradeBand: "3-6" };
writeFileSync(koPath, JSON.stringify(ko, null, 2) + "\n");
console.log("korean +grades", added, "now", ko.tree.children.map((c: { gradeLevel: string }) => c.gradeLevel).join(","));

// —— KR History G5 ——
const histPath = join(seed, "kr2022-history-grade-4.json");
const hist = JSON.parse(readFileSync(histPath, "utf8"));
if (!hist.tree.children.some((c: { gradeLevel: string }) => c.gradeLevel === "5")) {
  hist.tree.children.push({
    nodeType: "GRADE",
    code: "G5",
    title: "Grade 5 / 초등학교 5학년",
    titleKo: "초등학교 5학년",
    gradeLevel: "5",
    sortOrder: 5,
    children: [
      {
        nodeType: "DOMAIN",
        code: "5사-나라",
        title: "Early states and cultural exchange",
        titleKo: "고대 국가와 문화 교류",
        gradeLevel: "5",
        sortOrder: 1,
        children: [
          {
            nodeType: "CONCEPT",
            code: "5사-고대",
            title: "Life in early Korean states",
            titleKo: "고대 국가의 생활",
            gradeLevel: "5",
            sortOrder: 1,
            children: [
              {
                nodeType: "SKILL",
                code: "5한01-01",
                title: "Describe features of an early Korean state",
                titleKo: "고대 국가의 특징 설명하기",
                gradeLevel: "5",
                sortOrder: 1,
                summary: "고대 국가 한 곳의 정치·생활 특징을 설명한다.",
                objectives: [
                  {
                    statement:
                      "Students describe political or daily-life features of one early Korean state.",
                    statementKo:
                      "고대 국가 한 곳의 정치·생활 특징을 설명한다.",
                    masteryCriteria:
                      "Description names the state + ≥2 accurate features.",
                    masteryCriteriaKo:
                      "국가명과 특징 2가지 이상 포함.",
                    bloomLevel: "Understand",
                    sortOrder: 1,
                  },
                ],
                resources: [],
              },
              {
                nodeType: "SKILL",
                code: "5한01-02",
                title: "Explain an example of cultural exchange",
                titleKo: "문화 교류의 사례 설명하기",
                gradeLevel: "5",
                sortOrder: 2,
                summary: "문화 교류 사례 한 가지를 찾아 설명한다.",
                objectives: [
                  {
                    statement:
                      "Students explain one cultural-exchange example with a cause or effect.",
                    statementKo:
                      "문화 교류 사례 한 가지를 원인·결과와 함께 설명한다.",
                    masteryCriteria:
                      "Example + cause/effect sentence completed.",
                    masteryCriteriaKo:
                      "사례와 원인·결과 문장 완성.",
                    bloomLevel: "Analyze",
                    sortOrder: 1,
                  },
                ],
                resources: [],
              },
              {
                nodeType: "SKILL",
                code: "5한01-03",
                title: "Compare then-and-now community roles",
                titleKo: "과거와 오늘날의 역할 비교하기",
                gradeLevel: "5",
                sortOrder: 3,
                summary: "과거와 오늘날의 공동체 역할을 비교한다.",
                objectives: [
                  {
                    statement:
                      "Students compare one community role across past and present.",
                    statementKo:
                      "과거와 오늘날의 공동체 역할 한 가지를 비교한다.",
                    masteryCriteria:
                      "Comparison table with ≥2 differences.",
                    masteryCriteriaKo:
                      "차이점 2가지 이상 비교표 완성.",
                    bloomLevel: "Analyze",
                    sortOrder: 1,
                  },
                ],
                resources: [],
              },
            ],
          },
        ],
      },
    ],
  });
  hist.framework.description =
    "초등 4–5학년 사회·역사 연계 한국사 프레임워크 샘플. 중·고등 한국사 고시 문언으로 확장 시 코드·진술을 검수하세요.";
  writeFileSync(histPath, JSON.stringify(hist, null, 2) + "\n");
  console.log("history grades", hist.tree.children.map((c: { gradeLevel: string }) => c.gradeLevel).join(","));
} else {
  console.log("history G5 already present");
}

console.log("✓ expand-k12-breadth done");
