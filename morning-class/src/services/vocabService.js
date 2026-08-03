const crypto = require('crypto');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');
const { applyDollarAdjustment } = require('./dollarService');

const WORDS_SHEET = 'Vocab_Words';
const STATE_SHEET = 'Vocab_Student_State';
const REVIEW_SHEET = 'Vocab_Reviews';

const WORD_HEADERS = ['WordID', 'Word', 'Grade', 'Definition', 'Korean', 'Example', 'Distractors'];
const STATE_HEADERS = [
  'StudentID', 'ClassID', 'GradeLevel', 'Tier', 'PlacementDone',
  'Streak', 'LastActive', 'WordsMastered', 'QuestDate', 'QuestDone', 'SessionsToday'
];
const REVIEW_HEADERS = ['ReviewID', 'StudentID', 'WordID', 'Correct', 'At', 'SessionDate', 'Kind'];

const DAILY_TARGET = 5;
const MAX_SESSIONS = 3;
const QUEST_REWARD = 1;
const PLACEMENT_COUNT = 8;

const TIERS = [
  { min: 1, name: 'Rookie' },
  { min: 3, name: 'Iron' },
  { min: 5, name: 'Bronze' },
  { min: 7, name: 'Silver' },
  { min: 9, name: 'Gold' },
  { min: 11, name: 'Platinum' }
];

const SEED_WORDS = [
  ['happy', 2, 'feeling joy', '행복한', 'I feel happy today.', 'sad|angry|tired'],
  ['brave', 3, 'showing courage', '용감한', 'The brave firefighter saved the cat.', 'scared|lazy|quiet'],
  ['ancient', 5, 'very old', '고대의', 'They found an ancient coin.', 'modern|tiny|soft'],
  ['curious', 4, 'eager to learn or know', '호기심 많은', 'She is curious about space.', 'bored|rude|sleepy'],
  ['generous', 5, 'happy to give to others', '관대한', 'He was generous with his time.', 'selfish|angry|noisy'],
  ['fragile', 6, 'easy to break', '깨지기 쉬운', 'Handle the fragile glass carefully.', 'strong|heavy|loud'],
  ['predict', 6, 'to say what will happen', '예측하다', 'Can you predict the weather?', 'forget|carry|hide'],
  ['evidence', 7, 'facts that prove something', '증거', 'The detective looked for evidence.', 'opinion|joke|noise'],
  ['analyze', 8, 'to examine carefully', '분석하다', 'Please analyze the results.', 'ignore|copy|guess'],
  ['persist', 8, 'to continue despite difficulty', '끈기 있게 하다', 'If you persist, you will improve.', 'quit|sleep|hide'],
  ['vivid', 7, 'bright and clear', '생생한', 'She has a vivid imagination.', 'dull|empty|slow'],
  ['reluctant', 9, 'not wanting to do something', '마지못한', 'He was reluctant to speak.', 'eager|happy|loud'],
  ['ambiguous', 10, 'having more than one meaning', '모호한', 'The message was ambiguous.', 'clear|short|funny'],
  ['meticulous', 11, 'very careful about details', '꼼꼼한', 'She is meticulous in her notes.', 'careless|lazy|quick'],
  ['benevolent', 10, 'kind and helpful', '자비로운', 'A benevolent neighbor helped us.', 'cruel|noisy|tiny'],
  ['scarce', 6, 'not enough; rare', '부족한', 'Water was scarce in the desert.', 'plenty|cheap|sweet'],
  ['adapt', 5, 'to change to fit a new situation', '적응하다', 'Animals adapt to their habitat.', 'refuse|break|hide'],
  ['contrast', 7, 'a clear difference', '대조', 'There is a contrast between night and day.', 'same|copy|pair'],
  ['observe', 4, 'to watch carefully', '관찰하다', 'Observe the moon with a telescope.', 'ignore|throw|sing'],
  ['precise', 8, 'exact and accurate', '정확한', 'Give a precise answer.', 'vague|late|soft'],
  ['humble', 5, 'not proud; modest', '겸손한', 'She remained humble after winning.', 'arrogant|angry|loud'],
  ['thrive', 7, 'to grow or do well', '번성하다', 'Plants thrive in sunlight.', 'fail|shrink|hide'],
  ['omit', 6, 'to leave out', '생략하다', 'Do not omit your name on the form.', 'include|write|add'],
  ['durable', 6, 'lasting a long time', '내구성 있는', 'This bag is durable.', 'fragile|wet|thin'],
  ['inspire', 5, 'to fill with motivation', '영감을 주다', 'Teachers inspire students.', 'bore|scare|stop']
];

function todaySeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function tierForGrade(grade) {
  let name = 'Rookie';
  for (const t of TIERS) {
    if (grade >= t.min) name = t.name;
  }
  return name;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

async function ensureVocabSheets() {
  await ensureSheet(WORDS_SHEET, WORD_HEADERS);
  await ensureSheet(STATE_SHEET, STATE_HEADERS);
  await ensureSheet(REVIEW_SHEET, REVIEW_HEADERS);
  const words = await getSheetRows(WORDS_SHEET);
  if (words.length <= 1) {
    const rows = SEED_WORDS.map((w) => [
      'w_' + w[0].toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      w[0], String(w[1]), w[2], w[3], w[4], w[5]
    ]);
    await appendRows(WORDS_SHEET, rows);
    invalidateSheetRowsCache(WORDS_SHEET);
  }
}

function parseWord(row) {
  return {
    wordId: String(row[0] || ''),
    word: String(row[1] || ''),
    grade: Number(row[2]) || 1,
    definition: String(row[3] || ''),
    korean: String(row[4] || ''),
    example: String(row[5] || ''),
    distractors: String(row[6] || '').split('|').map((s) => s.trim()).filter(Boolean)
  };
}

async function listAllWords() {
  await ensureVocabSheets();
  const rows = await getSheetRows(WORDS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    out.push(parseWord(rows[i]));
  }
  return out;
}

function blankState(studentId, classId) {
  return {
    studentId: String(studentId),
    classId: String(classId || ''),
    gradeLevel: 4,
    tier: 'Iron',
    placementDone: false,
    streak: 0,
    lastActive: '',
    wordsMastered: 0,
    questDate: '',
    questDone: false,
    sessionsToday: 0,
    rowIndex: -1
  };
}

async function getStudentState(studentId, classId) {
  await ensureVocabSheets();
  const rows = await getSheetRows(STATE_SHEET);
  const sid = String(studentId);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== sid) continue;
    const today = todaySeoul();
    const questDate = String(rows[i][8] || '');
    return {
      studentId: sid,
      classId: String(rows[i][1] || classId || ''),
      gradeLevel: Number(rows[i][2]) || 4,
      tier: String(rows[i][3] || '') || tierForGrade(Number(rows[i][2]) || 4),
      placementDone: String(rows[i][4] || '').toUpperCase() === 'TRUE',
      streak: Number(rows[i][5]) || 0,
      lastActive: String(rows[i][6] || ''),
      wordsMastered: Number(rows[i][7]) || 0,
      questDate,
      questDone: questDate === today && String(rows[i][9] || '').toUpperCase() === 'TRUE',
      sessionsToday: questDate === today ? (Number(rows[i][10]) || 0) : 0,
      rowIndex: i + 1
    };
  }
  return blankState(studentId, classId);
}

function stateToRow(st) {
  return [
    st.studentId,
    st.classId,
    String(st.gradeLevel),
    st.tier || tierForGrade(st.gradeLevel),
    st.placementDone ? 'TRUE' : 'FALSE',
    String(st.streak || 0),
    st.lastActive || '',
    String(st.wordsMastered || 0),
    st.questDate || '',
    st.questDone ? 'TRUE' : 'FALSE',
    String(st.sessionsToday || 0)
  ];
}

async function saveStudentState(st) {
  await ensureVocabSheets();
  const row = stateToRow(st);
  if (st.rowIndex > 0) {
    await updateRange(STATE_SHEET, `A${st.rowIndex}:K${st.rowIndex}`, [row]);
  } else {
    await appendRows(STATE_SHEET, [row]);
  }
  invalidateSheetRowsCache(STATE_SHEET);
  return getStudentState(st.studentId, st.classId);
}

function buildMcItem(word, pool) {
  const wrong = shuffle(
    pool.filter((w) => w.wordId !== word.wordId).map((w) => w.definition)
      .concat(word.distractors)
  ).slice(0, 3);
  const choices = shuffle([word.definition].concat(wrong));
  return {
    wordId: word.wordId,
    word: word.word,
    prompt: 'What does "' + word.word + '" mean?',
    choices,
    // correctIndex only used server-side when scoring; strip for client in quiz payload
    _answer: word.definition,
    korean: word.korean,
    example: word.example
  };
}

