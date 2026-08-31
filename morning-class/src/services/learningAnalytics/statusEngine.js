/**
 * Early-warning status engine for Learning Analytics.
 * Pure functions — no I/O.
 */

/** @typedef {import('./types').AnalyticsStatus} AnalyticsStatus */
/** @typedef {import('./types').StatusResult} StatusResult */
/** @typedef {import('./types').TestReport} TestReport */
/** @typedef {import('./types').DailyEngagementLog} DailyEngagementLog */
/** @typedef {import('./types').EngagementSummary} EngagementSummary */

const STATUS_META = {
  on_track: { label: 'On Track', color: 'green', rank: 0 },
  attention: { label: 'Attention', color: 'yellow', rank: 1 },
  warning: { label: 'Warning', color: 'orange', rank: 2 },
  intervention: { label: 'Intervention Required', color: 'red', rank: 3 }
};

function num(v, fallback = null) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sortByDateAsc(rows, key) {
  return (rows || []).slice().sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')));
}

/**
 * External score trend for a given source (star_reading | map).
 * Uses percentile when available, else score/RIT.
 */
function computeExternalTrend(testReports, source) {
  const pts = sortByDateAsc(
    (testReports || []).filter((r) => r.source === source),
    'testDate'
  ).map((r) => ({
    date: r.testDate,
    value: num(r.percentile, num(r.ritScore, num(r.score)))
  })).filter((p) => p.value != null);

  if (pts.length < 2) {
    return {
      source,
      points: pts,
      delta: null,
      declining: false,
      stagnant: pts.length >= 1,
      lowLatest: pts.length ? pts[pts.length - 1].value < 30 : false,
      latest: pts.length ? pts[pts.length - 1].value : null
    };
  }
  const first = pts[0].value;
  const last = pts[pts.length - 1].value;
  const prev = pts[pts.length - 2].value;
  const delta = last - first;
  const recentDelta = last - prev;
  return {
    source,
    points: pts,
    delta,
    recentDelta,
    declining: recentDelta <= -5 || delta <= -8,
    stagnant: Math.abs(delta) < 3 && Math.abs(recentDelta) < 2,
    lowLatest: last < 30,
    latest: last
  };
}

function summarizeEngagement(dailyLogs, pendingHomework) {
  const logs = dailyLogs || [];
  let assigned = 0;
  let submitted = 0;
  let vocabSum = 0;
  let vocabN = 0;
  let formSum = 0;
  let formN = 0;
  let partSum = 0;
  let partN = 0;

  logs.forEach((l) => {
    assigned += Number(l.homeworkAssigned) || 0;
    submitted += Number(l.homeworkSubmitted) || 0;
    const v = num(l.vocabScore);
    if (v != null) { vocabSum += v; vocabN += 1; }
    const f = num(l.formativeScore);
    if (f != null) { formSum += f; formN += 1; }
    const p = num(l.participation);
    if (p != null) { partSum += p; partN += 1; }
  });

  const homeworkCompletionRate = assigned > 0 ? submitted / assigned : 1;
  return {
    homeworkCompletionRate,
    pendingHomework: Number(pendingHomework) || 0,
    avgVocabScore: vocabN ? vocabSum / vocabN : null,
    avgFormativeScore: formN ? formSum / formN : null,
    avgParticipation: partN ? partSum / partN : null,
    daysLogged: logs.length
  };
}

/**
 * @param {Object} input
 * @param {TestReport[]} input.testReports
 * @param {DailyEngagementLog[]} input.dailyLogs
 * @param {number} [input.pendingHomework]
 * @param {EngagementSummary} [input.engagement]  precomputed optional
 * @returns {StatusResult}
 */
