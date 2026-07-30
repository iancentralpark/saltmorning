/**
 * AI Vocab Learning — Round 2 (Supabase-backed):
 *  - Bulk word bank upload/management (teacher LMS)
 *  - Leitner-style spaced repetition (SRS) progress per student
 *  - Daily quest (study N words -> pass a short test -> auto reward)
 *  - Teacher LMS overview + per-class settings + manual overrides
 */
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
const { getEnrolledStudents } = require('./homeworkService');
const { tierForGrade, GRADE_MIN, GRADE_MAX } = require('./vocabPlacementService');
const { applyDollarAdjustment } = require('./dollarService');

const DEFAULT_DAILY_TARGET = 10;
const DEFAULT_PASS_THRESHOLD = 100;
const DEFAULT_REWARD_TIER = 'Common';

// Leitner box -> review interval in days. Box 0 = due immediately (new/failed).
const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
const MAX_BOX = BOX_INTERVAL_DAYS.length - 1;

// Rating-based promotion/demotion (Elo-style), like the students.rating_score idea.
const RATING_START = 100;
const RATING_PROMOTE_AT = 130;
const RATING_DEMOTE_AT = 70;

// Tier-scaled daily Dollar bonus, granted every day the quest is completed (on top of
// the existing Lucky Draw ticket reward). Rookie/Iron are $0 (no adjustment call made).
const DAILY_DOLLAR_BONUS_BY_TIER = {
  Rookie: 0,
  Iron: 0,
  Bronze: 0.5,
  Silver: 0.5,
  Gold: 0.5,
  Platinum: 1,
  Emerald: 1,
  Diamond: 1,
  Ascendant: 2,
  Master: 2,
  Grandmaster: 2,
  Legend: 3
};

function requireDb() {
  if (!isSupabaseEnabled()) {
    throw new Error('Vocab learning requires Supabase to be configured.');
  }
  return getSupabase();
}

function todayStr() {
  // Server-local date is fine here; students only interact with "today" within one session.
  const d = new Date();
  const pad = n => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / MS);
}

/** Case-insensitive identity key for a vocab word. */
function wordKeyFor(word) {
  return String(word || '').trim().toLowerCase();
}

/** Stable primary key: one row per distinct word (grade is a column, not part of the id). */
function wordIdForWord(word) {
  const slug = wordKeyFor(word).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'word';
  return 'w_' + slug;
}

/* ----------------------------- Word bank (teacher) ----------------------------- */

function normalizeWordEntry(raw, idx) {
  if (!raw || typeof raw !== 'object') throw new Error('Row ' + (idx + 1) + ': invalid word entry.');
  const word = String(raw.word || '').trim();
  if (!word) throw new Error('Row ' + (idx + 1) + ': "word" is required.');
  const grade = Number(raw.grade_level != null ? raw.grade_level : raw.gradeLevel);
  if (!Number.isFinite(grade) || grade < GRADE_MIN || grade > GRADE_MAX) {
    throw new Error('Row ' + (idx + 1) + ' (' + word + '): grade_level must be ' + GRADE_MIN + '-' + GRADE_MAX + '.');
  }
  const gradeLevel = Math.round(grade);
  const tierName = String(raw.tier_name || raw.tierName || '').trim() || tierForGrade(gradeLevel).name;
  const simpleDefinition = String(raw.simple_definition || raw.simpleDefinition || '').trim();
  const koreanMeaning = String(raw.korean_meaning || raw.koreanMeaning || '').trim();
  const exampleSentence = String(raw.example_sentence || raw.exampleSentence || '').trim();
  if (!simpleDefinition) throw new Error('Row ' + (idx + 1) + ' (' + word + '): simple_definition is required.');
  if (!koreanMeaning) throw new Error('Row ' + (idx + 1) + ' (' + word + '): korean_meaning is required.');
  if (!exampleSentence) throw new Error('Row ' + (idx + 1) + ' (' + word + '): example_sentence is required.');

  const synonyms = Array.isArray(raw.synonyms) ? raw.synonyms.map(String) : [];
  const antonyms = Array.isArray(raw.antonyms) ? raw.antonyms.map(String) : [];
  const wrongOptions = Array.isArray(raw.wrong_options || raw.wrongOptions)
    ? (raw.wrong_options || raw.wrongOptions).map(String).slice(0, 3)
    : [];

  // One row per word (case-insensitive). Grade is a field, not part of the primary key —
  // otherwise re-uploads / concurrent jobs create duplicate rows when AI assigns a different grade.
  const wordKey = wordKeyFor(word);
  const wordId = String(raw.word_id || raw.wordId || '').trim() || wordIdForWord(word);

  return {
    word_id: wordId,
    word,
    word_key: wordKey,
    part_of_speech: String(raw.part_of_speech || raw.partOfSpeech || '').trim(),
    pronunciation: String(raw.pronunciation || '').trim(),
    grade_level: gradeLevel,
    tier_name: tierName,
    simple_definition: simpleDefinition,
    korean_meaning: koreanMeaning,
    example_sentence: exampleSentence,
    synonyms: synonyms,
    antonyms: antonyms,
    cloze_question: String(raw.cloze_question || raw.clozeQuestion || '').trim() || null,
    wrong_options: wrongOptions.length ? wrongOptions : null,
    explanation_for_wrong: String(raw.explanation_for_wrong || raw.explanationForWrong || '').trim() || null,
    source: String(raw.source || 'upload'),
    active: raw.active !== false
  };
}

