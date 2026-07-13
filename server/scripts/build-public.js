#!/usr/bin/env node
/**
 * Copies Student.html + Index.html into server/public for Railway hosting.
 * Teacher app on Railway runs top-level (no GAS sandbox iframe) so mobile
 * back-button guards and keyboard layout work like the student portal.
 */
const fs = require('fs');
const path = require('path');

const PORTAL_BUILD = '2026-07-13.13';

const serverDir = path.join(__dirname, '..');
const repoRoot = path.join(serverDir, '..');
const publicDir = path.join(serverDir, 'public');
const teacherSrcDir = path.join(serverDir, 'teacher-src');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function resolveRepoFile(name) {
  const candidates = [
    path.join(repoRoot, name),
    path.join(teacherSrcDir, name)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function syncTeacherSourceFiles() {
  const indexSrc = path.join(repoRoot, 'Index.html');
  if (!fs.existsSync(indexSrc)) return;
  fs.mkdirSync(teacherSrcDir, { recursive: true });
  fs.copyFileSync(indexSrc, path.join(teacherSrcDir, 'Index.html'));
  const snailSrc = path.join(repoRoot, 'SnailSprite.html');
  if (fs.existsSync(snailSrc)) {
    fs.copyFileSync(snailSrc, path.join(teacherSrcDir, 'SnailSprite.html'));
  }
}

function inlineSnail(html, spritePath) {
  if (!spritePath || !fs.existsSync(spritePath)) return html;
  return html.replace(/<\?!= include\('SnailSprite'\); \?>/g, read(spritePath));
}

const PORTAL_HEAD_ASSETS = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="stylesheet" href="/css/messenger-ui.css">',
  '<script src="https://cdn.socket.io/4.8.1/socket.io.min.js" defer></script>',
  '<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js" defer></script>',
  '<script src="https://cdn.jsdelivr.net/npm/autosize@6.0.1/dist/autosize.min.js" defer></script>',
  '<script src="/js/messenger-realtime.js" defer></script>',
  '<script src="/js/messenger-ui.js" defer></script>'
].join('\n');

const TOOL_PWA_ASSETS = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<meta name="theme-color" content="#3b9edd">'
].join('\n');

function injectToolPwa(html) {
  if (html.includes('/manifest.webmanifest')) return html;
  return html.replace('</head>', TOOL_PWA_ASSETS + '\n</head>');
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function syncOssAssets() {
  // Reserved for future design-only asset copies (no runtime engine swaps).
}

function buildServiceWorker() {
  const templatePath = path.join(__dirname, 'sw.template.js');
  const swPath = path.join(publicDir, 'sw.js');
  const template = read(templatePath);
  fs.writeFileSync(swPath, template.replace(/__PORTAL_BUILD__/g, 'mrpark-shell-' + PORTAL_BUILD));
  console.log('built sw.js', PORTAL_BUILD);
}

function bumpPortalBuildInHtml(html) {
  return html
    .replace(/var APP_BUILD = '[^']+';/g, "var APP_BUILD = '" + PORTAL_BUILD + "';")
    .replace(/var PORTAL_BUILD = '[^']+';/g, "var PORTAL_BUILD = '" + PORTAL_BUILD + "';");
}

function injectPortalAssets(html) {
  let out = html;
  if (!out.includes('/js/messenger-ui.js')) {
    if (out.includes('/manifest.webmanifest')) {
      out = out.replace(
        '</head>',
        '<link rel="stylesheet" href="/css/messenger-ui.css">\n' +
        '<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js" defer></script>\n' +
        '<script src="https://cdn.jsdelivr.net/npm/autosize@6.0.1/dist/autosize.min.js" defer></script>\n' +
        '<script src="/js/messenger-ui.js" defer></script>\n</head>'
      );
    } else {
      out = out.replace('</head>', PORTAL_HEAD_ASSETS + '\n</head>');
    }
  }
  return out;
}

function stripGasForRailway(html) {
  return html.replace(
    /function gasScriptAvailable\(\)\s*\{\s*try\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}\s*\}/,
    'function gasScriptAvailable() { return false; }'
  );
}

function buildStudent() {
  const src = resolveRepoFile('Student.html');
  const out = path.join(publicDir, 'Student.html');
  if (!src) {
    console.warn('skip Student.html — source not found');
    return;
  }
  const spritePath = resolveRepoFile('SnailSprite.html');
  fs.writeFileSync(out, bumpPortalBuildInHtml(injectPortalAssets(inlineSnail(read(src), spritePath))));
  console.log('built', path.relative(repoRoot, out));
}

