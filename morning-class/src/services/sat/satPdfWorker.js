'use strict';

/**
 * Child process that reads PDFs with pdf.js: page count, text layer, page images, figure crops.
 * It runs outside the web process so rendering thousands of pages never blocks requests,
 * and a PDF that crashes the renderer only takes this process down.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { createCanvas } = require('@napi-rs/canvas');

const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));
const MAX_OPEN_DOCS = 2;
const CROP_EDGE = 2200;
const INK_LEVEL = 232;

let pdfjsPromise = null;
const docs = new Map();

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(pathToFileURL(path.join(PDFJS_DIR, 'legacy', 'build', 'pdf.mjs')).href);
  }
  return pdfjsPromise;
}

function dirUrl(name) {
  return path.join(PDFJS_DIR, name) + path.sep;
}

async function openDoc(file) {
  const cached = docs.get(file);
  if (cached) {
    cached.usedAt = Date.now();
    return cached.doc;
  }
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    url: file,
    standardFontDataUrl: dirUrl('standard_fonts'),
    cMapUrl: dirUrl('cmaps'),
    cMapPacked: true,
    wasmUrl: dirUrl('wasm'),
    iccUrl: dirUrl('iccs'),
    verbosity: 0
  }).promise;
  docs.set(file, { doc, usedAt: Date.now() });
  if (docs.size > MAX_OPEN_DOCS) {
    const oldest = Array.from(docs.entries()).sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
    docs.delete(oldest[0]);
    oldest[1].doc.destroy().catch(() => {});
  }
  return doc;
}

async function closeDoc(file) {
  const cached = docs.get(file);
  if (!cached) return;
  docs.delete(file);
  await cached.doc.destroy().catch(() => {});
}

async function pageText(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const content = await page.getTextContent();
  let text = '';
  content.items.forEach((item) => {
    if (typeof item.str !== 'string') return;
    text += item.str;
    if (item.hasEOL) text += '\n';
  });
  page.cleanup();
  return text;
}

async function renderCanvas(doc, pageNo, maxEdge) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = maxEdge / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  page.cleanup();
  return canvas;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Fit a rough box to what is drawn on the page.
 *
 * Each side is looked at on its own. A side lying on blank paper moves inward to the first
 * ink. A side that cuts through ink looks at the block of ink it cuts: a big block is the
 * figure itself, so the side moves outward to the block's end. A small block that sticks out
 * of the box with blank space behind it is a neighbour (a choice letter, a caption band, a
 * line of text), so the side moves inward past it.
 */
function snapBox(ctx, width, height, box) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const ink = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i] < INK_LEVEL || data[i + 1] < INK_LEVEL || data[i + 2] < INK_LEVEL;
  };

  // A gap narrower than this (about 4pt at crop resolution) does not end a block.
  const GAP = 12;
  const NEIGHBOUR_SHARE = 0.15;
  const b = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };

  const rowInk = (y) => {
    for (let x = b.left; x <= b.right; x++) if (ink(x, y)) return true;
    return false;
  };
  const colInk = (x) => {
    for (let y = b.top; y <= b.bottom; y++) if (ink(x, y)) return true;
    return false;
  };

  /**
   * Move one side. at: current position. out: -1 when "outward" means a smaller coordinate.
   * farOut / farIn: how far the side may travel. span: box size along this axis.
   */
  const fit = (hasInk, at, out, farOut, farIn, span) => {
    const inward = -out;
    const beyond = (pos, limit, dir) => (dir > 0 ? pos > limit : pos < limit);
    const blankRun = (from, dir, limit) => {
      for (let k = 1; k <= GAP; k++) {
        const pos = from + dir * k;
        if (beyond(pos, limit, dir)) return true;
        if (hasInk(pos)) return false;
      }
      return true;
    };
    const skipBlank = (from) => {
      let pos = from;
      while (!beyond(pos + inward, farIn, inward) && !hasInk(pos)) pos += inward;
      return pos;
    };

    if (!hasInk(at)) return skipBlank(at);

    let outer = at;
    while (!beyond(outer + out, farOut, out) && !blankRun(outer, out, farOut)) outer += out;
    while (outer !== at && !hasInk(outer)) outer -= out;
    let inner = at;
    let reachedEnd = false;
    for (;;) {
      if (beyond(inner + inward, farIn, inward)) { reachedEnd = true; break; }
      if (blankRun(inner, inward, farIn)) break;
      inner += inward;
    }
    const sticksOut = Math.abs(at - outer);
    const blockSize = Math.abs(inner - outer) + 1;
    if (!reachedEnd && sticksOut >= 3 && blockSize < span * NEIGHBOUR_SHARE) {
      return skipBlank(inner + inward);
    }
    return outer;
  };

  const growX = Math.round(width * 0.05);
  const growY = Math.round(height * 0.05);
  const limits = {
    top: Math.max(0, b.top - growY),
    bottom: Math.min(height - 1, b.bottom + growY),
    left: Math.max(0, b.left - growX),
    right: Math.min(width - 1, b.right + growX)
  };
  for (let pass = 0; pass < 2; pass++) {
    const h = b.bottom - b.top + 1;
    const midY = Math.round((b.top + b.bottom) / 2);
    b.top = fit(rowInk, b.top, -1, limits.top, midY, h);
    b.bottom = fit(rowInk, b.bottom, 1, limits.bottom, midY, h);
    const w = b.right - b.left + 1;
    const midX = Math.round((b.left + b.right) / 2);
    b.left = fit(colInk, b.left, -1, limits.left, midX, w);
    b.right = fit(colInk, b.right, 1, limits.right, midX, w);
  }

  const pad = 6;
  return {
    left: clamp(b.left - pad, 0, width - 1),
    top: clamp(b.top - pad, 0, height - 1),
    right: clamp(b.right + pad, 0, width - 1),
    bottom: clamp(b.bottom + pad, 0, height - 1)
  };
}

