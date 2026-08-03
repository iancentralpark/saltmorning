/**
 * Mr. Park's Vocab Booster — Google Sheets backend (morning-class).
 * Matches vocab-learn.js API shapes (same contract as server Supabase path).
 */
const crypto = require('crypto');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');
const { applyDollarAdjustment } = require('./dollarService');
const {
  tierForGrade,
  scorePlacement,
  updateAbilityDetailed,
  shouldStopPlacement,
  nextTargetFreq,
  pickWeightedPlacementType,
  PLACEMENT_MAX,
  PLACEMENT_MIN,
  PLACEMENT_PICK_RADIUS,
  DEFAULT_PLACEMENT_START,
  GRADE_MIN,
  GRADE_MAX,
  formatPlacementLog
} = require('./vocabPlacementService');
const { buildClozePrompt } = require('./vocabClozeUtils');

const WORDS_SHEET = 'Vocab_Words';
const STATE_SHEET = 'Vocab_Student_State';
const PROGRESS_SHEET = 'Vocab_Student_Progress';
const REVIEW_SHEET = 'Vocab_Reviews';

const WORD_HEADERS = [
  'WordID', 'Word', 'Grade', 'Tier', 'Definition', 'Korean', 'Example',
  'Distractors', 'Synonyms', 'Antonyms'
];
const STATE_HEADERS = [
  'StudentID', 'ClassID', 'GradeLevel', 'Tier', 'PlacementDone',
  'PlacementAt', 'PlacementAccuracy', 'Streak', 'LongestStreak', 'LastActive',
  'WordsMastered', 'QuestDate', 'QuestDone', 'SessionsToday',
  'TestAttempts', 'TestScore', 'PromotionScore', 'ShieldCount'
];
const PROGRESS_HEADERS = [
  'StudentID', 'WordID', 'Box', 'CorrectCount', 'WrongCount', 'NextDueAt', 'UpdatedAt'
];
const REVIEW_HEADERS = [
  'ReviewID', 'StudentID', 'WordID', 'Correct', 'At', 'SessionDate', 'Kind'
];

const DAILY_TARGET = 10;
const PASS_THRESHOLD = 100;
const REWARD_TIER = 'Common';
const PROMOTE_AT = 400;
const DEMOTE_REENTRY_SCORE = 390;
const SHIELD_ITEMS_ON_PROMOTE = 30;
const SCORE_FIRST_CORRECT = 1.5;
const SCORE_FIRST_WRONG = -1.5;
const SCORE_RETRY_CORRECT = 1.5;
const SCORE_RETRY_WRONG = -0.8;
const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
const MAX_BOX = BOX_INTERVAL_DAYS.length - 1;

const DAILY_DOLLAR_BONUS_BY_TIER = {
  Rookie: 0.5,
  Iron: 0.5,
  Bronze: 1,
  Silver: 1,
  Gold: 1,
  Platinum: 2,
  Emerald: 2,
  Diamond: 2,
  Ascendant: 3,
  Master: 3,
  Grandmaster: 3,
  Legend: 5
};

/** [word, grade, definition, korean, example, distractors, synonyms?, antonyms?] */
const SEED_WORDS = [
  ['big', 1, 'large in size', '큰', 'The elephant is big.', 'small|tiny|thin', 'large|huge', 'small|tiny'],
  ['happy', 1, 'feeling joy', '행복한', 'I feel happy today.', 'sad|angry|tired', 'glad|joyful', 'sad|unhappy'],
  ['run', 1, 'to move fast on foot', '달리다', 'They run in the park.', 'walk|sit|sleep', 'sprint|dash', 'walk|crawl'],
  ['friend', 2, 'a person you like and trust', '친구', 'Sam is my best friend.', 'enemy|stranger|teacher', 'buddy|pal', 'enemy|foe'],
  ['brave', 2, 'showing courage', '용감한', 'The brave firefighter saved the cat.', 'scared|lazy|quiet', 'courageous|bold', 'afraid|timid'],
  ['quiet', 2, 'making little or no noise', '조용한', 'Please be quiet in the library.', 'loud|noisy|busy', 'silent|calm', 'loud|noisy'],
  ['curious', 3, 'eager to learn or know', '호기심 많은', 'She is curious about space.', 'bored|rude|sleepy', 'inquisitive|interested', 'bored|indifferent'],
  ['share', 3, 'to give part of something to others', '나누다', 'Please share the cookies.', 'keep|hide|steal', 'divide|give', 'hoard|keep'],
  ['carefully', 3, 'with attention and care', '조심스럽게', 'Carry the glass carefully.', 'carelessly|quickly|loudly', 'cautiously|gently', 'carelessly|recklessly'],
  ['observe', 4, 'to watch carefully', '관찰하다', 'Observe the moon with a telescope.', 'ignore|throw|sing', 'watch|notice', 'ignore|overlook'],
  ['adapt', 4, 'to change to fit a new situation', '적응하다', 'Animals adapt to their habitat.', 'refuse|break|hide', 'adjust|fit', 'resist|refuse'],
  ['generous', 4, 'happy to give to others', '관대한', 'He was generous with his time.', 'selfish|angry|noisy', 'kind|giving', 'selfish|stingy'],
  ['ancient', 5, 'very old', '고대의', 'They found an ancient coin.', 'modern|tiny|soft', 'old|historic', 'modern|new'],
  ['humble', 5, 'not proud; modest', '겸손한', 'She remained humble after winning.', 'arrogant|angry|loud', 'modest|meek', 'arrogant|proud'],
  ['inspire', 5, 'to fill with motivation', '영감을 주다', 'Teachers inspire students.', 'bore|scare|stop', 'motivate|encourage', 'discourage|demotivate'],
  ['fragile', 6, 'easy to break', '깨지기 쉬운', 'Handle the fragile glass carefully.', 'strong|heavy|loud', 'delicate|breakable', 'durable|strong'],
  ['predict', 6, 'to say what will happen', '예측하다', 'Can you predict the weather?', 'forget|carry|hide', 'forecast|foretell', 'guess randomly'],
  ['scarce', 6, 'not enough; rare', '부족한', 'Water was scarce in the desert.', 'plenty|cheap|sweet', 'rare|limited', 'abundant|plentiful'],
  ['omit', 6, 'to leave out', '생략하다', 'Do not omit your name on the form.', 'include|write|add', 'exclude|skip', 'include|add'],
  ['durable', 6, 'lasting a long time', '내구성 있는', 'This bag is durable.', 'fragile|wet|thin', 'sturdy|tough', 'fragile|weak'],
  ['evidence', 7, 'facts that prove something', '증거', 'The detective looked for evidence.', 'opinion|joke|noise', 'proof|clue', 'guess|rumor'],
  ['contrast', 7, 'a clear difference', '대조', 'There is a contrast between night and day.', 'same|copy|pair', 'difference|opposition', 'similarity|sameness'],
  ['thrive', 7, 'to grow or do well', '번성하다', 'Plants thrive in sunlight.', 'fail|shrink|hide', 'flourish|prosper', 'fail|wither'],
  ['vivid', 7, 'bright and clear', '생생한', 'She has a vivid imagination.', 'dull|empty|slow', 'bright|intense', 'dull|faint'],
  ['analyze', 8, 'to examine carefully', '분석하다', 'Please analyze the results.', 'ignore|copy|guess', 'examine|study', 'ignore|overlook'],
  ['persist', 8, 'to continue despite difficulty', '끈기 있게 하다', 'If you persist, you will improve.', 'quit|sleep|hide', 'continue|endure', 'quit|give up'],
  ['precise', 8, 'exact and accurate', '정확한', 'Give a precise answer.', 'vague|late|soft', 'exact|accurate', 'vague|approximate'],
  ['reluctant', 9, 'not wanting to do something', '마지못한', 'He was reluctant to speak.', 'eager|happy|loud', 'unwilling|hesitant', 'eager|willing'],
  ['ambiguous', 9, 'having more than one meaning', '모호한', 'The message was ambiguous.', 'clear|short|funny', 'unclear|vague', 'clear|definite'],
  ['elaborate', 9, 'detailed and carefully planned', '정교한', 'She gave an elaborate explanation.', 'simple|rough|quick', 'detailed|complex', 'simple|basic'],
  ['benevolent', 10, 'kind and helpful', '자비로운', 'A benevolent neighbor helped us.', 'cruel|noisy|tiny', 'kind|charitable', 'cruel|mean'],
  ['meticulous', 10, 'very careful about details', '꼼꼼한', 'She is meticulous in her notes.', 'careless|lazy|quick', 'thorough|precise', 'careless|sloppy'],
  ['pragmatic', 10, 'dealing with things sensibly', '실용적인', 'We need a pragmatic solution.', 'dreamy|angry|loud', 'practical|realistic', 'idealistic|impractical'],
  ['ephemeral', 11, 'lasting a very short time', '덧없는', 'Fame can be ephemeral.', 'permanent|solid|loud', 'fleeting|brief', 'permanent|lasting'],
  ['ubiquitous', 11, 'appearing everywhere', '어디에나 있는', 'Smartphones are ubiquitous today.', 'rare|hidden|local', 'everywhere|common', 'rare|scarce'],
  ['meticulousness', 11, 'extreme care about details', '꼼꼼함', 'His meticulousness impressed the judge.', 'carelessness|speed|noise', 'precision|care', 'carelessness'],
  ['quintessential', 12, 'the most perfect example of something', '전형의', 'She is the quintessential leader.', 'ordinary|rare|broken', 'typical|classic', 'atypical|unusual'],
  ['ineffable', 12, 'too great to be described in words', '형언할 수 없는', 'The view filled him with ineffable joy.', 'simple|loud|clear', 'indescribable|inexpressible', 'ordinary|plain'],
  ['perspicacious', 12, 'having keen insight', '통찰력 있는', 'A perspicacious reader notices subtle clues.', 'dull|lazy|noisy', 'astute|insightful', 'obtuse|naive'],
  ['obfuscate', 12, 'to make something unclear', '혼란스럽게 하다', 'Do not obfuscate the main point.', 'clarify|show|help', 'confuse|muddle', 'clarify|explain']
];

function todaySeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / MS);
}

function roundScore(n) {
  return Math.round(Number(n) * 10) / 10;
}

function clampScore(n) {
  return roundScore(Math.max(0, Math.min(PROMOTE_AT, Number(n) || 0)));
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

function wordIdForWord(word) {
  const slug = String(word || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'word';
  return 'w_' + slug;
}

function splitPipe(raw) {
  return String(raw || '').split('|').map((s) => s.trim()).filter(Boolean);
}

function parseWord(row) {
  const grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Number(row[2]) || 1));
  const tier = String(row[3] || '').trim() || tierForGrade(grade).name;
  const definition = String(row[4] || '');
  const synonyms = splitPipe(row[8]);
  const antonyms = splitPipe(row[9]);
  const wrongOptions = splitPipe(row[7]);
  return {
    word_id: String(row[0] || ''),
    word: String(row[1] || ''),
    grade_level: grade,
    tier_name: tier,
    simple_definition: definition,
    korean_meaning: String(row[5] || ''),
    example_sentence: String(row[6] || ''),
    wrong_options: wrongOptions,
    synonyms,
    antonyms,
    levels: { basic: { intuitive_definition: definition } }
  };
}

function toClientWord(w) {
  if (!w) return null;
  return {
    word_id: w.word_id,
    word: w.word,
    simple_definition: w.simple_definition,
    korean_meaning: w.korean_meaning,
    example_sentence: w.example_sentence,
    wrong_options: Array.isArray(w.wrong_options) ? w.wrong_options.slice() : [],
    synonyms: Array.isArray(w.synonyms) ? w.synonyms.slice() : [],
    antonyms: Array.isArray(w.antonyms) ? w.antonyms.slice() : [],
    levels: {
      basic: {
        intuitive_definition: w.simple_definition ||
          (w.levels && w.levels.basic && w.levels.basic.intuitive_definition) || ''
      }
    }
  };
}

function headerMatches(row, expected) {
  if (!row || !row.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (String(row[i] || '').trim() !== expected[i]) return false;
  }
  return true;
}

/** Migrate legacy Vocab_Words (no Tier/Synonyms/Antonyms) to the current schema. */
async function migrateWordsSheetIfNeeded(rows) {
  if (!rows.length) return rows;
  const hdr = rows[0] || [];
  if (headerMatches(hdr, WORD_HEADERS)) return rows;
  // Legacy: WordID, Word, Grade, Definition, Korean, Example, Distractors
  const looksLegacy = String(hdr[3] || '').toLowerCase() === 'definition' ||
    (hdr.length >= 7 && String(hdr[0] || '').toLowerCase() === 'wordid' &&
      String(hdr[3] || '').toLowerCase() !== 'tier');
  if (!looksLegacy && rows.length > 1) return rows;

  const rebuilt = [WORD_HEADERS];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const grade = Number(r[2]) || 1;
    if (String(hdr[3] || '').toLowerCase() === 'tier') {
      rebuilt.push([
        r[0], r[1], r[2], r[3] || tierForGrade(grade).name,
        r[4] || '', r[5] || '', r[6] || '', r[7] || '', r[8] || '', r[9] || ''
      ]);
    } else {
      rebuilt.push([
        r[0], r[1], String(grade), tierForGrade(grade).name,
        r[3] || '', r[4] || '', r[5] || '', r[6] || '', '', ''
      ]);
    }
  }
  await updateRange(WORDS_SHEET, `A1:J${Math.max(1, rebuilt.length)}`, rebuilt);
  invalidateSheetRowsCache(WORDS_SHEET);
  return rebuilt;
}

