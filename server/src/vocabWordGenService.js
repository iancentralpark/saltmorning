/**
 * AI Vocab Word Generator — takes a raw word list (from paste / CSV / Excel upload)
 * and batch-calls Gemini to fill in the full vocab_words schema: definitions, Korean
 * meaning, example sentence, synonyms/antonyms, and a pre-baked cloze quiz + 3
 * distractor options. Runs as a resumable in-process background job (single Railway
 * instance, no extra infra) so large word lists don't block the upload HTTP request.
 */
const { isGeminiConfigured, askGemini } = require('./geminiService');
const { GRADE_MIN, GRADE_MAX } = require('./vocabPlacementService');

const BATCH_SIZE = 25;
const MAX_BATCH_RETRIES = 1;

function requiredNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function normalizeKey(word) {
  return String(word || '').trim().toLowerCase();
}

function buildSystemPrompt() {
  return (
    'You are an expert ESL / US K-12 curriculum assessment specialist. ' +
    'Your task is to generate highly accurate, student-friendly vocabulary quiz data in pure JSON format ' +
    'based on the provided word list. ALWAYS output ONLY a valid JSON array, with no markdown formatting, ' +
    'intro, or outro text.'
  );
}

function buildUserPrompt(batch) {
  const lines = batch.map(function (item, i) {
    const hint = item.gradeLevel ? ' (target US grade level: ' + item.gradeLevel + ')' : '';
    return (i + 1) + '. ' + item.word + hint;
  });
  return (
    'Target Audience: ESL / International School students, US Grade ' + GRADE_MIN + '-' + GRADE_MAX + '.\n' +
    'Process the following word list and return a JSON array with one object per word, in the same order.\n\n' +
    '[Word List]\n' + lines.join('\n') + '\n\n' +
    '[JSON object schema per word]\n' +
    '1. "word": (string) the exact word as given\n' +
    '2. "grade_level": (integer 1-' + GRADE_MAX + ') the most likely US grade level for this word\'s difficulty. ' +
    'Use the target grade level given in parentheses above when provided; otherwise estimate it yourself.\n' +
    '3. "part_of_speech": (string) e.g. "verb", "noun", "adjective"\n' +
    '4. "pronunciation": (string) simple phonetic spelling (not strict IPA)\n' +
    '5. "simple_definition": (string) easy-to-understand English definition suitable for that grade level\n' +
    '6. "korean_meaning": (string) accurate, natural Korean translation\n' +
    '7. "example_sentence": (string) one natural US textbook-style sentence containing the word\n' +
    '8. "synonyms": (array of strings) 2-3 accurate synonyms (empty array if none fit)\n' +
    '9. "antonyms": (array of strings) 1-2 antonyms if applicable, else an empty array\n' +
    '10. "cloze_question": (string) the example_sentence with the target word replaced by "______"\n' +
    '11. "wrong_options": (array of EXACTLY 3 strings) plausible but incorrect distractor words, ' +
    'same part of speech, appropriate for that grade level\n' +
    '12. "explanation_for_wrong": (string) a gentle 1-2 sentence explanation IN KOREAN of why the correct ' +
    'word fits best, shown to a student who answers wrong\n\n' +
    'Generate the pure JSON array now, with exactly ' + batch.length + ' objects in the same order as the word list.'
  );
}

function validateEntry(entry, expectedWord) {
  if (!entry || typeof entry !== 'object') return 'not an object';
  if (normalizeKey(entry.word) !== normalizeKey(expectedWord)) return 'word mismatch';
  const grade = Number(entry.grade_level);
  if (!Number.isFinite(grade) || grade < GRADE_MIN || grade > GRADE_MAX) return 'bad grade_level';
  if (!requiredNonEmptyString(entry.simple_definition)) return 'missing simple_definition';
  if (!requiredNonEmptyString(entry.korean_meaning)) return 'missing korean_meaning';
  if (!requiredNonEmptyString(entry.example_sentence)) return 'missing example_sentence';
  if (!requiredNonEmptyString(entry.cloze_question)) return 'missing cloze_question';
  if (!Array.isArray(entry.wrong_options) || entry.wrong_options.length !== 3) return 'wrong_options must have exactly 3 items';
  if (entry.wrong_options.some(function (o) { return !requiredNonEmptyString(o); })) return 'empty wrong_option';
  return null;
}

