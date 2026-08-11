const crypto = require('crypto');
const { LESSON_PLANS_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange } = require('../sheets');
const { getHolidaysForMonth } = require('../holiday');
const { getClassNameMap } = require('./teacherPortalService');
const { getTeacherLessonSlots } = require('./subjectAssignmentService');
const {
  listTeacherSubjectStyles,
  buildStyleLookup,
  resolveStyle,
  styleKey: subjectStyleKey
} = require('./subjectStyleService');
const {
  listEntries,
  resolveDay,
  getClassMeta
} = require('./schoolCalendarService');

function newPlanId() {
  return 'lp_' + crypto.randomBytes(6).toString('hex');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Load School_Calendar + KR holidays once for a month (shared with attendance).
 */
async function loadSchoolMonthContext(year, month, classIds) {
  const y = Number(year);
  const m = Number(month);
  const last = new Date(y, m, 0).getDate();
  const from = y + '-' + pad2(m) + '-01';
  const to = y + '-' + pad2(m) + '-' + pad2(last);
  const ids = Array.from(new Set((classIds || []).map(String).filter(Boolean)));
  const [entries, krHolidayMap, ...metas] = await Promise.all([
    listEntries({ from, to, includeInactive: false }),
    getHolidaysForMonth(y, m),
    ...ids.map((id) => getClassMeta(id))
  ]);
  const metaByClass = { '*': { allowedDays: [1, 2, 3, 4, 5], className: 'All' } };
  ids.forEach((id, i) => { metaByClass[id] = metas[i]; });
  return { entries, krHolidayMap, metaByClass, from, to };
}

async function resolveSchoolDay(ctx, classId, dateStr) {
  const id = String(classId || '*') || '*';
  const classMeta = ctx.metaByClass[id] || ctx.metaByClass['*'];
  return resolveDay(id, dateStr, {
    classMeta,
    entries: ctx.entries,
    krHolidayMap: ctx.krHolidayMap
  });
}

function schoolCellMeta(resolved) {
  const eventTitles = (resolved.events || []).map((e) => e.title).filter(Boolean);
  const blockingTitle = !resolved.isClassDay ? (resolved.title || '') : '';
  const holidayCompat = blockingTitle || resolved.krHoliday || '';
  let schoolCaption = holidayCompat;
  if (resolved.dayType === 'school_day' && resolved.title) {
    schoolCaption = resolved.title;
  } else if (resolved.isClassDay && eventTitles.length) {
    schoolCaption = eventTitles.join(', ');
  } else if (!schoolCaption && eventTitles.length) {
    schoolCaption = eventTitles.join(', ');
  }
  return {
    holiday: holidayCompat,
    schoolCaption: schoolCaption || '',
    dayType: resolved.dayType || '',
    isClassDay: !!resolved.isClassDay,
    schoolTitle: resolved.title || '',
    events: eventTitles,
    reason: resolved.reason || ''
  };
}

function planLessonDate(plan) {
  const d = String(plan.lessonDate || plan.weekStart || '').slice(0, 10);
  return d;
}

function slotKey(classId, subject, lessonDate) {
  return String(classId) + '|' + String(subject) + '|' + String(lessonDate);
}

function subjectStyle(subject, classId, styleLookup) {
  if (styleLookup && classId) {
    return resolveStyle(
      classId,
      subject,
      styleLookup.customMap,
      styleLookup.defaultIndexMap
    );
  }
  const subjects = [String(subject || 'General')];
  const defaultIndexMap = { [subjectStyleKey(classId || 'all', subject)]: 0 };
  const sorted = subjects.sort();
  sorted.forEach((s, idx) => {
    defaultIndexMap[subjectStyleKey(classId || 'all', s)] = idx;
  });
  return resolveStyle(classId || 'all', subject, {}, defaultIndexMap);
}

function rowToPlan(row) {
  if (!row || !row[0]) return null;
  const lessonDate = String(row[14] || row[4] || '').slice(0, 10);
  return {
    planId: String(row[0]),
    teacherId: String(row[1]),
    classId: String(row[2]),
    subject: String(row[3]),
    weekStart: String(row[4] || '').slice(0, 10),
    lessonDate,
    title: String(row[5] || ''),
    objectives: String(row[6] || ''),
    materials: String(row[7] || ''),
    procedure: String(row[8] || ''),
    homework: String(row[9] || ''),
    status: String(row[10] || 'Draft'),
    submittedAt: String(row[11] || ''),
    createdAt: String(row[12] || ''),
    updatedAt: String(row[13] || ''),
    etc: String(row[15] || '')
  };
}

async function ensureLessonPlanColumns() {
  if (ensureLessonPlanColumns.done) return;
  const data = await getSheetRows(LESSON_PLANS_SHEET);
  if (!data.length) return;
  const header = (data[0] || []).map((c) => String(c || '').trim());
  const needed = ['LessonDate', 'Etc'];
  const missing = needed.filter((h) => !header.includes(h));
  if (!missing.length) {
    ensureLessonPlanColumns.done = true;
    return;
  }
  const newHeader = header.concat(missing);
  while (newHeader.length < 16) newHeader.push('');
  await updateRange(LESSON_PLANS_SHEET, 'A1:P1', [newHeader]);
  ensureLessonPlanColumns.done = true;
}
ensureLessonPlanColumns.done = false;

async function getTeacherClassSlots(teacherId, filterClassId) {
  return getTeacherLessonSlots(teacherId, filterClassId || '');
}

function buildMonthWeeks(year, month) {
  const y = Number(year);
  const m = Number(month);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);

  const start = new Date(first);
  const startDow = start.getDay();
  start.setDate(start.getDate() + (startDow === 0 ? -6 : 1 - startDow));

  const end = new Date(last);
  const endDow = end.getDay();
  if (endDow === 6) end.setDate(end.getDate() - 1);
  else if (endDow === 0) end.setDate(end.getDate() - 2);
  else if (endDow < 5) end.setDate(end.getDate() + (5 - endDow));

  const weeks = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const weekCells = [];
    for (let w = 0; w < 5; w++) {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + w);
      const inMonth = d.getMonth() === m - 1;
      const dateStr = inMonth
        ? y + '-' + String(m).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
        : '';
      weekCells.push({
        dateStr,
        dayNum: d.getDate(),
        inMonth,
        month: d.getMonth() + 1
      });
    }
    weeks.push(weekCells);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function indexPlans(plans) {
  const map = {};
  for (const p of plans) {
    const date = planLessonDate(p);
    if (!date) continue;
    map[slotKey(p.classId, p.subject, date)] = p;
  }
  return map;
}

