const { LESSON_PLANS_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange } = require('../sheets');
const crypto = require('crypto');

function newPlanId() {
  return 'lp_' + crypto.randomBytes(6).toString('hex');
}

function rowToPlan(row) {
  if (!row || !row[0]) return null;
  return {
    planId: String(row[0]),
    teacherId: String(row[1]),
    classId: String(row[2]),
    subject: String(row[3]),
    weekStart: String(row[4]),
    title: String(row[5]),
    objectives: String(row[6] || ''),
    materials: String(row[7] || ''),
    procedure: String(row[8] || ''),
    homework: String(row[9] || ''),
    status: String(row[10] || 'Draft'),
    submittedAt: String(row[11] || ''),
    createdAt: String(row[12] || ''),
    updatedAt: String(row[13] || '')
  };
}

async function listLessonPlans(teacherId, classId) {
  const rows = await getSheetRows(LESSON_PLANS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (teacherId && String(rows[i][1]) !== String(teacherId)) continue;
    if (classId && String(rows[i][2]) !== String(classId)) continue;
    const plan = rowToPlan(rows[i]);
    if (plan) out.push(plan);
  }
  out.sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
  return out;
}

async function getLessonPlan(planId) {
  const rows = await getSheetRows(LESSON_PLANS_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(planId)) continue;
    return rowToPlan(rows[i]);
  }
  return null;
}

async function saveLessonPlan(teacherId, payload) {
  const now = new Date().toISOString();
  const rows = await getSheetRows(LESSON_PLANS_SHEET);
  const planId = payload.planId ? String(payload.planId) : newPlanId();
  let foundRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === planId) {
      foundRow = i + 1;
      break;
    }
  }

  const status = payload.submit ? 'Submitted' : String(payload.status || 'Draft');
  const submittedAt = payload.submit ? now : (payload.submittedAt || '');
  const row = [
    planId,
    teacherId,
    String(payload.classId),
    String(payload.subject || ''),
    String(payload.weekStart),
    String(payload.title || ''),
    String(payload.objectives || ''),
    String(payload.materials || ''),
    String(payload.procedure || ''),
    String(payload.homework || ''),
    status,
    submittedAt,
    foundRow > 0 ? String(rows[foundRow - 1][12] || now) : now,
    now
  ];

  if (foundRow > 0) {
    await updateRange(LESSON_PLANS_SHEET, `A${foundRow}:N${foundRow}`, [row]);
  } else {
    await appendRows(LESSON_PLANS_SHEET, [row]);
  }
  return rowToPlan(row);
}

module.exports = { listLessonPlans, getLessonPlan, saveLessonPlan };
