'use strict';

/**
 * Deterministic checks for workbook questions.
 * Arithmetic, simplified linear expressions in x, and one-variable linear
 * equations are verified exactly with rationals. Anything else is needs_review.
 * A computed answer that disagrees is failed.
 */

const LIMIT = 1e12;

function isInt(n) {
  return typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= LIMIT;
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}

function rat(n, d) {
  if (d == null) d = 1;
  if (!isInt(n) || !isInt(d) || d === 0) throw new Error('range');
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function radd(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
function rsub(a, b) { return rat(a.n * b.d - b.n * a.d, a.d * b.d); }
function rmul(a, b) { return rat(a.n * b.n, a.d * b.d); }
function rdiv(a, b) {
  if (b.n === 0) throw new Error('div0');
  return rat(a.n * b.d, a.d * b.n);
}
function req(a, b) { return a.n === b.n && a.d === b.d; }
function rneg(a) { return rat(-a.n, a.d); }

function rpow(base, exp) {
  if (!isInt(exp.n) || exp.d !== 1 || Math.abs(exp.n) > 8) throw new Error('pow');
  let e = exp.n;
  if (e === 0) {
    if (base.n === 0) throw new Error('pow');
    return rat(1, 1);
  }
  const neg = e < 0;
  e = Math.abs(e);
  let out = rat(1, 1);
  let b = base;
  while (e > 0) {
    if (e % 2) out = rmul(out, b);
    e = Math.floor(e / 2);
    if (e) b = rmul(b, b);
  }
  if (neg) {
    if (out.n === 0) throw new Error('div0');
    return rat(out.d, out.n);
  }
  return out;
}

function formatRat(a) {
  if (a.d === 1) return String(a.n);
  return a.n + '/' + a.d;
}

function decimalToRat(text) {
  const s = String(text);
  if (!/^\d+\.\d+$/.test(s)) throw new Error('decimal');
  const parts = s.split('.');
  const digits = parts[1];
  if (digits.length > 6) throw new Error('decimal');
  const scale = 10 ** digits.length;
  return rat(Number(parts[0]) * scale + Number(digits), scale);
}

function parseAnswer(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^\$+|\$+$/g, '').trim();
  s = s.replace(/\s+/g, ' ');
  if (s.includes('=')) s = s.split('=').pop().trim();
  let percent = false;
  if (/%$/.test(s)) {
    percent = true;
    s = s.replace(/%$/, '').trim();
  }
  const mixed = s.match(/^(-?)\s*(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  let value;
  if (mixed) {
    const sign = mixed[1] === '-' ? -1 : 1;
    const whole = Number(mixed[2]);
    const num = Number(mixed[3]);
    const den = Number(mixed[4]);
    value = rat(sign * (whole * den + num), den);
  } else {
    const frac = s.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
    if (frac) value = rat(Number(frac[1]), Number(frac[2]));
    else if (/^-?\d+$/.test(s)) value = rat(Number(s), 1);
    else if (/^-?\d+\.\d+$/.test(s)) {
      const neg = s.startsWith('-');
      value = decimalToRat(neg ? s.slice(1) : s);
      if (neg) value = rneg(value);
    } else throw new Error('answer');
  }
  if (percent) value = rdiv(value, rat(100, 1));
  return value;
}

function tokenize(input) {
  const src = String(input || '').replace(/\s+/g, '').replace(/\*\*/g, '^');
  if (!src) throw new Error('empty');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const lex = src.slice(i, j);
      if ((lex.match(/\./g) || []).length > 1) throw new Error('num');
      tokens.push({ t: 'num', v: lex });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      if (c.toLowerCase() !== 'x') throw new Error('var');
      tokens.push({ t: 'var', v: 'x' });
      i++;
    } else if ('+-*/^()='.includes(c)) {
      tokens.push({ t: c });
      i++;
    } else throw new Error('char');
  }
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k];
    const prev = out[out.length - 1];
    if (prev && (
      (prev.t === 'num' || prev.t === 'var' || prev.t === ')') &&
      (cur.t === 'var' || cur.t === 'num' || cur.t === '(')
    )) out.push({ t: '*' });
    out.push(cur);
  }
  return out;
}

