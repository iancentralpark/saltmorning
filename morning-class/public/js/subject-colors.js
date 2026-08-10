/**
 * Shared pastel subject colors for every timetable surface.
 * When classId is provided, colors key off class + subject so the same
 * subject in different classes gets distinct colors.
 * Matches server SUBJECT_PALETTE / named defaults in subjectStyleService.
 */
(function (global) {
  const PALETTE = [
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

  /** Stable pastels for common subjects (and break-like periods) when no classId. */
  const NAMED = {
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

  function normalizeKey(subject) {
    return String(subject || '')
      .toLowerCase()
      .replace(/[_/\\|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hashKey(str) {
    const s = String(str || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function lookupNamed(key) {
    if (!key) return null;
    if (NAMED[key]) return NAMED[key];
    const aliases = Object.keys(NAMED);
    for (let i = 0; i < aliases.length; i++) {
      const a = aliases[i];
      if (key === a || key.indexOf(a) !== -1 || a.indexOf(key) !== -1) return NAMED[a];
    }
    return null;
  }

  function paletteAt(index) {
    return PALETTE[Math.abs(index) % PALETTE.length];
  }

  /**
   * @param {string} subject
   * @param {{ isBreak?: boolean, break?: boolean, classId?: string }} [opts]
   */
  function forSubject(subject, opts) {
    opts = opts || {};
    const key = normalizeKey(subject);
    if (opts.isBreak || opts.break) {
      return Object.assign({ subject: subject || 'Break' }, NAMED.break);
    }

    const classId = String(opts.classId || '').trim();
    // Class-aware: same subject in different classes → different pastel.
    if (classId) {
      const preset = paletteAt(hashKey(classId + '|' + key));
      return { subject: subject || '', classId: classId, bg: preset.bg, border: preset.border };
    }

    const named = lookupNamed(key);
    if (named) return Object.assign({ subject: subject || '' }, named);
    const preset = paletteAt(hashKey(key));
    return { subject: subject || '', bg: preset.bg, border: preset.border };
  }

  function inlineStyle(subject, opts) {
    const c = forSubject(subject, opts);
    return 'background:' + c.bg + ';border-left-color:' + c.border + ';border-color:' + c.border + ';';
  }

  function chipStyle(subject, opts) {
    const c = forSubject(subject, opts);
    return 'background:' + c.bg + ';border-left:3px solid ' + c.border + ';';
  }

  global.SaltSubjectColors = {
    PALETTE: PALETTE,
    NAMED: NAMED,
    forSubject: forSubject,
    inlineStyle: inlineStyle,
    chipStyle: chipStyle,
    normalizeKey: normalizeKey
  };
})(window);
