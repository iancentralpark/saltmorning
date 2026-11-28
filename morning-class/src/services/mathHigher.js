'use strict';

/**
 * Exact checks for Precalculus and Calculus items the linear/quadratic
 * checker does not cover. Unrecognized expressions return null so the
 * older checker can take them. A wrong answer is failed.
 */

const DEGREE_CAP = 6;

function isInt(n) {
  return typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= 1e9;
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
  if (!b || b.n === 0) throw new Error('div0');
  return rat(a.n * b.d, a.d * b.n);
}
function req(a, b) { return !!a && !!b && a.n === b.n && a.d === b.d; }
function rneg(a) { return rat(-a.n, a.d); }
function rabs(a) { return a.n < 0 ? rneg(a) : a; }

function rpowInt(base, exp) {
  if (!isInt(exp) || Math.abs(exp) > 8) throw new Error('pow');
  if (exp === 0) {
    if (base.n === 0) throw new Error('pow');
    return rat(1, 1);
  }
  const neg = exp < 0;
  let e = Math.abs(exp);
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
  if (!a) return '';
  if (a.d === 1) return String(a.n);
  return a.n + '/' + a.d;
}

function strip(raw) {
  return String(raw || '').trim().replace(/^\$+|\$+$/g, '').replace(/\s+/g, '');
}

function verified(computed) {
  return { status: 'verified', computed: computed || '' };
}

function mismatched(computed) {
  return { status: 'failed', reason: 'answer_mismatch', computed: computed || '' };
}

function review(reason) {
  return { status: 'needs_review', reason: reason || 'higher' };
}

const WORDS = {
  log: 1, sin: 1, cos: 1, tan: 1, exp: 1, ln: 1, sqrt: 1,
  lim: 1, deriv: 1, derivat: 1, tangent: 1, int: 1, defint: 1,
  crit: 1, maxon: 1, pi: 1, inf: 1, deg: 1, x: 1, y: 1
};

function isFunc(name) {
  return !!WORDS[name] && name !== 'x' && name !== 'y' && name !== 'pi' && name !== 'inf' && name !== 'deg';
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
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      const lex = src.slice(i, j);
      if ((lex.match(/\./g) || []).length > 1) throw new Error('num');
      const whole = lex.split('.')[0];
      const frac = lex.split('.')[1] || '';
      let value;
      if (!frac) value = rat(Number(whole), 1);
      else {
        if (frac.length > 6) throw new Error('decimal');
        const scale = 10 ** frac.length;
        value = rat(Number(whole) * scale + Number(frac), scale);
      }
      tokens.push({ t: 'n', v: value });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j += 1;
      const word = src.slice(i, j).toLowerCase();
      if (!WORDS[word]) throw new Error('name');
      tokens.push({ t: 'id', v: word });
      i = j;
    } else if ('+-*/^(),'.includes(c)) {
      tokens.push({ t: c });
      i += 1;
    } else throw new Error('char');
  }
  const out = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const cur = tokens[k];
    const prev = out[out.length - 1];
    const prevAtom = prev && (prev.t === 'n' || prev.t === 'id' || prev.t === ')');
    const curAtom = cur.t === 'n' || (cur.t === 'id' && cur.v !== 'deg') || cur.t === '(';
    if (prevAtom && curAtom && !(prev.t === 'id' && isFunc(prev.v))) out.push({ t: '*' });
    out.push(cur);
  }
  return out;
}

function parse(src) {
  const tokens = tokenize(src);
  let i = 0;
  function peek() { return tokens[i]; }
  function take() { return tokens[i++]; }
  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = take().t;
      node = { t: 'bin', op: op, a: node, b: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parsePow();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = take().t;
      node = { t: 'bin', op: op, a: node, b: parsePow() };
    }
    return node;
  }
  function parsePow() {
    const base = parseUnary();
    if (peek() && peek().t === '^') {
      take();
      return { t: 'bin', op: '^', a: base, b: parsePow() };
    }
    return base;
  }
  function parseUnary() {
    if (peek() && peek().t === '+') {
      take();
      return parseUnary();
    }
    if (peek() && peek().t === '-') {
      take();
      return { t: 'neg', a: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const tok = take();
    if (!tok) throw new Error('end');
    if (tok.t === 'n') {
      if (peek() && peek().t === 'id' && peek().v === 'deg') {
        take();
        return { t: 'deg', v: tok.v };
      }
      return { t: 'n', v: tok.v };
    }
    if (tok.t === 'id' && (tok.v === 'x' || tok.v === 'y' || tok.v === 'pi' || tok.v === 'inf')) {
      return { t: tok.v === 'inf' ? 'inf' : tok.v };
    }
    if (tok.t === 'id') {
      if (peek() && peek().t === '(') {
        take();
        const args = [];
        if (peek() && peek().t !== ')') {
          args.push(parseArg(tok.v, args.length));
          while (peek() && peek().t === ',') {
            take();
            args.push(parseArg(tok.v, args.length));
          }
        }
        const close = take();
        if (!close || close.t !== ')') throw new Error('paren');
        return { t: 'call', name: tok.v, args: args };
      }
    }
    if (tok.t === '(') {
      const inner = parseExpr();
      const close = take();
      if (!close || close.t !== ')') throw new Error('paren');
      return inner;
    }
    throw new Error('primary');
  }
  function parseArg(name, index) {
    if (name === 'lim' && index === 0) return parseLimitTarget();
    return parseExpr();
  }
  function parseLimitTarget() {
    let sign = 1;
    if (peek() && peek().t === '-') {
      take();
      sign = -1;
    }
    const tok = take();
    if (!tok) throw new Error('lim');
    if (tok.t === 'id' && tok.v === 'inf') {
      return { t: 'target', at: 'inf', sign: sign, side: 'both' };
    }
    if (tok.t !== 'n') throw new Error('lim');
    const at = sign < 0 ? rneg(tok.v) : tok.v;
    let side = 'both';
    if (peek() && (peek().t === '+' || peek().t === '-') && tokens[i + 1] && tokens[i + 1].t === ',') {
      side = peek().t === '+' ? 'plus' : 'minus';
      take();
    }
    return { t: 'target', at: at, sign: 1, side: side };
  }
  const node = parseExpr();
  if (i !== tokens.length) throw new Error('trail');
  return node;
}

function constInt(node) {
  if (!node || node.t !== 'n' || node.v.d !== 1) return null;
  if (Math.abs(node.v.n) > DEGREE_CAP) return null;
  return node.v.n;
}

function polyTrim(c) {
  const a = c.slice();
  while (a.length > 1 && a[a.length - 1].n === 0) a.pop();
  return a;
}

function polyDeg(c) {
  const a = polyTrim(c);
  return a.length - 1;
}

function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(radd(a[i] || rat(0, 1), b[i] || rat(0, 1)));
  return polyTrim(out);
}

