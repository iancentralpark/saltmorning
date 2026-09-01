const {
  CLASS_LIST_SHEET,
  CLASS_TEACHERS_SHEET,
  TEACHER_LIST_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows } = require('../sheets');

function parseHomeroomClassIds(raw) {
  return String(raw || '')
    .split(/[,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeHomeroomClassIds(ids) {
  const seen = new Set();
  const out = [];
  (ids || []).forEach((id) => {
    const v = String(id || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out.join(', ');
}

function homeroomEntry(classId, names) {
  return {
    classId,
    className: names[classId] || classId,
    assignmentType: 'Homeroom',
    subjects: ['All'],
    isHomeroom: true
  };
}

async function getClassNameMap() {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    if (id) map[id] = String(rows[i][1] || id);
  }
  return map;
}

async function getTeacherProfile(teacherId) {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(teacherId)) continue;
    const fullName = String(rows[i][1] || '');
    let preferredName = '';
    let displayName = fullName;
    try {
      const { getTeacherProfileRecord, teacherDisplayName } = require('./teacherRegistryService');
      const tp = await getTeacherProfileRecord(teacherId, { skipEnsure: true });
      preferredName = String((tp && tp.preferredName) || '').trim();
      displayName = teacherDisplayName(fullName, preferredName);
    } catch (_) { /* keep full name */ }
    const homeroomClassIds = parseHomeroomClassIds(rows[i][4]);
    return {
      teacherId: String(rows[i][0]),
      name: displayName,
      fullName,
      preferredName,
      displayName,
      homeroomClassId: homeroomClassIds[0] || '',
      homeroomClassIds,
      staffRole: String(rows[i][5] || 'Teacher')
    };
  }
  return null;
}

async function getTeacherClasses(teacherId) {
  teacherId = String(teacherId);
  const names = await getClassNameMap();
  const teacher = await getTeacherProfile(teacherId);
  if (!teacher) throw new Error('Teacher not found.');

  const homeroom = [];
  const assigned = [];
  const seenHomeroom = new Set();
  const seenAssigned = new Set();

  parseHomeroomClassIds(teacher.homeroomClassIds.join(', ')).forEach((classId) => {
    const key = classId + ':Homeroom';
    if (seenHomeroom.has(key)) return;
    seenHomeroom.add(key);
    homeroom.push(homeroomEntry(classId, names));
  });

  const assignRows = await getSheetRows(CLASS_TEACHERS_SHEET);
  for (let i = 1; i < assignRows.length; i++) {
    if (String(assignRows[i][1]) !== teacherId) continue;
    const classId = String(assignRows[i][0] || '');
    const assignmentType = String(assignRows[i][2] || 'Subject');
    const subject = String(assignRows[i][3] || '').trim();

    if (assignmentType === 'Homeroom') {
      const key = classId + ':Homeroom';
      if (!seenHomeroom.has(key)) {
        seenHomeroom.add(key);
        homeroom.push(homeroomEntry(classId, names));
      }
      continue;
    }

    const key = classId + ':' + assignmentType + ':' + subject;
    if (seenAssigned.has(key)) continue;
    seenAssigned.add(key);

    assigned.push({
      classId,
      className: names[classId] || classId,
      assignmentType,
      subjects: subject ? [subject] : [],
      isHomeroom: false
    });
  }

  return { teacher, homeroom, assigned };
}

async function isHomeroomOfClass(teacherId, classId) {
  const { homeroom } = await getTeacherClasses(teacherId);
  return homeroom.some((e) => String(e.classId) === String(classId));
}

async function getHomeroomTeacherId(classId) {
  classId = String(classId || '').trim();
  if (!classId) return '';

  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    const teacherId = String(rows[i][0] || '').trim();
    if (!teacherId) continue;
    const ids = parseHomeroomClassIds(rows[i][4]);
    if (ids.includes(classId)) return teacherId;
  }

  const assignRows = await getSheetRows(CLASS_TEACHERS_SHEET);
  for (let i = 1; i < assignRows.length; i++) {
    if (String(assignRows[i][0] || '').trim() !== classId) continue;
    if (String(assignRows[i][2] || '').trim().toLowerCase() !== 'homeroom') continue;
    const teacherId = String(assignRows[i][1] || '').trim();
    if (teacherId) return teacherId;
  }
  return '';
}

async function getClassRoster(classId) {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  const students = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) !== String(classId)) continue;
    if (String(rows[i][3] || '').trim() !== 'Enrolled') continue;
    students.push({
      studentId: String(rows[i][0]),
      name: String(rows[i][1] || '')
    });
  }
  students.sort((a, b) => a.name.localeCompare(b.name));
  return students;
}

module.exports = {
  parseHomeroomClassIds,
  serializeHomeroomClassIds,
  getTeacherClasses,
  getClassRoster,
  getClassNameMap,
  getTeacherProfile,
  isHomeroomOfClass,
  getHomeroomTeacherId
};