async function listLessonPlans(teacherId, classId) {
  await ensureLessonPlanColumns();
  const rows = await getSheetRows(LESSON_PLANS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (teacherId && String(rows[i][1]) !== String(teacherId)) continue;
    if (classId && String(rows[i][2]) !== String(classId)) continue;
    const plan = rowToPlan(rows[i]);
    if (plan) out.push(plan);
  }
  out.sort((a, b) => planLessonDate(b).localeCompare(planLessonDate(a)));
  return out;
}

async function listAllLessonPlans(filters) {
  await ensureLessonPlanColumns();
  const { teacherId, classId, year, month } = filters || {};
  const monthPrefix = year && month
    ? Number(year) + '-' + String(Number(month)).padStart(2, '0')
    : '';
  const rows = await getSheetRows(LESSON_PLANS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (teacherId && String(rows[i][1]) !== String(teacherId)) continue;
    if (classId && String(rows[i][2]) !== String(classId)) continue;
    const plan = rowToPlan(rows[i]);
    if (!plan) continue;
    if (monthPrefix && !planLessonDate(plan).startsWith(monthPrefix)) continue;
    out.push(plan);
  }
  out.sort((a, b) => planLessonDate(a).localeCompare(planLessonDate(b)));
  return out;
}

async function getLessonPlan(planId) {
  await ensureLessonPlanColumns();
  const rows = await getSheetRows(LESSON_PLANS_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(planId)) continue;
    return rowToPlan(rows[i]);
  }
  return null;
}

async function findPlanRowIndex(teacherId, classId, subject, lessonDate) {
  const rows = await getSheetRows(LESSON_PLANS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(teacherId)) continue;
    if (String(rows[i][2]) !== String(classId)) continue;
    if (String(rows[i][3]) !== String(subject)) continue;
    const plan = rowToPlan(rows[i]);
    if (planLessonDate(plan) === lessonDate) return i + 1;
  }
  return -1;
}