function polySub(a, b) { return polyAdd(a, b.map(rneg)); }
function polyNeg(a) { return a.map(rneg); }

function polyScale(a, k) {
  return polyTrim(a.map((c) => rmul(c, k)));
}

function polyMul(a, b) {
  if (!a.length || !b.length) return [rat(0, 1)];
  const out = new Array(a.length + b.length - 1).fill(null).map(() => rat(0, 1));
  if (out.length - 1 > DEGREE_CAP) throw new Error('degree');
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) out[i + j] = radd(out[i + j], rmul(a[i], b[j]));
  }
  return polyTrim(out);
}

function polyEq(a, b) {
  const A = polyTrim(a);
  const B = polyTrim(b);
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i += 1) if (!req(A[i], B[i])) return false;
  return true;
}

function polyIsZero(a) {
  return polyTrim(a).length === 1 && polyTrim(a)[0].n === 0;
}

function formatPoly(coeffs) {
  const c = polyTrim(coeffs);
  if (c.length === 1 && c[0].n === 0) return '0';
  const parts = [];
  for (let p = c.length - 1; p >= 0; p -= 1) {
    if (c[p].n === 0) continue;
    const sign = c[p].n < 0 ? '-' : (parts.length ? '+' : '');
    const abs = rabs(c[p]);
    const body = p === 0 ? '' : (p === 1 ? 'x' : ('x^' + p));
    const mag = (abs.n === 1 && abs.d === 1 && body) ? '' : formatRat(abs);
    parts.push(sign + mag + body);
  }
  return parts.join('');
}

function asPoly(node) {
  if (!node) throw new Error('poly');
  if (node.t === 'n') return [node.v];
  if (node.t === 'x') return [rat(0, 1), rat(1, 1)];
  if (node.t === 'neg') return polyNeg(asPoly(node.a));
  if (node.t === 'bin' && (node.op === '+' || node.op === '-')) {
    const l = asPoly(node.a);
    const r = asPoly(node.b);
    return node.op === '+' ? polyAdd(l, r) : polySub(l, r);
  }
  if (node.t === 'bin' && node.op === '*') return polyMul(asPoly(node.a), asPoly(node.b));
  if (node.t === 'bin' && node.op === '/') {
    const den = asPoly(node.b);
    if (polyDeg(den) > 0) throw new Error('div');
    if (den[0].n === 0) throw new Error('div0');
    return polyScale(asPoly(node.a), rdiv(rat(1, 1), den[0]));
  }
  if (node.t === 'bin' && node.op === '^') {
    const exp = constInt(node.b);
    if (exp == null || exp < 0) throw new Error('pow');
    let out = [rat(1, 1)];
    const base = asPoly(node.a);
    for (let k = 0; k < exp; k += 1) out = polyMul(out, base);
    return out;
  }
  throw new Error('poly');
}

function asRatFn(node) {
  if (!node) throw new Error('rat');
  if (node.t === 'bin' && node.op === '/') {
    const l = asRatFn(node.a);
    const r = asRatFn(node.b);
    if (polyIsZero(r.n)) throw new Error('div0');
    return { n: polyMul(l.n, r.d), d: polyMul(l.d, r.n) };
  }
  if (node.t === 'bin' && (node.op === '+' || node.op === '-' || node.op === '*')) {
    const l = asRatFn(node.a);
    const r = asRatFn(node.b);
    if (node.op === '*') return { n: polyMul(l.n, r.n), d: polyMul(l.d, r.d) };
    const n = node.op === '+'
      ? polyAdd(polyMul(l.n, r.d), polyMul(r.n, l.d))
      : polySub(polyMul(l.n, r.d), polyMul(r.n, l.d));
    return { n: n, d: polyMul(l.d, r.d) };
  }
  if (node.t === 'bin' && node.op === '^') {
    const exp = constInt(node.b);
    if (exp == null || exp < 0) throw new Error('pow');
    const base = asRatFn(node.a);
    let n = [rat(1, 1)];
    let d = [rat(1, 1)];
    for (let k = 0; k < exp; k += 1) {
      n = polyMul(n, base.n);
      d = polyMul(d, base.d);
    }
    return { n: n, d: d };
  }
  if (node.t === 'neg') {
    const v = asRatFn(node.a);
    return { n: polyNeg(v.n), d: v.d };
  }
  return { n: asPoly(node), d: [rat(1, 1)] };
}

function ratFnEq(a, b) {
  if (polyIsZero(a.d) || polyIsZero(b.d)) return false;
  return polyIsZero(polySub(polyMul(a.n, b.d), polyMul(b.n, a.d)));
}

function formatRatFn(fn) {
  const n = formatPoly(fn.n);
  const d = formatPoly(fn.d);
  if (d === '1') return n;
  return '(' + n + ')/(' + d + ')';
}

function usesName(node, name) {
  if (!node) return false;
  if (node.t === name) return true;
  if (node.t === 'call' && node.name === name) return true;
  if (node.t === 'neg' || node.t === 'deg') return usesName(node.a, name);
  if (node.t === 'bin') return usesName(node.a, name) || usesName(node.b, name);
  if (node.t === 'call') return node.args.some((arg) => usesName(arg, name));
  return false;
}

function splitEq(raw) {
  const s = strip(raw);
  const parts = s.split('=');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return parts;
}

function parseAnswerRats(text) {
  const s = strip(text);
  if (!s) return null;
  const bits = s.split(',');
  const out = [];
  for (let i = 0; i < bits.length; i += 1) {
    if (!bits[i]) return null;
    try { out.push(parseRatText(bits[i])); } catch (e) { return null; }
  }
  return out;
}

function parseRatText(text) {
  let s = strip(text);
  if (s.startsWith('+')) s = s.slice(1);
  const m = s.match(/^(-?\d+)\/(-?\d+)$/);
  if (m) return rat(Number(m[1]), Number(m[2]));
  if (/^-?\d+$/.test(s)) return rat(Number(s), 1);
  throw new Error('rat');
}

function matchRootList(poly, answers) {
  if (!answers || !answers.length) return null;
  let built = [rat(1, 1)];
  answers.forEach((root) => {
    built = polyMul(built, [rneg(root), rat(1, 1)]);
  });
  const monic = polyScale(polyTrim(poly), rdiv(rat(1, 1), polyTrim(poly)[polyTrim(poly).length - 1]));
  const got = polyScale(built, rdiv(rat(1, 1), built[built.length - 1]));
  const computed = answers.slice().sort((a, b) => {
    const d = rsub(a, b);
    return d.n === 0 ? 0 : (d.n > 0 ? 1 : -1);
  }).map(formatRat).join(', ');
  return polyEq(monic, got) ? verified(computed) : mismatched(computed);
}

