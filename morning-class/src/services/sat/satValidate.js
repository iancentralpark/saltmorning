'use strict';

/**
 * Cleans a converted SAT question and lists what a person should look at before it is used.
 * Text fields use a small markup: \( \) and \[ \] for LaTeX, a few HTML tags, and [[fig1]]
 * where a cropped figure belongs. A dollar sign is always a literal dollar sign.
 */

const katex = require('katex');
const taxonomy = require('./satTaxonomy');

const MATH_RE = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
const FIG_RE = /\[\[(fig[0-9a-z_-]*)\]\]/gi;
const TAG_RE = /<(\/?)([a-z][a-z0-9]*)>/gi;
const ALLOWED_TAGS = ['u', 'i', 'b', 'sup', 'sub', 'table', 'tr', 'th', 'td'];
const CHOICE_LABELS = ['A', 'B', 'C', 'D'];
const SPR_ANSWER_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+|\d+\/\d+)$/;

const LATEX_WORDS = [
  'frac', 'dfrac', 'tfrac', 'sqrt', 'times', 'cdot', 'div', 'pm', 'mp', 'left', 'right', 'text', 'textbf',
  'mathrm', 'mathbf', 'le', 'ge', 'leq', 'geq', 'neq', 'ne', 'approx', 'pi', 'theta', 'alpha', 'beta',
  'angle', 'triangle', 'overline', 'underline', 'begin', 'end', 'sin', 'cos', 'tan', 'log', 'ln',
  'circ', 'degree', 'infty', 'quad', 'qquad', 'cdots', 'ldots', 'dots', 'sum', 'int', 'lim', 'to',
  'rightarrow', 'parallel', 'perp', 'cong', 'sim', 'hline', 'bar', 'hat', 'vec', 'displaystyle'
].join('|');

/**
 * Undo the usual ways LaTeX gets damaged on its way through JSON: "\frac" read as a form
 * feed plus "rac", "\times" as a tab plus "imes", or every backslash doubled.
 */
function repairText(value) {
  let s = String(value == null ? '' : value);
  s = s
    .replace(/\f/g, '\\f')
    .replace(/\x08/g, '\\b')
    .replace(/\v/g, '\\v')
    .replace(/\r\n/g, '\n')
    .replace(/\r(?=[a-z])/g, '\\r')
    .replace(/\r/g, '\n')
    .replace(/\t(?=[a-z])/g, '\\t')
    .replace(/\t/g, ' ');
  s = s.replace(MATH_RE, (seg) => seg
    .replace(/\n(eq|abla|leq|geq|mid|parallel)(?![a-z])/g, '\\n$1')
    .replace(new RegExp('(^|[^\\\\])\\\\\\\\(' + LATEX_WORDS + ')(?![a-zA-Z])', 'g'), '$1\\$2'));
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mathSegments(text) {
  const out = [];
  String(text || '').replace(MATH_RE, (seg, inline, display) => {
    out.push({ tex: inline != null ? inline : display, display: inline == null });
    return seg;
  });
  return out;
}

function figureRefs(text) {
  const out = [];
  String(text || '').replace(FIG_RE, (m, ref) => {
    out.push(ref.toLowerCase());
    return m;
  });
  return out;
}

function checkMarkup(field, text, flags) {
  const s = String(text || '');
  const opens = (s.match(/\\\(/g) || []).length;
  const closes = (s.match(/\\\)/g) || []).length;
  const dOpens = (s.match(/\\\[/g) || []).length;
  const dCloses = (s.match(/\\\]/g) || []).length;
  if (opens !== closes || dOpens !== dCloses) {
    flags.push({ code: 'math_unbalanced', field: field });
  }
  mathSegments(s).some((seg) => {
    try {
      katex.renderToString(seg.tex, { displayMode: seg.display, throwOnError: true, strict: 'ignore' });
      return false;
    } catch (e) {
      flags.push({ code: 'math_error', field: field, detail: seg.tex.slice(0, 80) });
      return true;
    }
  });

  const outside = s.replace(MATH_RE, ' ');
  if (/\$[^$\n]{1,80}\$/.test(outside) && /\$[^$\n]*[\\^_=][^$\n]*\$/.test(outside)) {
    flags.push({ code: 'dollar_math', field: field });
  }
  const stack = [];
  let bad = false;
  let unknown = '';
  outside.replace(TAG_RE, (m, close, name) => {
    const tag = name.toLowerCase();
    if (ALLOWED_TAGS.indexOf(tag) < 0) {
      unknown = unknown || tag;
      return m;
    }
    if (!close) stack.push(tag);
    else if (stack.pop() !== tag) bad = true;
    return m;
  });
  if (bad || stack.length) flags.push({ code: 'markup_unbalanced', field: field });
  if (unknown) flags.push({ code: 'markup_unknown', field: field, detail: unknown });
}

function plainWords(text) {
  return (String(text || '')
    .replace(MATH_RE, ' ')
    .replace(FIG_RE, ' ')
    .replace(TAG_RE, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z]{3,}/g)) || [];
}

