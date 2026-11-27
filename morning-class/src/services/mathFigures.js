'use strict';

/**
 * Geometry figures are a small spec, not freehand SVG.
 * The spec lists the givens. The unknown is drawn as "?".
 * checkFigure accepts the item only when those givens determine the printed answer.
 */

const { parseAnswer, formatRat } = require('./mathVerify');

const KIND_BY_CHAPTER = {
  'gm-c01': ['point', 'translate', 'distance'],
  'gm-c02': ['angles'],
  'gm-c03': ['triangle'],
  'gm-c04': ['polygon'],
  'gm-c05': ['area'],
  'gm-c06': ['circle'],
  'gm-c07': ['prism'],
  'gm-c08': ['scale']
};

const PI = rat(314, 100);

function rat(n, d) {
  if (!d) throw new Error('div0');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(Math.abs(n), d);
  return { n: n / g, d: d / g };
}

function gcd(a, b) {
  let x = a;
  let y = b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function radd(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
function rsub(a, b) { return rat(a.n * b.d - b.n * a.d, a.d * b.d); }
function rmul(a, b) { return rat(a.n * b.n, a.d * b.d); }
function rdiv(a, b) {
  if (!b || b.n === 0) throw new Error('div0');
  return rat(a.n * b.d, a.d * b.n);
}
function req(a, b) { return a.n === b.n && a.d === b.d; }

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseLoose(raw) {
  let s = String(raw == null ? '' : raw).trim();
  s = s.replace(/^\$+|\$+$/g, '').trim();
  s = s.replace(/°/g, '').replace(/\s*(degrees|degree|deg)\s*$/i, '').trim();
  return parseAnswer(s);
}

function format(v) {
  return formatRat(v);
}

function takeRat(v) {
  try {
    const r = parseLoose(v);
    if (!Number.isFinite(r.n) || !Number.isFinite(r.d)) return null;
    if (Math.abs(r.n) > 5000 || r.d > 100) return null;
    return r;
  } catch (e) {
    return null;
  }
}

function takeInt(v, min, max) {
  const r = takeRat(v);
  if (!r || r.d !== 1 || r.n < min || r.n > max) return null;
  return r.n;
}

function takePos(v) {
  const r = takeRat(v);
  if (!r || r.n <= 0) return null;
  return r;
}

function isGeometryChapter(chapter) {
  return !!(chapter && chapter.curriculumId === 'geometry');
}

function allowedKinds(chapter) {
  if (chapter && chapter.curriculumId && chapter.curriculumId !== 'geometry') return [];
  if (chapter && KIND_BY_CHAPTER[chapter.id]) return KIND_BY_CHAPTER[chapter.id];
  return Object.keys(KIND_BY_CHAPTER).reduce((acc, id) => acc.concat(KIND_BY_CHAPTER[id]), []);
}

function asObject(raw) {
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    try { value = JSON.parse(text); } catch (e) { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function nameOf(raw, fallback) {
  const s = String(raw || '').trim();
  if (/^[A-Za-z]$/.test(s)) return s.toUpperCase();
  return fallback;
}

function kindOf(raw) {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'grid' || k === 'coordinate' || k === 'orderedpair') return 'point';
  if (k === 'slide' || k === 'translation') return 'translate';
  if (k === 'segment') return 'distance';
  if (k === 'angle' || k === 'anglepair') return 'angles';
  if (k === 'box' || k === 'rectangularprism') return 'prism';
  return k;
}

function relationOf(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'complementary' || s === 'complement') return 'complement';
  if (s === 'supplementary' || s === 'supplement' || s === 'straight') return 'supplement';
  if (s === 'vertical' || s === 'opposite') return 'vertical';
  if (s === 'around' || s === 'full' || s === 'point') return 'around';
  return '';
}

function numList(raw, limit) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (let i = 0; i < raw.length && out.length < limit; i++) {
    const n = takePos(raw[i]);
    if (!n) return null;
    out.push(n);
  }
  return out;
}

function normalizeFigure(raw, chapter) {
  const src = asObject(raw);
  if (!src) return null;
  const kind = kindOf(src.kind || src.type);
  if (!allowedKinds(chapter).includes(kind)) return null;
  if (kind === 'point') return normPoint(src);
  if (kind === 'translate') return normTranslate(src);
  if (kind === 'distance') return normDistance(src);
  if (kind === 'angles') return normAngles(src);
  if (kind === 'triangle') return normTriangle(src);
  if (kind === 'polygon') return normPolygon(src);
  if (kind === 'area') return normArea(src);
  if (kind === 'circle') return normCircle(src);
  if (kind === 'prism') return normPrism(src);
  if (kind === 'scale') return normScale(src);
  return null;
}

function pack(figure) {
  try {
    expectedOf(figure);
    return figure;
  } catch (e) {
    return null;
  }
}

function normPoint(src) {
  const x = takeInt(src.x, -8, 8);
  const y = takeInt(src.y, -8, 8);
  if (x == null || y == null) return null;
  return pack({ kind: 'point', name: nameOf(src.name, 'A'), x: x, y: y });
}

function normTranslate(src) {
  const x = takeInt(src.x, -8, 8);
  const y = takeInt(src.y, -8, 8);
  const dx = takeInt(src.dx, -12, 12);
  const dy = takeInt(src.dy, -12, 12);
  if (x == null || y == null || dx == null || dy == null) return null;
  if (!dx && !dy) return null;
  if (x + dx < -8 || x + dx > 8 || y + dy < -8 || y + dy > 8) return null;
  return pack({ kind: 'translate', name: nameOf(src.name, 'A'), x: x, y: y, dx: dx, dy: dy });
}

function normDistance(src) {
  const x1 = takeInt(src.x1, -8, 8);
  const y1 = takeInt(src.y1, -8, 8);
  const x2 = takeInt(src.x2, -8, 8);
  const y2 = takeInt(src.y2, -8, 8);
  if ([x1, y1, x2, y2].some((n) => n == null)) return null;
  if (x1 !== x2 && y1 !== y2) return null;
  if (x1 === x2 && y1 === y2) return null;
  const names = Array.isArray(src.names) ? src.names : [src.name1, src.name2];
  return pack({
    kind: 'distance',
    names: [nameOf(names[0], 'A'), nameOf(names[1], 'B')],
    x1: x1, y1: y1, x2: x2, y2: y2
  });
}

function normAngles(src) {
  const relation = relationOf(src.relation);
  if (!relation) return null;
  const known = numList(src.known, 3);
  if (!known || !known.length) return null;
  if ((relation === 'complement' || relation === 'supplement' || relation === 'vertical') && known.length !== 1) return null;
  if (relation === 'around' && known.length > 3) return null;
  if (known.some((n) => n.d !== 1)) return null;
  return pack({ kind: 'angles', relation: relation, known: known.map((n) => n.n) });
}

function normTriangle(src) {
  const find = String(src.find || '').trim().toLowerCase();
  if (find === 'angle' || find === 'missingangle') {
    const angles = numList(src.angles, 2);
    if (!angles || angles.length !== 2 || angles.some((n) => n.d !== 1)) return null;
    return pack({ kind: 'triangle', find: 'angle', angles: angles.map((n) => String(n.n)) });
  }
  if (find === 'perimeter') {
    const sides = numList(src.sides, 3);
    if (!sides || sides.length !== 3) return null;
    return pack({ kind: 'triangle', find: 'perimeter', sides: sides.map(format) });
  }
  if (find === 'hypotenuse' || find === 'side') {
    const legs = numList(src.legs || src.sides, 2);
    if (!legs || legs.length !== 2) return null;
    if (legs[0].d !== 1 || legs[1].d !== 1) return null;
    return pack({ kind: 'triangle', find: 'hypotenuse', legs: [legs[0].n, legs[1].n] });
  }
  return null;
}

function normPolygon(src) {
  const find = String(src.find || '').trim().toLowerCase();
  if (find === 'angle' || find === 'missingangle') {
    const sides = takeInt(src.sides || src.count || src.n, 3, 8);
    const angles = numList(src.angles, 7);
    if (!sides || !angles || angles.length !== sides - 1 || angles.some((n) => n.d !== 1)) return null;
    return pack({ kind: 'polygon', find: 'angle', sides: sides, angles: angles.map((n) => String(n.n)) });
  }
  if (find === 'perimeter') {
    if (src.side != null && (src.count != null || src.sides != null)) {
      const side = takePos(src.side);
      const count = takeInt(src.count || src.sides, 3, 12);
      if (!side || !count) return null;
      return pack({ kind: 'polygon', find: 'perimeter', side: format(side), count: count });
    }
    const sides = numList(src.sides, 8);
    if (!sides || sides.length < 3) return null;
    return pack({ kind: 'polygon', find: 'perimeter', sides: sides.map(format) });
  }
  return null;
}

function normArea(src) {
  const shape = String(src.shape || 'rectangle').trim().toLowerCase();
  if (!['rectangle', 'rect', 'triangle', 'parallelogram'].includes(shape)) return null;
  const clean = shape === 'rect' ? 'rectangle' : shape;
  const find = String(src.find || 'area').trim().toLowerCase();
  if (!['area', 'base', 'height', 'width', 'length'].includes(find)) return null;
  const base = src.base != null ? takePos(src.base) : (src.length != null ? takePos(src.length) : null);
  const height = src.height != null ? takePos(src.height) : (src.width != null ? takePos(src.width) : null);
  const area = src.area != null ? takePos(src.area) : null;
  const want = find === 'length' ? 'base' : (find === 'width' ? 'height' : find);
  const out = { kind: 'area', shape: clean, find: want };
  if (want === 'area') {
    if (!base || !height) return null;
    out.base = format(base);
    out.height = format(height);
  } else if (want === 'height') {
    if (!base || !area) return null;
    out.base = format(base);
    out.area = format(area);
  } else if (want === 'base') {
    if (!height || !area) return null;
    out.height = format(height);
    out.area = format(area);
  } else return null;
  return pack(out);
}

function normCircle(src) {
  const find = String(src.find || '').trim().toLowerCase();
  if (!['circumference', 'area', 'diameter', 'radius'].includes(find)) return null;
  const radius = src.radius != null ? takePos(src.radius) : null;
  const diameter = src.diameter != null ? takePos(src.diameter) : null;
  const out = { kind: 'circle', find: find };
  if (find === 'radius') {
    if (!diameter) return null;
    out.diameter = format(diameter);
  } else if (find === 'diameter') {
    if (!radius) return null;
    out.radius = format(radius);
  } else if (radius) out.radius = format(radius);
  else if (diameter) out.diameter = format(diameter);
  else return null;
  return pack(out);
}

function normPrism(src) {
  const find = String(src.find || '').trim().toLowerCase();
  if (!['volume', 'surface', 'height', 'length', 'width'].includes(find)) return null;
  const want = find === 'surfacearea' ? 'surface' : find;
  const read = (key, alt) => (src[key] != null ? takePos(src[key]) : (alt != null ? takePos(alt) : null));
  const l = read('l', src.length);
  const w = read('w', src.width);
  const h = read('h', src.height);
  const volume = src.volume != null ? takePos(src.volume) : null;
  const out = { kind: 'prism', find: want };
  if (want === 'volume' || want === 'surface') {
    if (!l || !w || !h) return null;
    out.l = format(l); out.w = format(w); out.h = format(h);
  } else if (want === 'height') {
    if (!l || !w || !volume) return null;
    out.l = format(l); out.w = format(w); out.volume = format(volume);
  } else if (want === 'length') {
    if (!w || !h || !volume) return null;
    out.w = format(w); out.h = format(h); out.volume = format(volume);
  } else if (want === 'width') {
    if (!l || !h || !volume) return null;
    out.l = format(l); out.h = format(h); out.volume = format(volume);
  } else return null;
  return pack(out);
}

function normScale(src) {
  const find = String(src.find || '').trim().toLowerCase();
  const alias = find === 'length' || find === 'actual' ? 'actual'
    : (find === 'scale' || find === 'scalefactor' ? 'factor'
      : (find === 'areascale' || find === 'areafactor' ? 'areaFactor' : find));
  if (!['actual', 'factor', 'areaFactor', 'drawing'].includes(alias)) return null;
  const drawing = src.drawing != null ? takePos(src.drawing) : null;
  const actual = src.actual != null ? takePos(src.actual) : null;
  const factor = src.factor != null ? takePos(src.factor) : null;
  const out = { kind: 'scale', find: alias };
  if (alias === 'actual') {
    if (!drawing || !factor) return null;
    out.drawing = format(drawing); out.factor = format(factor);
  } else if (alias === 'drawing') {
    if (!actual || !factor) return null;
    out.actual = format(actual); out.factor = format(factor);
  } else if (alias === 'factor') {
    if (!drawing || !actual) return null;
    out.drawing = format(drawing); out.actual = format(actual);
  } else if (alias === 'areaFactor') {
    if (!factor) return null;
    out.factor = format(factor);
  } else return null;
  return pack(out);
}

function sumRats(list) {
  return list.reduce((acc, n) => radd(acc, n), rat(0, 1));
}

function expectAngle(total, known) {
  const left = rsub(rat(total, 1), sumRats(known.map((n) => rat(n, 1))));
  if (left.n <= 0 || left.d !== 1) throw new Error('angle');
  if (left.n >= total) throw new Error('angle');
  return { value: left };
}

function triangleSidesOk(sides) {
  const [a, b, c] = sides;
  if (radd(a, b).n * c.d <= c.n * radd(a, b).d) return false;
  if (radd(a, c).n * b.d <= b.n * radd(a, c).d) return false;
  if (radd(b, c).n * a.d <= a.n * radd(b, c).d) return false;
  return true;
}

function expectedOf(figure) {
  if (!figure || !figure.kind) throw new Error('figure');
  if (figure.kind === 'point') return { pair: true, x: rat(figure.x, 1), y: rat(figure.y, 1) };
  if (figure.kind === 'translate') {
    return { pair: true, x: rat(figure.x + figure.dx, 1), y: rat(figure.y + figure.dy, 1) };
  }
  if (figure.kind === 'distance') {
    return { value: rat(Math.abs(figure.x1 - figure.x2) + Math.abs(figure.y1 - figure.y2), 1) };
  }
  if (figure.kind === 'angles') {
    if (figure.relation === 'complement') return expectAngle(90, figure.known);
    if (figure.relation === 'supplement') return expectAngle(180, figure.known);
    if (figure.relation === 'vertical') {
      const n = figure.known[0];
      if (n <= 0 || n >= 180) throw new Error('angle');
      return { value: rat(n, 1) };
    }
    return expectAngle(360, figure.known);
  }
  if (figure.kind === 'triangle') {
    if (figure.find === 'angle') {
      const angles = figure.angles.map(takeRat);
      if (angles.some((n) => !n || n.d !== 1)) throw new Error('angle');
      return expectAngle(180, angles.map((n) => n.n));
    }
    if (figure.find === 'perimeter') {
      const sides = figure.sides.map(takeRat);
      if (!triangleSidesOk(sides)) throw new Error('triangle');
      return { value: sumRats(sides) };
    }
    const a = figure.legs[0];
    const b = figure.legs[1];
    if (a <= 0 || b <= 0 || a > 40 || b > 40) throw new Error('leg');
    const hyp = intSqrt(a * a + b * b);
    if (hyp == null) throw new Error('sqrt');
    return { value: rat(hyp, 1) };
  }
  if (figure.kind === 'polygon') {
    if (figure.find === 'angle') {
      const total = (figure.sides - 2) * 180;
      const angles = figure.angles.map((n) => takeRat(n).n);
      if (angles.some((n) => n <= 0 || n >= 180)) throw new Error('angle');
      const left = expectAngle(total, angles);
      if (left.value.n >= 180) throw new Error('angle');
      return left;
    }
    if (figure.side) return { value: rmul(takeRat(figure.side), rat(figure.count, 1)) };
    const sides = figure.sides.map(takeRat);
    const total = sumRats(sides);
    sides.forEach((side) => {
      if (req(side, total) || side.n * total.d >= total.n * side.d) throw new Error('polygon');
    });
    return { value: total };
  }
  if (figure.kind === 'area') return expectArea(figure);
  if (figure.kind === 'circle') return expectCircle(figure);
  if (figure.kind === 'prism') return expectPrism(figure);
  if (figure.kind === 'scale') return expectScale(figure);
  throw new Error('figure');
}

function expectArea(figure) {
  const base = figure.base ? takeRat(figure.base) : null;
  const height = figure.height ? takeRat(figure.height) : null;
  const area = figure.area ? takeRat(figure.area) : null;
  const factor = figure.shape === 'triangle' ? rat(1, 2) : rat(1, 1);
  if (figure.find === 'area') {
    if (!base || !height) throw new Error('area');
    return { value: rmul(factor, rmul(base, height)) };
  }
  if (!area) throw new Error('area');
  if (figure.find === 'height') {
    if (!base) throw new Error('area');
    return { value: rdiv(area, rmul(factor, base)) };
  }
  if (figure.find === 'base') {
    if (!height) throw new Error('area');
    return { value: rdiv(area, rmul(factor, height)) };
  }
  throw new Error('area');
}

function expectCircle(figure) {
  let radius = figure.radius ? takeRat(figure.radius) : null;
  let diameter = figure.diameter ? takeRat(figure.diameter) : null;
  if (radius && diameter && !req(diameter, rmul(radius, rat(2, 1)))) throw new Error('circle');
  if (!radius && diameter) radius = rdiv(diameter, rat(2, 1));
  if (!diameter && radius) diameter = rmul(radius, rat(2, 1));
  if (figure.find === 'radius') return { value: radius };
  if (figure.find === 'diameter') return { value: diameter };
  if (figure.find === 'circumference') return { value: rmul(PI, diameter) };
  if (figure.find === 'area') return { value: rmul(PI, rmul(radius, radius)) };
  throw new Error('circle');
}

function expectPrism(figure) {
  const l = figure.l ? takeRat(figure.l) : null;
  const w = figure.w ? takeRat(figure.w) : null;
  const h = figure.h ? takeRat(figure.h) : null;
  const volume = figure.volume ? takeRat(figure.volume) : null;
  if (figure.find === 'volume') {
    if (!l || !w || !h) throw new Error('prism');
    return { value: rmul(l, rmul(w, h)) };
  }
  if (figure.find === 'surface') {
    if (!l || !w || !h) throw new Error('prism');
    const face = radd(rmul(l, w), radd(rmul(l, h), rmul(w, h)));
    return { value: rmul(rat(2, 1), face) };
  }
  if (figure.find === 'height') {
    if (!l || !w || !volume) throw new Error('prism');
    return { value: rdiv(volume, rmul(l, w)) };
  }
  if (figure.find === 'length') {
    if (!w || !h || !volume) throw new Error('prism');
    return { value: rdiv(volume, rmul(w, h)) };
  }
  if (figure.find === 'width') {
    if (!l || !h || !volume) throw new Error('prism');
    return { value: rdiv(volume, rmul(l, h)) };
  }
  throw new Error('prism');
}

function expectScale(figure) {
  const drawing = figure.drawing ? takeRat(figure.drawing) : null;
  const actual = figure.actual ? takeRat(figure.actual) : null;
  const factor = figure.factor ? takeRat(figure.factor) : null;
  if (figure.find === 'actual') {
    if (!drawing || !factor) throw new Error('scale');
    return { value: rmul(drawing, factor) };
  }
  if (figure.find === 'drawing') {
    if (!actual || !factor) throw new Error('scale');
    return { value: rdiv(actual, factor) };
  }
  if (figure.find === 'factor') {
    if (!drawing || !actual) throw new Error('scale');
    return { value: rdiv(actual, drawing) };
  }
  if (figure.find === 'areaFactor') {
    if (!factor) throw new Error('scale');
    return { value: rmul(factor, factor) };
  }
  throw new Error('scale');
}

function intSqrt(n) {
  if (n < 0) return null;
  const r = Math.round(Math.sqrt(n));
  return r * r === n ? r : null;
}

function splitPair(raw) {
  let s = String(raw || '').trim().replace(/^\$+|\$+$/g, '').trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  if (!s.includes(',')) return null;
  const parts = s.split(',');
  if (parts.length !== 2) return null;
  return [parts[0].trim(), parts[1].trim()];
}

function checkFigure(question) {
  const figure = question && question.figure;
  if (!figure) return { ok: false, reason: 'no_figure' };
  let expected;
  try {
    expected = expectedOf(figure);
  } catch (e) {
    return { ok: false, reason: 'figure' };
  }
  if (expected.pair) {
    const parts = splitPair(question.answer);
    const computed = format(expected.x) + ', ' + format(expected.y);
    if (!parts) return { ok: false, reason: 'figure_mismatch', computed: computed };
    try {
      const x = parseLoose(parts[0]);
      const y = parseLoose(parts[1]);
      if (!req(x, expected.x) || !req(y, expected.y)) return { ok: false, reason: 'figure_mismatch', computed: computed };
      return { ok: true, computed: computed, figure: figure };
    } catch (e2) {
      return { ok: false, reason: 'figure_mismatch', computed: computed };
    }
  }
  const computed = format(expected.value);
  try {
    const ans = parseLoose(question.answer);
    if (!req(ans, expected.value)) return { ok: false, reason: 'figure_mismatch', computed: computed };
    return { ok: true, computed: computed, figure: figure };
  } catch (e3) {
    return { ok: false, reason: 'figure_mismatch', computed: computed };
  }
}

function figureGuide(chapter) {
  if (!isGeometryChapter(chapter)) return '';
  const head = [
    'Every example and every question includes a figure object.',
    'The figure lists only the given numbers. Mark the unknown as the missing field, never as the answer.',
    'expression must compute the same value the figure determines. The answer is that value, with no units.'
  ].join(' ');
  const id = chapter.id;
  if (id === 'gm-c01') {
    return head + ' Use one of {"kind":"point","name":"A","x":2,"y":-3} with answer "2, -3"; {"kind":"translate","name":"A","x":1,"y":2,"dx":3,"dy":-1} with the image as the answer; {"kind":"distance","names":["A","B"],"x1":2,"y1":1,"x2":2,"y2":6} where the points share x or y. Coordinates are integers from -8 to 8.';
  }
  if (id === 'gm-c02') {
    return head + ' Use {"kind":"angles","relation":"complement|supplement|vertical|around","known":[35]}. complement totals 90, supplement 180, vertical copies the given angle, around totals 360. around may list up to 3 known angles. Known angles are positive integers.';
  }
  if (id === 'gm-c03') {
    return head + ' Use {"kind":"triangle","find":"angle","angles":[50,60]} or {"kind":"triangle","find":"perimeter","sides":[5,6,7]} or {"kind":"triangle","find":"hypotenuse","legs":[6,8]}. The hypotenuse must be a whole number.';
  }
  if (id === 'gm-c04') {
    return head + ' Use {"kind":"polygon","find":"angle","sides":4,"angles":[90,80,110]} or {"kind":"polygon","find":"perimeter","side":5,"count":6} or {"kind":"polygon","find":"perimeter","sides":[8,3,8,3]}.';
  }
  if (id === 'gm-c05') {
    return head + ' Use {"kind":"area","shape":"rectangle|triangle|parallelogram","find":"area","base":8,"height":3}. To find a missing length, give area and the other length, for example {"kind":"area","shape":"triangle","find":"height","base":10,"area":20}.';
  }
  if (id === 'gm-c06') {
    return head + ' Use {"kind":"circle","radius":5,"find":"circumference|area|diameter"} or {"kind":"circle","diameter":10,"find":"radius"}. Use 3.14 for pi in expression.';
  }
  if (id === 'gm-c07') {
    return head + ' Use {"kind":"prism","l":4,"w":3,"h":2,"find":"volume|surface"}. surface means surface area. To find a missing edge, give volume and the other two edges.';
  }
  return head + ' Use {"kind":"scale","find":"actual","drawing":2,"factor":4} or {"kind":"scale","find":"factor","drawing":3,"actual":12} or {"kind":"scale","find":"areaFactor","factor":3}. factor is the length scale.';
}

let svgSeq = 0;

function draw(figure) {
  svgSeq += 1;
  if (figure.kind === 'point' || figure.kind === 'translate' || figure.kind === 'distance') return drawPlane(figure);
  if (figure.kind === 'angles') return drawAngles(figure);
  if (figure.kind === 'triangle') return drawTriangle(figure);
  if (figure.kind === 'polygon') return drawPolygon(figure);
  if (figure.kind === 'area') return drawArea(figure);
  if (figure.kind === 'circle') return drawCircle(figure);
  if (figure.kind === 'prism') return drawPrism(figure);
  if (figure.kind === 'scale') return drawScale(figure);
  return '';
}

function wrap(w, h, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" role="img">' +
    '<rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (h - 1) + '" rx="6" fill="#f7f3ea" stroke="#e4dccb"/>' +
    body + '</svg>';
}

function txt(x, y, value, opt) {
  const o = opt || {};
  const fill = o.unknown ? '#0f5f5a' : '#16324f';
  const size = o.size || 14;
  const anchor = o.anchor || 'middle';
  const baseline = o.baseline || 'middle';
  return '<text x="' + round(x) + '" y="' + round(y) + '" text-anchor="' + anchor + '" dominant-baseline="' + baseline + '" font-family="Liberation Sans, Arial, sans-serif" font-size="' + size + '" font-weight="700" fill="' + fill + '">' + escapeXml(value) + '</text>';
}

function ln(x1, y1, x2, y2, opt) {
  const o = opt || {};
  return '<line x1="' + round(x1) + '" y1="' + round(y1) + '" x2="' + round(x2) + '" y2="' + round(y2) + '" stroke="' + (o.stroke || '#16324f') + '" stroke-width="' + (o.width || 2) + '" stroke-linecap="round"' + (o.dash ? ' stroke-dasharray="4 3"' : '') + '/>';
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function renderFigureSvg(figure) {
  if (!figure || !figure.kind) return '';
  try {
    expectedOf(figure);
    const svg = draw(figure);
    if (!svg || /<script|foreignObject|on[a-z]+=/i.test(svg)) return '';
    return svg;
  } catch (e) {
    return '';
  }
}

function drawPlane(figure) {
  const pts = planePoints(figure);
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  pts.forEach((p) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });
  minX -= 1; maxX += 1; minY -= 1; maxY += 1;
  if (maxX - minX < 6) { minX -= 1; maxX += 1; }
  if (maxY - minY < 6) { minY -= 1; maxY += 1; }
  minX = Math.max(-8, minX);
  maxX = Math.min(8, maxX);
  minY = Math.max(-8, minY);
  maxY = Math.min(8, maxY);
  const W = 280;
  const H = 230;
  const pad = 26;
  const cell = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
  const ox = (W - cell * (maxX - minX)) / 2;
  const oy = (H - cell * (maxY - minY)) / 2;
  const X = (x) => ox + (x - minX) * cell;
  const Y = (y) => oy + (maxY - y) * cell;
  let body = '';
  for (let x = minX; x <= maxX; x++) {
    body += ln(X(x), Y(minY), X(x), Y(maxY), { stroke: x === 0 ? '#16324f' : '#e4dccb', width: x === 0 ? 1.6 : 1 });
  }
  for (let y = minY; y <= maxY; y++) {
    body += ln(X(minX), Y(y), X(maxX), Y(y), { stroke: y === 0 ? '#16324f' : '#e4dccb', width: y === 0 ? 1.6 : 1 });
  }
  for (let x = minX; x <= maxX; x++) {
    if (x === 0) continue;
    body += txt(X(x), Y(0) + 12, String(x), { size: 10 });
  }
  for (let y = minY; y <= maxY; y++) {
    if (y === 0) continue;
    body += txt(X(0) - 12, Y(y), String(y), { size: 10, anchor: 'end' });
  }
  if (figure.kind === 'distance') {
    body += ln(X(figure.x1), Y(figure.y1), X(figure.x2), Y(figure.y2), { stroke: '#b08948', width: 2.4 });
  }
  if (figure.kind === 'translate') {
    body += ln(X(figure.x), Y(figure.y), X(figure.x + figure.dx), Y(figure.y + figure.dy), { stroke: '#b08948', width: 2, dash: true });
  }
  pts.forEach((p) => {
    const cx = X(p.x);
    const cy = Y(p.y);
    if (p.open) {
      body += '<circle cx="' + round(cx) + '" cy="' + round(cy) + '" r="5" fill="#f7f3ea" stroke="#0f5f5a" stroke-width="2"/>';
      body += txt(cx + 12, cy - 12, '?', { unknown: true });
    } else {
      body += '<circle cx="' + round(cx) + '" cy="' + round(cy) + '" r="4.5" fill="#16324f"/>';
      body += txt(cx + 12, cy - 12, p.name, { size: 13 });
    }
  });
  return wrap(W, H, body);
}

function planePoints(figure) {
  if (figure.kind === 'point') return [{ name: figure.name, x: figure.x, y: figure.y }];
  if (figure.kind === 'translate') {
    return [
      { name: figure.name, x: figure.x, y: figure.y },
      { open: true, x: figure.x + figure.dx, y: figure.y + figure.dy }
    ];
  }
  return [
    { name: figure.names[0], x: figure.x1, y: figure.y1 },
    { name: figure.names[1], x: figure.x2, y: figure.y2 }
  ];
}

function polar(cx, cy, r, deg) {
  const rad = deg * Math.PI / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

function arcPath(cx, cy, r, a0, a1) {
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = (a1 - a0) > 180 ? 1 : 0;
  return '<path d="M ' + round(p0[0]) + ' ' + round(p0[1]) + ' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + round(p1[0]) + ' ' + round(p1[1]) + '" fill="none" stroke="#0f5f5a" stroke-width="1.7"/>';
}

function ray(cx, cy, deg, len) {
  const p = polar(cx, cy, len, deg);
  return ln(cx, cy, p[0], p[1]);
}

function drawAngles(figure) {
  const W = 280;
  const H = 170;
  const cx = 78;
  const cy = 118;
  let body = '';
  if (figure.relation === 'complement') {
    const known = figure.known[0];
    body += ray(cx, cy, 0, 170);
    body += ray(cx, cy, 90, 100);
    body += ray(cx, cy, known, 150);
    body += rightMark(cx, cy, 0, 90, 14);
    body += arcPath(cx, cy, 42, 0, known);
    body += arcPath(cx, cy, 58, known, 90);
    const midK = polar(cx, cy, 54, known / 2);
    const midU = polar(cx, cy, 74, (known + 90) / 2);
    body += txt(midK[0], midK[1], known + '°');
    body += txt(midU[0], midU[1], '?', { unknown: true });
  } else if (figure.relation === 'supplement') {
    const known = figure.known[0];
    body += ray(cx, cy, 0, 180);
    body += ray(cx, cy, 180, 70);
    body += ray(cx, cy, known, 130);
    body += arcPath(cx, cy, 40, 0, known);
    body += arcPath(cx, cy, 56, known, 180);
    const midK = polar(cx, cy, 54, known / 2);
    const midU = polar(cx, cy, 72, (known + 180) / 2);
    body += txt(midK[0], midK[1], known + '°');
    body += txt(midU[0], midU[1], '?', { unknown: true });
  } else if (figure.relation === 'vertical') {
    const known = figure.known[0];
    const c = [150, 86];
    body += ray(c[0], c[1], 0, 110);
    body += ray(c[0], c[1], 180, 110);
    body += ray(c[0], c[1], known, 100);
    body += ray(c[0], c[1], known + 180, 100);
    body += arcPath(c[0], c[1], 36, 0, known);
    body += arcPath(c[0], c[1], 36, 180, 180 + known);
    const a = polar(c[0], c[1], 52, known / 2);
    const b = polar(c[0], c[1], 52, 180 + known / 2);
    body += txt(a[0], a[1], known + '°');
    body += txt(b[0], b[1], '?', { unknown: true });
  } else {
    const c = [140, 88];
    const known = figure.known.slice();
    const total = known.reduce((s, n) => s + n, 0);
    const unknown = 360 - total;
    const cuts = [0];
    known.forEach((n) => cuts.push(cuts[cuts.length - 1] + n));
    cuts.push(360);
    cuts.forEach((deg) => { body += ray(c[0], c[1], deg, 78); });
    known.forEach((n, i) => {
      const a0 = cuts[i];
      body += arcPath(c[0], c[1], 34, a0, a0 + n);
      const mid = polar(c[0], c[1], 50, a0 + n / 2);
      body += txt(mid[0], mid[1], n + '°', { size: 12 });
    });
    const u0 = cuts[cuts.length - 2];
    body += arcPath(c[0], c[1], 46, u0, u0 + unknown);
    const um = polar(c[0], c[1], 62, u0 + unknown / 2);
    body += txt(um[0], um[1], '?', { unknown: true });
  }
  return wrap(W, H, body);
}

function rightMark(x, y, a0, a1, size) {
  const p0 = polar(x, y, size, a0);
  const p1 = polar(x, y, size, a1);
  const corner = [p0[0] + (p1[0] - x), p0[1] + (p1[1] - y)];
  return ln(p0[0], p0[1], corner[0], corner[1], { width: 1.4 }) + ln(p1[0], p1[1], corner[0], corner[1], { width: 1.4 });
}

function drawTriangle(figure) {
  if (figure.find === 'hypotenuse') return drawRightTriangle(figure);
  if (figure.find === 'perimeter') return drawTriangleSides(figure);
  const angles = figure.angles.map((n) => takeRat(n).n / takeRat(n).d);
  const third = 180 - angles[0] - angles[1];
  const pts = fitPoints(triangleFromAngles(angles[0], angles[1]), 300, 180, 36);
  let body = polyStroke(pts, '#f4f0e6');
  body += vertexLabel(pts[0], pts[1], pts[2], angles[0] + '°');
  body += vertexLabel(pts[1], pts[0], pts[2], angles[1] + '°');
  body += vertexLabel(pts[2], pts[0], pts[1], '?', true);
  if (third <= 0) return '';
  return wrap(300, 180, body);
}

function triangleFromAngles(A, B) {
  const left = [0, 0];
  const right = [10, 0];
  const radA = A * Math.PI / 180;
  const radB = B * Math.PI / 180;
  const denom = Math.cos(radA) + Math.sin(radA) * Math.cos(radB) / Math.sin(radB);
  const t = 10 / denom;
  const top = [t * Math.cos(radA), t * Math.sin(radA)];
  return [left, right, top];
}

function drawTriangleSides(figure) {
  const sides = figure.sides.map(takeRat);
  const a = sides[0].n / sides[0].d;
  const b = sides[1].n / sides[1].d;
  const c = sides[2].n / sides[2].d;
  const x = (b * b + c * c - a * a) / (2 * c);
  const y2 = Math.max(b * b - x * x, 0);
  const pts = fitPoints([[0, 0], [c, 0], [x, Math.sqrt(y2)]], 300, 180, 32);
  let body = polyStroke(pts, '#f4f0e6');
  body += edgeLabel(pts[0], pts[1], format(sides[2]), false);
  body += edgeLabel(pts[1], pts[2], format(sides[0]), false);
  body += edgeLabel(pts[2], pts[0], format(sides[1]), false);
  return wrap(300, 180, body);
}

function drawRightTriangle(figure) {
  const a = figure.legs[0];
  const b = figure.legs[1];
  const pts = fitPoints([[0, 0], [a, 0], [0, b]], 280, 180, 36);
  let body = polyStroke(pts, '#f4f0e6');
  body += rightMark(pts[0][0], pts[0][1], 0, 90, 12);
  body += edgeLabel(pts[0], pts[1], String(a), false);
  body += edgeLabel(pts[0], pts[2], String(b), false);
  body += edgeLabel(pts[1], pts[2], '?', true);
  return wrap(280, 180, body);
}

function fitPoints(pts, w, h, pad) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  pts.forEach((p) => {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  });
  const bw = Math.max(maxX - minX, 0.001);
  const bh = Math.max(maxY - minY, 0.001);
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = pad + ((w - pad * 2) - bw * s) / 2;
  const oy = pad + ((h - pad * 2) - bh * s) / 2;
  return pts.map((p) => [ox + (p[0] - minX) * s, h - (oy + (p[1] - minY) * s)]);
}

function polyStroke(pts, fill) {
  const d = pts.map((p, i) => (i ? 'L' : 'M') + round(p[0]) + ' ' + round(p[1])).join(' ') + ' Z';
  return '<path d="' + d + '" fill="' + fill + '" stroke="#16324f" stroke-width="2" stroke-linejoin="round"/>';
}

function vertexLabel(p, q, r, value, unknown) {
  const vx = p[0] - (q[0] + r[0]) / 2;
  const vy = p[1] - (q[1] + r[1]) / 2;
  const len = Math.hypot(vx, vy) || 1;
  return txt(p[0] + (vx / len) * 16, p[1] + (vy / len) * 16, value, { unknown: !!unknown, size: 13 });
}

function edgeLabel(a, b, value, unknown) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return txt(mx + (-dy / len) * 14, my + (dx / len) * 14, value, { unknown: !!unknown, size: 13 });
}

