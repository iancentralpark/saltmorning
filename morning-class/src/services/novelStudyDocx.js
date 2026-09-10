/**
 * Novel Study workbook → .docx (Calibri 10pt, 0.5" margins).
 */
'use strict';

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  PageBreak,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  VerticalAlign
} = require('docx');

const { normalizeChoices } = require('./novelStudyHtml');

const FONT = 'Calibri';
const SIZE = 20; // 10pt
const SIZE_TITLE = 32;
const SIZE_H1 = 26;
const SIZE_H2 = 22;
const MARGIN = 720; // 0.5 inch in twips
const PAGE_WIDTH = 11906;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // ~10466

function run(text, opts) {
  return new TextRun(Object.assign({
    text: String(text == null ? '' : text),
    font: FONT,
    size: SIZE
  }, opts || {}));
}

function p(children, opts) {
  return new Paragraph(Object.assign({
    spacing: { after: 120 },
    children: Array.isArray(children) ? children : [run(children)]
  }, opts || {}));
}

function heading(text, level) {
  const size = level === HeadingLevel.HEADING_1 ? SIZE_H1 : SIZE_H2;
  return new Paragraph({
    heading: level,
    spacing: { before: 200, after: 140 },
    children: [run(text, { bold: true, size, color: '0D2748' })]
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

/**
 * Visible ruled lines that survive Word + Google Docs import.
 * Paragraph bottom borders often disappear; underscore runs do not.
 */
function answerLine() {
  return new Paragraph({
    spacing: { after: 40, before: 40, line: 360 },
    children: [run('___________________________________________________________________________', {
      color: '334155',
      size: 18
    })]
  });
}

function answerLines(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(answerLine());
  return out;
}

function blank() {
  return p('', { spacing: { after: 80 } });
}

function choiceLetter(i) {
  return String.fromCharCode(65 + i);
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

function cellPara(children, opts) {
  return new Paragraph(Object.assign({
    spacing: { after: 40, before: 40 },
    children: Array.isArray(children) ? children : [run(children)]
  }, opts || {}));
}

function vocabCell(text, opts) {
  const o = opts || {};
  return new TableCell({
    width: { size: o.width || 3000, type: WidthType.DXA },
    shading: o.shading ? { type: ShadingType.CLEAR, fill: o.shading } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'C5D0DA' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C5D0DA' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'C5D0DA' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'C5D0DA' }
    },
    children: [cellPara(
      Array.isArray(text) ? text : [run(text, o.runOpts || {})],
      { spacing: { after: 60, before: 60 } }
    )]
  });
}

function buildVocabTable(items, opts) {
  const withExample = !!(opts && opts.withExample);
  const colNum = 700;
  const colWord = withExample ? 2200 : 2800;
  const colDef = withExample ? 4200 : CONTENT_WIDTH - colNum - colWord;
  const colEx = withExample ? CONTENT_WIDTH - colNum - colWord - colDef : 0;

  const headerRuns = (label) => [run(label, { bold: true, color: 'FFFFFF', size: 18 })];
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      vocabCell(headerRuns('#'), { width: colNum, shading: '0D2748' }),
      vocabCell(headerRuns('Word'), { width: colWord, shading: '0D2748' }),
      vocabCell(headerRuns('Definition'), { width: colDef, shading: '0D2748' }),
      ...(withExample
        ? [vocabCell(headerRuns('From the text'), { width: colEx, shading: '0D2748' })]
        : [])
    ]
  });

  const rows = [headerRow];
  items.forEach((v, i) => {
    const shade = i % 2 === 0 ? 'F3F7F8' : 'FFFFFF';
    const pos = v.partOfSpeech ? ' (' + v.partOfSpeech + ')' : '';
    const cells = [
      vocabCell([run(String(i + 1), { size: 18, color: '5B6B7C' })], { width: colNum, shading: shade }),
      vocabCell([
        run(String(v.word || ''), { bold: true, size: 18 }),
        run(pos, { size: 16, color: '5B6B7C' })
      ], { width: colWord, shading: shade }),
      vocabCell([run(String(v.definition || ''), { size: 18 })], { width: colDef, shading: shade })
    ];
    if (withExample) {
      cells.push(vocabCell(
        [run(String(v.exampleFromText || ''), { italics: true, size: 16, color: '334155' })],
        { width: colEx, shading: shade }
      ));
    }
    rows.push(new TableRow({ children: cells }));
  });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: withExample
      ? [colNum, colWord, colDef, colEx]
      : [colNum, colWord, colDef],
    rows
  });
}