async function bulkUpsertWords(rawWords) {
  const db = requireDb();
  const { filterJunkWords } = require('./vocabJunkFilter');
  const list = Array.isArray(rawWords) ? rawWords : [];
  if (!list.length) throw new Error('No words provided.');
  if (list.length > 8000) throw new Error('Too many words in one upload (max 8000). Split into batches.');

  const filtered = filterJunkWords(list);
  if (!filtered.keep.length) {
    throw new Error(
      filtered.skipped.length
        ? ('No usable words left after skipping ' + filtered.skipped.length + ' title/stopword entries.')
        : 'No words provided.'
    );
  }

  const normalized = filtered.keep.map(normalizeWordEntry);
  // Collapse same-word rows inside one upload (keep last).
  const byKey = new Map();
  normalized.forEach(function (w) { byKey.set(w.word_key, w); });
  const unique = Array.from(byKey.values());

  const CHUNK = 200;
  let upserted = 0;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK).map(function (w) {
      return Object.assign({}, w, { updated_at: new Date().toISOString() });
    });
    const keys = chunk.map(function (w) { return w.word_key; });
    // Drop any legacy rows for these words that used a different word_id (e.g. grade-suffixed).
    const { data: legacy, error: legacyErr } = await db
      .from('vocab_words')
      .select('word_id, word_key')
      .in('word_key', keys);
    if (legacyErr) {
      // word_key column may not exist yet on a fresh boot mid-migration — fall through to plain upsert.
      console.warn('bulkUpsertWords legacy lookup:', legacyErr.message);
    } else if (legacy && legacy.length) {
      const keepIds = new Set(chunk.map(function (w) { return w.word_id; }));
      const toDelete = legacy
        .filter(function (row) { return row.word_id && !keepIds.has(row.word_id); })
        .map(function (row) { return row.word_id; });
      if (toDelete.length) {
        const { error: delErr } = await db.from('vocab_words').delete().in('word_id', toDelete);
        if (delErr) throw new Error('Could not clear duplicate word rows: ' + delErr.message);
      }
    }

    const { error } = await db.from('vocab_words').upsert(chunk, { onConflict: 'word_id' });
    if (error) throw new Error('Upload failed: ' + error.message);
    upserted += chunk.length;
  }
  return { ok: true, upserted, total: unique.length, skippedJunk: filtered.skipped.length, skippedJunkWords: filtered.skipped.slice(0, 50) };
}

/**
 * Returns a Set of word_key values that already exist in vocab_words.
 * @param {string[]} words
 */