function drawPolygon(figure) {
  if (figure.find === 'perimeter' && figure.sides) return drawSidePolygon(figure.sides.map(takeRat));
  if (figure.find === 'perimeter') return drawRegular(figure.count, format(takeRat(figure.side)));
  return drawAnglePolygon(figure);
}

function regularPoints(n, cx, cy, r) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function drawRegular(n, label) {
  const pts = regularPoints(n, 140, 92, 62);
  let body = polyStroke(pts, '#f4f0e6');
  for (let i = 0; i < n; i++) body += edgeLabel(pts[i], pts[(i + 1) % n], label, false);
  return wrap(280, 190, body);
}

function drawSidePolygon(sides) {
  if (sides.length === 4 && req(sides[0], sides[2]) && req(sides[1], sides[3])) {
    return drawLabeledRect(sides[0], sides[1], false, false);
  }
  const pts = regularPoints(sides.length, 140, 96, 64);
  let body = polyStroke(pts, '#f4f0e6');
  sides.forEach((side, i) => {
    body += edgeLabel(pts[i], pts[(i + 1) % pts.length], format(side), false);
  });
  return wrap(280, 200, body);
}

function drawAnglePolygon(figure) {
  const n = figure.sides;
  const pts = regularPoints(n, 140, 96, 68);
  const labels = figure.angles.concat(['?']);
  let body = polyStroke(pts, '#f4f0e6');
  pts.forEach((p, i) => {
    const prev = pts[(i + n - 1) % n];
    const next = pts[(i + 1) % n];
    const unknown = labels[i] === '?';
    body += vertexLabel(p, prev, next, unknown ? '?' : (labels[i] + '°'), unknown);
  });
  return wrap(280, 200, body);
}

