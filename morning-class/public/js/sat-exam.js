/* SAT practice test: modelled on the Digital SAT test screen. The server owns the clock and the answer key. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var esc = window.SatRender.esc;
  var params = new URLSearchParams(location.search);
  var role = '';
  var sid = '';

  var S = {
    data: null,
    offset: 0,
    view: 'loading',
    qi: 0,
    review: false,
    elim: false,
    pending: {},
    enteredAt: null,
    timerHidden: false,
    timerId: null,
    flushId: null,
    navOpen: false,
    dirOpen: false,
    moreOpen: false,
    submitting: false,
    timeUpShown: false,
    saveBad: false,
    hl: {},
    notes: {}
  };
  var calc = { win: null, obj: null, loading: false };
  var ref = { win: null };
  var notesWin = null;

  // ------------------------------------------------------------ helpers

  function icon(name, cls) {
    var paths = {
      flag: '<path d="M6 21V4h11l-2 4 2 4H6"/>',
      calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0"/>',
      book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 7h6"/>',
      pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
      more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
      down: '<path d="M6 9l6 6 6-6"/>',
      up: '<path d="M6 15l6-6 6 6"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
      check: '<path d="M5 12l5 5 9-10"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
      help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h0"/>',
      list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0"/>'
    };
    return '<svg class="i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  function tex(s, display) {
    try {
      return window.katex.renderToString(s, { displayMode: !!display, throwOnError: false, strict: 'ignore' });
    } catch (e) { return esc(s); }
  }

  function fmtClock(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  function now() { return Date.now() + S.offset; }
  function remaining() { return S.data && S.data.session.stepDeadline ? S.data.session.stepDeadline - now() : 0; }

  function api(path, opts) {
    return window.SaltApp.api('/api/sat-exam' + path, opts || {}, role);
  }

  function token() { return window.SaltApp.getToken(role); }

  function fmtDate(ms) {
    return new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Seoul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function detectRole() {
    var order = params.get('preview') ? ['teacher', 'admin', 'principal', 'staff', 'student'] : ['student', 'teacher', 'admin', 'principal', 'staff'];
    for (var i = 0; i < order.length; i++) if (window.SaltApp.getToken(order[i])) return order[i];
    return '';
  }

  function homeUrl() { return role === 'student' ? '/student.html' : '/teacher.html'; }

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full */ } }

  // -------------------------------------------------------------- state

  function questions() { return S.data && S.data.module ? S.data.module.questions : []; }
  function cur() { return questions()[S.qi]; }
  function ans(qid) {
    var a = S.data.answers[qid];
    if (!a) { a = S.data.answers[qid] = { answer: '', marked: false, eliminated: [] }; }
    return a;
  }

  function applyState(d, sentAt) {
    var prevStep = S.data && S.data.session.step;
    S.data = d;
    S.offset = d.session.serverNow - (sentAt + Date.now()) / 2;
    var step = d.session.step;
    if (step === 'done') S.view = 'done';
    else if (step === 'break') S.view = 'break';
    else if (d.module && d.session.started) S.view = 'module';
    else S.view = 'intro';
    if (step !== prevStep || S.view !== 'module') {
      S.qi = 0;
      S.review = false;
      S.navOpen = S.dirOpen = S.moreOpen = false;
      S.timeUpShown = false;
      if (S.view === 'module') {
        var saved = parseInt(sessionStorage.getItem('satq:' + sid + ':' + step) || '0', 10);
        if (saved >= 0 && saved < d.module.questions.length) S.qi = saved;
      }
    }
    S.hl = lsGet('sathl:' + sid) || {};
    S.notes = lsGet('satnotes:' + sid) || {};
    render();
  }

  async function refresh() {
    var t0 = Date.now();
    var d = await api('/sessions/' + encodeURIComponent(sid));
    applyState(d, t0);
  }

  // ------------------------------------------------------ saving answers

  function queue(qid, patch) {
    var p = S.pending[qid] || (S.pending[qid] = {});
    Object.keys(patch).forEach(function (k) {
      if (k === 'spentMs') p.spentMs = (p.spentMs || 0) + patch[k];
      else p[k] = patch[k];
    });
    setSaveState('Saving…');
  }

  function setSaveState(text, bad) {
    var el = document.getElementById('saveState');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  function commitSpent() {
    var q = cur();
    if (!q || S.enteredAt == null || S.view !== 'module' || S.review) { S.enteredAt = null; return; }
    var spent = Math.min(Date.now() - S.enteredAt, 10 * 60 * 1000);
    S.enteredAt = Date.now();
    if (spent > 0) queue(q.id, { spentMs: spent });
  }

  function takePending() {
    var items = Object.keys(S.pending).map(function (qid) { return Object.assign({ questionId: qid }, S.pending[qid]); });
    S.pending = {};
    return items;
  }

  function putBack(items) {
    items.forEach(function (it) {
      var qid = it.questionId;
      var rest = Object.assign({}, it);
      delete rest.questionId;
      var p = S.pending[qid] || (S.pending[qid] = {});
      Object.keys(rest).forEach(function (k) {
        if (k === 'spentMs') p.spentMs = (p.spentMs || 0) + rest[k];
        else if (p[k] === undefined) p[k] = rest[k];
      });
    });
  }

  async function flush() {
    if (S.view !== 'module' || S.submitting) return;
    commitSpent();
    var items = takePending();
    if (!items.length) { if (!S.saveBad) setSaveState('Saved'); return; }
    try {
      await api('/sessions/' + encodeURIComponent(sid) + '/save', { method: 'POST', body: { items: items } });
      S.saveBad = false;
      setSaveState('Saved');
    } catch (e) {
      putBack(items);
      S.saveBad = true;
      setSaveState('Not saved — check your connection', true);
    }
  }

  function snapshotItems() {
    commitSpent();
    var spent = S.pending;
    S.pending = {};
    return questions().map(function (q) {
      var a = ans(q.id);
      return { questionId: q.id, answer: a.answer, marked: !!a.marked, eliminated: a.eliminated || [], spentMs: (spent[q.id] && spent[q.id].spentMs) || 0 };
    });
  }

  // ---------------------------------------------------------- rendering

  function render() {
    clearInterval(S.timerId);
    clearInterval(S.flushId);
    S.timerId = S.flushId = null;
    if (S.view === 'module') return renderModule();
    closeWindows();
    if (S.view === 'intro') return renderIntro();
    if (S.view === 'break') return renderBreak();
    if (S.view === 'done') return renderDone();
    app.innerHTML = '<div class="screen"><div class="sheet center"><p>Loading…</p></div></div>';
  }

  function previewBar() {
    return S.data && S.data.session.isPreview
      ? '<div class="preview-bar">Teacher preview — this run is not counted in any student’s record.</div>'
      : '';
  }

  function errorScreen(msg) {
    closeWindows();
    app.innerHTML = '<div class="screen"><div class="sheet center"><div class="brand" style="justify-content:center"><span class="logo">S</span>Salt Academy</div>' +
      '<h1>We couldn’t open this test</h1><p class="sub">' + esc(msg) + '</p>' +
      '<a class="btn" style="display:inline-block;text-decoration:none" href="' + homeUrl() + '">Back to home</a></div></div>';
  }

  function modsTable(curStep) {
    var rows = (S.data.overview || []).map(function (m) {
      var name = m.kind === 'break' ? 'Break' : m.title;
      var detail = m.kind === 'break' ? '' : m.count;
      return '<tr class="' + (m.step === curStep ? 'cur' : '') + '"><td>' + esc(name) + '</td><td class="num">' + detail + '</td><td class="num">' + m.minutes + ' min</td></tr>';
    }).join('');
    return '<table class="mods"><thead><tr><th>Part</th><th style="text-align:right">Questions</th><th style="text-align:right">Time</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderIntro() {
    var d = S.data;
    var info = d.info;
    var first = info.step === 'rw1';
    var lateNote = d.session.dueAt && !d.session.isPreview
      ? '<div class="note">Due ' + esc(fmtDate(d.session.dueAt)) + ' (KST). Once you start, the timer keeps running even if you close this page.</div>' : '';
    var rules = first
      ? '<ul class="rules">' +
        '<li>' + icon('clock') + '<span>Each module has its own timer. The clock runs on our server, so closing the page or losing your connection does <b>not</b> pause it.</span></li>' +
        '<li>' + icon('save') + '<span>Your answers are saved as you go. When you submit a module — or when time runs out — you can’t go back to it.</span></li>' +
        '<li>' + icon('calc') + '<span>In the Math sections you can use the built-in Desmos graphing calculator and the reference sheet.</span></li>' +
        '<li>' + icon('flag') + '<span>Use <b>Mark for Review</b> to flag a question and the question number button at the bottom to move around the module.</span></li>' +
        '<li>' + icon('list') + '<span>Take it on a laptop or tablet in a quiet place. 시험 중에는 다른 창이나 자료를 보지 마세요.</span></li>' +
        '</ul>'
      : '<ul class="rules">' +
        '<li>' + icon('clock') + '<span>The timer for this module starts when you press the button below.</span></li>' +
        '<li>' + icon('save') + '<span>You can’t return to earlier modules.</span></li>' +
        '</ul>';
    var btn = first ? 'Start Test' : 'Start ' + info.title.split(': ')[0];
    app.innerHTML = previewBar() +
      '<div class="screen"><div class="sheet">' +
      '<div class="brand"><span class="logo">S</span>Salt Academy · SAT Practice Test</div>' +
      '<h1>' + (first ? esc(d.session.setName) : esc(info.title)) + '</h1>' +
      '<div class="sub">' + (first ? 'Hello, ' + esc(d.session.studentName) + '. Here is how the test works.' :
        info.count + ' questions · ' + info.minutes + ' minutes') + '</div>' +
      (first ? modsTable(info.step) : '') + lateNote + rules +
      '<div class="center"><button class="btn big" id="startBtn">' + esc(btn) + '</button></div>' +
      '<p class="fine center"><a href="' + homeUrl() + '">Leave for now</a></p>' +
      '</div></div>';
    document.getElementById('startBtn').onclick = function () { startStep(this, info.step); };
  }

  async function startStep(btn, step) {
    if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
    try {
      var t0 = Date.now();
      var d = await api('/sessions/' + encodeURIComponent(sid) + '/start-step', { method: 'POST', body: { step: step } });
      applyState(d, t0);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
      toast(e.message || 'Could not start. Please try again.');
    }
  }

  function renderBreak() {
    var d = S.data;
    if (!d.session.started) {
      app.innerHTML = '<div class="screen"><div class="sheet center"><p>Starting your break…</p></div></div>';
      startStep(null, 'break');
      return;
    }
    var next = d.next;
    app.innerHTML = previewBar() +
      '<div class="screen"><div class="sheet center">' +
      '<div class="brand" style="justify-content:center"><span class="logo">S</span>Salt Academy · SAT Practice Test</div>' +
      '<h1>Practice Test Break</h1>' +
      '<div class="sub">Section 1 is complete. Take a short rest.</div>' +
      '<div class="break-clock" id="breakClock">--:--</div>' +
      '<p class="fine" style="margin-top:0">Remaining break time</p>' +
      '<div class="note" style="text-align:left;max-width:560px;margin:22px auto">Next: <b>' + esc(next ? next.title : 'Section 2') + '</b> — ' +
      (next ? next.count + ' questions, ' + next.minutes + ' minutes' : '') + '. When the break ends, you can start the module whenever you are ready; its own timer begins only when you press Start.</div>' +
      '<button class="btn big" id="resumeBtn">Resume Testing</button>' +
      '</div></div>';
    document.getElementById('resumeBtn').onclick = function () {
      this.disabled = true;
      startStep(this, 'break');
    };
    var tick = function () {
      var el = document.getElementById('breakClock');
      if (!el) return;
      var left = remaining();
      el.textContent = fmtClock(left);
      if (left <= 0) { clearInterval(S.timerId); refresh().catch(function () {}); }
    };
    tick();
    S.timerId = setInterval(tick, 500);
  }

  // ---------------------------------------------------------- module UI

  function sectionKind() { return S.data.module.section; }

  function renderModule() {
    var d = S.data;
    var isMath = sectionKind() === 'math';
    var tools = isMath
      ? '<button class="tool" id="calcBtn" aria-pressed="false">' + icon('calc') + 'Calculator</button>' +
        '<button class="tool" id="refBtn" aria-pressed="false">' + icon('book') + 'Reference</button>'
      : '<button class="tool" id="notesBtn">' + icon('pen') + 'Highlights &amp; Notes</button>';
    app.innerHTML =
      '<div class="exam">' + previewBar() +
      '<header class="hdr">' +
      '<div class="left"><div class="title">' + esc(d.module.title) + '</div>' +
      '<button class="dir-btn" id="dirBtn" aria-expanded="false">Directions ' + icon('down', 'sm') + '</button></div>' +
      '<div class="timer"><div class="t" id="timeText">--:--</div><button class="hide-btn" id="hideBtn">Hide</button></div>' +
      '<div class="tools">' + tools +
      '<button class="tool" id="moreBtn" aria-expanded="false">' + icon('more') + 'More</button></div>' +
      '</header><div class="stripe"></div>' +
      '<main class="work" id="work"></main>' +
      '<div class="stripe thin"></div>' +
      '<footer class="ftr"><div class="who">' + icon('user') + '<span>' + esc(d.session.studentName) + '</span><span class="save-state" id="saveState">Saved</span></div>' +
      '<div id="centerBtn"></div><div class="btns" id="navBtns"></div></footer>' +
      '</div>';
    document.getElementById('dirBtn').onclick = toggleDirections;
    document.getElementById('hideBtn').onclick = toggleTimer;
    document.getElementById('moreBtn').onclick = toggleMore;
    var nb = document.getElementById('notesBtn');
    if (nb) nb.onclick = openNotes;
    var cb = document.getElementById('calcBtn');
    if (cb) cb.onclick = toggleCalc;
    var rb = document.getElementById('refBtn');
    if (rb) rb.onclick = toggleRef;
    renderWork();
    if (window.innerWidth < 560 && !sessionStorage.getItem('satsmall')) {
      sessionStorage.setItem('satsmall', '1');
      toast('The test works best on a laptop or tablet. Try turning your phone sideways.');
    }
    updateTimer(true);
    S.timerId = setInterval(updateTimer, 250);
    S.flushId = setInterval(flush, 4000);
  }

  function updateTimer(first) {
    if (S.view !== 'module') return;
    var left = remaining();
    var el = document.getElementById('timeText');
    if (!el) return;
    if (S.timerHidden) {
      el.textContent = 'Timer hidden';
      el.className = 't off';
    } else {
      el.textContent = fmtClock(left);
      el.className = 't' + (left <= 60000 ? ' warn' : '');
    }
    if (!first && left <= 300000 && left > 295000 && !S.fiveShown) {
      S.fiveShown = true;
      toast('5 minutes remaining in this module');
    }
    if (left <= 0 && !S.timeUpShown) timeUp();
  }

  function toggleTimer() {
    S.timerHidden = !S.timerHidden;
    document.getElementById('hideBtn').textContent = S.timerHidden ? 'Show' : 'Hide';
    updateTimer(true);
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3800);
  }

  function rich(text) {
    var assets = (cur() && cur().assets) || {};
    return window.SatRender.html(text, {
      figureUrl: function (r) {
        var id = assets[r];
        return id ? '/api/sat-exam/sessions/' + encodeURIComponent(sid) + '/assets/' + encodeURIComponent(id) + '?access_token=' + encodeURIComponent(token()) : '';
      }
    });
  }

  function renderWork() {
    var work = document.getElementById('work');
    if (!work) return;
    closePops(true);
    if (S.review) renderReview(work); else renderQuestion(work);
    renderFooter();
  }

  function renderQuestion(work) {
    var q = cur();
    var a = ans(q.id);
    var isRW = sectionKind() === 'rw';
    var head =
      '<div class="q-head"><div class="q-num">' + (S.qi + 1) + '</div>' +
      '<button class="mark-btn' + (a.marked ? ' on' : '') + '" id="markBtn" aria-pressed="' + !!a.marked + '">' + icon('flag', 'sm') + 'Mark for Review</button>' +
      (q.qtype === 'mcq' ? '<button class="elim-toggle" id="elimBtn" aria-pressed="' + S.elim + '" title="Cross out answer choices">ABC</button>' : '') +
      '</div>';
    var leftHtml = '';
    var rightTop = '';
    if (isRW) {
      leftHtml = q.passage ? '<div class="passage sat-rich" id="hlRoot">' + (S.hl[q.id] || rich(q.passage)) + '</div>' : '';
      rightTop = '<div class="stem sat-rich">' + rich(q.stem) + '</div>';
    } else {
      leftHtml = '<div class="stem sat-rich" style="margin-top:0">' + (q.passage ? rich(q.passage) + '<br>' : '') + rich(q.stem) + '</div>';
    }
    var body = q.qtype === 'spr' ? sprHtml(q, a) : choicesHtml(q, a);
    var right = '<section class="pane right" id="rightPane">' + head + rightTop + body + '</section>';
    if (leftHtml) {
      var split = parseFloat(localStorage.getItem('satsplit') || '50');
      work.innerHTML = '<section class="pane left" id="leftPane" style="--split:' + split + '%">' + leftHtml + '</section>' +
        '<div class="divider" id="divider" role="separator" aria-orientation="vertical" tabindex="0"></div>' + right;
      initDivider();
    } else {
      work.innerHTML = '<section class="pane right solo" id="rightPane" style="margin:0 auto">' + head.replace('class="q-head"', 'class="q-head" style="margin-left:-40px;margin-right:-40px"') + rightTop + body + '</section>';
    }
    bindQuestion(q);
  }

  function choicesHtml(q, a) {
    var elim = a.eliminated || [];
    return '<ul class="choices" role="radiogroup" aria-label="Answer choices">' + q.choices.map(function (c) {
      var gone = elim.indexOf(c.label) >= 0;
      var sel = a.answer === c.label;
      return '<li class="choice-row">' +
        '<button class="choice' + (sel ? ' sel' : '') + (gone ? ' gone' : '') + '" role="radio" aria-checked="' + sel + '" data-pick="' + c.label + '">' +
        '<span class="letter">' + c.label + '</span><span class="ctext sat-rich">' + rich(c.text) + '</span></button>' +
        (S.elim ? '<button class="elim-x" data-elim="' + c.label + '" aria-label="' + (gone ? 'Undo cross-out of ' : 'Cross out ') + c.label + '">' + (gone ? 'Undo' : '✕') + '</button>' : '') +
        '</li>';
    }).join('') + '</ul>';
  }

  function sprPreview(v) {
    if (!v) return '';
    var m = v.match(/^(-?)(\d+)\/(\d+)$/);
    if (m) return tex((m[1] ? '-' : '') + '\\frac{' + m[2] + '}{' + m[3] + '}');
    return esc(v);
  }

  function sprHtml(q, a) {
    return '<div class="spr-box"><label for="sprInput">Enter your answer</label>' +
      '<input id="sprInput" type="text" inputmode="decimal" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(a.answer) + '" aria-describedby="sprNote">' +
      '<div class="spr-preview"><div class="cap">Answer Preview:</div><div class="val" id="sprVal">' + sprPreview(a.answer) + '</div></div>' +
      '<p class="spr-note" id="sprNote">Up to 5 characters (6 if negative). Use <b>/</b> for fractions. Don’t enter symbols such as %, commas, or $.</p></div>';
  }

  function cleanSpr(v) {
    var t = String(v || '').replace(/[\u2212\u2013\u2014]/g, '-').replace(/[^0-9./-]/g, '');
    var neg = t.charAt(0) === '-';
    return (neg ? '-' : '') + t.replace(/-/g, '').slice(0, 5);
  }

  function bindQuestion(q) {
    var a = ans(q.id);
    var mark = document.getElementById('markBtn');
    mark.onclick = function () {
      a.marked = !a.marked;
      mark.classList.toggle('on', a.marked);
      mark.setAttribute('aria-pressed', a.marked);
      queue(q.id, { marked: a.marked });
      renderFooter();
    };
    var eb = document.getElementById('elimBtn');
    if (eb) eb.onclick = function () { S.elim = !S.elim; renderQuestion(document.getElementById('work')); };
    var work = document.getElementById('work');
    work.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () {
        var letter = b.getAttribute('data-pick');
        if ((a.eliminated || []).indexOf(letter) >= 0) return;
        a.answer = letter;
        queue(q.id, { answer: letter });
        work.querySelectorAll('[data-pick]').forEach(function (x) {
          var on = x.getAttribute('data-pick') === letter;
          x.classList.toggle('sel', on);
          x.setAttribute('aria-checked', on);
        });
        renderFooter();
      };
    });
    work.querySelectorAll('[data-elim]').forEach(function (b) {
      b.onclick = function () {
        var letter = b.getAttribute('data-elim');
        var list = (a.eliminated || []).slice();
        var i = list.indexOf(letter);
        if (i >= 0) list.splice(i, 1); else list.push(letter);
        a.eliminated = list;
        if (a.answer === letter && i < 0) { a.answer = ''; queue(q.id, { answer: '' }); }
        queue(q.id, { eliminated: list });
        renderQuestion(work);
      };
    });
    var inp = document.getElementById('sprInput');
    if (inp) {
      inp.oninput = function () {
        var v = cleanSpr(inp.value);
        if (v !== inp.value) inp.value = v;
        a.answer = v;
        document.getElementById('sprVal').innerHTML = sprPreview(v);
        queue(q.id, { answer: v });
      };
    }
    S.enteredAt = document.hidden ? null : Date.now();
  }

  function initDivider() {
    var dv = document.getElementById('divider');
    var left = document.getElementById('leftPane');
    if (!dv || !left) return;
    var drag = function (clientX) {
      var box = document.getElementById('work').getBoundingClientRect();
      var pct = Math.max(25, Math.min(75, ((clientX - box.left) / box.width) * 100));
      left.style.setProperty('--split', pct + '%');
      localStorage.setItem('satsplit', String(pct.toFixed(1)));
    };
    dv.addEventListener('pointerdown', function (e) {
      dv.setPointerCapture(e.pointerId);
      dv.classList.add('drag');
      document.body.style.userSelect = 'none';
    });
    dv.addEventListener('pointermove', function (e) { if (dv.classList.contains('drag')) drag(e.clientX); });
    var stop = function () { dv.classList.remove('drag'); document.body.style.userSelect = ''; };
    dv.addEventListener('pointerup', stop);
    dv.addEventListener('pointercancel', stop);
  }

  function qStatus(q) {
    var a = ans(q.id);
    return { done: !!a.answer, marked: !!a.marked };
  }

  function renderFooter() {
    var qs = questions();
    var last = S.qi === qs.length - 1;
    var center = document.getElementById('centerBtn');
    var btns = document.getElementById('navBtns');
    if (!center || !btns) return;
    if (S.review) {
      center.innerHTML = '';
      btns.innerHTML = '<button class="btn ghost" id="backBtn">Back</button><button class="btn" id="nextBtn">Next</button>';
      document.getElementById('backBtn').onclick = function () { goto(qs.length - 1); };
      document.getElementById('nextBtn').onclick = confirmSubmit;
      return;
    }
    center.innerHTML = '<button class="nav-pill" id="navPill" aria-expanded="' + S.navOpen + '" aria-haspopup="dialog">Question ' + (S.qi + 1) + ' of ' + qs.length + ' ' + icon('up', 'sm') + '</button>';
    document.getElementById('navPill').onclick = toggleNav;
    btns.innerHTML = (S.qi > 0 ? '<button class="btn" id="backBtn">Back</button>' : '') + '<button class="btn" id="nextBtn">Next</button>';
    var back = document.getElementById('backBtn');
    if (back) back.onclick = function () { goto(S.qi - 1); };
    document.getElementById('nextBtn').onclick = function () { if (last) showReview(); else goto(S.qi + 1); };
    if (S.navOpen) renderNavPop();
  }

  function goto(i) {
    commitSpent();
    S.review = false;
    S.qi = Math.max(0, Math.min(questions().length - 1, i));
    sessionStorage.setItem('satq:' + sid + ':' + S.data.session.step, String(S.qi));
    S.navOpen = false;
    renderWork();
    flush();
    var pane = document.getElementById('rightPane');
    if (pane) pane.scrollTop = 0;
  }

  function showReview() {
    commitSpent();
    S.enteredAt = null;
    S.review = true;
    S.navOpen = false;
    renderWork();
    flush();
  }

  function gridHtml(withCurrent) {
    return '<div class="grid">' + questions().map(function (q, i) {
      var st = qStatus(q);
      return '<button class="cell' + (st.done ? ' done' : '') + (withCurrent && i === S.qi && !S.review ? ' cur' : '') + '" data-go="' + i + '" aria-label="Question ' + (i + 1) +
        (st.done ? ', answered' : ', unanswered') + (st.marked ? ', marked for review' : '') + '">' + (i + 1) +
        (st.marked ? icon('flag', 'flag') : '') + '</button>';
    }).join('') + '</div>';
  }

  function legendHtml() {
    return '<div class="legend"><span><span class="cell done"></span>Answered</span><span><span class="cell"></span>Unanswered</span>' +
      '<span>' + icon('flag', 'sm').replace('class="i sm"', 'class="i sm" style="color:#c62828;fill:#c62828"') + 'For Review</span></div>';
  }

  function toggleNav() { S.navOpen = !S.navOpen; closePops(false, 'nav'); renderFooter(); }

  function renderNavPop() {
    var old = document.getElementById('navPop');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'pop nav-pop';
    el.id = 'navPop';
    el.setAttribute('role', 'dialog');
    el.innerHTML = '<h3>' + esc(S.data.module.title) + ' Questions</h3>' + legendHtml() + gridHtml(true) +
      '<button class="btn ghost go" id="goReview">Go to Review Page</button>';
    document.body.appendChild(el);
    el.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { goto(parseInt(b.getAttribute('data-go'), 10)); }; });
    document.getElementById('goReview').onclick = showReview;
  }

  function renderReview(work) {
    var qs = questions();
    var un = qs.filter(function (q) { return !qStatus(q).done; }).length;
    var mk = qs.filter(function (q) { return qStatus(q).marked; }).length;
    work.innerHTML = '<div class="review" style="flex:1;overflow:auto"><h2>Check Your Work</h2>' +
      '<p>On test day, you won’t be able to move on to the next module until time expires.<br>For these practice questions, you can submit the module whenever you’re ready.</p>' +
      '<div class="panel"><h3>' + esc(S.data.module.title) + ' Questions</h3>' + legendHtml() + gridHtml(false) + '</div>' +
      '<p style="margin-top:18px">' + (un ? '<b style="color:#c62828">' + un + ' unanswered</b>' : 'All questions answered') + (mk ? ' · ' + mk + ' marked for review' : '') + '</p></div>';
    work.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { goto(parseInt(b.getAttribute('data-go'), 10)); }; });
  }

  // ------------------------------------------------------- submit / time

  function confirmSubmit() {
    var qs = questions();
    var un = qs.filter(function (q) { return !qStatus(q).done; }).length;
    dialog('Submit this module?',
      (un ? '<b>' + un + ' question' + (un > 1 ? 's are' : ' is') + ' unanswered.</b> ' : '') +
      'After you submit, you can’t return to this module.',
      [{ text: 'Keep working', ghost: true }, { text: 'Submit', danger: !!un, run: submit }]);
  }

  async function submit() {
    if (S.submitting) return;
    S.submitting = true;
    var step = S.data.session.step;
    var items = snapshotItems();
    showBusy('Submitting your answers…');
    for (var attempt = 0; attempt < 4; attempt++) {
      try {
        var t0 = Date.now();
        var d = await api('/sessions/' + encodeURIComponent(sid) + '/submit', { method: 'POST', body: { items: items, step: step } });
        S.submitting = false;
        S.pending = {};
        hideBusy();
        applyState(d, t0);
        return;
      } catch (e) {
        await new Promise(function (r) { setTimeout(r, 1500 * (attempt + 1)); });
      }
    }
    S.submitting = false;
    hideBusy();
    dialog('Connection problem', 'We couldn’t reach the server. Your answers are still on this screen. Check your connection and try again.',
      [{ text: 'Try again', run: function () { S.pending = {}; submit(); } }]);
  }

  function timeUp() {
    S.timeUpShown = true;
    closePops(true);
    dialog('Time’s up', 'Time for this module has ended. Your answers are being submitted.', [], true);
    submit();
  }

  function dialog(title, html, buttons, locked) {
    hideBusy();
    var wrap = document.createElement('div');
    wrap.className = 'scrim';
    wrap.id = 'dlg';
    wrap.innerHTML = '<div class="dialog" role="alertdialog" aria-modal="true"><h2>' + esc(title) + '</h2><p>' + html + '</p><div class="row">' +
      buttons.map(function (b, i) { return '<button class="btn' + (b.ghost ? ' ghost' : '') + (b.danger ? ' danger' : '') + '" data-i="' + i + '">' + esc(b.text) + '</button>'; }).join('') +
      '</div></div>';
    document.body.appendChild(wrap);
    wrap.querySelectorAll('button').forEach(function (btn) {
      btn.onclick = function () {
        var b = buttons[parseInt(btn.getAttribute('data-i'), 10)];
        wrap.remove();
        if (b.run) b.run();
      };
    });
    if (!locked) wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    var first = wrap.querySelector('button');
    if (first) first.focus();
  }

  function showBusy(text) {
    var old = document.getElementById('dlg');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'scrim';
    el.id = 'busy';
    el.innerHTML = '<div class="dialog" style="text-align:center"><h2>' + esc(text) + '</h2><p>Please wait.</p></div>';
    document.body.appendChild(el);
  }
  function hideBusy() { var b = document.getElementById('busy'); if (b) b.remove(); }

  // --------------------------------------------------- popovers & tools

  function closePops(all, except) {
    if (except !== 'nav') { var n = document.getElementById('navPop'); if (n) n.remove(); if (all) S.navOpen = false; }
    if (all || except === 'nav') {
      var d = document.getElementById('dirPop'); if (d) d.remove();
      var m = document.getElementById('morePop'); if (m) m.remove();
      S.dirOpen = S.moreOpen = false;
      var db = document.getElementById('dirBtn'); if (db) db.setAttribute('aria-expanded', 'false');
    }
    var tip = document.getElementById('selTip'); if (tip) tip.remove();
  }

  function closeWindows() {
    closePops(true);
    [calc.win, ref.win, notesWin].forEach(function (w) { if (w) w.remove(); });
    calc.win = ref.win = notesWin = null;
    calc.obj = null;
  }

  var DIRECTIONS = {
    rw: '<h3>Reading and Writing — Directions</h3>' +
      '<p>The questions in this section address a number of important reading and writing skills. Each question includes one or more passages, which may include a table or graph. Read each passage and question carefully, and then choose the best answer to the question based on the passage(s).</p>' +
      '<p>All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.</p>',
    math: '<h3>Math — Directions</h3>' +
      '<p>The questions in this section address a number of important math skills. Use of a calculator is permitted for all questions. A reference sheet, calculator, and these directions can be accessed throughout the test.</p>' +
      '<p>Unless otherwise indicated:</p><ul><li>All variables and expressions represent real numbers.</li><li>Figures provided are drawn to scale.</li><li>All figures lie in a plane.</li>' +
      '<li>The domain of a given function <i>f</i> is the set of all real numbers <i>x</i> for which <i>f</i>(<i>x</i>) is a real number.</li></ul>' +
      '<p>For multiple-choice questions, solve each problem, choose the best answer from the choices provided, and then mark your answer.</p>' +
      '<p>For student-produced response questions, solve each problem and enter your answer as described below.</p>' +
      '<ul><li>If you find <b>more than one correct answer</b>, enter only one answer.</li>' +
      '<li>You can enter up to 5 characters for a <b>positive</b> answer and up to 6 characters (including the negative sign) for a <b>negative</b> answer.</li>' +
      '<li>If your answer is a <b>fraction</b> that doesn’t fit in the provided space, enter the decimal equivalent.</li>' +
      '<li>If your answer is a <b>decimal</b> that doesn’t fit in the provided space, enter it by truncating or rounding at the fourth digit.</li>' +
      '<li>If your answer is a <b>mixed number</b> (such as 3 1/2), enter it as an improper fraction (7/2) or its decimal equivalent (3.5).</li>' +
      '<li>Don’t enter <b>symbols</b> such as a percent sign, comma, or dollar sign.</li></ul>'
  };

  function toggleDirections() {
    closePops(false, 'nav');
    var open = !!document.getElementById('dirPop');
    var old = document.getElementById('dirPop'); if (old) old.remove();
    var btn = document.getElementById('dirBtn');
    if (open) { btn.setAttribute('aria-expanded', 'false'); return; }
    var el = document.createElement('div');
    el.className = 'pop dir-pop';
    el.id = 'dirPop';
    el.innerHTML = DIRECTIONS[sectionKind()] + '<div style="text-align:right"><button class="btn ghost" id="dirClose">Close</button></div>';
    document.body.appendChild(el);
    btn.setAttribute('aria-expanded', 'true');
    document.getElementById('dirClose').onclick = toggleDirections;
  }

  function toggleMore() {
    var old = document.getElementById('morePop');
    closePops(false, 'nav');
    if (old) return;
    var el = document.createElement('div');
    el.className = 'pop more-menu';
    el.id = 'morePop';
    el.innerHTML = '<button id="mHelp">' + icon('help', 'sm') + 'Help</button><button id="mExit">' + icon('save', 'sm') + 'Save &amp; exit</button>';
    document.body.appendChild(el);
    document.getElementById('mHelp').onclick = function () { el.remove(); showHelp(); };
    document.getElementById('mExit').onclick = function () {
      el.remove();
      dialog('Leave the test?', 'Your answers are saved, but <b>the timer keeps running</b>. You can come back from your home page until time runs out.',
        [{ text: 'Keep testing', ghost: true }, { text: 'Save & exit', run: function () { flush().then(function () { location.href = homeUrl(); }); } }]);
    };
  }

  function showHelp() {
    var wrap = document.createElement('div');
    wrap.className = 'scrim';
    wrap.innerHTML = '<div class="dialog help-card"><h2>Test tools</h2>' +
      '<ul style="line-height:1.8;color:#334155;padding-left:20px;margin:0 0 6px">' +
      '<li><b>Mark for Review</b> flags a question so you can find it on the Check Your Work page.</li>' +
      '<li><b>ABC</b> lets you cross out answer choices you want to rule out. Click <b>Undo</b> to bring one back.</li>' +
      '<li>The <b>question number</b> button at the bottom opens a map of the module.</li>' +
      '<li><b>Highlights &amp; Notes</b> (Reading and Writing): select text in a passage to highlight it. Click a highlight to remove it.</li>' +
      '<li><b>Calculator</b> and <b>Reference</b> (Math): drag the title bar to move them; drag the bottom-right corner to resize.</li>' +
      '<li>Drag the vertical bar between the two panels to change how much room each gets.</li></ul>' +
      '<div class="row"><button class="btn" id="helpClose">Close</button></div></div>';
    document.body.appendChild(wrap);
    wrap.querySelector('#helpClose').onclick = function () { wrap.remove(); };
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
  }

  // ---- floating windows

  function makeWindow(id, title, body, opts) {
    var el = document.createElement('div');
    el.className = 'float' + (opts.resizable ? ' resizable' : '');
    el.id = id;
    el.style.width = opts.w + 'px';
    el.style.height = opts.h + 'px';
    el.style.left = (opts.left != null ? opts.left : Math.max(8, window.innerWidth - opts.w - 28)) + 'px';
    el.style.top = (opts.top != null ? opts.top : 86) + 'px';
    el.innerHTML = '<div class="fh"><span>' + esc(title) + '</span><span class="sp"></span><button aria-label="Close">×</button></div><div class="fb">' + body + '</div>';
    document.body.appendChild(el);
    var fh = el.querySelector('.fh');
    fh.addEventListener('pointerdown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      var sx = e.clientX - el.offsetLeft;
      var sy = e.clientY - el.offsetTop;
      fh.setPointerCapture(e.pointerId);
      var move = function (ev) {
        el.style.left = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - sx)) + 'px';
        el.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - sy)) + 'px';
      };
      var up = function () { fh.removeEventListener('pointermove', move); fh.removeEventListener('pointerup', up); };
      fh.addEventListener('pointermove', move);
      fh.addEventListener('pointerup', up);
    });
    el.querySelector('.fh button').onclick = function () { opts.onClose(); };
    return el;
  }

  function setPressed(id, on) {
    var b = document.getElementById(id);
    if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  }

  function toggleCalc() {
    if (calc.win) {
      var hidden = calc.win.classList.toggle('hidden');
      setPressed('calcBtn', !hidden);
      if (!hidden && calc.obj) calc.obj.resize();
      return;
    }
    calc.win = makeWindow('calcWin', 'Calculator', '<div id="calcMount"></div>', {
      w: 440, h: 540, resizable: true,
      onClose: function () { calc.win.classList.add('hidden'); setPressed('calcBtn', false); }
    });
    setPressed('calcBtn', true);
    loadDesmos();
    if (window.ResizeObserver) new ResizeObserver(function () { if (calc.obj) calc.obj.resize(); }).observe(calc.win);
  }

  function loadDesmos() {
    var mount = document.getElementById('calcMount');
    var fallback = function () {
      mount.innerHTML = '<div class="calc-fallback"><b>The built-in calculator couldn’t load.</b><br>You can use the Desmos test-mode calculator in a new window instead — it works the same way and keeps its own state.<br><br>' +
        '<a class="btn" style="display:inline-block;text-decoration:none" target="_blank" rel="noopener" href="https://www.desmos.com/testing/collegeboard/graphing">Open Desmos calculator</a></div>';
    };
    var start = function () {
      try {
        calc.obj = window.Desmos.GraphingCalculator(mount, { keypad: true, expressions: true, settingsMenu: true, zoomButtons: true, border: false, lockViewport: false });
      } catch (e) { fallback(); }
    };
    if (window.Desmos) return start();
    var timer = setTimeout(fallback, 12000);
    var s = document.createElement('script');
    s.src = 'https://www.desmos.com/api/v1.9/calculator.js?apiKey=' + encodeURIComponent(S.data.config.desmosKey || '');
    s.onload = function () { clearTimeout(timer); if (window.Desmos) start(); else fallback(); };
    s.onerror = function () { clearTimeout(timer); fallback(); };
    document.head.appendChild(s);
  }

  var REF_FIGS = [
    ['<svg viewBox="0 0 120 110" width="120"><circle cx="60" cy="55" r="42" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><line x1="60" y1="55" x2="102" y2="55" stroke="#0f172a" stroke-width="1.6"/><circle cx="60" cy="55" r="2" fill="#0f172a"/><text x="76" y="49" font-size="13" font-style="italic">r</text></svg>', 'A = \\pi r^2 \\qquad C = 2\\pi r'],
    ['<svg viewBox="0 0 130 90" width="130"><rect x="14" y="14" width="102" height="56" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><text x="60" y="84" font-size="13" font-style="italic">w</text><text x="2" y="46" font-size="13" font-style="italic">ℓ</text></svg>', 'A = \\ell w'],
    ['<svg viewBox="0 0 130 100" width="130"><polygon points="12,82 118,82 76,14" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><line x1="76" y1="14" x2="76" y2="82" stroke="#0f172a" stroke-dasharray="4 3"/><text x="62" y="97" font-size="13" font-style="italic">b</text><text x="80" y="54" font-size="13" font-style="italic">h</text></svg>', 'A = \\tfrac{1}{2}bh'],
    ['<svg viewBox="0 0 130 100" width="130"><polygon points="14,82 114,82 14,16" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><path d="M14 70h12v12" fill="none" stroke="#0f172a"/><text x="2" y="52" font-size="13" font-style="italic">a</text><text x="60" y="96" font-size="13" font-style="italic">b</text><text x="70" y="44" font-size="13" font-style="italic">c</text></svg>', 'c^2 = a^2 + b^2'],
    ['<svg viewBox="0 0 140 100" width="140"><polygon points="12,84 124,84 12,19" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><path d="M12 72h12v12" fill="none" stroke="#0f172a"/><text x="84" y="79" font-size="10">30°</text><text x="18" y="38" font-size="11">60°</text><text x="-1" y="56" font-size="12" font-style="italic">x</text><text x="50" y="98" font-size="11"><tspan font-style="italic">x</tspan>√3</text><text x="64" y="42" font-size="12" font-style="italic">2x</text></svg>', 'x,\\; x\\sqrt{3},\\; 2x'],
    ['<svg viewBox="0 0 130 100" width="130"><polygon points="14,82 100,82 14,18" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><path d="M14 70h12v12" fill="none" stroke="#0f172a"/><text x="62" y="77" font-size="10">45°</text><text x="20" y="46" font-size="10">45°</text><text x="2" y="54" font-size="12" font-style="italic">s</text><text x="50" y="96" font-size="12" font-style="italic">s</text><text x="58" y="40" font-size="11"><tspan font-style="italic">s</tspan>√2</text></svg>', 's,\\; s,\\; s\\sqrt{2}'],
    ['<svg viewBox="0 0 140 110" width="140"><polygon points="20,40 100,40 100,92 20,92" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><polygon points="20,40 44,18 124,18 100,40" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.6"/><polygon points="100,40 124,18 124,70 100,92" fill="#e8edf5" stroke="#0f172a" stroke-width="1.6"/><text x="52" y="106" font-size="12" font-style="italic">ℓ</text><text x="126" y="48" font-size="12" font-style="italic">w</text><text x="6" y="70" font-size="12" font-style="italic">h</text></svg>', 'V = \\ell w h'],
    ['<svg viewBox="0 0 120 120" width="110"><ellipse cx="60" cy="24" rx="38" ry="11" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.6"/><path d="M22 24v68a38 11 0 0 0 76 0V24" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><line x1="60" y1="92" x2="98" y2="92" stroke="#0f172a" stroke-dasharray="4 3"/><text x="74" y="88" font-size="12" font-style="italic">r</text><text x="102" y="62" font-size="12" font-style="italic">h</text></svg>', 'V = \\pi r^2 h'],
    ['<svg viewBox="0 0 120 120" width="110"><circle cx="60" cy="60" r="44" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><ellipse cx="60" cy="60" rx="44" ry="12" fill="none" stroke="#0f172a" stroke-dasharray="4 3"/><line x1="60" y1="60" x2="104" y2="60" stroke="#0f172a" stroke-width="1.6"/><text x="78" y="55" font-size="12" font-style="italic">r</text></svg>', 'V = \\tfrac{4}{3}\\pi r^3'],
    ['<svg viewBox="0 0 120 120" width="110"><path d="M60 10L102 98a42 11 0 0 1-84 0z" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><ellipse cx="60" cy="98" rx="42" ry="11" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.6"/><line x1="60" y1="10" x2="60" y2="98" stroke="#0f172a" stroke-dasharray="4 3"/><text x="64" y="58" font-size="12" font-style="italic">h</text><text x="78" y="112" font-size="12" font-style="italic">r</text></svg>', 'V = \\tfrac{1}{3}\\pi r^2 h'],
    ['<svg viewBox="0 0 130 110" width="120"><polygon points="20,80 90,80 112,62 42,62" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.6"/><polygon points="65,14 20,80 90,80" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.6"/><polygon points="65,14 90,80 112,62" fill="#e8edf5" stroke="#0f172a" stroke-width="1.6"/><line x1="65" y1="14" x2="65" y2="71" stroke="#0f172a" stroke-dasharray="4 3"/><text x="70" y="50" font-size="12" font-style="italic">h</text></svg>', 'V = \\tfrac{1}{3}\\ell w h']
  ];

  function toggleRef() {
    if (ref.win) {
      var hidden = ref.win.classList.toggle('hidden');
      setPressed('refBtn', !hidden);
      return;
    }
    var figs = REF_FIGS.map(function (f) { return '<figure>' + f[0] + '<figcaption>' + tex(f[1]) + '</figcaption></figure>'; }).join('');
    var body = '<div class="ref-body"><h4>Geometry</h4><div class="ref-figs">' + figs + '</div>' +
      '<h4>Facts</h4><ul class="ref-facts"><li>The number of degrees of arc in a circle is 360.</li><li>The number of radians of arc in a circle is ' + tex('2\\pi') + '.</li>' +
      '<li>The sum of the measures in degrees of the angles of a triangle is 180.</li></ul></div>';
    ref.win = makeWindow('refWin', 'Reference', body, {
      w: 520, h: 560, left: 36, top: 100, resizable: true,
      onClose: function () { ref.win.classList.add('hidden'); setPressed('refBtn', false); }
    });
    setPressed('refBtn', true);
  }

  // ---- highlights and notes (Reading and Writing)

  function saveHighlights() {
    var root = document.getElementById('hlRoot');
    var q = cur();
    if (!root || !q) return;
    S.hl[q.id] = root.innerHTML;
    lsSet('sathl:' + sid, S.hl);
  }

  function highlightRange(root, range, cls) {
    var nodes = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (!range.intersectsNode(n)) continue;
      if (n.parentElement.closest('.katex') || n.parentElement.closest('mark.hl')) continue;
      nodes.push(n);
    }
    nodes.forEach(function (node) {
      var start = node === range.startContainer ? range.startOffset : 0;
      var end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (end <= start) return;
      var mid = node.splitText(start);
      mid.splitText(end - start);
      var mark = document.createElement('mark');
      mark.className = 'hl ' + cls;
      mid.parentNode.insertBefore(mark, mid);
      mark.appendChild(mid);
    });
  }

  function onSelect() {
    var tip = document.getElementById('selTip'); if (tip) tip.remove();
    if (S.view !== 'module' || sectionKind() !== 'rw') return;
    var root = document.getElementById('hlRoot');
    var sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    var rect = range.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'sel-tip';
    el.id = 'selTip';
    el.innerHTML = '<button class="y" data-c="y" aria-label="Yellow highlight"></button><button class="b" data-c="b" aria-label="Blue highlight"></button><button class="p" data-c="p" aria-label="Pink highlight"></button><button class="note">Note</button>';
    el.style.left = Math.max(8, Math.min(window.innerWidth - 190, rect.left + rect.width / 2 - 80)) + 'px';
    el.style.top = Math.max(8, rect.top - 48) + 'px';
    el.addEventListener('mousedown', function (e) { e.preventDefault(); });
    document.body.appendChild(el);
    el.querySelectorAll('[data-c]').forEach(function (b) {
      b.onclick = function () {
        highlightRange(root, range, b.getAttribute('data-c'));
        sel.removeAllRanges();
        el.remove();
        saveHighlights();
      };
    });
    el.querySelector('.note').onclick = function () { el.remove(); openNotes(); };
  }

  document.addEventListener('mouseup', function () { setTimeout(onSelect, 0); });
  document.addEventListener('touchend', function () { setTimeout(onSelect, 300); });
  document.addEventListener('click', function (e) {
    var m = e.target.closest && e.target.closest('mark.hl');
    if (m && document.getElementById('hlRoot') && document.getElementById('hlRoot').contains(m)) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
      saveHighlights();
    }
    if (S.navOpen && !e.target.closest('#navPop') && !e.target.closest('#navPill')) {
      S.navOpen = false;
      var np = document.getElementById('navPop'); if (np) np.remove();
      var pill = document.getElementById('navPill'); if (pill) pill.setAttribute('aria-expanded', 'false');
    }
    var mp = document.getElementById('morePop');
    if (mp && !e.target.closest('#morePop') && !e.target.closest('#moreBtn')) mp.remove();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePops(true); renderFooterSafe(); }
  });
  function renderFooterSafe() { if (S.view === 'module') renderFooter(); }

  function openNotes() {
    var q = cur();
    if (!q) return;
    if (notesWin) notesWin.remove();
    notesWin = makeWindow('notesWin', 'Notes — Question ' + (S.qi + 1), '<div style="padding:12px"><textarea class="notes" id="notesText" placeholder="Type your notes for this question here."></textarea></div>', {
      w: 360, h: 300, left: 60, top: 140, resizable: true,
      onClose: function () { notesWin.remove(); notesWin = null; }
    });
    var ta = document.getElementById('notesText');
    ta.value = S.notes[q.id] || '';
    ta.oninput = function () { S.notes[q.id] = ta.value; lsSet('satnotes:' + sid, S.notes); };
    ta.focus();
  }

  document.addEventListener('visibilitychange', function () {
    if (S.view !== 'module' || S.review) return;
    if (document.hidden) { commitSpent(); S.enteredAt = null; flush(); } else { S.enteredAt = Date.now(); }
  });
  window.addEventListener('pagehide', function () {
    if (S.view !== 'module' || !S.data) return;
    commitSpent();
    var items = takePending();
    if (items.length && navigator.sendBeacon) {
      /* the next page load re-reads saved answers from the server; unsent items are lost only if offline */
      try { fetch('/api/sat-exam/sessions/' + encodeURIComponent(sid) + '/save', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify({ items: items }) }); } catch (e) { /* ignore */ }
    }
  });

  // ------------------------------------------------------------ results

  function pct(c, t) { return t ? Math.round((c / t) * 100) : 0; }

  function renderDone() {
    var d = S.data;
    var r = d.result;
    var sum = r.summary || {};
    var rw = sum.rw;
    var math = sum.math;
    var routeName = function (x) { return x === 'hard' ? 'Higher-difficulty second module' : 'Standard second module'; };
    var cards = '<div class="scores">' +
      '<div class="score-card main"><div class="lab">Total score<span class="est">Estimate</span></div><div class="big">' + (sum.total != null ? sum.total : '—') + '</div><div class="small">400 – 1600 scale</div></div>' +
      '<div class="score-card"><div class="lab">Reading and Writing</div><div class="big">' + (rw ? rw.scaled : '—') + '</div><div class="small">' + (rw ? rw.correct + ' of ' + rw.total + ' correct · ' + routeName(rw.route) : '') + '</div></div>' +
      '<div class="score-card"><div class="lab">Math</div><div class="big">' + (math ? math.scaled : '—') + '</div><div class="small">' + (math ? math.correct + ' of ' + math.total + ' correct · ' + routeName(math.route) : '') + '</div></div></div>';
    var domains = (sum.domains || []).slice().sort(function (a, b) { return a.section === b.section ? a.domain.localeCompare(b.domain) : (a.section === 'rw' ? -1 : 1); });
    var bars = domains.map(function (x) {
      var p = pct(x.correct, x.total);
      return '<div class="bar-row"><div>' + esc(x.domain) + ' <span style="color:#64748b">(' + (x.section === 'rw' ? 'R&amp;W' : 'Math') + ')</span></div>' +
        '<div class="bar-track"><div class="bar-fill' + (p < 60 ? ' low' : '') + '" style="width:' + p + '%"></div></div><div class="pct">' + x.correct + '/' + x.total + '</div></div>';
    }).join('');
    var byStep = {};
    (r.questions || []).forEach(function (q) { (byStep[q.step] = byStep[q.step] || []).push(q); });
    var order = ['rw1', 'rw2', 'm1', 'm2'];
    var maps = order.filter(function (s) { return byStep[s]; }).map(function (s) {
      var list = byStep[s];
      return '<div><h4>' + esc(list[0].moduleTitle) + '</h4><div class="qchips">' + list.map(function (q) {
        return '<span class="chip ' + (!q.answered ? 'skip' : q.correct ? 'ok' : 'no') + '" title="' + esc(q.domain + ' · ' + q.skill) + '">' + q.position + '</span>';
      }).join('') + '</div></div>';
    }).join('');
    var mins = Math.round((sum.timeMs || 0) / 60000);
    app.innerHTML = previewBar() +
      '<div class="screen"><div class="sheet">' +
      '<div class="brand"><span class="logo">S</span>Salt Academy · SAT Practice Test</div>' +
      '<h1>Test complete</h1><div class="sub">' + esc(d.session.setName) + ' · ' + esc(d.session.studentName) + '</div>' +
      cards +
      '<p class="fine" style="margin-top:0">This is an <b>estimated</b> score. The College Board does not publish its conversion tables, so your teacher may see slightly different numbers. 예상 점수이며 실제 SAT 점수와 다를 수 있습니다.</p>' +
      '<h3 class="sec-title">Performance by content domain</h3><div class="bars">' + bars + '</div>' +
      '<h3 class="sec-title">Your answers</h3><div class="legend" style="justify-content:flex-start"><span><span class="chip ok" style="width:18px;height:18px;font-size:0"></span>Correct</span><span><span class="chip no" style="width:18px;height:18px;font-size:0"></span>Incorrect</span><span><span class="chip skip" style="width:18px;height:18px;font-size:0"></span>Left blank</span></div>' +
      '<div class="qmap">' + maps + '</div>' +
      '<p class="fine">Time spent on questions: about ' + Math.max(1, mins) + ' minute' + (mins > 1 ? 's' : '') + '.</p>' +
      '<div class="center" style="margin-top:22px"><a class="btn big" style="display:inline-block;text-decoration:none" href="' + homeUrl() + '">Back to home</a></div>' +
      '</div></div>';
  }

  // --------------------------------------------------------------- boot

  async function boot() {
    role = detectRole();
    if (!role) { location.replace('/'); return; }
    try {
      var assignment = params.get('assignment');
      sid = params.get('session') || '';
      if (!sid && assignment) {
        var r = await api('/assignments/' + encodeURIComponent(assignment) + '/start', { method: 'POST' });
        sid = r.sessionId;
        history.replaceState(null, '', '/sat-exam.html?session=' + encodeURIComponent(sid));
      }
      if (!sid) { errorScreen('This link is missing the test it belongs to.'); return; }
      await refresh();
    } catch (e) {
      errorScreen(e.message || 'Something went wrong.');
    }
  }

  window.addEventListener('beforeunload', function (e) {
    if (S.view === 'module' && Object.keys(S.pending).length && S.saveBad) { e.preventDefault(); e.returnValue = ''; }
  });

  boot();
})();