function checkPolyEquation(raw, answerText) {
  const parts = splitEq(raw);
  if (!parts) return null;
  let left;
  let right;
  try {
    left = asPoly(parse(parts[0]));
    right = asPoly(parse(parts[1]));
  } catch (e) {
    return null;
  }
  const poly = polySub(left, right);
  if (polyDeg(poly) < 3) return null;
  if (polyIsZero(poly)) return review('identity');
  const answers = parseAnswerRats(answerText);
  if (!answers) return review('roots');
  if (answers.length !== polyDeg(poly)) return mismatched(formatPoly(poly));
  return matchRootList(poly, answers);
}

function checkPolyIdentity(raw, answerText) {
  let left;
  let right;
  try {
    left = asPoly(parse(strip(raw)));
    right = asPoly(parse(strip(answerText)));
  } catch (e) {
    return null;
  }
  if (polyDeg(left) < 3 && polyDeg(right) < 3) return null;
  const computed = formatPoly(left);
  return polyEq(left, right) ? verified(computed) : mismatched(computed);
}

function checkRationalIdentity(raw, answerText) {
  if (!strip(raw).includes('/') && !strip(answerText).includes('/')) return null;
  let left;
  let right;
  try {
    left = asRatFn(parse(strip(raw)));
    right = asRatFn(parse(strip(answerText)));
  } catch (e) {
    return null;
  }
  if (polyDeg(left.d) === 0 && polyDeg(right.d) === 0 && polyDeg(left.n) < 3 && polyDeg(right.n) < 3) return null;
  const computed = formatRatFn(left);
  return ratFnEq(left, right) ? verified(computed) : mismatched(computed);
}

function logValue(base, arg) {
  if (base.n <= 0 || base.d !== 1 || base.n === 1) throw new Error('base');
  if (arg.n <= 0) throw new Error('arg');
  for (let q = 1; q <= 4; q += 1) {
    for (let p = -8; p <= 8; p += 1) {
      if (gcd(Math.abs(p), q) !== 1 && !(p === 0 && q === 1)) continue;
      const pow = rpowInt(base, p);
      let got = pow;
      if (q !== 1) {
        const root = intRoot(pow, q);
        if (!root) continue;
        got = root;
      }
      if (req(got, arg)) return rat(p, q);
    }
  }
  throw new Error('log');
}

function intRoot(value, q) {
  if (value.d !== 1 || value.n < 0) return null;
  let lo = 0;
  let hi = value.n;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    let p = 1;
    let overflow = false;
    for (let i = 0; i < q; i += 1) {
      p *= mid;
      if (p > value.n) { overflow = true; break; }
    }
    if (!overflow && p === value.n) return rat(mid, 1);
    if (overflow || p > value.n) hi = mid - 1;
    else lo = mid + 1;
  }
  return null;
}

function evalConst(node) {
  if (!node) throw new Error('const');
  if (node.t === 'n') return node.v;
  if (node.t === 'neg') return rneg(evalConst(node.a));
  if (node.t === 'bin') {
    const l = evalConst(node.a);
    const r = evalConst(node.b);
    if (node.op === '+') return radd(l, r);
    if (node.op === '-') return rsub(l, r);
    if (node.op === '*') return rmul(l, r);
    if (node.op === '/') return rdiv(l, r);
    if (node.op === '^') {
      if (r.d !== 1) throw new Error('pow');
      return rpowInt(l, r.n);
    }
  }
  if (node.t === 'call' && node.name === 'log') {
    return logValue(evalConst(node.args[0]), evalConst(node.args[1]));
  }
  throw new Error('const');
}

function checkLog(raw, answerText) {
  const parts = splitEq(raw);
  if (!parts) {
    try {
      const got = evalConst(parse(strip(raw)));
      const want = parseRatText(answerText);
      return req(got, want) ? verified(formatRat(got)) : mismatched(formatRat(got));
    } catch (e) {
      return review('log');
    }
  }
  try {
    const left = parse(parts[0]);
    const right = evalConst(parse(parts[1]));
    if (left.t === 'call' && left.name === 'log' && left.args[1] && left.args[1].t === 'x') {
      const base = evalConst(left.args[0]);
      const value = rpowInt(base, right.n);
      if (right.d !== 1) return review('log');
      const want = parseRatText(answerText);
      return req(value, want) ? verified(formatRat(value)) : mismatched(formatRat(value));
    }
    if (left.t === 'bin' && left.op === '^' && left.b && left.b.t === 'x') {
      const base = evalConst(left.a);
      const arg = evalConst(parse(parts[1]));
      const got = logValue(base, arg);
      const want = parseRatText(answerText);
      return req(got, want) ? verified(formatRat(got)) : mismatched(formatRat(got));
    }
  } catch (e) {
    return review('log');
  }
  return review('log');
}

function angleDegrees(node, xDeg) {
  if (!node) throw new Error('angle');
  if (node.t === 'deg') return node.v;
  if (node.t === 'pi') return rat(180, 1);
  if (node.t === 'x') {
    if (!xDeg) throw new Error('x');
    return xDeg;
  }
  if (node.t === 'n') return node.v;
  if (node.t === 'neg') return rneg(angleDegrees(node.a, xDeg));
  if (node.t === 'bin') {
    const l = angleDegrees(node.a, xDeg);
    const r = angleDegrees(node.b, xDeg);
    if (node.op === '+') return radd(l, r);
    if (node.op === '-') return rsub(l, r);
    if (node.op === '*') return rmul(l, r);
    if (node.op === '/') return rdiv(l, r);
  }
  throw new Error('angle');
}

function mod360(deg) {
  let n = deg.n;
  let d = deg.d;
  let turns = Math.floor(n / (360 * d));
  if (n < 0) turns = -Math.ceil(Math.abs(n) / (360 * d));
  const whole = rat(turns * 360, 1);
  let out = rsub(deg, whole);
  if (out.n < 0) out = radd(out, rat(360, 1));
  if (req(out, rat(360, 1))) out = rat(0, 1);
  return out;
}

const SIN_TABLE = {
  0: [0, 1, 1],
  30: [1, 2, 1],
  45: [1, 2, 2],
  60: [1, 2, 3],
  90: [1, 1, 1],
  120: [1, 2, 3],
  135: [1, 2, 2],
  150: [1, 2, 1],
  180: [0, 1, 1],
  210: [-1, 2, 1],
  225: [-1, 2, 2],
  240: [-1, 2, 3],
  270: [-1, 1, 1],
  300: [-1, 2, 3],
  315: [-1, 2, 2],
  330: [-1, 2, 1]
};

function tableDeg(deg) {
  const m = mod360(deg);
  if (m.d !== 1) return null;
  return SIN_TABLE[m.n] ? m.n : null;
}

