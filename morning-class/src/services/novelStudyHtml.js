/**
 * Novel Study workbook → printable HTML (styled, A4-friendly).
 */
'use strict';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function choiceLetter(i) {
  return String.fromCharCode(65 + i);
}

function normalizeChoiceText(c) {
  if (c == null) return '';
  if (typeof c === 'object') {
    const raw = c.text || c.label || c.choice || c.option || c.value || '';
    return normalizeChoiceText(raw);
  }
  let t = String(c).trim();
  t = t.replace(/^[A-Da-d][.)]\s*/, '').trim();
  return t;
}

function normalizeChoices(raw) {
  if (Array.isArray(raw)) {
    return raw.map(normalizeChoiceText).filter(Boolean).slice(0, 4);
  }
  if (raw && typeof raw === 'object') {
    const keys = ['A', 'B', 'C', 'D', 'a', 'b', 'c', 'd', '1', '2', '3', '4'];
    const out = [];
    for (const k of keys) {
      if (raw[k] != null && String(raw[k]).trim()) out.push(normalizeChoiceText(raw[k]));
    }
    if (out.length) return out.slice(0, 4);
    return Object.values(raw).map(normalizeChoiceText).filter(Boolean).slice(0, 4);
  }
  return [];
}

function answerLinesHtml(n) {
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    lines.push('<div class="write-line"></div>');
  }
  return lines.join('\n');
}

function sectionLetters(hasVocab) {
  let i = 0;
  const next = () => String.fromCharCode(65 + (i++));
  return {
    vocab: hasVocab ? next() : null,
    mc: next(),
    short: next(),
    reflection: next()
  };
}

function reflectionTypeLabel(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'personal_reflection') return 'Personal reflection';
  if (t === 'critical_thinking') return 'Critical thinking';
  if (t === 'factual') return 'Factual';
  if (t === 'inference') return 'Inference';
  return '';
}

function collectMasterVocab(parts) {
  const seen = new Set();
  const rows = [];
  (parts || []).forEach((part) => {
    (part.vocab || []).forEach((v) => {
      const key = String(v.word || '').toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      rows.push(v);
    });
  });
  return rows;
}