function buildTeacher() {
  syncTeacherSourceFiles();
  const src = resolveRepoFile('Index.html');
  const out = path.join(publicDir, 'Teacher.html');
  if (!src) {
    throw new Error('Index.html not found — cannot build Teacher.html');
  }

  const spritePath = resolveRepoFile('SnailSprite.html');
  let html = inlineSnail(read(src), spritePath);

  html = html.replace(
    /href="<\?!= \(nodeApiUrl \|\| ''\) \+ '(\/[^']+)' \?>"/g,
    'href="$1"'
  );

  html = html.replace(
    /const NODE_API_URL_TEMPLATE = <\?!= JSON\.stringify\(nodeApiUrl \|\| ''\) \?>;/,
    "const NODE_API_URL_TEMPLATE = '';"
  );

  html = stripGasForRailway(html);
  html = bumpPortalBuildInHtml(injectPortalAssets(html));

  fs.writeFileSync(out, html);
  console.log('built', path.relative(repoRoot, out), 'from', path.relative(repoRoot, src));
}

const ROULETTE_INIT = `document.getElementById('classSubtitle').textContent = CLASS_NAME;
        document.getElementById('spinBtn').addEventListener('click', spin);
        document.getElementById('x2Btn').addEventListener('click', duplicateX2);
        document.getElementById('resetListBtn').addEventListener('click', resetList);
        document.getElementById('addNameBtn').addEventListener('click', addEntry);
        document.getElementById('addNameInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') addEntry();
        });
        document.getElementById('removeWinnerBtn').addEventListener('click', removeWinnerFromWheel);
        document.getElementById('dismissWinnerBtn').addEventListener('click', hideWinner);
        document.getElementById('winnerOverlay').addEventListener('click', function(e) {
            if (e.target === document.getElementById('winnerOverlay')) hideWinner();
        });

        entries = buildDefaultEntries(INITIAL_STUDENTS);
        window.addEventListener('resize', resizeCanvas);
        syncSidebar();
        resizeCanvas();
        updateSpinState();`;

const ROULETTE_BOOTSTRAP = `function startRouletteApp() {
        document.getElementById('classSubtitle').textContent = CLASS_NAME;
        document.getElementById('spinBtn').addEventListener('click', spin);
        document.getElementById('x2Btn').addEventListener('click', duplicateX2);
        document.getElementById('resetListBtn').addEventListener('click', resetList);
        document.getElementById('addNameBtn').addEventListener('click', addEntry);
        document.getElementById('addNameInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') addEntry();
        });
        document.getElementById('removeWinnerBtn').addEventListener('click', removeWinnerFromWheel);
        document.getElementById('dismissWinnerBtn').addEventListener('click', hideWinner);
        document.getElementById('winnerOverlay').addEventListener('click', function(e) {
            if (e.target === document.getElementById('winnerOverlay')) hideWinner();
        });

        entries = buildDefaultEntries(INITIAL_STUDENTS);
        window.addEventListener('resize', resizeCanvas);
        syncSidebar();
        resizeCanvas();
        updateSpinState();
        }

        function bootstrapRoulette() {
            if (!CLASS_ID) { startRouletteApp(); return; }
            var api = location.origin.replace(/\\/$/, '');
            fetch(api + '/api/students?classId=' + encodeURIComponent(CLASS_ID), { credentials: 'same-origin' })
                .then(function(r) { return r.json(); })
                .then(function(list) {
                    INITIAL_STUDENTS = Array.isArray(list) ? list : [];
                    startRouletteApp();
                })
                .catch(function() { startRouletteApp(); });
        }
        bootstrapRoulette();`;

const LUCKY_DRAW_BOOTSTRAP = `function bootstrapLuckyDraw() {
            if (!CLASS_ID) {
                initStudentSelect();
                initDollarModeEasterEgg();
                loadLuckyDrawConfig();
                return;
            }
            var api = location.origin.replace(/\\/$/, '');
            fetch(api + '/api/students?classId=' + encodeURIComponent(CLASS_ID), { credentials: 'same-origin' })
                .then(function(r) { return r.json(); })
                .then(function(list) {
                    STUDENTS = Array.isArray(list) ? list : [];
                    initStudentSelect();
                    initDollarModeEasterEgg();
                    loadLuckyDrawConfig();
                })
                .catch(function() {
                    initStudentSelect();
                    initDollarModeEasterEgg();
                    loadLuckyDrawConfig();
                });
        }
        bootstrapLuckyDraw();`;