function R(k, rad) {
  if (rad < 0) throw new Error('rad');
  if (k.n === 0 || rad === 1) return { k: k, r: 1 };
  return { k: k, r: rad };
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

function mulR(a, b) {
  const split = splitSquare(a.r * b.r);
  return R(rmul(rmul(a.k, b.k), rat(split.coeff, 1)), split.rad);
}

function trigRad(name, deg) {
  const key = tableDeg(deg);
  if (key == null) throw new Error('angle');
  const row = SIN_TABLE[key];
  const sin = R(rat(row[0], row[1]), row[2]);
  if (name === 'sin') return sin;
  const cosKey = tableDeg(rsub(rat(90, 1), deg));
  if (cosKey == null) throw new Error('angle');
  const crow = SIN_TABLE[cosKey];
  const cos = R(rat(crow[0], crow[1]), crow[2]);
  if (name === 'cos') return cos;
  if (cos.k.n === 0) throw new Error('tan');
  return mulR(sin, invR(cos));
}

function invR(v) {
  if (v.k.n === 0) throw new Error('div0');
  return R(rdiv(rat(1, 1), rmul(v.k, rat(v.r, 1))), v.r);
}

function sameR(a, b) {
  return a.r === b.r && req(a.k, b.k);
}

function formatR(v) {
  if (v.r === 1) return formatRat(v.k);
  const body = 'sqrt(' + v.r + ')';
  if (req(v.k, rat(1, 1))) return body;
  if (req(v.k, rat(-1, 1))) return '-' + body;
  if (v.k.d === 1) return formatRat(v.k) + '*' + body;
  return formatRat(v.k) + '*' + body;
}

function asRadical(node) {
  if (!node) throw new Error('rad');
  if (node.t === 'n') return R(node.v, 1);
  if (node.t === 'neg') {
    const v = asRadical(node.a);
    return R(rneg(v.k), v.r);
  }
  if (node.t === 'call' && node.name === 'sqrt') {
    const inner = asRadical(node.args[0]);
    if (inner.r !== 1 || inner.k.n < 0 || inner.k.d !== 1) throw new Error('rad');
    const split = splitSquare(inner.k.n);
    return R(rat(split.coeff, 1), split.rad);
  }
  if (node.t === 'bin' && node.op === '*') return mulR(asRadical(node.a), asRadical(node.b));
  if (node.t === 'bin' && node.op === '/') return mulR(asRadical(node.a), invR(asRadical(node.b)));
  if (node.t === 'bin' && (node.op === '+' || node.op === '-')) {
    const l = asRadical(node.a);
    const r = asRadical(node.b);
    if (l.r !== r.r) throw new Error('rad');
    return R(node.op === '+' ? radd(l.k, r.k) : rsub(l.k, r.k), l.r);
  }
  throw new Error('rad');
}

function checkTrigValue(raw, answerText) {
  try {
    const node = parse(strip(raw));
    if (!node || node.t !== 'call' || !/^(sin|cos|tan)$/.test(node.name)) return null;
    if (usesName(node.args[0], 'x')) return null;
    const got = trigRad(node.name, angleDegrees(node.args[0], null));
    const want = asRadical(parse(strip(answerText)));
    return sameR(got, want) ? verified(formatR(got)) : mismatched(formatR(got));
  } catch (e) {
    return review('trig');
  }
}

function formatAngle(deg) {
  if (deg.n === 0) return '0';
  const g = gcd(Math.abs(deg.n), deg.d * 180);
  let num = deg.n / g;
  let den = (deg.d * 180) / g;
  const sign = num < 0 ? '-' : '';
  num = Math.abs(num);
  if (den === 1) return sign + (num === 1 ? 'pi' : (num + '*pi'));
  if (num === 1) return sign + 'pi/' + den;
  return sign + num + '*pi/' + den;
}

function checkTrigEq(raw, answerText) {
  const parts = splitEq(raw);
  if (!parts) return null;
  try {
    const left = parse(parts[0]);
    if (!left || left.t !== 'call' || !/^(sin|cos|tan)$/.test(left.name)) return review('trigeq');
    if (!left.args[0] || left.args[0].t !== 'x') return review('trigeq');
    const target = asRadical(parse(parts[1]));
    const found = [];
    Object.keys(SIN_TABLE).forEach((key) => {
      const deg = rat(Number(key), 1);
      let got;
      try { got = trigRad(left.name, deg); } catch (e) { return; }
      if (sameR(got, target)) found.push(deg);
    });
    found.sort((a, b) => a.n - b.n);
    const computed = found.map(formatAngle).join(', ');
    const claimed = strip(answerText).split(',').filter(Boolean).map((bit) => {
      const node = parse(bit);
      return mod360(angleDegrees(node, null));
    });
    if (claimed.length !== found.length) return mismatched(computed);
    const ok = claimed.every((deg) => found.some((item) => req(item, deg)));
    return ok ? verified(computed) : mismatched(computed);
  } catch (e) {
    return review('trigeq');
  }
}

function matchLinear(node) {
  if (!node) return null;
  if (node.t === 'x') return { a: rat(1, 1), b: { t: 'n', v: rat(0, 1) } };
  if (node.t === 'bin' && node.op === '*' && node.a.t === 'n' && node.b.t === 'x') {
    return { a: node.a.v, b: { t: 'n', v: rat(0, 1) } };
  }
  if (node.t === 'bin' && (node.op === '+' || node.op === '-')) {
    const left = matchLinear(node.a);
    if (!left) return null;
    if (usesName(node.b, 'x')) return null;
    const b = node.op === '+' ? node.b : { t: 'neg', a: node.b };
    if (left.b.t === 'n' && req(left.b.v, rat(0, 1))) return { a: left.a, b: b };
    return null;
  }
  return null;
}

function matchWave(node) {
  let amp = rat(1, 1);
  let body = node;
  if (body && body.t === 'neg') {
    amp = rneg(amp);
    body = body.a;
  }
  if (body && body.t === 'bin' && body.op === '*' && body.a.t === 'neg' && body.a.a && body.a.a.t === 'n') {
    amp = rmul(amp, rneg(body.a.a.v));
    body = body.b;
  }
  if (body && body.t === 'bin' && body.op === '*' && body.a.t === 'n') {
    amp = rmul(amp, body.a.v);
    body = body.b;
  }
  if (!body || body.t !== 'call' || (body.name !== 'sin' && body.name !== 'cos')) return null;
  const lin = matchLinear(body.args[0]);
  if (!lin || lin.a.n === 0) return null;
  return { amp: amp, a: lin.a, b: lin.b, fn: body.name };
}

function checkWave(kind, expr, answerText) {
  try {
    const wave = matchWave(parse(strip(expr)));
    if (!wave) return review('wave');
    if (kind === 'amp') {
      const got = rabs(wave.amp);
      const want = parseRatText(answerText);
      return req(got, want) ? verified(formatRat(got)) : mismatched(formatRat(got));
    }
    if (kind === 'period') {
      const turns = rdiv(rat(360, 1), rabs(wave.a));
      const want = angleDegrees(parse(strip(answerText)), null);
      return req(turns, want) ? verified(formatAngle(turns)) : mismatched(formatAngle(turns));
    }
    const shift = angleDegrees(wave.b, null);
    const h = rdiv(rneg(shift), wave.a);
    const want = angleDegrees(parse(strip(answerText)), null);
    return req(h, want) ? verified(formatAngle(h)) : mismatched(formatAngle(h));
  } catch (e) {
    return review('wave');
  }
}

function bivarZero() {
  return { x2: rat(0, 1), y2: rat(0, 1), xy: rat(0, 1), x: rat(0, 1), y: rat(0, 1), c: rat(0, 1) };
}

function bivarAdd(a, b, op) {
  const s = op === '-' ? -1 : 1;
  const out = bivarZero();
  Object.keys(out).forEach((k) => {
    out[k] = s < 0 ? rsub(a[k], b[k]) : radd(a[k], b[k]);
  });
  return out;
}

function bivarDeg(v) {
  if (v.x2.n || v.y2.n || v.xy.n) return 2;
  if (v.x.n || v.y.n) return 1;
  return 0;
}

function bivarMul(a, b) {
  if (bivarDeg(a) + bivarDeg(b) > 2) throw new Error('degree');
  const pairs = [
    ['x2', 'c', 'x2'], ['c', 'x2', 'x2'], ['x', 'x', 'x2'],
    ['y2', 'c', 'y2'], ['c', 'y2', 'y2'], ['y', 'y', 'y2'],
    ['x', 'y', 'xy'], ['y', 'x', 'xy'], ['xy', 'c', 'xy'], ['c', 'xy', 'xy'],
    ['x', 'c', 'x'], ['c', 'x', 'x'],
    ['y', 'c', 'y'], ['c', 'y', 'y'],
    ['c', 'c', 'c']
  ];
  const out = bivarZero();
  pairs.forEach((p) => {
    out[p[2]] = radd(out[p[2]], rmul(a[p[0]], b[p[1]]));
  });
  return out;
}

function asBivar(node) {
  if (!node) throw new Error('bivar');
  if (node.t === 'n') {
    const v = bivarZero();
    v.c = node.v;
    return v;
  }
  if (node.t === 'x' || node.t === 'y') {
    const v = bivarZero();
    v[node.t] = rat(1, 1);
    return v;
  }
  if (node.t === 'neg') return bivarAdd(bivarZero(), asBivar(node.a), '-');
  if (node.t === 'bin' && (node.op === '+' || node.op === '-')) return bivarAdd(asBivar(node.a), asBivar(node.b), node.op);
  if (node.t === 'bin' && node.op === '*') return bivarMul(asBivar(node.a), asBivar(node.b));
  if (node.t === 'bin' && node.op === '^') {
    const exp = constInt(node.b);
    if (exp == null || exp < 0 || exp > 2) throw new Error('pow');
    let out = bivarZero();
    out.c = rat(1, 1);
    const base = asBivar(node.a);
    for (let k = 0; k < exp; k += 1) out = bivarMul(out, base);
    return out;
  }
  if (node.t === 'bin' && node.op === '/') {
    const den = asBivar(node.b);
    const keys = ['x2', 'y2', 'xy', 'x', 'y'];
    if (keys.some((k) => den[k].n !== 0) || den.c.n === 0) throw new Error('div');
    const out = asBivar(node.a);
    keys.concat(['c']).forEach((k) => { out[k] = rdiv(out[k], den.c); });
    return out;
  }
  throw new Error('bivar');
}

function conicOf(raw) {
  const parts = splitEq(raw);
  if (!parts) return null;
  return bivarAdd(asBivar(parse(parts[0])), asBivar(parse(parts[1])), '-');
}

function conicSame(a, b) {
  const keys = ['x2', 'y2', 'xy', 'x', 'y', 'c'];
  let scale = null;
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (a[k].n === 0 && b[k].n === 0) continue;
    if (a[k].n === 0 || b[k].n === 0) return false;
    const s = rdiv(a[k], b[k]);
    if (!scale) scale = s;
    else if (!req(scale, s)) return false;
  }
  return !!scale;
}

