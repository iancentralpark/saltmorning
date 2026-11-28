'use strict';

/** Asks Claude to transcribe the SAT questions on a few PDF pages into structured data. */

const { DEFAULT_CLAUDE_MODEL } = require('../geminiService');

// ANTHROPIC_BASE_URL is the same override the official SDK reads (proxy or local test server).
const API_URL = String(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';
const MAX_TOKENS = 8000;
const MAX_TOKENS_RETRY = 16000;

// USD per million tokens, used only to show an estimate before a job starts.
const PRICE_PER_MTOK = [
  { match: /haiku/i, label: 'Haiku', input: 1, output: 5 },
  { match: /opus/i, label: 'Opus', input: 5, output: 25 },
  { match: /./, label: 'Sonnet', input: 3, output: 15 }
];

function apiKey() {
  return String(process.env.ANTHROPIC_API_KEY || '').trim();
}

function isConfigured() {
  return !!apiKey();
}

function model() {
  return String(
    process.env.SAT_IMPORT_MODEL
    || process.env.CLAUDE_MODEL
    || process.env.ANTHROPIC_MODEL
    || DEFAULT_CLAUDE_MODEL
  ).trim() || DEFAULT_CLAUDE_MODEL;
}

function priceFor(modelName) {
  return PRICE_PER_MTOK.find((p) => p.match.test(String(modelName || '')));
}

function costUsd(modelName, tokensIn, tokensOut) {
  const p = priceFor(modelName);
  return (Number(tokensIn) || 0) / 1e6 * p.input + (Number(tokensOut) || 0) / 1e6 * p.output;
}

const SYSTEM_PROMPT = [
  'You transcribe Digital SAT practice questions from PDF pages into structured data for a practice-test app.',
  'You are given page images and, for the same pages, the text the PDF itself contains (its text layer).',
  'Transcribe what is printed. Do not solve, correct, shorten, reword or add anything.',
  '',
  'TYPICAL PAGE LAYOUT (College Board question bank export; other layouts are possible)',
  '- A heading "Question ID <id>", then a table row giving Assessment, Test, Domain, Skill and Difficulty.',
  '- A band "ID: <id>", then the question: a passage or figure if any, the question sentence, and choices A to D.',
  '  A student-produced-response question has no choices.',
  '- A band "ID: <id> Answer", then "Correct Answer:", "Rationale" and "Question Difficulty: Easy|Medium|Hard".',
  '',
  'WORDING',
  '- Copy ordinary prose character for character. Use the text layer for spelling and punctuation, and the',
  '  image for everything the text layer loses: math, symbols, underlining, italics, blanks, superscripts.',
  '- If the text layer and the image disagree about a word, the image wins.',
  '',
  'MARKUP (the only markup allowed in text fields)',
  '- Math: write every mathematical expression, including a lone variable such as x, as LaTeX inside \\( ... \\)',
  '  for inline math or \\[ ... \\] for math set on its own line. Plain numbers in prose ("25%", "80 jackets")',
  '  stay plain text.',
  '- Never use $ as a math delimiter. A dollar sign is always a literal dollar sign: write $5.50 as plain text.',
  '  Inside LaTeX write a dollar sign as \\$ and a percent sign as \\%.',
  '- <u>underlined</u>, <i>italic</i>, <b>bold</b>, <sup>superscript</sup>, <sub>subscript</sub>.',
  '- A blank to be filled in is six underscores: ______',
  '- Separate paragraphs with one empty line. Keep the line breaks of poems. Write each bullet of a bulleted',
  '  list on its own line starting with "• ".',
  '- Tables: <table><tr><th>heading</th>...</tr><tr><td>cell</td>...</tr></table>. Put a table title on the',
  '  line above it as <b>title</b>. Use math markup inside cells where needed.',
  '',
  'FIGURES',
  '- A graph, diagram, picture, or anything else that cannot be written as text is a figure. Put a placeholder',
  '  [[fig1]], [[fig2]], ... exactly where the figure appears, and describe each one in "figures".',
  '- "page" is the number given with the page image. "box" is [left, top, right, bottom] as thousandths of the',
  '  page width and height (0 to 1000, origin at the top left). Draw the box tightly around the whole figure,',
  '  including axis labels, tick labels, legend and any title printed as part of it, and nothing else.',
  '- A choice that is itself a figure has the placeholder as its whole text.',
  '',
  'FIELDS',
  '- source_id: the Question ID, lower case. Empty if none is printed.',
  '- section: "rw" when the Test is Reading and Writing, "math" when it is Math.',
  '- domain, skill: exactly as printed in the table row.',
  '- difficulty: "easy", "medium" or "hard", from "Question Difficulty" (or 1, 2 or 3 filled squares).',
  '- passage: for Reading and Writing, everything the question is about (the text or texts, notes, table or',
  '  figure). Empty for Math.',
  '- stem: for Reading and Writing, the question sentence. For Math, everything before the choices, including',
  '  any equation, table or figure.',
  '- choices: the four choices in order, without the letter. Empty list for a student-produced response.',
  '- answer: what is printed after "Correct Answer". One letter for multiple choice.',
  '- accepted_answers: student-produced response only. Every form of the answer the page accepts, as a student',
  '  would type it: digits, a decimal point, a slash for fractions and a leading minus sign only',
  '  (for example "3/5", ".6", "0.6"). Include forms listed in the rationale ("Note that ... are examples").',
  '- rationale: the full explanation, with the same markup.',
  '- notes: empty unless something is unreadable, cut off, or you had to guess. Then say what, briefly.',
  '',
  'Leave a field empty rather than guessing. Do not include the "ID:" bands, page numbers or headers.'
].join('\n');

const TOOL = {
  name: 'save_questions',
  description: 'Save the SAT questions transcribed from the given pages.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_id: { type: 'string' },
            section: { type: 'string', enum: ['rw', 'math', ''] },
            domain: { type: 'string' },
            skill: { type: 'string' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard', ''] },
            passage: { type: 'string' },
            stem: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string' },
            accepted_answers: { type: 'array', items: { type: 'string' } },
            rationale: { type: 'string' },
            figures: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ref: { type: 'string', description: 'Placeholder name without brackets, e.g. fig1' },
                  page: { type: 'integer' },
                  box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }
                },
                required: ['ref', 'page', 'box']
              }
            },
            notes: { type: 'string' }
          },
          required: ['source_id', 'section', 'domain', 'skill', 'difficulty', 'passage', 'stem', 'choices', 'answer', 'rationale']
        }
      }
    },
    required: ['questions']
  }
};