function drawLabeledRect(length, width, lengthUnknown, widthUnknown) {
  const L = length.n / length.d;
  const Wd = width.n / width.d;
  const maxW = 210;
  const maxH = 120;
  const s = Math.min(maxW / L, maxH / Wd);
  const w = Math.max(L * s, 70);
  const h = Math.max(Wd * s, 46);
  const x = (280 - w) / 2;
  const y = 28 + (130 - h) / 2;
  let body = '<rect x="' + round(x) + '" y="' + round(y) + '" width="' + round(w) + '" height="' + round(h) + '" fill="#f4f0e6" stroke="#16324f" stroke-width="2"/>';
  body += txt(x + w / 2, y + h + 16, lengthUnknown ? '?' : format(length), { unknown: lengthUnknown });
  body += txt(x - 16, y + h / 2, widthUnknown ? '?' : format(width), { unknown: widthUnknown, anchor: 'end' });
  return wrap(280, 180, body);
}

function drawArea(figure) {
  const base = figure.base ? takeRat(figure.base) : rat(6, 1);
  const height = figure.height ? takeRat(figure.height) : rat(4, 1);
  if (figure.shape === 'rectangle') {
    const lengthUnknown = figure.find === 'base';
    const widthUnknown = figure.find === 'height';
    const svg = drawLabeledRect(base, height, lengthUnknown, widthUnknown);
    if (figure.find === 'area') return svg;
    return captioned(svg, 'Area ' + format(takeRat(figure.area)));
  }
  if (figure.shape === 'parallelogram') return drawPara(figure, base, height);
  return drawAreaTriangle(figure, base, height);
}

