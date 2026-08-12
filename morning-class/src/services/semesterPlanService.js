const crypto = require('crypto');
const { SEMESTER_PLANS_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet } = require('../sheets');
const { getHolidaysForRange } = require('../holiday');
const { listEntries, resolveDay, getClassMeta } = require('./schoolCalendarService');
const { getActiveTerm, listGradeTerms } = require('./gradeWeightService');
const {
  listTeacherSubjectPrefs,
  resolveTeachingDays,
  periodsPerWeekFromTimetable,
  isHidden
} = require('./subjectPrefsService');
const { assertTeacherClassAccess, listTeacherSubjectGroups } = require('./subjectAssignmentService');

const HEADERS = [
  'PlanID', 'TeacherID', 'ClassID', 'Subject', 'TermLabel', 'WeekIndex',
  'WeekStart', 'WeekEnd', 'WeekLabel', 'Content', 'Objective',
  'PeriodsPerWeek', 'TeachingDays', 'UpdatedAt'
];

const EXAM_MIDTERM = /mid\s*-?\s*term|중간|중간고사/i;
const EXAM_FINAL = /final|기말|기말고사/i;

function newPlanId() {
  return 'sp_' + crypto.randomBytes(6).toString('hex');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

async function ensureSemesterPlansSheet() {
  await ensureSheet(SEMESTER_PLANS_SHEET, HEADERS);
}

function parsePlanRow(row) {
  return {
    planId: String(row[0] || ''),
    teacherId: String(row[1] || ''),
    classId: String(row[2] || ''),
    subject: String(row[3] || '').trim(),
    termLabel: String(row[4] || ''),
    weekIndex: Number(row[5]) || 0,
    weekStart: String(row[6] || '').slice(0, 10),
    weekEnd: String(row[7] || '').slice(0, 10),
    weekLabel: String(row[8] || ''),
    content: String(row[9] || ''),
    objective: String(row[10] || ''),
    periodsPerWeek: Number(row[11]) || 0,
    teachingDays: String(row[12] || ''),
    updatedAt: String(row[13] || '')
  };
}

function examLabelForTitles(titles) {
  const joined = (titles || []).join(' ');
  if (EXAM_MIDTERM.test(joined)) return 'Midterm';
  if (EXAM_FINAL.test(joined)) return 'Final';
  return '';
}

/**
 * Build instructional weeks for a class within a term.
 * Week 1 starts at the first Monday on/after term start that has a class day
 * (skipping leading vacation/break weeks).
 */
async function buildSemesterWeeks(classId, term) {
  if (!term || !term.startDate || !term.endDate) {
    throw new Error('Set term dates for this class first (Admin → Term dates).');
  }
  const start = term.startDate;
  const end = term.endDate;
  const [entries, krHolidayMap, classMeta] = await Promise.all([
    listEntries({ from: start, to: end, includeInactive: false }),
    getHolidaysForRange(start, end),
    getClassMeta(classId)
  ]);

  const weeks = [];
  let cursor = mondayOf(start);
  // Walk week by week through the term
  while (cursor <= end) {
    const weekStart = cursor;
    const weekEnd = addDays(weekStart, 4); // Fri
    const clampedStart = weekStart < start ? start : weekStart;
    const clampedEnd = weekEnd > end ? end : weekEnd;

    let classDayCount = 0;
    let breakOnly = true;
    const eventTitles = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = addDays(weekStart, d);
      if (dateStr < start || dateStr > end) continue;
      if (d > 4) continue; // Mon–Fri only for instructional check
      const resolved = resolveDay(classId, dateStr, {
        classMeta,
        entries,
        krHolidayMap
      });
      if (resolved.isClassDay) {
        classDayCount += 1;
        breakOnly = false;
      }
      if (resolved.dayType === 'break') {
        // stay breakOnly unless we also have a class day
      } else if (resolved.dayType !== 'holiday' && resolved.dayType !== 'break') {
        if (resolved.isClassDay) breakOnly = false;
      }
      (resolved.events || []).forEach((ev) => {
        if (ev.title) eventTitles.push(ev.title);
      });
      if (resolved.title && (resolved.dayType === 'event' || resolved.dayType === 'break')) {
        eventTitles.push(resolved.title);
      }
    }

    const exam = examLabelForTitles(eventTitles);
    weeks.push({
      weekStart: clampedStart,
      weekEnd: clampedEnd,
      monday: weekStart,
      classDayCount,
      isBreakWeek: breakOnly || classDayCount === 0,
      examLabel: exam,
      eventTitles: Array.from(new Set(eventTitles))
    });
    cursor = addDays(weekStart, 7);
  }

  // Drop leading break/vacation weeks → Week 1 after vacation
  let firstIdx = weeks.findIndex((w) => !w.isBreakWeek);
  if (firstIdx < 0) firstIdx = 0;

  const numbered = [];
  let weekIndex = 0;
  for (let i = firstIdx; i < weeks.length; i++) {
    const w = weeks[i];
    if (w.isBreakWeek && !w.examLabel) {
      // trailing / mid-term breaks: still show but without advancing? User asked Week after vacation.
      // Keep mid-semester break weeks in the plan with a Break label, but don't count as Week N.
      numbered.push({
        weekIndex: null,
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        weekLabel: 'Break',
        isBreakWeek: true,
        isExamWeek: false,
        examLabel: '',
        classDayCount: w.classDayCount
      });
      continue;
    }
    weekIndex += 1;
    let weekLabel = 'Week ' + weekIndex;
    if (w.examLabel === 'Midterm') weekLabel = 'Week ' + weekIndex + ' · Midterm';
    if (w.examLabel === 'Final') weekLabel = 'Week ' + weekIndex + ' · Final';
    numbered.push({
      weekIndex,
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      weekLabel,
      isBreakWeek: !!w.isBreakWeek,
      isExamWeek: !!w.examLabel,
      examLabel: w.examLabel || '',
      classDayCount: w.classDayCount
    });
  }

  return {
    term: {
      termId: term.termId,
      classId: term.classId,
      label: term.label,
      startDate: term.startDate,
      endDate: term.endDate
    },
    totalWeeks: weekIndex,
    weeks: numbered
  };
}