/** Migrate legacy Vocab_Student_State (11 cols) → 18-col schema. */
async function migrateStateSheetIfNeeded(rows) {
  if (!rows.length) return rows;
  const hdr = rows[0] || [];
  if (headerMatches(hdr, STATE_HEADERS)) return rows;
  const legacy = String(hdr[5] || '').toLowerCase() === 'streak' &&
    String(hdr[0] || '').toLowerCase() === 'studentid';
  if (!legacy) {
    if (rows.length === 1 || !hdr[0]) {
      await updateRange(STATE_SHEET, 'A1:R1', [STATE_HEADERS]);
      invalidateSheetRowsCache(STATE_SHEET);
      return [STATE_HEADERS];
    }
    return rows;
  }
  // Old: StudentID, ClassID, GradeLevel, Tier, PlacementDone, Streak, LastActive,
  //      WordsMastered, QuestDate, QuestDone, SessionsToday
  const rebuilt = [STATE_HEADERS];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const placed = String(r[4] || '').toUpperCase() === 'TRUE';
    rebuilt.push([
      r[0], r[1], r[2], r[3], r[4],
      placed ? new Date().toISOString() : '',
      '',
      r[5] || '0',
      r[5] || '0',
      r[6] || '',
      r[7] || '0',
      r[8] || '',
      r[9] || 'FALSE',
      r[10] || '0',
      '0',
      '',
      '0',
      '0'
    ]);
  }
  await updateRange(STATE_SHEET, `A1:R${Math.max(1, rebuilt.length)}`, rebuilt);
  invalidateSheetRowsCache(STATE_SHEET);
  return rebuilt;
}

async function ensureVocabSheets() {
  await ensureSheet(WORDS_SHEET, WORD_HEADERS);
  await ensureSheet(STATE_SHEET, STATE_HEADERS);
  await ensureSheet(PROGRESS_SHEET, PROGRESS_HEADERS);
  await ensureSheet(REVIEW_SHEET, REVIEW_HEADERS);

  let words = await getSheetRows(WORDS_SHEET);
  words = await migrateWordsSheetIfNeeded(words);
  await migrateStateSheetIfNeeded(await getSheetRows(STATE_SHEET));

  if (words.length <= 1) {
    const rows = SEED_WORDS.map((w) => {
      const grade = w[1];
      return [
        wordIdForWord(w[0]),
        w[0],
        String(grade),
        tierForGrade(grade).name,
        w[2],
        w[3],
        w[4],
        w[5] || '',
        w[6] || '',
        w[7] || ''
      ];
    });
    await appendRows(WORDS_SHEET, rows);
    invalidateSheetRowsCache(WORDS_SHEET);
  }
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
    gradeLevel: DEFAULT_PLACEMENT_START,
    tier: tierForGrade(DEFAULT_PLACEMENT_START).name,
    placementDone: false,
    placementAt: '',
    placementAccuracy: null,
    streak: 0,
    longestStreak: 0,
    lastActive: '',
    wordsMastered: 0,
    questDate: '',
    questDone: false,
    sessionsToday: 0,
    testAttempts: 0,
    testScore: null,
    promotionScore: 0,
    shieldCount: 0,
    rowIndex: -1
  };
}

function parseStateRow(row, rowIndex1Based, classId) {
  const today = todaySeoul();
  const questDate = String(row[11] || '');
  const sameDay = questDate === today;
  const gradeLevel = Number(row[2]) || DEFAULT_PLACEMENT_START;
  return {
    studentId: String(row[0] || ''),
    classId: String(row[1] || classId || ''),
    gradeLevel,
    tier: String(row[3] || '').trim() || tierForGrade(gradeLevel).name,
    placementDone: String(row[4] || '').toUpperCase() === 'TRUE',
    placementAt: String(row[5] || ''),
    placementAccuracy: row[6] !== '' && row[6] != null ? Number(row[6]) : null,
    streak: Number(row[7]) || 0,
    longestStreak: Number(row[8]) || 0,
    lastActive: String(row[9] || ''),
    wordsMastered: Number(row[10]) || 0,
    questDate,
    questDone: sameDay && String(row[12] || '').toUpperCase() === 'TRUE',
    sessionsToday: sameDay ? (Number(row[13]) || 0) : 0,
    testAttempts: sameDay ? (Number(row[14]) || 0) : 0,
    testScore: sameDay && row[15] !== '' && row[15] != null ? Number(row[15]) : null,
    promotionScore: Number(row[16]) || 0,
    shieldCount: Number(row[17]) || 0,
    rowIndex: rowIndex1Based
  };
}

async function getStudentState(studentId, classId) {
  await ensureVocabSheets();
  const rows = await getSheetRows(STATE_SHEET);
  const sid = String(studentId);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== sid) continue;
    return parseStateRow(rows[i], i + 1, classId);
  }
  return blankState(studentId, classId);
}

function stateToRow(st) {
  return [
    st.studentId,
    st.classId,
    String(st.gradeLevel),
    st.tier || tierForGrade(st.gradeLevel).name,
    st.placementDone ? 'TRUE' : 'FALSE',
    st.placementAt || '',
    st.placementAccuracy != null ? String(st.placementAccuracy) : '',
    String(st.streak || 0),
    String(st.longestStreak || 0),
    st.lastActive || '',
    String(st.wordsMastered || 0),
    st.questDate || '',
    st.questDone ? 'TRUE' : 'FALSE',
    String(st.sessionsToday || 0),
    String(st.testAttempts || 0),
    st.testScore != null ? String(st.testScore) : '',
    String(st.promotionScore || 0),
    String(st.shieldCount || 0)
  ];
}

async function saveStudentState(st) {
  await ensureVocabSheets();
  const row = stateToRow(st);
  if (st.rowIndex > 0) {
    await updateRange(STATE_SHEET, `A${st.rowIndex}:R${st.rowIndex}`, [row]);
  } else {
    await appendRows(STATE_SHEET, [row]);
  }
  invalidateSheetRowsCache(STATE_SHEET);
  return getStudentState(st.studentId, st.classId);
}