/** Share of the converted words that do not appear in the PDF's own text for those pages. */
function wordDrift(converted, pageText) {
  const source = plainWords(pageText);
  if (source.length < 40) return null;
  const words = plainWords(converted);
  if (words.length < 12) return null;
  const known = new Set(source);
  const missing = words.filter((w) => !known.has(w));
  return { share: missing.length / words.length, sample: Array.from(new Set(missing)).slice(0, 6) };
}

/** What the PDF text layer says for one question, read with plain patterns (no AI). */
function sourceFacts(pageText, sourceId) {
  const text = String(pageText || '');
  const facts = {};
  if (sourceId) facts.id = String(sourceId).toLowerCase();
  const answer = text.match(/Correct Answer:?\s*([^\n]+)/i);
  if (answer) facts.answer = answer[1].trim();
  const difficulty = text.match(/Question Difficulty:?\s*(Easy|Medium|Hard)/i);
  if (difficulty) facts.difficulty = difficulty[1].toLowerCase();
  return facts;
}

function cleanSprAnswer(value) {
  return String(value == null ? '' : value)
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^\\\(|\\\)$/g, '');
}

function splitSprAnswers(value) {
  return String(value == null ? '' : value)
    .split(/,|;|\bor\b/i)
    .map(cleanSprAnswer)
    .filter(Boolean);
}

function normalizeChoices(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 6).map((c, i) => {
    const text = repairText(c && typeof c === 'object' ? c.text : c);
    return { label: CHOICE_LABELS[i] || String.fromCharCode(65 + i), text: text };
  });
}

/**
 * Normalize one question (from the AI or from the review form) and compute its flags.
 * ctx.assetRefs: figure refs that have a stored image. ctx.facts: sourceFacts() result.
 * ctx.pageText: text layer of the unit, only available right after conversion.
 */
