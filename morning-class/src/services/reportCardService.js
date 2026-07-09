const {
  REPORT_CARD_FIELDS_SHEET,
  REPORT_CARD_ENTRIES_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange } = require('../sheets');
const crypto = require('crypto');

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

async function listReportCardFields(classId, term) {
  const rows = await getSheetRows(REPORT_CARD_FIELDS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId) && String(rows[i][1]) !== '*') continue;
    if (term && String(rows[i][2]) !== String(term)) continue;
    out.push({
      fieldId: String(rows[i][0]),
      classId: String(rows[i][1]),
      term: String(rows[i][2]),
      subject: String(rows[i][3]),
      fieldKey: String(rows[i][4]),
      label: String(rows[i][5]),
      sortOrder: Number(rows[i][6]) || 0,
      maxScore: Number(rows[i][7]) || 100
    });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return out;
}

async function listReportCardEntries(classId, term, studentId, subjectFilter) {
  const rows = await getSheetRows(REPORT_CARD_ENTRIES_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId)) continue;
    if (term && String(rows[i][3]) !== String(term)) continue;
    if (studentId && String(rows[i][2]) !== String(studentId)) continue;
    if (subjectFilter && String(rows[i][4]) !== String(subjectFilter)) continue;
    out.push({
      entryId: String(rows[i][0]),
      classId: String(rows[i][1]),
      studentId: String(rows[i][2]),
      term: String(rows[i][3]),
      subject: String(rows[i][4]),
      fieldKey: String(rows[i][5]),
      score: rows[i][6] === '' ? null : Number(rows[i][6]),
      comment: String(rows[i][7] || ''),
      teacherId: String(rows[i][8] || ''),
      updatedAt: String(rows[i][9] || '')
    });
  }
  return out;
}

async function saveReportCardEntries(classId, term, subject, teacherId, entries) {
  const data = await getSheetRows(REPORT_CARD_ENTRIES_SHEET);
  const now = new Date().toISOString();
  const appends = [];

  for (const e of entries) {
    const studentId = String(e.studentId);
    const fieldKey = String(e.fieldKey);
    let found = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) !== String(classId)) continue;
      if (String(data[i][2]) !== studentId) continue;
      if (String(data[i][3]) !== String(term)) continue;
      if (String(data[i][4]) !== String(subject)) continue;
      if (String(data[i][5]) !== fieldKey) continue;
      found = i + 1;
      break;
    }
    const row = [
      found > 0 ? String(data[found - 1][0]) : newId('rc'),
      classId,
      studentId,
      term,
      subject,
      fieldKey,
      e.score == null ? '' : Number(e.score),
      String(e.comment || ''),
      teacherId,
      now
    ];
    if (found > 0) {
      await updateRange(REPORT_CARD_ENTRIES_SHEET, `A${found}:J${found}`, [row]);
    } else {
      appends.push(row);
    }
  }

  if (appends.length) await appendRows(REPORT_CARD_ENTRIES_SHEET, appends);
  return { saved: entries.length };
}

function buildReportCardSummary(students, fields, entries) {
  return students.map((student) => {
    const studentEntries = entries.filter((e) => e.studentId === student.studentId);
    const bySubject = {};
    for (const field of fields) {
      if (!bySubject[field.subject]) bySubject[field.subject] = [];
      const match = studentEntries.find(
        (e) => e.subject === field.subject && e.fieldKey === field.fieldKey
      );
      bySubject[field.subject].push({
        label: field.label,
        fieldKey: field.fieldKey,
        maxScore: field.maxScore,
        score: match ? match.score : null,
        comment: match ? match.comment : ''
      });
    }
    return { studentId: student.studentId, name: student.name, subjects: bySubject };
  });
}

module.exports = {
  listReportCardFields,
  listReportCardEntries,
  saveReportCardEntries,
  buildReportCardSummary
};