function buildTool(name, transform) {
  const src = resolveRepoFile(name + '.html');
  if (!src) {
    console.warn('skip', name + '.html — source not found');
    return;
  }
  const spritePath = resolveRepoFile('SnailSprite.html');
  let html = inlineSnail(read(src), spritePath);
  if (transform) html = transform(html);
  html = injectToolPwa(html);
  const outDir = path.join(publicDir, 'tools');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, name.toLowerCase() + '.html');
  fs.writeFileSync(out, html);
  console.log('built', path.relative(repoRoot, out));
}

function buildTools() {
  buildTool('Timer', function(html) {
    html = html.replace(
      /<div class="label-sub"><\?= label \?><\/div>/,
      '<div class="label-sub" id="timerLabelSub"></div>'
    );
    return html.replace(
      /const TOTAL = parseInt\('<\?= totalSeconds \?>', 10\) \|\| 60;/,
      `const _timerParams = new URLSearchParams(location.search);
        const _timerMin = Math.max(0, parseInt(_timerParams.get('min'), 10) || 0);
        const _timerSec = Math.max(0, Math.min(59, parseInt(_timerParams.get('sec'), 10) || 0));
        const TOTAL = Math.max(1, _timerMin * 60 + _timerSec);
        (function() {
            const el = document.getElementById('timerLabelSub');
            if (!el) return;
            el.textContent = _timerMin > 0 && _timerSec > 0
                ? (_timerMin + ' min ' + _timerSec + ' sec')
                : (_timerMin > 0 ? (_timerMin + ' min') : (_timerSec + ' sec'));
        })();`
    );
  });

  buildTool('Dice');

  buildTool('Roulette', function(html) {
    html = html.replace(
      /const CLASS_NAME = <\?!= classNameJson \?>;\s*const INITIAL_STUDENTS = <\?!= studentsJson \?>;/,
      `const _rouletteParams = new URLSearchParams(location.search);
        const CLASS_ID = _rouletteParams.get('classId') || '';
        let CLASS_NAME = _rouletteParams.get('className') || 'Class';
        let INITIAL_STUDENTS = [];`
    );
    if (!html.includes('function startRouletteApp()')) {
      html = html.replace(ROULETTE_INIT, ROULETTE_BOOTSTRAP);
    }
    return html;
  });

  buildTool('LuckyDraw', function(html) {
    const toolFetchHelper = `function toolFetch(url, opts) {
        opts = opts || {};
        opts.credentials = 'same-origin';
        var headers = opts.headers || {};
        try {
            var token = localStorage.getItem('mrpark_teacher_token') || '';
            if (token) headers.Authorization = 'Bearer ' + token;
        } catch (e) { /* ignore */ }
        opts.headers = headers;
        return fetch(url, opts);
    }
`;
    html = html.replace(
      /var CLASS_ID = <\?!= JSON\.stringify\(classId \|\| ''\) \?>;\s*var CLASS_NAME = <\?!= JSON\.stringify\(className \|\| 'Class'\) \?>;\s*var STUDENTS = <\?!= studentsJson \?>;\s*var NODE_API = <\?!= JSON\.stringify\(nodeApiUrl \|\| '[^']*'\) \?>;/,
      `var _ldParams = new URLSearchParams(location.search);
        var CLASS_ID = _ldParams.get('classId') || '';
        var CLASS_NAME = _ldParams.get('className') || 'Class';
        var STUDENTS = [];
        var NODE_API = location.origin.replace(/\\/$/, '');
` + toolFetchHelper
    );
    html = html.replace(/fetch\(NODE_API/g, 'toolFetch(NODE_API');
    return html.replace(
      /initStudentSelect\(\);\s*initDollarModeEasterEgg\(\);\s*loadLuckyDrawConfig\(\);/,
      LUCKY_DRAW_BOOTSTRAP
    );
  });
}

fs.mkdirSync(publicDir, { recursive: true });
syncOssAssets();
buildStudent();
buildTeacher();
buildTools();
buildServiceWorker();
