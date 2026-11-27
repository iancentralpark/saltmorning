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
      if (src.slice(i, i + 4).toLowerCase() === 'sqrt') {
        tokens.push({ t: 'sqrt' });
        i += 4;
        continue;
      }
      const name = c.toLowerCase();
      if (name !== 'x' && name !== 'y') throw new Error('var');
      tokens.push({ t: 'var', v: name });
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
      (cur.t === 'var' || cur.t === 'num' || cur.t === '(' || cur.t === 'sqrt')
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
    if (tok.t === 'var') return { op: 'var', name: tok.v || 'x' };
    if (tok.t === 'sqrt') {
      const open = take();
      if (!open || open.t !== '(') throw new Error('paren');
      const inner = parseExpr();
      const close = take();
      if (!close || close.t !== ')') throw new Error('paren');
      return { op: 'sqrt', left: inner };
    }
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

function valueOfVar(node, env) {
  const name = node.name || 'x';
  if (!env) throw new Error('var');
  const scalar = Object.prototype.hasOwnProperty.call(env, 'n') &&
    Object.prototype.hasOwnProperty.call(env, 'd') &&
    !Object.prototype.hasOwnProperty.call(env, 'x');
  if (scalar) {
    if (name !== 'x') throw new Error('var');
    return env;
  }
  if (!env[name]) throw new Error('var');
  return env[name];
}