function circleParts(raw) {
  const v = conicOf(raw);
  if (!v || v.xy.n !== 0 || !req(v.x2, v.y2) || v.x2.n === 0) return null;
  const d = rdiv(v.x, v.x2);
  const e = rdiv(v.y, v.x2);
  const f = rdiv(v.c, v.x2);
  const h = rdiv(rneg(d), rat(2, 1));
  const k = rdiv(rneg(e), rat(2, 1));
  const r2 = rsub(radd(rmul(h, h), rmul(k, k)), f);
  return { h: h, k: k, r2: r2 };
}

function checkConic(raw, answerText) {
  try {
    const left = conicOf(raw);
    const right = conicOf(answerText);
    if (!left || !right) return review('conic');
    return conicSame(left, right) ? verified('equivalent') : mismatched('equivalent');
  } catch (e) {
    return review('conic');
  }
}

function perfectSqrt(value) {
  if (value.n < 0) return null;
  const ns = intRoot(rat(value.n, 1), 2);
  const ds = intRoot(rat(value.d, 1), 2);
  if (!ns || !ds) return null;
  return rat(ns.n, ds.n);
}

function checkCircle(kind, expr, answerText) {
  try {
    const circle = circleParts(expr);
    if (!circle) return review('circle');
    if (kind === 'center') {
      const want = parseAnswerRats(answerText);
      const computed = formatRat(circle.h) + ', ' + formatRat(circle.k);
      if (!want || want.length !== 2) return mismatched(computed);
      const ok = req(want[0], circle.h) && req(want[1], circle.k);
      return ok ? verified(computed) : mismatched(computed);
    }
    const rad = perfectSqrt(circle.r2);
    if (!rad) return review('radius');
    const want = parseRatText(answerText);
    return req(rad, want) ? verified(formatRat(rad)) : mismatched(formatRat(rad));
  } catch (e) {
    return review('circle');
  }
}

function denomRoots(fn) {
  const den = polyTrim(fn.d);
  const roots = [];
  for (let n = -12; n <= 12; n += 1) {
    const guess = rat(n, 1);
    if (polyAt(den, guess).n === 0) roots.push(guess);
  }
  return roots;
}

function polyAt(coeffs, x) {
  let out = rat(0, 1);
  for (let i = coeffs.length - 1; i >= 0; i -= 1) out = radd(rmul(out, x), coeffs[i]);
  return out;
}

function checkHole(expr, answerText) {
  try {
    const fn = asRatFn(parse(strip(expr)));
    const roots = denomRoots(fn);
    const answers = parseAnswerRats(answerText);
    const computed = roots.map(formatRat).sort().join(', ');
    if (!answers) return mismatched(computed);
    if (answers.length !== roots.length) return mismatched(computed);
    const ok = answers.every((a) => roots.some((r) => req(a, r)));
    return ok ? verified(computed) : mismatched(computed);
  } catch (e) {
    return review('hole');
  }
}

