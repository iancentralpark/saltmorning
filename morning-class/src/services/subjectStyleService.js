const { TEACHER_SUBJECT_STYLES_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet } = require('../sheets');

const SUBJECT_PALETTE = [
  { bg: '#e8f2fa', border: '#8eb8dc', label: 'Blue' },
  { bg: '#e8f5ee', border: '#7fb89a', label: 'Green' },
  { bg: '#f5e8f2', border: '#d4a8c4', label: 'Pink' },
  { bg: '#faf0e8', border: '#e8b89a', label: 'Amber' },
  { bg: '#f0ebfa', border: '#a99bd4', label: 'Purple' },
  { bg: '#edf6fc', border: '#9ecae8', label: 'Cyan' },
  { bg: '#fceeed', border: '#e8a8a0', label: 'Coral' },
  { bg: '#f4efe9', border: '#b8b0a8', label: 'Sand' },
  { bg: '#e8f6f5', border: '#9ec9c4', label: 'Teal' },
  { bg: '#fbf3d9', border: '#d4c48a', label: 'Lemon' },
  { bg: '#eaf6e4', border: '#a8c894', label: 'Moss' },
  { bg: '#f8e8ec', border: '#d4a8b4', label: 'Rose' }
];

/** Soft pastels keyed by normalized subject name (shared with client subject-colors.js). */
const NAMED_SUBJECT_COLORS = {
  english: { bg: '#e3f0f9', border: '#9bbfd8' },
  ela: { bg: '#e3f0f9', border: '#9bbfd8' },
  reading: { bg: '#e3f0f9', border: '#9bbfd8' },
  math: { bg: '#fce8e0', border: '#e0b09a' },
  mathematics: { bg: '#fce8e0', border: '#e0b09a' },
  science: { bg: '#e3f5ec', border: '#9dc9b0' },
  'korean history': { bg: '#ede8f7', border: '#b8a8d4' },
  history: { bg: '#ede8f7', border: '#b8a8d4' },
  korean: { bg: '#f0e9f5', border: '#c4b0d8' },
  library: { bg: '#f5f0e6', border: '#c8bba8' },
  recess: { bg: '#fbf3d9', border: '#d4c48a' },
  lunch: { bg: '#f8e8ec', border: '#d4a8b4' },
  break: { bg: '#f0eef5', border: '#b8b0c8' },
  snack: { bg: '#fbf3d9', border: '#d4c48a' },
  art: { bg: '#f5e8f2', border: '#d4a8c4' },
  music: { bg: '#e8f6f5', border: '#9ec9c4' },
  pe: { bg: '#eaf6e4', border: '#a8c894' },
  'physical education': { bg: '#eaf6e4', border: '#a8c894' },
  sports: { bg: '#eaf6e4', border: '#a8c894' },
  homeroom: { bg: '#eef3ea', border: '#a3b18a' },
  advisory: { bg: '#eef3ea', border: '#a3b18a' },
  'social studies': { bg: '#edf6fc', border: '#9ecae8' },
  geography: { bg: '#edf6fc', border: '#9ecae8' },
  writing: { bg: '#e8f2fa', border: '#8eb8dc' },
  vocab: { bg: '#e8f2fa', border: '#8eb8dc' },
  vocabulary: { bg: '#e8f2fa', border: '#8eb8dc' }
};

function styleKey(classId, subject) {
  return String(classId) + '|' + String(subject);
}

