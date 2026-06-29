const { getStudentHistory } = require('./studentService');
const { getMakeupLessons } = require('./makeupService');

function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function quarterKey(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return '';
  const year = m[1];
  const month = parseInt(m[2], 10);
  const q = Math.ceil(month / 3);
  return year + ' Q' + q;
}

function bucketLabel(dateStr, period) {
  return period === 'quarter' ? quarterKey(dateStr) : monthKey(dateStr);
}

function normalizeVocab(val) {
  if (val === '' || val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getStudentStats(classId, studentId, period) {
  period = period === 'quarter' ? 'quarter' : 'month';
  const [history, makeup] = await Promise.all([
    getStudentHistory(classId, studentId),
    getMakeupLessons(classId, studentId)
  ]);

  const vocabBuckets = {};
  const absenceBuckets = {};

  history.forEach(r => {
    const label = bucketLabel(r.dateStr, period);
    if (!label) return;

    if (!absenceBuckets[label]) {
      absenceBuckets[label] = { present: 0, tardy: 0, absent: 0 };
    }
    if (r.attendance === '출석') absenceBuckets[label].present++;
    else if (r.attendance === '지각') absenceBuckets[label].tardy++;
    else if (r.attendance === '결석') absenceBuckets[label].absent++;

    const score = normalizeVocab(r.vocabScore);
    if (score != null) {
      if (!vocabBuckets[label]) vocabBuckets[label] = { sum: 0, count: 0 };
      vocabBuckets[label].sum += score;
      vocabBuckets[label].count++;
    }
  });

  const sortLabels = (labels) => labels.sort((a, b) => {
    if (period === 'quarter') {
      const pa = a.match(/^(\d{4}) Q(\d)$/);
      const pb = b.match(/^(\d{4}) Q(\d)$/);
      if (!pa || !pb) return a.localeCompare(b);
      if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
      return parseInt(pa[2], 10) - parseInt(pb[2], 10);
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const vocabLabels = sortLabels(Object.keys(vocabBuckets));
  const absenceLabels = sortLabels(Object.keys(absenceBuckets));
  const allLabels = sortLabels([...new Set([...vocabLabels, ...absenceLabels])]);

  return {
    period,
    labels: allLabels,
    vocab: allLabels.map(label => {
      const b = vocabBuckets[label];
      if (!b || !b.count) return { label, avg: null, count: 0 };
      return {
        label,
        avg: Math.round((b.sum / b.count) * 10) / 10,
        count: b.count
      };
    }),
    absence: allLabels.map(label => {
      const b = absenceBuckets[label] || { present: 0, tardy: 0, absent: 0 };
      return { label, ...b };
    }),
    makeup
  };
}

module.exports = { getStudentStats };