function ensureTodayQuest(st) {
  const today = todaySeoul();
  if (st.questDate !== today) {
    st.questDate = today;
    st.questDone = false;
    st.sessionsToday = 0;
    st.testAttempts = 0;
    st.testScore = null;
  }
  return st;
}

function promotionProgressFromState(st) {
  if (!st || !st.placementDone) {
    return {
      promotionScore: 0,
      promotionScoreMax: PROMOTE_AT,
      promotionPercent: 0,
      shieldCount: 0,
      remainingToPromote: PROMOTE_AT
    };
  }
  const score = clampScore(st.promotionScore);
  return {
    promotionScore: score,
    promotionScoreMax: PROMOTE_AT,
    promotionPercent: Math.round((score / PROMOTE_AT) * 1000) / 10,
    shieldCount: Math.max(0, Math.round(Number(st.shieldCount) || 0)),
    remainingToPromote: roundScore(Math.max(0, PROMOTE_AT - score))
  };
}

function scoreDeltaForAnswer(answer) {
  const correct = !!(answer && answer.correct);
  const attempt = String((answer && answer.attempt) || 'first').toLowerCase();
  const isRetry = attempt === 'retry' || attempt === 'retest' || !!(answer && answer.isRetry);
  if (correct) return isRetry ? SCORE_RETRY_CORRECT : SCORE_FIRST_CORRECT;
  return isRetry ? SCORE_RETRY_WRONG : SCORE_FIRST_WRONG;
}

function computeSetScoreDelta(answers) {
  const list = Array.isArray(answers) ? answers : [];
  let delta = 0;
  list.forEach((a) => { delta += scoreDeltaForAnswer(a); });
  return roundScore(delta);
}

function buildSyntheticAnswers(correctCount, totalCount) {
  const total = Math.max(0, Math.round(Number(totalCount) || 0));
  const correct = Math.max(0, Math.min(total, Math.round(Number(correctCount) || 0)));
  const out = [];
  for (let i = 0; i < correct; i++) out.push({ correct: true, attempt: 'first' });
  for (let j = correct; j < total; j++) out.push({ correct: false, attempt: 'first' });
  return out;
}

function applyPromotionDeltaLocal(st, delta, consumeShieldItems) {
  let grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(st.gradeLevel) || 6)));
  let score = roundScore(Number(st.promotionScore) || 0);
  let shield = Math.max(0, Math.round(Number(st.shieldCount) || 0));
  const before = score;
  const d = roundScore(Number(delta) || 0);
  score = roundScore(score + d);

  let promoted = null;
  let demoted = null;

  while (score >= PROMOTE_AT && grade < GRADE_MAX) {
    grade += 1;
    score = 0;
    shield = SHIELD_ITEMS_ON_PROMOTE;
    promoted = 'up';
  }
  if (grade >= GRADE_MAX && score > PROMOTE_AT) score = PROMOTE_AT;

  if (score <= 0) {
    if (shield > 0) {
      score = 0;
    } else if (grade > GRADE_MIN) {
      grade -= 1;
      score = DEMOTE_REENTRY_SCORE;
      demoted = 'down';
    } else {
      score = 0;
    }
  }

  const used = Math.max(0, Math.round(Number(consumeShieldItems) || 0));
  if (used > 0 && shield > 0) shield = Math.max(0, shield - used);

  const tier = tierForGrade(grade);
  st.gradeLevel = grade;
  st.tier = tier.name;
  st.promotionScore = score;
  st.shieldCount = shield;

  return {
    ok: true,
    gradeLevel: grade,
    tierName: tier.name,
    promotionScore: score,
    promotionScoreMax: PROMOTE_AT,
    promotionPercent: Math.round((score / PROMOTE_AT) * 1000) / 10,
    remainingToPromote: roundScore(Math.max(0, PROMOTE_AT - score)),
    shieldCount: shield,
    promoted,
    demoted,
    scoreDelta: d,
    delta: d,
    beforeScore: before,
    afterScore: score
  };
}

async function getProgressRows() {
  await ensureVocabSheets();
  return getSheetRows(PROGRESS_SHEET);
}

function parseProgress(row, rowIndex1Based) {
  return {
    studentId: String(row[0] || ''),
    wordId: String(row[1] || ''),
    box: Number(row[2]) || 0,
    correctCount: Number(row[3]) || 0,
    wrongCount: Number(row[4]) || 0,
    nextDueAt: String(row[5] || ''),
    updatedAt: String(row[6] || ''),
    rowIndex: rowIndex1Based
  };
}

async function listStudentProgress(studentId) {
  const rows = await getProgressRows();
  const sid = String(studentId);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== sid) continue;
    out.push(parseProgress(rows[i], i + 1));
  }
  return out;
}

async function upsertProgress(studentId, wordId, patch) {
  const rows = await getProgressRows();
  const sid = String(studentId);
  const wid = String(wordId);
  const now = new Date().toISOString();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== sid || String(rows[i][1]) !== wid) continue;
    const existing = parseProgress(rows[i], i + 1);
    const next = Object.assign({}, existing, patch, { updatedAt: now });
    await updateRange(PROGRESS_SHEET, `A${i + 1}:G${i + 1}`, [[
      sid, wid,
      String(next.box),
      String(next.correctCount),
      String(next.wrongCount),
      next.nextDueAt || '',
      next.updatedAt
    ]]);
    invalidateSheetRowsCache(PROGRESS_SHEET);
    return next;
  }
  const row = [
    sid, wid,
    String(patch.box != null ? patch.box : 0),
    String(patch.correctCount != null ? patch.correctCount : 0),
    String(patch.wrongCount != null ? patch.wrongCount : 0),
    patch.nextDueAt || now,
    now
  ];
  await appendRows(PROGRESS_SHEET, [row]);
  invalidateSheetRowsCache(PROGRESS_SHEET);
  return parseProgress(row, -1);
}

async function appendReview(studentId, wordId, correct, kind) {
  await appendRows(REVIEW_SHEET, [[
    newId('rev'),
    String(studentId),
    String(wordId),
    correct ? 'TRUE' : 'FALSE',
    new Date().toISOString(),
    todaySeoul(),
    kind || 'review'
  ]]);
  invalidateSheetRowsCache(REVIEW_SHEET);
}

async function studiedWordIdsToday(studentId) {
  await ensureVocabSheets();
  const today = todaySeoul();
  const rows = await getSheetRows(REVIEW_SHEET);
  const sid = String(studentId);
  const ids = new Set();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== sid) continue;
    if (String(rows[i][5] || '') !== today) continue;
    if (rows[i][2]) ids.add(String(rows[i][2]));
  }
  return ids;
}