function captioned(svg, caption) {
  return svg.replace('</svg>', txt(140, 168, caption, { size: 12 }) + '</svg>');
}

function drawAreaTriangle(figure, base, height) {
  const b = base.n / base.d;
  const h = height.n / height.d;
  const pts = fitPoints([[0, 0], [b, 0], [b * 0.35, h]], 280, 168, 28);
  let body = polyStroke(pts, '#f4f0e6');
  const foot = [pts[0][0] + (pts[1][0] - pts[0][0]) * 0.35, pts[0][1]];
  body += ln(pts[2][0], pts[2][1], foot[0], foot[1], { stroke: '#b08948', width: 1.5, dash: true });
  body += edgeLabel(pts[0], pts[1], figure.find === 'base' ? '?' : format(base), figure.find === 'base');
  body += txt((pts[2][0] + foot[0]) / 2 + 12, (pts[2][1] + foot[1]) / 2, figure.find === 'height' ? '?' : format(height), { unknown: figure.find === 'height', anchor: 'start' });
  if (figure.find !== 'area') body += txt(140, 158, 'Area ' + format(takeRat(figure.area)), { size: 12 });
  return wrap(280, 176, body);
}

function drawPara(figure, base, height) {
  const b = base.n / base.d;
  const h = height.n / height.d;
  const slant = Math.min(b * 0.28, h * 0.7);
  const pts = fitPoints([[0, 0], [b, 0], [b + slant, h], [slant, h]], 280, 160, 32);
  let body = polyStroke(pts, '#f4f0e6');
  const foot = [pts[3][0], pts[0][1]];
  body += ln(pts[3][0], pts[3][1], foot[0], foot[1], { stroke: '#b08948', width: 1.5, dash: true });
  body += edgeLabel(pts[0], pts[1], figure.find === 'base' ? '?' : format(base), figure.find === 'base');
  body += txt(pts[3][0] + 12, (pts[3][1] + foot[1]) / 2, figure.find === 'height' ? '?' : format(height), { unknown: figure.find === 'height', anchor: 'start' });
  if (figure.find !== 'area') body += txt(140, 150, 'Area ' + format(takeRat(figure.area)), { size: 12 });
  return wrap(280, 176, body);
}

