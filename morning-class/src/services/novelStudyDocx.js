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
  HeadingLevel
} = require('docx');

const FONT = 'Calibri';
const SIZE = 20; // 10pt
const SIZE_TITLE = 32;
const SIZE_H1 = 26;
const SIZE_H2 = 22;
const MARGIN = 720; // 0.5 inch in twips

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
    children: [run(text, { bold: true, size })]
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

/** Empty paragraph with bottom border = answer line */
function answerLine() {
  return new Paragraph({
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 1 }
    },
    spacing: { after: 160, before: 40 },
    children: [run(' ')]
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
    p([run('Novel / Book Study Workbook', { size: SIZE_TITLE, bold: true })], {
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

function buildMasterVocab(parts) {
  const children = [
    heading('Master Vocabulary List', HeadingLevel.HEADING_1),
    p([run(
      'Study these words from the whole book. Definitions are student-friendly English.',
      { italics: true }
    )])
  ];
  const seen = new Set();
  let n = 0;
  (parts || []).forEach((part) => {
    (part.vocab || []).forEach((v) => {
      const key = String(v.word || '').toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      n += 1;
      const pos = v.partOfSpeech ? ' (' + v.partOfSpeech + ')' : '';
      children.push(p([
        run(n + '. ', { bold: true }),
        run(v.word + pos, { bold: true }),
        run(' — ' + (v.definition || ''))
      ], { spacing: { after: 80 } }));
      if (v.exampleFromText) {
        children.push(p([
          run('   Example: "', { italics: true }),
          run(v.exampleFromText, { italics: true }),
          run('"', { italics: true })
        ], { spacing: { after: 120 } }));
      }
    });
  });
  if (!n) {
    children.push(p([run('No vocabulary items were generated.', { italics: true })]));
  }
  return children;
}

function buildPartWorksheet(part, options) {
  const shortLines = 2;
  const reflectionLines = 3;
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

  children.push(heading('A. Vocabulary', HeadingLevel.HEADING_2));
  (part.vocab || []).forEach((v, i) => {
    const pos = v.partOfSpeech ? ' (' + v.partOfSpeech + ')' : '';
    children.push(p([
      run((i + 1) + '. ', { bold: true }),
      run((v.word || '') + pos, { bold: true }),
      run(' — ' + (v.definition || ''))
    ]));
    if (v.exampleFromText) {
      children.push(p([run('From the text: "' + v.exampleFromText + '"', { italics: true })]));
    }
  });
  if (!(part.vocab || []).length) {
    children.push(p([run('(No vocabulary for this section.)', { italics: true })]));
  }

  children.push(heading('B. Multiple Choice', HeadingLevel.HEADING_2));
  (part.multipleChoice || []).forEach((q, i) => {
    children.push(p([
      run((i + 1) + '. ', { bold: true }),
      run(q.question || '')
    ]));
    (q.choices || []).forEach((c, ci) => {
      children.push(p([run(choiceLetter(ci) + '. ' + c)], { spacing: { after: 40 } }));
    });
    children.push(blank());
  });
  if (!(part.multipleChoice || []).length) {
    children.push(p([run('(No multiple-choice questions.)', { italics: true })]));
  }

  children.push(heading('C. Short Answer', HeadingLevel.HEADING_2));
  (part.shortAnswer || []).forEach((q, i) => {
    children.push(p([
      run((i + 1) + '. ', { bold: true }),
      run(q.question || '')
    ]));
    children.push(...answerLines(shortLines));
  });
  if (!(part.shortAnswer || []).length) {
    children.push(p([run('(No short-answer questions.)', { italics: true })]));
  }

  children.push(heading('D. Reflection', HeadingLevel.HEADING_2));
  (part.reflection || []).forEach((q, i) => {
    children.push(p([
      run((i + 1) + '. ', { bold: true }),
      run(q.question || '')
    ]));
    children.push(...answerLines(reflectionLines));
  });
  if (!(part.reflection || []).length) {
    children.push(p([run('(No reflection prompts.)', { italics: true })]));
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
    children.push(...answerLines(4));
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
      children.push(p([run('Reflection', { bold: true })]));
      part.reflection.forEach((q, i) => {
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
  children.push(pageBreak());
  children.push(...buildMasterVocab(parts));

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
          size: { width: 12240, height: 15840 }, // US Letter
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
