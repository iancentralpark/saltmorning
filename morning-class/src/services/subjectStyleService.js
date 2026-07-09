const { TEACHER_SUBJECT_STYLES_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet } = require('../sheets');

const SUBJECT_PALETTE = [
  { bg: '#e8f2fa', border: '#8eb8dc', label: 'Blue' },
  { bg: '#e8f5ee', border: '#7fb89a', label: 'Green' },
  { bg: '#f5e8f2', border: '#d4a8c4', label: 'Pink' },
  { bg: '#faf0e8', border: '#e8b89a', label: 'Amber' },
  { bg: '#f0ebfa', border: '#a99bd4', label: 'Purple' },
  { bg: '#edf6fc', border: '#9ecae8', label: 'Cyan' },
  { bg: '#fceeed', border: '#e8a8a0', label: 'Red' },
  { bg: '#f4efe9', border: '#b8b0a8', label: 'Gray' }
];

function styleKey(classId, subject) {
  return String(classId) + '|' + String(subject);
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
  const idx = defaultIndexMap && defaultIndexMap[key] != null ? defaultIndexMap[key] : 0;
  return { subject, ...defaultStyleForIndex(idx) };
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
  styleKey,
  listTeacherSubjectStyles,
  buildStyleLookup,
  resolveStyle,
  saveTeacherSubjectStyle,
  defaultStyleForIndex
};