function buildCover(meta, options) {
  const title = (meta && meta.title) || 'Untitled Book';
  const author = (meta && meta.author) || 'Unknown';
  const genre = (meta && meta.genre) || 'fiction';
  const level = (options && options.level) || 'middle';
  return [
    blank(),
    blank(),
    p([run('Salt Morning Class', { size: SIZE_H2, bold: true, color: '0D2748' })], {
      alignment: AlignmentType.CENTER
    }),
    blank(),
    p([run('Novel / Book Study Workbook', { size: SIZE_TITLE, bold: true, color: '0D6E6E' })], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 280 }
    }),
    p([run(title, { size: 28, bold: true })], { alignment: AlignmentType.CENTER }),
    p([run('by ' + author, { italics: true, size: 22 })], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 }
    }),
    p([run('Genre: ' + (genre === 'nonfiction' ? 'Nonfiction' : 'Fiction'))], {
      alignment: AlignmentType.CENTER
    }),
    p([run('Level: ' + String(level))], { alignment: AlignmentType.CENTER }),
    blank(),
    blank(),
    p([run('Student name: ____________________')], { alignment: AlignmentType.CENTER }),
    p([run('Class / Date: ____________________')], { alignment: AlignmentType.CENTER }),
    blank(),
    p([run(
      'Read each section carefully. Use evidence from the text when you answer. ' +
      'Complete the culminating task after all section worksheets.'
    )], { alignment: AlignmentType.CENTER, spacing: { before: 300 } })
  ];
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

function buildMasterVocab(parts) {
  const items = collectMasterVocab(parts);
  if (!items.length) return [];
  const children = [
    heading('Master Vocabulary List', HeadingLevel.HEADING_1),
    p([run(
      'Study these words from the whole book. Definitions are student-friendly English.',
      { italics: true, color: '5B6B7C' }
    )]),
    buildVocabTable(items, { withExample: false }),
    blank()
  ];
  return children;
}

function buildPartWorksheet(part, options) {
  const shortLines = 3;
  const reflectionLines = 7;
  const vocab = part.vocab || [];
  const hasVocab = vocab.length > 0;
  const letters = sectionLetters(hasVocab);

  const children = [
    heading(
      'Part ' + part.partNum + ': ' + (part.unitTitle || 'Section'),
      HeadingLevel.HEADING_1
    ),
    p([run(
      'Pages ' + (part.startPage || '?') + '–' + (part.endPage || '?'),
      { italics: true, color: '555555' }
    )])
  ];

  if (hasVocab) {
    children.push(heading(letters.vocab + '. Vocabulary', HeadingLevel.HEADING_2));
    children.push(buildVocabTable(vocab, { withExample: true }));
    children.push(blank());
  }

  children.push(heading(letters.mc + '. Multiple Choice', HeadingLevel.HEADING_2));
  (part.multipleChoice || []).forEach((q, i) => {
    children.push(p([
      run((i + 1) + '. ', { bold: true }),
      run(q.question || '')
    ]));
    const choices = normalizeChoices(q.choices || q.options);
    for (let ci = 0; ci < 4; ci += 1) {
      const text = choices[ci] || '________________';
      children.push(p(
        [run(choiceLetter(ci) + '.  ' + text)],
        { spacing: { after: 60 }, indent: { left: 288 } }
      ));
    }
    children.push(blank());
  });
  if (!(part.multipleChoice || []).length) {
    children.push(p([run('(No multiple-choice questions.)', { italics: true })]));
  }

  children.push(heading(letters.short + '. Short Answer', HeadingLevel.HEADING_2));
  (part.shortAnswer || []).forEach((q, i) => {
    children.push(p([
      run((i + 1) + '. ', { bold: true }),
      run(q.question || '')
    ]));
    children.push(...answerLines(shortLines));
    children.push(blank());
  });
  if (!(part.shortAnswer || []).length) {
    children.push(p([run('(No short-answer questions.)', { italics: true })]));
  }

  children.push(heading(letters.reflection + '. Extended Response', HeadingLevel.HEADING_2));
  (part.reflection || []).forEach((q, i) => {
    const typeLabel = reflectionTypeLabel(q.type);
    children.push(p([
      run((i + 1) + '. ', { bold: true }),
      ...(typeLabel
        ? [run('[' + typeLabel + '] ', { bold: true, color: '0D6E6E', size: 18 })]
        : []),
      run(q.question || '')
    ]));
    children.push(...answerLines(reflectionLines));
    children.push(blank());
  });
  if (!(part.reflection || []).length) {
    children.push(p([run('(No extended-response prompts.)', { italics: true })]));
  }

  if (options && options.pageOverflowRisk) {
    children.push(p([
      run('Note: Extra items may need more than one page.', { italics: true, size: 16, color: '666666' })
    ]));
  }

  return children;
}

function buildCulminating(culminating, genre) {
  const children = [
    heading('Culminating Task', HeadingLevel.HEADING_1),
    p([run(
      genre === 'nonfiction'
        ? 'Answer these three synthesis questions about the whole nonfiction text.'
        : 'Answer these three synthesis questions about the whole fiction text.',
      { italics: true }
    )])
  ];
  const prompts = (culminating && culminating.prompts) || [];
  prompts.forEach((q, i) => {
    const label = q.label ? q.label + ': ' : '';
    children.push(p([
      run((i + 1) + '. ' + label, { bold: true }),
      run(q.question || '')
    ]));
    children.push(...answerLines(6));
    children.push(blank());
  });
  if (!prompts.length) {
    children.push(p([run('(Culminating prompts unavailable.)', { italics: true })]));
  }
  return children;
}

