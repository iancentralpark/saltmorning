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
  const name = bundle.name || 'This student';
  const hw = Math.round((eng.homeworkCompletionRate || 0) * 100);
  const vocab = eng.avgVocabScore != null ? Math.round(eng.avgVocabScore) + '%' : 'not yet available';

  const teacherReport = [
    name + ' currently presents as a “' + (status.label || status.status || 'developing') +
      '” learner based on Star Reading / MAP trends, classroom engagement, and recent work habits.',
    '',
    strong.length
      ? 'Strengths are clearest in ' + strong.join(', ') +
        '. These domains can be used as entry points for harder texts and peer modeling.'
      : 'Strength markers are still emerging; keep collecting domain-level evidence from the next assessment window.',
    '',
    weak.length
      ? 'Gaps concentrate in ' + weak.join(', ') +
        '. Instruction should temporarily narrow here with short, high-frequency practice rather than broad homework volume.'
      : 'No single weak domain dominates yet; watch for emerging dips across the next two progress checks.',
    '',
    'Classroom habits show homework completion around ' + hw +
      '% and average daily vocabulary performance at ' + vocab +
      '. Together these signal how consistently ' + name +
      ' rehearses skills outside whole-class lessons.',
    '',
    'Learner profile: treat ' + name +
      ' as needing explicit modeling, brief independent attempts, and immediate feedback loops. Prefer short reading or vocabulary clinics (8–12 minutes) over long undifferentiated packets.',
    '',
    'Immediate pedagogical moves:',
    ...actions.map((a, i) => (i + 1) + '. ' + a)
  ].join('\n');

  const parentReport = [
    name + ' is currently in a “' + (status.label || '') + '” learning band at school.',
    status.status === 'on_track'
      ? 'Overall growth and engagement look healthy. Continuing short shared reading at home will reinforce progress.'
      : 'We are watching progress carefully and will support with short, focused practice rather than more homework for its own sake.',
    weak.length
      ? 'The most useful home focus right now is ' + weak.join(', ') + '.'
      : 'A balanced mix of reading enjoyment and vocabulary play remains helpful.',
    'A practical routine: about 10 minutes of reading or vocabulary practice on school nights, with praise for effort and strategy use.',
    'Thank you for partnering with us — small, consistent habits matter more than long weekend catch-up sessions.'
  ].join('\n\n');

  return {
    teacherReport,
    parentReport,
    recommendedActions: actions,
    urgentInterventions: status.status === 'intervention' || status.status === 'warning'
      ? actions.slice(0, 3)
      : actions.slice(0, 2),
    learnerProfile: 'Needs explicit modeling, short independent practice, and quick feedback.',
    source: 'rules'
  };
}

function diagnosticPrompt(bundle) {
  const payload = {
    name: bundle.name,
    status: bundle.status,
    engagement: bundle.engagement,
    domainProfile: bundle.domainProfile,
    latestTests: (bundle.testReports || []).slice(-6),
    progressSeries: (bundle.progressSeries || []).slice(-24),
    teacherNotes: (bundle.teacherNotes || []).map((n) => ({
      subject: n.subject,
      noteType: n.noteType,
      teacherName: n.teacherName,
      body: n.body,
      updatedAt: n.updatedAt || n.createdAt
    })),
    latestIntervention: bundle.latestIntervention
      ? {
        status: bundle.latestIntervention.status,
        teacherReport: bundle.latestIntervention.teacherReport,
        recommendedActions: bundle.latestIntervention.recommendedActions
      }
      : null
  };

  return [
    'You are a senior instructional coach and literacy specialist.',
    'Using ALL of the student analytics JSON below, write a rich pedagogical analysis.',
    'Teacher-submitted diagnostic results and subject comments are in teacherNotes — treat them as firsthand classroom evidence.',
    '',
    'Requirements for teacherReport (essay, English, 4–8 paragraphs):',
    '- Synthesize what the student does well, dispositions/tendencies, academic strengths, and gaps.',
    '- Characterize what kind of learner they appear to be (e.g., strategy use, stamina, vocabulary depth, homework habits, response to challenge).',
    '- Explain how to guide them: grouping, questioning, scaffolds, text selection, feedback style.',
    '- Recommend concrete practice (frequency, duration, materials/skills) grounded in the data.',
    '- Be specific and academic — avoid generic pep-talk language.',
    '',
    'Requirements for parentReport (warm, clear English, 2–4 short paragraphs):',
    '- Plain language; no jargon walls; still honest about focus areas.',
    '',
    'Requirements for urgentInterventions:',
    '- 2–5 IMMEDIATE next steps for the next 1–2 weeks.',
    '- Each item must be pedagogical and academic (skill target + instructional move + why now).',
    '',
    'Requirements for recommendedActions:',
    '- 4–8 broader instructional actions (classroom + home) for the next month.',
    '',
    'Also include learnerProfile: one crisp sentence naming the learner type and core instructional implication.',
    '',
    'Return ONLY JSON:',
    JSON.stringify({
      teacherReport: 'essay…',
      parentReport: '…',
      learnerProfile: '…',
      urgentInterventions: ['…'],
      recommendedActions: ['…']
    }),
    '',
    'Student analytics JSON:',
    JSON.stringify(payload)
  ].join('\n');
}

