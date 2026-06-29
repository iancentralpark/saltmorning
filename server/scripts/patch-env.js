#!/usr/bin/env node
/** Patch server/.env key=value (create if missing) */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const updates = {};
for (let i = 2; i < process.argv.length; i++) {
  const eq = process.argv[i].indexOf('=');
  if (eq <= 0) continue;
  updates[process.argv[i].slice(0, eq)] = process.argv[i].slice(eq + 1);
}

if (!Object.keys(updates).length) {
  console.error('Usage: node scripts/patch-env.js KEY=value ...');
  process.exit(1);
}

let lines = [];
if (fs.existsSync(envPath)) {
  lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
}

const keys = new Set(Object.keys(updates));
const out = [];
for (const line of lines) {
  const m = line.match(/^([A-Z0-9_]+)=/);
  if (m && keys.has(m[1])) {
    out.push(m[1] + '=' + updates[m[1]]);
    keys.delete(m[1]);
  } else {
    out.push(line);
  }
}
for (const k of keys) {
  out.push(k + '=' + updates[k]);
}
fs.writeFileSync(envPath, out.filter((l, i, a) => !(l === '' && i === a.length - 1)).join('\n') + '\n');
console.log('Updated .env:', Object.keys(updates).join(', '));