function evalNode(node, x) {
  if (node.op === 'num') return node.value;
  if (node.op === 'var') return valueOfVar(node, x);
  if (node.op === 'neg') return rneg(evalNode(node.left, x));
  if (node.op === 'sqrt') return rsqrt(evalNode(node.left, x));
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
  if (node.op === 'var') {
    if (node.name && node.name !== 'x') {
      const err = new Error('var');
      err.code = 'needs_review';
      throw err;
    }
    return { a: rat(1, 1), b: rat(0, 1) };
  }
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
  if (node.op === 'sqrt') {
    const inner = asPoly(node.left);
    if (inner.a.n !== 0) nonlinear();
    return { a: rat(0, 1), b: rsqrt(inner.b) };
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

function intSqrt(n) {
  if (!isInt(n) || n < 0) return null;
  let lo = 0;
  let hi = n < 2 ? n : Math.min(n, 1000000);
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const sq = mid * mid;
    if (sq === n) return mid;
    if (sq < n) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

function rsqrt(a) {
  if (a.n < 0) {
    const err = new Error('sqrt');
    err.code = 'needs_review';
    throw err;
  }
  const ns = intSqrt(a.n);
  const ds = intSqrt(a.d);
  if (ns == null || ds == null) {
    const err = new Error('sqrt');
    err.code = 'needs_review';
    throw err;
  }
  return rat(ns, ds);
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

function verified(computed) {
  return { status: 'verified', computed: computed };
}

function mismatched(computed) {
  return { status: 'failed', reason: 'answer_mismatch', computed: computed || '' };
}

function quadOf(a, b, c) {
  return { a: a, b: b, c: c };
}

function asQuad(node) {
  if (!node) throw new Error('poly');
  if (node.op === 'num') return quadOf(rat(0, 1), rat(0, 1), node.value);
  if (node.op === 'var') {
    if (node.name && node.name !== 'x') {
      const err = new Error('var');
      err.code = 'needs_review';
      throw err;
    }
    return quadOf(rat(0, 1), rat(1, 1), rat(0, 1));
  }
  if (node.op === 'neg') {
    const p = asQuad(node.left);
    return quadOf(rneg(p.a), rneg(p.b), rneg(p.c));
  }
  if (node.op === '+' || node.op === '-') {
    const l = asQuad(node.left);
    const r = asQuad(node.right);
    return node.op === '+'
      ? quadOf(radd(l.a, r.a), radd(l.b, r.b), radd(l.c, r.c))
      : quadOf(rsub(l.a, r.a), rsub(l.b, r.b), rsub(l.c, r.c));
  }
  if (node.op === '*') {
    const l = asQuad(node.left);
    const r = asQuad(node.right);
    const deg3 = radd(rmul(l.a, r.b), rmul(l.b, r.a));
    if ((l.a.n !== 0 && r.a.n !== 0) || deg3.n !== 0) nonlinear();
    return quadOf(
      radd(radd(rmul(l.a, r.c), rmul(l.b, r.b)), rmul(l.c, r.a)),
      radd(rmul(l.b, r.c), rmul(l.c, r.b)),
      rmul(l.c, r.c)
    );
  }
  if (node.op === '/') {
    const l = asQuad(node.left);
    const r = asQuad(node.right);
    if (r.a.n !== 0 || r.b.n !== 0 || r.c.n === 0) nonlinear();
    return quadOf(rdiv(l.a, r.c), rdiv(l.b, r.c), rdiv(l.c, r.c));
  }
  if (node.op === '^') {
    if (node.right.op === 'num' && node.right.value.n === 0 && node.right.value.d === 1) {
      return quadOf(rat(0, 1), rat(0, 1), rat(1, 1));
    }
    if (node.right.op === 'num' && node.right.value.n === 1 && node.right.value.d === 1) return asQuad(node.left);
    if (node.right.op === 'num' && node.right.value.n === 2 && node.right.value.d === 1) {
      const base = asQuad(node.left);
      if (base.a.n !== 0) nonlinear();
      return quadOf(rmul(base.b, base.b), rmul(rat(2, 1), rmul(base.b, base.c)), rmul(base.c, base.c));
    }
    const base = asQuad(node.left);
    if (base.a.n === 0 && base.b.n === 0 && node.right.op === 'num') {
      return quadOf(rat(0, 1), rat(0, 1), rpow(base.c, node.right.value));
    }
    nonlinear();
  }
  if (node.op === 'sqrt') {
    const inner = asQuad(node.left);
    if (inner.a.n !== 0 || inner.b.n !== 0) nonlinear();
    return quadOf(rat(0, 1), rat(0, 1), rsqrt(inner.c));
  }
  throw new Error('poly');
}

function quadEq(p, q) {
  return req(p.a, q.a) && req(p.b, q.b) && req(p.c, q.c);
}

function formatQuad(q) {
  const parts = [];
  function push(coeff, body) {
    if (coeff.n === 0) return;
    const sign = coeff.n < 0 ? '-' : (parts.length ? '+' : '');
    const abs = coeff.n < 0 ? rneg(coeff) : coeff;
    const mag = (abs.n === 1 && abs.d === 1 && body) ? '' : formatRat(abs);
    parts.push(sign + mag + body);
  }
  push(q.a, 'x^2');
  push(q.b, 'x');
  push(q.c, '');
  return parts.length ? parts.join('') : '0';
}

function ratCmp(a, b) {
  const d = rsub(a, b);
  if (d.n === 0) return 0;
  return d.n > 0 ? 1 : -1;
}

function solveQuadratic(equation) {
  const parts = String(equation || '').split('=');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    const err = new Error('eq');
    err.code = 'needs_review';
    throw err;
  }
  const left = asQuad(parseExpr(parts[0]));
  const right = asQuad(parseExpr(parts[1]));
  const a = rsub(left.a, right.a);
  const b = rsub(left.b, right.b);
  const c = rsub(left.c, right.c);
  if (a.n === 0) {
    const err = new Error('linear');
    err.code = 'needs_review';
    throw err;
  }
  const disc = rsub(rmul(b, b), rmul(rat(4, 1), rmul(a, c)));
  const root = rsqrt(disc);
  const twoA = rmul(rat(2, 1), a);
  return [rdiv(radd(rneg(b), root), twoA), rdiv(rsub(rneg(b), root), twoA)];
}

function formatRoots(roots) {
  const s = roots.slice().sort(ratCmp);
  if (req(s[0], s[1])) return formatRat(s[0]);
  return formatRat(s[0]) + ', ' + formatRat(s[1]);
}

function matchRoots(roots, answerText) {
  const computed = formatRoots(roots);
  const parts = splitPair(answerText);
  if (parts) {
    const a = parseAnswer(parts[0]);
    const b = parseAnswer(parts[1]);
    const ok = (req(a, roots[0]) && req(b, roots[1])) || (req(a, roots[1]) && req(b, roots[0]));
    return ok ? verified(computed) : mismatched(computed);
  }
  const single = parseAnswer(answerText);
  if (req(roots[0], roots[1]) && req(single, roots[0])) return verified(computed);
  return mismatched(computed);
}

function coeffOf(eq) {
  const parts = String(eq || '').split('=');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    const err = new Error('eq');
    err.code = 'needs_review';
    throw err;
  }
  const left = parseExpr(parts[0]);
  const right = parseExpr(parts[1]);
  const f = (xv, yv) => rsub(evalNode(left, { x: xv, y: yv }), evalNode(right, { x: xv, y: yv }));
  const c0 = f(rat(0, 1), rat(0, 1));
  const A = rsub(f(rat(1, 1), rat(0, 1)), c0);
  const B = rsub(f(rat(0, 1), rat(1, 1)), c0);
  const at = f(rat(1, 1), rat(1, 1));
  if (!req(at, radd(radd(A, B), c0))) nonlinear();
  return { A: A, B: B, C: c0 };
}

function solveSystem(raw) {
  const bits = String(raw || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (bits.length !== 2) {
    const err = new Error('system');
    err.code = 'needs_review';
    throw err;
  }
  const e1 = coeffOf(bits[0]);
  const e2 = coeffOf(bits[1]);
  const det = rsub(rmul(e1.A, e2.B), rmul(e1.B, e2.A));
  if (det.n === 0) {
    const err = new Error('system');
    err.code = 'needs_review';
    throw err;
  }
  const x = rdiv(rsub(rmul(rneg(e1.C), e2.B), rmul(e1.B, rneg(e2.C))), det);
  const y = rdiv(rsub(rmul(e1.A, rneg(e2.C)), rmul(rneg(e1.C), e2.A)), det);
  return { x: x, y: y };
}

function splitSquare(n) {
  let coeff = 1;
  let rad = 1;
  let x = n;
  if (x === 0) return { coeff: 0, rad: 1 };
  let p = 2;
  while (p * p <= x) {
    let count = 0;
    while (x % p === 0) {
      x = Math.floor(x / p);
      count += 1;
    }
    if (count) {
      coeff *= p ** Math.floor(count / 2);
      if (count % 2) rad *= p;
    }
    p += p === 2 ? 1 : 2;
  }
  if (x > 1) rad *= x;
  return { coeff: coeff, rad: rad };
}

function mulRad(a, b) {
  const split = splitSquare(a.r * b.r);
  return { k: rmul(rmul(a.k, b.k), rat(split.coeff, 1)), r: split.rad };
}

function divRad(a, b) {
  if (b.k.n === 0) {
    const err = new Error('div0');
    err.code = 'failed';
    throw err;
  }
  const split = splitSquare(a.r * b.r);
  const k = rmul(rdiv(a.k, b.k), rdiv(rat(split.coeff, 1), rat(b.r, 1)));
  return { k: k, r: split.rad };
}

function asRadical(node) {
  if (!node) throw new Error('radical');
  if (node.op === 'num') return { k: node.value, r: 1 };
  if (node.op === 'neg') {
    const v = asRadical(node.left);
    return { k: rneg(v.k), r: v.r };
  }
  if (node.op === 'sqrt') {
    const inner = asRadical(node.left);
    if (inner.r !== 1 || inner.k.n < 0 || inner.k.d > 1000 || Math.abs(inner.k.n) > 20000) {
      const err = new Error('radical');
      err.code = 'needs_review';
      throw err;
    }
    if (inner.k.d !== 1) {
      const top = asRadical({ op: 'sqrt', left: { op: 'num', value: rat(inner.k.n * inner.k.d, 1) } });
      return { k: rdiv(top.k, rat(inner.k.d, 1)), r: top.r };
    }
    const split = splitSquare(inner.k.n);
    return { k: rat(split.coeff, 1), r: split.rad };
  }
  if (node.op === '*') return mulRad(asRadical(node.left), asRadical(node.right));
  if (node.op === '/') return divRad(asRadical(node.left), asRadical(node.right));
  if (node.op === '+') {
    const l = asRadical(node.left);
    const r = asRadical(node.right);
    if (l.r !== r.r) {
      const err = new Error('radical');
      err.code = 'needs_review';
      throw err;
    }
    return { k: radd(l.k, r.k), r: l.r };
  }
  if (node.op === '-') {
    const l = asRadical(node.left);
    const r = asRadical(node.right);
    if (l.r !== r.r) {
      const err = new Error('radical');
      err.code = 'needs_review';
      throw err;
    }
    return { k: rsub(l.k, r.k), r: l.r };
  }
  if (node.op === '^' && node.right.op === 'num' && node.right.value.d === 1) {
    const exp = node.right.value.n;
    if (exp < 0 || exp > 4) {
      const err = new Error('radical');
      err.code = 'needs_review';
      throw err;
    }
    let out = { k: rat(1, 1), r: 1 };
    const base = asRadical(node.left);
    for (let i = 0; i < exp; i++) out = mulRad(out, base);
    return out;
  }
  const err = new Error('radical');
  err.code = 'needs_review';
  throw err;
}

function formatRadical(v) {
  if (v.r === 1) return formatRat(v.k);
  if (v.k.n === 0) return '0';
  const body = 'sqrt(' + v.r + ')';
  if (v.k.n === 1 && v.k.d === 1) return body;
  if (v.k.n === -1 && v.k.d === 1) return '-' + body;
  return formatRat(v.k) + '*' + body;
}

function sameRadical(a, b) {
  return a.r === b.r && req(a.k, b.k);
}

function tryRadical(raw, answerText) {
  if (!/sqrt/i.test(raw) && !/sqrt/i.test(answerText)) return null;
  try {
    const got = asRadical(parseExpr(raw));
    const want = asRadical(parseExpr(answerText));
    const computed = formatRadical(got);
    return sameRadical(got, want) ? verified(computed) : mismatched(computed);
  } catch (e) {
    return null;
  }
}

function tryQuadraticEquation(raw, answerText) {
  try {
    const roots = solveQuadratic(raw);
    return matchRoots(roots, answerText);
  } catch (e) {
    return null;
  }
}

function verifySymbolic(raw, answerText) {
  const exprNode = parseExpr(raw);
  const ansNode = parseExpr(answerText);
  if (usesVar(exprNode) || usesVar(ansNode)) {
    try {
      const got = asPoly(exprNode);
      const want = asPoly(ansNode);
      const computed = formatPoly(got);
      return polyEq(got, want) ? verified(computed) : mismatched(computed);
    } catch (e) {
      if (e && e.code === 'failed') throw e;
      const got = asQuad(exprNode);
      const want = asQuad(ansNode);
      const computed = formatQuad(got);
      return quadEq(got, want) ? verified(computed) : mismatched(computed);
    }
  }
  return tryRadical(raw, answerText);
}

function splitPair(raw) {
  let s = stripMath(raw).trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  if (!s.includes(',')) return null;
  const parts = s.split(',');
  if (parts.length !== 2) return null;
  const a = parts[0].trim();
  const b = parts[1].trim();
  if (!a || !b) return null;
  return [a, b];
}

function comparePart(expr, answer) {
  const node = parseExpr(expr);
  const ans = stripMath(answer);
  if (usesVar(node) || /[a-zA-Z]/.test(ans)) {
    const got = asPoly(node);
    const want = asPoly(parseExpr(ans));
    return { ok: polyEq(got, want), computed: formatPoly(got) };
  }
  const computed = evalNode(node, null);
  return { ok: req(computed, parseAnswer(ans)), computed: formatRat(computed) };
}

function verifyQuestion(question) {
  const q = question || {};
  const raw = String(q.expression || q.equation || '').trim();
  if (!raw) return review('no_expression');
  const answerText = stripMath(q.answer);
  if (raw.includes(';')) {
    try {
      const sol = solveSystem(raw);
      const parts = splitPair(answerText);
      const computed = formatRat(sol.x) + ', ' + formatRat(sol.y);
      if (!parts) return mismatched(computed);
      const x = parseAnswer(parts[0]);
      const y = parseAnswer(parts[1]);
      if (req(x, sol.x) && req(y, sol.y)) return verified(computed);
      return mismatched(computed);
    } catch (e) {
      if (e && e.code === 'failed') return { status: 'failed', reason: e.message };
      return review((e && e.message) || 'system');
    }
  }
  try {
    if (!raw.includes('=')) {
      const left = splitPair(raw);
      const right = splitPair(answerText);
      if (left || right) {
        if (!left || !right) return mismatched('pair');
        const xPart = comparePart(left[0], right[0]);
        const yPart = comparePart(left[1], right[1]);
        const computed = xPart.computed + ', ' + yPart.computed;
        if (xPart.ok && yPart.ok) return verified(computed);
        return mismatched(computed);
      }
      if (usesVar(parseExpr(raw)) || /[a-zA-Z]/.test(answerText) || /sqrt/i.test(raw)) {
        return verifySymbolic(raw, answerText);
      }
    }
  } catch (e) {
    if (e && e.code === 'failed') return { status: 'failed', reason: e.message };
    const radical = tryRadical(raw, answerText);
    if (radical) return radical;
    if (e && e.code === 'needs_review') return review(e.message);
    if (/[a-zA-Z]/.test(answerText) || /[a-zA-Z]/.test(raw)) return review((e && e.message) || 'unparsed');
  }
  let answer;
  try {
    answer = parseAnswer(q.answer);
  } catch (e) {
    if (raw.includes('=')) {
      const roots = tryQuadraticEquation(raw, answerText);
      if (roots) return roots;
    }
    const radical = tryRadical(raw, answerText);
    if (radical) return radical;
    return review('answer_unparsed');
  }
  try {
    const computed = raw.includes('=') ? solveLinear(raw) : evalNode(parseExpr(raw), null);
    if (req(computed, answer)) return verified(formatRat(computed));
    return mismatched(formatRat(computed));
  } catch (e) {
    if (e && e.code === 'failed') return { status: 'failed', reason: e.message };
    if (raw.includes('=')) {
      const roots = tryQuadraticEquation(raw, answerText);
      if (roots) return roots;
    }
    const radical = tryRadical(raw, answerText);
    if (radical) return radical;
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