async function resolveTerm(classId, termLabel) {
  if (termLabel) {
    const terms = await listGradeTerms(classId);
    const found = terms.find((t) => t.label === termLabel);
    if (!found) throw new Error('Term not found for this class.');
    return found;
  }
  const active = await getActiveTerm(classId);
  if (!active) throw new Error('No term dates set for this class. Ask Admin to set Term dates.');
  return active;
}

async function getSemesterPlanMeta(teacherId, classId, subject, termLabel) {
  await assertTeacherClassAccess(teacherId, classId);
  const term = await resolveTerm(classId, termLabel);
  const prefs = await listTeacherSubjectPrefs(teacherId);
  if (isHidden(prefs, classId, subject)) {
    throw new Error('This subject is hidden from your lesson list.');
  }
  const teachingDays = await resolveTeachingDays(teacherId, classId, subject, prefs);
  let periodsPerWeek = await periodsPerWeekFromTimetable(teacherId, classId, subject);
  if (!periodsPerWeek) periodsPerWeek = teachingDays.length || 0;
  const built = await buildSemesterWeeks(classId, term);
  return {
    ...built,
    classId: String(classId),
    subject: String(subject),
    teachingDays,
    periodsPerWeek
  };
}

async function listSemesterPlanRows(teacherId, classId, subject, termLabel) {
  await ensureSemesterPlansSheet();
  const rows = await getSheetRows(SEMESTER_PLANS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const p = parsePlanRow(rows[i]);
    if (teacherId && p.teacherId !== String(teacherId)) continue;
    if (classId && p.classId !== String(classId)) continue;
    if (subject && p.subject !== String(subject)) continue;
    if (termLabel && p.termLabel !== String(termLabel)) continue;
    out.push(p);
  }
  out.sort((a, b) => a.weekIndex - b.weekIndex);
  return out;
}

async function getSemesterPlan(teacherId, classId, subject, termLabel) {
  const meta = await getSemesterPlanMeta(teacherId, classId, subject, termLabel);
  const saved = await listSemesterPlanRows(teacherId, classId, subject, meta.term.label);
  const byWeek = {};
  saved.forEach((r) => { byWeek[r.weekIndex] = r; });

  const rows = meta.weeks.map((w) => {
    const existing = w.weekIndex != null ? byWeek[w.weekIndex] : null;
    return {
      weekIndex: w.weekIndex,
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      weekLabel: w.weekLabel,
      isBreakWeek: w.isBreakWeek,
      isExamWeek: w.isExamWeek,
      examLabel: w.examLabel,
      content: existing ? existing.content : '',
      objective: existing ? existing.objective : '',
      planId: existing ? existing.planId : ''
    };
  });

  return {
    term: meta.term,
    classId: meta.classId,
    subject: meta.subject,
    totalWeeks: meta.totalWeeks,
    periodsPerWeek: meta.periodsPerWeek,
    teachingDays: meta.teachingDays,
    rows
  };
}