function checkAsymp(expr, answerText) {
  try {
    const fn = asRatFn(parse(strip(expr)));
    const dn = polyDeg(fn.n);
    const dd = polyDeg(fn.d);
    let got;
    if (dn < dd) got = rat(0, 1);
    else if (dn === dd) got = rdiv(polyTrim(fn.n).pop(), polyTrim(fn.d).pop());
    else return review('asymp');
    const want = parseRatText(answerText);
    return req(got, want) ? verified(formatRat(got)) : mismatched(formatRat(got));
  } catch (e) {
    return review('asymp');
  }
}

function polyLead(c) {
  const t = polyTrim(c);
  return t[t.length - 1];
}

function cancelRat(fn) {
  let n = polyTrim(fn.n);
  let d = polyTrim(fn.d);
  const roots = denomRoots({ n: n, d: d });
  roots.forEach((root) => {
    while (polyAt(n, root).n === 0 && polyAt(d, root).n === 0 && polyDeg(d) > 0) {
      n = synth(n, root);
      d = synth(d, root);
    }
  });
  return { n: polyTrim(n), d: polyTrim(d) };
}

function synth(coeffs, root) {
  const c = polyTrim(coeffs);
  const out = [];
  let acc = rat(0, 1);
  for (let i = c.length - 1; i >= 0; i -= 1) {
    acc = radd(c[i], rmul(acc, root));
    if (i > 0) out.push(acc);
  }
  return polyTrim(out.reverse());
}

function checkLimit(raw, answerText) {
  try {
    const node = parse(strip(raw));
    if (!node || node.t !== 'call' || node.name !== 'lim' || node.args.length !== 2) return review('limit');
    const target = node.args[0];
    const fn = cancelRat(asRatFn(node.args[1]));
    const wantText = strip(answerText).toLowerCase();
    if (target.at === 'inf') {
      const dn = polyDeg(fn.n);
      const dd = polyDeg(fn.d);
      const sign = target.sign < 0 ? -1 : 1;
      if (dn < dd) {
        const want = parseRatText(answerText);
        return req(want, rat(0, 1)) ? verified('0') : mismatched('0');
      }
      if (dn === dd) {
        const got = rdiv(polyLead(fn.n), polyLead(fn.d));
        const want = parseRatText(answerText);
        return req(got, want) ? verified(formatRat(got)) : mismatched(formatRat(got));
      }
      const k = dn - dd;
      let s = rdiv(polyLead(fn.n), polyLead(fn.d));
      if (sign < 0 && k % 2) s = rneg(s);
      const computed = s.n < 0 ? '-inf' : 'inf';
      return wantText === computed ? verified(computed) : mismatched(computed);
    }
    const at = target.at;
    const num = polyAt(fn.n, at);
    const den = polyAt(fn.d, at);
    if (den.n !== 0) {
      const got = rdiv(num, den);
      const want = parseRatText(answerText);
      return req(got, want) ? verified(formatRat(got)) : mismatched(formatRat(got));
    }
    if (num.n === 0) return review('limit');
    let mult = 0;
    let dpoly = fn.d;
    while (polyAt(dpoly, at).n === 0 && polyDeg(dpoly) > 0) {
      dpoly = synth(dpoly, at);
      mult += 1;
    }
    const q = polyAt(dpoly, at);
    const plus = rmul(num, q);
    const minus = mult % 2 ? rneg(plus) : plus;
    const pick = target.side === 'minus' ? minus : plus;
    if (target.side === 'both' && mult % 2) return review('limit');
    const computed = pick.n < 0 ? '-inf' : 'inf';
    return wantText === computed ? verified(computed) : mismatched(computed);
  } catch (e) {
    return review('limit');
  }
}

function num(n, d) { return { t: 'n', v: rat(n, d == null ? 1 : d) }; }
function addNode(a, b) { return { t: 'bin', op: '+', a: a, b: b }; }
function subNode(a, b) { return { t: 'bin', op: '-', a: a, b: b }; }
function mulNode(a, b) { return { t: 'bin', op: '*', a: a, b: b }; }
function divNode(a, b) { return { t: 'bin', op: '/', a: a, b: b }; }

function derivative(node) {
  if (!node) throw new Error('diff');
  if (node.t === 'n' || node.t === 'pi' || node.t === 'deg' || node.t === 'inf' || node.t === 'y') return num(0);
  if (node.t === 'x') return num(1);
  if (node.t === 'neg') return { t: 'neg', a: derivative(node.a) };
  if (node.t === 'bin' && node.op === '+') return addNode(derivative(node.a), derivative(node.b));
  if (node.t === 'bin' && node.op === '-') return subNode(derivative(node.a), derivative(node.b));
  if (node.t === 'bin' && node.op === '*') {
    return addNode(mulNode(derivative(node.a), node.b), mulNode(node.a, derivative(node.b)));
  }
  if (node.t === 'bin' && node.op === '/') {
    const top = subNode(mulNode(derivative(node.a), node.b), mulNode(node.a, derivative(node.b)));
    return divNode(top, { t: 'bin', op: '^', a: node.b, b: num(2) });
  }
  if (node.t === 'bin' && node.op === '^') {
    const exp = constInt(node.b);
    if (exp == null) throw new Error('pow');
    if (exp === 0) return num(0);
    return mulNode(mulNode(num(exp), { t: 'bin', op: '^', a: node.a, b: num(exp - 1) }), derivative(node.a));
  }
  if (node.t === 'call' && node.args.length === 1) {
    const u = node.args[0];
    const du = derivative(u);
    if (node.name === 'sin') return mulNode({ t: 'call', name: 'cos', args: [u] }, du);
    if (node.name === 'cos') return mulNode({ t: 'neg', a: { t: 'call', name: 'sin', args: [u] } }, du);
    if (node.name === 'exp') return mulNode({ t: 'call', name: 'exp', args: [u] }, du);
    if (node.name === 'ln') return divNode(du, u);
  }
  throw new Error('diff');
}

function linearRat(node) {
  if (node.t === 'x') return { a: rat(1, 1), b: rat(0, 1) };
  if (node.t === 'n') return { a: rat(0, 1), b: node.v };
  if (node.t === 'neg') {
    const v = linearRat(node.a);
    return { a: rneg(v.a), b: rneg(v.b) };
  }
  if (node.t === 'bin' && (node.op === '+' || node.op === '-')) {
    const l = linearRat(node.a);
    const r = linearRat(node.b);
    return node.op === '+'
      ? { a: radd(l.a, r.a), b: radd(l.b, r.b) }
      : { a: rsub(l.a, r.a), b: rsub(l.b, r.b) };
  }
  if (node.t === 'bin' && node.op === '*' ) {
    const l = linearRat(node.a);
    const r = linearRat(node.b);
    if (l.a.n !== 0 && r.a.n !== 0) throw new Error('lin');
    return { a: radd(rmul(l.a, r.b), rmul(l.b, r.a)), b: rmul(l.b, r.b) };
  }
  throw new Error('lin');
}