function extractJsonArray(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

/**
 * Call Gemini once for a batch of words, returning { okEntries: [normalized word rows],
 * failedWords: [{ word, reason }] }.
 */
async function generateBatch(batch) {
  if (!isGeminiConfigured()) {
    return { okEntries: [], failedWords: batch.map(function (b) { return { word: b.word, reason: 'Gemini not configured' }; }) };
  }

  let attempt = 0;
  let entries = null;
  let lastErr = 'no response';
  while (attempt <= MAX_BATCH_RETRIES && !entries) {
    attempt += 1;
    try {
      const result = await askGemini(buildUserPrompt(batch), [], {
        model: process.env.VOCAB_GEN_MODEL || 'gemini-2.5-flash',
        fallbackModels: ['gemini-2.5-flash-lite'],
        systemInstruction: buildSystemPrompt(),
        temperature: 0.4,
        maxOutputTokens: Math.min(8192, batch.length * 320 + 400),
        timeoutMs: 60000,
        skipQuotaSleep: false,
        overloadRetries: 2,
        overloadRetryDelayMs: 2500,
        audience: 'teacher'
      });
      if (!result || !result.ok) {
        lastErr = (result && result.error) || 'Gemini call failed';
        continue;
      }
      const parsed = extractJsonArray(result.answer);
      if (!parsed) {
        lastErr = 'Could not parse JSON array from AI response';
        continue;
      }
      entries = parsed;
    } catch (err) {
      lastErr = err.message || String(err);
    }
  }

  if (!entries) {
    return { okEntries: [], failedWords: batch.map(function (b) { return { word: b.word, reason: lastErr }; }) };
  }

  const byWord = new Map();
  entries.forEach(function (e) {
    if (e && e.word) byWord.set(normalizeKey(e.word), e);
  });

  const okEntries = [];
  const failedWords = [];
  batch.forEach(function (item) {
    const entry = byWord.get(normalizeKey(item.word)) || entries[batch.indexOf(item)];
    const problem = validateEntry(entry, item.word);
    if (problem) {
      failedWords.push({ word: item.word, reason: problem });
      return;
    }
    okEntries.push({
      word: item.word,
      grade_level: Math.round(Number(entry.grade_level)),
      part_of_speech: String(entry.part_of_speech || '').trim(),
      pronunciation: String(entry.pronunciation || '').trim(),
      simple_definition: String(entry.simple_definition).trim(),
      korean_meaning: String(entry.korean_meaning).trim(),
      example_sentence: String(entry.example_sentence).trim(),
      synonyms: Array.isArray(entry.synonyms) ? entry.synonyms.map(String) : [],
      antonyms: Array.isArray(entry.antonyms) ? entry.antonyms.map(String) : [],
      cloze_question: String(entry.cloze_question).trim(),
      wrong_options: entry.wrong_options.map(String),
      explanation_for_wrong: String(entry.explanation_for_wrong || '').trim(),
      source: 'ai_generated'
    });
  });

  return { okEntries, failedWords };
}

async function processJobTick(jobId) {
  const { getGenerationJob, updateGenerationJob, bulkUpsertWords } = require('./vocabLearningService');
  const job = await getGenerationJob(jobId);
  if (!job || job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return;

  const pending = Array.isArray(job.pending) ? job.pending : [];
  if (!pending.length) {
    await updateGenerationJob(jobId, { status: 'done' });
    return;
  }

  if (job.status !== 'running') {
    await updateGenerationJob(jobId, { status: 'running' });
  }

  // Skip words another concurrent job (or a prior upload) already wrote to the bank.
  const { getExistingWordKeys } = require('./vocabLearningService');
  let existingKeys = new Set();
  try {
    existingKeys = await getExistingWordKeys(pending.map(function (p) { return p.word; }));
  } catch (err) {
    console.warn('processJobTick existing lookup', err.message || err);
  }

  const stillPending = [];
  let skippedNow = 0;
  pending.forEach(function (item) {
    const key = normalizeKey(item.word);
    if (existingKeys.has(key)) skippedNow += 1;
    else stillPending.push(item);
  });

  if (!stillPending.length) {
    await updateGenerationJob(jobId, {
      completed: (job.completed || 0) + skippedNow,
      pending: [],
      status: 'done'
    });
    return;
  }

  const batch = stillPending.slice(0, BATCH_SIZE);
  const rest = stillPending.slice(BATCH_SIZE);

  let result;
  try {
    result = await generateBatch(batch);
  } catch (err) {
    result = { okEntries: [], failedWords: batch.map(function (b) { return { word: b.word, reason: err.message || String(err) }; }) };
  }

  if (result.okEntries.length) {
    try {
      await bulkUpsertWords(result.okEntries);
    } catch (err) {
      // Upsert failure: move this whole batch to failed so it's visible, not silently dropped.
      result.failedWords = result.failedWords.concat(
        result.okEntries.map(function (e) { return { word: e.word, reason: 'DB upsert failed: ' + (err.message || err) }; })
      );
      result.okEntries = [];
    }
  }

  // Re-check status right before writing: a teacher may have cancelled this job while the
  // (uninterruptible) Gemini batch call above was in flight. Don't resurrect a cancelled job.
  const fresh = await getGenerationJob(jobId);
  if (!fresh || fresh.status === 'cancelled') return;

  const updatedFailed = (Array.isArray(job.failed_words) ? job.failed_words : []).concat(result.failedWords);
  await updateGenerationJob(jobId, {
    completed: (job.completed || 0) + result.okEntries.length + result.failedWords.length + skippedNow,
    failed_words: updatedFailed,
    pending: rest,
    status: rest.length ? 'running' : 'done'
  });

  if (rest.length) {
    setImmediate(function () { processJobTick(jobId).catch(function (err) { console.error('processJobTick', err); }); });
  }
}

/**
 * Kick off a background generation job for a raw word list.
 * @param {Array<{word: string, gradeLevel?: number}>} words
 * @param {string} createdBy teacher identifier, for auditing
 * @returns {Promise<string>} jobId
 */
async function startGenerationJob(words, createdBy) {
  const { createGenerationJob, getExistingWordKeys } = require('./vocabLearningService');
  const { filterJunkWords, normalizeKey: junkKey } = require('./vocabJunkFilter');
  const filtered = filterJunkWords(Array.isArray(words) ? words : []);
  const seen = new Set();
  const candidates = [];
  filtered.keep.forEach(function (w) {
    const word = String((w && w.word) || w || '').trim();
    if (!word) return;
    const key = junkKey(word);
    if (seen.has(key)) return;
    seen.add(key);
    const gradeLevel = Number(w && w.gradeLevel);
    candidates.push({
      word: word,
      gradeLevel: Number.isFinite(gradeLevel) && gradeLevel >= GRADE_MIN && gradeLevel <= GRADE_MAX ? Math.round(gradeLevel) : null
    });
  });
  const skippedJunk = filtered.skipped.length;
  if (!candidates.length) {
    const err = new Error(
      skippedJunk
        ? ('No usable words left after skipping ' + skippedJunk + ' title/stopword entr' + (skippedJunk === 1 ? 'y' : 'ies') + '.')
        : 'No valid words provided.'
    );
    err.skippedJunk = skippedJunk;
    err.skippedJunkWords = filtered.skipped.slice(0, 50);
    throw err;
  }
  if (candidates.length > 8000) throw new Error('Too many words in one upload (max 8000). Split into batches.');

  let existingKeys = new Set();
  try {
    existingKeys = await getExistingWordKeys(candidates.map(function (c) { return c.word; }));
  } catch (err) {
    console.warn('startGenerationJob existing lookup', err.message || err);
  }
  const pending = candidates.filter(function (c) { return !existingKeys.has(normalizeKey(c.word)); });
  const skippedExisting = candidates.length - pending.length;
  if (!pending.length) {
    const err = new Error(
      'All ' + candidates.length + ' word(s) already exist in the word bank. Nothing new to generate.'
    );
    err.skippedExisting = skippedExisting;
    err.skippedJunk = skippedJunk;
    throw err;
  }

  const jobId = await createGenerationJob(pending, createdBy);
  setImmediate(function () { processJobTick(jobId).catch(function (err) { console.error('processJobTick', err); }); });
  return { jobId, total: pending.length, skippedExisting, skippedJunk, skippedJunkWords: filtered.skipped.slice(0, 50) };
}

/** Teacher-initiated stop. Safe even while a batch is mid-flight (see the re-check in processJobTick). */
async function cancelGenerationJob(jobId) {
  const { updateGenerationJob, getGenerationJob } = require('./vocabLearningService');
  const job = await getGenerationJob(jobId);
  if (!job) throw new Error('Job not found.');
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return { ok: true, alreadyStopped: true };
  await updateGenerationJob(jobId, { status: 'cancelled' });
  return { ok: true };
}

/**
 * Resume any jobs left "running" in the DB after a server restart (e.g. a deploy) — the
 * in-process setImmediate loop that was driving them dies with the old process, but the
 * pending queue is persisted, so we just need to kick each one off again.
 */
async function resumePendingJobs() {
  const { getSupabase, isSupabaseEnabled } = require('./supabaseClient');
  if (!isSupabaseEnabled()) return;
  const db = getSupabase();

  try {
    const { dedupeVocabWords } = require('./vocabLearningService');
    const dedupe = await dedupeVocabWords();
    if (dedupe && (dedupe.deleted || dedupe.renamed)) {
      console.log('[vocab-gen] dedupe on boot', dedupe);
    }
  } catch (err) {
    console.warn('[vocab-gen] dedupe on boot failed:', err.message || err);
  }

  const { data, error } = await db.from('vocab_gen_jobs').select('id').eq('status', 'running');
  if (error) {
    console.error('resumePendingJobs', error.message);
    return;
  }
  (data || []).forEach(function (row) {
    console.log('[vocab-gen] resuming job after restart:', row.id);
    setImmediate(function () { processJobTick(row.id).catch(function (err) { console.error('processJobTick', err); }); });
  });
}

module.exports = {
  startGenerationJob,
  cancelGenerationJob,
  resumePendingJobs,
  BATCH_SIZE
};
