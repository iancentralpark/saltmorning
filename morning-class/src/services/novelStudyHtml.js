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

function answerLinesHtml(n, kind) {
  const cls = kind === 'long' ? 'write-line write-line-long' : 'write-line write-line-short';
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    lines.push('<div class="' + cls + '"></div>');
  }
  return lines.join('\n');
}

/** Hide Find-in-book lines that only repeat the worksheet title. */
function readingRangeIsRedundant(unitTitle, readingRange) {
  const title = String(unitTitle || '').trim();
  const range = String(readingRange || '').trim();
  if (!range) return true;
  if (!title) return false;
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[“”"‘’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const t = norm(title);
  const r = norm(range);
  if (r === t) return true;
  const sectionOnly = r.match(/^(?:section|read the section titled)\s+(.+?)\.?$/);
  if (sectionOnly) {
    const body = sectionOnly[1].trim();
    if (t === body || t.endsWith(': ' + body) || t.includes(body)) return true;
  }
  const fromThrough = r.match(/^from\s+(.+?)\s+through\s+(.+)$/);
  if (fromThrough) {
    const a = fromThrough[1].trim();
    const b = fromThrough[2].trim();
    if (a && b && t.includes(a) && t.includes(b)) return true;
  }
  return false;
}

function usefulReadingLocator(part) {
  const locator = String(part.readingRange || part.contentSpan || '').trim();
  if (!locator) return '';
  if (readingRangeIsRedundant(part.unitTitle, locator)) return '';
  return locator;
}

/**
 * Extended-response prompts are often 3–4 stacked sub-questions. That height,
 * combined with answer lines, forces the whole C section onto the next page.
 * Keep one clear question (optional short lead-in) so A4 sheets can pack tightly.
 */
function compactExtendedPrompt(text, maxLen) {
  // Keep student-facing prompts short so section C can share a page with A/B.
  const max = Math.max(70, Number(maxLen) || 160);
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length <= max) return s;

  const parts = s.split(/(?<=[.!?])\s+/).filter(Boolean);
  const qIdx = parts.findIndex((p) => /\?\s*$/.test(p));
  if (qIdx >= 0) {
    // Drop long setup sentences; keep the first real question only.
    let out = parts[qIdx];
    if (out.length > max) {
      out = out.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
      if (!/\?\s*$/.test(out)) out += '?';
    }
    if (!/\b(use|evidence|example|text|support)\b/i.test(out)) {
      out = out.replace(/\?\s*$/, '') + '? Use evidence from the text.';
      if (out.length > max + 28) {
        out = out.slice(0, max - 1).replace(/\s+\S*$/, '').trim() + '?';
      }
    }
    return out;
  }

  let cut = s.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
  if (!/[.!?]$/.test(cut)) cut += '…';
  return cut;
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

function vocabTableHtml(items, opts) {
  const withExample = !!(opts && opts.withExample);
  const exampleLabel = (opts && opts.exampleLabel) || 'Example sentence';
  if (!items.length) return '<p class="muted">(No vocabulary.)</p>';
  const head = withExample
    ? '<tr><th>#</th><th>Word</th><th>Definition</th><th>' + esc(exampleLabel) + '</th></tr>'
    : '<tr><th>#</th><th>Word</th><th>Definition</th></tr>';
  const body = items.map((v, i) => {
    const pos = v.partOfSpeech ? ' <span class="pos">(' + esc(v.partOfSpeech) + ')</span>' : '';
    const example = v.exampleSentence || v.exampleFromText || '';
    const cells = [
      '<td class="num">' + (i + 1) + '</td>',
      '<td class="word">' + esc(v.word || '') + pos + '</td>',
      '<td>' + esc(v.definition || '') + '</td>'
    ];
    if (withExample) {
      cells.push('<td class="ex">' + esc(example) + '</td>');
    }
    return '<tr>' + cells.join('') + '</tr>';
  }).join('\n');
  return '<table class="vocab-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

function buildPartHtml(part, options) {
  // Vocabulary is printed only in the front master list — not on each worksheet.
  const letters = sectionLetters(false);
  const bits = [];
  bits.push('<section class="sheet part-sheet">');
  bits.push('<header class="part-head">');
  bits.push('<h1>Part ' + esc(part.partNum) + ': ' + esc(part.unitTitle || 'Section') + '</h1>');
  // Only show a locator when it adds info beyond the title (avoid repeating subtitles).
  const locator = usefulReadingLocator(part);
  if (locator) {
    bits.push('<p class="reading-range"><b>Find in your book:</b> ' + esc(locator) + '</p>');
  }
  bits.push('</header>');

  // Do not wrap whole sections in .keep — that forces the entire block onto the next
  // page when it barely overflows, leaving a large blank at the bottom of the prior page.
  bits.push('<div class="section-block">');
  bits.push('<h2>' + letters.mc + '. Multiple Choice</h2>');
  const mc = part.multipleChoice || [];
  if (!mc.length) {
    bits.push('<p class="muted">(No multiple-choice questions.)</p>');
  } else {
    mc.forEach((q, i) => {
      bits.push('<div class="q keep">');
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
  bits.push('</div>');

  bits.push('<div class="section-block">');
  bits.push('<h2>' + letters.short + '. Short Answer</h2>');
  const shorts = part.shortAnswer || [];
  if (!shorts.length) {
    bits.push('<p class="muted">(No short-answer questions.)</p>');
  } else {
    shorts.forEach((q, i) => {
      bits.push('<div class="q keep">');
      bits.push('<p class="q-stem"><b>' + (i + 1) + '.</b> ' + esc(q.question || '') + '</p>');
      bits.push(answerLinesHtml(2, 'short'));
      bits.push('</div>');
    });
  }
  bits.push('</div>');

  bits.push('<div class="section-block section-extended">');
  // allow-break: do NOT glue this heading to a tall prompt (that caused huge blank gaps).
  bits.push('<h2 class="allow-break">' + letters.reflection + '. Extended Response</h2>');
  const refs = part.reflection || [];
  if (!refs.length) {
    bits.push('<p class="muted">(No extended-response prompts.)</p>');
  } else {
    // A one-paragraph answer needs real room to write: 7 lines for a single
    // prompt, 5 when there are two (page-break rules above let this section
    // flow onto the next page rather than forcing a blank-space jump).
    const linesPerPrompt = refs.length > 1 ? 5 : 7;
    refs.forEach((q, i) => {
      const typeLabel = reflectionTypeLabel(q.type);
      const prompt = compactExtendedPrompt(q.question || '', 160);
      // Never keep-together the extended block — long critical-thinking stems must
      // be allowed to start on the previous page and wrap onto the next.
      bits.push('<div class="q q-extended">');
      bits.push('<p class="q-stem"><b>' + (i + 1) + '.</b> ' +
        (typeLabel ? '<span class="type-tag">[' + esc(typeLabel) + ']</span> ' : '') +
        esc(prompt) + '</p>');
      bits.push(answerLinesHtml(linesPerPrompt, 'long'));
      bits.push('</div>');
    });
  }
  bits.push('</div>');

  if (options && options.pageOverflowRisk) {
    bits.push('<p class="note no-print">Note: Extra items may need more than one page when printed.</p>');
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
    line-height: 1.4;
    background: #e8eef2;
  }
  /* Screen preview ≈ A4 page so layout matches print more closely */
  .sheet {
    width: 210mm;
    max-width: 210mm;
    min-height: 297mm;
    margin: 12px auto;
    padding: 12mm;
    background:
      linear-gradient(180deg, rgba(13,110,110,0.06), transparent 120px),
      #fff;
    box-shadow: 0 8px 28px rgba(15,23,42,0.1);
    border-top: 6px solid var(--teal);
    overflow: visible;
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
    font-size: 1.45rem; color: var(--header); margin: 0 0 0.3rem;
    border-bottom: 2px solid var(--teal); padding-bottom: 0.2rem;
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.25;
  }
  h2 {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.15rem; color: var(--teal-deep); margin: 0.85rem 0 0.35rem;
    break-after: avoid;
    page-break-after: avoid;
  }
  h2.allow-break {
    break-after: auto;
    page-break-after: auto;
  }
  h3 { font-size: 1rem; color: var(--header); margin: 0.75rem 0 0.3rem; }
  .part-head { break-after: avoid; page-break-after: avoid; }
  .part-head .pages { margin: 0; color: var(--muted); font-style: italic; font-size: 0.92rem; }
  .section-block { margin: 0 0 0.35rem; }
  .keep {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .q-extended, .q-extended .q-stem, .section-extended {
    break-inside: auto;
    page-break-inside: auto;
  }
  .q-extended .q-stem {
    orphans: 1;
    widows: 1;
  }
  .vocab-table {
    width: 100%; border-collapse: collapse; margin: 0.3rem 0 0.5rem;
    font-size: 0.9rem;
  }
  .vocab-table th {
    background: var(--header); color: #fff; text-align: left;
    padding: 0.32rem 0.45rem; font-weight: 700;
  }
  .vocab-table td {
    border: 1px solid var(--line); padding: 0.32rem 0.45rem; vertical-align: top;
  }
  .vocab-table tr { break-inside: avoid; page-break-inside: avoid; }
  .vocab-table tr:nth-child(even) td { background: var(--soft); }
  .vocab-table .num { width: 2.2rem; text-align: center; color: var(--muted); }
  .vocab-table .word { font-weight: 700; white-space: nowrap; }
  .vocab-table .pos { font-weight: 400; color: var(--muted); font-size: 0.85em; }
  .vocab-table .ex { font-style: italic; color: #334; font-size: 0.88em; }
  .q { margin: 0.4rem 0 0.65rem; }
  .q-stem { margin: 0 0 0.28rem; }
  .choices {
    margin: 0.1rem 0 0.25rem 1.1rem; padding: 0;
    list-style: upper-alpha;
  }
  .choices li { margin: 0.12rem 0; padding-left: 0.25rem; }
  .type-tag { color: var(--teal-deep); font-weight: 700; font-size: 0.9em; }
  .reading-range {
    margin: 0.15rem 0 0.55rem;
    color: var(--ink);
    font-size: 0.95rem;
    line-height: 1.35;
  }
  .reading-range.muted { color: var(--muted); font-style: italic; }
  .write-line {
    border-bottom: 1.25px solid #2a3544;
  }
  .write-line-short {
    height: 1.75rem;
    margin: 0.22rem 0;
  }
  .write-line-long {
    height: 1.95rem;
    margin: 0.28rem 0;
  }
  .muted { color: var(--muted); font-style: italic; }
  .note { font-size: 0.8rem; color: var(--muted); font-style: italic; margin-top: 0.75rem; }
  .key-sheet { border-top-color: var(--accent); }
  .key-sheet ul { padding-left: 1.2rem; margin: 0.3rem 0 0.7rem; }
  .key-sheet li { margin: 0.35rem 0; break-inside: avoid; page-break-inside: avoid; }
  .toolbar-print { margin-top: 1.25rem; }
  .toolbar-print button {
    font: inherit; font-weight: 700; cursor: pointer;
    background: var(--teal); color: #fff; border: none;
    border-radius: 8px; padding: 0.55rem 1rem;
  }
  .toolbar-print .print-hint {
    display: block; margin-top: 0.45rem; color: var(--muted); font-size: 0.85rem;
  }
  .live-banner {
    text-align: center; color: var(--muted); font-size: 0.9rem; margin: 0 0 0.75rem;
  }
  /* Margins live on the sheet (padding), not @page — avoids Chrome "Default"
     margins stacking on top of @page and shrinking the printable area. */
  @page { size: A4; margin: 0; }
  @media print {
    html, body {
      width: 210mm;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 210mm;
      max-width: 210mm;
      min-height: 297mm;
      margin: 0 !important;
      padding: 11mm 12mm 12mm;
      box-shadow: none !important;
      border-top-width: 4px;
      break-after: page;
      page-break-after: always;
    }
    .sheet:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    /* Keep only small MC/short items together — never extended-response blocks. */
    .keep, .q:not(.q-extended) {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .q-extended, .q-extended .q-stem, .section-extended, h2.allow-break {
      break-inside: auto !important;
      page-break-inside: auto !important;
      break-after: auto !important;
      page-break-after: auto !important;
    }
    .q-extended .q-stem {
      orphans: 1 !important;
      widows: 1 !important;
      line-height: 1.25;
    }
    /* A/B headings stay with their first question; C may start mid-page freely. */
    h2:not(.allow-break), .part-head {
      break-after: avoid;
      page-break-after: avoid;
    }
    h1 {
      font-size: 1.18rem;
      line-height: 1.18;
    }
    h2 { margin: 0.6rem 0 0.32rem; font-size: 1.05rem; }
    /* Print preview is the source of truth: give questions real breathing room
       so leftover A4 space is absorbed between items, not dumped as one blank
       gap under section C. Tuned so Part 6 stays on 1 page (~7.5% trailing blank). */
    .q { margin: 0.5rem 0 0.95rem; }
    .q-stem { margin: 0 0 0.32rem; }
    .choices li { margin: 0.18rem 0; }
    .section-block { margin: 0 0 0.7rem; }
    /* Match on-screen write-line height — earlier print CSS shrunk lines vs
       screen, which made the bottom look emptier in Chrome print preview. */
    .write-line-short { height: 1.75rem; margin: 0.28rem 0; }
    .write-line-long { height: 1.85rem; margin: 0.3rem 0; }
    .reading-range { margin: 0.06rem 0 0.22rem; font-size: 0.86rem; }
    .sheet { padding: 8.5mm 10mm 8.5mm; }
    .no-print { display: none !important; }
  }
  @media screen and (max-width: 900px) {
    .sheet { width: auto; max-width: 100%; min-height: 0; margin: 8px; }
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
    body.push('<h1>Vocabulary List</h1>');
    body.push('<p class="lede">Study these words <b>before</b> you read. They were gathered from every worksheet section, then placed here at the front of the workbook. Definitions are student-friendly English. Example sentences are new practice sentences (not copied from the book).</p>');
    body.push(vocabTableHtml(master, { withExample: true, exampleLabel: 'Example sentence' }));
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
  normalizeChoiceText,
  usefulReadingLocator,
  readingRangeIsRedundant,
  compactExtendedPrompt
};