function pickWordsForGrade(allWords, gradeLevel, count, excludeIds, opts) {
  opts = opts || {};
  const exclude = new Set((excludeIds || []).map(String));
  const grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(gradeLevel) || 6)));
  const maxRadius = Math.max(0, Math.min(
    GRADE_MAX - GRADE_MIN,
    opts.maxRadius != null ? Number(opts.maxRadius) : 2
  ));

  let pool = allWords.filter((w) =>
    Number(w.grade_level) === grade && !exclude.has(String(w.word_id))
  );
  for (let radius = 1; pool.length < count && radius <= maxRadius; radius++) {
    const band = allWords.filter((w) => {
      const g = Number(w.grade_level);
      return Math.abs(g - grade) === radius && !exclude.has(String(w.word_id)) &&
        !pool.some((p) => p.word_id === w.word_id);
    });
    pool = pool.concat(band);
  }
  pool.sort((a, b) => Math.abs(a.grade_level - grade) - Math.abs(b.grade_level - grade));
  const exact = pool.filter((w) => Number(w.grade_level) === grade);
  const preferred = exact.length >= Math.min(4, count) ? exact : pool;
  return shuffle(preferred).slice(0, count);
}

async function getMastery(studentId, gradeLevel, allWords) {
  const grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(gradeLevel) || 6)));
  const tierWords = (allWords || await listAllWords()).filter((w) => Number(w.grade_level) === grade);
  const total = tierWords.length;
  if (!total) return { coverage: 0, mastered: 0, total: 0 };
  const progress = await listStudentProgress(studentId);
  const masteredIds = new Set(
    progress.filter((p) => p.correctCount > 0).map((p) => String(p.wordId))
  );
  const mastered = tierWords.filter((w) => masteredIds.has(String(w.word_id))).length;
  return {
    coverage: Math.round((mastered / total) * 1000) / 10,
    mastered,
    total
  };
}

/* ----------------------------- Public API ----------------------------- */

async function getStudentVocabSummary(studentId, classId) {
  let st = await getStudentState(studentId, classId);
  st = ensureTodayQuest(st);
  const placed = !!st.placementDone;
  const progress = promotionProgressFromState(st);
  let mastery = null;
  if (placed) {
    try {
      mastery = await getMastery(studentId, st.gradeLevel);
    } catch (e) { /* optional */ }
  }
  const studiedIds = placed ? await studiedWordIdsToday(studentId) : new Set();

  return {
    available: true,
    tierName: placed ? st.tier : null,
    gradeLevel: placed ? st.gradeLevel : null,
    promotionScore: placed ? progress.promotionScore : 0,
    promotionScoreMax: PROMOTE_AT,
    promotionPercent: placed ? progress.promotionPercent : 0,
    remainingToPromote: placed ? progress.remainingToPromote : PROMOTE_AT,
    shieldCount: placed ? progress.shieldCount : 0,
    streakDays: st.streak || 0,
    longestStreak: st.longestStreak || 0,
    placementDone: placed,
    placementAt: st.placementAt || null,
    placementAccuracy: placed ? st.placementAccuracy : null,
    schoolGrade: null,
    placementStartGrade: DEFAULT_PLACEMENT_START,
    mastery,
    today: {
      date: todaySeoul(),
      targetCount: DAILY_TARGET,
      studiedCount: studiedIds.size,
      testPassed: !!st.questDone,
      testAttempts: st.testAttempts || 0,
      testScore: st.testScore,
      sessionsCompleted: st.sessionsToday || 0,
      maxSessions: null,
      canStartAnother: true
    },
    settings: {
      dailyTarget: DAILY_TARGET,
      passThreshold: PASS_THRESHOLD,
      rewardTier: REWARD_TIER,
      maxDailySessions: null
    },
    message: placed
      ? (st.questDone ? 'Daily quest complete — you can still study more sets!' : 'Ready for today’s words.')
      : 'Take the placement test to start Vocab Booster.'
  };
}

function wordDefFromRow(w) {
  if (!w) return '';
  return String(w.simple_definition || '').trim();
}

function firstCleanListItem(arr, banWord) {
  const ban = String(banWord || '').trim().toLowerCase();
  const list = Array.isArray(arr) ? arr : [];
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || '').trim();
    if (!s) continue;
    if (ban && s.toLowerCase() === ban) continue;
    return s;
  }
  return '';
}

function wordHasSynonym(word) {
  return !!firstCleanListItem(word && word.synonyms, word && word.word);
}

function wordHasAntonym(word) {
  return !!firstCleanListItem(word && word.antonyms, word && word.word);
}

function wordSupportsPlacementType(word, type) {
  if (!word) return false;
  if (type === 'synonym') return wordHasSynonym(word);
  if (type === 'antonym') return wordHasAntonym(word);
  if (type === 'secondaryMeaning' || type === 'senseCloze') return false;
  return true;
}