async function getStudentVocabSummary(studentId, classId) {
  const state = await getStudentState(studentId, classId);
  const words = await listAllWords();
  return {
    available: true,
    placementDone: state.placementDone,
    gradeLevel: state.gradeLevel,
    tier: state.tier,
    streak: state.streak,
    wordsMastered: state.wordsMastered,
    questDone: state.questDone,
    sessionsToday: state.sessionsToday,
    maxSessions: MAX_SESSIONS,
    dailyTarget: DAILY_TARGET,
    bankSize: words.length,
    message: state.placementDone
      ? (state.questDone ? 'Daily quest complete!' : 'Ready for today’s quest.')
      : 'Take the placement test to start Vocab Booster.'
  };
}

const placementSessions = new Map();
const questSessions = new Map();

async function startPlacement(studentId, classId) {
  const state = await getStudentState(studentId, classId);
  if (state.placementDone) {
    return { alreadyDone: true, state: await getStudentVocabSummary(studentId, classId) };
  }
  const words = await listAllWords();
  const picked = shuffle(words).slice(0, Math.min(PLACEMENT_COUNT, words.length));
  const items = picked.map((w) => {
    const item = buildMcItem(w, words);
    return {
      wordId: item.wordId,
      word: item.word,
      prompt: item.prompt,
      choices: item.choices
    };
  });
  placementSessions.set(String(studentId), {
    answers: Object.fromEntries(picked.map((w) => [w.wordId, w.definition])),
    classId: String(classId || ''),
    wordIds: picked.map((w) => w.wordId)
  });
  return { items, count: items.length };
}

async function submitPlacement(studentId, classId, responses) {
  const sess = placementSessions.get(String(studentId));
  const words = await listAllWords();
  const byId = {};
  words.forEach((w) => { byId[w.wordId] = w; });

  let correct = 0;
  let gradeSum = 0;
  let answered = 0;
  const list = Array.isArray(responses) ? responses : [];
  for (const r of list) {
    const wid = String(r.wordId || '');
    const word = byId[wid];
    if (!word) continue;
    answered++;
    const ok = String(r.choice || '').trim() === word.definition;
    if (ok) {
      correct++;
      gradeSum += word.grade;
    } else {
      gradeSum += Math.max(1, word.grade - 2);
    }
    await appendRows(REVIEW_SHEET, [[
      newId('rev'), studentId, wid, ok ? 'TRUE' : 'FALSE',
      new Date().toISOString(), todaySeoul(), 'placement'
    ]]);
  }
  invalidateSheetRowsCache(REVIEW_SHEET);

  const avg = answered ? gradeSum / answered : 4;
  const gradeLevel = Math.max(2, Math.min(11, Math.round(avg)));
  let state = await getStudentState(studentId, classId);
  state.classId = String(classId || state.classId);
  state.gradeLevel = gradeLevel;
  state.tier = tierForGrade(gradeLevel);
  state.placementDone = true;
  state.lastActive = todaySeoul();
  state = await saveStudentState(state);
  placementSessions.delete(String(studentId));

  return {
    correct,
    total: answered,
    gradeLevel,
    tier: state.tier,
    summary: await getStudentVocabSummary(studentId, classId)
  };
}

async function startDailyQuest(studentId, classId) {
  let state = await getStudentState(studentId, classId);
  if (!state.placementDone) throw new Error('Complete placement first.');
  const today = todaySeoul();
  if (state.questDate !== today) {
    state.questDate = today;
    state.questDone = false;
    state.sessionsToday = 0;
  }
  if (state.questDone) throw new Error('Daily quest already complete.');
  if (state.sessionsToday >= MAX_SESSIONS) throw new Error('Session limit reached for today.');

  const words = await listAllWords();
  const near = words.filter((w) => Math.abs(w.grade - state.gradeLevel) <= 2);
  const pool = near.length >= DAILY_TARGET ? near : words;
  const study = shuffle(pool).slice(0, DAILY_TARGET);
  const quiz = study.map((w) => {
    const item = buildMcItem(w, words);
    return { wordId: item.wordId, word: item.word, prompt: item.prompt, choices: item.choices };
  });

  questSessions.set(String(studentId), {
    wordIds: study.map((w) => w.wordId),
    answers: Object.fromEntries(study.map((w) => [w.wordId, w.definition])),
    classId: String(classId || '')
  });

  state.sessionsToday += 1;
  state.lastActive = today;
  await saveStudentState(state);

  return {
    study: study.map((w) => ({
      wordId: w.wordId,
      word: w.word,
      definition: w.definition,
      korean: w.korean,
      example: w.example
    })),
    quiz,
    target: DAILY_TARGET
  };
}

