'use strict';

/** Pure rules of the SAT mock test: structure, set composition, grading, routing and score estimate. */

const crypto = require('crypto');

const STEPS = ['rw1', 'rw2', 'break', 'm1', 'm2'];
const MODULE_STEPS = ['rw1', 'rw2', 'm1', 'm2'];
// Keys of the module lists stored in a set. The second module of each section has two versions.
const MODULE_KEYS = ['rw1', 'rw2e', 'rw2h', 'm1', 'm2e', 'm2h'];
const ROUTE_THRESHOLD = 0.65;

const FULL_STRUCTURE = {
  modules: {
    rw1: { count: 27, minutes: 32 },
    rw2: { count: 27, minutes: 32 },
    m1: { count: 22, minutes: 35 },
    m2: { count: 22, minutes: 35 }
  },
  breakMinutes: 10
};

const MINI_STRUCTURE = {
  modules: {
    rw1: { count: 9, minutes: 11 },
    rw2: { count: 9, minutes: 11 },
    m1: { count: 8, minutes: 13 },
    m2: { count: 8, minutes: 13 }
  },
  breakMinutes: 2
};

// Share of each content domain in a section, from the Digital SAT test specification.
const DOMAIN_WEIGHTS = {
  rw: [
    ['Craft and Structure', 0.28],
    ['Information and Ideas', 0.26],
    ['Standard English Conventions', 0.26],
    ['Expression of Ideas', 0.2]
  ],
  math: [
    ['Algebra', 0.35],
    ['Advanced Math', 0.35],
    ['Problem-Solving and Data Analysis', 0.15],
    ['Geometry and Trigonometry', 0.15]
  ]
};

const DIFFICULTY_MIX = {
  mixed: { easy: 0.3, medium: 0.4, hard: 0.3 },
  easy: { easy: 0.5, medium: 0.4, hard: 0.1 },
  hard: { easy: 0.1, medium: 0.4, hard: 0.5 }
};
const DIFFICULTY_ORDER = {
  easy: ['easy', 'medium', 'hard'],
  medium: ['medium', 'easy', 'hard'],
  hard: ['hard', 'medium', 'easy']
};

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeStructure(input) {
  const src = (input && input.modules) || {};
  const out = { modules: {}, breakMinutes: clampInt(input && input.breakMinutes, 0, 30, 10) };
  MODULE_STEPS.forEach((step) => {
    const base = FULL_STRUCTURE.modules[step];
    const given = src[step] || {};
    out.modules[step] = {
      count: clampInt(given.count, 1, 60, base.count),
      minutes: clampInt(given.minutes, 1, 120, base.minutes)
    };
  });
  return out;
}

function sectionOfStep(step) {
  return step === 'rw1' || step === 'rw2' ? 'rw' : 'math';
}

/** The key of the module list a student gets at this step, given the routes decided so far. */
function moduleKeyFor(step, routes) {
  if (step === 'rw1' || step === 'm1') return step;
  if (step === 'rw2') return routes.rw === 'hard' ? 'rw2h' : 'rw2e';
  if (step === 'm2') return routes.math === 'hard' ? 'm2h' : 'm2e';
  return '';
}

function structureKeyCount(structure, key) {
  const step = key.replace(/[eh]$/, '');
  return structure.modules[step].count;
}

function nextStep(step) {
  const i = STEPS.indexOf(step);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : 'done';
}

function routeFor(correct, total) {
  if (!total) return 'easy';
  return correct / total >= ROUTE_THRESHOLD - 1e-9 ? 'hard' : 'easy';
}