async function buildPlacementItem(opts) {
  opts = opts || {};
  const abilityGrade = Number(opts.abilityGrade);
  const ability = Number.isFinite(abilityGrade) ? abilityGrade : DEFAULT_PLACEMENT_START;
  const qIndex = Math.max(0, Number(opts.questionIndex) || 0);
  const abilityTrail = Array.isArray(opts.abilityTrail) ? opts.abilityTrail.map(Number) : [];
  const avoid = new Set((opts.avoidWordIds || []).map(String));

  if (shouldStopPlacement(abilityTrail) && abilityTrail.length) {
    return { done: true, reason: 'stable' };
  }
  if (qIndex >= PLACEMENT_MAX) {
    return { done: true, reason: 'max' };
  }

  const targetGrade = nextTargetFreq(ability);
  const pickRadius = PLACEMENT_PICK_RADIUS != null ? PLACEMENT_PICK_RADIUS : 1;
  const allWords = await listAllWords();

  let pool = pickWordsForGrade(allWords, targetGrade, 48, Array.from(avoid), { maxRadius: pickRadius });
  if (!pool.length) {
    pool = pickWordsForGrade(allWords, targetGrade, 48, [], { maxRadius: pickRadius });
  }
  if (!pool.length) throw new Error('Word bank is empty — seed Vocab_Words first.');

  let preferredType = pickWeightedPlacementType(ability);
  let candidates = pool.filter((w) => wordSupportsPlacementType(w, preferredType));
  if (!candidates.length) {
    const fallbackOrder = ['sentence', 'meaning', 'whichWord', 'synonym', 'antonym'];
    for (let i = 0; i < fallbackOrder.length; i++) {
      const t = fallbackOrder[i];
      candidates = pool.filter((w) => wordSupportsPlacementType(w, t));
      if (candidates.length) {
        preferredType = t;
        break;
      }
    }
  }
  if (!candidates.length) candidates = pool;

  const word = candidates[Math.floor(Math.random() * candidates.length)];
  const distractorPool = pool.filter((w) => w.word_id !== word.word_id);
  let type = preferredType;
  if (!wordSupportsPlacementType(word, type)) type = 'meaning';

  function uniqueChoices(correct, wrongs) {
    const out = [];
    const seen = {};
    function add(v) {
      const s = String(v == null ? '' : v).trim();
      if (!s || seen[s.toLowerCase()]) return;
      seen[s.toLowerCase()] = true;
      out.push(s);
    }
    add(correct);
    (wrongs || []).forEach(add);
    return out;
  }

  function wordChoices(correctWord) {
    return uniqueChoices(
      correctWord,
      shuffle(distractorPool.slice()).map((w) => w.word)
    );
  }

  function defChoices(correctDef, extraWrongs) {
    const wrongs = (extraWrongs || []).concat(
      shuffle(distractorPool.slice()).map(wordDefFromRow)
    ).concat(word.wrong_options || []);
    return uniqueChoices(correctDef, wrongs);
  }

  let prompt = '';
  let correct = '';
  let choices = [];

  function buildMeaning() {
    type = 'meaning';
    prompt = 'What does “' + word.word + '” mean?';
    correct = wordDefFromRow(word) || word.word;
    choices = defChoices(correct);
  }

  function buildWhichWord() {
    type = 'whichWord';
    const def = wordDefFromRow(word) || word.word;
    const ko = String(word.korean_meaning || '').trim();
    prompt = ko
      ? ('Which word means this?\n' + ko + '\n(' + def + ')')
      : ('Which word means “' + def + '”?');
    correct = String(word.word || '').trim();
    choices = wordChoices(correct);
  }

  function buildSentence() {
    const cloze = buildClozePrompt(word);
    if (!cloze) {
      buildMeaning();
      return;
    }
    type = 'sentence';
    prompt = cloze;
    correct = String(word.word || '').trim();
    choices = wordChoices(correct);
  }

  function buildSynonym() {
    const syn = firstCleanListItem(word.synonyms, word.word);
    if (!syn) {
      buildMeaning();
      return;
    }
    type = 'synonym';
    prompt = 'Which word is closest in meaning to “' + word.word + '”?';
    correct = syn;
    const wrongs = shuffle(distractorPool.slice())
      .map((w) => String(w.word || '').trim())
      .filter((w) =>
        w && w.toLowerCase() !== syn.toLowerCase() &&
        w.toLowerCase() !== String(word.word || '').toLowerCase()
      );
    choices = uniqueChoices(correct, wrongs);
  }

  function buildAntonym() {
    const ant = firstCleanListItem(word.antonyms, word.word);
    if (!ant) {
      buildSynonym();
      return;
    }
    type = 'antonym';
    prompt = 'Which word is the opposite of “' + word.word + '”?';
    correct = ant;
    const wrongs = shuffle(distractorPool.slice())
      .map((w) => String(w.word || '').trim())
      .filter((w) =>
        w && w.toLowerCase() !== ant.toLowerCase() &&
        w.toLowerCase() !== String(word.word || '').toLowerCase()
      );
    const synTrap = firstCleanListItem(word.synonyms, word.word);
    if (synTrap) wrongs.unshift(synTrap);
    choices = uniqueChoices(correct, wrongs);
  }

  if (type === 'synonym') buildSynonym();
  else if (type === 'antonym') buildAntonym();
  else if (type === 'whichWord') buildWhichWord();
  else if (type === 'sentence') buildSentence();
  else buildMeaning();

  while (choices.length < 4 && distractorPool.length) {
    const filler = distractorPool[Math.floor(Math.random() * distractorPool.length)];
    const text = type === 'meaning'
      ? wordDefFromRow(filler)
      : String(filler.word || '');
    if (text && choices.indexOf(text) < 0) choices.push(text);
    else break;
  }

  return {
    done: false,
    type,
    prompt,
    correct,
    choices: shuffle(choices.slice(0, 4)),
    word: {
      word_id: word.word_id,
      word: word.word,
      simple_definition: word.simple_definition,
      korean_meaning: word.korean_meaning,
      example_sentence: word.example_sentence,
      wrong_options: word.wrong_options || []
    },
    frequencyLevel: word.grade_level,
    targetGrade,
    questionIndex: qIndex,
    questionMin: PLACEMENT_MIN,
    questionMax: PLACEMENT_MAX,
    hardType: type === 'synonym' || type === 'antonym'
  };
}

function processPlacementNext(body) {
  body = body || {};
  const detail = updateAbilityDetailed(body.abilityGrade, {
    correct: !!body.correct,
    seconds: body.seconds,
    questionType: body.questionType,
    frequencyLevel: body.frequencyLevel != null ? body.frequencyLevel : body.targetGrade,
    questionIndex: body.questionIndex
  });
  try {
    console.log(formatPlacementLog(detail));
  } catch (e) { /* ignore */ }
  const ability = detail.ability;
  const abilityTrail = Array.isArray(body.abilityTrail)
    ? body.abilityTrail.map(Number).concat([ability])
    : [ability];
  return {
    abilityGrade: ability,
    prevAbility: detail.prev,
    step: detail.step,
    delta: detail.delta,
    itemGrade: detail.itemGrade,
    questionNumber: detail.questionNumber,
    nextTargetGrade: nextTargetFreq(ability),
    stop: shouldStopPlacement(abilityTrail),
    abilityTrail
  };
}

async function savePlacementResult(studentId, classId, payload) {
  let st = await getStudentState(studentId, classId);
  if (st.placementDone) {
    const err = new Error(
      'Placement already completed. Ask your teacher to reset your tier if you need to retake it.'
    );
    err.code = 'PLACEMENT_ALREADY_DONE';
    throw err;
  }

  const result = (payload && payload.gradeLevel != null && payload.tier)
    ? payload
    : scorePlacement(payload || {});

  const now = new Date().toISOString();
  st.classId = String(classId || st.classId || '');
  st.gradeLevel = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(result.gradeLevel) || DEFAULT_PLACEMENT_START)));
  st.tier = (result.tier && result.tier.name) || tierForGrade(st.gradeLevel).name;
  st.placementDone = true;
  st.placementAt = now;
  st.placementAccuracy = result.accuracy != null ? result.accuracy : null;
  st.promotionScore = 0;
  st.shieldCount = 0;
  st.lastActive = todaySeoul();
  st = await saveStudentState(st);

  const summary = await getStudentVocabSummary(studentId, classId);
  return Object.assign({}, result, {
    ok: true,
    placementDone: true,
    tierName: st.tier,
    gradeLevel: st.gradeLevel,
    promotionScore: 0,
    promotionScoreMax: PROMOTE_AT,
    summary
  });
}

