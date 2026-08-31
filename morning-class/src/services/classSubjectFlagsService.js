'use strict';

const { CLASS_SUBJECT_FLAGS_SHEET } = require('../config');
const {
  getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache
} = require('../sheets');

const HEADERS = ['ClassID', 'Subject', 'ExcludeFromReport', 'UpdatedBy', 'UpdatedAt'];

function parseBool(val) {
  const s = String(val == null ? '' : val).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(s);
}

async function ensureClassSubjectFlagsSheet() {
  await ensureSheet(CLASS_SUBJECT_FLAGS_SHEET, HEADERS);
}

async function listClassSubjectFlags(classId) {
  await ensureClassSubjectFlagsSheet();
  const rows = await getSheetRows(CLASS_SUBJECT_FLAGS_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (classId && String(rows[i][0]) !== String(classId)) continue;
    const subject = String(rows[i][1] || '').trim();
    if (!subject) continue;
    map[subject] = {
      subject,
      excludeFromReport: parseBool(rows[i][2]),
      updatedBy: String(rows[i][3] || ''),
      updatedAt: String(rows[i][4] || ''),
      _row: i + 1
    };
  }
  return map;
}

async function listExcludedReportSubjects(classId) {
  const flags = await listClassSubjectFlags(classId);
  return new Set(
    Object.keys(flags).filter((subject) => flags[subject].excludeFromReport)
  );
}

async function setExcludeFromReport(classId, subject, exclude, teacherId) {
  await ensureClassSubjectFlagsSheet();
  classId = String(classId || '').trim();
  subject = String(subject || '').trim();
  if (!classId || !subject) throw new Error('Class and subject are required.');

  const flags = await listClassSubjectFlags(classId);
  const existing = flags[subject];
  const now = new Date().toISOString();
  const row = [
    classId,
    subject,
    exclude ? 'TRUE' : 'FALSE',
    String(teacherId || ''),
    now
  ];

  const data = await getSheetRows(CLASS_SUBJECT_FLAGS_SHEET, { skipCache: true });
  let found = existing && existing._row ? existing._row : 0;
  if (!found) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== classId) continue;
      if (String(data[i][1] || '').trim() !== subject) continue;
      found = i + 1;
      break;
    }
  }

  if (found > 0) {
    await updateRange(CLASS_SUBJECT_FLAGS_SHEET, `A${found}:E${found}`, [row]);
  } else {
    await appendRows(CLASS_SUBJECT_FLAGS_SHEET, [row]);
  }
  invalidateSheetRowsCache(CLASS_SUBJECT_FLAGS_SHEET);
  return { classId, subject, excludeFromReport: !!exclude };
}

module.exports = {
  ensureClassSubjectFlagsSheet,
  listClassSubjectFlags,
  listExcludedReportSubjects,
  setExcludeFromReport
};