function parseTokens(tokens) {
  let i = 0;
  function peek() { return tokens[i]; }
  function take() { return tokens[i++]; }
  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = take().t;
      const right = parseTerm();
      node = { op: op, left: node, right: right };
    }
    return node;
  }
  function parseTerm() {
    let node = parsePower();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = take().t;
      const right = parsePower();
      node = { op: op, left: node, right: right };
    }
    return node;
  }
  function parsePower() {
    const base = parseUnary();
    if (peek() && peek().t === '^') {
      take();
      return { op: '^', left: base, right: parsePower() };
    }
    return base;
  }
  function parseUnary() {
    if (peek() && peek().t === '-') {
      take();
      return { op: 'neg', left: parseUnary() };
    }
    if (peek() && peek().t === '+') {
      take();
      return parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const tok = take();
    if (!tok) throw new Error('end');
    if (tok.t === 'num') {
      const v = tok.v.includes('.') ? decimalToRat(tok.v) : rat(Number(tok.v), 1);
      return { op: 'num', value: v };
    }
    if (tok.t === 'var') return { op: 'var' };
    if (tok.t === '(') {
      const inner = parseExpr();
      const close = take();
      if (!close || close.t !== ')') throw new Error('paren');
      return inner;
    }
    throw new Error('primary');
  }
  const node = parseExpr();
  if (i !== tokens.length) throw new Error('trail');
  return node;
}

function evalNode(node, x) {
  if (node.op === 'num') return node.value;
  if (node.op === 'var') {
    if (!x) throw new Error('var');
    return x;
  }
  if (node.op === 'neg') return rneg(evalNode(node.left, x));
  const l = evalNode(node.left, x);
  const r = evalNode(node.right, x);
  if (node.op === '+') return radd(l, r);
  if (node.op === '-') return rsub(l, r);
  if (node.op === '*') return rmul(l, r);
  if (node.op === '/') return rdiv(l, r);
  if (node.op === '^') return rpow(l, r);
  throw new Error('op');
}

function parseExpr(src) {
  return parseTokens(tokenize(src));
}

function usesVar(node) {
  if (!node) return false;
  if (node.op === 'var') return true;
  return usesVar(node.left) || usesVar(node.right);
}

function nonlinear() {
  const err = new Error('nonlinear');
  err.code = 'needs_review';
  throw err;
}

function asPoly(node) {
  if (!node) throw new Error('poly');
  if (node.op === 'num') return { a: rat(0, 1), b: node.value };
  if (node.op === 'var') return { a: rat(1, 1), b: rat(0, 1) };
  if (node.op === 'neg') {
    const p = asPoly(node.left);
    return { a: rneg(p.a), b: rneg(p.b) };
  }
  if (node.op === '+' || node.op === '-') {
    const l = asPoly(node.left);
    const r = asPoly(node.right);
    return node.op === '+'
      ? { a: radd(l.a, r.a), b: radd(l.b, r.b) }
      : { a: rsub(l.a, r.a), b: rsub(l.b, r.b) };
  }
  if (node.op === '*') {
    const l = asPoly(node.left);
    const r = asPoly(node.right);
    if (l.a.n !== 0 && r.a.n !== 0) nonlinear();
    return {
      a: radd(rmul(l.a, r.b), rmul(l.b, r.a)),
      b: rmul(l.b, r.b)
    };
  }
  if (node.op === '/') {
    const l = asPoly(node.left);
    const r = asPoly(node.right);
    if (r.a.n !== 0 || r.b.n === 0) nonlinear();
    return { a: rdiv(l.a, r.b), b: rdiv(l.b, r.b) };
  }
  if (node.op === '^') {
    if (node.right.op === 'num' && node.right.value.n === 1 && node.right.value.d === 1) return asPoly(node.left);
    if (node.right.op === 'num' && node.right.value.n === 0 && node.right.value.d === 1) return { a: rat(0, 1), b: rat(1, 1) };
    const base = asPoly(node.left);
    if (base.a.n === 0 && node.right.op === 'num') return { a: rat(0, 1), b: rpow(base.b, node.right.value) };
    nonlinear();
  }
  throw new Error('poly');
}