function taskText(unit, pages) {
  const lines = [];
  const first = pages[0].page;
  const lastOwn = unit.pageTo;
  if (unit.sourceId) {
    lines.push('Transcribe the one question with Question ID ' + unit.sourceId + '.');
    lines.push('It starts on page ' + first + (lastOwn > first ? ' and may run to page ' + lastOwn : '') + '.');
    lines.push('Ignore any other question that shares a page with it.');
  } else {
    lines.push('Transcribe every question that STARTS on pages ' + first + ' to ' + lastOwn + ', in order.');
    if (pages[pages.length - 1].page > lastOwn) {
      lines.push('Later pages are included only so you can finish a question that continues past page ' + lastOwn +
        '. Do not transcribe questions that start on them.');
    }
    lines.push('If no question starts on these pages (cover, contents, instructions), return an empty list.');
  }
  return lines.join('\n');
}

function buildContent(unit, pages) {
  const content = [{ type: 'text', text: taskText(unit, pages) }];
  pages.forEach((p) => {
    content.push({ type: 'text', text: 'Page ' + p.page + ' image:' });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: p.mime || 'image/jpeg', data: p.image.toString('base64') }
    });
  });
  const layer = pages
    .map((p) => '--- Page ' + p.page + ' text layer ---\n' + String(p.text || '').slice(0, 12000))
    .join('\n\n');
  content.push({ type: 'text', text: 'Text layer of the same pages (math and symbols may be garbled or missing):\n\n' + layer });
  return content;
}

function apiError(status, message) {
  const err = new Error(message || 'Claude request failed.');
  err.status = status;
  const m = String(message || '');
  // Stops the whole job: retrying the next question would fail the same way.
  err.fatal = status === 401 || status === 403 || status === 404
    || /credit balance|billing|invalid.?x-api-key|authentication|permission|model:/i.test(m);
  err.busy = status === 429 || status === 529 || status === 503 || status === 500 || /overloaded|rate.?limit/i.test(m);
  return err;
}

async function callClaude(body, timeoutMs) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs || 180000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw apiError(res.status, (data.error && data.error.message) || res.statusText);
  }
  return data;
}

/**
 * unit: { sourceId, pageTo }. pages: [{ page, image: Buffer, mime, text }].
 * Returns { questions: [raw], tokensIn, tokensOut, model }.
 */
async function extractQuestions(unit, pages) {
  if (!isConfigured()) {
    const err = new Error('Claude is not configured (set ANTHROPIC_API_KEY).');
    err.fatal = true;
    throw err;
  }
  const modelName = model();
  const body = {
    model: modelName,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: buildContent(unit, pages) }]
  };

  let tokensIn = 0;
  let tokensOut = 0;
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      data = await callClaude(body);
    } catch (e) {
      if (e.status === 400 && /temperature/i.test(e.message) && body.temperature != null) {
        delete body.temperature;
        continue;
      }
      e.tokensIn = tokensIn;
      e.tokensOut = tokensOut;
      throw e;
    }
    tokensIn += Number(data.usage && data.usage.input_tokens) || 0;
    tokensOut += Number(data.usage && data.usage.output_tokens) || 0;
    if (data.stop_reason === 'max_tokens' && body.max_tokens < MAX_TOKENS_RETRY) {
      body.max_tokens = MAX_TOKENS_RETRY;
      continue;
    }
    break;
  }

  const block = (Array.isArray(data && data.content) ? data.content : []).find((b) => b && b.type === 'tool_use');
  if (!block || !block.input || !Array.isArray(block.input.questions)) {
    const err = new Error('Claude did not return questions for these pages.');
    err.tokensIn = tokensIn;
    err.tokensOut = tokensOut;
    throw err;
  }
  return {
    questions: block.input.questions,
    truncated: data.stop_reason === 'max_tokens',
    tokensIn: tokensIn,
    tokensOut: tokensOut,
    model: modelName
  };
}

module.exports = {
  extractQuestions,
  isConfigured,
  model,
  priceFor,
  costUsd,
  SYSTEM_PROMPT,
  TOOL
};