function calculateStudentStatus(input) {
  const testReports = input.testReports || [];
  const engagement = input.engagement || summarizeEngagement(input.dailyLogs, input.pendingHomework);

  const sr = computeExternalTrend(testReports, 'star_reading');
  const map = computeExternalTrend(testReports, 'map');
  const externalDeclining = sr.declining || map.declining;
  const externalStagnant = (sr.stagnant && sr.points.length >= 2) || (map.stagnant && map.points.length >= 2);
  const externalLow = sr.lowLatest || map.lowLatest;

  const hwRate = engagement.homeworkCompletionRate;
  const pending = engagement.pendingHomework || 0;
  const vocabLow = engagement.avgVocabScore != null && engagement.avgVocabScore < 70;
  const participationLow = engagement.avgParticipation != null && engagement.avgParticipation < 60;
  const lowEngagement = hwRate < 0.6 || vocabLow || participationLow || pending >= 3;
  const mildEngagementIssue = pending >= 2 || hwRate < 0.75 || vocabLow;

  const rootCauses = [];
  const signals = [];

  if (sr.declining) {
    rootCauses.push('star_reading_decline');
    signals.push('Star Reading trend is declining');
  }
  if (map.declining) {
    rootCauses.push('map_decline');
    signals.push('MAP RIT/percentile trend is declining');
  }
  if (externalStagnant && !externalDeclining) {
    rootCauses.push('stagnant_growth');
    signals.push('External assessment growth is stagnant');
  }
  if (externalLow) {
    rootCauses.push('low_external_score');
    signals.push('Latest external score is significantly low (< 30th percentile / low RIT band)');
  }
  if (hwRate < 0.6) {
    rootCauses.push('low_homework_completion');
    signals.push('Homework completion rate below 60% (' + Math.round(hwRate * 100) + '%)');
  } else if (pending >= 2) {
    rootCauses.push('pending_homework');
    signals.push(pending + ' unsubmitted homework item(s)');
  }
  if (vocabLow) {
    rootCauses.push('low_daily_vocab');
    signals.push('Average daily vocab score low (' + Math.round(engagement.avgVocabScore) + '%)');
  }
  if (participationLow) {
    rootCauses.push('low_participation');
    signals.push('Class participation average below 60%');
  }

  // Correlation: reading drop + English engagement
  if ((sr.declining || map.declining) && (hwRate < 0.6 || vocabLow)) {
    rootCauses.push('reading_drop_linked_to_engagement');
    signals.push('Reading score drop correlates with low homework/vocab engagement');
  }

  let status = 'on_track';
  if (externalDeclining && lowEngagement) {
    status = 'intervention';
  } else if (externalDeclining || externalLow) {
    status = 'warning';
  } else if (externalStagnant || mildEngagementIssue) {
    status = 'attention';
  } else {
    status = 'on_track';
    if (!signals.length) signals.push('Meeting growth targets with healthy engagement');
  }

  const meta = STATUS_META[status];
  return {
    status,
    label: meta.label,
    color: meta.color,
    rootCauses: [...new Set(rootCauses)],
    signals,
    metrics: {
      starReading: sr,
      map,
      engagement
    }
  };
}

function buildDomainProfile(testReports) {
  const byDomain = {};
  sortByDateAsc(testReports || [], 'testDate').forEach((r) => {
    (r.domainScores || []).forEach((d) => {
      const key = String(d.domain || d.label || 'other');
      if (!byDomain[key]) byDomain[key] = [];
      byDomain[key].push({
        date: r.testDate,
        score: num(d.score, num(d.percentile)),
        label: d.label || key
      });
    });
  });

  return Object.keys(byDomain).map((domain) => {
    const series = byDomain[domain].filter((p) => p.score != null);
    const latest = series.length ? series[series.length - 1].score : null;
    const first = series.length ? series[0].score : null;
    const trendDelta = latest != null && first != null ? latest - first : null;
    let band = 'unknown';
    if (latest != null) {
      if (latest >= 75) band = 'strength';
      else if (latest >= 50) band = 'developing';
      else band = 'weakness';
    }
    return {
      domain,
      label: (series[0] && series[0].label) || domain,
      latestScore: latest,
      trendDelta,
      band
    };
  }).sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function buildProgressSeries(testReports, dailyLogs) {
  const out = [];
  (testReports || []).forEach((r) => {
    const v = num(r.percentile, num(r.ritScore, num(r.score)));
    if (v == null) return;
    out.push({
      date: r.testDate,
      series: r.source,
      value: v,
      label: r.source === 'map' ? 'MAP' : (r.source === 'star_reading' ? 'Star Reading' : r.source)
    });
  });
  (dailyLogs || []).forEach((l) => {
    if (num(l.vocabScore) != null) {
      out.push({ date: l.date, series: 'vocab', value: Number(l.vocabScore), label: 'Daily Vocab' });
    }
    if (num(l.formativeScore) != null) {
      out.push({ date: l.date, series: 'formative', value: Number(l.formativeScore), label: 'Formative' });
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
  STATUS_META,
  calculateStudentStatus,
  summarizeEngagement,
  computeExternalTrend,
  buildDomainProfile,
  buildProgressSeries
};