function polyEq(p, q) {
  return req(p.a, q.a) && req(p.b, q.b);
}

function formatPoly(p) {
  if (p.a.n === 0) return formatRat(p.b);
  let coeff = '';
  if (!(p.a.n === 1 && p.a.d === 1)) {
    coeff = (p.a.n === -1 && p.a.d === 1) ? '-' : formatRat(p.a);
  }
  let s = coeff + 'x';
  if (p.b.n === 0) return s;
  if (p.b.n > 0) return s + '+' + formatRat(p.b);
  return s + formatRat(p.b);
}

function stripMath(raw) {
  return String(raw || '').trim().replace(/^\$+|\$+$/g, '').trim();
}

function solveLinear(equation) {
  const parts = String(equation || '').split('=');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    const err = new Error('eq');
    err.code = 'needs_review';
    throw err;
  }
  const left = parseExpr(parts[0]);
  const right = parseExpr(parts[1]);
  const f = (x) => rsub(evalNode(left, x), evalNode(right, x));
  const b = f(rat(0, 1));
  const a = rsub(f(rat(1, 1)), b);
  const at2 = f(rat(2, 1));
  const expect = radd(rmul(a, rat(2, 1)), b);
  if (!req(at2, expect)) {
    const err = new Error('nonlinear');
    err.code = 'needs_review';
    throw err;
  }
  if (a.n === 0 && b.n === 0) {
    const err = new Error('identity');
    err.code = 'needs_review';
    throw err;
  }
  if (a.n === 0) {
    const err = new Error('inconsistent');
    err.code = 'failed';
    throw err;
  }
  return rdiv(rneg(b), a);
}

function review(reason) {
  return { status: 'needs_review', reason: reason };
}

function verifyQuestion(question) {
  const q = question || {};
  const raw = String(q.expression || q.equation || '').trim();
  if (!raw) return review('no_expression');
  const answerText = stripMath(q.answer);
  try {
    if (!raw.includes('=') && (usesVar(parseExpr(raw)) || /[a-zA-Z]/.test(answerText))) {
      const got = asPoly(parseExpr(raw));
      const want = asPoly(parseExpr(answerText));
      const computed = formatPoly(got);
      if (polyEq(got, want)) return { status: 'verified', computed: computed };
      return { status: 'failed', reason: 'answer_mismatch', computed: computed };
    }
  } catch (e) {
    if (e && e.code === 'failed') return { status: 'failed', reason: e.message };
    if (e && e.code === 'needs_review') return review(e.message);
    if (/[a-zA-Z]/.test(answerText) || /[a-zA-Z]/.test(raw)) return review((e && e.message) || 'unparsed');
  }
  let answer;
  try {
    answer = parseAnswer(q.answer);
  } catch (e) {
    return review('answer_unparsed');
  }
  try {
    const computed = raw.includes('=') ? solveLinear(raw) : evalNode(parseExpr(raw), null);
    if (req(computed, answer)) return { status: 'verified', computed: formatRat(computed) };
    return { status: 'failed', reason: 'answer_mismatch', computed: formatRat(computed) };
  } catch (e) {
    if (e && e.code === 'failed') return { status: 'failed', reason: e.message };
    return review((e && e.message) || 'unparsed');
  }
}

module.exports = {
  verifyQuestion,
  parseAnswer,
  formatRat,
  evalNode,
  parseExpr,
  solveLinear,
  usesVar
};