async function submitDailyQuest(studentId, classId, responses) {
  const sess = questSessions.get(String(studentId));
  if (!sess) throw new Error('Start the daily quest first.');
  const words = await listAllWords();
  const byId = {};
  words.forEach((w) => { byId[w.wordId] = w; });

  let correct = 0;
  const list = Array.isArray(responses) ? responses : [];
  for (const r of list) {
    const wid = String(r.wordId || '');
    const word = byId[wid];
    if (!word) continue;
    const ok = String(r.choice || '').trim() === word.definition;
    if (ok) correct++;
    await appendRows(REVIEW_SHEET, [[
      newId('rev'), studentId, wid, ok ? 'TRUE' : 'FALSE',
      new Date().toISOString(), todaySeoul(), 'quest'
    ]]);
  }
  invalidateSheetRowsCache(REVIEW_SHEET);

  let state = await getStudentState(studentId, classId);
  const passed = correct >= Math.ceil(DAILY_TARGET * 0.6);
  let reward = 0;
  if (passed) {
    state.questDone = true;
    state.questDate = todaySeoul();
    state.streak = (state.lastActive === todaySeoul() || !state.streak) ? (state.streak || 0) + 1 : 1;
    // streak logic: if continuing from yesterday
    // simpler: always +1 on pass
    state.wordsMastered = (state.wordsMastered || 0) + correct;
    state.lastActive = todaySeoul();
    if (correct / Math.max(1, list.length) >= 0.8 && state.gradeLevel < 11) {
      state.gradeLevel += 1;
      state.tier = tierForGrade(state.gradeLevel);
    }
    state = await saveStudentState(state);
    try {
      await applyDollarAdjustment(classId || state.classId, studentId, QUEST_REWARD, 'Vocab Booster daily quest');
      reward = QUEST_REWARD;
    } catch (e) { /* dollars optional */ }
  } else {
    state.lastActive = todaySeoul();
    await saveStudentState(state);
  }
  questSessions.delete(String(studentId));

  return {
    correct,
    total: list.length,
    passed,
    reward,
    summary: await getStudentVocabSummary(studentId, classId)
  };
}

async function getClassVocabOverview(classId) {
  await ensureVocabSheets();
  const roster = await getClassRoster(classId);
  const students = [];
  for (const s of roster) {
    const st = await getStudentState(s.studentId, classId);
    students.push({
      studentId: s.studentId,
      name: s.name,
      placementDone: st.placementDone,
      gradeLevel: st.gradeLevel,
      tier: st.tier,
      streak: st.streak,
      questDone: st.questDone,
      wordsMastered: st.wordsMastered,
      lastActive: st.lastActive
    });
  }
  return { students, dailyTarget: DAILY_TARGET };
}

async function overrideStudentVocab(studentId, classId, opts) {
  let state = await getStudentState(studentId, classId);
  state.classId = String(classId || state.classId);
  if (opts.gradeLevel != null) {
    state.gradeLevel = Math.max(1, Math.min(12, Number(opts.gradeLevel) || state.gradeLevel));
    state.tier = tierForGrade(state.gradeLevel);
  }
  if (opts.resetPlacement) {
    state.placementDone = false;
    state.questDone = false;
  }
  if (opts.placementDone === true) state.placementDone = true;
  state = await saveStudentState(state);
  return getStudentVocabSummary(studentId, classId);
}

async function getRecentVocabActivity(limit) {
  await ensureVocabSheets();
  const rows = await getSheetRows(REVIEW_SHEET);
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    items.push({
      at: String(rows[i][4] || ''),
      studentId: String(rows[i][1] || ''),
      wordId: String(rows[i][2] || ''),
      correct: String(rows[i][3] || '').toUpperCase() === 'TRUE',
      kind: String(rows[i][6] || '')
    });
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return items.slice(0, limit || 50);
}

module.exports = {
  ensureVocabSheets,
  getStudentVocabSummary,
  startPlacement,
  submitPlacement,
  startDailyQuest,
  submitDailyQuest,
  getClassVocabOverview,
  overrideStudentVocab,
  getRecentVocabActivity,
  listAllWords
};