function termOf(node) {
  if (!node) return null;
  if (node.t === 'neg') {
    const inner = termOf(node.a);
    if (!inner) return null;
    return { coeff: rneg(inner.coeff), keys: inner.keys };
  }
  if (node.t === 'n') return { coeff: node.v, keys: [] };
  if (node.t === 'x') return { coeff: rat(1, 1), keys: ['x'] };
  if (node.t === 'bin' && node.op === '*') {
    const l = termOf(node.a);
    const r = termOf(node.b);
    if (!l || !r) return null;
    return { coeff: rmul(l.coeff, r.coeff), keys: l.keys.concat(r.keys).sort() };
  }
  if (node.t === 'bin' && node.op === '/') {
    const top = termOf(node.a);
    if (!top) return null;
    try {
      const lin = linearRat(node.b);
      if (lin.a.n === 0 && lin.b.n === 0) return null;
      const key = 'inv(' + formatRat(lin.a) + ',' + formatRat(lin.b) + ')';
      return { coeff: top.coeff, keys: top.keys.concat([key]).sort() };
    } catch (e) {
      return null;
    }
  }
  if (node.t === 'bin' && node.op === '^') {
    const exp = constInt(node.b);
    if (exp === 0) return { coeff: rat(1, 1), keys: [] };
    if (exp === 1) return termOf(node.a);
  }
  if (node.t === 'bin' && node.op === '^' && node.a.t === 'x') {
    const exp = constInt(node.b);
    if (exp == null || exp < 1) return null;
    const keys = [];
    for (let k = 0; k < exp; k += 1) keys.push('x');
    return { coeff: rat(1, 1), keys: keys };
  }
  if (node.t === 'call' && /^(sin|cos|exp|ln)$/.test(node.name)) {
    try {
      const lin = linearRat(node.args[0]);
      const key = node.name + '(' + formatRat(lin.a) + ',' + formatRat(lin.b) + ')';
      return { coeff: rat(1, 1), keys: [key] };
    } catch (e) {
      return null;
    }
  }
  return null;
}

function expandSum(node) {
  if (!node) return null;
  if (node.t === 'neg') {
    const inner = expandSum(node.a);
    if (!inner) return null;
    return inner.map((item) => ({ t: 'neg', a: item }));
  }
  if (node.t === 'bin' && (node.op === '+' || node.op === '-')) {
    const l = expandSum(node.a);
    const r = expandSum(node.b);
    if (!l || !r) return null;
    return l.concat(node.op === '+' ? r : r.map((item) => ({ t: 'neg', a: item })));
  }
  if (node.t === 'bin' && node.op === '*') {
    const l = expandSum(node.a);
    const r = expandSum(node.b);
    if (!l || !r) return null;
    const out = [];
    l.forEach((a) => r.forEach((b) => out.push({ t: 'bin', op: '*', a: a, b: b })));
    return out;
  }
  return [node];
}

function termList(node) {
  const parts = expandSum(node);
  if (!parts) return null;
  const terms = parts.map(termOf);
  if (terms.some((item) => !item)) return null;
  return terms;
}

function termKey(term) {
  return term.keys.join('*') || '1';
}

function termsEqual(a, b) {
  const fold = (list) => {
    const map = {};
    list.forEach((term) => {
      const key = termKey(term);
      map[key] = map[key] ? radd(map[key], term.coeff) : term.coeff;
    });
    return map;
  };
  const A = fold(a);
  const B = fold(b);
  const keys = Object.keys(A).concat(Object.keys(B));
  const seen = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (seen[key]) continue;
    seen[key] = true;
    const av = A[key] || rat(0, 1);
    const bv = B[key] || rat(0, 1);
    if (!req(av, bv)) return false;
  }
  return true;
}

function sameCalc(left, right) {
  try {
    const a = asRatFn(left);
    const b = asRatFn(right);
    return ratFnEq(a, b) ? formatRatFn(a) : null;
  } catch (e) { /* transcendental */ }
  const a = termList(left);
  const b = termList(right);
  if (!a || !b) return undefined;
  return termsEqual(a, b) ? 'matched' : null;
}

function checkDeriv(expr, answerText) {
  try {
    const body = parse(strip(expr));
    const got = derivative(body);
    const want = parse(strip(answerText));
    const same = sameCalc(got, want);
    if (same === undefined) return review('deriv');
    if (same === null) {
      let shown = '';
      try { shown = formatRatFn(asRatFn(got)); } catch (e2) { shown = 'derivative'; }
      return mismatched(shown);
    }
    return verified(same === 'matched' ? 'derivative' : same);
  } catch (e) {
    return review('deriv');
  }
}

function checkDerivAt(pointExpr, bodyExpr, answerText) {
  try {
    const at = parseRatText(pointExpr);
    const slope = asRatFn(derivative(parse(strip(bodyExpr))));
    if (polyDeg(slope.d) > 0 && polyAt(slope.d, at).n === 0) return review('deriv');
    const got = polyDeg(slope.d) === 0
      ? polyAt(polyScale(slope.n, rdiv(rat(1, 1), slope.d[0])), at)
      : rdiv(polyAt(slope.n, at), polyAt(slope.d, at));
    const want = parseRatText(answerText);
    return req(got, want) ? verified(formatRat(got)) : mismatched(formatRat(got));
  } catch (e) {
    return review('deriv');
  }
}

function checkTangent(pointExpr, bodyExpr, answerText) {
  try {
    const at = parseRatText(pointExpr);
    const fn = asRatFn(parse(strip(bodyExpr)));
    const slopeFn = asRatFn(derivative(parse(strip(bodyExpr))));
    const y0 = rdiv(polyAt(fn.n, at), polyAt(fn.d, at));
    const m = polyDeg(slopeFn.d) === 0
      ? polyAt(polyScale(slopeFn.n, rdiv(rat(1, 1), slopeFn.d[0])), at)
      : rdiv(polyAt(slopeFn.n, at), polyAt(slopeFn.d, at));
    const line = [rsub(y0, rmul(m, at)), m];
    const want = asPoly(parse(strip(answerText)));
    const computed = formatPoly(line);
    return polyEq(line, want) ? verified(computed) : mismatched(computed);
  } catch (e) {
    return review('tangent');
  }
}

