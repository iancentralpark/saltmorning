'use strict';

/**
 * Start the Node app, and optionally the OR-Tools solver on localhost:8791
 * when TIMETABLE_SOLVER_URL is unset / points at loopback.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function solverUrl() {
  return String(process.env.TIMETABLE_SOLVER_URL || 'http://127.0.0.1:8791');
}

function shouldSpawnLocalSolver() {
  if (process.env.TIMETABLE_SOLVER_SPAWN === '0') return false;
  if (process.env.TIMETABLE_SOLVER_SPAWN === '1') return true;
  const url = solverUrl();
  return /127\.0\.0\.1|localhost/.test(url);
}

function resolvePythonBinary() {
  if (process.env.TIMETABLE_SOLVER_PYTHON) {
    return process.env.TIMETABLE_SOLVER_PYTHON;
  }
  const venvPy = path.join(__dirname, '..', 'solver', '.venv', 'bin', 'python');
  if (fs.existsSync(venvPy)) return venvPy;
  return 'python3';
}

function tryStartSolver() {
  if (!shouldSpawnLocalSolver()) return;
  const py = resolvePythonBinary();
  const script = path.join(__dirname, '..', 'solver', 'main.py');
  if (!fs.existsSync(script)) {
    console.warn('[solver] main.py not found — skipping local solver');
    return;
  }
  try {
    const child = spawn(py, [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached: false
    });
    child.stdout.on('data', (buf) => {
      process.stdout.write('[solver] ' + buf);
    });
    child.stderr.on('data', (buf) => {
      process.stderr.write('[solver] ' + buf);
    });
    child.on('error', (err) => {
      console.warn('[solver] not started:', err.message);
      console.warn('[solver] Auto-Solve needs Python + ortools (solver/.venv on Railway).');
    });
    child.on('exit', (code) => {
      if (code && code !== 0) {
        console.warn('[solver] exited with code', code);
      }
    });
    console.log('[solver] spawning local OR-Tools solver via', py);
  } catch (e) {
    console.warn('[solver] spawn failed:', e.message);
  }
}

tryStartSolver();
require('../src/index.js');
