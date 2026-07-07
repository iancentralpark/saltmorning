const {
  CLASS_LIST_SHEET,
  CLASS_TEACHERS_SHEET,
  TEACHER_LIST_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows } = require('../sheets');

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
    return {
      teacherId: String(rows[i][0]),
      name: String(rows[i][1] || ''),
      homeroomClassId: String(rows[i][4] || '').trim(),
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
  const seen = new Set();

  if (teacher.homeroomClassId) {
    homeroom.push({
      classId: teacher.homeroomClassId,
      className: names[teacher.homeroomClassId] || teacher.homeroomClassId,
      assignmentType: 'Homeroom',
      subjects: ['All']
    });
    seen.add(teacher.homeroomClassId + ':Homeroom');
  }

  const assignRows = await getSheetRows(CLASS_TEACHERS_SHEET);
  for (let i = 1; i < assignRows.length; i++) {
    if (String(assignRows[i][1]) !== teacherId) continue;
    const classId = String(assignRows[i][0] || '');
    const assignmentType = String(assignRows[i][2] || 'Subject');
    const subject = String(assignRows[i][3] || '').trim();
    const key = classId + ':' + assignmentType + ':' + subject;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry = {
      classId,
      className: names[classId] || classId,
      assignmentType,
      subjects: subject ? [subject] : []
    };

    if (assignmentType === 'Homeroom' && teacher.homeroomClassId === classId) continue;
    assigned.push(entry);
  }

  return { teacher, homeroom, assigned };
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

module.exports = { getTeacherClasses, getClassRoster, getClassNameMap, getTeacherProfile };