async function getDailyQueue(studentId, classId) {
  let st = await getStudentState(studentId, classId);
  if (!st.placementDone) {
    const err = new Error('Finish the Placement test before starting today\'s words.');
    err.code = 'PLACEMENT_REQUIRED';
    throw err;
  }
  st = ensureTodayQuest(st);
  await saveStudentState(st);

  const allWords = await listAllWords();
  const progress = await listStudentProgress(studentId);
  const nowIso = new Date().toISOString();
  const studiedToday = await studiedWordIdsToday(studentId);

  const due = progress
    .filter((p) => !p.nextDueAt || p.nextDueAt <= nowIso)
    .filter((p) => !studiedToday.has(String(p.wordId)))
    .sort((a, b) => String(a.nextDueAt).localeCompare(String(b.nextDueAt)));

  const byId = {};
  allWords.forEach((w) => { byId[w.word_id] = w; });

  let words = [];
  for (const p of due) {
    if (words.length >= DAILY_TARGET) break;
    const w = byId[p.wordId];
    if (w) words.push(w);
  }

  const exclude = new Set([
    ...progress.map((p) => String(p.wordId)),
    ...studiedToday,
    ...words.map((w) => String(w.word_id))
  ]);

  if (words.length < DAILY_TARGET) {
    const fresh = pickWordsForGrade(
      allWords,
      st.gradeLevel,
      DAILY_TARGET - words.length,
      Array.from(exclude),
      { maxRadius: 2 }
    );
    words = words.concat(fresh);
  }

  // Later sets: prefer fresh words not studied today
  if (st.sessionsToday > 0) {
    words = words.filter((w) => !studiedToday.has(String(w.word_id)));
    if (words.length < DAILY_TARGET) {
      const more = pickWordsForGrade(
        allWords,
        st.gradeLevel,
        DAILY_TARGET - words.length,
        Array.from(exclude).concat(words.map((w) => w.word_id)),
        { maxRadius: 3 }
      );
      words = words.concat(more);
    }
  }

  return {
    date: todaySeoul(),
    targetCount: DAILY_TARGET,
    passThreshold: PASS_THRESHOLD,
    studiedCount: studiedToday.size,
    testPassed: !!st.questDone,
    testAttempts: st.testAttempts || 0,
    sessionsCompleted: st.sessionsToday || 0,
    maxSessions: null,
    canStartAnother: true,
    words: words.slice(0, DAILY_TARGET).map(toClientWord)
  };
}

async function recordReview(studentId, classId, wordId, correct) {
  studentId = String(studentId);
  wordId = String(wordId);
  const progress = await listStudentProgress(studentId);
  const existing = progress.find((p) => String(p.wordId) === wordId) || null;

  let box = existing ? existing.box : 0;
  box = correct ? Math.min(MAX_BOX, box + 1) : 0;
  const intervalDays = BOX_INTERVAL_DAYS[box];
  const nextDueAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000).toISOString();

  await upsertProgress(studentId, wordId, {
    box,
    correctCount: (existing ? existing.correctCount : 0) + (correct ? 1 : 0),
    wrongCount: (existing ? existing.wrongCount : 0) + (correct ? 0 : 1),
    nextDueAt
  });

  await appendReview(studentId, wordId, !!correct, 'review');

  let st = await getStudentState(studentId, classId);
  st = ensureTodayQuest(st);
  st.lastActive = todaySeoul();
  if (correct) st.wordsMastered = (st.wordsMastered || 0) + (existing && existing.correctCount > 0 ? 0 : 1);
  await saveStudentState(st);

  const studied = await studiedWordIdsToday(studentId);
  return {
    box,
    nextDueAt,
    studiedCount: studied.size,
    targetCount: DAILY_TARGET
  };
}

async function grantTierDollarBonus(classId, studentId, tierName) {
  const amount = DAILY_DOLLAR_BONUS_BY_TIER[String(tierName || '')] || 0;
  if (amount <= 0) return null;
  await applyDollarAdjustment(classId, studentId, amount, 'Vocab daily quest (' + tierName + ')');
  return { amount, tierName };
}

async function bumpStreak(st, questDate) {
  const lastDate = st.lastActive;
  let streak = st.streak || 0;
  if (lastDate && daysBetween(lastDate, questDate) === 1) {
    streak += 1;
  } else if (lastDate === questDate) {
    // already counted
  } else {
    streak = 1;
  }
  st.streak = streak;
  st.longestStreak = Math.max(st.longestStreak || 0, streak);
  st.lastActive = questDate;
  return { streakDays: streak, longestStreak: st.longestStreak };
}

async function recordDailyTestResult(studentId, classId, correctCount, totalCount, answers) {
  studentId = String(studentId);
  let st = await getStudentState(studentId, classId);
  if (!st.placementDone) {
    const err = new Error('Finish the Placement test before taking the daily test.');
    err.code = 'PLACEMENT_REQUIRED';
    throw err;
  }
  st = ensureTodayQuest(st);

  const total = Math.max(1, Number(totalCount) || 0);
  const score = Math.round((Math.max(0, Number(correctCount) || 0) / total) * 1000) / 10;
  const passed = score >= PASS_THRESHOLD;
  const sessionsBefore = Math.max(0, Number(st.sessionsToday) || 0);

  st.testAttempts = (st.testAttempts || 0) + 1;
  st.testScore = score;
  if (passed) st.questDone = true;

  const scoredAnswers = Array.isArray(answers) && answers.length
    ? answers
    : buildSyntheticAnswers(correctCount, total);
  const promotion = applyPromotionDeltaLocal(st, computeSetScoreDelta(scoredAnswers), scoredAnswers.length);

  let reward = null;
  let dollarBonus = null;
  let streakInfo = null;
  let sessionsCompleted = sessionsBefore;

  if (passed) {
    sessionsCompleted = sessionsBefore + 1;
    st.sessionsToday = sessionsCompleted;
    try {
      dollarBonus = await grantTierDollarBonus(classId || st.classId, studentId, st.tier);
    } catch (e) {
      console.error('grantTierDollarBonus failed', e.message || e);
    }
    if (sessionsBefore === 0) {
      streakInfo = await bumpStreak(st, todaySeoul());
    } else {
      st.lastActive = todaySeoul();
    }
  } else {
    st.lastActive = todaySeoul();
  }

  await saveStudentState(st);

  // Log test answers for activity
  try {
    for (const a of scoredAnswers) {
      if (a && a.wordId) {
        await appendReview(studentId, a.wordId, !!a.correct, 'daily_test');
      }
    }
  } catch (e) { /* optional */ }

  return {
    passed,
    score,
    threshold: PASS_THRESHOLD,
    reward,
    dollarBonus,
    rating: {
      gradeLevel: promotion.gradeLevel,
      tierName: promotion.tierName,
      promotionScore: promotion.promotionScore,
      promotionScoreMax: PROMOTE_AT,
      promotionPercent: promotion.promotionPercent,
      remainingToPromote: promotion.remainingToPromote,
      shieldCount: promotion.shieldCount,
      promoted: promotion.promoted,
      demoted: promotion.demoted,
      scoreDelta: promotion.scoreDelta
    },
    promotion: {
      promotionScore: promotion.promotionScore,
      promotionScoreMax: PROMOTE_AT,
      promotionPercent: promotion.promotionPercent,
      shieldCount: promotion.shieldCount,
      promoted: promotion.promoted,
      demoted: promotion.demoted,
      scoreDelta: promotion.scoreDelta,
      gradeLevel: promotion.gradeLevel,
      tierName: promotion.tierName
    },
    streak: streakInfo,
    alreadyPassedToday: sessionsBefore >= 1,
    sessionsCompleted,
    maxSessions: null,
    canStartAnother: true,
    rewardClaimedToday: false
  };
}

