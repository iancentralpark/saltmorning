const { askGemini, isGeminiConfigured } = require('../geminiService');
const {
  getStudentAnalytics,
  saveIntervention,
  defaultActions
} = require('./analyticsService');

function ruleBasedDiagnostic(bundle) {
  const status = bundle.status || {};
  const eng = bundle.engagement || {};
  const domains = bundle.domainProfile || [];
  const weak = domains.filter((d) => d.band === 'weakness').map((d) => d.label);
  const strong = domains.filter((d) => d.band === 'strength').map((d) => d.label);
  const actions = defaultActions(status.status);

  const teacherLines = [
    'Status: ' + (status.label || status.status),
    'Signals: ' + (status.signals || []).join('; '),
    weak.length ? 'Weak domains: ' + weak.join(', ') : 'No clear weak domain tagged yet.',
    strong.length ? 'Strengths: ' + strong.join(', ') : '',
    'Homework completion: ' + Math.round((eng.homeworkCompletionRate || 0) * 100) + '%',
    'Avg daily vocab: ' + (eng.avgVocabScore != null ? Math.round(eng.avgVocabScore) + '%' : 'n/a'),
    'Recommended interventions:',
    ...actions.map((a, i) => (i + 1) + '. ' + a)
  ].filter(Boolean);

  const parentLines = [
    bundle.name + ' currently has a learning status of “' + (status.label || '') + '”.',
    status.status === 'on_track'
      ? 'Growth and classroom engagement look healthy. Keep encouraging regular reading at home.'
      : 'We are watching progress closely and will support with short, focused practice.',
    weak.length
      ? 'Focus areas: ' + weak.join(', ') + '.'
      : 'Continue balancing reading, vocabulary, and homework habits.',
    'At-home tip: 10 minutes of vocabulary or shared reading on school nights helps a lot.',
    'Thank you for partnering with us.'
  ];

  return {
    teacherReport: teacherLines.join('\n'),
    parentReport: parentLines.join('\n'),
    recommendedActions: actions,
    source: 'rules'
  };
}

async function generateAiDiagnostic(classId, studentId) {
  const bundle = await getStudentAnalytics(classId, studentId);
  let diagnostic = ruleBasedDiagnostic(bundle);

  if (isGeminiConfigured()) {
    try {
      const prompt =
        'You are an instructional coach. Given this student analytics JSON, write:\n' +
        '1) TEACHER_REPORT: concise technical analysis + interventions (English)\n' +
        '2) PARENT_REPORT: warm, plain-language summary for parents (English)\n' +
        '3) ACTIONS: 3-5 short bullet actions\n' +
        'Return JSON: {"teacherReport":"...","parentReport":"...","recommendedActions":["..."]}\n\n' +
        JSON.stringify({
          name: bundle.name,
          status: bundle.status,
          engagement: bundle.engagement,
          domainProfile: bundle.domainProfile,
          latestTests: (bundle.testReports || []).slice(-4)
        });
      const ai = await askGemini(prompt, { temperature: 0.35, maxOutputTokens: 1200 });
      const text = String(ai.text || ai.answer || '');
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        diagnostic = {
          teacherReport: String(parsed.teacherReport || diagnostic.teacherReport),
          parentReport: String(parsed.parentReport || diagnostic.parentReport),
          recommendedActions: Array.isArray(parsed.recommendedActions)
            ? parsed.recommendedActions.map(String)
            : diagnostic.recommendedActions,
          source: 'gemini'
        };
      }
    } catch (e) {
      diagnostic.source = 'rules_fallback';
      diagnostic.aiError = e.message;
    }
  }

  const saved = await saveIntervention({
    studentId,
    classId,
    status: bundle.status.status,
    rootCauses: bundle.status.rootCauses,
    teacherReport: diagnostic.teacherReport,
    parentReport: diagnostic.parentReport,
    recommendedActions: diagnostic.recommendedActions
  });

  return {
    student: bundle,
    diagnostic: Object.assign({}, diagnostic, { intervention: saved })
  };
}

module.exports = { generateAiDiagnostic, ruleBasedDiagnostic };
