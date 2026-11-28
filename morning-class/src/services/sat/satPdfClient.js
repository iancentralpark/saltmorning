'use strict';

/** Talks to the PDF child process (satPdfWorker.js). One child, started on demand, stopped when idle. */

const path = require('path');
const { fork } = require('child_process');

const WORKER_PATH = path.join(__dirname, 'satPdfWorker.js');
const IDLE_MS = 5 * 60 * 1000;
const CALL_TIMEOUT_MS = 3 * 60 * 1000;

let child = null;
let seq = 0;
let idleTimer = null;
const pending = new Map();

function failAll(message) {
  pending.forEach((p) => {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  });
  pending.clear();
}

function stop() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (child) {
    const c = child;
    child = null;
    try { c.kill(); } catch (_) { /* already gone */ }
  }
}

function ensureChild() {
  if (child && child.connected) return child;
  const c = fork(WORKER_PATH, [], { serialization: 'advanced', execArgv: [] });
  c.on('message', (msg) => {
    const p = msg && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || 'PDF operation failed.'));
  });
  c.on('exit', (code, signal) => {
    if (child === c) child = null;
    failAll('PDF reader stopped' + (signal ? ' (' + signal + ')' : code ? ' (exit ' + code + ')' : '') + '.');
  });
  c.on('error', (e) => {
    if (child === c) child = null;
    failAll('PDF reader failed to start: ' + e.message);
  });
  child = c;
  return c;
}

function call(op, args) {
  return new Promise((resolve, reject) => {
    let c;
    try {
      c = ensureChild();
    } catch (e) {
      reject(e);
      return;
    }
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('PDF operation timed out: ' + op));
      stop();
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    c.send({ id, op, args }, (err) => {
      if (!err) return;
      pending.delete(id);
      clearTimeout(timer);
      reject(err);
    });
    armIdleTimer();
  });
}

function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size) armIdleTimer();
    else stop();
  }, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

function asBuffer(result) {
  if (result && result.data && !Buffer.isBuffer(result.data)) {
    result.data = Buffer.from(result.data.buffer || result.data, result.data.byteOffset || 0, result.data.byteLength);
  }
  return result;
}

module.exports = {
  open: (file) => call('open', { file }),
  texts: (file, from, to) => call('texts', { file, from, to }),
  render: (file, page, opts) => call('render', Object.assign({ file, page }, opts || {})).then(asBuffer),
  crop: (file, page, box, snap) => call('crop', { file, page, box, snap }).then(asBuffer),
  close: (file) => call('close', { file }),
  stop
};