// ---------------------------------------------------------------- composing

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** Split `total` over weighted buckets so the parts add up exactly (largest remainder). */
function apportion(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map(Math.floor);
  let left = total - base.reduce((s, n) => s + n, 0);
  raw
    .map((r, i) => ({ i: i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach((x) => {
      if (left > 0) {
        base[x.i]++;
        left--;
      }
    });
  return base;
}

/**
 * Pick questions for the requested module lists.
 * pool: approved questions [{ id, section, domain, difficulty }]; used: ids already in the set.
 * Returns { items: { key: [questionId] }, notes: { key: { relaxed, short } } }.
 */
function composeModules(pool, structure, keys, used) {
  const taken = new Set(used || []);
  const items = {};
  const notes = {};
  const bySection = { rw: [], math: [] };
  shuffle(pool).forEach((q) => {
    if (bySection[q.section]) bySection[q.section].push(q);
  });

  keys.forEach((key) => {
    const section = key.indexOf('rw') === 0 ? 'rw' : 'math';
    const count = structureKeyCount(structure, key);
    const mix = DIFFICULTY_MIX[/e$/.test(key) ? 'easy' : /h$/.test(key) ? 'hard' : 'mixed'];
    const domains = DOMAIN_WEIGHTS[section];
    const quotas = apportion(count, domains.map((d) => d[1]));
    const picked = [];
    let relaxed = 0;

    const take = (filter) => {
      const q = bySection[section].find((x) => !taken.has(x.id) && filter(x));
      if (!q) return null;
      taken.add(q.id);
      picked.push(q.id);
      return q;
    };

    domains.forEach((d, di) => {
      const diffs = ['easy', 'medium', 'hard'];
      const wants = apportion(quotas[di], diffs.map((x) => mix[x]));
      diffs.forEach((diff, i) => {
        for (let n = 0; n < wants[i]; n++) {
          let q = take((x) => x.domain === d[0] && x.difficulty === diff);
          if (!q) {
            for (const alt of DIFFICULTY_ORDER[diff]) {
              q = take((x) => x.domain === d[0] && x.difficulty === alt);
              if (q) break;
            }
            if (q) relaxed++;
          }
        }
      });
    });

    let short = 0;
    while (picked.length < count) {
      let q = null;
      for (const diff of ['medium', 'easy', 'hard']) {
        q = take((x) => x.difficulty === diff);
        if (q) break;
      }
      if (!q) q = take(() => true);
      if (!q) break;
      relaxed++;
    }
    short = count - picked.length;
    items[key] = picked;
    notes[key] = { relaxed: relaxed, short: short };
  });
  return { items: items, notes: notes };
}

// ------------------------------------------------------------------ grading

function sprText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, '')
    .trim();
}

function sprNumber(value) {
  const t = sprText(value);
  let m = t.match(/^(-?)(\d+)\/(\d+)$/);
  if (m) {
    const den = Number(m[3]);
    if (!den) return null;
    return (m[1] ? -1 : 1) * (Number(m[2]) / den);
  }
  m = t.match(/^-?(\d+\.?\d*|\.\d+)$/);
  if (m) return Number(t);
  return null;
}

function gradeAnswer(question, given) {
  const answer = String(given == null ? '' : given).trim();
  if (!answer) return false;
  if (question.qtype === 'mcq') return answer.toUpperCase() === String(question.answer || '').toUpperCase();
  const accepted = [].concat(question.accepted_answers || [], question.answer ? [question.answer] : []);
  const typed = sprText(answer);
  const typedNum = sprNumber(answer);
  return accepted.some((a) => {
    if (sprText(a) === typed) return true;
    const an = sprNumber(a);
    return typedNum !== null && an !== null && Math.abs(an - typedNum) <= 1e-9 * Math.max(1, Math.abs(an));
  });
}

/** What the answer box accepts: up to 5 characters, 6 with a leading minus. */
function cleanSprInput(value) {
  const t = String(value == null ? '' : value).replace(/[\u2212\u2013\u2014]/g, '-').replace(/[^0-9./-]/g, '');
  const neg = t.charAt(0) === '-';
  const rest = t.replace(/-/g, '');
  return (neg ? '-' : '') + rest.slice(0, 5);
}

// ------------------------------------------------------------------ scoring

/**
 * Estimated section score (200-800). College Board does not publish its conversion tables,
 * so this is a plain line per route: the easier second module tops out at 620, as the
 * published score reports describe, and the harder one reaches 800.
 */
function estimateSectionScore(route, correct, total) {
  if (!total) return null;
  const frac = Math.max(0, Math.min(1, correct / total));
  const raw = route === 'hard' ? 300 + 500 * frac : 200 + 420 * frac;
  return Math.max(200, Math.min(800, Math.round(raw / 10) * 10));
}

function scoreFromTable(points, correct) {
  if (!Array.isArray(points) || points[correct] == null) return null;
  const n = Number(points[correct]);
  return isFinite(n) ? n : null;
}

module.exports = {
  STEPS,
  MODULE_STEPS,
  MODULE_KEYS,
  ROUTE_THRESHOLD,
  FULL_STRUCTURE,
  MINI_STRUCTURE,
  DOMAIN_WEIGHTS,
  normalizeStructure,
  sectionOfStep,
  moduleKeyFor,
  structureKeyCount,
  nextStep,
  routeFor,
  apportion,
  composeModules,
  gradeAnswer,
  cleanSprInput,
  sprNumber,
  estimateSectionScore,
  scoreFromTable
};
