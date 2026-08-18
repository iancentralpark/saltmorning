'use strict';

const { getActiveSchoolSemester, getSchoolSemester } = require('./schoolSemesterService');

function normalizeSemesterKey(key) {
  return String(key == null ? '' : key).trim();
}

/**
 * Resolve which timetable "film" admin is editing.
 * Empty key = live/current semester (legacy untagged rows + active key).
 */
async function resolvePlanningScope(requestedKey) {
  const requested = normalizeSemesterKey(requestedKey);
  const active = await getActiveSchoolSemester();
  let semester = null;
  if (requested) {
    semester = await getSchoolSemester(requested);
    if (!semester) {
      throw Object.assign(new Error('Semester not found.'), { status: 400 });
    }
  } else {
    semester = active;
  }
  const key = semester ? semester.key : '';
  const live = !semester || !active || semester.key === active.key;
  return {
    key,
    live,
    semester: semester || null,
    active: active || null
  };
}

function stampKey(scope) {
  if (!scope) return '';
  if (scope.live) return scope.active ? scope.active.key : (scope.key || '');
  return scope.key || '';
}

/**
 * Read filter: future = exact key only.
 * Live prefers rows stamped with the active key; if none exist, fall back to
 * untagged legacy rows so current timetables keep working before first save.
 */
function keysForRead(items, getKey, scope) {
  const list = items || [];
  if (!scope || scope.live) {
    const activeKey = scope && scope.active ? scope.active.key : (scope && scope.key) || '';
    if (activeKey) {
      const matching = list.filter((item) => normalizeSemesterKey(getKey(item)) === activeKey);
      if (matching.length) return matching;
    }
    return list.filter((item) => !normalizeSemesterKey(getKey(item)));
  }
  return list.filter((item) => normalizeSemesterKey(getKey(item)) === scope.key);
}

function entryInReadScope(entry, scope) {
  return keysForRead([entry], (e) => e && e.semesterKey, scope).length === 1;
}

/**
 * Write replace: future = exact key.
 * Live replaces untagged rows plus the active key so a save migrates legacy data.
 */
function keyShouldReplace(entryKey, scope) {
  const ek = normalizeSemesterKey(entryKey);
  if (!scope || scope.live) {
    const activeKey = scope && scope.active ? scope.active.key : (scope && scope.key) || '';
    return !ek || (activeKey && ek === activeKey) || (scope && scope.key && ek === scope.key);
  }
  return ek === scope.key;
}

module.exports = {
  normalizeSemesterKey,
  resolvePlanningScope,
  stampKey,
  keysForRead,
  entryInReadScope,
  keyShouldReplace
};