function normalizeSubjectKey(subject) {
  return String(subject || '')
    .toLowerCase()
    .replace(/[_/\\|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashSubject(subject) {
  const str = normalizeSubjectKey(subject);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function hashStyleKey(classId, subject) {
  const str = String(classId || '').trim() + '|' + normalizeSubjectKey(subject);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function lookupNamedSubject(key) {
  if (!key) return null;
  if (NAMED_SUBJECT_COLORS[key]) return NAMED_SUBJECT_COLORS[key];
  const aliases = Object.keys(NAMED_SUBJECT_COLORS);
  for (let i = 0; i < aliases.length; i++) {
    const a = aliases[i];
    if (key === a || key.indexOf(a) !== -1 || a.indexOf(key) !== -1) {
      return NAMED_SUBJECT_COLORS[a];
    }
  }
  return null;
}

function defaultStyleForSubject(subject, classId) {
  const key = normalizeSubjectKey(subject);
  const cid = String(classId || '').trim();
  // Class-aware defaults so the same subject differs across classes.
  if (cid) {
    return defaultStyleForIndex(hashStyleKey(cid, key));
  }
  const named = lookupNamedSubject(key);
  if (named) return { bg: named.bg, border: named.border };
  return defaultStyleForIndex(hashSubject(subject));
}

function normalizeStyle(raw) {
  if (!raw) return null;
  const bg = String(raw.bg || raw.Bg || '').trim();
  const border = String(raw.border || raw.Border || '').trim();
  if (!bg || !border) return null;
  return { bg, border, subject: raw.subject };
}

async function ensureSubjectStylesSheet() {
  await ensureSheet(TEACHER_SUBJECT_STYLES_SHEET, [
    'TeacherID', 'ClassID', 'Subject', 'Bg', 'Border', 'UpdatedAt'
  ]);
}

async function listTeacherSubjectStyles(teacherId) {
  await ensureSubjectStylesSheet();
  const rows = await getSheetRows(TEACHER_SUBJECT_STYLES_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(teacherId)) continue;
    const classId = String(rows[i][1] || '').trim();
    const subject = String(rows[i][2] || '').trim();
    if (!classId || !subject) continue;
    const style = normalizeStyle({ bg: rows[i][3], border: rows[i][4], subject });
    if (style) map[styleKey(classId, subject)] = style;
  }
  return map;
}

function defaultStyleForIndex(index) {
  const preset = SUBJECT_PALETTE[Math.abs(index) % SUBJECT_PALETTE.length];
  return { bg: preset.bg, border: preset.border };
}

function buildDefaultStyleIndex(classSlots) {
  const keys = [];
  const seen = new Set();
  (classSlots || []).forEach((slot) => {
    const key = styleKey(slot.classId, slot.subject);
    if (seen.has(key)) return;
    seen.add(key);
    keys.push({ classId: slot.classId, subject: slot.subject, key });
  });
  keys.sort((a, b) => a.key.localeCompare(b.key));
  const indexMap = {};
  keys.forEach((entry, idx) => {
    indexMap[entry.key] = idx;
  });
  return indexMap;
}

function resolveStyle(classId, subject, customMap, defaultIndexMap) {
  const key = styleKey(classId, subject);
  if (customMap && customMap[key]) {
    return { subject, ...customMap[key] };
  }
  // Class + subject pastel so the same subject differs across classes.
  return { subject, ...defaultStyleForSubject(subject, classId) };
}

function buildStyleLookup(classSlots, customMap) {
  const defaultIndexMap = buildDefaultStyleIndex(classSlots);
  const bySubject = {};
  const byKey = {};

  (classSlots || []).forEach((slot) => {
    const key = styleKey(slot.classId, slot.subject);
    const style = resolveStyle(slot.classId, slot.subject, customMap, defaultIndexMap);
    byKey[key] = style;
    if (!bySubject[slot.subject]) bySubject[slot.subject] = style;
  });

  return { byKey, bySubject, defaultIndexMap, palette: SUBJECT_PALETTE };
}

async function saveTeacherSubjectStyle(teacherId, classId, subject, bg, border) {
  await ensureSubjectStylesSheet();
  classId = String(classId || '').trim();
  subject = String(subject || '').trim();
  bg = String(bg || '').trim();
  border = String(border || '').trim();
  if (!classId || !subject) throw new Error('Class and subject are required.');
  if (!bg || !border) throw new Error('Color is required.');

  const rows = await getSheetRows(TEACHER_SUBJECT_STYLES_SHEET, { skipCache: true });
  let foundRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(teacherId)) continue;
    if (String(rows[i][1]) !== classId) continue;
    if (String(rows[i][2]).trim() !== subject) continue;
    foundRow = i + 1;
    break;
  }

  const now = new Date().toISOString();
  const row = [teacherId, classId, subject, bg, border, now];
  if (foundRow > 0) {
    await updateRange(TEACHER_SUBJECT_STYLES_SHEET, `A${foundRow}:F${foundRow}`, [row]);
  } else {
    await appendRows(TEACHER_SUBJECT_STYLES_SHEET, [row]);
  }
  return { saved: true, style: { bg, border, subject } };
}

module.exports = {
  SUBJECT_PALETTE,
  NAMED_SUBJECT_COLORS,
  styleKey,
  listTeacherSubjectStyles,
  buildStyleLookup,
  resolveStyle,
  saveTeacherSubjectStyle,
  defaultStyleForIndex,
  defaultStyleForSubject
};