function vocabTableHtml(items, withExample) {
  if (!items.length) return '<p class="muted">(No vocabulary.)</p>';
  const head = withExample
    ? '<tr><th>#</th><th>Word</th><th>Definition</th><th>From the text</th></tr>'
    : '<tr><th>#</th><th>Word</th><th>Definition</th></tr>';
  const body = items.map((v, i) => {
    const pos = v.partOfSpeech ? ' <span class="pos">(' + esc(v.partOfSpeech) + ')</span>' : '';
    const cells = [
      '<td class="num">' + (i + 1) + '</td>',
      '<td class="word">' + esc(v.word || '') + pos + '</td>',
      '<td>' + esc(v.definition || '') + '</td>'
    ];
    if (withExample) {
      cells.push('<td class="ex">' + esc(v.exampleFromText || '') + '</td>');
    }
    return '<tr>' + cells.join('') + '</tr>';
  }).join('\n');
  return '<table class="vocab-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

function buildPartHtml(part, options) {
  const hasVocab = (part.vocab || []).length > 0;
  const letters = sectionLetters(hasVocab);
  const bits = [];
  bits.push('<section class="sheet part-sheet">');
  bits.push('<header class="part-head">');
  bits.push('<h1>Part ' + esc(part.partNum) + ': ' + esc(part.unitTitle || 'Section') + '</h1>');
  bits.push('<p class="pages">Pages ' + esc(part.startPage || '?') + '–' + esc(part.endPage || '?') + '</p>');
  bits.push('</header>');

  if (hasVocab) {
    bits.push('<h2>' + letters.vocab + '. Vocabulary</h2>');
    bits.push(vocabTableHtml(part.vocab, true));
  }

  bits.push('<h2>' + letters.mc + '. Multiple Choice</h2>');
  const mc = part.multipleChoice || [];
  if (!mc.length) {
    bits.push('<p class="muted">(No multiple-choice questions.)</p>');
  } else {
    mc.forEach((q, i) => {
      bits.push('<div class="q">');
      bits.push('<p class="q-stem"><b>' + (i + 1) + '.</b> ' + esc(q.question || '') + '</p>');
      bits.push('<ol class="choices" type="A">');
      const choices = normalizeChoices(q.choices || q.options);
      for (let ci = 0; ci < 4; ci += 1) {
        const text = choices[ci] || '';
        bits.push('<li>' + esc(text || '________________') + '</li>');
      }
      bits.push('</ol></div>');
    });
  }

  bits.push('<h2>' + letters.short + '. Short Answer</h2>');
  const shorts = part.shortAnswer || [];
  if (!shorts.length) {
    bits.push('<p class="muted">(No short-answer questions.)</p>');
  } else {
    shorts.forEach((q, i) => {
      bits.push('<div class="q">');
      bits.push('<p class="q-stem"><b>' + (i + 1) + '.</b> ' + esc(q.question || '') + '</p>');
      bits.push(answerLinesHtml(3));
      bits.push('</div>');
    });
  }

  bits.push('<h2>' + letters.reflection + '. Extended Response</h2>');
  const refs = part.reflection || [];
  if (!refs.length) {
    bits.push('<p class="muted">(No extended-response prompts.)</p>');
  } else {
    refs.forEach((q, i) => {
      const typeLabel = reflectionTypeLabel(q.type);
      bits.push('<div class="q">');
      bits.push('<p class="q-stem"><b>' + (i + 1) + '.</b> ' +
        (typeLabel ? '<span class="type-tag">[' + esc(typeLabel) + ']</span> ' : '') +
        esc(q.question || '') + '</p>');
      bits.push(answerLinesHtml(7));
      bits.push('</div>');
    });
  }

  if (options && options.pageOverflowRisk) {
    bits.push('<p class="note">Note: Extra items may need more than one page.</p>');
  }
  bits.push('</section>');
  return bits.join('\n');
}

function buildAnswerKeyHtml(parts, culminating, meta) {
  const bits = ['<section class="sheet key-sheet">', '<h1>Teacher Answer Key</h1>'];
  bits.push('<p class="lede">' + esc((meta && meta.title) || 'Book') +
    ' — for teacher use. Evidence quotes must match the source text.</p>');

  (parts || []).forEach((part) => {
    bits.push('<h2>Part ' + esc(part.partNum) + ': ' + esc(part.unitTitle || 'Section') + '</h2>');
    if ((part.vocab || []).length) {
      bits.push('<h3>Vocabulary</h3><ul>');
      part.vocab.forEach((v, i) => {
        bits.push('<li><b>' + (i + 1) + '. ' + esc(v.word || '') + '</b> — ' + esc(v.definition || ''));
        if (v.evidenceQuote || v.exampleFromText) {
          bits.push('<br><em>Evidence: “' + esc(v.evidenceQuote || v.exampleFromText) + '”</em>');
        }
        bits.push('</li>');
      });
      bits.push('</ul>');
    }
    if ((part.multipleChoice || []).length) {
      bits.push('<h3>Multiple Choice</h3><ul>');
      part.multipleChoice.forEach((q, i) => {
        bits.push('<li><b>' + (i + 1) + '. ' + esc(q.answer || '?') + '</b> — ' + esc(q.question || ''));
        const choices = normalizeChoices(q.choices || q.options);
        if (choices.length) {
          bits.push('<br><span class="muted">' + choices.map((c, ci) => choiceLetter(ci) + '. ' + esc(c)).join(' · ') + '</span>');
        }
        if (q.evidenceQuote) bits.push('<br><em>Evidence: “' + esc(q.evidenceQuote) + '”</em>');
        bits.push('</li>');
      });
      bits.push('</ul>');
    }
    if ((part.shortAnswer || []).length) {
      bits.push('<h3>Short Answer</h3><ul>');
      part.shortAnswer.forEach((q, i) => {
        bits.push('<li><b>' + (i + 1) + '.</b> ' + esc(q.question || ''));
        bits.push('<br><em>Sample: ' + esc(q.sampleAnswer || '') + '</em>');
        if (q.evidenceQuote) bits.push('<br><em>Evidence: “' + esc(q.evidenceQuote) + '”</em>');
        bits.push('</li>');
      });
      bits.push('</ul>');
    }
    if ((part.reflection || []).length) {
      bits.push('<h3>Extended Response</h3><ul>');
      part.reflection.forEach((q, i) => {
        const typeLabel = reflectionTypeLabel(q.type);
        bits.push('<li><b>' + (i + 1) + '.</b> ' +
          (typeLabel ? '[' + esc(typeLabel) + '] ' : '') +
          esc(q.question || ''));
        bits.push('<br><em>Sample: ' + esc(q.sampleAnswer || '') + '</em>');
        if (q.evidenceQuote) bits.push('<br><em>Evidence: “' + esc(q.evidenceQuote) + '”</em>');
        bits.push('</li>');
      });
      bits.push('</ul>');
    }
  });

  const prompts = (culminating && culminating.prompts) || [];
  if (prompts.length) {
    bits.push('<h2>Culminating Task</h2><ul>');
    prompts.forEach((q, i) => {
      bits.push('<li><b>' + (i + 1) + '. ' + esc(q.label || '') + '</b> — ' + esc(q.question || ''));
      bits.push('<br><em>Sample: ' + esc(q.sampleAnswer || '') + '</em>');
      if (q.evidenceQuote) bits.push('<br><em>Evidence: “' + esc(q.evidenceQuote) + '”</em>');
      bits.push('</li>');
    });
    bits.push('</ul>');
  }
  bits.push('</section>');
  return bits.join('\n');
}

function wrapHtmlDocument(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #1a2332;
    --muted: #5a6a7a;
    --teal: #0d6e6e;
    --teal-deep: #0a5555;
    --line: #c5d0da;
    --soft: #f3f7f8;
    --header: #0d2748;
    --accent: #c9782c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--ink);
    font-family: 'Source Sans 3', 'Segoe UI', sans-serif;
    font-size: 11pt;
    line-height: 1.45;
    background: #e8eef2;
  }
  .sheet {
    max-width: 210mm;
    margin: 12px auto;
    padding: 14mm 14mm 16mm;
    background:
      linear-gradient(180deg, rgba(13,110,110,0.06), transparent 120px),
      #fff;
    box-shadow: 0 8px 28px rgba(15,23,42,0.1);
    border-top: 6px solid var(--teal);
  }
  .cover { text-align: center; border-top-color: var(--header); }
  .brand {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.35rem; font-weight: 700; color: var(--header); margin: 0 0 0.4rem;
    letter-spacing: 0.02em;
  }
  .workbook-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.85rem; margin: 0.4rem 0 1rem; color: var(--teal-deep);
  }
  .book-title { font-size: 1.35rem; margin: 0.2rem 0; color: var(--ink); }
  .by { font-style: italic; color: var(--muted); margin: 0.2rem 0 0.8rem; }
  .meta { color: var(--muted); font-size: 0.95rem; }
  .fields { margin: 1.4rem auto; max-width: 22rem; text-align: left; }
  .fields .blank {
    display: inline-block; min-width: 12rem; border-bottom: 1.5px solid var(--ink); height: 1.1em;
  }
  .lede { color: var(--muted); font-size: 0.95rem; max-width: 36rem; margin: 1rem auto 0; }
  h1 {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.55rem; color: var(--header); margin: 0 0 0.35rem;
    border-bottom: 2px solid var(--teal); padding-bottom: 0.25rem;
  }
  h2 {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.2rem; color: var(--teal-deep); margin: 1.1rem 0 0.45rem;
  }
  h3 { font-size: 1rem; color: var(--header); margin: 0.75rem 0 0.3rem; }
  .part-head .pages { margin: 0; color: var(--muted); font-style: italic; font-size: 0.92rem; }
  .vocab-table {
    width: 100%; border-collapse: collapse; margin: 0.4rem 0 0.8rem;
    font-size: 0.95rem;
  }
  .vocab-table th {
    background: var(--header); color: #fff; text-align: left;
    padding: 0.4rem 0.55rem; font-weight: 700;
  }
  .vocab-table td {
    border: 1px solid var(--line); padding: 0.4rem 0.55rem; vertical-align: top;
  }
  .vocab-table tr:nth-child(even) td { background: var(--soft); }
  .vocab-table .num { width: 2.2rem; text-align: center; color: var(--muted); }
  .vocab-table .word { font-weight: 700; white-space: nowrap; }
  .vocab-table .pos { font-weight: 400; color: var(--muted); font-size: 0.85em; }
  .vocab-table .ex { font-style: italic; color: #334; font-size: 0.9em; }
  .q { margin: 0.55rem 0 0.9rem; }
  .q-stem { margin: 0 0 0.35rem; }
  .choices {
    margin: 0.15rem 0 0.35rem 1.1rem; padding: 0;
    list-style: upper-alpha;
  }
  .choices li { margin: 0.18rem 0; padding-left: 0.25rem; }
  .type-tag { color: var(--teal-deep); font-weight: 700; font-size: 0.9em; }
  .write-line {
    height: 1.55rem;
    border-bottom: 1.25px solid #2a3544;
    margin: 0.15rem 0;
  }
  .muted { color: var(--muted); font-style: italic; }
  .note { font-size: 0.8rem; color: var(--muted); font-style: italic; margin-top: 1rem; }
  .key-sheet { border-top-color: var(--accent); }
  .key-sheet ul { padding-left: 1.2rem; margin: 0.3rem 0 0.7rem; }
  .key-sheet li { margin: 0.35rem 0; }
  .toolbar-print { margin-top: 1.25rem; }
  .toolbar-print button {
    font: inherit; font-weight: 700; cursor: pointer;
    background: var(--teal); color: #fff; border: none;
    border-radius: 8px; padding: 0.55rem 1rem;
  }
  .live-banner {
    text-align: center; color: var(--muted); font-size: 0.9rem; margin: 0 0 0.75rem;
  }
  @page { size: A4; margin: 12mm; }
  @media print {
    body { background: #fff; }
    .sheet {
      margin: 0; max-width: none; box-shadow: none;
      page-break-after: always; border-top-width: 4px;
      padding: 0;
    }
    .sheet:last-child { page-break-after: auto; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * @param {object} job
 * @returns {string} full HTML document
 */
function buildWorkbookHtml(job) {
  const meta = job.meta || { title: 'Untitled Book', author: 'Unknown', genre: 'fiction' };
  const options = job.options || {};
  const parts = job.parts || [];
  const culminating = job.culminating || null;
  const genre = meta.genre === 'nonfiction' ? 'nonfiction' : 'fiction';
  const master = collectMasterVocab(parts);
  const level = options.level || 'middle';

  const body = [];
  body.push('<section class="sheet cover">');
  body.push('<p class="brand">Salt Morning Class</p>');
  body.push('<h1 class="workbook-title">Novel / Book Study Workbook</h1>');
  body.push('<h2 class="book-title">' + esc(meta.title) + '</h2>');
  body.push('<p class="by">by ' + esc(meta.author) + '</p>');
  body.push('<p class="meta">Genre: ' + esc(genre === 'nonfiction' ? 'Nonfiction' : 'Fiction') +
    ' · Level: ' + esc(level) + '</p>');
  body.push('<div class="fields">');
  body.push('<p>Student name: <span class="blank"></span></p>');
  body.push('<p>Class / Date: <span class="blank"></span></p>');
  body.push('</div>');
  body.push('<p class="lede">Read each section carefully. Use evidence from the text when you answer. ' +
    'Complete the culminating task after all section worksheets.</p>');
  body.push('<div class="no-print toolbar-print"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>');
  body.push('</section>');

  if (master.length) {
    body.push('<section class="sheet">');
    body.push('<h1>Master Vocabulary List</h1>');
    body.push('<p class="lede">Study these words from the whole book. Definitions are student-friendly English.</p>');
    body.push(vocabTableHtml(master, false));
    body.push('</section>');
  }

  parts.forEach((part) => {
    body.push(buildPartHtml(part, options));
  });

  body.push('<section class="sheet">');
  body.push('<h1>Culminating Task</h1>');
  body.push('<p class="lede">' + (genre === 'nonfiction'
    ? 'Answer these three synthesis questions about the whole nonfiction text.'
    : 'Answer these three synthesis questions about the whole fiction text.') + '</p>');
  const prompts = (culminating && culminating.prompts) || [];
  if (!prompts.length) {
    body.push('<p class="muted">(Culminating prompts unavailable.)</p>');
  } else {
    prompts.forEach((q, i) => {
      const label = q.label ? esc(q.label) + ': ' : '';
      body.push('<div class="q"><p class="q-stem"><b>' + (i + 1) + '. ' + label + '</b>' + esc(q.question || '') + '</p>');
      body.push(answerLinesHtml(6));
      body.push('</div>');
    });
  }
  body.push('</section>');

  body.push(buildAnswerKeyHtml(parts, culminating, meta));

  return wrapHtmlDocument((meta.title || 'Book') + ' — Novel Study Workbook', body.join('\n'));
}

/**
 * Single-part printable sheet (for live preview while generation runs).
 */
function buildPartSheetHtml(part, meta, options) {
  const title = (meta && meta.title) || 'Book Study';
  const banner = '<p class="live-banner no-print"><b>Live sheet preview</b> · ' +
    esc(title) + ' · Part ' + esc(part && part.partNum) + '</p>';
  const toolbar = '<div class="no-print toolbar-print" style="max-width:210mm;margin:0 auto 12px;text-align:center">' +
    '<button type="button" onclick="window.print()">Print this sheet</button></div>';
  return wrapHtmlDocument(
    'Part ' + (part && part.partNum) + ' — ' + title,
    banner + toolbar + buildPartHtml(part, options || {})
  );
}

module.exports = {
  buildWorkbookHtml,
  buildPartSheetHtml,
  buildPartHtml,
  normalizeChoices,
  normalizeChoiceText
};