function normalizeDiagnostic(parsed, fallback) {
  const actions = Array.isArray(parsed.recommendedActions)
    ? parsed.recommendedActions.map(String).filter(Boolean)
    : fallback.recommendedActions;
  const urgent = Array.isArray(parsed.urgentInterventions)
    ? parsed.urgentInterventions.map(String).filter(Boolean)
    : (fallback.urgentInterventions || actions.slice(0, 3));
  return {
    teacherReport: String(parsed.teacherReport || fallback.teacherReport),
    parentReport: String(parsed.parentReport || fallback.parentReport),
    learnerProfile: String(parsed.learnerProfile || fallback.learnerProfile || ''),
    urgentInterventions: urgent,
    recommendedActions: actions,
    source: 'gemini'
  };
}

async function generateAiDiagnostic(classId, studentId) {
  const bundle = await getStudentAnalytics(classId, studentId);
  let diagnostic = ruleBasedDiagnostic(bundle);

  if (isGeminiConfigured()) {
    try {
      const ai = await askGemini(diagnosticPrompt(bundle), {
        temperature: 0.45,
        maxOutputTokens: 4096,
        systemInstruction:
          'You write evidence-based instructional analyses for teachers. ' +
          'Prefer concrete literacy/pedagogy moves over vague advice. Respond with JSON only.'
      });
      const text = String(ai.text || ai.answer || '');
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        diagnostic = normalizeDiagnostic(JSON.parse(m[0]), diagnostic);
      }
    } catch (e) {
      diagnostic.source = 'rules_fallback';
      diagnostic.aiError = e.message;
    }
  }

  // Persist essay + merge urgent interventions at the front of actions for sheet storage.
  const storedActions = []
    .concat(
      (diagnostic.urgentInterventions || []).map((a) => '[Urgent] ' + a),
      (diagnostic.recommendedActions || []).filter((a) =>
        !(diagnostic.urgentInterventions || []).includes(a)
      )
    )
    .slice(0, 12);

  const teacherBody = [
    diagnostic.learnerProfile ? ('Learner profile: ' + diagnostic.learnerProfile) : '',
    diagnostic.teacherReport
  ].filter(Boolean).join('\n\n');

  const saved = await saveIntervention({
    studentId,
    classId,
    status: bundle.status.status,
    rootCauses: bundle.status.rootCauses,
    teacherReport: teacherBody,
    parentReport: diagnostic.parentReport,
    recommendedActions: storedActions
  });

  return {
    student: bundle,
    diagnostic: Object.assign({}, diagnostic, {
      teacherReport: teacherBody,
      recommendedActions: storedActions,
      intervention: saved
    })
  };
}

module.exports = { generateAiDiagnostic, ruleBasedDiagnostic };
