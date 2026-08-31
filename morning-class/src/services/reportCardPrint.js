/**
 * Report card print helpers: GPA, grade legend, school header constants.
 */

const GPA_POINTS = {
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  F: 0
};

const GRADE_LEGEND = [
  { letter: 'A', range: '93–100%' },
  { letter: 'A-', range: '90–92%' },
  { letter: 'B+', range: '87–89%' },
  { letter: 'B', range: '83–86%' },
  { letter: 'B-', range: '80–82%' },
  { letter: 'C+', range: '77–79%' },
  { letter: 'C', range: '73–76%' },
  { letter: 'C-', range: '70–72%' },
  { letter: 'D+', range: '67–69%' },
  { letter: 'D', range: '60–66%' },
  { letter: 'F', range: 'Below 60%' }
];

const SEL_LEGEND = [
  { symbol: 'Outstanding', meaning: 'Consistently exceeds expectations' },
  { symbol: 'Satisfactory', meaning: 'Meets grade-level expectations' },
  { symbol: 'Needs Improvement', meaning: 'Approaching expectations; support recommended' },
  { symbol: 'Unsatisfactory', meaning: 'Below expectations; intervention needed' }
];

function gpaPointsForLetter(letter) {
  const L = String(letter || '').trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(GPA_POINTS, L)) return GPA_POINTS[L];
  // tolerate lowercase keys already handled; try original
  if (Object.prototype.hasOwnProperty.call(GPA_POINTS, letter)) return GPA_POINTS[letter];
  return null;
}

function computeTermSummary(subjects) {
  const list = (subjects || []).filter((s) => s && (s.percentageGrade != null || s.letterGrade));
  let pctSum = 0;
  let pctN = 0;
  let gpaSum = 0;
  let gpaN = 0;
  list.forEach((s) => {
    if (s.percentageGrade != null && !Number.isNaN(Number(s.percentageGrade))) {
      pctSum += Number(s.percentageGrade);
      pctN += 1;
    }
    const pts = gpaPointsForLetter(s.letterGrade);
    if (pts != null) {
      gpaSum += pts;
      gpaN += 1;
    }
  });
  const overallAveragePercentage = pctN ? Math.round((pctSum / pctN) * 10) / 10 : null;
  const termGpa = gpaN ? Math.round((gpaSum / gpaN) * 100) / 100 : null;
  return {
    termGpa,
    overallAveragePercentage,
    subjectsCounted: Math.max(pctN, gpaN)
  };
}

function academicYearLabel(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  // KR morning-class year typically Mar–Feb
  if (m >= 3) return y + '–' + String(y + 1).slice(2);
  return (y - 1) + '–' + String(y).slice(2);
}

function termDisplayLabel(term) {
  const t = String(term || '').trim();
  const map = {
    Term1: 'Semester 1 / Quarter 1–2',
    Term2: 'Semester 2 / Quarter 3–4',
    Q1: 'Quarter 1',
    Q2: 'Quarter 2',
    Q3: 'Quarter 3',
    Q4: 'Quarter 4',
    S1: 'Semester 1',
    S2: 'Semester 2'
  };
  return map[t] || t;
}

module.exports = {
  GPA_POINTS,
  GRADE_LEGEND,
  SEL_LEGEND,
  gpaPointsForLetter,
  computeTermSummary,
  academicYearLabel,
  termDisplayLabel
};
