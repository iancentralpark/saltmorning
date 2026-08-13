'use strict';

/**
 * Faculty/Staff portal permissions.
 * Admin (Admin_List) is always superuser (*). Faculty store a permission list.
 */

const ADMIN_PERMS = [
  { key: 'admin.monitor', label: 'Monitor' },
  { key: 'admin.lessons', label: 'Lessons' },
  { key: 'admin.faculty', label: 'Faculty' },
  { key: 'admin.classes', label: 'Classes' },
  { key: 'admin.students', label: 'Students' },
  { key: 'admin.transcript', label: 'Official Transcript' },
  { key: 'admin.analytics', label: 'Analytics' },
  { key: 'admin.timetables', label: 'Timetables' },
  { key: 'admin.schoolCal', label: 'Calendar' },
  { key: 'admin.bus', label: 'Bus' },
  { key: 'admin.consents', label: 'Consents' },
  { key: 'admin.announcements', label: 'News' },
  { key: 'admin.reportCards', label: 'Reports' },
  { key: 'admin.materials', label: 'Materials' },
  { key: 'admin.vocabPlatform', label: 'Vocab' }
];

const TEACHER_PERMS = [
  { key: 'teacher.home', label: 'Teacher home' },
  { key: 'teacher.classes', label: 'Class tools' },
  { key: 'teacher.lessonPlan', label: 'Lesson plan' },
  { key: 'teacher.materials', label: 'Material requests' },
  { key: 'teacher.students', label: 'Student registry' },
  { key: 'teacher.headReports', label: 'Head Teacher reports' }
];

const ALL_PERMS = ADMIN_PERMS.concat(TEACHER_PERMS);
const ALL_ADMIN_KEYS = ADMIN_PERMS.map((p) => p.key);
const ALL_TEACHER_KEYS = TEACHER_PERMS.map((p) => p.key);
const ALL_KEYS = ALL_PERMS.map((p) => p.key);

const STAFF_TITLES = [
  'Principal',
  'Vice Principal',
  'Dean',
  'Head Teacher',
  'Teacher',
  'Chaplain',
  'Admin Staff',
  'Librarian',
  'Nurse',
  'Head of Admin'
];

function uniq(list) {
  return Array.from(new Set((list || []).map((x) => String(x || '').trim()).filter(Boolean)));
}

function parsePermissions(raw) {
  if (Array.isArray(raw)) return uniq(raw).filter((k) => k === '*' || ALL_KEYS.includes(k));
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s === '*') return ['*'];
  try {
    if (s.charAt(0) === '[') {
      const parsed = JSON.parse(s);
      return parsePermissions(parsed);
    }
  } catch (_) { /* fall through */ }
  return uniq(s.split(/[,\s]+/)).filter((k) => k === '*' || ALL_KEYS.includes(k));
}

function serializePermissions(list) {
  const perms = parsePermissions(list);
  if (perms.includes('*')) return '*';
  return JSON.stringify(perms);
}

function presetsForTitle(title) {
  const t = String(title || '').trim().toLowerCase();
  if (t === 'principal' || t === 'vice principal' || t === 'head of admin') {
    return ALL_ADMIN_KEYS.slice();
  }
  if (t === 'dean') {
    return ALL_ADMIN_KEYS.filter((k) => k !== 'admin.vocabPlatform');
  }
  if (t === 'head teacher') {
    return [
      'teacher.home', 'teacher.classes', 'teacher.lessonPlan',
      'teacher.materials', 'teacher.students', 'teacher.headReports',
      'admin.reportCards', 'admin.announcements', 'admin.materials'
    ];
  }
  if (t === 'teacher') {
    return [
      'teacher.home', 'teacher.classes', 'teacher.lessonPlan',
      'teacher.materials', 'teacher.students'
    ];
  }
  if (t === 'chaplain' || t === 'librarian' || t === 'nurse') {
    return ['teacher.home', 'teacher.students', 'admin.announcements'];
  }
  if (t === 'admin staff') {
    return ['admin.bus', 'admin.announcements', 'admin.materials', 'admin.monitor'];
  }
  return ['teacher.home', 'teacher.classes'];
}

function normalizeTitle(title, legacyStaffRole) {
  const raw = String(title || legacyStaffRole || 'Teacher').trim();
  if (!raw) return 'Teacher';
  const hit = STAFF_TITLES.find((t) => t.toLowerCase() === raw.toLowerCase());
  if (hit) return hit;
  // Legacy Director → treat like Principal for title label; perms decided separately
  if (/^director$/i.test(raw)) return 'Principal';
  return raw;
}

function hasPermission(sessionOrPerms, ...keys) {
  const want = keys.filter(Boolean);
  if (!want.length) return true;
  let perms = [];
  if (sessionOrPerms && sessionOrPerms.role === 'admin') return true;
  if (Array.isArray(sessionOrPerms)) perms = sessionOrPerms;
  else if (sessionOrPerms && Array.isArray(sessionOrPerms.permissions)) perms = sessionOrPerms.permissions;
  else if (sessionOrPerms && sessionOrPerms.permissions === '*') return true;
  if (perms.includes('*')) return true;
  // Legacy principal with empty permissions = full admin portal
  if (sessionOrPerms && sessionOrPerms.role === 'principal' && !perms.length) return true;
  return want.some((k) => perms.includes(k));
}

function hasAnyAdminPermission(perms) {
  const list = parsePermissions(perms);
  if (list.includes('*')) return true;
  return list.some((k) => k.indexOf('admin.') === 0);
}

function hasAnyTeacherPermission(perms) {
  const list = parsePermissions(perms);
  if (list.includes('*')) return true;
  return list.some((k) => k.indexOf('teacher.') === 0);
}

/** Decide JWT role for a faculty row. */
function portalRoleForFaculty(title, permissions) {
  const t = String(title || '').toLowerCase();
  const perms = parsePermissions(permissions);
  const effective = perms.length ? perms : presetsForTitle(title);
  if (t === 'principal' || t === 'vice principal') return 'principal';
  // Classroom faculty stay on the teacher portal even if they hold a few admin keys.
  const classroom =
    effective.includes('teacher.classes') ||
    effective.includes('teacher.lessonPlan') ||
    effective.includes('teacher.headReports');
  if (classroom) return 'teacher';
  if (hasAnyAdminPermission(effective)) return 'staff';
  return 'teacher';
}

function catalog() {
  return {
    titles: STAFF_TITLES.slice(),
    adminPermissions: ADMIN_PERMS.slice(),
    teacherPermissions: TEACHER_PERMS.slice(),
    presets: STAFF_TITLES.reduce((acc, title) => {
      acc[title] = presetsForTitle(title);
      return acc;
    }, {})
  };
}

module.exports = {
  ADMIN_PERMS,
  TEACHER_PERMS,
  ALL_PERMS,
  ALL_ADMIN_KEYS,
  ALL_TEACHER_KEYS,
  STAFF_TITLES,
  parsePermissions,
  serializePermissions,
  presetsForTitle,
  normalizeTitle,
  hasPermission,
  hasAnyAdminPermission,
  hasAnyTeacherPermission,
  portalRoleForFaculty,
  catalog
};
