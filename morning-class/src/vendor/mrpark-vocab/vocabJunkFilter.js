/**
 * Filters title-like list headers and closed-class function words out of the
 * vocab word bank / upload pipeline. ESL academic vocab should be content words.
 */

/** Exact-match closed-class / filler tokens (lowercase). */
const STOP_WORDS = new Set([
  'a', 'an', 'the',
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'doing', 'done',
  'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'over', 'up', 'down', 'out', 'off', 'again', 'further', 'then', 'once',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'not', 'no', 'yes',
  'if', 'because', 'while', 'although', 'though', 'unless', 'until', 'than', 'as',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'all', 'each', 'every', 'few', 'more', 'most', 'other', 'some', 'such', 'any',
  'own', 'same', 'too', 'very', 'just', 'also', 'only', 'even', 'still',
  'here', 'there', 'now',
  'oh', 'uh', 'um', 'ok', 'okay', 'hi', 'hey', 'bye'
]);

const TITLE_RE = /^(vocabulary|vocab|spelling|word)\s+words?\b/i;
const TITLE_META_RE = /\b(vocabulary|vocab|word\s*list|spelling\s*list|quizlet)\b/i;
const GRADE_META_RE = /\b(\d{1,2}(st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|grade|graders?)\b/i;

function normalizeKey(word) {
  return String(word || '').trim().toLowerCase();
}

function tokenCount(word) {
  const parts = String(word || '').trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

/**
 * @returns {null|{reason: string, detail: string}}
 */
function classifyJunk(word) {
  const raw = String(word || '').trim();
  if (!raw) return { reason: 'empty', detail: 'blank' };
  const key = normalizeKey(raw);
  const tokens = tokenCount(raw);

  if (STOP_WORDS.has(key)) {
    return { reason: 'stopword', detail: 'function / filler word' };
  }

  // "Vocabulary Words 12th Grade", "Vocab List Unit 3", etc.
  if (TITLE_RE.test(raw)) {
    return { reason: 'title', detail: 'list header, not a word' };
  }
  if (tokens >= 3 && TITLE_META_RE.test(raw) && GRADE_META_RE.test(raw)) {
    return { reason: 'title', detail: 'list header, not a word' };
  }
  if (tokens >= 4 && GRADE_META_RE.test(raw) && /\bwords?\b/i.test(raw)) {
    return { reason: 'title', detail: 'list header, not a word' };
  }

  return null;
}

function isJunkWord(word) {
  return !!classifyJunk(word);
}

/**
 * @param {Array<string|{word:string}>} words
 * @returns {{ keep: Array, skipped: Array<{word:string, reason:string, detail:string}> }}
 */
function filterJunkWords(words) {
  const keep = [];
  const skipped = [];
  const seen = new Set();
  (Array.isArray(words) ? words : []).forEach(function (item) {
    const word = String((item && item.word) != null ? item.word : item || '').trim();
    if (!word) return;
    const key = normalizeKey(word);
    if (seen.has(key)) return;
    seen.add(key);
    const junk = classifyJunk(word);
    if (junk) {
      skipped.push({ word: word, reason: junk.reason, detail: junk.detail });
      return;
    }
    if (item && typeof item === 'object') keep.push(item);
    else keep.push(word);
  });
  return { keep: keep, skipped: skipped };
}

module.exports = {
  STOP_WORDS,
  classifyJunk,
  isJunkWord,
  filterJunkWords,
  normalizeKey
};