async function getExistingWordKeys(words) {
  const db = requireDb();
  const wanted = Array.from(new Set(
    (Array.isArray(words) ? words : [])
      .map(function (w) { return wordKeyFor(typeof w === 'string' ? w : (w && w.word)); })
      .filter(Boolean)
  ));
  const found = new Set();
  if (!wanted.length) return found;

  const CHUNK = 200;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const slice = wanted.slice(i, i + CHUNK);
    const { data, error } = await db.from('vocab_words').select('word_key, word').in('word_key', slice);
    if (error) {
      // Fallback before migration: match by exact word strings (case variants included in slice).
      const { data: fallback, error: fbErr } = await db.from('vocab_words').select('word').in('word', slice);
      if (fbErr) throw new Error(fbErr.message);
      (fallback || []).forEach(function (row) { found.add(wordKeyFor(row.word)); });
      continue;
    }
    (data || []).forEach(function (row) {
      found.add(wordKeyFor(row.word_key || row.word));
    });
  }
  return found;
}

/**
 * Boot-safe cleanup: ensure word_key is set and drop duplicate rows (keep newest).
 * word_id canonicalization is handled by migration 014 + subsequent upserts.
 */
async function dedupeVocabWords() {
  const db = requireDb();
  const PAGE = 1000;
  let offset = 0;
  const all = [];
  for (;;) {
    const { data, error } = await db
      .from('vocab_words')
      .select('word_id, word, word_key, updated_at, created_at')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    all.push.apply(all, data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // Backfill missing word_key values.
  let keyed = 0;
  for (let i = 0; i < all.length; i++) {
    const row = all[i];
    const key = wordKeyFor(row.word_key || row.word);
    if (!key) continue;
    if (wordKeyFor(row.word_key) !== key) {
      const { error } = await db.from('vocab_words').update({ word_key: key }).eq('word_id', row.word_id);
      if (!error) {
        row.word_key = key;
        keyed += 1;
      }
    } else {
      row.word_key = key;
    }
  }

  const byKey = new Map();
  all.forEach(function (row) {
    const key = wordKeyFor(row.word_key || row.word);
    if (!key) return;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      return;
    }
    const prevTs = Date.parse(prev.updated_at || prev.created_at || 0) || 0;
    const rowTs = Date.parse(row.updated_at || row.created_at || 0) || 0;
    if (rowTs >= prevTs) byKey.set(key, row);
  });

  const keepIds = new Set(Array.from(byKey.values()).map(function (r) { return r.word_id; }));
  const toDelete = all.filter(function (r) { return !keepIds.has(r.word_id); }).map(function (r) { return r.word_id; });

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 200) {
    const chunk = toDelete.slice(i, i + 200);
    const { error } = await db.from('vocab_words').delete().in('word_id', chunk);
    if (error) throw new Error(error.message);
    deleted += chunk.length;
  }

  return { scanned: all.length, unique: byKey.size, deleted, keyed };
}

async function listWords(opts) {
  const db = requireDb();
  opts = opts || {};
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  let query = db.from('vocab_words').select('word_id, word, part_of_speech, grade_level, tier_name, source, active, updated_at', { count: 'exact' })
    .order('grade_level', { ascending: true })
    .range(offset, offset + limit - 1);
  if (opts.search) {
    query = query.ilike('word', '%' + String(opts.search).trim() + '%');
  }
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { words: data || [], total: count || 0, limit, offset };
}

async function getWordBankStats() {
  const db = requireDb();
  const { count, error } = await db.from('vocab_words').select('word_id', { count: 'exact', head: true }).eq('active', true);
  if (error) throw new Error(error.message);

  const PAGE = 1000;
  let offset = 0;
  const rows = [];
  for (;;) {
    const { data, error: pageErr } = await db
      .from('vocab_words')
      .select('grade_level, tier_name, cloze_question, wrong_options')
      .eq('active', true)
      .range(offset, offset + PAGE - 1);
    if (pageErr) throw new Error(pageErr.message);
    if (!data || !data.length) break;
    rows.push.apply(rows, data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const byGrade = {};
  for (let g = GRADE_MIN; g <= GRADE_MAX; g++) {
    const tier = tierForGrade(g);
    byGrade[g] = {
      gradeLevel: g,
      tierName: tier.name,
      words: 0,
      withQuiz: 0,
      missingQuiz: 0
    };
  }

  rows.forEach(function (row) {
    const g = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(row.grade_level) || GRADE_MIN)));
    const bucket = byGrade[g];
    bucket.words += 1;
    const cloze = String(row.cloze_question || '').trim();
    const wrong = Array.isArray(row.wrong_options) ? row.wrong_options : [];
    if (cloze && wrong.length >= 3) bucket.withQuiz += 1;
    else bucket.missingQuiz += 1;
  });

  const byTier = [];
  for (let g = GRADE_MIN; g <= GRADE_MAX; g++) byTier.push(byGrade[g]);

  return {
    activeCount: count || rows.length,
    withQuizTotal: byTier.reduce(function (sum, t) { return sum + t.withQuiz; }, 0),
    missingQuizTotal: byTier.reduce(function (sum, t) { return sum + t.missingQuiz; }, 0),
    byTier: byTier
  };
}