async function saveLessonPlan(teacherId, payload) {
  await ensureLessonPlanColumns();
  const now = new Date().toISOString();
  const rows = await getSheetRows(LESSON_PLANS_SHEET, { skipCache: true });
  const lessonDate = String(payload.lessonDate || payload.weekStart || '').slice(0, 10);
  if (!lessonDate) throw new Error('Lesson date is required.');

  let planId = payload.planId ? String(payload.planId) : '';
  let foundRow = -1;

  if (planId) {
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === planId) {
        foundRow = i + 1;
        break;
      }
    }
  } else {
    foundRow = await findPlanRowIndex(
      teacherId,
      String(payload.classId),
      String(payload.subject || ''),
      lessonDate
    );
    if (foundRow > 0) planId = String(rows[foundRow - 1][0]);
  }

  if (!planId) planId = newPlanId();

  const status = payload.submit ? 'Submitted' : String(payload.status || 'Draft');
  const submittedAt = payload.submit ? now : (payload.submittedAt || '');
  const row = [
    planId,
    teacherId,
    String(payload.classId),
    String(payload.subject || ''),
    lessonDate,
    String(payload.title || ''),
    String(payload.objectives || ''),
    String(payload.materials || ''),
    String(payload.procedure || ''),
    String(payload.homework || ''),
    status,
    submittedAt,
    foundRow > 0 ? String(rows[foundRow - 1][12] || now) : now,
    now,
    lessonDate,
    String(payload.etc || '')
  ];

  if (foundRow > 0) {
    await updateRange(LESSON_PLANS_SHEET, `A${foundRow}:P${foundRow}`, [row]);
  } else {
    await appendRows(LESSON_PLANS_SHEET, [row]);
  }
  return rowToPlan(row);
}

async function buildCalendarDays(year, month, classSlots, planMap, opts) {
  const { includeEmptySlots, teacherMeta, styleLookup, schoolCtx, badgeClassId } = opts || {};
  const weeks = buildMonthWeeks(year, month);
  const subjectStyles = {};
  const badgeId = badgeClassId || '*';

  for (const slot of classSlots) {
    subjectStyles[styleLookup
      ? slot.classId + '|' + slot.subject
      : slot.subject] = subjectStyle(slot.subject, slot.classId, styleLookup);
  }

  const outWeeks = [];
  for (const week of weeks) {
    const outWeek = [];
    for (const cell of week) {
      if (!cell.inMonth || !cell.dateStr) {
        outWeek.push({
          ...cell,
          holiday: '',
          schoolCaption: '',
          dayType: '',
          isClassDay: false,
          events: [],
          slots: []
        });
        continue;
      }

      const badgeResolved = await resolveSchoolDay(schoolCtx, badgeId, cell.dateStr);
      const meta = schoolCellMeta(badgeResolved);
      const daySlots = [];

      for (const slot of classSlots) {
        const resolved = await resolveSchoolDay(schoolCtx, slot.classId, cell.dateStr);
        const key = slotKey(slot.classId, slot.subject, cell.dateStr);
        const plan = planMap[key] || null;
        // Hide empty slots on non-class days; keep existing plans visible for edit.
        if (!resolved.isClassDay && !plan) continue;
        if (!includeEmptySlots && !plan) continue;

        daySlots.push({
          slotKey: key,
          classId: slot.classId,
          className: slot.className,
          subject: slot.subject,
          lessonDate: cell.dateStr,
          style: subjectStyle(slot.subject, slot.classId, styleLookup),
          isClassDay: !!resolved.isClassDay,
          plan: plan ? {
            planId: plan.planId,
            title: plan.title,
            status: plan.status,
            hasContent: !!(plan.title || plan.objectives || plan.procedure || plan.homework || plan.etc)
          } : null,
          teacherId: teacherMeta ? teacherMeta.teacherId : undefined,
          teacherName: teacherMeta ? teacherMeta.teacherName : undefined
        });
      }

      daySlots.sort((a, b) => a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject));
      outWeek.push({ ...cell, ...meta, slots: daySlots });
    }
    outWeeks.push(outWeek);
  }

  return { weeks: outWeeks, subjectStyles };
}

async function getLessonCalendar(teacherId, year, month, classId) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) throw new Error('year and month are required.');

  const classSlots = await getTeacherClassSlots(teacherId, classId || '');
  const plans = await listLessonPlans(teacherId, classId || '');
  const planMap = indexPlans(plans);
  const customStyles = await listTeacherSubjectStyles(teacherId);
  const styleBundle = buildStyleLookup(classSlots, customStyles);
  const styleLookup = {
    customMap: customStyles,
    defaultIndexMap: styleBundle.defaultIndexMap
  };

  const schoolCtx = await loadSchoolMonthContext(
    y,
    m,
    classSlots.map((s) => s.classId).concat(classId ? [classId] : [])
  );

  const subjectsByClass = {};
  classSlots.forEach((slot) => {
    if (!subjectsByClass[slot.classId]) subjectsByClass[slot.classId] = [];
    if (!subjectsByClass[slot.classId].includes(slot.subject)) {
      subjectsByClass[slot.classId].push(slot.subject);
    }
  });

  const { weeks, subjectStyles } = await buildCalendarDays(
    y, m, classSlots, planMap,
    {
      includeEmptySlots: true,
      styleLookup,
      schoolCtx,
      badgeClassId: classId || '*'
    }
  );

  return {
    year: y,
    month: m,
    weeks,
    subjectStyles,
    classSlots,
    subjectsByClass,
    subjectStylePalette: styleBundle.palette,
    customSubjectStyles: customStyles,
    schoolCalendarLinked: true
  };
}

