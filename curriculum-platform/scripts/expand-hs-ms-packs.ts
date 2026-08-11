/**
 * Add high-school / middle-school sample bands (still sample depth, not full dumps).
 * - CCSS Math Algebra I (HS / grade 9)
 * - CCSS ELA G6–G8
 * - NGSS MS (grades 6–8)
 * - KR 한국사 G6
 * Run: npx tsx scripts/expand-hs-ms-packs.ts
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
  sort = 1
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
      },
    ],
    resources: [],
  };
}

function ensureGrade(
  pack: { tree: { children: Array<{ gradeLevel?: string; sortOrder?: number }> } },
  node: Record<string, unknown>
) {
  const level = String(node.gradeLevel);
  if (pack.tree.children.some((c) => c.gradeLevel === level)) return false;
  pack.tree.children.push(node as { gradeLevel?: string; sortOrder?: number });
  pack.tree.children.sort((a, b) => {
    const rank = (g?: string) =>
      g === "K" ? -1 : g === "HS" || g === "9-12" ? 90 : Number(g) || 0;
    return rank(a.gradeLevel) - rank(b.gradeLevel);
  });
  return true;
}

function gradeNode(
  level: string,
  sortOrder: number,
  title: string,
  titleKo: string,
  domainCode: string,
  domainTitle: string,
  domainTitleKo: string,
  skills: ReturnType<typeof skill>[]
) {
  return {
    nodeType: "GRADE",
    code: level === "HS" ? "GHS" : `G${level}`,
    title,
    titleKo,
    gradeLevel: level,
    sortOrder,
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

// Math HS Algebra I
const mathPath = join(seed, "ccss-math-grade-4.json");
const math = JSON.parse(readFileSync(mathPath, "utf8"));
if (
  ensureGrade(
    math,
    gradeNode(
      "HS",
      90,
      "High School — Algebra I",
      "고등 — 대수 I",
      "A-REI",
      "Reasoning with Equations & Inequalities",
      "방정식과 부등식의 추론",
      [
        skill(
          "A-REI.B.3",
          "Solve linear equations and inequalities in one variable",
          "일차 방정식·부등식 풀기",
          "HS",
          "Solve linear equations and inequalities in one variable, including equations with coefficients represented by letters.",
          "Students solve a linear equation/inequality and check the solution.",
          "Correct solution set for 4 of 5 items.",
          "Apply",
          1
        ),
        skill(
          "A-REI.C.6",
          "Solve systems of linear equations exactly and approximately",
          "연립일차방정식 정확히·근사적으로 풀기",
          "HS",
          "Solve systems of linear equations exactly and approximately (e.g., with graphs).",
          "Students solve a 2×2 system algebraically and verify graphically.",
          "Correct solution + verification for 3 of 3 systems.",
          "Apply",
          2
        ),
        skill(
          "A-SSE.A.1",
          "Interpret expressions that represent a quantity in context",
          "맥락에서 식을 해석하기",
          "HS",
          "Interpret expressions that represent a quantity in terms of its context.",
          "Students interpret parts of an expression in a real-world model.",
          "Correct interpretation for 3 of 3 expressions.",
          "Understand",
          3
        ),
        skill(
          "F-IF.A.1",
          "Understand the concept of a function and function notation",
          "함수 개념과 함수 기호 이해하기",
          "HS",
          "Understand that a function from one set to another assigns each element exactly one output; use function notation.",
          "Students evaluate f(x) and explain domain/range in context.",
          "Correct evaluations for 4 of 5 items.",
          "Understand",
          4
        ),
      ]
    )
  )
) {
  math.framework.description =
    "CCSS Mathematics sample spanning Kindergarten–Grade 8 plus High School Algebra I. Sample depth — not a full standards dump.";
  math.framework.name =
    "Common Core State Standards — Mathematics (K–8 + Algebra I)";
  math.framework.nameKo = "공통핵심기준 — 수학 (K–8 + 대수 I)";
  math.framework.metadata = {
    ...(math.framework.metadata || {}),
    gradeSpan: "K-8,HS-Algebra-I",
  };
  writeFileSync(mathPath, JSON.stringify(math, null, 2) + "\n");
  console.log("✓ math + HS Algebra I");
} else console.log("math HS already present");

// ELA 6-8
const elaPath = join(seed, "ccss-ela-grade-4.json");
const ela = JSON.parse(readFileSync(elaPath, "utf8"));
let elaAdded = 0;
for (const [level, domain, title, skills] of [
  [
    "6",
    "RI.6",
    "Reading Informational Text",
    [
      skill(
        "RI.6.1",
        "Cite textual evidence to support analysis",
        "분석을 뒷받침하는 텍스트 근거 인용하기",
        "6",
        "Cite textual evidence to support analysis of what the text says explicitly as well as inferences drawn from the text.",
        "Students cite evidence for an explicit claim and an inference.",
        "Two citations correctly paired with claims.",
        "Analyze",
        1
      ),
      skill(
        "RI.6.2",
        "Determine a central idea and how it is conveyed",
        "중심 생각과 전달 방식 파악하기",
        "6",
        "Determine a central idea of a text and how it is conveyed through particular details; provide a summary.",
        "Students state the central idea and summarize without personal opinion.",
        "Central idea + objective summary.",
        "Understand",
        2
      ),
    ],
  ],
  [
    "7",
    "RL.7",
    "Reading Literature",
    [
      skill(
        "RL.7.1",
        "Cite several pieces of textual evidence",
        "여러 텍스트 근거 인용하기",
        "7",
        "Cite several pieces of textual evidence to support analysis of what the text says explicitly as well as inferences.",
        "Students support an analysis with ≥2 citations.",
        "Analysis with ≥2 accurate citations.",
        "Analyze",
        1
      ),
      skill(
        "RL.7.2",
        "Determine a theme and analyze its development",
        "주제 파악과 전개 분석하기",
        "7",
        "Determine a theme or central idea and analyze its development over the course of the text.",
        "Students state a theme and trace how it develops with two moments.",
        "Theme + two development moments.",
        "Analyze",
        2
      ),
    ],
  ],
  [
    "8",
    "W.8",
    "Writing",
    [
      skill(
        "W.8.1",
        "Write arguments to support claims with clear reasons and evidence",
        "이유와 근거로 주장을 뒷받침하는 논증문 쓰기",
        "8",
        "Write arguments to support claims with clear reasons and relevant evidence.",
        "Students write an argument with claim, reasons, evidence, and conclusion.",
        "Claim + ≥2 reasons with evidence + conclusion.",
        "Create",
        1
      ),
      skill(
        "W.8.2",
        "Write informative/explanatory texts to examine a topic",
        "주제를 탐구하는 정보·설명문 쓰기",
        "8",
        "Write informative/explanatory texts to examine a topic and convey ideas through analysis of content.",
        "Students organize an informative text with introduction, analysis, and conclusion.",
        "Clear organization with ≥3 content points.",
        "Create",
        2
      ),
    ],
  ],
] as const) {
  if (
    ensureGrade(
      ela,
      gradeNode(
        level,
        Number(level),
        `Grade ${level}`,
        `${level}학년`,
        domain,
        title,
        title,
        skills as unknown as ReturnType<typeof skill>[]
      )
    )
  )
    elaAdded += 1;
}
ela.framework.description =
  "CCSS ELA Grades 3–8 sample (RL/RI/W slices). Sample depth — expand with full grade bands as needed.";
ela.framework.metadata = { ...(ela.framework.metadata || {}), gradeSpan: "3-8" };
writeFileSync(elaPath, JSON.stringify(ela, null, 2) + "\n");
console.log("✓ ela +grades", elaAdded);

// NGSS MS 6-8
const ngssPath = join(seed, "ngss-science-grade-4.json");
const ngss = JSON.parse(readFileSync(ngssPath, "utf8"));
let ngssAdded = 0;
const msGrades: Array<[string, string, string, ReturnType<typeof skill>[]]> = [
  [
    "6",
    "MS-PS1",
    "Matter and Its Interactions",
    [
      skill(
        "MS-PS1-1",
        "Develop models of atomic composition of molecules",
        "분자의 원자 구성 모형 만들기",
        "6",
        "Develop models to describe the atomic composition of simple molecules and extended structures.",
        "Students build/draw a model of a simple molecule’s atomic composition.",
        "Model correctly names atoms and structure for 1 compound.",
        "Understand",
        1
      ),
      skill(
        "MS-PS1-2",
        "Analyze data on properties before/after chemical change",
        "화학 변화 전후 성질 자료 분석하기",
        "6",
        "Analyze and interpret data on the properties of substances before and after the substances interact to determine if a chemical reaction has occurred.",
        "Students decide if a reaction occurred using property data.",
        "Correct decision + ≥2 property citations for 3 scenarios.",
        "Analyze",
        2
      ),
    ],
  ],
  [
    "7",
    "MS-LS1",
    "From Molecules to Organisms",
    [
      skill(
        "MS-LS1-1",
        "Conduct an investigation of living things made of cells",
        "생물이 세포로 이루어짐을 조사하기",
        "7",
        "Conduct an investigation to provide evidence that living things are made of cells.",
        "Students collect evidence that an organism is cellular.",
        "Evidence log with ≥2 observations supporting the claim.",
        "Apply",
        1
      ),
      skill(
        "MS-LS1-2",
        "Develop a model of cell organelle function",
        "세포 소기관 기능 모형 만들기",
        "7",
        "Develop and use a model to describe the function of a cell as a whole and ways parts contribute.",
        "Students model how ≥2 organelles contribute to cell function.",
        "Model labels ≥2 organelles with functions.",
        "Understand",
        2
      ),
    ],
  ],
  [
    "8",
    "MS-ESS3",
    "Earth and Human Activity",
    [
      skill(
        "MS-ESS3-3",
        "Apply scientific principles to design a method to monitor human impact",
        "인간 영향 모니터링 방법 설계하기",
        "8",
        "Apply scientific principles to design a method for monitoring and minimizing a human impact on the environment.",
        "Students propose a monitoring method for one human impact.",
        "Design includes measure + minimization step.",
        "Create",
        1
      ),
      skill(
        "MS-ESS3-5",
        "Ask questions about evidence of factors that affect global temperatures",
        "지구 기온 요인 증거에 대해 질문하기",
        "8",
        "Ask questions to clarify evidence of the factors that have caused the rise in global temperatures over the past century.",
        "Students ask a testable question tied to temperature-rise evidence.",
        "Question is evidence-linked and investigable.",
        "Analyze",
        2
      ),
    ],
  ],
];

for (const [level, domain, title, skills] of msGrades) {
  if (
    ensureGrade(
      ngss,
      gradeNode(
        level,
        Number(level),
        `Grade ${level}`,
        `${level}학년`,
        domain,
        title,
        title,
        skills
      )
    )
  )
    ngssAdded += 1;
}
ngss.framework.description =
  "NGSS sample spanning Grades 4–5 (elementary) and 6–8 (middle school). Sample PE depth — expand with full PE/DCI/CCC/SEP as needed.";
ngss.framework.metadata = {
  ...(ngss.framework.metadata || {}),
  gradeSpan: "4-8",
};
writeFileSync(ngssPath, JSON.stringify(ngss, null, 2) + "\n");
console.log("✓ ngss +grades", ngssAdded);

// History G6
const histPath = join(seed, "kr2022-history-grade-4.json");
const hist = JSON.parse(readFileSync(histPath, "utf8"));
if (
  ensureGrade(hist, {
    nodeType: "GRADE",
    code: "G6",
    title: "Grade 6 / 초등학교 6학년",
    titleKo: "초등학교 6학년",
    gradeLevel: "6",
    sortOrder: 6,
    children: [
      {
        nodeType: "DOMAIN",
        code: "6사-근현대",
        title: "Modern Korea and civic life",
        titleKo: "근현대와 시민 생활",
        gradeLevel: "6",
        sortOrder: 1,
        children: [
          {
            nodeType: "CONCEPT",
            code: "6사-변화",
            title: "Change in modern society",
            titleKo: "근대 사회의 변화",
            gradeLevel: "6",
            sortOrder: 1,
            children: [
              {
                nodeType: "SKILL",
                code: "6한01-01",
                title: "Explain a modern historical change with evidence",
                titleKo: "근대 역사 변화를 근거와 함께 설명하기",
                gradeLevel: "6",
                sortOrder: 1,
                summary: "근대 역사 변화 한 가지를 자료 근거와 함께 설명한다.",
                objectives: [
                  {
                    statement:
                      "Students explain one modern historical change with ≥2 evidence notes.",
                    statementKo:
                      "근대 역사 변화 한 가지를 근거 2가지 이상과 함께 설명한다.",
                    masteryCriteria:
                      "Change statement + 2 evidence notes completed.",
                    masteryCriteriaKo: "변화 설명과 근거 노트 2개 완성.",
                    bloomLevel: "Analyze",
                    sortOrder: 1,
                  },
                ],
                resources: [],
              },
              {
                nodeType: "SKILL",
                code: "6한01-02",
                title: "Connect a civic practice to democratic values",
                titleKo: "시민 실천과 민주주의 가치 연결하기",
                gradeLevel: "6",
                sortOrder: 2,
                summary: "일상 시민 실천을 민주주의 가치와 연결해 설명한다.",
                objectives: [
                  {
                    statement:
                      "Students link one civic practice to a democratic value.",
                    statementKo:
                      "시민 실천 한 가지를 민주주의 가치와 연결한다.",
                    masteryCriteria:
                      "Practice + value + one-sentence rationale.",
                    masteryCriteriaKo: "실천·가치·이유 한 문장 포함.",
                    bloomLevel: "Evaluate",
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
  })
) {
  hist.framework.description =
    "초등 4–6학년 사회·역사 연계 한국사 프레임워크 샘플. 중·고등 한국사 고시 문언으로 확장 시 코드·진술을 검수하세요.";
  writeFileSync(histPath, JSON.stringify(hist, null, 2) + "\n");
  console.log("✓ history + G6");
} else console.log("history G6 already present");

console.log("✓ expand-hs-ms-packs done");
