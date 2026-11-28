'use strict';

/** Digital SAT sections, content domains and skills, as named in the College Board question bank. */

const SECTIONS = {
  rw: {
    label: 'Reading and Writing',
    domains: {
      'Information and Ideas': [
        'Central Ideas and Details',
        'Command of Evidence',
        'Inferences'
      ],
      'Craft and Structure': [
        'Words in Context',
        'Text Structure and Purpose',
        'Cross-Text Connections'
      ],
      'Expression of Ideas': [
        'Rhetorical Synthesis',
        'Transitions'
      ],
      'Standard English Conventions': [
        'Boundaries',
        'Form, Structure, and Sense'
      ]
    }
  },
  math: {
    label: 'Math',
    domains: {
      'Algebra': [
        'Linear equations in one variable',
        'Linear functions',
        'Linear equations in two variables',
        'Systems of two linear equations in two variables',
        'Linear inequalities in one or two variables'
      ],
      'Advanced Math': [
        'Equivalent expressions',
        'Nonlinear equations in one variable and systems of equations in two variables',
        'Nonlinear functions'
      ],
      'Problem-Solving and Data Analysis': [
        'Ratios, rates, proportional relationships, and units',
        'Percentages',
        'One-variable data: Distributions and measures of center and spread',
        'Two-variable data: Models and scatterplots',
        'Probability and conditional probability',
        'Inference from sample statistics and margin of error',
        'Evaluating statistical claims: Observational studies and experiments'
      ],
      'Geometry and Trigonometry': [
        'Area and volume',
        'Lines, angles, and triangles',
        'Right triangles and trigonometry',
        'Circles'
      ]
    }
  }
};

const DIFFICULTIES = ['easy', 'medium', 'hard'];

function key(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function normalizeSection(value) {
  const k = key(value);
  if (!k) return '';
  if (k === 'rw' || k.indexOf('reading') >= 0 || k.indexOf('writing') >= 0) return 'rw';
  if (k.indexOf('math') >= 0) return 'math';
  return '';
}

/** Official spelling of a domain, searching the given section first. Returns '' when unknown. */
function matchDomain(section, value) {
  const k = key(value);
  if (!k) return { section: section, domain: '' };
  const order = section && SECTIONS[section] ? [section].concat(Object.keys(SECTIONS).filter((s) => s !== section)) : Object.keys(SECTIONS);
  for (const sec of order) {
    const hit = Object.keys(SECTIONS[sec].domains).find((d) => key(d) === k);
    if (hit) return { section: sec, domain: hit };
  }
  return { section: section, domain: '' };
}

function matchSkill(section, domain, value) {
  const k = key(value);
  if (!k || !SECTIONS[section] || !SECTIONS[section].domains[domain]) return '';
  return SECTIONS[section].domains[domain].find((s) => key(s) === k) || '';
}

function normalizeDifficulty(value) {
  const k = key(value);
  return DIFFICULTIES.indexOf(k) >= 0 ? k : '';
}

function publicTaxonomy() {
  return Object.keys(SECTIONS).map((id) => ({
    id: id,
    label: SECTIONS[id].label,
    domains: Object.keys(SECTIONS[id].domains).map((d) => ({ name: d, skills: SECTIONS[id].domains[d].slice() }))
  }));
}

module.exports = {
  SECTIONS,
  DIFFICULTIES,
  normalizeSection,
  matchDomain,
  matchSkill,
  normalizeDifficulty,
  publicTaxonomy
};