async function getAdminLessonCalendar(year, month, filters) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) throw new Error('year and month are required.');

  const { teacherId, classId } = filters || {};
  const classNames = await getClassNameMap();

  const { listTeachers } = require('./adminService');
  const teachers = await listTeachers();
  const teacherMap = {};
  teachers.forEach((t) => { teacherMap[t.teacherId] = t; });

  let teacherIds = teachers.map((t) => t.teacherId);
  if (teacherId) teacherIds = teacherIds.filter((id) => id === teacherId);

  const allPlans = await listAllLessonPlans({ teacherId, classId, year: y, month: m });
  const planMap = indexPlans(allPlans);
  const slotRegistry = new Map();

  for (const tid of teacherIds) {
    const teacher = teacherMap[tid];
    if (!teacher) continue;
    const classSlots = await getTeacherClassSlots(tid, classId || '');
    for (const slot of classSlots) {
      const regKey = slot.classId + '|' + slot.subject;
      if (!slotRegistry.has(regKey)) {
        slotRegistry.set(regKey, { ...slot, teachers: [] });
      }
      slotRegistry.get(regKey).teachers.push({
        teacherId: tid,
        teacherName: teacher.displayName || teacher.name
      });
    }
  }

  const adminSlots = Array.from(slotRegistry.values());
  const styleBundle = buildStyleLookup(adminSlots, {});
  const styleLookup = { customMap: {}, defaultIndexMap: styleBundle.defaultIndexMap };
  const subjectStyles = {};
  adminSlots.forEach((slot) => {
    subjectStyles[subjectStyleKey(slot.classId, slot.subject)] =
      subjectStyle(slot.subject, slot.classId, styleLookup);
  });

  const schoolCtx = await loadSchoolMonthContext(
    y,
    m,
    adminSlots.map((s) => s.classId).concat(classId ? [classId] : [])
      .concat(allPlans.map((p) => p.classId))
  );

  const weeks = buildMonthWeeks(y, m);
  const outWeeks = [];
  for (const week of weeks) {
    const outWeek = [];
    for (const cell of week) {
      if (!cell.inMonth || !cell.dateStr) {
        outWeek.push({
          ...cell,
          holiday: '',
          schoolCaption: '',
          dayType: '',
          isClassDay: false,
          events: [],
          slots: []
        });
        continue;
      }

      const badgeResolved = await resolveSchoolDay(schoolCtx, classId || '*', cell.dateStr);
      const meta = schoolCellMeta(badgeResolved);
      const daySlots = [];

      for (const plan of allPlans) {
        const date = planLessonDate(plan);
        if (date !== cell.dateStr) continue;
        if (teacherId && plan.teacherId !== teacherId) continue;
        if (classId && plan.classId !== classId) continue;

        const teacher = teacherMap[plan.teacherId];
        const classResolved = await resolveSchoolDay(schoolCtx, plan.classId, cell.dateStr);
        daySlots.push({
          slotKey: slotKey(plan.classId, plan.subject, date),
          classId: plan.classId,
          className: classNames[plan.classId] || plan.classId,
          subject: plan.subject,
          lessonDate: date,
          isClassDay: !!classResolved.isClassDay,
          style: subjectStyles[subjectStyleKey(plan.classId, plan.subject)] ||
            subjectStyle(plan.subject, plan.classId, styleLookup),
          teacherId: plan.teacherId,
          teacherName: teacher ? (teacher.displayName || teacher.name) : plan.teacherId,
          plan: {
            planId: plan.planId,
            title: plan.title,
            status: plan.status,
            hasContent: !!(plan.title || plan.objectives || plan.procedure || plan.homework || plan.etc)
          }
        });
      }

      daySlots.sort((a, b) => a.teacherName.localeCompare(b.teacherName) || a.className.localeCompare(b.className));
      outWeek.push({ ...cell, ...meta, slots: daySlots });
    }
    outWeeks.push(outWeek);
  }

  return {
    year: y,
    month: m,
    weeks: outWeeks,
    subjectStyles,
    teachers: teachers.map((t) => ({ teacherId: t.teacherId, name: t.name })),
    schoolCalendarLinked: true
  };
}

module.exports = {
  listLessonPlans,
  listAllLessonPlans,
  getLessonPlan,
  saveLessonPlan,
  getLessonCalendar,
  getAdminLessonCalendar,
  ensureLessonPlanColumns,
  subjectStyle,
  planLessonDate
};