function checkCrit(expr, answerText) {
  try {
    const slope = asPoly(derivative(parse(strip(expr))));
    if (polyIsZero(slope)) return review('crit');
    const answers = parseAnswerRats(answerText);
    if (!answers) return review('crit');
    const roots = [];
    for (let n = -12; n <= 12; n += 1) {
      for (let d = 1; d <= 4; d += 1) {
        const guess = rat(n, d);
        if (polyAt(slope, guess).n === 0) roots.push(guess);
      }
    }
    const unique = [];
    roots.forEach((root) => {
      if (!unique.some((item) => req(item, root))) unique.push(root);
    });
    if (unique.length !== polyDeg(slope) && polyDeg(slope) <= 2) {
      /* rational-root list can miss nothing for degree <= 2 if disc is square; keep listed roots */
    }
    const computed = unique.map(formatRat).join(', ');
    if (answers.length !== unique.length) return mismatched(computed || formatPoly(slope));
    const ok = answers.every((a) => unique.some((r) => req(a, r))) && unique.every((r) => polyAt(slope, r).n === 0);
    return ok ? verified(computed) : mismatched(computed);
  } catch (e) {
    return review('crit');
  }
}

function checkMaxOn(loExpr, hiExpr, bodyExpr, answerText) {
  try {
    const lo = parseRatText(loExpr);
    const hi = parseRatText(hiExpr);
    const fn = asPoly(parse(strip(bodyExpr)));
    const slope = asPoly(derivative(parse(strip(bodyExpr))));
    const points = [lo, hi];
    for (let n = -12; n <= 12; n += 1) {
      for (let d = 1; d <= 4; d += 1) {
        const guess = rat(n, d);
        if (polyAt(slope, guess).n !== 0) continue;
        const geLo = rsub(guess, lo).n >= 0;
        const leHi = rsub(hi, guess).n >= 0;
        if (geLo && leHi) points.push(guess);
      }
    }
    let best = null;
    points.forEach((p) => {
      const value = polyAt(fn, p);
      if (!best || rsub(value, best).n > 0) best = value;
    });
    const want = parseRatText(answerText);
    return req(best, want) ? verified(formatRat(best)) : mismatched(formatRat(best));
  } catch (e) {
    return review('max');
  }
}

function checkIntegral(expr, answerText) {
  try {
    const integrand = parse(strip(expr));
    const proposed = derivative(parse(strip(answerText)));
    const same = sameCalc(integrand, proposed);
    if (same === undefined) return review('int');
    if (same === null) return mismatched('antiderivative');
    return verified('antiderivative');
  } catch (e) {
    return review('int');
  }
}

function checkDefint(aExpr, bExpr, bodyExpr, answerText) {
  try {
    const lo = parse(strip(aExpr));
    const hi = parse(strip(bExpr));
    const integrand = parse(strip(bodyExpr));
    const coeffs = asPoly(integrand);
    const anti = [rat(0, 1)];
    for (let p = 0; p < coeffs.length; p += 1) {
      anti[p + 1] = rdiv(coeffs[p], rat(p + 1, 1));
    }
    const bound = (node) => {
      if (node.t === 'n') return node.v;
      throw new Error('bound');
    };
    const got = rsub(polyAt(anti, bound(hi)), polyAt(anti, bound(lo)));
    const want = parseRatText(answerText);
    return req(got, want) ? verified(formatRat(got)) : mismatched(formatRat(got));
  } catch (e) {
    return review('defint');
  }
}

function prefix(raw, name) {
  const s = String(raw || '').trim();
  const head = name + ':';
  if (s.slice(0, head.length).toLowerCase() !== head) return null;
  return s.slice(head.length).trim();
}

function callArgs(raw, name) {
  const s = strip(raw);
  const head = name.toLowerCase() + '(';
  if (s.slice(0, head.length).toLowerCase() !== head || s[s.length - 1] !== ')') return null;
  const inner = s.slice(head.length, -1);
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return args;
}

function tryHigher(raw, answerText) {
  const src = String(raw || '').trim();
  const answer = String(answerText || '').trim();
  if (!src || !answer) return null;
  try {
    const tagged = [
      ['hole', checkHole],
      ['asymp', checkAsymp],
      ['amp', (expr, ans) => checkWave('amp', expr, ans)],
      ['period', (expr, ans) => checkWave('period', expr, ans)],
      ['shift', (expr, ans) => checkWave('shift', expr, ans)],
      ['radius', (expr, ans) => checkCircle('radius', expr, ans)],
      ['center', (expr, ans) => checkCircle('center', expr, ans)]
    ];
    for (let i = 0; i < tagged.length; i += 1) {
      const body = prefix(src, tagged[i][0]);
      if (body != null) return tagged[i][1](body, answer);
    }
    if (/^lim\(/i.test(strip(src))) return checkLimit(src, answer);
    if (/^deriv\(/i.test(strip(src))) {
      const args = callArgs(src, 'deriv');
      if (!args || args.length !== 1) return review('deriv');
      return checkDeriv(args[0], answer);
    }
    if (/^derivat\(/i.test(strip(src))) {
      const args = callArgs(src, 'derivAt');
      if (!args || args.length !== 2) return review('deriv');
      return checkDerivAt(args[0], args[1], answer);
    }
    if (/^tangent\(/i.test(strip(src))) {
      const args = callArgs(src, 'tangent');
      if (!args || args.length !== 2) return review('tangent');
      return checkTangent(args[0], args[1], answer);
    }
    if (/^int\(/i.test(strip(src))) {
      const args = callArgs(src, 'int');
      if (!args || args.length !== 1) return review('int');
      return checkIntegral(args[0], answer);
    }
    if (/^defint\(/i.test(strip(src))) {
      const args = callArgs(src, 'defint');
      if (!args || args.length !== 3) return review('defint');
      return checkDefint(args[0], args[1], args[2], answer);
    }
    if (/^crit\(/i.test(strip(src))) {
      const args = callArgs(src, 'crit');
      if (!args || args.length !== 1) return review('crit');
      return checkCrit(args[0], answer);
    }
    if (/^maxon\(/i.test(strip(src))) {
      const args = callArgs(src, 'maxOn');
      if (!args || args.length !== 3) return review('max');
      return checkMaxOn(args[0], args[1], args[2], answer);
    }
    if (/^log\(/i.test(strip(src)) || /=log\(/i.test(strip(src))) return checkLog(src, answer);
    if (/^(sin|cos|tan)\(/i.test(strip(src))) {
      if (src.includes('=')) return checkTrigEq(src, answer);
      return checkTrigValue(src, answer);
    }
    if (/^\d+\^x=/i.test(strip(src))) return checkLog(src, answer);
    const equals = src.match(/=/g) || [];
    if (src.includes(';') || equals.length > 1) return null;
    if (equals.length === 1 && /[yY]/.test(src)) return checkConic(src, answer);
    if (equals.length === 1) {
      const roots = checkPolyEquation(src, answer);
      if (roots) return roots;
    }
    const rational = checkRationalIdentity(src, answer);
    if (rational) return rational;
    const poly = checkPolyIdentity(src, answer);
    if (poly) return poly;
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  tryHigher
};
