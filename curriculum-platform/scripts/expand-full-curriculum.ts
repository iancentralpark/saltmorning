/**
 * Full curriculum coverage expansion (idempotent where possible).
 * Fills Math, ELA, NGSS, KR Korean, KR History across K–HS / 1–9 bands.
 *
 * Run: npx tsx scripts/expand-full-curriculum.ts
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

const seed = join(process.cwd(), "prisma/seed");

type SkillSpec = {
  code: string;
  title: string;
  titleKo?: string;
  summary: string;
  statement: string;
  statementKo?: string;
  mastery: string;
  masteryKo?: string;
  bloom?: string;
};

function skill(
  grade: string,
  s: SkillSpec,
  sort: number
) {
  return {
    nodeType: "SKILL",
    code: s.code,
    title: s.title,
    titleKo: s.titleKo || s.title,
    gradeLevel: grade,
    sortOrder: sort,
    summary: s.summary,
    objectives: [
      {
        statement: s.statement,
        ...(s.statementKo ? { statementKo: s.statementKo } : {}),
        masteryCriteria: s.mastery,
        ...(s.masteryKo ? { masteryCriteriaKo: s.masteryKo } : {}),
        bloomLevel: s.bloom || "Apply",
        sortOrder: 1,
      },
    ],
    resources: [],
  };
}

function domain(
  grade: string,
  code: string,
  title: string,
  titleKo: string,
  sort: number,
  skills: SkillSpec[]
) {
  return {
    nodeType: "DOMAIN",
    code,
    title,
    titleKo,
    gradeLevel: grade,
    sortOrder: sort,
    children: [
      {
        nodeType: "CONCEPT",
        code: `${code}.Core`,
        title,
        titleKo,
        gradeLevel: grade,
        sortOrder: 1,
        children: skills.map((s, i) => skill(grade, s, i + 1)),
      },
    ],
  };
}

function gradeNode(
  level: string,
  sortOrder: number,
  title: string,
  titleKo: string,
  domains: ReturnType<typeof domain>[],
  metadata?: Record<string, unknown>
) {
  return {
    nodeType: "GRADE",
    code: level === "K" ? "GK" : level === "HS" ? "GHS" : `G${level}`,
    title,
    titleKo,
    gradeLevel: level,
    sortOrder,
    metadata,
    children: domains,
  };
}

function load(name: string) {
  return JSON.parse(readFileSync(join(seed, name), "utf8"));
}

function save(name: string, pack: unknown) {
  writeFileSync(join(seed, name), JSON.stringify(pack, null, 2) + "\n");
}

function ensureGrade(
  pack: { tree: { children: Array<{ gradeLevel?: string; children?: unknown[] }> } },
  node: ReturnType<typeof gradeNode>
) {
  const existing = pack.tree.children.find((c) => c.gradeLevel === node.gradeLevel);
  if (!existing) {
    pack.tree.children.push(node as never);
    sortGrades(pack);
    return "added";
  }
  // Merge missing domains by code
  const kids = (existing.children || []) as Array<{ code?: string; children?: unknown[] }>;
  let merged = 0;
  for (const d of node.children) {
    if (!kids.some((k) => k.code === d.code)) {
      kids.push(d as never);
      merged += 1;
    } else {
      // merge skills under matching domain → concept
      const exDom = kids.find((k) => k.code === d.code) as {
        children?: Array<{ children?: Array<{ code?: string }> }>;
      };
      const exConcept = exDom?.children?.[0];
      const newConcept = (d as { children: Array<{ children: Array<{ code?: string }> }> })
        .children[0];
      if (exConcept && newConcept) {
        exConcept.children = exConcept.children || [];
        for (const sk of newConcept.children) {
          if (!exConcept.children.some((x) => x.code === sk.code)) {
            exConcept.children.push(sk as never);
            merged += 1;
          }
        }
      }
    }
  }
  existing.children = kids;
  sortGrades(pack);
  return merged > 0 ? `merged:${merged}` : "skip";
}

function sortGrades(pack: { tree: { children: Array<{ gradeLevel?: string; sortOrder?: number }> } }) {
  const rank = (g?: string) => {
    if (!g) return 999;
    if (g === "K") return -1;
    if (g === "HS") return 90;
    return Number(g) || 0;
  };
  pack.tree.children.sort((a, b) => rank(a.gradeLevel) - rank(b.gradeLevel));
}

function countSkills(node: { nodeType?: string; children?: unknown[] }): number {
  let n = node.nodeType === "SKILL" ? 1 : 0;
  for (const c of node.children || []) n += countSkills(c as never);
  return n;
}

// ───────────────── Phase 1: Math ─────────────────
const mathPath = "ccss-math-grade-4.json";
const math = load(mathPath);

const mathBands: Array<[string, number, string, string, ReturnType<typeof domain>[]]> = [
  [
    "K",
    0,
    "Kindergarten",
    "유치원",
    [
      domain("K", "K.CC", "Counting & Cardinality", "수 세기와 기수", 1, [
        { code: "K.CC.A.1", title: "Count to 100 by ones and tens", titleKo: "1·10씩 100까지 세기", summary: "Count to 100 by ones and by tens.", statement: "Students count to 100 by ones and tens.", mastery: "Accurate count by ones to 20 and tens to 100.", bloom: "Remember" },
        { code: "K.CC.A.2", title: "Count forward from a given number", titleKo: "주어진 수부터 이어 세기", summary: "Count forward beginning from a given number.", statement: "Students continue a count from a given start.", mastery: "Correct continuation for 4 of 5 starts.", bloom: "Apply" },
        { code: "K.CC.B.4", title: "Understand number–quantity relationship", titleKo: "수와 양의 관계 이해하기", summary: "Understand that the last number said tells how many.", statement: "Students state how many without recounting.", mastery: "Cardinality correct for 4 of 5 sets ≤10.", bloom: "Understand" },
        { code: "K.CC.C.6", title: "Identify whether a group has more/fewer/equal", titleKo: "더 많음·적음·같음 비교하기", summary: "Identify whether the number of objects in one group is greater than, less than, or equal to another.", statement: "Students compare two groups using matching or counting.", mastery: "Correct comparison for 4 of 5 pairs.", bloom: "Analyze" },
      ]),
      domain("K", "K.OA", "Operations & Algebraic Thinking", "연산과 대수적 사고", 2, [
        { code: "K.OA.A.1", title: "Represent addition and subtraction with objects", titleKo: "구체물로 덧셈·뺄셈 나타내기", summary: "Represent addition and subtraction with objects, fingers, drawings.", statement: "Students model +/− within 10 with objects.", mastery: "Correct models for 4 of 5 stories.", bloom: "Apply" },
        { code: "K.OA.A.2", title: "Solve addition and subtraction word problems within 10", titleKo: "10 이내 덧셈·뺄셈 문장제 해결하기", summary: "Solve addition and subtraction word problems within 10.", statement: "Students solve a within-10 word problem.", mastery: "Correct answer for 4 of 5 items.", bloom: "Apply" },
      ]),
      domain("K", "K.G", "Geometry", "도형", 3, [
        { code: "K.G.A.1", title: "Describe objects using shape names and position", titleKo: "도형 이름과 위치로 사물 설명하기", summary: "Describe objects using names of shapes and relative positions.", statement: "Students name a shape and its position.", mastery: "Correct shape + position for 3 of 3.", bloom: "Understand" },
        { code: "K.G.B.4", title: "Analyze and compare 2D and 3D shapes", titleKo: "평면·입체 도형 비교하기", summary: "Analyze and compare two- and three-dimensional shapes.", statement: "Students sort shapes by attributes.", mastery: "Correct sort for 2 attribute rules.", bloom: "Analyze" },
      ]),
    ],
  ],
  [
    "1",
    1,
    "Grade 1",
    "1학년",
    [
      domain("1", "1.OA", "Operations & Algebraic Thinking", "연산과 대수적 사고", 1, [
        { code: "1.OA.A.1", title: "Solve word problems within 20", titleKo: "20 이내 문장제 해결하기", summary: "Use addition and subtraction within 20 to solve word problems.", statement: "Students write an equation for a word problem within 20.", mastery: "Equation + answer for 4 of 5.", bloom: "Apply" },
        { code: "1.OA.B.3", title: "Apply properties of operations", titleKo: "연산의 성질 적용하기", summary: "Apply properties of operations as strategies to add and subtract.", statement: "Students use commutative/associative ideas informally.", mastery: "Explains a property-based strategy once.", bloom: "Understand" },
        { code: "1.OA.C.6", title: "Add and subtract within 20", titleKo: "20 이내 덧셈·뺄셈하기", summary: "Add and subtract within 20, demonstrating fluency within 10.", statement: "Students compute within 20 with a strategy.", mastery: "≥80% on mixed within-20 set.", bloom: "Apply" },
        { code: "1.OA.D.8", title: "Determine the unknown in an equation", titleKo: "식에서 미지수 구하기", summary: "Determine the unknown whole number in an addition or subtraction equation.", statement: "Students find the missing number in □ equations.", mastery: "Correct unknown for 4 of 5.", bloom: "Apply" },
      ]),
      domain("1", "1.NBT", "Number & Operations in Base Ten", "수와 십진 연산", 2, [
        { code: "1.NBT.A.1", title: "Count to 120 and represent numerals", titleKo: "120까지 세고 수로 나타내기", summary: "Count to 120 starting at any number less than 120.", statement: "Students count on and write numerals to 120.", mastery: "Correct count/write for 3 of 3 starts.", bloom: "Remember" },
        { code: "1.NBT.B.2", title: "Understand tens and ones", titleKo: "십과 일의 자릿값 이해하기", summary: "Understand that the two digits of a two-digit number represent tens and ones.", statement: "Students decompose a teen/two-digit number into tens and ones.", mastery: "Correct decomposition for 4 of 5.", bloom: "Understand" },
        { code: "1.NBT.C.4", title: "Add within 100 using place value", titleKo: "자릿값으로 100 이내 덧셈하기", summary: "Add within 100 using concrete models or drawings and strategies based on place value.", statement: "Students add two-digit + one-digit or multiple of 10.", mastery: "Correct sum + strategy for 4 of 5.", bloom: "Apply" },
      ]),
    ],
  ],
  [
    "2",
    2,
    "Grade 2",
    "2학년",
    [
      domain("2", "2.OA", "Operations & Algebraic Thinking", "연산과 대수적 사고", 1, [
        { code: "2.OA.A.1", title: "Solve one- and two-step word problems within 100", titleKo: "100 이내 1·2단계 문장제 해결하기", summary: "Use addition and subtraction within 100 to solve one- and two-step word problems.", statement: "Students solve a two-step within-100 problem.", mastery: "Correct work for 3 of 4 items.", bloom: "Apply" },
        { code: "2.OA.B.2", title: "Fluently add and subtract within 20", titleKo: "20 이내 덧셈·뺄셈을 능숙하게 하기", summary: "Fluently add and subtract within 20 using mental strategies.", statement: "Students compute within 20 fluently.", mastery: "≥90% on timed within-20 set.", bloom: "Apply" },
        { code: "2.OA.C.4", title: "Use addition to find total of equal groups", titleKo: "같은 묶음의 합 구하기", summary: "Use addition to find the total number of objects in rectangular arrays.", statement: "Students write an addition equation for an array.", mastery: "Correct equation for 3 of 3 arrays.", bloom: "Understand" },
      ]),
      domain("2", "2.NBT", "Number & Operations in Base Ten", "수와 십진 연산", 2, [
        { code: "2.NBT.A.1", title: "Understand hundreds, tens, and ones", titleKo: "백·십·일 이해하기", summary: "Understand that the three digits of a three-digit number represent hundreds, tens, and ones.", statement: "Students name place values in a 3-digit number.", mastery: "Correct breakdown for 4 of 5.", bloom: "Understand" },
        { code: "2.NBT.A.4", title: "Compare three-digit numbers", titleKo: "세 자리 수 비교하기", summary: "Compare two three-digit numbers based on meanings of the hundreds, tens, and ones digits.", statement: "Students compare with >, =, < and place-value reason.", mastery: "≥85% on 8 comparisons.", bloom: "Analyze" },
        { code: "2.NBT.B.5", title: "Fluently add and subtract within 100", titleKo: "100 이내 덧셈·뺄셈을 능숙하게 하기", summary: "Fluently add and subtract within 100 using strategies based on place value.", statement: "Students add/subtract within 100 with place-value strategy.", mastery: "≥85% on 10 mixed items.", bloom: "Apply" },
        { code: "2.NBT.B.7", title: "Add and subtract within 1000", titleKo: "1000 이내 덧셈·뺄셈하기", summary: "Add and subtract within 1000 using concrete models or drawings and strategies.", statement: "Students compute a within-1000 problem with a model/strategy.", mastery: "Correct result + explanation for 3 of 4.", bloom: "Apply" },
      ]),
      domain("2", "2.MD", "Measurement & Data", "측정과 자료", 3, [
        { code: "2.MD.A.1", title: "Measure length with appropriate tools", titleKo: "알맞은 도구로 길이 재기", summary: "Measure the length of an object by selecting and using appropriate tools.", statement: "Students measure with ruler/meter stick appropriately.", mastery: "Correct tool + measure for 3 objects.", bloom: "Apply" },
        { code: "2.MD.D.10", title: "Draw a picture/bar graph and solve problems", titleKo: "그림·막대그래프 그리고 문제 해결하기", summary: "Draw a picture graph and a bar graph to represent data; solve problems.", statement: "Students build a bar graph and answer 2 questions.", mastery: "Graph + 2 correct answers.", bloom: "Apply" },
      ]),
    ],
  ],
  [
    "3",
    3,
    "Grade 3",
    "3학년",
    [
      domain("3", "3.OA", "Operations & Algebraic Thinking", "연산과 대수적 사고", 1, [
        { code: "3.OA.A.1", title: "Interpret products of whole numbers", titleKo: "곱의 의미 해석하기", summary: "Interpret products of whole numbers as equal groups.", statement: "Students relate a×b to equal groups.", mastery: "Model + equation for 4 of 5.", bloom: "Understand" },
        { code: "3.OA.A.3", title: "Solve multiplication/division word problems within 100", titleKo: "100 이내 곱·나눗셈 문장제 해결하기", summary: "Use multiplication and division within 100 to solve word problems.", statement: "Students solve a ×/÷ word problem within 100.", mastery: "Correct equation + answer for 4 of 5.", bloom: "Apply" },
        { code: "3.OA.C.7", title: "Fluently multiply and divide within 100", titleKo: "100 이내 곱·나눗셈을 능숙하게 하기", summary: "Fluently multiply and divide within 100.", statement: "Students compute ×/÷ within 100 fluently.", mastery: "≥80% on mixed fact set.", bloom: "Apply" },
        { code: "3.OA.D.8", title: "Solve two-step word problems using four operations", titleKo: "네 연산을 쓰는 2단계 문장제 해결하기", summary: "Solve two-step word problems using the four operations.", statement: "Students solve a two-step mixed-operation problem.", mastery: "Correct work for 3 of 4.", bloom: "Apply" },
      ]),
      domain("3", "3.NF", "Number & Operations — Fractions", "수와 연산 — 분수", 2, [
        { code: "3.NF.A.1", title: "Understand unit fractions", titleKo: "단위분수 이해하기", summary: "Understand a fraction 1/b as the quantity formed by 1 part when a whole is partitioned into b equal parts.", statement: "Students shade and name 1/b.", mastery: "Correct for 3 of 3 models.", bloom: "Understand" },
        { code: "3.NF.A.2", title: "Represent fractions on a number line", titleKo: "수직선에 분수 나타내기", summary: "Understand a fraction as a number on the number line.", statement: "Students locate a/b on a number line.", mastery: "Correct placement for 4 of 5.", bloom: "Apply" },
        { code: "3.NF.A.3", title: "Explain equivalence and compare fractions", titleKo: "동치와 크기 비교 설명하기", summary: "Explain equivalence of fractions and compare by size.", statement: "Students justify equivalence or comparison.", mastery: "Correct with reason for 4 of 5.", bloom: "Analyze" },
      ]),
      domain("3", "3.MD", "Measurement & Data", "측정과 자료", 3, [
        { code: "3.MD.A.1", title: "Tell and write time to the nearest minute", titleKo: "1분 단위로 시각 읽고 쓰기", summary: "Tell and write time to the nearest minute and measure time intervals.", statement: "Students read/write time and solve an elapsed-time problem.", mastery: "Correct for 4 of 5 prompts.", bloom: "Apply" },
        { code: "3.MD.C.7", title: "Relate area to multiplication and addition", titleKo: "넓이를 곱셈·덧셈과 연결하기", summary: "Relate area to the operations of multiplication and addition.", statement: "Students find area of a rectangle using tiling or a×b.", mastery: "Correct area for 4 of 5.", bloom: "Apply" },
      ]),
    ],
  ],
  [
    "4",
    4,
    "Grade 4",
    "4학년",
    [
      domain("4", "4.MD", "Measurement & Data", "측정과 자료", 4, [
        { code: "4.MD.A.1", title: "Know relative sizes of measurement units", titleKo: "측정 단위의 상대적 크기 알기", summary: "Know relative sizes of measurement units within one system.", statement: "Students convert between related units within a system.", mastery: "Correct conversions for 4 of 5.", bloom: "Understand" },
        { code: "4.MD.A.3", title: "Apply area and perimeter formulas for rectangles", titleKo: "직사각형 넓이·둘레 공식 적용하기", summary: "Apply the area and perimeter formulas for rectangles in real-world problems.", statement: "Students solve an area/perimeter application.", mastery: "Correct formula use for 3 of 3.", bloom: "Apply" },
        { code: "4.MD.C.5", title: "Recognize angles as geometric shapes", titleKo: "각을 도형으로 인식하기", summary: "Recognize angles as geometric shapes formed when two rays share an endpoint.", statement: "Students identify and sketch angles.", mastery: "Correct identification for 4 of 5.", bloom: "Understand" },
      ]),
      domain("4", "4.G", "Geometry", "도형", 5, [
        { code: "4.G.A.1", title: "Draw points, lines, rays, and angles", titleKo: "점·선·반직선·각 그리기", summary: "Draw points, lines, line segments, rays, angles, and perpendicular/parallel lines.", statement: "Students draw and label geometric figures.", mastery: "Correct drawings for 4 of 5 prompts.", bloom: "Apply" },
        { code: "4.G.A.2", title: "Classify figures by properties of lines and angles", titleKo: "선과 각의 성질로 도형 분류하기", summary: "Classify two-dimensional figures based on presence of parallel/perpendicular lines or angles.", statement: "Students classify shapes by line/angle properties.", mastery: "Correct classification for 4 of 5.", bloom: "Analyze" },
      ]),
    ],
  ],
  [
    "5",
    5,
    "Grade 5",
    "5학년",
    [
      domain("5", "5.OA", "Operations & Algebraic Thinking", "연산과 대수적 사고", 3, [
        { code: "5.OA.A.1", title: "Use parentheses/brackets in numerical expressions", titleKo: "괄호를 쓴 수식 계산하기", summary: "Use parentheses, brackets, or braces in numerical expressions and evaluate.", statement: "Students evaluate expressions with grouping symbols.", mastery: "Correct for 4 of 5 expressions.", bloom: "Apply" },
        { code: "5.OA.A.2", title: "Write and interpret simple expressions", titleKo: "간단한 식 쓰고 해석하기", summary: "Write simple expressions that record calculations and interpret without evaluating.", statement: "Students write an expression from a verbal phrase.", mastery: "Correct expression for 4 of 5 phrases.", bloom: "Understand" },
      ]),
      domain("5", "5.MD", "Measurement & Data", "측정과 자료", 4, [
        { code: "5.MD.A.1", title: "Convert among different-sized measurement units", titleKo: "서로 다른 측정 단위 환산하기", summary: "Convert among different-sized standard measurement units within a system.", statement: "Students convert and use conversions in multi-step problems.", mastery: "Correct for 4 of 5 conversions.", bloom: "Apply" },
        { code: "5.MD.C.5", title: "Relate volume to multiplication and addition", titleKo: "부피를 곱셈·덧셈과 연결하기", summary: "Relate volume to the operations of multiplication and addition; solve real-world problems.", statement: "Students find volume of a rectangular prism.", mastery: "Correct volume for 4 of 5.", bloom: "Apply" },
      ]),
      domain("5", "5.G", "Geometry", "도형", 5, [
        { code: "5.G.A.1", title: "Use a coordinate plane in the first quadrant", titleKo: "제1사분면 좌표평면 사용하기", summary: "Use a pair of perpendicular number lines to define a coordinate system.", statement: "Students plot and name points in quadrant I.", mastery: "Correct plots for 4 of 5 points.", bloom: "Apply" },
        { code: "5.G.B.3", title: "Understand categories of 2D figures", titleKo: "평면 도형의 범주 이해하기", summary: "Understand that attributes belonging to a category of two-dimensional figures also belong to all subcategories.", statement: "Students explain a hierarchy (e.g., rectangles/squares).", mastery: "Correct hierarchy statement with example.", bloom: "Understand" },
      ]),
    ],
  ],
  [
    "6",
    6,
    "Grade 6",
    "6학년",
    [
      domain("6", "6.EE", "Expressions & Equations", "식과 방정식", 2, [
        { code: "6.EE.A.2", title: "Write, read, and evaluate expressions", titleKo: "식 쓰고 읽고 계산하기", summary: "Write, read, and evaluate expressions in which letters stand for numbers.", statement: "Students evaluate an algebraic expression for given values.", mastery: "Correct for 4 of 5 evaluations.", bloom: "Apply" },
        { code: "6.EE.B.5", title: "Understand solving equations as a process", titleKo: "방정식 풀이를 과정으로 이해하기", summary: "Understand solving an equation or inequality as a process of answering which values make it true.", statement: "Students test values and solve a one-step equation.", mastery: "Correct solution for 4 of 5.", bloom: "Understand" },
        { code: "6.EE.B.7", title: "Solve real-world equations of form x+p=q and px=q", titleKo: "x+p=q, px=q 형태 실생활 방정식 풀기", summary: "Solve real-world and mathematical problems by writing and solving equations of the form x+p=q and px=q.", statement: "Students write and solve a one-step equation from context.", mastery: "Equation + solution for 3 of 3.", bloom: "Apply" },
      ]),
      domain("6", "6.G", "Geometry", "도형", 3, [
        { code: "6.G.A.1", title: "Find area of triangles and special quadrilaterals", titleKo: "삼각형·특수 사각형 넓이 구하기", summary: "Find the area of right triangles, other triangles, special quadrilaterals, and polygons.", statement: "Students compute area by composing/decomposing shapes.", mastery: "Correct area for 4 of 5 figures.", bloom: "Apply" },
        { code: "6.G.A.2", title: "Find volume of a right rectangular prism with fractional edges", titleKo: "분수 모서리 직육면체 부피 구하기", summary: "Find the volume of a right rectangular prism with fractional edge lengths.", statement: "Students compute V=lwh with fractional edges.", mastery: "Correct volume for 3 of 3.", bloom: "Apply" },
      ]),
      domain("6", "6.SP", "Statistics & Probability", "통계와 확률", 4, [
        { code: "6.SP.A.1", title: "Recognize a statistical question", titleKo: "통계적 질문 인식하기", summary: "Recognize a statistical question as one that anticipates variability.", statement: "Students distinguish statistical vs non-statistical questions.", mastery: "Correct sort for 4 of 5 questions.", bloom: "Understand" },
        { code: "6.SP.B.5", title: "Summarize numerical data sets", titleKo: "수치 자료 요약하기", summary: "Summarize numerical data sets in relation to their context.", statement: "Students report center/spread for a data set.", mastery: "Median/mean + range stated correctly.", bloom: "Analyze" },
      ]),
    ],
  ],
  [
    "7",
    7,
    "Grade 7",
    "7학년",
    [
      domain("7", "7.NS", "The Number System", "수 체계", 2, [
        { code: "7.NS.A.1", title: "Apply and extend addition/subtraction to rational numbers", titleKo: "유리수 덧셈·뺄셈 확장하기", summary: "Apply and extend previous understandings of addition and subtraction to add and subtract rational numbers.", statement: "Students add/subtract signed rationals on a number line or with rules.", mastery: "≥80% on mixed signed set.", bloom: "Apply" },
        { code: "7.NS.A.2", title: "Multiply and divide rational numbers", titleKo: "유리수 곱셈·나눗셈하기", summary: "Apply and extend previous understandings of multiplication and division of fractions to multiply and divide rational numbers.", statement: "Students multiply/divide signed rationals.", mastery: "≥80% on mixed set.", bloom: "Apply" },
      ]),
      domain("7", "7.G", "Geometry", "도형", 3, [
        { code: "7.G.A.1", title: "Solve problems involving scale drawings", titleKo: "축척 도면 문제 해결하기", summary: "Solve problems involving scale drawings of geometric figures.", statement: "Students use a scale factor to find a missing length.", mastery: "Correct for 3 of 3 scale problems.", bloom: "Apply" },
        { code: "7.G.B.4", title: "Know formulas for area/circumference of a circle", titleKo: "원의 넓이·둘레 공식 알기", summary: "Know the formulas for the area and circumference of a circle and use them to solve problems.", statement: "Students compute circumference or area given r or d.", mastery: "Correct for 4 of 5.", bloom: "Apply" },
        { code: "7.G.B.6", title: "Solve real-world problems involving area, volume, surface area", titleKo: "넓이·부피·겉넓이 실생활 문제 해결하기", summary: "Solve real-world and mathematical problems involving area, volume, and surface area of 2D/3D objects.", statement: "Students solve a composite area or prism volume problem.", mastery: "Correct for 3 of 4.", bloom: "Apply" },
      ]),
      domain("7", "7.SP", "Statistics & Probability", "통계와 확률", 4, [
        { code: "7.SP.A.1", title: "Understand statistics from random sampling", titleKo: "임의표본 통계 이해하기", summary: "Understand that statistics can be used to gain information about a population by examining a sample.", statement: "Students explain why a sample may/may not represent a population.", mastery: "Valid reasoning on 2 of 2 scenarios.", bloom: "Understand" },
        { code: "7.SP.C.5", title: "Understand probability of a chance event", titleKo: "우연 사건의 확률 이해하기", summary: "Understand that the probability of a chance event is a number between 0 and 1.", statement: "Students assign approximate probabilities and justify.", mastery: "Correct range + justification for 3 of 3.", bloom: "Understand" },
      ]),
    ],
  ],
  [
    "8",
    8,
    "Grade 8",
    "8학년",
    [
      domain("8", "8.NS", "The Number System", "수 체계", 2, [
        { code: "8.NS.A.1", title: "Know that there are irrational numbers", titleKo: "무리수가 있음을 알기", summary: "Know that numbers that are not rational are called irrational.", statement: "Students classify numbers as rational/irrational with reason.", mastery: "Correct classification for 4 of 5.", bloom: "Understand" },
        { code: "8.NS.A.2", title: "Approximate irrational numbers", titleKo: "무리수 근사하기", summary: "Use rational approximations of irrational numbers to compare size and locate on a number line.", statement: "Students approximate √n between integers.", mastery: "Correct bounds for 3 of 3.", bloom: "Apply" },
      ]),
      domain("8", "8.EE", "Expressions & Equations", "식과 방정식", 3, [
        { code: "8.EE.A.1", title: "Know and apply properties of integer exponents", titleKo: "정수 지수의 성질 알고 적용하기", summary: "Know and apply the properties of integer exponents to generate equivalent expressions.", statement: "Students simplify expressions with integer exponents.", mastery: "≥80% on 8 items.", bloom: "Apply" },
        { code: "8.EE.C.7", title: "Solve linear equations in one variable", titleKo: "일차방정식 풀기", summary: "Solve linear equations in one variable.", statement: "Students solve multi-step linear equations.", mastery: "Correct for 4 of 5.", bloom: "Apply" },
        { code: "8.EE.C.8", title: "Analyze and solve pairs of simultaneous linear equations", titleKo: "연립일차방정식 분석·풀기", summary: "Analyze and solve pairs of simultaneous linear equations.", statement: "Students solve a 2×2 system algebraically or graphically.", mastery: "Correct solution for 3 of 3.", bloom: "Analyze" },
      ]),
      domain("8", "8.SP", "Statistics & Probability", "통계와 확률", 4, [
        { code: "8.SP.A.1", title: "Construct and interpret scatter plots", titleKo: "산점도 만들고 해석하기", summary: "Construct and interpret scatter plots for bivariate measurement data to investigate patterns of association.", statement: "Students describe association in a scatter plot.", mastery: "Correct association description for 2 of 2 plots.", bloom: "Analyze" },
        { code: "8.SP.A.2", title: "Informally fit a straight line to scatter data", titleKo: "산점 자료에 직선 근사하기", summary: "Know that straight lines are used to model relationships between two quantitative variables.", statement: "Students sketch a line of best fit and interpret slope informally.", mastery: "Reasonable fit + slope meaning stated.", bloom: "Apply" },
      ]),
    ],
  ],
  [
    "HS",
    90,
    "High School — Algebra / Geometry / Stats",
    "고등 — 대수·기하·통계",
    [
      domain("HS", "A-REI", "Reasoning with Equations & Inequalities", "방정식과 부등식", 1, [
        { code: "A-REI.B.3", title: "Solve linear equations and inequalities in one variable", titleKo: "일차방정식·부등식 풀기", summary: "Solve linear equations and inequalities in one variable.", statement: "Students solve and check a linear equation/inequality.", mastery: "Correct solution set for 4 of 5.", bloom: "Apply" },
        { code: "A-REI.C.6", title: "Solve systems of linear equations", titleKo: "연립일차방정식 풀기", summary: "Solve systems of linear equations exactly and approximately.", statement: "Students solve a 2×2 system and verify.", mastery: "Correct for 3 of 3 systems.", bloom: "Apply" },
        { code: "A-REI.D.10", title: "Understand graph of an equation as solution set", titleKo: "방정식의 그래프를 해집합으로 이해하기", summary: "Understand that the graph of an equation in two variables is the set of all its solutions plotted.", statement: "Students explain why a point is/isn't on a graph.", mastery: "Correct justification for 3 of 3 points.", bloom: "Understand" },
      ]),
      domain("HS", "A-SSE", "Seeing Structure in Expressions", "식의 구조 보기", 2, [
        { code: "A-SSE.A.1", title: "Interpret expressions in context", titleKo: "맥락에서 식 해석하기", summary: "Interpret expressions that represent a quantity in terms of its context.", statement: "Students interpret parts of an expression in a model.", mastery: "Correct interpretation for 3 of 3.", bloom: "Understand" },
        { code: "A-SSE.A.2", title: "Use structure to rewrite expressions", titleKo: "구조를 이용해 식 다시 쓰기", summary: "Use the structure of an expression to identify ways to rewrite it.", statement: "Students factor or rewrite using structure.", mastery: "Correct rewrite for 3 of 4.", bloom: "Apply" },
      ]),
      domain("HS", "F-IF", "Interpreting Functions", "함수 해석", 3, [
        { code: "F-IF.A.1", title: "Understand function concept and notation", titleKo: "함수 개념과 기호 이해하기", summary: "Understand that a function assigns each element of the domain exactly one output.", statement: "Students evaluate f(x) and explain domain/range.", mastery: "Correct for 4 of 5.", bloom: "Understand" },
        { code: "F-IF.B.4", title: "Interpret key features of graphs and tables", titleKo: "그래프·표의 핵심 특징 해석하기", summary: "For a function, interpret key features of graphs and tables in terms of quantities.", statement: "Students identify intercepts, intervals of increase, maxima.", mastery: "≥3 correct features named.", bloom: "Analyze" },
        { code: "F-IF.C.7", title: "Graph functions and show key features", titleKo: "함수 그래프 그리고 핵심 특징 보이기", summary: "Graph functions expressed symbolically and show key features of the graph.", statement: "Students graph a linear/quadratic and label key features.", mastery: "Correct graph + labels for 2 of 2.", bloom: "Apply" },
      ]),
      domain("HS", "G-CO", "Congruence", "합동", 4, [
        { code: "G-CO.A.1", title: "Know precise definitions of angle, circle, etc.", titleKo: "각·원 등의 정확한 정의 알기", summary: "Know precise definitions of angle, circle, perpendicular line, parallel line, and line segment.", statement: "Students state precise definitions.", mastery: "Correct for 4 of 5 terms.", bloom: "Understand" },
        { code: "G-CO.B.6", title: "Use rigid motions to transform figures", titleKo: "강체 운동으로 도형 변환하기", summary: "Use geometric descriptions of rigid motions to transform figures and predict effect.", statement: "Students describe a rigid motion taking one figure onto another.", mastery: "Correct motion for 3 of 3.", bloom: "Apply" },
        { code: "G-CO.C.9", title: "Prove theorems about lines and angles", titleKo: "선과 각에 관한 정리 증명하기", summary: "Prove theorems about lines and angles.", statement: "Students complete a proof about vertical/corresponding angles.", mastery: "Valid proof steps for 1 theorem.", bloom: "Analyze" },
      ]),
      domain("HS", "G-SRT", "Similarity, Right Triangles, Trigonometry", "닮음·직각삼각형·삼각비", 5, [
        { code: "G-SRT.A.2", title: "Given two figures, use definition of similarity", titleKo: "닮음의 정의 사용하기", summary: "Given two figures, use the definition of similarity in terms of similarity transformations.", statement: "Students decide similarity and cite correspondence.", mastery: "Correct decision + mapping for 3 of 3.", bloom: "Analyze" },
        { code: "G-SRT.C.6", title: "Understand trigonometric ratios for acute angles", titleKo: "예각의 삼각비 이해하기", summary: "Understand that by similarity, side ratios in right triangles are properties of the angles.", statement: "Students define sin/cos/tan for an acute angle.", mastery: "Correct ratio definitions for 3 ratios.", bloom: "Understand" },
        { code: "G-SRT.C.8", title: "Use trigonometric ratios to solve right triangles", titleKo: "삼각비로 직각삼각형 풀기", summary: "Use trigonometric ratios and the Pythagorean Theorem to solve right triangles in applied problems.", statement: "Students solve for a missing side/angle in context.", mastery: "Correct for 3 of 4 applications.", bloom: "Apply" },
      ]),
      domain("HS", "S-ID", "Interpreting Categorical & Quantitative Data", "자료 해석", 6, [
        { code: "S-ID.A.1", title: "Represent data with plots on the real number line", titleKo: "수직선에 자료 나타내기", summary: "Represent data with plots on the real number line (dot plots, histograms, box plots).", statement: "Students create an appropriate plot for a data set.", mastery: "Correct plot type + labels.", bloom: "Apply" },
        { code: "S-ID.B.6", title: "Represent bivariate data on a scatter plot", titleKo: "이변량 자료를 산점도로 나타내기", summary: "Represent data on two quantitative variables on a scatter plot and describe how variables are related.", statement: "Students describe form, direction, strength.", mastery: "Correct description for 2 of 2 plots.", bloom: "Analyze" },
        { code: "S-ID.C.7", title: "Interpret slope and intercept of a linear model", titleKo: "선형 모형의 기울기·절편 해석하기", summary: "Interpret the slope and the intercept of a linear model in the context of the data.", statement: "Students interpret slope/intercept in context.", mastery: "Both interpretations correct for 1 model.", bloom: "Understand" },
      ]),
    ],
  ],
];

let mathOps = 0;
for (const [level, sort, title, titleKo, domains] of mathBands) {
  const res = ensureGrade(math, gradeNode(level, sort, title, titleKo, domains));
  if (res !== "skip") {
    mathOps += 1;
    console.log(`math ${level}: ${res}`);
  }
}

// Merge former geometry-stats pack then delete file
const gsPath = join(seed, "ccss-math-geometry-stats.json");
if (existsSync(gsPath)) {
  const gs = JSON.parse(readFileSync(gsPath, "utf8"));
  const hs = math.tree.children.find((c: { gradeLevel?: string }) => c.gradeLevel === "HS");
  if (hs && gs.tree?.children?.[0]) {
    for (const d of gs.tree.children[0].children || []) {
      if (!hs.children.some((x: { code?: string }) => x.code === d.code)) {
        hs.children.push(d);
        console.log(`math HS merged domain ${d.code}`);
      }
    }
  }
  unlinkSync(gsPath);
  console.log("removed ccss-math-geometry-stats.json (merged)");
}

math.framework.name = "Common Core State Standards — Mathematics (K–8 + HS)";
math.framework.nameKo = "공통핵심기준 — 수학 (K–8 + 고등)";
math.framework.description =
  "CCSS Mathematics coverage pack: Kindergarten–Grade 8 plus High School Algebra, Geometry, and Statistics samples.";
math.framework.metadata = {
  ...(math.framework.metadata || {}),
  gradeSpan: "K-8,HS",
  coverage: "full-band-sample",
};
save(mathPath, math);
console.log(`✓ math skills≈${countSkills(math.tree)} ops=${mathOps}`);

function S(
  code: string,
  title: string,
  titleKo: string,
  summary: string,
  statement: string,
  mastery: string,
  bloom = "Apply"
): SkillSpec {
  return { code, title, titleKo, summary, statement, mastery, bloom };
}

function applyBands(
  label: string,
  pack: { tree: { children: Array<{ gradeLevel?: string; children?: unknown[] }> }; framework: Record<string, unknown> },
  bands: Array<[string, number, string, string, ReturnType<typeof domain>[]]>,
  meta: { name: string; nameKo: string; description: string; gradeSpan: string }
) {
  let ops = 0;
  for (const [level, sort, title, titleKo, domains] of bands) {
    const res = ensureGrade(pack, gradeNode(level, sort, title, titleKo, domains));
    if (res !== "skip") {
      ops += 1;
      console.log(`${label} ${level}: ${res}`);
    }
  }
  pack.framework.name = meta.name;
  pack.framework.nameKo = meta.nameKo;
  pack.framework.description = meta.description;
  pack.framework.metadata = {
    ...((pack.framework.metadata as Record<string, unknown>) || {}),
    gradeSpan: meta.gradeSpan,
    coverage: "full-band-sample",
  };
  return ops;
}

// ───────────────── Phase 2: ELA ─────────────────
const elaPath = "ccss-ela-grade-4.json";
const ela = load(elaPath);

const elaBands: Array<[string, number, string, string, ReturnType<typeof domain>[]]> = [
  [
    "K",
    0,
    "Kindergarten",
    "유치원",
    [
      domain("K", "RL.K", "Reading Literature", "문학 읽기", 1, [
        S("RL.K.1", "Ask and answer questions about key details", "핵심 내용에 대해 묻고 답하기", "With prompting, ask and answer questions about key details in a text.", "Students answer a key-detail question about a story.", "Correct answer for 3 of 4 prompts.", "Understand"),
        S("RL.K.2", "Retell familiar stories", "익숙한 이야기 다시 말하기", "With prompting, retell familiar stories including key details.", "Students retell a familiar story with beginning/middle/end.", "Includes ≥3 key details.", "Understand"),
        S("RL.K.3", "Identify characters, settings, and major events", "인물·배경·주요 사건 식별하기", "With prompting, identify characters, settings, and major events.", "Students name character, setting, and one event.", "All three identified for 2 of 3 stories.", "Remember"),
      ]),
      domain("K", "RI.K", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.K.1", "Ask and answer questions about informational text", "정보 글에 대해 묻고 답하기", "With prompting, ask and answer questions about key details in informational text.", "Students answer a detail question from an informational text.", "Correct for 3 of 4.", "Understand"),
        S("RI.K.2", "Identify the main topic", "주요 주제 식별하기", "With prompting, identify the main topic and retell key details.", "Students state the main topic of a short informational text.", "Topic stated correctly for 2 of 3 texts.", "Understand"),
      ]),
      domain("K", "RF.K", "Foundational Skills", "기초 읽기 기능", 3, [
        S("RF.K.1", "Demonstrate understanding of print concepts", "활자 개념 이해하기", "Demonstrate understanding of the organization and basic features of print.", "Students show where to start reading and track left-to-right.", "Correct print tracking for 3 of 3.", "Understand"),
        S("RF.K.2", "Demonstrate phonological awareness", "음운 인식 보이기", "Demonstrate understanding of spoken words, syllables, and sounds.", "Students blend or segment simple spoken words.", "Correct for 4 of 5 items.", "Apply"),
        S("RF.K.3", "Know and apply grade-level phonics", "학년 수준 파닉스 알고 적용하기", "Know and apply grade-level phonics and word analysis skills.", "Students decode CVC words using letter-sound knowledge.", "≥80% on 10 CVC words.", "Apply"),
      ]),
      domain("K", "W.K", "Writing", "쓰기", 4, [
        S("W.K.1", "Use drawing/dictating/writing to compose opinion pieces", "그림·구술·쓰기로 의견 표현하기", "Use a combination of drawing, dictating, and writing to compose opinion pieces.", "Students state an opinion about a topic with a reason.", "Opinion + 1 reason present.", "Apply"),
        S("W.K.2", "Use drawing/dictating/writing to inform", "그림·구술·쓰기로 정보 전달하기", "Use a combination of drawing, dictating, and writing to compose informative texts.", "Students name a topic and supply information.", "Topic + 1 fact present.", "Apply"),
      ]),
      domain("K", "SL.K", "Speaking & Listening", "말하기·듣기", 5, [
        S("SL.K.1", "Participate in collaborative conversations", "협력적 대화에 참여하기", "Participate in collaborative conversations with diverse partners.", "Students take turns speaking about a classroom topic.", "Takes turns and stays on topic for 1 discussion.", "Apply"),
        S("SL.K.2", "Confirm understanding of read-alouds", "읽어 주는 글 이해 확인하기", "Confirm understanding of a text read aloud by asking and answering questions.", "Students ask or answer a clarifying question.", "Relevant question/answer for 2 of 2.", "Understand"),
      ]),
      domain("K", "L.K", "Language", "언어", 6, [
        S("L.K.1", "Demonstrate command of grammar when writing or speaking", "말·글에서 문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students use frequently occurring nouns and verbs correctly.", "Correct usage in 3 oral/written samples.", "Apply"),
        S("L.K.4", "Determine meaning of unknown words", "모르는 단어 의미 파악하기", "Determine or clarify the meaning of unknown words with prompting.", "Students use context or word parts with support.", "Correct meaning for 3 of 4 words.", "Understand"),
      ]),
    ],
  ],
  [
    "1",
    1,
    "Grade 1",
    "1학년",
    [
      domain("1", "RL.1", "Reading Literature", "문학 읽기", 1, [
        S("RL.1.1", "Ask and answer questions about key details", "핵심 내용에 대해 묻고 답하기", "Ask and answer questions about key details in a text.", "Students ask/answer detail questions about a story.", "Correct for 3 of 4.", "Understand"),
        S("RL.1.2", "Retell stories and demonstrate understanding of message", "이야기 다시 말하고 메시지 이해하기", "Retell stories including key details and demonstrate understanding of the central message.", "Students retell and state a lesson/message.", "Retell + message for 2 of 3 stories.", "Understand"),
        S("RL.1.3", "Describe characters, settings, and events", "인물·배경·사건 설명하기", "Describe characters, settings, and major events using key details.", "Students describe character/setting/event with details.", "All three described for 2 of 3.", "Understand"),
      ]),
      domain("1", "RI.1", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.1.1", "Ask and answer questions about informational text", "정보 글에 대해 묻고 답하기", "Ask and answer questions about key details in informational text.", "Students locate answers in the text.", "Correct + text support for 3 of 4.", "Understand"),
        S("RI.1.2", "Identify main topic and retell key details", "주요 주제 파악하고 세부 내용 다시 말하기", "Identify the main topic and retell key details of a text.", "Students state topic and two details.", "Topic + 2 details for 2 of 3.", "Understand"),
      ]),
      domain("1", "RF.1", "Foundational Skills", "기초 읽기 기능", 3, [
        S("RF.1.2", "Demonstrate phonological awareness", "음운 인식 보이기", "Demonstrate understanding of spoken words, syllables, and sounds.", "Students isolate/blend phonemes in spoken words.", "Correct for 4 of 5.", "Apply"),
        S("RF.1.3", "Know and apply grade-level phonics", "학년 수준 파닉스 알고 적용하기", "Know and apply grade-level phonics and word analysis skills.", "Students decode regularly spelled one-syllable words.", "≥80% on 12 words.", "Apply"),
        S("RF.1.4", "Read with sufficient accuracy and fluency", "정확하고 유창하게 읽기", "Read with sufficient accuracy and fluency to support comprehension.", "Students read a grade-level passage aloud.", "Accuracy ≥90% on cold read.", "Apply"),
      ]),
      domain("1", "W.1", "Writing", "쓰기", 4, [
        S("W.1.1", "Write opinion pieces", "의견문 쓰기", "Write opinion pieces in which they introduce the topic, state an opinion, and supply a reason.", "Students write an opinion with a reason.", "Opinion + reason + closing present.", "Apply"),
        S("W.1.2", "Write informative texts", "정보문 쓰기", "Write informative/explanatory texts naming a topic and supplying facts.", "Students write 3+ sentences about a topic.", "Topic + ≥2 facts.", "Apply"),
      ]),
      domain("1", "SL.1", "Speaking & Listening", "말하기·듣기", 5, [
        S("SL.1.1", "Participate in collaborative conversations", "협력적 대화에 참여하기", "Participate in collaborative conversations with diverse partners.", "Students build on others' talk in discussions.", "On-topic contribution in 1 discussion.", "Apply"),
        S("SL.1.2", "Ask and answer questions about key details", "핵심 내용에 대해 묻고 답하기", "Ask and answer questions about key details in a text read aloud or information presented orally.", "Students ask clarifying questions.", "Relevant question for 2 of 2 texts.", "Understand"),
      ]),
      domain("1", "L.1", "Language", "언어", 6, [
        S("L.1.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students use common/proper nouns and verbs correctly.", "Correct in 3 writing samples.", "Apply"),
        S("L.1.4", "Determine meaning of unknown words", "모르는 단어 의미 파악하기", "Determine or clarify the meaning of unknown words based on grade 1 reading.", "Students use sentence-level context.", "Correct for 3 of 4.", "Understand"),
      ]),
    ],
  ],
  [
    "2",
    2,
    "Grade 2",
    "2학년",
    [
      domain("2", "RL.2", "Reading Literature", "문학 읽기", 1, [
        S("RL.2.1", "Ask and answer who/what/where/when/why/how questions", "육하원칙 질문하고 답하기", "Ask and answer such questions as who, what, where, when, why, and how.", "Students answer 5W+H questions with text evidence.", "Correct for 4 of 5.", "Understand"),
        S("RL.2.2", "Recount stories and determine central message", "이야기 요약하고 중심 메시지 파악하기", "Recount stories and determine their central message, lesson, or moral.", "Students recount and state the lesson.", "Recount + lesson for 2 of 3.", "Understand"),
        S("RL.2.3", "Describe how characters respond to challenges", "인물이 문제에 대응하는 방식 설명하기", "Describe how characters in a story respond to major events and challenges.", "Students describe a character response to a challenge.", "Response tied to event for 2 characters.", "Analyze"),
      ]),
      domain("2", "RI.2", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.2.1", "Ask and answer 5W+H questions about informational text", "정보 글에 육하원칙으로 묻고 답하기", "Ask and answer who/what/where/when/why/how to demonstrate understanding.", "Students cite text to answer 5W+H.", "Correct + citation for 4 of 5.", "Understand"),
        S("RI.2.2", "Identify the main topic of a multiparagraph text", "여러 문단 글의 주요 주제 파악하기", "Identify the main topic of a multiparagraph text as well as the focus of specific paragraphs.", "Students state overall topic and a paragraph focus.", "Both correct for 2 of 3 texts.", "Understand"),
      ]),
      domain("2", "RF.2", "Foundational Skills", "기초 읽기 기능", 3, [
        S("RF.2.3", "Know and apply grade-level phonics", "학년 수준 파닉스 알고 적용하기", "Know and apply grade-level phonics and word analysis skills.", "Students decode two-syllable words with long vowels.", "≥80% on 12 words.", "Apply"),
        S("RF.2.4", "Read with sufficient accuracy and fluency", "정확하고 유창하게 읽기", "Read with sufficient accuracy and fluency to support comprehension.", "Students read grade-level text with purpose and understanding.", "Accuracy ≥90% + 2 comprehension checks.", "Apply"),
      ]),
      domain("2", "W.2", "Writing", "쓰기", 4, [
        S("W.2.1", "Write opinion pieces with reasons", "이유를 들어 의견문 쓰기", "Write opinion pieces introducing the topic, stating an opinion, supplying reasons, and providing a concluding statement.", "Students write an organized opinion paragraph.", "Opinion + ≥2 reasons + conclusion.", "Apply"),
        S("W.2.2", "Write informative texts", "정보문 쓰기", "Write informative/explanatory texts introducing a topic and using facts and definitions.", "Students write a short informative piece.", "Topic + ≥3 facts + closing.", "Apply"),
      ]),
      domain("2", "SL.2", "Speaking & Listening", "말하기·듣기", 5, [
        S("SL.2.1", "Participate in collaborative conversations", "협력적 대화에 참여하기", "Participate in collaborative conversations with diverse partners.", "Students follow agreed-upon rules and build on others' remarks.", "Meets discussion norms in 1 session.", "Apply"),
        S("SL.2.2", "Recount or describe key ideas from media", "매체에서 핵심 아이디어 말하기", "Recount or describe key ideas or details from a text read aloud or information presented orally/through media.", "Students recount key ideas from a short video/read-aloud.", "≥3 accurate key ideas.", "Understand"),
      ]),
      domain("2", "L.2", "Language", "언어", 6, [
        S("L.2.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students use collective nouns, irregular plurals, and past tense correctly.", "Correct in 3 writing samples.", "Apply"),
        S("L.2.4", "Determine meaning of unknown words", "모르는 단어 의미 파악하기", "Determine or clarify the meaning of unknown words based on grade 2 reading.", "Students use context and prefixes.", "Correct for 4 of 5.", "Understand"),
      ]),
    ],
  ],
  [
    "3",
    3,
    "Grade 3",
    "3학년",
    [
      domain("3", "RL.3", "Reading Literature", "문학 읽기", 1, [
        S("RL.3.1", "Ask and answer questions referring explicitly to the text", "글을 명시적으로 인용하며 묻고 답하기", "Ask and answer questions to demonstrate understanding, referring explicitly to the text.", "Students answer with explicit text reference.", "Answer + citation for 3 of 3.", "Understand"),
        S("RL.3.2", "Determine central message and how it is conveyed", "중심 메시지와 전달 방식 파악하기", "Recount stories and determine the central message; explain how it is conveyed.", "Students state message and cite supporting details.", "Message + 2 supports.", "Analyze"),
        S("RL.3.3", "Describe characters and explain how actions contribute to events", "인물과 행동이 사건에 미치는 영향 설명하기", "Describe characters and explain how their actions contribute to the sequence of events.", "Students link trait–action–event.", "Link for 2 characters.", "Analyze"),
        S("RL.3.4", "Determine meaning of words and phrases", "단어·구의 의미 파악하기", "Determine the meaning of words and phrases as they are used in a text.", "Students explain a word using context.", "Correct for 3 of 4.", "Understand"),
      ]),
      domain("3", "RI.3", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.3.1", "Ask and answer questions referring explicitly to the text", "글을 명시적으로 인용하며 묻고 답하기", "Ask and answer questions to demonstrate understanding, referring explicitly to the text.", "Students cite text for answers.", "Citation for 3 of 3.", "Understand"),
        S("RI.3.2", "Determine main idea and recount key details", "주요 생각과 핵심 세부 내용 파악하기", "Determine the main idea of a text; recount key details and explain how they support the main idea.", "Students state main idea + supporting details.", "Main idea + 2 details.", "Understand"),
        S("RI.3.5", "Use text features and search tools", "텍스트 특징과 검색 도구 사용하기", "Use text features and search tools to locate information efficiently.", "Students use headings/captions/keywords to find info.", "Locates info for 3 of 3 prompts.", "Apply"),
      ]),
      domain("3", "W.3", "Writing", "쓰기", 3, [
        S("W.3.1", "Write opinion pieces on topics or texts", "주제·글에 대한 의견문 쓰기", "Write opinion pieces on topics or texts supporting a point of view with reasons.", "Students write an opinion with organized reasons.", "Opinion + ≥2 reasons + conclusion.", "Apply"),
        S("W.3.2", "Write informative/explanatory texts", "정보·설명문 쓰기", "Write informative/explanatory texts to examine a topic and convey ideas clearly.", "Students write a clear informative piece.", "Topic intro + facts + closing.", "Apply"),
        S("W.3.7", "Conduct short research projects", "짧은 탐구 프로젝트 수행하기", "Conduct short research projects that build knowledge about a topic.", "Students gather facts from 2 sources on one topic.", "Notes from ≥2 sources.", "Apply"),
      ]),
      domain("3", "SL.3", "Speaking & Listening", "말하기·듣기", 4, [
        S("SL.3.1", "Engage effectively in collaborative discussions", "협력 토론에 효과적으로 참여하기", "Engage effectively in a range of collaborative discussions.", "Students come prepared and build on others' ideas.", "Meets norms in 1 discussion.", "Apply"),
        S("SL.3.4", "Report on a topic or text", "주제·글에 대해 보고하기", "Report on a topic or text with appropriate facts and relevant details.", "Students give a short oral report.", "Clear topic + ≥3 details.", "Apply"),
      ]),
      domain("3", "L.3", "Language", "언어", 5, [
        S("L.3.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students use regular/irregular verbs and simple verb tenses.", "Correct in 3 samples.", "Apply"),
        S("L.3.4", "Determine or clarify word meanings", "단어 의미 파악·명확히 하기", "Determine or clarify the meaning of unknown words based on grade 3 reading.", "Students use context, affixes, and dictionaries.", "Correct for 4 of 5.", "Understand"),
      ]),
    ],
  ],
  [
    "4",
    4,
    "Grade 4",
    "4학년",
    [
      domain("4", "RL.4", "Reading Literature", "문학 읽기", 1, [
        S("RL.4.1", "Refer to details and examples when explaining", "설명·추론할 때 세부 내용·사례 참조하기", "Refer to details and examples in a text when explaining what the text says explicitly and when drawing inferences.", "Students support an inference with a detail.", "Inference + detail for 3 of 3.", "Analyze"),
        S("RL.4.2", "Determine theme from details", "세부 내용으로 주제 파악하기", "Determine a theme of a story, drama, or poem from details in the text.", "Students state a theme with supporting details.", "Theme + 2 details.", "Analyze"),
        S("RL.4.3", "Describe character, setting, or event in depth", "인물·배경·사건을 깊이 있게 설명하기", "Describe in depth a character, setting, or event drawing on specific details.", "Students write an in-depth description using text details.", "≥3 specific details used.", "Analyze"),
        S("RL.4.4", "Determine meaning of words and phrases", "단어·구의 의미 파악하기", "Determine the meaning of words and phrases as they are used in a text, including mythology references.", "Students explain figurative or academic language.", "Correct for 3 of 4.", "Understand"),
      ]),
      domain("4", "RI.4", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.4.1", "Refer to details when explaining/inferring", "설명·추론할 때 세부 내용 참조하기", "Refer to details and examples when explaining what the text says and when drawing inferences.", "Students cite evidence for an inference.", "Evidence for 3 of 3.", "Analyze"),
        S("RI.4.2", "Determine main idea and explain how details support it", "주요 생각과 세부 내용의 뒷받침 설명하기", "Determine the main idea and explain how it is supported by key details; summarize.", "Students summarize with main idea + supports.", "Summary includes main idea + 2 details.", "Understand"),
        S("RI.4.5", "Describe overall structure of events/ideas", "사건·아이디어의 전체 구조 설명하기", "Describe the overall structure of events, ideas, concepts, or information in a text.", "Students identify structure (compare, cause/effect, etc.).", "Correct structure label + evidence.", "Analyze"),
      ]),
      domain("4", "W.4", "Writing", "쓰기", 3, [
        S("W.4.1", "Write opinion pieces supporting a point of view", "관점을 뒷받침하는 의견문 쓰기", "Write opinion pieces on topics or texts supporting a point of view with reasons and information.", "Students write a multi-paragraph opinion.", "Clear claim + reasons + conclusion.", "Apply"),
        S("W.4.2", "Write informative/explanatory texts", "정보·설명문 쓰기", "Write informative/explanatory texts to examine a topic and convey ideas clearly.", "Students organize information logically.", "Intro + developed body + closing.", "Apply"),
        S("W.4.7", "Conduct short research projects", "짧은 탐구 프로젝트 수행하기", "Conduct short research projects that build knowledge through investigation of different aspects of a topic.", "Students investigate 2 aspects of a topic.", "Notes covering ≥2 aspects.", "Apply"),
      ]),
      domain("4", "SL.4", "Speaking & Listening", "말하기·듣기", 4, [
        S("SL.4.1", "Engage effectively in collaborative discussions", "협력 토론에 효과적으로 참여하기", "Engage effectively in a range of collaborative discussions.", "Students pose/respond to questions and elaborate.", "Meets discussion criteria once.", "Apply"),
        S("SL.4.4", "Report on a topic with organization", "조직적으로 주제 보고하기", "Report on a topic or text in an organized manner using appropriate facts and details.", "Students present with clear organization.", "Organized report with ≥4 facts.", "Apply"),
      ]),
      domain("4", "L.4", "Language", "언어", 5, [
        S("L.4.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students use relative pronouns and progressive verb tenses.", "Correct in 3 samples.", "Apply"),
        S("L.4.4", "Determine or clarify word meanings", "단어 의미 파악·명확히 하기", "Determine or clarify the meaning of unknown words based on grade 4 reading.", "Students use Greek/Latin affixes and context.", "Correct for 4 of 5.", "Understand"),
      ]),
    ],
  ],
  [
    "5",
    5,
    "Grade 5",
    "5학년",
    [
      domain("5", "RL.5", "Reading Literature", "문학 읽기", 1, [
        S("RL.5.1", "Quote accurately when explaining/inferring", "설명·추론할 때 정확히 인용하기", "Quote accurately from a text when explaining what the text says explicitly and when drawing inferences.", "Students support claims with accurate quotes.", "Accurate quote for 3 of 3.", "Analyze"),
        S("RL.5.2", "Determine theme and how characters respond", "주제와 인물의 대응 파악하기", "Determine a theme and how characters respond to challenges; summarize.", "Students state theme and character response.", "Theme + response + summary.", "Analyze"),
        S("RL.5.3", "Compare characters, settings, or events", "인물·배경·사건 비교하기", "Compare and contrast two or more characters, settings, or events.", "Students write a comparison using details.", "≥2 similarities and differences.", "Analyze"),
      ]),
      domain("5", "RI.5", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.5.1", "Quote accurately when explaining/inferring", "설명·추론할 때 정확히 인용하기", "Quote accurately from a text when explaining and when drawing inferences.", "Students use accurate quotes as evidence.", "Quote for 3 of 3.", "Analyze"),
        S("RI.5.2", "Determine two or more main ideas", "둘 이상의 주요 생각 파악하기", "Determine two or more main ideas and explain how they are supported; summarize.", "Students identify dual main ideas with supports.", "2 main ideas + supports.", "Understand"),
        S("RI.5.5", "Compare overall structure of events/ideas", "사건·아이디어의 전체 구조 비교하기", "Compare and contrast the overall structure of events, ideas, concepts, or information in two or more texts.", "Students compare structures across texts.", "Correct comparison for 1 pair.", "Analyze"),
      ]),
      domain("5", "W.5", "Writing", "쓰기", 3, [
        S("W.5.1", "Write opinion pieces supporting a point of view", "관점을 뒷받침하는 의견문 쓰기", "Write opinion pieces supporting a point of view with reasons and information.", "Students write a developed opinion essay.", "Claim + linked reasons + conclusion.", "Apply"),
        S("W.5.2", "Write informative/explanatory texts", "정보·설명문 쓰기", "Write informative/explanatory texts to examine a topic and convey ideas clearly.", "Students develop a topic with facts/definitions.", "Clear organization + domain vocabulary.", "Apply"),
        S("W.5.7", "Conduct short research projects using several sources", "여러 자료를 쓰는 짧은 탐구 수행하기", "Conduct short research projects that use several sources to build knowledge.", "Students synthesize 3 sources.", "Notes from ≥3 sources.", "Apply"),
      ]),
      domain("5", "SL.5", "Speaking & Listening", "말하기·듣기", 4, [
        S("SL.5.1", "Engage effectively in collaborative discussions", "협력 토론에 효과적으로 참여하기", "Engage effectively in a range of collaborative discussions.", "Students draw on preparation and respond thoughtfully.", "Meets criteria in 1 discussion.", "Apply"),
        S("SL.5.4", "Report on a topic sequencing ideas logically", "아이디어를 논리적으로 배열해 보고하기", "Report on a topic or text sequencing ideas logically and using appropriate facts.", "Students present with logical sequence.", "Logical sequence + adequate detail.", "Apply"),
      ]),
      domain("5", "L.5", "Language", "언어", 5, [
        S("L.5.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students explain correlative conjunctions and verb tense consistency.", "Correct in 3 samples.", "Apply"),
        S("L.5.4", "Determine or clarify word meanings", "단어 의미 파악·명확히 하기", "Determine or clarify the meaning of unknown words based on grade 5 reading.", "Students use context, affixes, and reference materials.", "Correct for 4 of 5.", "Understand"),
      ]),
    ],
  ],
  [
    "6",
    6,
    "Grade 6",
    "6학년",
    [
      domain("6", "RL.6", "Reading Literature", "문학 읽기", 1, [
        S("RL.6.1", "Cite textual evidence to support analysis", "분석을 뒷받침할 텍스트 근거 인용하기", "Cite textual evidence to support analysis of what the text says explicitly as well as inferences.", "Students cite evidence for an analysis claim.", "Claim + citation for 3 of 3.", "Analyze"),
        S("RL.6.2", "Determine theme and how it is conveyed", "주제와 전달 방식 파악하기", "Determine a theme and how it is conveyed through particular details; provide a summary.", "Students write an objective summary with theme.", "Theme + summary without opinion.", "Analyze"),
        S("RL.6.3", "Describe how plot unfolds and characters change", "플롯 전개와 인물 변화 설명하기", "Describe how a particular story's plot unfolds and how characters respond or change.", "Students track character change across plot.", "Change linked to ≥2 plot events.", "Analyze"),
      ]),
      domain("6", "RI.6", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.6.1", "Cite textual evidence to support analysis", "분석을 뒷받침할 텍스트 근거 인용하기", "Cite textual evidence to support analysis of what the text says explicitly as well as inferences.", "Students support informational analysis with citations.", "Citation for 3 of 3.", "Analyze"),
        S("RI.6.2", "Determine central idea and summarize", "중심 생각 파악하고 요약하기", "Determine a central idea and how it is conveyed; provide an objective summary.", "Students summarize objectively.", "Central idea + objective summary.", "Understand"),
        S("RI.6.5", "Analyze how a text presents information", "글이 정보를 제시하는 방식 분석하기", "Analyze how a particular sentence, paragraph, or section fits into the overall structure.", "Students explain a section's role in structure.", "Role explained with evidence.", "Analyze"),
      ]),
      domain("6", "W.6", "Writing", "쓰기", 3, [
        S("W.6.1", "Write arguments to support claims", "주장을 뒷받침하는 논설문 쓰기", "Write arguments to support claims with clear reasons and relevant evidence.", "Students write a claim-driven argument.", "Claim + reasons + evidence + conclusion.", "Apply"),
        S("W.6.2", "Write informative/explanatory texts", "정보·설명문 쓰기", "Write informative/explanatory texts to examine a topic and convey ideas.", "Students organize complex information.", "Clear structure + evidence.", "Apply"),
        S("W.6.7", "Conduct short research projects", "짧은 탐구 프로젝트 수행하기", "Conduct short research projects to answer a question, drawing on several sources.", "Students answer a research question from multiple sources.", "Question answered with ≥3 sources.", "Apply"),
      ]),
      domain("6", "SL.6", "Speaking & Listening", "말하기·듣기", 4, [
        S("SL.6.1", "Engage effectively in collaborative discussions", "협력 토론에 효과적으로 참여하기", "Engage effectively in a range of collaborative discussions.", "Students refer to evidence and propel conversations.", "Evidence-based contribution once.", "Apply"),
        S("SL.6.4", "Present claims and findings", "주장과 발견 발표하기", "Present claims and findings sequencing ideas logically and using pertinent descriptions.", "Students give an organized oral presentation.", "Clear claim + logical sequence.", "Apply"),
      ]),
      domain("6", "L.6", "Language", "언어", 5, [
        S("L.6.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students use pronouns in proper case and intensive pronouns.", "Correct in 3 samples.", "Apply"),
        S("L.6.4", "Determine or clarify word meanings", "단어 의미 파악·명확히 하기", "Determine or clarify the meaning of unknown words based on grade 6 reading.", "Students use context, Greek/Latin affixes, and references.", "Correct for 4 of 5.", "Understand"),
      ]),
    ],
  ],
  [
    "7",
    7,
    "Grade 7",
    "7학년",
    [
      domain("7", "RL.7", "Reading Literature", "문학 읽기", 1, [
        S("RL.7.1", "Cite several pieces of textual evidence", "여러 텍스트 근거 인용하기", "Cite several pieces of textual evidence to support analysis of what the text says and inferences drawn.", "Students cite ≥2 pieces of evidence per claim.", "≥2 citations for 2 claims.", "Analyze"),
        S("RL.7.2", "Determine theme and analyze its development", "주제 파악과 전개 분석하기", "Determine a theme and analyze its development over the course of the text.", "Students track theme development.", "Theme arc with ≥3 text moments.", "Analyze"),
        S("RL.7.3", "Analyze how elements of a story interact", "이야기 요소의 상호작용 분석하기", "Analyze how particular elements of a story or drama interact.", "Students explain setting–character or plot–character interaction.", "Interaction analysis with evidence.", "Analyze"),
      ]),
      domain("7", "RI.7", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.7.1", "Cite several pieces of textual evidence", "여러 텍스트 근거 인용하기", "Cite several pieces of textual evidence to support analysis.", "Students support claims with multiple citations.", "≥2 citations for 2 claims.", "Analyze"),
        S("RI.7.2", "Determine two or more central ideas", "둘 이상의 중심 생각 파악하기", "Determine two or more central ideas and analyze their development; provide an objective summary.", "Students identify dual central ideas.", "2 ideas + development notes.", "Analyze"),
        S("RI.7.5", "Analyze structure of a text", "글의 구조 분석하기", "Analyze the structure an author uses to organize a text, including how major sections contribute.", "Students explain contribution of a section.", "Structure analysis with evidence.", "Analyze"),
      ]),
      domain("7", "W.7", "Writing", "쓰기", 3, [
        S("W.7.1", "Write arguments to support claims", "주장을 뒷받침하는 논설문 쓰기", "Write arguments to support claims with clear reasons and relevant evidence.", "Students acknowledge alternate claims.", "Claim + evidence + counterpoint.", "Apply"),
        S("W.7.2", "Write informative/explanatory texts", "정보·설명문 쓰기", "Write informative/explanatory texts to examine a topic and convey ideas.", "Students use appropriate organization and vocabulary.", "Clear informative draft.", "Apply"),
        S("W.7.7", "Conduct short research projects", "짧은 탐구 프로젝트 수행하기", "Conduct short research projects to answer a question, drawing on several sources and generating additional related questions.", "Students generate follow-up questions from research.", "Answer + ≥1 new question + sources.", "Apply"),
      ]),
      domain("7", "SL.7", "Speaking & Listening", "말하기·듣기", 4, [
        S("SL.7.1", "Engage effectively in collaborative discussions", "협력 토론에 효과적으로 참여하기", "Engage effectively in a range of collaborative discussions.", "Students acknowledge new information and qualify views.", "Meets discussion criteria once.", "Apply"),
        S("SL.7.4", "Present claims and findings emphasizing key points", "핵심을 강조하며 주장·발견 발표하기", "Present claims and findings emphasizing salient points in a focused, coherent manner.", "Students present with emphasis on key points.", "Focused coherent presentation.", "Apply"),
      ]),
      domain("7", "L.7", "Language", "언어", 5, [
        S("L.7.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students explain phrase/clause function and choose among simple/compound/complex sentences.", "Correct in 3 samples.", "Apply"),
        S("L.7.4", "Determine or clarify word meanings", "단어 의미 파악·명확히 하기", "Determine or clarify the meaning of unknown words based on grade 7 reading.", "Students use Greek/Latin affixes and context.", "Correct for 4 of 5.", "Understand"),
      ]),
    ],
  ],
  [
    "8",
    8,
    "Grade 8",
    "8학년",
    [
      domain("8", "RL.8", "Reading Literature", "문학 읽기", 1, [
        S("RL.8.1", "Cite textual evidence that most strongly supports analysis", "분석을 가장 강하게 뒷받침하는 근거 인용하기", "Cite the textual evidence that most strongly supports an analysis.", "Students select strongest evidence for a claim.", "Strongest evidence justified for 2 claims.", "Analyze"),
        S("RL.8.2", "Determine theme and analyze its development", "주제 파악과 전개 분석하기", "Determine a theme and analyze its development, including its relationship to characters, setting, and plot.", "Students connect theme to story elements.", "Theme linked to character/setting/plot.", "Analyze"),
        S("RL.8.3", "Analyze dialogue and incidents that propel action", "행동을 이끄는 대화·사건 분석하기", "Analyze how particular lines of dialogue or incidents propel action and reveal character.", "Students analyze a key dialogue/incident.", "Action + character revelation explained.", "Analyze"),
      ]),
      domain("8", "RI.8", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.8.1", "Cite strongest textual evidence", "가장 강한 텍스트 근거 인용하기", "Cite the textual evidence that most strongly supports an analysis.", "Students choose strongest evidence.", "Justification for 2 claims.", "Analyze"),
        S("RI.8.2", "Determine central idea and analyze development", "중심 생각 파악과 전개 분석하기", "Determine a central idea and analyze its development over the course of the text.", "Students track idea development.", "Central idea arc with ≥3 moments.", "Analyze"),
        S("RI.8.5", "Analyze structure of a specific paragraph", "특정 문단의 구조 분석하기", "Analyze in detail the structure of a specific paragraph, including the role of particular sentences.", "Students explain sentence roles in a paragraph.", "Role analysis with evidence.", "Analyze"),
      ]),
      domain("8", "W.8", "Writing", "쓰기", 3, [
        S("W.8.1", "Write arguments to support claims", "주장을 뒷받침하는 논설문 쓰기", "Write arguments to support claims with clear reasons and relevant evidence.", "Students distinguish claim from opposing claims.", "Claim + evidence + rebuttal.", "Apply"),
        S("W.8.2", "Write informative/explanatory texts", "정보·설명문 쓰기", "Write informative/explanatory texts to examine a topic and convey ideas.", "Students organize complex ideas effectively.", "Clear informative essay.", "Apply"),
        S("W.8.7", "Conduct short research projects", "짧은 탐구 프로젝트 수행하기", "Conduct short research projects to answer a question, drawing on several sources and generating additional related, focused questions.", "Students refine a research question.", "Refined question + multi-source answer.", "Apply"),
      ]),
      domain("8", "SL.8", "Speaking & Listening", "말하기·듣기", 4, [
        S("SL.8.1", "Engage effectively in collaborative discussions", "협력 토론에 효과적으로 참여하기", "Engage effectively in a range of collaborative discussions.", "Students qualify or justify views with evidence.", "Evidence-based discussion once.", "Apply"),
        S("SL.8.4", "Present claims and findings with eye contact", "시선 맞춤을 유지하며 주장·발견 발표하기", "Present claims and findings emphasizing salient points and using appropriate eye contact, volume, and pronunciation.", "Students deliver a clear oral presentation.", "Meets delivery criteria.", "Apply"),
      ]),
      domain("8", "L.8", "Language", "언어", 5, [
        S("L.8.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students explain verbals and use active/passive voice.", "Correct in 3 samples.", "Apply"),
        S("L.8.4", "Determine or clarify word meanings", "단어 의미 파악·명확히 하기", "Determine or clarify the meaning of unknown words based on grade 8 reading.", "Students use context, affixes, and references.", "Correct for 4 of 5.", "Understand"),
      ]),
    ],
  ],
  [
    "9",
    9,
    "Grades 9–10",
    "9–10학년",
    [
      domain("9", "RL.9-10", "Reading Literature", "문학 읽기", 1, [
        S("RL.9-10.1", "Cite strong textual evidence", "강한 텍스트 근거 인용하기", "Cite strong and thorough textual evidence to support analysis of what the text says and inferences.", "Students cite strong evidence for literary analysis.", "Strong citation for 3 claims.", "Analyze"),
        S("RL.9-10.2", "Determine theme and analyze development", "주제 파악과 전개 분석하기", "Determine a theme and analyze in detail its development, including how it emerges and is shaped.", "Students write a theme analysis essay paragraph.", "Theme development with textual arc.", "Analyze"),
        S("RL.9-10.3", "Analyze complex characters", "복합적 인물 분석하기", "Analyze how complex characters develop over the course of a text, interact with other characters, and advance plot/theme.", "Students analyze a complex character's development.", "Development + interaction + theme link.", "Analyze"),
      ]),
      domain("9", "RI.9-10", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.9-10.1", "Cite strong textual evidence", "강한 텍스트 근거 인용하기", "Cite strong and thorough textual evidence to support analysis.", "Students support informational claims with strong evidence.", "Strong citation for 3 claims.", "Analyze"),
        S("RI.9-10.2", "Determine central idea and analyze development", "중심 생각 파악과 전개 분석하기", "Determine a central idea and analyze its development; provide an objective summary.", "Students produce an objective analytical summary.", "Central idea + development + summary.", "Analyze"),
        S("RI.9-10.8", "Delineate and evaluate argument and claims", "논증과 주장 구분·평가하기", "Delineate and evaluate the argument and specific claims in a text, assessing whether reasoning is valid.", "Students evaluate an argument's validity.", "Claim map + validity judgment.", "Evaluate"),
      ]),
      domain("9", "W.9-10", "Writing", "쓰기", 3, [
        S("W.9-10.1", "Write arguments to support claims", "주장을 뒷받침하는 논설문 쓰기", "Write arguments to support claims in an analysis of substantive topics or texts.", "Students write a formal argument essay.", "Claim + warrants + counterclaim.", "Apply"),
        S("W.9-10.2", "Write informative/explanatory texts", "정보·설명문 쓰기", "Write informative/explanatory texts to examine and convey complex ideas clearly.", "Students write a clear explanatory essay.", "Organized complex explanation.", "Apply"),
        S("W.9-10.7", "Conduct research projects", "탐구 프로젝트 수행하기", "Conduct short as well as more sustained research projects to answer a question or solve a problem.", "Students complete a multi-source research mini-project.", "Research question answered with citations.", "Apply"),
      ]),
      domain("9", "SL.9-10", "Speaking & Listening", "말하기·듣기", 4, [
        S("SL.9-10.1", "Initiate and participate in collaborative discussions", "협력 토론을 시작하고 참여하기", "Initiate and participate effectively in a range of collaborative discussions.", "Students propel discussion with prepared evidence.", "Initiates + contributes with evidence.", "Apply"),
        S("SL.9-10.4", "Present information clearly and logically", "정보를 명확하고 논리적으로 발표하기", "Present information, findings, and supporting evidence clearly, concisely, and logically.", "Students deliver a structured presentation.", "Clear logical presentation.", "Apply"),
      ]),
      domain("9", "L.9-10", "Language", "언어", 5, [
        S("L.9-10.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students use parallel structure and various phrase/clause types.", "Correct in 3 samples.", "Apply"),
        S("L.9-10.4", "Determine or clarify word meanings", "단어 의미 파악·명확히 하기", "Determine or clarify the meaning of unknown words based on grades 9–10 reading.", "Students use context and patterns of word changes.", "Correct for 4 of 5.", "Understand"),
      ]),
    ],
  ],
  [
    "11",
    11,
    "Grades 11–12",
    "11–12학년",
    [
      domain("11", "RL.11-12", "Reading Literature", "문학 읽기", 1, [
        S("RL.11-12.1", "Cite strong and thorough textual evidence", "강력하고 철저한 텍스트 근거 인용하기", "Cite strong and thorough textual evidence to support analysis, including determining where the text leaves matters uncertain.", "Students analyze ambiguity with evidence.", "Evidence for certainty and uncertainty.", "Analyze"),
        S("RL.11-12.2", "Determine two or more themes", "둘 이상의 주제 파악하기", "Determine two or more themes and analyze their development, including how they interact and build on one another.", "Students analyze interacting themes.", "2 themes + interaction analysis.", "Analyze"),
      ]),
      domain("11", "RI.11-12", "Reading Informational", "정보 글 읽기", 2, [
        S("RI.11-12.1", "Cite strong and thorough textual evidence", "강력하고 철저한 텍스트 근거 인용하기", "Cite strong and thorough textual evidence to support analysis, including where the text leaves matters uncertain.", "Students analyze informational nuance.", "Nuanced evidence-based analysis.", "Analyze"),
        S("RI.11-12.7", "Integrate and evaluate multiple sources", "여러 자료 통합·평가하기", "Integrate and evaluate multiple sources of information presented in different media or formats.", "Students synthesize 3+ sources across media.", "Synthesis with evaluation.", "Evaluate"),
      ]),
      domain("11", "W.11-12", "Writing", "쓰기", 3, [
        S("W.11-12.1", "Write arguments to support claims in analysis", "분석에서 주장을 뒷받침하는 논설문 쓰기", "Write arguments to support claims in an analysis of substantive topics or texts, using valid reasoning.", "Students write a college-ready argument.", "Nuanced claim + valid reasoning.", "Apply"),
        S("W.11-12.2", "Write informative/explanatory texts", "정보·설명문 쓰기", "Write informative/explanatory texts to examine and convey complex ideas clearly and accurately.", "Students convey complex ideas precisely.", "Precise organized explanation.", "Apply"),
      ]),
      domain("11", "SL.11-12", "Speaking & Listening", "말하기·듣기", 4, [
        S("SL.11-12.1", "Initiate and participate effectively in discussions", "토론을 효과적으로 시작하고 참여하기", "Initiate and participate effectively in a range of collaborative discussions.", "Students synthesize multiple perspectives.", "Synthesis contribution in discussion.", "Apply"),
      ]),
      domain("11", "L.11-12", "Language", "언어", 5, [
        S("L.11-12.1", "Demonstrate command of grammar", "문법 규칙 보이기", "Demonstrate command of the conventions of standard English grammar.", "Students apply usage conventions thoughtfully.", "Correct polished usage in 2 samples.", "Apply"),
      ]),
    ],
  ],
];

const elaOps = applyBands("ela", ela, elaBands, {
  name: "Common Core State Standards — English Language Arts (K–12 sample)",
  nameKo: "공통핵심기준 — 영어 (K–12 샘플)",
  description:
    "CCSS ELA coverage pack: Kindergarten–Grade 8 plus Grades 9–10 and 11–12 samples across RL/RI/RF/W/SL/L.",
  gradeSpan: "K-8,9-10,11-12",
});
save(elaPath, ela);
console.log(`✓ ela skills≈${countSkills(ela.tree)} ops=${elaOps}`);

// ───────────────── Phase 3: NGSS ─────────────────
const ngssPath = "ngss-science-grade-4.json";
const ngss = load(ngssPath);

const ngssBands: Array<[string, number, string, string, ReturnType<typeof domain>[]]> = [
  [
    "K",
    0,
    "Kindergarten",
    "유치원",
    [
      domain("K", "K-PS2", "Motion and Stability", "운동과 안정성", 1, [
        S("K-PS2-1", "Pushes and pulls", "밀고 당기기", "Plan and conduct an investigation to compare the effects of different strengths or directions of pushes and pulls.", "Students compare effects of push/pull strength or direction.", "Fair test + observation for 2 comparisons.", "Apply"),
        S("K-PS2-2", "Change speed or direction", "속력·방향 바꾸기", "Analyze data to determine if a design solution works as intended to change speed or direction.", "Students test a design that changes motion.", "Design tested with before/after observation.", "Analyze"),
      ]),
      domain("K", "K-LS1", "From Molecules to Organisms", "분자에서 생물까지", 2, [
        S("K-LS1-1", "What plants and animals need to survive", "식물·동물이 살아가는 데 필요한 것", "Use observations to describe patterns of what plants and animals need to survive.", "Students list needs of plants and animals from observations.", "≥3 accurate needs stated.", "Understand"),
      ]),
      domain("K", "K-ESS2", "Earth's Systems", "지구 시스템", 3, [
        S("K-ESS2-1", "Weather patterns", "날씨 패턴", "Use and share observations of local weather conditions to describe patterns over time.", "Students record weather and describe a pattern.", "≥5 days of data + 1 pattern.", "Analyze"),
        S("K-ESS3-1", "Needs and where organisms live", "필요와 서식지", "Use a model to represent the relationship between the needs of different plants/animals and the places they live.", "Students match organisms to habitats by needs.", "Correct matches for 3 of 4.", "Understand"),
      ]),
    ],
  ],
  [
    "1",
    1,
    "Grade 1",
    "1학년",
    [
      domain("1", "1-PS4", "Waves and Light", "파동과 빛", 1, [
        S("1-PS4-2", "Objects in darkness need light to be seen", "어두운 곳의 물체는 빛이 있어야 보임", "Make observations to construct an evidence-based account that objects can be seen only when illuminated.", "Students explain why objects need light to be seen.", "Evidence-based explanation with 1 demo.", "Understand"),
        S("1-PS4-4", "Devices that use light or sound", "빛·소리를 쓰는 장치", "Use tools and materials to design and build a device that uses light or sound to solve a problem of communicating over a distance.", "Students build a simple communication device.", "Working prototype + explanation.", "Apply"),
      ]),
      domain("1", "1-LS1", "From Molecules to Organisms", "분자에서 생물까지", 2, [
        S("1-LS1-1", "How plants and animals use external parts", "식물·동물의 겉모습 이용", "Use materials to design a solution to a human problem by mimicking how plants/animals use external parts.", "Students design a biomimicry solution.", "Design linked to organism part function.", "Apply"),
        S("1-LS1-2", "Parents and offspring behavior", "부모와 새끼의 행동", "Read texts and use media to determine patterns in behavior of parents and offspring that help offspring survive.", "Students describe a parent–offspring survival pattern.", "Pattern + survival link for 2 examples.", "Understand"),
      ]),
      domain("1", "1-ESS1", "Earth's Place in the Universe", "우주 속 지구의 위치", 3, [
        S("1-ESS1-1", "Patterns of sun, moon, and stars", "해·달·별의 패턴", "Use observations of the sun, moon, and stars to describe patterns that can be predicted.", "Students describe a predictable sky pattern.", "Pattern stated with observational support.", "Analyze"),
        S("1-ESS1-2", "Seasonal daylight patterns", "계절별 낮의 길이 패턴", "Make observations at different times of year to relate the amount of daylight to the time of year.", "Students compare daylight across seasons.", "Correct seasonal daylight comparison.", "Analyze"),
      ]),
    ],
  ],
  [
    "2",
    2,
    "Grade 2",
    "2학년",
    [
      domain("2", "2-PS1", "Matter and Its Interactions", "물질과 상호작용", 1, [
        S("2-PS1-1", "Describe and classify materials", "물질 관찰·분류하기", "Plan and conduct an investigation to describe and classify different kinds of materials by their observable properties.", "Students classify materials by properties.", "≥2 properties used for 6 materials.", "Analyze"),
        S("2-PS1-4", "Heating or cooling can change matter", "가열·냉각으로 물질 변화", "Construct an argument with evidence that some changes caused by heating or cooling can be reversed and some cannot.", "Students argue reversible vs irreversible changes.", "Evidence for 2 reversible + 1 irreversible.", "Evaluate"),
      ]),
      domain("2", "2-LS2", "Ecosystems", "생태계", 2, [
        S("2-LS2-1", "Plants need sunlight and water", "식물은 햇빛과 물이 필요함", "Plan and conduct an investigation to determine if plants need sunlight and water to grow.", "Students test plant needs with a controlled comparison.", "Fair test + conclusion.", "Apply"),
        S("2-LS4-1", "Diversity of life in habitats", "서식지의 생물 다양성", "Make observations of plants and animals to compare the diversity of life in different habitats.", "Students compare diversity across 2 habitats.", "Comparison with observational counts.", "Analyze"),
      ]),
      domain("2", "2-ESS1", "Earth's Place / Systems", "지구와 시스템", 3, [
        S("2-ESS1-1", "Earth events can occur quickly or slowly", "지구 사건은 빠르게 또는 느리게 일어남", "Use information from several sources to provide evidence that Earth events can occur quickly or slowly.", "Students sort events by timescale.", "Correct sort for 4 of 5 events.", "Understand"),
        S("2-ESS2-2", "Shapes and kinds of land and water", "땅과 물의 모양·종류", "Develop a model to represent the shapes and kinds of land and bodies of water in an area.", "Students build a land/water model of a local area.", "Model includes ≥3 land/water features.", "Apply"),
      ]),
    ],
  ],
  [
    "3",
    3,
    "Grade 3",
    "3학년",
    [
      domain("3", "3-PS2", "Motion and Stability", "운동과 안정성", 1, [
        S("3-PS2-1", "Effects of balanced and unbalanced forces", "균형·불균형 힘의 영향", "Plan and conduct an investigation to provide evidence of the effects of balanced and unbalanced forces.", "Students investigate balanced vs unbalanced forces.", "Evidence table + conclusion.", "Apply"),
        S("3-PS2-2", "Patterns of motion", "운동의 패턴", "Make observations and/or measurements of an object's motion to provide evidence that a pattern can be used to predict future motion.", "Students predict motion from a pattern.", "Prediction verified for 2 of 2 trials.", "Analyze"),
      ]),
      domain("3", "3-LS1", "From Molecules to Organisms", "분자에서 생물까지", 2, [
        S("3-LS1-1", "Life cycles of plants and animals", "식물·동물의 한살이", "Develop models to describe that organisms have unique and diverse life cycles but all have birth, growth, reproduction, and death.", "Students model two life cycles with shared stages.", "2 models + shared stages labeled.", "Understand"),
        S("3-LS3-1", "Inherited traits", "유전되는 형질", "Analyze and interpret data to provide evidence that plants and animals have traits inherited from parents.", "Students analyze trait data across generations.", "Evidence-based inheritance claim.", "Analyze"),
        S("3-LS4-2", "Adaptation", "적응", "Use evidence to construct an explanation for how the variations in characteristics among individuals may provide advantages in surviving.", "Students explain an adaptive advantage.", "Trait–advantage–survival link.", "Understand"),
      ]),
      domain("3", "3-ESS2", "Earth's Systems", "지구 시스템", 3, [
        S("3-ESS2-1", "Typical weather conditions", "전형적인 날씨 조건", "Represent data in tables and graphical displays to describe typical weather conditions expected during a particular season.", "Students graph seasonal weather data.", "Graph + seasonal description.", "Analyze"),
        S("3-ESS3-1", "Solutions that reduce weather hazards", "기상 재해 줄이는 해결책", "Make a claim about the merit of a design solution that reduces the impacts of a weather-related hazard.", "Students evaluate a hazard-reduction design.", "Claim + merit criteria.", "Evaluate"),
      ]),
    ],
  ],
  [
    "4",
    4,
    "Grade 4",
    "4학년",
    [
      domain("4", "4-PS3", "Energy", "에너지", 1, [
        S("4-PS3-1", "Speed relates to energy of an object", "속력과 물체의 에너지", "Use evidence to construct an explanation relating the speed of an object to the energy of that object.", "Students explain speed–energy relationship with evidence.", "Evidence-based explanation.", "Understand"),
        S("4-PS3-2", "Energy can be transferred", "에너지는 전달될 수 있음", "Make observations to provide evidence that energy can be transferred from place to place by sound, light, heat, and electric currents.", "Students document 2 energy transfer examples.", "Evidence for ≥2 transfer modes.", "Understand"),
        S("4-PS3-4", "Device that converts energy", "에너지를 변환하는 장치", "Apply scientific ideas to design, test, and refine a device that converts energy from one form to another.", "Students design and refine an energy-conversion device.", "Tested prototype + refinement note.", "Apply"),
      ]),
      domain("4", "4-PS4", "Waves", "파동", 2, [
        S("4-PS4-1", "Waves of amplitude and wavelength", "진폭과 파장의 파동", "Develop a model of waves to describe patterns in terms of amplitude and wavelength.", "Students model amplitude and wavelength.", "Model labels both features.", "Understand"),
        S("4-PS4-3", "Patterns transfer information", "패턴으로 정보 전달", "Generate and compare multiple solutions that use patterns to transfer information.", "Students compare 2 information-transfer solutions.", "Comparison with criteria.", "Evaluate"),
      ]),
      domain("4", "4-LS1", "From Molecules to Organisms", "분자에서 생물까지", 3, [
        S("4-LS1-1", "Internal and external structures", "내부·외부 구조", "Construct an argument that plants and animals have internal and external structures that function to support survival, growth, behavior, and reproduction.", "Students argue structure–function for an organism.", "≥2 structures with functions.", "Evaluate"),
        S("4-LS1-2", "Animals receive information through senses", "동물의 감각을 통한 정보 수용", "Use a model to describe that animals receive different types of information through their senses, process it, and respond.", "Students model sense → process → response.", "Complete model with example.", "Understand"),
      ]),
      domain("4", "4-ESS1", "Earth's Place in the Universe", "우주 속 지구의 위치", 4, [
        S("4-ESS1-1", "Rock formations and fossils", "암석층과 화석", "Identify evidence from patterns in rock formations and fossils in rock layers to support an explanation for changes in a landscape over time.", "Students use fossil/rock patterns as evidence of change.", "Evidence-based landscape change claim.", "Analyze"),
        S("4-ESS2-1", "Weathering or erosion", "풍화 또는 침식", "Make observations and/or measurements to provide evidence of the effects of weathering or the rate of erosion.", "Students collect weathering/erosion evidence.", "Observation/measurement table + claim.", "Analyze"),
        S("4-ESS3-1", "Energy and fuels from natural resources", "천연자원에서 얻는 에너지·연료", "Obtain and combine information to describe that energy and fuels are derived from natural resources and their uses affect the environment.", "Students describe a fuel source and environmental effect.", "Source + use + impact stated.", "Understand"),
      ]),
    ],
  ],
  [
    "5",
    5,
    "Grade 5",
    "5학년",
    [
      domain("5", "5-PS1", "Matter and Its Interactions", "물질과 상호작용", 1, [
        S("5-PS1-1", "Matter is made of particles", "물질은 입자로 이루어짐", "Develop a model to describe that matter is made of particles too small to be seen.", "Students model particle nature of matter.", "Model explains a macroscopic observation.", "Understand"),
        S("5-PS1-2", "Conservation of weight", "무게 보존", "Measure and graph quantities to provide evidence that regardless of the type of change that occurs when heating, cooling, or mixing substances, the total weight of matter is conserved.", "Students graph weight before/after a change.", "Graph supports conservation claim.", "Analyze"),
        S("5-PS1-3", "Properties for identification", "식별을 위한 성질", "Make observations and measurements to identify materials based on their properties.", "Students identify unknown materials by properties.", "Correct ID for 3 of 4.", "Apply"),
      ]),
      domain("5", "5-PS2", "Motion and Stability", "운동과 안정성", 2, [
        S("5-PS2-1", "Gravitational force", "중력", "Support an argument that the gravitational force exerted by Earth on objects is directed down.", "Students argue direction of gravity with evidence.", "Evidence-based down-direction claim.", "Evaluate"),
      ]),
      domain("5", "5-LS1", "From Molecules to Organisms", "분자에서 생물까지", 3, [
        S("5-LS1-1", "Plants get materials for growth", "식물의 성장 재료", "Support an argument that plants get the materials they need for growth chiefly from air and water.", "Students argue plant growth materials with evidence.", "Air/water claim with evidence.", "Evaluate"),
        S("5-LS2-1", "Movement of matter among organisms", "생물 간 물질 이동", "Develop a model to describe the movement of matter among plants, animals, decomposers, and the environment.", "Students model matter cycling in an ecosystem.", "Model includes producers/consumers/decomposers.", "Understand"),
      ]),
      domain("5", "5-ESS1", "Earth's Place in the Universe", "우주 속 지구의 위치", 4, [
        S("5-ESS1-1", "Brightness of sun vs distance", "태양의 밝기와 거리", "Support an argument that differences in the apparent brightness of the sun compared to other stars is due to their relative distances.", "Students argue brightness–distance relationship.", "Evidence-based argument.", "Evaluate"),
        S("5-ESS1-2", "Daily patterns of shadows / day / night", "그림자·낮·밤의 일일 패턴", "Represent data in graphical displays to reveal patterns of daily changes in length and direction of shadows, day and night, and seasonal appearance of stars.", "Students graph shadow or day/night patterns.", "Graph + pattern statement.", "Analyze"),
        S("5-ESS2-1", "Earth systems interact", "지구 시스템 상호작용", "Develop a model using an example to describe ways the geosphere, biosphere, hydrosphere, and/or atmosphere interact.", "Students model an Earth-system interaction.", "≥2 systems shown interacting.", "Understand"),
        S("5-ESS3-1", "Protect Earth's resources", "지구 자원 보호", "Obtain and combine information about ways individual communities use science ideas to protect Earth's resources and environment.", "Students describe a community protection practice.", "Practice + science idea link.", "Understand"),
      ]),
    ],
  ],
  [
    "6",
    6,
    "Grade 6",
    "6학년",
    [
      domain("6", "MS-PS1", "Matter and Its Interactions", "물질과 상호작용", 1, [
        S("MS-PS1-1", "Atomic composition of molecules", "분자의 원자 구성", "Develop models to describe the atomic composition of simple molecules and extended structures.", "Students model simple molecules.", "Correct particle model for 2 substances.", "Understand"),
        S("MS-PS1-2", "Properties before and after change", "변화 전후 성질", "Analyze and interpret data on the properties of substances before and after the substances interact to determine if a chemical reaction has occurred.", "Students decide chemical vs physical change from data.", "Correct decision for 3 of 4.", "Analyze"),
        S("MS-PS1-4", "Particle motion and states of matter", "입자 운동과 상태", "Develop a model that predicts and describes changes in particle motion, temperature, and state of a pure substance when thermal energy is added or removed.", "Students model state change with particle motion.", "Model links T, motion, and state.", "Understand"),
      ]),
      domain("6", "MS-PS2", "Motion and Stability", "운동과 안정성", 2, [
        S("MS-PS2-1", "Newton's third law", "뉴턴 제3법칙", "Apply Newton's third law to design a solution to a problem involving the motion of two colliding objects.", "Students apply action–reaction in a design.", "Design cites third-law pairs.", "Apply"),
        S("MS-PS2-2", "Change in motion depends on force and mass", "운동 변화는 힘과 질량에 의존", "Plan an investigation to provide evidence that the change in an object's motion depends on the sum of the forces and the mass of the object.", "Students plan a force/mass investigation.", "Fair test plan with variables.", "Apply"),
      ]),
      domain("6", "MS-LS1", "From Molecules to Organisms", "분자에서 생물까지", 3, [
        S("MS-LS1-1", "Living things made of cells", "생물은 세포로 이루어짐", "Conduct an investigation to provide evidence that living things are made of cells; either one cell or many different numbers and types of cells.", "Students use microscopes/models as evidence for cells.", "Evidence statement from investigation.", "Apply"),
        S("MS-LS1-2", "Function of cell parts", "세포 소기관의 기능", "Develop and use a model to describe the function of a cell as a whole and ways parts of cells contribute to the function.", "Students model cell part functions.", "≥3 organelles with functions.", "Understand"),
        S("MS-LS1-5", "Environmental and genetic factors", "환경·유전 요인", "Construct a scientific explanation based on evidence for how environmental and genetic factors influence the growth of organisms.", "Students explain growth with both factor types.", "Evidence for environment + genetics.", "Understand"),
      ]),
      domain("6", "MS-ESS2", "Earth's Systems", "지구 시스템", 4, [
        S("MS-ESS2-1", "Cycling of Earth's materials", "지구 물질의 순환", "Develop a model to describe the cycling of Earth's materials and the flow of energy that drives the process.", "Students model rock/material cycling.", "Cycle model with energy driver.", "Understand"),
        S("MS-ESS2-4", "Water cycle", "물의 순환", "Develop a model to describe the cycling of water through Earth's systems driven by energy from the sun and the force of gravity.", "Students model the water cycle.", "Sun + gravity roles labeled.", "Understand"),
      ]),
    ],
  ],
  [
    "7",
    7,
    "Grade 7",
    "7학년",
    [
      domain("7", "MS-PS3", "Energy", "에너지", 1, [
        S("MS-PS3-1", "Kinetic energy depends on mass and speed", "운동 에너지는 질량·속력에 의존", "Construct and interpret graphical displays of data to describe the relationships of kinetic energy to mass and speed.", "Students interpret KE vs mass/speed graphs.", "Correct relationship statements.", "Analyze"),
        S("MS-PS3-3", "Minimize or maximize thermal energy transfer", "열에너지 전달 최소화·최대화", "Apply scientific principles to design, construct, and test a device that either minimizes or maximizes thermal energy transfer.", "Students build and test an insulation/transfer device.", "Test data + design claim.", "Apply"),
        S("MS-PS3-5", "Energy transfer results in temperature change", "에너지 전달과 온도 변화", "Construct, use, and present arguments to support the claim that when the kinetic energy of an object changes, energy is transferred to or from the object.", "Students argue energy transfer from KE change.", "Evidence-based argument.", "Evaluate"),
      ]),
      domain("7", "MS-PS4", "Waves", "파동", 2, [
        S("MS-PS4-1", "Model of waves", "파동 모형", "Use mathematical representations to describe a simple model for waves that includes how the amplitude of a wave is related to the energy in a wave.", "Students relate amplitude to energy mathematically.", "Correct amplitude–energy representation.", "Apply"),
        S("MS-PS4-2", "Waves are reflected, absorbed, or transmitted", "파동의 반사·흡수·투과", "Develop and use a model to describe that waves are reflected, absorbed, or transmitted through various materials.", "Students model wave behavior with materials.", "Model shows ≥2 behaviors.", "Understand"),
      ]),
      domain("7", "MS-LS2", "Ecosystems", "생태계", 3, [
        S("MS-LS2-1", "Effects of resource availability", "자원 가용성의 영향", "Analyze and interpret data to provide evidence for the effects of resource availability on organisms and populations.", "Students interpret population–resource data.", "Evidence-based effect claim.", "Analyze"),
        S("MS-LS2-2", "Interactions among organisms", "생물 간 상호작용", "Construct an explanation that predicts patterns of interactions among organisms across multiple ecosystems.", "Students predict interaction patterns.", "Prediction with ecological reasoning.", "Understand"),
        S("MS-LS2-3", "Cycling of matter and energy flow", "물질 순환과 에너지 흐름", "Develop a model to describe the cycling of matter and flow of energy among living and nonliving parts of an ecosystem.", "Students model matter/energy flow.", "Complete cycle/flow model.", "Understand"),
      ]),
      domain("7", "MS-ESS1", "Earth's Place in the Universe", "우주 속 지구의 위치", 4, [
        S("MS-ESS1-1", "Earth-sun-moon system", "지구·태양·달 시스템", "Develop and use a model of the Earth-sun-moon system to describe the cyclic patterns of lunar phases, eclipses of the sun and moon, and seasons.", "Students model phases/seasons/eclipses.", "Model explains 1 cyclic pattern.", "Understand"),
        S("MS-ESS1-2", "Role of gravity in solar system", "태양계에서 중력의 역할", "Develop and use a model to describe the role of gravity in the motions within galaxies and the solar system.", "Students model gravity-driven orbits.", "Gravity role stated in model.", "Understand"),
      ]),
    ],
  ],
  [
    "8",
    8,
    "Grade 8",
    "8학년",
    [
      domain("8", "MS-PS1-chem", "Chemical Reactions", "화학 반응", 1, [
        S("MS-PS1-5", "Conservation of atoms in reactions", "반응에서 원자 보존", "Develop and use a model to describe how the total number of atoms does not change in a chemical reaction and thus mass is conserved.", "Students model atom conservation in a reaction.", "Balanced particle model.", "Understand"),
        S("MS-PS1-6", "Device using thermal energy release", "열에너지 방출을 쓰는 장치", "Undertake a design project to construct, test, and modify a device that either releases or absorbs thermal energy by chemical processes.", "Students build a chemical thermal device.", "Tested device + modification.", "Apply"),
      ]),
      domain("8", "MS-LS3", "Heredity", "유전", 2, [
        S("MS-LS3-1", "Genes influence traits", "유전자가 형질에 영향", "Develop and use a model to describe why structural changes to genes (mutations) located on chromosomes may affect proteins and may result in harmful, beneficial, or neutral effects to the structure and function of the organism.", "Students model gene → protein → trait.", "Model includes mutation effect types.", "Understand"),
        S("MS-LS3-2", "Structural changes to genes", "유전자의 구조적 변화", "Develop and use a model to describe why asexual reproduction results in offspring with identical genetic information and sexual reproduction results in offspring with genetic variation.", "Students contrast asexual vs sexual genetic outcomes.", "Correct contrast with model.", "Understand"),
        S("MS-LS4-1", "Anatomical similarities", "해부학적 유사성", "Analyze and interpret data for patterns in the fossil record that document the existence, diversity, extinction, and change of life forms.", "Students interpret fossil-record patterns.", "Pattern claim with data.", "Analyze"),
        S("MS-LS4-2", "Fossil record", "화석 기록", "Apply scientific ideas to construct an explanation for the anatomical similarities and differences among modern organisms and between modern and fossil organisms.", "Students explain anatomical relationships.", "Evidence-based evolutionary explanation.", "Understand"),
      ]),
      domain("8", "MS-ESS3", "Earth and Human Activity", "지구와 인간 활동", 3, [
        S("MS-ESS3-1", "Uneven distribution of resources", "자원의 불균등 분포", "Construct a scientific explanation based on evidence for how the uneven distributions of Earth's mineral, energy, and groundwater resources are the result of past and current geoscience processes.", "Students explain uneven resource distribution.", "Process–distribution link with evidence.", "Understand"),
        S("MS-ESS3-2", "Natural hazards", "자연재해", "Analyze and interpret data on natural hazards to forecast future catastrophic events and inform the development of technologies to mitigate their effects.", "Students use hazard data to inform mitigation.", "Forecast + mitigation idea.", "Analyze"),
        S("MS-ESS3-3", "Human impact on environment", "환경에 대한 인간 영향", "Apply scientific principles to design a method for monitoring and minimizing a human impact on the environment.", "Students design a monitoring/minimizing method.", "Method with science principle.", "Apply"),
        S("MS-ESS3-4", "Rise in global temperatures", "지구 기온 상승", "Construct an argument supported by evidence for how increases in human population and per-capita consumption of natural resources impact Earth's systems.", "Students argue human-impact pathways.", "Evidence-based systems impact argument.", "Evaluate"),
      ]),
      domain("8", "MS-ETS1", "Engineering Design", "공학 설계", 4, [
        S("MS-ETS1-1", "Define design problem", "설계 문제 정의하기", "Define the criteria and constraints of a design problem with sufficient precision to ensure a successful solution.", "Students write precise criteria/constraints.", "Measurable criteria + constraints.", "Understand"),
        S("MS-ETS1-2", "Evaluate competing design solutions", "경쟁 설계안 평가하기", "Evaluate competing design solutions using a systematic process to determine how well they meet the criteria and constraints.", "Students compare 2 designs systematically.", "Evaluation matrix completed.", "Evaluate"),
      ]),
    ],
  ],
  [
    "HS",
    90,
    "High School",
    "고등",
    [
      domain("HS", "HS-PS1", "Matter and Its Interactions", "물질과 상호작용", 1, [
        S("HS-PS1-1", "Periodic table predicts properties", "주기율표로 성질 예측", "Use the periodic table as a model to predict the relative properties of elements based on the patterns of electrons in the outermost energy level.", "Students predict properties from periodic trends.", "Correct predictions for 3 of 4 elements.", "Apply"),
        S("HS-PS1-2", "Construct explanation for chemical reactions", "화학 반응 설명 구성하기", "Construct and revise an explanation for the outcome of a simple chemical reaction based on the outermost electron states of atoms.", "Students explain a reaction using valence electrons.", "Revised explanation with electron reasoning.", "Understand"),
        S("HS-PS1-7", "Conservation of atoms in reactions", "반응에서 원자 보존", "Use mathematical representations to support the claim that atoms, and therefore mass, are conserved during a chemical reaction.", "Students balance and justify mass conservation.", "Balanced equation + conservation claim.", "Apply"),
      ]),
      domain("HS", "HS-PS2", "Motion and Stability", "운동과 안정성", 2, [
        S("HS-PS2-1", "Analyze data to support Newton's second law", "뉴턴 제2법칙을 뒷받침하는 자료 분석", "Analyze data to support the claim that Newton's second law of motion describes the mathematical relationship among net force, mass, and acceleration.", "Students analyze F=ma data.", "Data supports second-law claim.", "Analyze"),
        S("HS-PS2-4", "Predict gravitational and electrostatic forces", "중력·정전기력 예측하기", "Use mathematical representations of Newton's law of gravitation and Coulomb's law to describe and predict gravitational and electrostatic forces.", "Students compute/compare force magnitudes.", "Correct prediction for 2 of 3.", "Apply"),
      ]),
      domain("HS", "HS-LS1", "From Molecules to Organisms", "분자에서 생물까지", 3, [
        S("HS-LS1-1", "DNA and specialized cells", "DNA와 분화된 세포", "Construct an explanation based on evidence for how the structure of DNA determines the structure of proteins which carry out the essential functions of life through systems of specialized cells.", "Students explain DNA → protein → cell function.", "Evidence-based multi-step explanation.", "Understand"),
        S("HS-LS1-2", "Hierarchical organization of interacting systems", "상호작용 시스템의 계층 구조", "Develop and use a model to illustrate the hierarchical organization of interacting systems that provide specific functions within multicellular organisms.", "Students model organ-system hierarchy.", "≥3 levels with interactions.", "Understand"),
        S("HS-LS1-5", "Photosynthesis transforms light energy", "광합성의 빛 에너지 변환", "Use a model to illustrate how photosynthesis transforms light energy into stored chemical energy.", "Students model energy transformation in photosynthesis.", "Inputs/outputs + energy form change.", "Understand"),
      ]),
      domain("HS", "HS-LS2", "Ecosystems", "생태계", 4, [
        S("HS-LS2-1", "Factors affecting carrying capacity", "환경 용량에 영향을 주는 요인", "Use mathematical and/or computational representations to support explanations of factors that affect carrying capacity of ecosystems at different scales.", "Students analyze carrying-capacity factors.", "Representation + explanation.", "Analyze"),
        S("HS-LS2-3", "Cycling of matter and energy flow", "물질 순환과 에너지 흐름", "Construct and revise an explanation based on evidence for the cycling of matter and flow of energy in aerobic and anaerobic conditions.", "Students explain matter/energy cycling.", "Revised explanation with evidence.", "Understand"),
      ]),
      domain("HS", "HS-ESS1", "Earth's Place in the Universe", "우주 속 지구의 위치", 5, [
        S("HS-ESS1-1", "Life span of the sun and nuclear fusion", "태양의 수명과 핵융합", "Develop a model based on evidence to illustrate the life span of the sun and the role of nuclear fusion in the sun's core.", "Students model solar fusion and life span.", "Evidence-based sun model.", "Understand"),
        S("HS-ESS1-2", "Big Bang theory and evidence", "빅뱅 이론과 증거", "Construct an explanation of the Big Bang theory based on astronomical evidence of light spectra, motion of distant galaxies, and composition of matter in the universe.", "Students explain Big Bang with ≥2 evidence types.", "Multi-evidence explanation.", "Understand"),
      ]),
      domain("HS", "HS-ESS2", "Earth's Systems", "지구 시스템", 6, [
        S("HS-ESS2-2", "Feedbacks that cause Earth system changes", "지구 시스템 변화를 일으키는 피드백", "Analyze geoscience data to make the claim that one change to Earth's surface can create feedbacks that cause changes to other Earth systems.", "Students analyze a feedback example from data.", "Feedback claim with data.", "Analyze"),
        S("HS-ESS3-1", "Availability of natural resources", "천연자원의 가용성", "Construct an explanation based on evidence for how the availability of natural resources, occurrence of natural hazards, and changes in climate have influenced human activity.", "Students explain human–resource–hazard–climate links.", "Evidence-based multi-factor explanation.", "Understand"),
      ]),
      domain("HS", "HS-ETS1", "Engineering Design", "공학 설계", 7, [
        S("HS-ETS1-1", "Analyze a major global challenge", "주요 지구적 과제 분석하기", "Analyze a major global challenge to specify qualitative and quantitative criteria and constraints for solutions.", "Students define criteria/constraints for a global challenge.", "Measurable criteria set.", "Analyze"),
        S("HS-ETS1-2", "Design a solution to a complex problem", "복잡한 문제에 대한 해결책 설계하기", "Design a solution to a complex real-world problem by breaking it down into smaller, more manageable problems.", "Students decompose and propose a solution path.", "Decomposition + solution sketch.", "Apply"),
      ]),
    ],
  ],
];

const ngssOps = applyBands("ngss", ngss, ngssBands, {
  name: "Next Generation Science Standards — Science (K–HS sample)",
  nameKo: "차세대 과학 표준 — 과학 (K–고등 샘플)",
  description:
    "NGSS coverage pack: Kindergarten–Grade 8 plus High School physical, life, Earth, and engineering samples.",
  gradeSpan: "K-8,HS",
});
save(ngssPath, ngss);
console.log(`✓ ngss skills≈${countSkills(ngss.tree)} ops=${ngssOps}`);

// ───────────────── Phase 4: KR Korean ─────────────────
const koPath = "kr2022-korean-grade-4.json";
const ko = load(koPath);

const koBands: Array<[string, number, string, string, ReturnType<typeof domain>[]]> = [
  [
    "1",
    1,
    "1학년",
    "1학년",
    [
      domain("1", "1국01", "듣기·말하기", "듣기·말하기", 1, [
        S("1국01-01", "바른 자세로 듣고 말하기", "바른 자세로 듣고 말하기", "바른 자세로 듣고 말하며 의사소통한다.", "학생이 바른 자세로 듣고 간단히 말한다.", "3회 중 2회 이상 바른 자세 유지.", "Apply"),
        S("1국01-02", "인사와 소개하기", "인사와 소개하기", "상황에 맞게 인사하고 자신을 소개한다.", "학생이 인사말과 자기소개를 한다.", "인사+소개 완성.", "Apply"),
        S("1국01-03", "경험과 생각 나누기", "경험과 생각 나누기", "자신의 경험과 생각을 친구와 나눈다.", "학생이 짧은 경험을 말해 나눈다.", "경험 1가지+반응 1회.", "Apply"),
      ]),
      domain("1", "1국02", "읽기", "읽기", 2, [
        S("1국02-01", "글자와 낱말 읽기", "글자와 낱말 읽기", "글자와 낱말을 바르게 읽는다.", "학생이 학습한 글자·낱말을 읽는다.", "제시 낱말 80% 이상 정확.", "Apply"),
        S("1국02-02", "짧은 글 내용 이해하기", "짧은 글 내용 이해하기", "짧은 글의 내용을 이해한다.", "학생이 짧은 글의 중심 내용을 말한다.", "중심 내용 정확히 진술.", "Understand"),
        S("1국02-03", "그림책·동화 즐겨 읽기", "그림책·동화 즐겨 읽기", "그림책과 동화를 즐겨 읽는다.", "학생이 그림책/동화 1권을 읽고 느낌을 말한다.", "읽기+간단 감상.", "Understand"),
      ]),
      domain("1", "1국03", "쓰기", "쓰기", 3, [
        S("1국03-01", "글자와 문장 쓰기", "글자와 문장 쓰기", "글자와 간단한 문장을 바르게 쓴다.", "학생이 글자와 짧은 문장을 쓴다.", "문장 2개 이상 바르게 작성.", "Apply"),
        S("1국03-02", "자신의 생각과 경험 쓰기", "자신의 생각과 경험 쓰기", "자신의 생각과 경험을 글로 표현한다.", "학생이 경험/생각을 2~3문장으로 쓴다.", "주제 일치 문장 2개 이상.", "Apply"),
      ]),
      domain("1", "1국04", "문법", "문법", 4, [
        S("1국04-01", "소리와 글자의 관계 알기", "소리와 글자의 관계 알기", "소리와 글자의 대응 관계를 안다.", "학생이 소리에 맞는 글자를 고른다.", "5문항 중 4문항 정답.", "Understand"),
        S("1국04-02", "기본 문장 성분 알기", "기본 문장 성분 알기", "문장의 기본 성분(누가·무엇을)을 안다.", "학생이 주어·서술어를 찾는다.", "3문장 중 2문장 이상 정확.", "Understand"),
      ]),
      domain("1", "1국05", "문학", "문학", 5, [
        S("1국05-01", "동시·동화의 재미 느끼기", "동시·동화의 재미 느끼기", "동시와 동화의 재미를 느낀다.", "학생이 작품의 재미있는 부분을 말한다.", "재미 요소 1가지 이상 진술.", "Understand"),
        S("1국05-02", "작품 속 인물과 사건 이해하기", "작품 속 인물과 사건 이해하기", "작품 속 인물과 사건을 이해한다.", "학생이 인물과 주요 사건을 말한다.", "인물+사건 정확히 진술.", "Understand"),
      ]),
    ],
  ],
  [
    "2",
    2,
    "2학년",
    "2학년",
    [
      domain("2", "2국01", "듣기·말하기", "듣기·말하기", 1, [
        S("2국01-01", "목적에 맞게 듣고 말하기", "목적에 맞게 듣고 말하기", "목적에 맞게 내용을 듣고 말한다.", "학생이 목적에 맞는 말하기를 한다.", "목적 부합 발화 1회.", "Apply"),
        S("2국01-02", "차례를 지키며 대화하기", "차례를 지키며 대화하기", "차례를 지키며 대화에 참여한다.", "학생이 대화 규칙을 지키며 말한다.", "차례 지키기+관련 발화.", "Apply"),
        S("2국01-03", "겪은 일과 생각 발표하기", "겪은 일과 생각 발표하기", "겪은 일과 생각을 발표한다.", "학생이 짧은 발표를 한다.", "겪은 일+생각 포함.", "Apply"),
      ]),
      domain("2", "2국02", "읽기", "읽기", 2, [
        S("2국02-01", "글의 중심 내용 파악하기", "글의 중심 내용 파악하기", "글의 중심 내용을 파악한다.", "학생이 중심 내용을 한 문장으로 말한다.", "중심 내용 정확.", "Understand"),
        S("2국02-02", "세부 내용 확인하기", "세부 내용 확인하기", "글의 세부 내용을 확인한다.", "학생이 세부 질문에 답한다.", "4문항 중 3문항 정답.", "Understand"),
        S("2국02-03", "다양한 글 즐겨 읽기", "다양한 글 즐겨 읽기", "다양한 갈래의 글을 즐겨 읽는다.", "학생이 서로 다른 갈래 글을 읽는다.", "갈래 2종 이상 읽기 기록.", "Apply"),
      ]),
      domain("2", "2국03", "쓰기", "쓰기", 3, [
        S("2국03-01", "문장과 짧은 글 쓰기", "문장과 짧은 글 쓰기", "문장과 짧은 글을 바르게 쓴다.", "학생이 짧은 단락을 쓴다.", "문장 4개 이상 응집.", "Apply"),
        S("2국03-02", "생각과 경험을 글로 표현하기", "생각과 경험을 글로 표현하기", "자신의 생각과 경험을 글로 표현한다.", "학생이 경험 중심 글을 쓴다.", "경험+느낌 포함.", "Apply"),
      ]),
      domain("2", "2국04", "문법", "문법", 4, [
        S("2국04-01", "낱말의 뜻 알기", "낱말의 뜻 알기", "문맥 속에서 낱말의 뜻을 안다.", "학생이 문맥으로 낱말 뜻을 말한다.", "4개 중 3개 정확.", "Understand"),
        S("2국04-02", "문장 부호와 띄어쓰기", "문장 부호와 띄어쓰기", "기본 문장 부호와 띄어쓰기를 안다.", "학생이 문장 부호·띄어쓰기를 바르게 쓴다.", "오류 2개 이하.", "Apply"),
      ]),
      domain("2", "2국05", "문학", "문학", 5, [
        S("2국05-01", "작품의 재미와 감동 느끼기", "작품의 재미와 감동 느끼기", "문학 작품의 재미와 감동을 느낀다.", "학생이 느낀 점을 구체적으로 말한다.", "근거 있는 감상 1가지.", "Understand"),
        S("2국05-02", "인물의 마음 짐작하기", "인물의 마음 짐작하기", "작품 속 인물의 마음을 짐작한다.", "학생이 인물의 마음을 근거와 함께 말한다.", "마음+근거 제시.", "Analyze"),
      ]),
    ],
  ],
  [
    "3",
    3,
    "3학년",
    "3학년",
    [
      domain("3", "3국01", "듣기·말하기", "듣기·말하기", 1, [
        S("3국01-01", "목적에 맞게 듣고 말하기", "목적에 맞게 듣고 말하기", "목적과 상황에 맞게 듣고 말한다.", "학생이 목적에 맞는 듣기·말하기를 수행한다.", "목적 부합 수행 1회.", "Apply"),
        S("3국01-02", "토론·토의에 참여하기", "토론·토의에 참여하기", "간단한 토의에 참여한다.", "학생이 의견을 말하고 다른 의견을 듣는다.", "의견+경청 태도.", "Apply"),
        S("3국01-03", "매체 자료를 활용해 발표하기", "매체 자료를 활용해 발표하기", "그림·표 등 매체를 활용해 발표한다.", "학생이 매체 1종을 활용해 발표한다.", "매체+내용 일치.", "Apply"),
      ]),
      domain("3", "3국02", "읽기", "읽기", 2, [
        S("3국02-01", "글의 중심 생각 파악하기", "글의 중심 생각 파악하기", "글의 중심 생각을 파악한다.", "학생이 중심 생각을 진술한다.", "중심 생각 정확.", "Understand"),
        S("3국02-02", "사실과 의견 구별하기", "사실과 의견 구별하기", "글에서 사실과 의견을 구별한다.", "학생이 사실/의견을 분류한다.", "5문장 중 4문장 정확.", "Analyze"),
        S("3국02-03", "다양한 갈래의 글 읽기", "다양한 갈래의 글 읽기", "다양한 갈래의 글을 읽는다.", "학생이 서로 다른 갈래 글을 비교한다.", "갈래 특징 1가지 이상.", "Understand"),
      ]),
      domain("3", "3국03", "쓰기", "쓰기", 3, [
        S("3국03-01", "목적과 독자를 고려해 쓰기", "목적과 독자를 고려해 쓰기", "목적과 독자를 생각하며 쓴다.", "학생이 목적/독자에 맞는 글을 쓴다.", "목적·독자 반영.", "Apply"),
        S("3국03-02", "자료를 모아 보고 쓰기", "자료를 모아 보고 쓰기", "간단한 자료를 모아 보고 쓴다.", "학생이 자료 2개 이상을 활용한다.", "자료 근거 문장 포함.", "Apply"),
        S("3국03-03", "고쳐 쓰기로 글 다듬기", "고쳐 쓰기로 글 다듬기", "글을 읽고 고쳐 쓴다.", "학생이 초고를 수정한다.", "수정 전후 비교 가능.", "Apply"),
      ]),
      domain("3", "3국04", "문법", "문법", 4, [
        S("3국04-01", "단어의 의미와 관계 이해하기", "단어의 의미와 관계 이해하기", "단어의 의미와 관계를 이해한다.", "학생이 유의어·반의어를 찾는다.", "3쌍 중 2쌍 이상 정확.", "Understand"),
        S("3국04-02", "문장 구조와 높임 표현 알기", "문장 구조와 높임 표현 알기", "기본 문장 구조와 높임 표현을 안다.", "학생이 높임 표현을 바르게 고친다.", "4문항 중 3문항 정답.", "Apply"),
      ]),
      domain("3", "3국05", "문학", "문학", 5, [
        S("3국05-01", "작품의 갈래와 특성 이해하기", "작품의 갈래와 특성 이해하기", "문학 갈래의 특성을 이해한다.", "학생이 갈래 특성을 말한다.", "특성 2가지 이상.", "Understand"),
        S("3국05-02", "인물의 마음과 갈등 파악하기", "인물의 마음과 갈등 파악하기", "인물의 마음과 갈등을 파악한다.", "학생이 갈등 상황을 설명한다.", "마음+갈등 근거 제시.", "Analyze"),
        S("3국05-03", "작품에 대한 생각 표현하기", "작품에 대한 생각 표현하기", "작품에 대한 자신의 생각을 표현한다.", "학생이 감상을 글로/말로 표현한다.", "근거 있는 감상.", "Apply"),
      ]),
    ],
  ],
  [
    "4",
    4,
    "4학년",
    "4학년",
    [
      domain("4", "4국01", "듣기·말하기", "듣기·말하기", 1, [
        S("4국01-01", "목적에 맞게 듣고 말하기", "목적에 맞게 듣고 말하기", "목적과 상황에 맞게 효과적으로 듣고 말한다.", "학생이 목적에 맞는 발표/대화를 한다.", "목적 부합+명확성.", "Apply"),
        S("4국01-02", "토론·토의에 참여하기", "토론·토의에 참여하기", "규칙을 지키며 토의·토론에 참여한다.", "학생이 근거를 들어 의견을 말한다.", "의견+근거 1개 이상.", "Apply"),
        S("4국01-03", "매체 자료를 활용해 발표하기", "매체 자료를 활용해 발표하기", "매체 자료를 활용해 내용을 전달한다.", "학생이 매체와 함께 발표한다.", "매체 활용 발표 완성.", "Apply"),
      ]),
      domain("4", "4국02", "읽기", "읽기", 2, [
        S("4국02-01", "글의 중심 생각 파악하기", "글의 중심 생각 파악하기", "글의 중심 생각과 세부 내용을 파악한다.", "학생이 중심 생각과 뒷받침 내용을 구분한다.", "중심+세부 구분 정확.", "Understand"),
        S("4국02-02", "사실과 의견 구별하기", "사실과 의견 구별하기", "사실과 의견을 구별하고 근거를 찾는다.", "학생이 의견의 근거를 점검한다.", "사실/의견+근거 점검.", "Analyze"),
        S("4국02-03", "다양한 갈래의 글 읽기", "다양한 갈래의 글 읽기", "다양한 갈래의 글을 목적에 맞게 읽는다.", "학생이 목적에 맞는 읽기 전략을 쓴다.", "전략 1가지+적용.", "Apply"),
      ]),
      domain("4", "4국03", "쓰기", "쓰기", 3, [
        S("4국03-01", "목적과 독자를 고려해 쓰기", "목적과 독자를 고려해 쓰기", "목적과 독자를 고려해 글을 쓴다.", "학생이 독자 맞춤 글을 쓴다.", "목적·독자 반영 명확.", "Apply"),
        S("4국03-02", "자료를 모아 보고 쓰기", "자료를 모아 보고 쓰기", "여러 자료를 모아 정리해 쓴다.", "학생이 자료 요약 후 글을 쓴다.", "자료 3개 이상 반영.", "Apply"),
        S("4국03-03", "고쳐 쓰기로 글 다듬기", "고쳐 쓰기로 글 다듬기", "내용과 표현을 다듬어 고쳐 쓴다.", "학생이 내용·표현을 수정한다.", "수정 포인트 2개 이상.", "Apply"),
      ]),
      domain("4", "4국04", "문법", "문법", 4, [
        S("4국04-01", "단어의 의미와 관계 이해하기", "단어의 의미와 관계 이해하기", "단어의 의미 관계를 이해한다.", "학생이 단어 관계를 설명한다.", "관계 설명 정확.", "Understand"),
        S("4국04-02", "문장 구조와 높임 표현 알기", "문장 구조와 높임 표현 알기", "문장 성분과 높임 표현을 바르게 쓴다.", "학생이 높임 표현을 상황에 맞게 쓴다.", "상황 적합 높임 사용.", "Apply"),
      ]),
      domain("4", "4국05", "문학", "문학", 5, [
        S("4국05-01", "작품의 갈래와 특성 이해하기", "작품의 갈래와 특성 이해하기", "문학 갈래의 특성과 표현을 이해한다.", "학생이 갈래 특성을 사례로 말한다.", "특성+사례.", "Understand"),
        S("4국05-02", "인물의 마음과 갈등 파악하기", "인물의 마음과 갈등 파악하기", "인물의 마음 변화와 갈등을 파악한다.", "학생이 마음 변화를 설명한다.", "변화+근거.", "Analyze"),
        S("4국05-03", "작품에 대한 생각 표현하기", "작품에 대한 생각 표현하기", "작품에 대한 생각과 느낌을 표현한다.", "학생이 감상을 조직적으로 표현한다.", "조직된 감상문/발표.", "Apply"),
      ]),
    ],
  ],
  [
    "5",
    5,
    "5학년",
    "5학년",
    [
      domain("5", "5국01", "듣기·말하기", "듣기·말하기", 1, [
        S("5국01-01", "목적에 맞게 듣고 말하기", "목적에 맞게 듣고 말하기", "목적과 맥락에 맞게 듣고 말한다.", "학생이 맥락에 맞는 의사소통을 한다.", "맥락 적합 발화.", "Apply"),
        S("5국01-02", "토론·토의에 참여하기", "토론·토의에 참여하기", "근거를 들어 토론·토의에 참여한다.", "학생이 반박/보완 의견을 말한다.", "근거 있는 반박 또는 보완.", "Apply"),
        S("5국01-03", "매체 자료를 활용해 발표하기", "매체 자료를 활용해 발표하기", "여러 매체를 활용해 효과적으로 발표한다.", "학생이 매체를 조직해 발표한다.", "매체 구성+전달 명확.", "Apply"),
      ]),
      domain("5", "5국02", "읽기", "읽기", 2, [
        S("5국02-01", "글의 중심 생각 파악하기", "글의 중심 생각 파악하기", "글의 구조와 중심 생각을 파악한다.", "학생이 구조와 중심 생각을 연결한다.", "구조+중심 생각.", "Analyze"),
        S("5국02-02", "사실과 의견 구별하기", "사실과 의견 구별하기", "사실·의견을 구별하고 타당성을 판단한다.", "학생이 주장의 타당성을 평가한다.", "타당성 판단+근거.", "Evaluate"),
        S("5국02-03", "다양한 갈래의 글 읽기", "다양한 갈래의 글 읽기", "목적에 따라 다양한 글을 비판적으로 읽는다.", "학생이 비판적 질문을 던진다.", "비판 질문 2개 이상.", "Analyze"),
      ]),
      domain("5", "5국03", "쓰기", "쓰기", 3, [
        S("5국03-01", "목적과 독자를 고려해 쓰기", "목적과 독자를 고려해 쓰기", "목적·독자·매체를 고려해 쓴다.", "학생이 매체 특성을 반영해 쓴다.", "목적·독자·매체 반영.", "Apply"),
        S("5국03-02", "자료를 모아 보고 쓰기", "자료를 모아 보고 쓰기", "자료를 비교·종합하여 쓴다.", "학생이 자료를 종합한 글을 쓴다.", "종합 문단 포함.", "Apply"),
        S("5국03-03", "고쳐 쓰기로 글 다듬기", "고쳐 쓰기로 글 다듬기", "내용·조직·표현을 점검해 고쳐 쓴다.", "학생이 점검표를 활용해 수정한다.", "점검+수정 완료.", "Apply"),
      ]),
      domain("5", "5국04", "문법", "문법", 4, [
        S("5국04-01", "단어의 의미와 관계 이해하기", "단어의 의미와 관계 이해하기", "단어의 의미 확장과 관계를 이해한다.", "학생이 다의어/관용 표현을 설명한다.", "설명 정확.", "Understand"),
        S("5국04-02", "문장 구조와 높임 표현 알기", "문장 구조와 높임 표현 알기", "문장 구조와 담화 맥락의 높임을 안다.", "학생이 맥락에 맞는 높임을 선택한다.", "맥락 적합 선택.", "Apply"),
      ]),
      domain("5", "5국05", "문학", "문학", 5, [
        S("5국05-01", "작품의 갈래와 특성 이해하기", "작품의 갈래와 특성 이해하기", "갈래 특성과 표현 기법을 이해한다.", "학생이 표현 기법을 찾는다.", "기법 2가지+효과.", "Analyze"),
        S("5국05-02", "인물의 마음과 갈등 파악하기", "인물의 마음과 갈등 파악하기", "인물 간 갈등과 해결 과정을 파악한다.", "학생이 갈등 전개를 정리한다.", "발생–전개–해결.", "Analyze"),
        S("5국05-03", "작품에 대한 생각 표현하기", "작품에 대한 생각 표현하기", "작품의 주제와 관련해 생각을 표현한다.", "학생이 주제 연계 감상을 쓴다.", "주제+자기 생각.", "Apply"),
      ]),
    ],
  ],
  [
    "6",
    6,
    "6학년",
    "6학년",
    [
      domain("6", "6국01", "듣기·말하기", "듣기·말하기", 1, [
        S("6국01-01", "목적에 맞게 듣고 말하기", "목적에 맞게 듣고 말하기", "목적·상황·매체를 고려해 듣고 말한다.", "학생이 설득/설명 목적에 맞게 말한다.", "목적 달성 발화.", "Apply"),
        S("6국01-02", "토론·토의에 참여하기", "토론·토의에 참여하기", "합리적 근거로 토론·토의에 참여한다.", "학생이 근거와 반론을 제시한다.", "근거+반론 1회.", "Evaluate"),
        S("6국01-03", "매체 자료를 활용해 발표하기", "매체 자료를 활용해 발표하기", "매체를 비판적으로 활용해 발표한다.", "학생이 매체 선택 이유를 설명한다.", "선택 이유+발표.", "Apply"),
      ]),
      domain("6", "6국02", "읽기", "읽기", 2, [
        S("6국02-01", "글의 중심 생각 파악하기", "글의 중심 생각 파악하기", "글의 관점과 중심 생각을 파악한다.", "학생이 필자 관점을 진술한다.", "관점+근거.", "Analyze"),
        S("6국02-02", "사실과 의견 구별하기", "사실과 의견 구별하기", "주장과 근거의 타당성을 평가한다.", "학생이 주장-근거를 평가한다.", "평가 의견+기준.", "Evaluate"),
        S("6국02-03", "다양한 갈래의 글 읽기", "다양한 갈래의 글 읽기", "매체 텍스트를 포함하여 비판적으로 읽는다.", "학생이 매체 텍스트를 분석한다.", "분석 포인트 2개.", "Analyze"),
      ]),
      domain("6", "6국03", "쓰기", "쓰기", 3, [
        S("6국03-01", "목적과 독자를 고려해 쓰기", "목적과 독자를 고려해 쓰기", "목적·독자·장르에 맞게 쓴다.", "학생이 장르 관습을 반영해 쓴다.", "장르 적합 글.", "Apply"),
        S("6국03-02", "자료를 모아 보고 쓰기", "자료를 모아 보고 쓰기", "신뢰할 수 있는 자료를 선정·활용한다.", "학생이 자료 신뢰성을 점검한다.", "신뢰성 점검+활용.", "Evaluate"),
        S("6국03-03", "고쳐 쓰기로 글 다듬기", "고쳐 쓰기로 글 다듬기", "피드백을 반영해 글을 완성한다.", "학생이 동료/교사 피드백을 반영한다.", "피드백 반영 증거.", "Apply"),
      ]),
      domain("6", "6국04", "문법", "문법", 4, [
        S("6국04-01", "단어의 의미와 관계 이해하기", "단어의 의미와 관계 이해하기", "담화 맥락에서 단어 의미를 이해한다.", "학생이 맥락에 따른 의미 차이를 설명한다.", "맥락 의미 설명.", "Understand"),
        S("6국04-02", "문장 구조와 높임 표현 알기", "문장 구조와 높임 표현 알기", "문법 요소가 담화에 미치는 영향을 안다.", "학생이 문법 선택 효과를 설명한다.", "효과 설명 1가지.", "Analyze"),
      ]),
      domain("6", "6국05", "문학", "문학", 5, [
        S("6국05-01", "작품의 갈래와 특성 이해하기", "작품의 갈래와 특성 이해하기", "갈래·표현·주제를 종합적으로 이해한다.", "학생이 종합 감상을 한다.", "갈래+표현+주제.", "Analyze"),
        S("6국05-02", "인물의 마음과 갈등 파악하기", "인물의 마음과 갈등 파악하기", "인물·사건·배경의 관계를 파악한다.", "학생이 요소 간 관계를 설명한다.", "관계 설명 완성.", "Analyze"),
        S("6국05-03", "작품에 대한 생각 표현하기", "작품에 대한 생각 표현하기", "작품과 삶을 연결해 생각을 표현한다.", "학생이 삶 연계 감상을 쓴다.", "작품-삶 연결.", "Apply"),
      ]),
    ],
  ],
  [
    "7",
    7,
    "7학년",
    "7학년",
    [
      domain("7", "7국01", "듣기·말하기", "듣기·말하기", 1, [
        S("7국01-01", "비판적으로 듣고 말하기", "비판적으로 듣고 말하기", "내용을 비판적으로 듣고 말한다.", "학생이 주장의 문제점을 지적한다.", "비판 포인트+대안.", "Evaluate"),
        S("7국01-02", "설득과 협상에 참여하기", "설득과 협상에 참여하기", "설득과 협상 상황에 참여한다.", "학생이 설득 전략을 사용한다.", "전략 1가지+적용.", "Apply"),
      ]),
      domain("7", "7국02", "읽기", "읽기", 2, [
        S("7국02-01", "글의 관점과 의도 파악하기", "글의 관점과 의도 파악하기", "필자의 관점과 의도를 파악한다.", "학생이 관점·의도를 근거와 함께 말한다.", "관점+의도+근거.", "Analyze"),
        S("7국02-02", "매체 텍스트 비판적으로 읽기", "매체 텍스트 비판적으로 읽기", "매체 텍스트를 비판적으로 읽는다.", "학생이 매체 메시지의 편향을 점검한다.", "편향/의도 점검.", "Evaluate"),
      ]),
      domain("7", "7국03", "쓰기", "쓰기", 3, [
        S("7국03-01", "논설문·설명문 쓰기", "논설문·설명문 쓰기", "논설문과 설명문을 목적에 맞게 쓴다.", "학생이 주장-근거 구조의 글을 쓴다.", "주장+근거 2개 이상.", "Apply"),
        S("7국03-02", "자료와 근거를 들어 쓰기", "자료와 근거를 들어 쓰기", "신뢰할 자료와 근거를 들어 쓴다.", "학생이 출처를 밝혀 쓴다.", "출처 표기+근거.", "Apply"),
      ]),
      domain("7", "7국04", "문법", "문법", 4, [
        S("7국04-01", "문법 요소와 담화 이해하기", "문법 요소와 담화 이해하기", "문법 요소가 담화 의미에 미치는 영향을 이해한다.", "학생이 문법 선택의 의미 차이를 설명한다.", "의미 차이 설명.", "Analyze"),
        S("7국04-02", "한글의 특성과 국어 생활", "한글의 특성과 국어 생활", "한글의 특성과 국어 생활을 이해한다.", "학생이 한글 특성 사례를 든다.", "특성+사례.", "Understand"),
      ]),
      domain("7", "7국05", "문학", "문학", 5, [
        S("7국05-01", "문학의 갈래와 표현 이해하기", "문학의 갈래와 표현 이해하기", "문학 갈래와 표현 기법을 이해한다.", "학생이 표현 효과를 분석한다.", "기법+효과.", "Analyze"),
        S("7국05-02", "작품의 주제와 세계관 탐구하기", "작품의 주제와 세계관 탐구하기", "작품의 주제와 세계관을 탐구한다.", "학생이 주제/세계관을 진술한다.", "주제+세계관 근거.", "Analyze"),
      ]),
    ],
  ],
  [
    "8",
    8,
    "8학년",
    "8학년",
    [
      domain("8", "8국01", "듣기·말하기", "듣기·말하기", 1, [
        S("8국01-01", "비판적으로 듣고 말하기", "비판적으로 듣고 말하기", "논증을 평가하며 듣고 말한다.", "학생이 논증의 타당성을 평가한다.", "평가 기준+판단.", "Evaluate"),
        S("8국01-02", "설득과 협상에 참여하기", "설득과 협상에 참여하기", "상호 존중하며 설득·협상한다.", "학생이 합의점을 제안한다.", "합의 제안+근거.", "Apply"),
      ]),
      domain("8", "8국02", "읽기", "읽기", 2, [
        S("8국02-01", "글의 관점과 의도 파악하기", "글의 관점과 의도 파악하기", "복합 텍스트의 관점과 의도를 파악한다.", "학생이 관점 차이를 비교한다.", "비교 분석 완성.", "Analyze"),
        S("8국02-02", "매체 텍스트 비판적으로 읽기", "매체 텍스트 비판적으로 읽기", "매체 생산·유통 맥락을 고려해 읽는다.", "학생이 생산 맥락을 분석한다.", "맥락 분석 1건.", "Analyze"),
      ]),
      domain("8", "8국03", "쓰기", "쓰기", 3, [
        S("8국03-01", "논설문·설명문 쓰기", "논설문·설명문 쓰기", "복합적 주제를 논설·설명으로 쓴다.", "학생이 반론을 포함한 논설문을 쓴다.", "주장+반론+재반박.", "Apply"),
        S("8국03-02", "자료와 근거를 들어 쓰기", "자료와 근거를 들어 쓰기", "자료를 비판적으로 선별해 쓴다.", "학생이 자료의 한계를 밝힌다.", "선별 이유+한계.", "Evaluate"),
      ]),
      domain("8", "8국04", "문법", "문법", 4, [
        S("8국04-01", "문법 요소와 담화 이해하기", "문법 요소와 담화 이해하기", "문법과 담화 규범을 이해한다.", "학생이 담화 규범 사례를 분석한다.", "규범+사례.", "Analyze"),
        S("8국04-02", "한글의 특성과 국어 생활", "한글의 특성과 국어 생활", "국어 생활의 문제와 개선을 탐구한다.", "학생이 국어 생활 개선안을 제시한다.", "문제+개선안.", "Apply"),
      ]),
      domain("8", "8국05", "문학", "문학", 5, [
        S("8국05-01", "문학의 갈래와 표현 이해하기", "문학의 갈래와 표현 이해하기", "갈래 관습과 표현을 심화 이해한다.", "학생이 갈래 관습을 적용해 분석한다.", "관습 적용 분석.", "Analyze"),
        S("8국05-02", "작품의 주제와 세계관 탐구하기", "작품의 주제와 세계관 탐구하기", "작품과 사회·역사 맥락을 연결한다.", "학생이 맥락 연계 해석을 한다.", "작품-맥락 연결.", "Analyze"),
      ]),
    ],
  ],
  [
    "9",
    9,
    "9학년",
    "9학년",
    [
      domain("9", "9국01", "듣기·말하기", "듣기·말하기", 1, [
        S("9국01-01", "비판적으로 듣고 말하기", "비판적으로 듣고 말하기", "공공 담화를 비판적으로 듣고 말한다.", "학생이 공공 담화를 평가한다.", "평가+대안 제시.", "Evaluate"),
        S("9국01-02", "설득과 협상에 참여하기", "설득과 협상에 참여하기", "갈등 상황에서 합리적 협상에 참여한다.", "학생이 협상안을 설계한다.", "이해관계+협상안.", "Apply"),
      ]),
      domain("9", "9국02", "읽기", "읽기", 2, [
        S("9국02-01", "글의 관점과 의도 파악하기", "글의 관점과 의도 파악하기", "복합적 관점과 숨은 전제를 파악한다.", "학생이 전제를 드러낸다.", "전제+관점 분석.", "Analyze"),
        S("9국02-02", "매체 텍스트 비판적으로 읽기", "매체 텍스트 비판적으로 읽기", "디지털 매체 텍스트를 비판적으로 읽는다.", "학생이 디지털 텍스트를 검증한다.", "검증 절차 적용.", "Evaluate"),
      ]),
      domain("9", "9국03", "쓰기", "쓰기", 3, [
        S("9국03-01", "논설문·설명문 쓰기", "논설문·설명문 쓰기", "사회 쟁점에 대한 논설·설명문을 쓴다.", "학생이 쟁점 논설문을 완성한다.", "쟁점+다관점+주장.", "Apply"),
        S("9국03-02", "자료와 근거를 들어 쓰기", "자료와 근거를 들어 쓰기", "학술적 형식에 가깝게 근거를 제시한다.", "학생이 인용·각주 형식을 적용한다.", "인용 형식 준수.", "Apply"),
      ]),
      domain("9", "9국04", "문법", "문법", 4, [
        S("9국04-01", "문법 요소와 담화 이해하기", "문법 요소와 담화 이해하기", "문법·담화·매체의 관계를 이해한다.", "학생이 매체별 언어 사용을 비교한다.", "비교 분석.", "Analyze"),
        S("9국04-02", "한글의 특성과 국어 생활", "한글의 특성과 국어 생활", "국어정책과 국어 생활을 탐구한다.", "학생이 국어정책 사례를 평가한다.", "사례+평가.", "Evaluate"),
      ]),
      domain("9", "9국05", "문학", "문학", 5, [
        S("9국05-01", "문학의 갈래와 표현 이해하기", "문학의 갈래와 표현 이해하기", "현대·고전 갈래의 표현을 이해한다.", "학생이 현대/고전 표현을 비교한다.", "비교 포인트 2개.", "Analyze"),
        S("9국05-02", "작품의 주제와 세계관 탐구하기", "작품의 주제와 세계관 탐구하기", "작품의 세계관을 비판적으로 탐구한다.", "학생이 세계관을 비판적으로 해석한다.", "해석+비판 관점.", "Evaluate"),
      ]),
    ],
  ],
];

const koOps = applyBands("ko", ko, koBands, {
  name: "2022 Revised National Curriculum — Korean Language (1–9 sample)",
  nameKo: "2022 개정 교육과정 — 국어 (1–9학년 샘플)",
  description: "국어 듣기·말하기/읽기/쓰기/문법/문학 영역 초·중학교 밴드 샘플 커버리지.",
  gradeSpan: "1-9",
});
save(koPath, ko);
console.log(`✓ korean skills≈${countSkills(ko.tree)} ops=${koOps}`);

// ───────────────── Phase 5: KR History / Social Studies ─────────────────
const hiPath = "kr2022-history-grade-4.json";
const hi = load(hiPath);

const hiBands: Array<[string, number, string, string, ReturnType<typeof domain>[]]> = [
  [
    "3",
    3,
    "3학년",
    "3학년",
    [
      domain("3", "3사-고장", "우리 고장", "우리 고장", 1, [
        S("3사01-01", "우리 고장의 모습 살펴보기", "우리 고장의 모습 살펴보기", "우리 고장의 모습과 생활을 살펴본다.", "학생이 고장 모습을 관찰·기록한다.", "관찰 기록 3항목.", "Understand"),
        S("3사01-02", "고장의 중심지와 생활", "고장의 중심지와 생활", "고장의 중심지와 사람들의 생활을 이해한다.", "학생이 중심지 역할을 설명한다.", "역할 2가지.", "Understand"),
        S("3사01-03", "고장의 옛이야기와 문화", "고장의 옛이야기와 문화", "고장의 옛이야기와 문화를 알아본다.", "학생이 고장 문화 사례를 소개한다.", "사례 1건+의미.", "Understand"),
      ]),
      domain("3", "3사-지도", "지도와 생활", "지도와 생활", 2, [
        S("3사02-01", "지도의 기본 요소 알기", "지도의 기본 요소 알기", "지도의 기본 요소를 안다.", "학생이 방위·기호·범례를 읽는다.", "요소 3가지 정확.", "Remember"),
        S("3사02-02", "우리 고장을 지도로 나타내기", "우리 고장을 지도로 나타내기", "우리 고장을 간단한 지도로 나타낸다.", "학생이 고장 약도를 그린다.", "주요 장소 4곳 이상.", "Apply"),
      ]),
      domain("3", "3사-환경", "환경과 생활", "환경과 생활", 3, [
        S("3사03-01", "자연환경과 사람들의 생활", "자연환경과 사람들의 생활", "자연환경과 생활의 관계를 이해한다.", "학생이 환경-생활 연결을 설명한다.", "연결 사례 2개.", "Understand"),
        S("3사03-02", "환경 보호의 중요성", "환경 보호의 중요성", "환경 보호의 중요성을 안다.", "학생이 보호 행동을 제안한다.", "행동 제안 2개.", "Apply"),
      ]),
    ],
  ],
  [
    "4",
    4,
    "4학년",
    "4학년",
    [
      domain("4", "4사-지리", "지리", "지리", 1, [
        S("4사01-01", "우리나라의 위치와 영역", "우리나라의 위치와 영역", "우리나라의 위치와 영역을 이해한다.", "학생이 위치·영역을 지도로 설명한다.", "위치+영역 정확.", "Understand"),
        S("4사01-02", "지형과 기후", "지형과 기후", "지형과 기후의 특징을 이해한다.", "학생이 지형·기후 특징을 말한다.", "특징 각 2가지.", "Understand"),
        S("4사01-03", "인구와 도시", "인구와 도시", "인구 분포와 도시 생활을 이해한다.", "학생이 도시 생활 특징을 설명한다.", "특징 2가지.", "Understand"),
      ]),
      domain("4", "4사-역사", "역사", "역사", 2, [
        S("4사02-01", "선사 시대의 생활", "선사 시대의 생활", "선사 시대 사람들의 생활을 이해한다.", "학생이 선사 생활 모습을 설명한다.", "도구·생활 각 1.", "Understand"),
        S("4사02-02", "고조선과 여러 나라의 성장", "고조선과 여러 나라의 성장", "고조선과 여러 나라의 성장을 이해한다.", "학생이 고조선의 의의를 말한다.", "의의 1가지+근거.", "Understand"),
        S("4사02-03", "삼국의 성립과 발전", "삼국의 성립과 발전", "삼국의 성립과 발전을 이해한다.", "학생이 삼국의 특징을 비교한다.", "비교 포인트 2개.", "Analyze"),
      ]),
      domain("4", "4사-일반사회", "일반사회", "일반사회", 3, [
        S("4사03-01", "가족과 이웃의 생활", "가족과 이웃의 생활", "가족과 이웃의 역할을 이해한다.", "학생이 역할 사례를 든다.", "역할 2가지.", "Understand"),
        S("4사03-02", "공공기관과 주민 참여", "공공기관과 주민 참여", "공공기관과 주민 참여의 중요성을 안다.", "학생이 주민 참여 방법을 제안한다.", "방법 2가지.", "Apply"),
      ]),
      domain("4", "4사-지역", "지역", "지역", 4, [
        S("4사-지역-01", "우리 지역 탐구하기", "우리 지역 탐구하기", "우리 지역의 특성과 변화를 탐구한다.", "학생이 지역 특성을 조사한다.", "조사 항목 3개.", "Apply"),
      ]),
      domain("4", "4사-역사이야기", "역사 이야기", "역사 이야기", 5, [
        S("4사-역사-01", "역사 이야기 이해하기", "역사 이야기 이해하기", "역사 이야기를 통해 과거 생활을 이해한다.", "학생이 이야기 속 시대 배경을 말한다.", "배경 1가지+사건.", "Understand"),
      ]),
      domain("4", "4사-탐구", "사회 탐구", "사회 탐구", 6, [
        S("4사-탐구-01", "사회 현상 탐구하기", "사회 현상 탐구하기", "생활 속 사회 현상을 탐구한다.", "학생이 탐구 질문을 세워 조사한다.", "질문+조사 결과.", "Apply"),
      ]),
    ],
  ],
  [
    "5",
    5,
    "5학년",
    "5학년",
    [
      domain("5", "5사-지리", "지리", "지리", 1, [
        S("5사01-01", "국토의 이용과 변화", "국토의 이용과 변화", "국토 이용과 변화를 이해한다.", "학생이 국토 이용 사례를 설명한다.", "사례+변화.", "Understand"),
        S("5사01-02", "산업과 자원", "산업과 자원", "산업과 자원의 관계를 이해한다.", "학생이 산업-자원 연결을 말한다.", "연결 2개.", "Understand"),
        S("5사01-03", "교통과 통신의 발달", "교통과 통신의 발달", "교통과 통신의 발달이 생활에 미친 영향을 이해한다.", "학생이 영향 사례를 든다.", "영향 2가지.", "Understand"),
      ]),
      domain("5", "5사-역사", "역사", "역사", 2, [
        S("5사02-01", "통일 신라와 발해", "통일 신라와 발해", "통일 신라와 발해의 발전을 이해한다.", "학생이 두 나라의 특징을 비교한다.", "비교 2항목.", "Analyze"),
        S("5사02-02", "고려의 성립과 발전", "고려의 성립과 발전", "고려의 성립과 발전을 이해한다.", "학생이 고려의 주요 정책을 말한다.", "정책 2가지.", "Understand"),
        S("5사02-03", "조선의 건국과 통치 체제", "조선의 건국과 통치 체제", "조선의 건국과 통치 체제를 이해한다.", "학생이 통치 체제 특징을 설명한다.", "특징 2가지.", "Understand"),
        S("5사02-04", "조선 후기의 변화", "조선 후기의 변화", "조선 후기 사회 변화를 이해한다.", "학생이 변화 양상을 정리한다.", "변화 2가지.", "Analyze"),
      ]),
      domain("5", "5사-일반사회", "일반사회", "일반사회", 3, [
        S("5사03-01", "민주주의와 시민의 권리", "민주주의와 시민의 권리", "민주주의와 시민의 권리를 이해한다.", "학생이 시민 권리 사례를 든다.", "권리 2가지.", "Understand"),
        S("5사03-02", "경제생활과 시장", "경제생활과 시장", "경제생활과 시장의 기본 원리를 이해한다.", "학생이 수요·공급 사례를 설명한다.", "사례 설명.", "Understand"),
      ]),
      domain("5", "5사-나라", "나라의 발전", "나라의 발전", 4, [
        S("5사-나라-01", "우리나라의 발전 과정", "우리나라의 발전 과정", "우리나라의 발전 과정을 이해한다.", "학생이 발전 시기의 특징을 말한다.", "시기+특징.", "Understand"),
      ]),
    ],
  ],
  [
    "6",
    6,
    "6학년",
    "6학년",
    [
      domain("6", "6사-지리", "지리", "지리", 1, [
        S("6사01-01", "세계 여러 나라의 자연과 문화", "세계 여러 나라의 자연과 문화", "세계 여러 나라의 자연과 문화를 이해한다.", "학생이 나라별 자연·문화를 비교한다.", "비교 2개국.", "Analyze"),
        S("6사01-02", "우리나라와 가까운 나라들", "우리나라와 가까운 나라들", "이웃 나라와의 관계를 이해한다.", "학생이 교류 사례를 설명한다.", "교류 사례 2개.", "Understand"),
        S("6사01-03", "지구촌 문제와 협력", "지구촌 문제와 협력", "지구촌 문제와 국제 협력을 이해한다.", "학생이 문제와 협력 방안을 제안한다.", "문제+방안.", "Apply"),
      ]),
      domain("6", "6사-역사", "역사", "역사", 2, [
        S("6사02-01", "근대 국가 수립 운동", "근대 국가 수립 운동", "근대 국가 수립 운동을 이해한다.", "학생이 주요 운동을 설명한다.", "운동 2건.", "Understand"),
        S("6사02-02", "일제 강점과 민족 운동", "일제 강점과 민족 운동", "일제 강점과 민족 운동을 이해한다.", "학생이 민족 운동 사례를 든다.", "사례 2건+의미.", "Understand"),
        S("6사02-03", "광복과 대한민국 수립", "광복과 대한민국 수립", "광복과 대한민국 수립 과정을 이해한다.", "학생이 수립 과정을 순서대로 정리한다.", "주요 사건 3개.", "Understand"),
        S("6사02-04", "민주주의의 발전과 오늘", "민주주의의 발전과 오늘", "민주주의 발전과 오늘날 과제를 이해한다.", "학생이 발전 사례와 과제를 말한다.", "사례+과제.", "Analyze"),
      ]),
      domain("6", "6사-일반사회", "일반사회", "일반사회", 3, [
        S("6사03-01", "헌법과 국가기관", "헌법과 국가기관", "헌법과 국가기관의 역할을 이해한다.", "학생이 국가기관 역할을 구분한다.", "기관 3개 역할.", "Understand"),
        S("6사03-02", "세계화와 평화", "세계화와 평화", "세계화와 평화의 중요성을 이해한다.", "학생이 평화 협력 사례를 제시한다.", "사례 1건+의.", "Understand"),
      ]),
      domain("6", "6사-근현대", "근현대", "근현대", 4, [
        S("6사-근현대-01", "근현대사 주요 흐름", "근현대사 주요 흐름", "근현대사의 주요 흐름을 파악한다.", "학생이 시대 흐름을 연표로 정리한다.", "연표 5사건.", "Analyze"),
      ]),
    ],
  ],
  [
    "7",
    7,
    "7학년",
    "7학년",
    [
      domain("7", "7한-선사고대", "선사·고대", "선사·고대", 1, [
        S("7한01-01", "선사 문화의 발전", "선사 문화의 발전", "선사 문화의 발전을 이해한다.", "학생이 시대별 문화 변화를 설명한다.", "변화 2단계.", "Understand"),
        S("7한01-02", "고조선과 여러 나라", "고조선과 여러 나라", "고조선과 여러 나라의 성립을 이해한다.", "학생이 국가 성립 조건을 말한다.", "조건 2가지.", "Understand"),
        S("7한01-03", "삼국의 성립과 발전", "삼국의 성립과 발전", "삼국의 경쟁과 발전을 이해한다.", "학생이 삼국 관계를 정리한다.", "관계 설명.", "Analyze"),
        S("7한01-04", "통일 신라와 발해", "통일 신라와 발해", "통일 신라와 발해의 발전을 이해한다.", "학생이 두 나라의 문화 성과를 비교한다.", "성과 비교 2항.", "Analyze"),
      ]),
      domain("7", "7한-세계", "세계사 기초", "세계사 기초", 2, [
        S("7한02-01", "고대 문명의 형성", "고대 문명의 형성", "고대 문명의 형성을 이해한다.", "학생이 문명 형성 요인을 말한다.", "요인 2가지.", "Understand"),
        S("7한02-02", "아시아 여러 지역의 교류", "아시아 여러 지역의 교류", "아시아 지역 교류를 이해한다.", "학생이 교류 경로/물자를 설명한다.", "경로+물자.", "Understand"),
      ]),
    ],
  ],
  [
    "8",
    8,
    "8학년",
    "8학년",
    [
      domain("8", "8한-고려조선", "고려·조선", "고려·조선", 1, [
        S("8한01-01", "고려의 정치와 사회", "고려의 정치와 사회", "고려의 정치와 사회를 이해한다.", "학생이 고려 통치 특징을 설명한다.", "특징 2가지.", "Understand"),
        S("8한01-02", "조선의 성립과 통치 질서", "조선의 성립과 통치 질서", "조선의 성립과 통치 질서를 이해한다.", "학생이 통치 질서의 핵심을 말한다.", "핵심 제도 2개.", "Understand"),
        S("8한01-03", "사림 세력과 붕당 정치", "사림 세력과 붕당 정치", "사림과 붕당 정치를 이해한다.", "학생이 붕당의 형성 배경을 설명한다.", "배경+영향.", "Analyze"),
        S("8한01-04", "조선 후기 사회 변동", "조선 후기 사회 변동", "조선 후기 사회 변동을 이해한다.", "학생이 변동 양상을 정리한다.", "변동 3가지.", "Analyze"),
      ]),
      domain("8", "8한-세계", "세계사의 흐름", "세계사의 흐름", 2, [
        S("8한02-01", "중세 유럽과 이슬람 세계", "중세 유럽과 이슬람 세계", "중세 유럽과 이슬람 세계를 이해한다.", "학생이 두 세계의 특징을 비교한다.", "비교 2항.", "Analyze"),
        S("8한02-02", "근대 세계의 형성", "근대 세계의 형성", "근대 세계 형성 과정을 이해한다.", "학생이 근대 전환 사건을 정리한다.", "사건 3개.", "Understand"),
      ]),
    ],
  ],
  [
    "9",
    9,
    "9학년",
    "9학년",
    [
      domain("9", "9한-근현대", "근현대", "근현대", 1, [
        S("9한01-01", "개항과 근대 개혁", "개항과 근대 개혁", "개항과 근대 개혁을 이해한다.", "학생이 개혁의 성과와 한계를 말한다.", "성과+한계.", "Analyze"),
        S("9한01-02", "국권 피탈과 독립운동", "국권 피탈과 독립운동", "국권 피탈과 독립운동을 이해한다.", "학생이 독립운동의 흐름을 정리한다.", "시기별 2사례.", "Understand"),
        S("9한01-03", "광복과 대한민국 수립", "광복과 대한민국 수립", "광복과 대한민국 수립을 이해한다.", "학생이 수립 과정의 쟁점을 설명한다.", "쟁점 1개+근거.", "Analyze"),
        S("9한01-04", "산업화와 민주화", "산업화와 민주화", "산업화와 민주화 과정을 이해한다.", "학생이 두 과정의 관계를 설명한다.", "관계 설명.", "Analyze"),
        S("9한01-05", "남북 관계와 통일 과제", "남북 관계와 통일 과제", "남북 관계와 통일 과제를 이해한다.", "학생이 통일 과제를 제안한다.", "과제 2개.", "Apply"),
      ]),
      domain("9", "9한-현대세계", "현대 세계", "현대 세계", 2, [
        S("9한02-01", "두 차례 세계 대전과 국제 질서", "두 차례 세계 대전과 국제 질서", "세계 대전과 국제 질서 변화를 이해한다.", "학생이 질서 변화 요인을 말한다.", "요인 2가지.", "Understand"),
        S("9한02-02", "냉전과 세계화", "냉전과 세계화", "냉전과 세계화의 흐름을 이해한다.", "학생이 냉전/세계화 특징을 비교한다.", "비교 2항.", "Analyze"),
      ]),
    ],
  ],
];

const hiOps = applyBands("hist", hi, hiBands, {
  name: "2022 Revised National Curriculum — Korean History / Social Studies (3–9 sample)",
  nameKo: "2022 개정 교육과정 — 한국사/사회 (3–9학년 샘플)",
  description: "초등 사회·중등 역사 밴드 샘플 커버리지 (지리·역사·일반사회).",
  gradeSpan: "3-9",
});
save(hiPath, hi);
console.log(`✓ history skills≈${countSkills(hi.tree)} ops=${hiOps}`);

console.log("\n=== FULL CURRICULUM EXPANSION COMPLETE ===");
for (const f of [
  "ccss-math-grade-4.json",
  "ccss-ela-grade-4.json",
  "ngss-science-grade-4.json",
  "kr2022-korean-grade-4.json",
  "kr2022-history-grade-4.json",
]) {
  const p = load(f);
  console.log(
    `  ${f}: skills≈${countSkills(p.tree)} grades=${p.tree.children.length}`
  );
}
