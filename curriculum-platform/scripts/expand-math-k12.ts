/**
 * One-shot: merge ccss-math-g5 into ccss-math and add K/1/2/3/6 sample grades.
 * Run: npx tsx scripts/expand-math-k12.ts
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const seed = join(process.cwd(), "prisma/seed");
const mathPath = join(seed, "ccss-math-grade-4.json");
const g5Path = join(seed, "ccss-math-grade-5.json");

const math = JSON.parse(readFileSync(mathPath, "utf8"));
const g5 = existsSync(g5Path)
  ? JSON.parse(readFileSync(g5Path, "utf8"))
  : null;

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
    code: level === "K" ? "GK" : `G${level}`,
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

const g5Node = g5
  ? structuredClone(g5.tree.children[0])
  : gradeNode(
      "5",
      5,
      "Grade 5",
      "5학년",
      "5.NBT",
      "Number & Operations in Base Ten",
      "수와 십진 연산",
      []
    );
g5Node.code = "G5";
g5Node.gradeLevel = "5";
g5Node.sortOrder = 5;

const extras = [
  gradeNode(
    "K",
    0,
    "Kindergarten",
    "유치원",
    "K.CC",
    "Counting & Cardinality",
    "수 세기와 기수",
    [
      skill(
        "K.CC.A.1",
        "Count to 100 by ones and by tens",
        "1과 10씩 100까지 세기",
        "K",
        "Count to 100 by ones and by tens.",
        "Students count aloud to 100 by ones and by tens.",
        "Accurate count by ones to 20 and by tens to 100.",
        "Remember",
        1
      ),
      skill(
        "K.CC.B.4",
        "Understand the relationship between numbers and quantities",
        "수와 양의 관계 이해하기",
        "K",
        "Understand that the last number name said tells the number of objects counted.",
        "Students count a set and state how many without recounting.",
        "Correct cardinality for 4 of 5 sets ≤10.",
        "Understand",
        2
      ),
    ]
  ),
  gradeNode(
    "1",
    1,
    "Grade 1",
    "1학년",
    "1.OA",
    "Operations & Algebraic Thinking",
    "연산과 대수적 사고",
    [
      skill(
        "1.OA.A.1",
        "Solve addition and subtraction word problems within 20",
        "20 이내 덧셈·뺄셈 문장제 해결하기",
        "1",
        "Use addition and subtraction within 20 to solve word problems.",
        "Students solve a word problem with a matching equation and answer.",
        "Correct equation + answer for 4 of 5 items.",
        "Apply",
        1
      ),
      skill(
        "1.OA.C.6",
        "Add and subtract within 20 using strategies",
        "전략을 이용해 20 이내 덧셈·뺄셈하기",
        "1",
        "Add and subtract within 20, demonstrating fluency within 10.",
        "Students compute within 20 using a named strategy.",
        "≥80% on mixed within-20 set.",
        "Apply",
        2
      ),
    ]
  ),
  gradeNode(
    "2",
    2,
    "Grade 2",
    "2학년",
    "2.NBT",
    "Number & Operations in Base Ten",
    "수와 십진 연산",
    [
      skill(
        "2.NBT.A.1",
        "Understand hundreds, tens, and ones",
        "백·십·일의 자릿값 이해하기",
        "2",
        "Understand that the three digits of a three-digit number represent amounts of hundreds, tens, and ones.",
        "Students identify place values in a 3-digit number.",
        "Correct place-value breakdown for 4 of 5 numbers.",
        "Understand",
        1
      ),
      skill(
        "2.NBT.B.5",
        "Fluently add and subtract within 100",
        "100 이내 덧셈·뺄셈을 능숙하게 하기",
        "2",
        "Fluently add and subtract within 100 using strategies based on place value.",
        "Students add/subtract within 100 with a place-value strategy.",
        "≥85% on 10 mixed items.",
        "Apply",
        2
      ),
    ]
  ),
  gradeNode(
    "3",
    3,
    "Grade 3",
    "3학년",
    "3.NF",
    "Number & Operations — Fractions",
    "수와 연산 — 분수",
    [
      skill(
        "3.NF.A.1",
        "Understand a fraction 1/b as the quantity formed by 1 part",
        "단위분수 1/b 이해하기",
        "3",
        "Understand a fraction 1/b as the quantity formed by 1 part when a whole is partitioned into b equal parts.",
        "Students shade 1/b of a model and name the unit fraction.",
        "Correct model + name for 3 of 3 prompts.",
        "Understand",
        1
      ),
      skill(
        "3.NF.A.3",
        "Explain equivalence of fractions and compare",
        "분수의 동치와 비교 설명하기",
        "3",
        "Explain equivalence of fractions in special cases and compare fractions by reasoning about their size.",
        "Students justify why two fractions are equivalent or which is larger.",
        "Correct comparison with reason for 4 of 5 items.",
        "Analyze",
        2
      ),
      skill(
        "3.OA.A.1",
        "Interpret products of whole numbers",
        "자연수 곱의 의미 해석하기",
        "3",
        "Interpret products of whole numbers as equal groups.",
        "Students relate a×b to equal groups and write an equation.",
        "Correct model + equation for 4 of 5 items.",
        "Understand",
        3
      ),
    ]
  ),
  g5Node,
  gradeNode(
    "6",
    6,
    "Grade 6",
    "6학년",
    "6.RP",
    "Ratios & Proportional Relationships",
    "비와 비례 관계",
    [
      skill(
        "6.RP.A.1",
        "Understand the concept of a ratio",
        "비의 개념 이해하기",
        "6",
        "Understand the concept of a ratio and use ratio language to describe a ratio relationship between two quantities.",
        "Students write a ratio and describe the relationship in words.",
        "Correct ratio language for 3 of 3 scenarios.",
        "Understand",
        1
      ),
      skill(
        "6.RP.A.3",
        "Use ratio and rate reasoning to solve problems",
        "비와 비율로 문제 해결하기",
        "6",
        "Use ratio and rate reasoning to solve real-world and mathematical problems.",
        "Students solve a rate/ratio problem with a table or equation.",
        "Correct solution + representation for 4 of 5 items.",
        "Apply",
        2
      ),
      skill(
        "6.NS.C.5",
        "Understand positive and negative numbers",
        "양수와 음수 이해하기",
        "6",
        "Understand that positive and negative numbers are used together to describe quantities having opposite directions or values.",
        "Students place integers on a number line and interpret a real-world signed quantity.",
        "Correct placements for 4 of 5 prompts.",
        "Understand",
        3
      ),
    ]
  ),
];

const g4 = math.tree.children.find(
  (c: { gradeLevel?: string }) => c.gradeLevel === "4"
);
if (!g4) throw new Error("G4 missing from math pack");

math.tree.children = [
  ...extras.filter((e) => Number(e.sortOrder) < 4),
  g4,
  ...extras.filter((e) => Number(e.sortOrder) >= 5),
];

math.framework.description =
  "CCSS Mathematics sample spanning Kindergarten–Grade 6 (K.CC, 1.OA, 2.NBT, 3.NF/OA, 4.OA/NBT/NF, 5.NBT/NF, 6.RP/NS). Sample depth — not a full standards dump.";
math.framework.name =
  "Common Core State Standards — Mathematics (K–6 sample)";
math.framework.nameKo = "공통핵심기준 — 수학 (K–6 샘플)";
math.framework.metadata = {
  ...(math.framework.metadata || {}),
  gradeSpan: "K-6",
  note: "Merged former ccss-math-g5 into this pack as GRADE G5.",
};

writeFileSync(mathPath, JSON.stringify(math, null, 2) + "\n");
if (existsSync(g5Path)) unlinkSync(g5Path);
console.log(
  "✓ math grades:",
  math.tree.children.map((c: { gradeLevel: string }) => c.gradeLevel).join(",")
);