async function cropFigure(doc, pageNo, box, snap) {
  const canvas = await renderCanvas(doc, pageNo, CROP_EDGE);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  let px = {
    left: clamp(Math.round(Math.min(box[0], box[2]) * w), 0, w - 1),
    top: clamp(Math.round(Math.min(box[1], box[3]) * h), 0, h - 1),
    right: clamp(Math.round(Math.max(box[0], box[2]) * w), 0, w - 1),
    bottom: clamp(Math.round(Math.max(box[1], box[3]) * h), 0, h - 1)
  };
  if (px.right - px.left < 8 || px.bottom - px.top < 8) {
    throw new Error('Crop box is too small.');
  }
  if (snap) px = snapBox(ctx, w, h, px);
  const cw = px.right - px.left + 1;
  const ch = px.bottom - px.top + 1;
  if (cw < 8 || ch < 8) throw new Error('Nothing is drawn inside the crop box.');
  const out = createCanvas(cw, ch);
  out.getContext('2d').drawImage(canvas, px.left, px.top, cw, ch, 0, 0, cw, ch);
  let data = out.toBuffer('image/png');
  let mime = 'image/png';
  if (data.length > 400 * 1024) {
    data = out.toBuffer('image/jpeg', 88);
    mime = 'image/jpeg';
  }
  return {
    data,
    mime,
    width: cw,
    height: ch,
    box: [px.left / w, px.top / h, px.right / w, px.bottom / h].map((v) => Math.round(v * 10000) / 10000)
  };
}

const OPS = {
  async open(args) {
    const doc = await openDoc(args.file);
    return { pages: doc.numPages };
  },
  async texts(args) {
    const doc = await openDoc(args.file);
    const to = Math.min(args.to, doc.numPages);
    const pages = [];
    for (let n = args.from; n <= to; n++) {
      pages.push({ page: n, text: await pageText(doc, n) });
    }
    return { pages };
  },
  async render(args) {
    const doc = await openDoc(args.file);
    const canvas = await renderCanvas(doc, args.page, args.maxEdge || 1568);
    return {
      data: canvas.toBuffer('image/jpeg', args.quality || 82),
      mime: 'image/jpeg',
      width: canvas.width,
      height: canvas.height
    };
  },
  async crop(args) {
    const doc = await openDoc(args.file);
    return cropFigure(doc, args.page, args.box, args.snap !== false);
  },
  async close(args) {
    await closeDoc(args.file);
    return {};
  }
};

let chain = Promise.resolve();

process.on('message', (msg) => {
  if (!msg || !msg.id) return;
  chain = chain.then(async () => {
    try {
      const op = OPS[msg.op];
      if (!op) throw new Error('Unknown PDF operation: ' + msg.op);
      const result = await op(msg.args || {});
      process.send({ id: msg.id, ok: true, result });
    } catch (e) {
      process.send({ id: msg.id, ok: false, error: (e && e.message) || String(e) });
    }
  });
});

process.on('disconnect', () => process.exit(0));