async function deleteWord(wordId) {
  const db = requireDb();
  wordId = String(wordId || '').trim();
  if (!wordId) throw new Error('wordId is required.');
  const { error } = await db.from('vocab_words').delete().eq('word_id', wordId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function getWordsByIds(wordIds) {
  const db = requireDb();
  const ids = Array.from(new Set((wordIds || []).map(String).filter(Boolean)));
  if (!ids.length) return [];
  const { data, error } = await db.from('vocab_words').select('*').in('word_id', ids);
  if (error) throw new Error(error.message);
  return data || [];
}

async function pickWordsForGrade(gradeLevel, count, excludeIds) {
  const db = requireDb();
  const exclude = new Set((excludeIds || []).map(String));
  const grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(gradeLevel) || 6)));

  async function fetchGrade(g) {
    const { data, error } = await db.from('vocab_words')
      .select('*')
      .eq('active', true)
      .eq('grade_level', g);
    if (error) throw new Error(error.message);
    return (data || []).filter(w => !exclude.has(String(w.word_id)));
  }

  // Prefer the exact grade, then widen to neighboring grades if the pool is thin.
  let pool = await fetchGrade(grade);
  for (let radius = 1; pool.length < count && radius <= GRADE_MAX - GRADE_MIN; radius++) {
    if (grade - radius >= GRADE_MIN) {
      const more = await fetchGrade(grade - radius);
      more.forEach(function (w) { if (!pool.some(p => p.word_id === w.word_id)) pool.push(w); });
    }
    if (grade + radius <= GRADE_MAX) {
      const more = await fetchGrade(grade + radius);
      more.forEach(function (w) { if (!pool.some(p => p.word_id === w.word_id)) pool.push(w); });
    }
  }
  pool.sort((a, b) => Math.abs(a.grade_level - grade) - Math.abs(b.grade_level - grade));
  return pool.slice(0, count);
}

/* ----------------------------- Placement persistence ----------------------------- */