function buildAnswerKey(parts, culminating, meta) {
  const children = [
    heading('Teacher Answer Key', HeadingLevel.HEADING_1),
    p([run(
      ((meta && meta.title) || 'Book') + ' — for teacher use. Evidence quotes must match the source text.',
      { italics: true }
    )])
  ];

  (parts || []).forEach((part) => {
    children.push(heading(
      'Part ' + part.partNum + ': ' + (part.unitTitle || 'Section'),
      HeadingLevel.HEADING_2
    ));

    if ((part.vocab || []).length) {
      children.push(p([run('Vocabulary', { bold: true })]));
      part.vocab.forEach((v, i) => {
        children.push(p([
          run((i + 1) + '. ' + (v.word || '') + ' — ' + (v.definition || ''))
        ], { spacing: { after: 40 } }));
        if (v.evidenceQuote || v.exampleFromText) {
          children.push(p([
            run('Evidence: "' + (v.evidenceQuote || v.exampleFromText) + '"', { italics: true })
          ], { spacing: { after: 100 } }));
        }
      });
    }

    if ((part.multipleChoice || []).length) {
      children.push(p([run('Multiple Choice', { bold: true })]));
      part.multipleChoice.forEach((q, i) => {
        children.push(p([
          run((i + 1) + '. ' + (q.answer || '?') + ' — ' + (q.question || ''))
        ], { spacing: { after: 40 } }));
        const choices = normalizeChoices(q.choices || q.options);
        if (choices.length) {
          children.push(p([
            run(choices.map((c, ci) => choiceLetter(ci) + '. ' + c).join('  ·  '), {
              size: 16,
              color: '5B6B7C'
            })
          ], { spacing: { after: 40 } }));
        }
        if (q.evidenceQuote) {
          children.push(p([
            run('Evidence: "' + q.evidenceQuote + '"', { italics: true })
          ], { spacing: { after: 100 } }));
        }
      });
    }

    if ((part.shortAnswer || []).length) {
      children.push(p([run('Short Answer', { bold: true })]));
      part.shortAnswer.forEach((q, i) => {
        children.push(p([
          run((i + 1) + '. ' + (q.question || ''))
        ], { spacing: { after: 40 } }));
        children.push(p([
          run('Sample: ' + (q.sampleAnswer || ''), { italics: true })
        ], { spacing: { after: 40 } }));
        if (q.evidenceQuote) {
          children.push(p([
            run('Evidence: "' + q.evidenceQuote + '"', { italics: true })
          ], { spacing: { after: 100 } }));
        }
      });
    }

    if ((part.reflection || []).length) {
      children.push(p([run('Extended Response', { bold: true })]));
      part.reflection.forEach((q, i) => {
        const typeLabel = reflectionTypeLabel(q.type);
        children.push(p([
          run((i + 1) + '. ' + (typeLabel ? '[' + typeLabel + '] ' : '') + (q.question || ''))
        ], { spacing: { after: 40 } }));
        children.push(p([
          run('Sample: ' + (q.sampleAnswer || ''), { italics: true })
        ], { spacing: { after: 40 } }));
        if (q.evidenceQuote) {
          children.push(p([
            run('Evidence: "' + q.evidenceQuote + '"', { italics: true })
          ], { spacing: { after: 100 } }));
        }
      });
    }
  });

  const prompts = (culminating && culminating.prompts) || [];
  if (prompts.length) {
    children.push(heading('Culminating Task', HeadingLevel.HEADING_2));
    prompts.forEach((q, i) => {
      children.push(p([
        run((i + 1) + '. ' + (q.label ? q.label + ' — ' : '') + (q.question || ''))
      ], { spacing: { after: 40 } }));
      children.push(p([
        run('Sample: ' + (q.sampleAnswer || ''), { italics: true })
      ], { spacing: { after: 40 } }));
      if (q.evidenceQuote) {
        children.push(p([
          run('Evidence: "' + q.evidenceQuote + '"', { italics: true })
        ], { spacing: { after: 100 } }));
      }
    });
  }

  return children;
}

/**
 * @param {object} job
 * @returns {Promise<Buffer>}
 */
async function buildWorkbookDocx(job) {
  const meta = job.meta || { title: 'Untitled Book', author: 'Unknown', genre: 'fiction' };
  const options = job.options || {};
  const parts = job.parts || [];
  const culminating = job.culminating || null;
  const genre = meta.genre === 'nonfiction' ? 'nonfiction' : 'fiction';

  const children = [];
  children.push(...buildCover(meta, options));

  const master = buildMasterVocab(parts);
  if (master.length) {
    children.push(pageBreak());
    children.push(...master);
  }

  parts.forEach((part) => {
    children.push(pageBreak());
    children.push(...buildPartWorksheet(part, options));
  });

  children.push(pageBreak());
  children.push(...buildCulminating(culminating, genre));

  children.push(pageBreak());
  children.push(...buildAnswerKey(parts, culminating, meta));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: 16838 },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }
        }
      },
      children
    }]
  });

  return Packer.toBuffer(doc);
}

module.exports = {
  buildWorkbookDocx
};