async function saveSemesterPlan(teacherId, payload) {
  await ensureSemesterPlansSheet();
  const classId = String(payload.classId || '').trim();
  const subject = String(payload.subject || '').trim();
  if (!classId || !subject) throw new Error('Class and subject are required.');
  await assertTeacherClassAccess(teacherId, classId);

  const meta = await getSemesterPlanMeta(teacherId, classId, subject, payload.termLabel);
  const termLabel = meta.term.label;
  const incoming = Array.isArray(payload.rows) ? payload.rows : [];
  const byWeek = {};
  incoming.forEach((r) => {
    const wi = Number(r.weekIndex);
    if (!wi) return;
    byWeek[wi] = {
      content: String(r.content || ''),
      objective: String(r.objective || '')
    };
  });

  const existing = await listSemesterPlanRows(teacherId, classId, subject, termLabel);
  const existingByWeek = {};
  const sheetRows = await getSheetRows(SEMESTER_PLANS_SHEET, { skipCache: true });
  const rowIndexByPlanId = {};
  for (let i = 1; i < sheetRows.length; i++) {
    if (sheetRows[i][0]) rowIndexByPlanId[String(sheetRows[i][0])] = i + 1;
  }
  existing.forEach((r) => { existingByWeek[r.weekIndex] = r; });

  const now = new Date().toISOString();
  const teachingDaysJson = JSON.stringify(meta.teachingDays || []);
  const savedRows = [];

  for (const w of meta.weeks) {
    if (w.weekIndex == null) continue;
    const data = byWeek[w.weekIndex] || { content: '', objective: '' };
    const prev = existingByWeek[w.weekIndex];
    const planId = (prev && prev.planId) || newPlanId();
    const row = [
      planId,
      teacherId,
      classId,
      subject,
      termLabel,
      w.weekIndex,
      w.weekStart,
      w.weekEnd,
      w.weekLabel,
      data.content,
      data.objective,
      meta.periodsPerWeek,
      teachingDaysJson,
      now
    ];
    const sheetRow = rowIndexByPlanId[planId];
    if (sheetRow) {
      await updateRange(SEMESTER_PLANS_SHEET, `A${sheetRow}:N${sheetRow}`, [row]);
    } else {
      await appendRows(SEMESTER_PLANS_SHEET, [row]);
    }
    savedRows.push(parsePlanRow(row));
  }

  return {
    ok: true,
    term: meta.term,
    classId,
    subject,
    totalWeeks: meta.totalWeeks,
    periodsPerWeek: meta.periodsPerWeek,
    teachingDays: meta.teachingDays,
    rows: savedRows
  };
}

async function listAdminSemesterPlans({ teacherId, classId, termLabel } = {}) {
  await ensureSemesterPlansSheet();
  const rows = await listSemesterPlanRows(teacherId || '', classId || '', '', termLabel || '');
  // Group by teacher|class|subject|term
  const groups = {};
  rows.forEach((r) => {
    const key = [r.teacherId, r.classId, r.subject, r.termLabel].join('|');
    if (!groups[key]) {
      groups[key] = {
        teacherId: r.teacherId,
        classId: r.classId,
        subject: r.subject,
        termLabel: r.termLabel,
        periodsPerWeek: r.periodsPerWeek,
        weeks: []
      };
    }
    groups[key].weeks.push(r);
  });
  return { plans: Object.values(groups) };
}

async function listTeacherSemesterSubjects(teacherId) {
  const groups = await listTeacherSubjectGroups(teacherId);
  const prefs = await listTeacherSubjectPrefs(teacherId);
  const out = [];
  (groups.classes || []).forEach((c) => {
    (c.subjects || []).forEach((s) => {
      if (isHidden(prefs, c.classId, s)) return;
      out.push({
        classId: c.classId,
        className: c.className,
        subject: s,
        isHomeroom: !!c.isHomeroom
      });
    });
  });
  return { subjects: out };
}

module.exports = {
  ensureSemesterPlansSheet,
  buildSemesterWeeks,
  getSemesterPlanMeta,
  getSemesterPlan,
  saveSemesterPlan,
  listAdminSemesterPlans,
  listTeacherSemesterSubjects
};