async function getClassVocabOverview(classId) {
  await ensureVocabSheets();
  const roster = await getClassRoster(classId);
  const students = [];
  for (const s of roster) {
    const st = await getStudentState(s.studentId, classId);
    const progress = promotionProgressFromState(st);
    students.push({
      studentId: s.studentId,
      name: s.name,
      placementDone: st.placementDone,
      gradeLevel: st.placementDone ? st.gradeLevel : null,
      tierName: st.placementDone ? st.tier : null,
      tier: st.placementDone ? st.tier : null,
      streak: st.streak,
      streakDays: st.streak,
      longestStreak: st.longestStreak,
      questDone: st.questDone,
      wordsMastered: st.wordsMastered,
      lastActive: st.lastActive,
      promotionScore: st.placementDone ? progress.promotionScore : 0,
      promotionScoreMax: PROMOTE_AT,
      shieldCount: st.placementDone ? progress.shieldCount : 0,
      todayTestPassed: !!st.questDone,
      todayTestScore: st.testScore
    });
  }
  return {
    students,
    dailyTarget: DAILY_TARGET,
    settings: {
      dailyTarget: DAILY_TARGET,
      passThreshold: PASS_THRESHOLD,
      rewardTier: REWARD_TIER,
      maxDailySessions: null
    }
  };
}

async function overrideStudentVocab(studentId, classId, opts) {
  opts = opts || {};
  let st = await getStudentState(studentId, classId);
  st.classId = String(classId || st.classId);

  if (opts.gradeLevel != null) {
    st.gradeLevel = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Number(opts.gradeLevel) || st.gradeLevel));
    st.tier = tierForGrade(st.gradeLevel).name;
    st.promotionScore = 0;
    st.shieldCount = 0;
  }

  if (opts.resetPlacement) {
    st.placementDone = false;
    st.placementAt = '';
    st.placementAccuracy = null;
    st.questDone = false;
    st.promotionScore = 0;
    st.shieldCount = 0;
  }
  if (opts.placementDone === true) {
    st.placementDone = true;
    if (!st.placementAt) st.placementAt = new Date().toISOString();
  }

  st = await saveStudentState(st);
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

/* Legacy aliases for older morning-class routes */
async function startPlacement(studentId, classId) {
  const summary = await getStudentVocabSummary(studentId, classId);
  if (summary.placementDone) return { alreadyDone: true, state: summary };
  return {
    adaptive: true,
    placementStartGrade: summary.placementStartGrade || DEFAULT_PLACEMENT_START,
    message: 'Use POST /student/vocab/placement/item for adaptive placement.'
  };
}

async function submitPlacement(studentId, classId, responses) {
  // Convert legacy choice responses into a coarse ability estimate
  const words = await listAllWords();
  const byId = {};
  words.forEach((w) => { byId[w.word_id] = w; });
  const answers = [];
  const list = Array.isArray(responses) ? responses : [];
  list.forEach((r, i) => {
    const wid = String(r.wordId || '');
    const word = byId[wid];
    if (!word) return;
    const ok = String(r.choice || '').trim() === word.simple_definition;
    answers.push({
      correct: ok,
      questionIndex: i,
      frequencyLevel: word.grade_level,
      questionType: 'meaning'
    });
  });
  return savePlacementResult(studentId, classId, { answers, startAbility: DEFAULT_PLACEMENT_START });
}

async function startDailyQuest(studentId, classId) {
  const queue = await getDailyQueue(studentId, classId);
  return {
    study: (queue.words || []).map((w) => ({
      wordId: w.word_id,
      word: w.word,
      definition: w.simple_definition,
      korean: w.korean_meaning,
      example: w.example_sentence
    })),
    quiz: (queue.words || []).map((w) => ({
      wordId: w.word_id,
      word: w.word,
      prompt: 'What does “' + w.word + '” mean?',
      choices: shuffle([w.simple_definition].concat(w.wrong_options || []).slice(0, 4))
    })),
    target: queue.targetCount
  };
}

async function submitDailyQuest(studentId, classId, responses) {
  const list = Array.isArray(responses) ? responses : [];
  const words = await listAllWords();
  const byId = {};
  words.forEach((w) => { byId[w.word_id] = w; });
  let correct = 0;
  const answers = [];
  for (const r of list) {
    const wid = String(r.wordId || '');
    const word = byId[wid];
    if (!word) continue;
    const ok = String(r.choice || '').trim() === word.simple_definition;
    if (ok) correct++;
    answers.push({ wordId: wid, correct: ok, attempt: 'first' });
    try {
      await recordReview(studentId, classId, wid, ok);
    } catch (e) { /* ignore */ }
  }
  const result = await recordDailyTestResult(studentId, classId, correct, answers.length || list.length, answers);
  return {
    correct,
    total: answers.length || list.length,
    passed: result.passed,
    reward: result.dollarBonus ? result.dollarBonus.amount : 0,
    summary: await getStudentVocabSummary(studentId, classId)
  };
}

module.exports = {
  ensureVocabSheets,
  getStudentVocabSummary,
  buildPlacementItem,
  processPlacementNext,
  advancePlacement: processPlacementNext,
  savePlacementResult,
  getDailyQueue,
  recordReview,
  recordDailyTestResult,
  getClassVocabOverview,
  overrideStudentVocab,
  getRecentVocabActivity,
  listAllWords,
  // legacy route aliases
  startPlacement,
  submitPlacement,
  startDailyQuest,
  submitDailyQuest
};