function normalizeQuestion(raw, ctx) {
  raw = raw || {};
  ctx = ctx || {};
  const flags = [];

  let section = taxonomy.normalizeSection(raw.section);
  const dom = taxonomy.matchDomain(section, raw.domain);
  let domain = dom.domain;
  if (domain) section = dom.section;
  else domain = String(raw.domain || '').trim();
  let skill = taxonomy.matchSkill(section, domain, raw.skill);
  const skillKnown = !!skill;
  if (!skill) skill = String(raw.skill || '').trim();
  let difficulty = taxonomy.normalizeDifficulty(raw.difficulty);

  const facts = ctx.facts || {};
  if (!difficulty && facts.difficulty) difficulty = facts.difficulty;

  const q = {
    sourceId: String(raw.sourceId || raw.source_id || '').trim().toLowerCase().slice(0, 40),
    section: section,
    domain: domain.slice(0, 120),
    skill: skill.slice(0, 160),
    difficulty: difficulty,
    passage: repairText(raw.passage),
    stem: repairText(raw.stem),
    choices: normalizeChoices(raw.choices),
    answer: '',
    acceptedAnswers: [],
    rationale: repairText(raw.rationale),
    notes: String(raw.notes || '').trim().slice(0, 600)
  };
  q.qtype = q.choices.length ? 'mcq' : 'spr';

  if (!q.section) flags.push({ code: 'section_unknown' });
  if (!dom.domain) flags.push({ code: 'domain_unknown', detail: q.domain });
  else if (!skillKnown) flags.push({ code: 'skill_unknown', detail: q.skill });
  if (!q.difficulty) flags.push({ code: 'difficulty_unknown' });
  if (!q.stem) flags.push({ code: 'no_stem' });

  if (q.qtype === 'mcq') {
    const m = String(raw.answer || '').toUpperCase().match(/\b([A-D])\b/);
    q.answer = m ? m[1] : '';
    if (q.choices.length !== 4) flags.push({ code: 'choices_count', detail: String(q.choices.length) });
    if (q.choices.some((c) => !c.text)) flags.push({ code: 'choice_empty' });
    if (!q.answer) flags.push({ code: 'answer_missing' });
    else if (!q.choices.some((c) => c.label === q.answer)) flags.push({ code: 'answer_invalid' });
    if (q.answer && facts.answer) {
      const printed = facts.answer.toUpperCase().match(/^([A-D])\b/);
      if (printed && printed[1] !== q.answer) flags.push({ code: 'answer_mismatch', detail: printed[1] });
    }
  } else {
    q.answer = String(raw.answer || '').trim().slice(0, 120);
    const accepted = [];
    const add = (v) => {
      const c = cleanSprAnswer(v);
      if (c && accepted.indexOf(c) < 0) accepted.push(c);
    };
    (Array.isArray(raw.acceptedAnswers) ? raw.acceptedAnswers : (raw.accepted_answers || [])).forEach(add);
    splitSprAnswers(q.answer).filter((a) => SPR_ANSWER_RE.test(a)).forEach(add);
    q.acceptedAnswers = accepted.slice(0, 12);
    if (!q.answer && !q.acceptedAnswers.length) flags.push({ code: 'answer_missing' });
    else if (!q.acceptedAnswers.length) flags.push({ code: 'spr_no_accepted' });
    const odd = q.acceptedAnswers.find((a) => !SPR_ANSWER_RE.test(a));
    if (odd) flags.push({ code: 'spr_answer_format', detail: odd });
    if (facts.answer && q.acceptedAnswers.length) {
      const printed = splitSprAnswers(facts.answer).filter((a) => SPR_ANSWER_RE.test(a));
      if (printed.length && !printed.some((a) => q.acceptedAnswers.indexOf(a) >= 0)) {
        flags.push({ code: 'answer_mismatch', detail: facts.answer.slice(0, 40) });
      }
    }
  }

  if (facts.id && q.sourceId && facts.id !== q.sourceId) {
    flags.push({ code: 'id_mismatch', detail: facts.id });
  }
  if (facts.difficulty && q.difficulty && facts.difficulty !== q.difficulty) {
    flags.push({ code: 'difficulty_mismatch', detail: facts.difficulty });
  }

  checkMarkup('passage', q.passage, flags);
  checkMarkup('stem', q.stem, flags);
  q.choices.forEach((c) => checkMarkup('choice ' + c.label, c.text, flags));
  checkMarkup('rationale', q.rationale, flags);

  const used = []
    .concat(figureRefs(q.passage), figureRefs(q.stem), figureRefs(q.rationale))
    .concat(...q.choices.map((c) => figureRefs(c.text)));
  if (ctx.assetRefs) {
    const have = ctx.assetRefs.map((r) => String(r).toLowerCase());
    const missing = used.filter((r) => have.indexOf(r) < 0);
    if (missing.length) flags.push({ code: 'fig_missing', detail: Array.from(new Set(missing)).join(', ') });
    const unused = have.filter((r) => used.indexOf(r) < 0);
    if (unused.length) flags.push({ code: 'fig_unused', detail: unused.join(', ') });
  }

  if (ctx.pageText) {
    const body = [q.passage, q.stem].concat(q.choices.map((c) => c.text)).join('\n');
    const d1 = wordDrift(body, ctx.pageText);
    const d2 = wordDrift(q.rationale, ctx.pageText);
    const worst = [d1, d2].filter(Boolean).sort((a, b) => b.share - a.share)[0];
    if (worst && worst.share > 0.12) {
      flags.push({ code: 'text_drift', detail: worst.sample.join(', ') });
    }
  }
  if (q.notes) flags.push({ code: 'model_note', detail: q.notes.slice(0, 200) });
  (ctx.extraFlags || []).forEach((f) => flags.push(f));

  return { question: q, flags: flags };
}

module.exports = {
  normalizeQuestion,
  repairText,
  sourceFacts,
  figureRefs,
  mathSegments,
  wordDrift,
  ALLOWED_TAGS,
  CHOICE_LABELS
};