function drawCircle(figure) {
  const cx = 120;
  const cy = 86;
  const r = 54;
  let body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#f4f0e6" stroke="#16324f" stroke-width="2"/>';
  body += '<circle cx="' + cx + '" cy="' + cy + '" r="2.5" fill="#16324f"/>';
  if (figure.radius) {
    body += ln(cx, cy, cx + r, cy, { stroke: '#b08948', width: 1.8 });
    body += txt(cx + r / 2, cy - 14, 'r = ' + figure.radius);
  } else if (figure.diameter) {
    body += ln(cx - r, cy, cx + r, cy, { stroke: '#b08948', width: 1.8 });
    body += txt(cx, cy - 14, 'd = ' + figure.diameter);
  }
  return wrap(240, 170, body);
}

function drawPrism(figure) {
  const front = [[46, 78], [150, 78], [150, 150], [46, 150]];
  const back = [[86, 42], [190, 42], [190, 114], [86, 114]];
  let body = polyStroke([front[0], front[1], back[1], back[0]], '#f7f1e4');
  body += polyStroke([front[1], front[2], back[2], back[1]], '#efe6d4');
  body += polyStroke(front, '#f4f0e6');
  const lUnknown = figure.find === 'length';
  const wUnknown = figure.find === 'width';
  const hUnknown = figure.find === 'height';
  body += txt(98, 168, lUnknown ? '?' : ('l = ' + (figure.l || '')), { unknown: lUnknown, size: 13 });
  body += txt(196, 78, wUnknown ? '?' : ('w = ' + (figure.w || '')), { unknown: wUnknown, size: 13, anchor: 'start' });
  body += txt(32, 114, hUnknown ? '?' : ('h = ' + (figure.h || '')), { unknown: hUnknown, size: 13, anchor: 'end' });
  if (figure.find === 'volume' || figure.find === 'surface') {
    /* edges are the givens */
  } else if (figure.volume) {
    body += txt(118, 24, 'V = ' + figure.volume, { size: 13 });
  }
  return wrap(250, 186, body);
}

