/**
 * Cloze blank helpers — stem-aware replacement so conjugated forms
 * (juxtaposes / running / happily) do not leak the answer in the prompt.
 */

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWord(word) {
  return String(word || '').trim();
}

/**
 * Build regex alternatives for a headword plus common English inflections.
 * @param {string} word
 * @returns {RegExp|null}
 */
function wordFormRegex(word) {
  const w = normalizeWord(word);
  if (!w) return null;
  const lower = w.toLowerCase();
  const forms = new Set([lower]);

  // Plural / 3sg
  forms.add(lower + 's');
  forms.add(lower + 'es');
  if (lower.endsWith('y') && lower.length > 1 && !/[aeiou]y$/.test(lower)) {
    forms.add(lower.slice(0, -1) + 'ies');
  }
  if (lower.endsWith('f')) forms.add(lower.slice(0, -1) + 'ves');
  if (lower.endsWith('fe')) forms.add(lower.slice(0, -2) + 'ves');

  // Past / participle / gerund
  forms.add(lower + 'ed');
  forms.add(lower + 'd');
  forms.add(lower + 'ing');
  if (lower.endsWith('e') && lower.length > 1) {
    forms.add(lower.slice(0, -1) + 'ing');
    forms.add(lower + 'd');
  }
  if (lower.endsWith('y') && lower.length > 1 && !/[aeiou]y$/.test(lower)) {
    forms.add(lower.slice(0, -1) + 'ied');
  }
  // Doubled consonant + ing/ed (run → running) — heuristic for short stems
  if (/[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(lower) && lower.length <= 6) {
    const last = lower[lower.length - 1];
    forms.add(lower + last + 'ing');
    forms.add(lower + last + 'ed');
  }

  // Comparative / adverb
  forms.add(lower + 'er');
  forms.add(lower + 'est');
  forms.add(lower + 'ly');
  if (lower.endsWith('y') && lower.length > 1) {
    forms.add(lower.slice(0, -1) + 'ier');
    forms.add(lower.slice(0, -1) + 'iest');
    forms.add(lower.slice(0, -1) + 'ily');
  }

  const alts = Array.from(forms)
    .filter(Boolean)
    .sort(function (a, b) { return b.length - a.length; })
    .map(escapeRegExp);
  if (!alts.length) return null;
  return new RegExp('\\b(?:' + alts.join('|') + ')\\b', 'gi');
}

/**
 * True if `text` still contains the headword or a common inflection.
 */
function textLeaksWord(text, word) {
  const re = wordFormRegex(word);
  if (!re) return false;
  return re.test(String(text || ''));
}

/**
 * Replace all headword forms in a sentence with ______.
 * Returns { prompt, leaked } — leaked true if stem still visible after blanking.
 */
function blankWordInText(text, word) {
  const raw = String(text || '').trim().replace(/^\s*Fill the blank:\s*/i, '').trim();
  const w = normalizeWord(word);
  if (!raw) {
    return { prompt: 'Choose the word that fits: ______', leaked: false };
  }
  const re = wordFormRegex(w);
  if (!re) {
    return { prompt: raw, leaked: true };
  }
  let prompt = raw.replace(re, '______');
  // Collapse accidental double blanks / leftover "(______)" after stem replace
  prompt = prompt.replace(/(?:______)(\s*______)+/g, '______');
  prompt = prompt.replace(/\s*\(______\)\s*$/g, '').trim();
  if (prompt.indexOf('______') < 0) {
    prompt = prompt + ' (______)';
  }
  const leaked = textLeaksWord(prompt, w);
  return { prompt: prompt, leaked: leaked };
}

/**
 * Prefer a stored cloze_question if it does not leak; else blank example_sentence;
 * else return null (caller should fall back to another question type).
 */
function buildClozePrompt(wordRow) {
  const word = normalizeWord(wordRow && (wordRow.word || wordRow.correct));
  const cloze = String((wordRow && wordRow.cloze_question) || '').trim();
  const example = String(
    (wordRow && (wordRow.example_sentence || wordRow.exampleSentence)) || ''
  ).trim();

  if (cloze) {
    const fromCloze = blankWordInText(cloze, word);
    if (!fromCloze.leaked && fromCloze.prompt.indexOf('______') >= 0) {
      return fromCloze.prompt;
    }
  }
  if (example) {
    const fromEx = blankWordInText(example, word);
    if (!fromEx.leaked && fromEx.prompt.indexOf('______') >= 0) {
      return fromEx.prompt;
    }
  }
  // levels.intermediate.examples fallback (legacy / mock)
  const L = (wordRow && wordRow.levels) || {};
  const mid = L.intermediate || {};
  const legacyEx = mid.examples && mid.examples[0];
  if (legacyEx) {
    const fromLegacy = blankWordInText(String(legacyEx), word);
    if (!fromLegacy.leaked && fromLegacy.prompt.indexOf('______') >= 0) {
      return fromLegacy.prompt;
    }
  }
  return null;
}

module.exports = {
  escapeRegExp,
  wordFormRegex,
  textLeaksWord,
  blankWordInText,
  buildClozePrompt
};