async function savePlacementResult(studentId, classId, result) {
  const db = requireDb();
  studentId = String(studentId);
  classId = classId ? String(classId) : null;
  const row = {
    student_id: studentId,
    class_id: classId,
    grade_level: Math.round(result.gradeLevel),
    tier_name: result.tier && result.tier.name,
    rating_score: RATING_START,
    placement_accuracy: result.accuracy,
    placement_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('vocab_student_state').upsert(row, { onConflict: 'student_id' });
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function getStudentState(studentId) {
  const db = requireDb();
  const { data, error } = await db.from('vocab_student_state').select('*').eq('student_id', String(studentId)).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/* ----------------------------- Class settings ----------------------------- */

async function getClassSettings(classId) {
  const db = requireDb();
  classId = String(classId);
  const { data, error } = await db.from('vocab_class_settings').select('*').eq('class_id', classId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || {
    class_id: classId,
    daily_target: DEFAULT_DAILY_TARGET,
    pass_threshold: DEFAULT_PASS_THRESHOLD,
    reward_tier: DEFAULT_REWARD_TIER
  };
}

async function saveClassSettings(classId, opts) {
  const db = requireDb();
  classId = String(classId);
  opts = opts || {};
  const existing = await getClassSettings(classId);
  const dailyTarget = Math.max(3, Math.min(60, Math.round(Number(opts.dailyTarget) || DEFAULT_DAILY_TARGET)));
  const passThreshold = Math.max(30, Math.min(100, Math.round(Number(opts.passThreshold) || DEFAULT_PASS_THRESHOLD)));
  // reward_tier kept in DB for backwards compat; grants now use rollLuckyPrize.
  const rewardTier = String(opts.rewardTier || existing.reward_tier || DEFAULT_REWARD_TIER).trim() || DEFAULT_REWARD_TIER;
  const row = {
    class_id: classId,
    daily_target: dailyTarget,
    pass_threshold: passThreshold,
    reward_tier: rewardTier,
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('vocab_class_settings').upsert(row, { onConflict: 'class_id' });
  if (error) throw new Error(error.message);
  return row;
}

/* ----------------------------- Daily quest + SRS ----------------------------- */

async function getOrCreateDailyProgress(studentId, classId, dailyTarget) {
  const db = requireDb();
  studentId = String(studentId);
  const date = todayStr();
  const { data: existing, error: readErr } = await db.from('vocab_daily_progress')
    .select('*').eq('student_id', studentId).eq('quest_date', date).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (existing) return existing;

  const row = {
    student_id: studentId,
    class_id: classId ? String(classId) : null,
    quest_date: date,
    target_count: dailyTarget,
    studied_count: 0,
    studied_word_ids: '[]',
    test_attempts: 0,
    test_passed: false
  };
  const { data: inserted, error: insErr } = await db.from('vocab_daily_progress').insert(row).select().maybeSingle();
  if (insErr) throw new Error(insErr.message);
  return inserted || row;
}

async function getDailyQueue(studentId, classId) {
  const db = requireDb();
  studentId = String(studentId);
  const settings = await getClassSettings(classId);
  const state = await getStudentState(studentId);
  if (!state || !state.placement_at) {
    const err = new Error('Finish the Placement test before starting today\'s words.');
    err.code = 'PLACEMENT_REQUIRED';
    throw err;
  }
  const gradeLevel = (state && state.grade_level) || 6;
  const daily = await getOrCreateDailyProgress(studentId, classId, settings.daily_target);

  const nowIso = new Date().toISOString();
  const { data: due, error: dueErr } = await db.from('vocab_student_progress')
    .select('word_id, box, next_due_at')
    .eq('student_id', studentId)
    .lte('next_due_at', nowIso)
    .order('next_due_at', { ascending: true })
    .limit(settings.daily_target);
  if (dueErr) throw new Error(dueErr.message);

  const dueIds = (due || []).map(r => r.word_id);
  let words = await getWordsByIds(dueIds);
  // preserve due order
  words.sort((a, b) => dueIds.indexOf(a.word_id) - dueIds.indexOf(b.word_id));

  if (words.length < settings.daily_target) {
    const { data: seenRows } = await db.from('vocab_student_progress').select('word_id').eq('student_id', studentId);
    const seenIds = (seenRows || []).map(r => r.word_id).concat(dueIds);
    const fresh = await pickWordsForGrade(gradeLevel, settings.daily_target - words.length, seenIds);
    words = words.concat(fresh);
  }

  return {
    date: daily.quest_date,
    targetCount: settings.daily_target,
    passThreshold: settings.pass_threshold,
    studiedCount: daily.studied_count,
    testPassed: !!daily.test_passed,
    testAttempts: daily.test_attempts,
    words: words.slice(0, settings.daily_target)
  };
}

async function recordReview(studentId, classId, wordId, correct) {
  const db = requireDb();
  studentId = String(studentId);
  wordId = String(wordId);
  const { data: existing, error: readErr } = await db.from('vocab_student_progress')
    .select('*').eq('student_id', studentId).eq('word_id', wordId).maybeSingle();
  if (readErr) throw new Error(readErr.message);

  let box = existing ? existing.box : 0;
  box = correct ? Math.min(MAX_BOX, box + 1) : 0;
  const intervalDays = BOX_INTERVAL_DAYS[box];
  const nextDueAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000).toISOString();

  const row = {
    student_id: studentId,
    class_id: classId ? String(classId) : null,
    word_id: wordId,
    box,
    next_due_at: nextDueAt,
    correct_count: (existing ? existing.correct_count : 0) + (correct ? 1 : 0),
    wrong_count: (existing ? existing.wrong_count : 0) + (correct ? 0 : 1),
    last_result: !!correct,
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('vocab_student_progress').upsert(row, { onConflict: 'student_id,word_id' });
  if (error) throw new Error(error.message);

  const settings = await getClassSettings(classId);
  const daily = await getOrCreateDailyProgress(studentId, classId, settings.daily_target);
  const studiedIds = new Set(JSON.parse(daily.studied_word_ids || '[]'));
  studiedIds.add(wordId);
  const studiedList = Array.from(studiedIds);
  const { error: updErr } = await db.from('vocab_daily_progress').update({
    studied_count: studiedList.length,
    studied_word_ids: JSON.stringify(studiedList),
    updated_at: new Date().toISOString()
  }).eq('student_id', studentId).eq('quest_date', daily.quest_date);
  if (updErr) throw new Error(updErr.message);

  return { box, nextDueAt, studiedCount: studiedList.length, targetCount: settings.daily_target };
}

/** Grant a random Lucky Draw ticket (same weighted roll as a student spin). */
async function grantDailyReward(classId, studentId) {
  const { saveLuckyDrawTicket, rollLuckyPrize } = require('./luckyDrawService');
  const rolled = await rollLuckyPrize();
  return saveLuckyDrawTicket(classId, studentId, rolled.tier, rolled.prizeText);
}

/** Tier-scaled Dollar bonus, granted every day the quest test passes (skips $0 tiers). */
async function grantTierDollarBonus(classId, studentId, tierName) {
  const amount = DAILY_DOLLAR_BONUS_BY_TIER[String(tierName || '')] || 0;
  if (amount <= 0) return null;
  await applyDollarAdjustment(classId, studentId, amount, 'Vocab daily quest (' + tierName + ')');
  return { amount, tierName };
}

/**
 * Elo-style rating nudge after a passed daily test, with promotion/demotion at the
 * high/low thresholds (reset rating to the starting value after moving a grade).
 */
async function applyRatingUpdate(studentId, score) {
  const db = requireDb();
  const state = (await getStudentState(studentId)) || {};
  if (!state.placement_at) {
    // Do not invent a tier for students who never finished Placement.
    return {
      gradeLevel: state.grade_level || null,
      tierName: state.tier_name || null,
      ratingScore: state.rating_score != null ? Number(state.rating_score) : null,
      promoted: null
    };
  }
  let grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(state.grade_level) || 6)));
  let rating = Number.isFinite(Number(state.rating_score)) ? Number(state.rating_score) : RATING_START;

  const delta = Math.round((Number(score) - 75) / 5);
  rating += delta;

  let promoted = null;
  if (rating >= RATING_PROMOTE_AT && grade < GRADE_MAX) {
    grade += 1;
    rating = RATING_START;
    promoted = 'up';
  } else if (rating <= RATING_DEMOTE_AT && grade > GRADE_MIN) {
    grade -= 1;
    rating = RATING_START;
    promoted = 'down';
  } else {
    rating = Math.max(0, Math.min(200, rating));
  }

  const tier = tierForGrade(grade);
  const row = {
    student_id: String(studentId),
    grade_level: grade,
    tier_name: tier.name,
    rating_score: rating,
    placement_at: state.placement_at,
    placement_accuracy: state.placement_accuracy,
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('vocab_student_state').upsert(row, { onConflict: 'student_id' });
  if (error) throw new Error(error.message);
  return { gradeLevel: grade, tierName: tier.name, ratingScore: rating, promoted: promoted };
}

async function recordDailyTestResult(studentId, classId, correctCount, totalCount) {
  const db = requireDb();
  studentId = String(studentId);
  const settings = await getClassSettings(classId);
  const state = await getStudentState(studentId);
  if (!state || !state.placement_at) {
    const err = new Error('Finish the Placement test before taking the daily test.');
    err.code = 'PLACEMENT_REQUIRED';
    throw err;
  }
  const daily = await getOrCreateDailyProgress(studentId, classId, settings.daily_target);
  const total = Math.max(1, Number(totalCount) || 0);
  const score = Math.round((Math.max(0, Number(correctCount) || 0) / total) * 1000) / 10;
  const passed = score >= settings.pass_threshold;
  const alreadyPassedToday = !!daily.test_passed;

  const update = {
    test_attempts: (daily.test_attempts || 0) + 1,
    test_score: score,
    test_passed: alreadyPassedToday || passed,
    updated_at: new Date().toISOString()
  };

  let reward = null;
  let dollarBonus = null;
  let streakInfo = null;
  let ratingUpdate = null;
  if (passed && !alreadyPassedToday) {
    update.completed_at = new Date().toISOString();
    try {
      reward = await grantDailyReward(classId, studentId);
      update.reward_ticket_id = reward.ticketId;
    } catch (e) {
      console.error('grantDailyReward failed', e.message || e);
    }
    try {
      ratingUpdate = await applyRatingUpdate(studentId, score);
      dollarBonus = await grantTierDollarBonus(classId, studentId, ratingUpdate.tierName);
    } catch (e) {
      console.error('applyRatingUpdate/grantTierDollarBonus failed', e.message || e);
    }
    streakInfo = await bumpStreak(studentId, daily.quest_date);
  }

  const { error } = await db.from('vocab_daily_progress').update(update)
    .eq('student_id', studentId).eq('quest_date', daily.quest_date);
  if (error) throw new Error(error.message);

  return {
    passed,
    score,
    threshold: settings.pass_threshold,
    reward,
    dollarBonus,
    rating: ratingUpdate,
    streak: streakInfo,
    alreadyPassedToday
  };
}

async function bumpStreak(studentId, questDate) {
  const db = requireDb();
  const state = await getStudentState(studentId) || {};
  const lastDate = state.last_completed_date;
  let streak = state.streak_days || 0;
  if (lastDate && daysBetween(lastDate, questDate) === 1) {
    streak += 1;
  } else if (lastDate === questDate) {
    // already counted today (shouldn't happen given alreadyPassedToday guard)
  } else {
    streak = 1;
  }
  const longest = Math.max(state.longest_streak || 0, streak);
  const row = {
    student_id: String(studentId),
    streak_days: streak,
    longest_streak: longest,
    last_completed_date: questDate,
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('vocab_student_state').upsert(row, { onConflict: 'student_id' });
  if (error) throw new Error(error.message);
  return { streakDays: streak, longestStreak: longest };
}

async function getStudentVocabSummary(studentId, classId) {
  const settings = await getClassSettings(classId);
  const state = await getStudentState(studentId);
  const daily = await getOrCreateDailyProgress(studentId, classId, settings.daily_target);
  const placed = !!(state && state.placement_at);
  return {
    tierName: placed ? state.tier_name : null,
    gradeLevel: placed ? state.grade_level : null,
    ratingScore: placed ? state.rating_score : null,
    streakDays: (state && state.streak_days) || 0,
    longestStreak: (state && state.longest_streak) || 0,
    placementDone: placed,
    placementAt: state && state.placement_at,
    placementAccuracy: placed ? state.placement_accuracy : null,
    today: {
      date: daily.quest_date,
      targetCount: daily.target_count,
      studiedCount: daily.studied_count,
      testPassed: !!daily.test_passed,
      testAttempts: daily.test_attempts,
      testScore: daily.test_score
    },
    settings: {
      dailyTarget: settings.daily_target,
      passThreshold: settings.pass_threshold,
      rewardTier: settings.reward_tier
    }
  };
}

/* ----------------------------- Teacher LMS overview ----------------------------- */

async function getClassOverview(classId) {
  const db = requireDb();
  classId = String(classId);
  const students = await getEnrolledStudents(classId);
  const ids = students.map(s => s.id);
  if (!ids.length) return { students: [], settings: await getClassSettings(classId) };

  const settings = await getClassSettings(classId);
  const date = todayStr();

  const [{ data: states }, { data: dailies }] = await Promise.all([
    db.from('vocab_student_state').select('*').in('student_id', ids),
    db.from('vocab_daily_progress').select('*').in('student_id', ids).eq('quest_date', date)
  ]);

  const stateById = new Map((states || []).map(s => [String(s.student_id), s]));
  const dailyById = new Map((dailies || []).map(d => [String(d.student_id), d]));

  const rows = students.map(function (s) {
    const st = stateById.get(String(s.id));
    const d = dailyById.get(String(s.id));
    const placed = !!(st && st.placement_at);
    return {
      studentId: s.id,
      name: s.name,
      tierName: placed ? st.tier_name : null,
      gradeLevel: placed ? st.grade_level : null,
      ratingScore: placed ? st.rating_score : null,
      streakDays: st ? st.streak_days : 0,
      longestStreak: st ? st.longest_streak : 0,
      placementAt: st ? st.placement_at : null,
      todayStudied: d ? d.studied_count : 0,
      todayTarget: d ? d.target_count : settings.daily_target,
      todayTestPassed: d ? !!d.test_passed : false,
      todayTestScore: d ? d.test_score : null
    };
  });

  return { students: rows, settings };
}

async function overrideStudentState(studentId, opts) {
  const db = requireDb();
  studentId = String(studentId);
  opts = opts || {};
  const patch = { student_id: studentId, updated_at: new Date().toISOString() };
  if (opts.gradeLevel != null) {
    const grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(opts.gradeLevel))));
    patch.grade_level = grade;
    patch.rating_score = RATING_START;
    patch.tier_name = tierForGrade(grade).name;
  }
  // Teacher grade override also unlocks Placement retake.
  if (opts.resetPlacement !== false) {
    patch.placement_at = null;
    patch.placement_accuracy = null;
  }
  const { error } = await db.from('vocab_student_state').upsert(patch, { onConflict: 'student_id' });
  if (error) throw new Error(error.message);
  return { ok: true, placementReset: opts.resetPlacement !== false };
}

async function manualGrantReward(classId, studentId) {
  return grantDailyReward(classId, studentId);
}

/* ----------------------------- AI word-generation jobs ----------------------------- */

function newJobId() {
  return 'genjob_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function createGenerationJob(pendingWords, createdBy) {
  const db = requireDb();
  const id = newJobId();
  const row = {
    id: id,
    status: 'queued',
    total: pendingWords.length,
    completed: 0,
    failed_words: [],
    pending: pendingWords,
    created_by: createdBy ? String(createdBy) : null
  };
  const { error } = await db.from('vocab_gen_jobs').insert(row);
  if (error) throw new Error(error.message);
  return id;
}

async function getGenerationJob(jobId) {
  const db = requireDb();
  const { data, error } = await db.from('vocab_gen_jobs').select('*').eq('id', String(jobId)).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function updateGenerationJob(jobId, patch) {
  const db = requireDb();
  const row = Object.assign({}, patch, { updated_at: new Date().toISOString() });
  const { error } = await db.from('vocab_gen_jobs').update(row).eq('id', String(jobId));
  if (error) throw new Error(error.message);
}

/** Active (queued/running) generation jobs, newest first — used to reattach the teacher UI after refresh. */
async function listActiveGenerationJobs() {
  const db = requireDb();
  const { data, error } = await db
    .from('vocab_gen_jobs')
    .select('id, status, total, completed, failed_words, created_at, updated_at')
    .in('status', ['queued', 'running'])
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return data || [];
}

module.exports = {
  DEFAULT_DAILY_TARGET,
  DEFAULT_PASS_THRESHOLD,
  DEFAULT_REWARD_TIER,
  bulkUpsertWords,
  normalizeWordEntry,
  listWords,
  getWordBankStats,
  deleteWord,
  savePlacementResult,
  getStudentState,
  getClassSettings,
  saveClassSettings,
  getDailyQueue,
  recordReview,
  recordDailyTestResult,
  getStudentVocabSummary,
  getClassOverview,
  overrideStudentState,
  manualGrantReward,
  createGenerationJob,
  getGenerationJob,
  updateGenerationJob,
  listActiveGenerationJobs,
  getExistingWordKeys,
  dedupeVocabWords,
  wordKeyFor,
  wordIdForWord
};