function scaleRatio(figure) {
  try {
    if (figure.find === 'factor') {
      const actual = takeRat(figure.actual);
      const drawing = takeRat(figure.drawing);
      return (actual.n / actual.d) / (drawing.n / drawing.d);
    }
    if (figure.factor) {
      const factor = takeRat(figure.factor);
      return factor.n / factor.d;
    }
  } catch (e) { /* fixed fallback */ }
  return 2.2;
}

function drawScale(figure) {
  const ratio = Math.max(1.4, Math.min(scaleRatio(figure), 4));
  const sw = 40;
  const sh = 26;
  const lw = sw * ratio;
  const lh = sh * ratio;
  const x1 = 22;
  const base = 146;
  const y1 = base - sh;
  const x2 = x1 + sw + 26;
  const y2 = base - lh;
  let body = '';
  body += '<rect x="' + round(x1) + '" y="' + round(y1) + '" width="' + round(sw) + '" height="' + round(sh) + '" fill="#f4f0e6" stroke="#16324f" stroke-width="2"/>';
  body += '<rect x="' + round(x2) + '" y="' + round(y2) + '" width="' + round(lw) + '" height="' + round(lh) + '" fill="#f7f1e4" stroke="#16324f" stroke-width="2"/>';
  const mid1 = x1 + sw / 2;
  const mid2 = x2 + lw / 2;
  const under1 = y1 + sh + 16;
  const under2 = y2 + lh + 16;
  const width = Math.max(280, x2 + lw + 24);
  if (figure.find === 'factor') {
    body += txt(mid1, under1, figure.drawing, { size: 13 });
    body += txt(mid2, under2, figure.actual, { size: 13 });
  } else if (figure.find === 'actual') {
    body += txt(mid1, under1, figure.drawing, { size: 13 });
    body += txt(mid2, under2, '?', { unknown: true, size: 16 });
    body += txt(width / 2, 22, '1 : ' + figure.factor, { size: 14 });
  } else if (figure.find === 'drawing') {
    body += txt(mid1, under1, '?', { unknown: true, size: 16 });
    body += txt(mid2, under2, figure.actual, { size: 13 });
    body += txt(width / 2, 22, '1 : ' + figure.factor, { size: 14 });
  } else {
    body += txt(mid1, under1, '1', { size: 13 });
    body += txt(mid2, under2, figure.factor, { size: 13 });
    body += txt(width / 2, 22, 'length scale', { size: 12 });
  }
  return wrap(Math.round(width), 180, body);
}

module.exports = {
  isGeometryChapter,
  normalizeFigure,
  checkFigure,
  renderFigureSvg,
  figureGuide,
  expectedOf
};
