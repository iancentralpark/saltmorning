/* SAT mistake review: retry blind, then prove it on a new question. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var esc = window.SatRender.esc;
  var params = new URLSearchParams(location.search);
  var S = { list: null, tab: 'todo', task: null, noteId: '', sel: '', result: null, busy: false, notice: '' };

  var MODULE = { rw1: 'R&W · Module 1', rw2e: 'R&W · Module 2', rw2h: 'R&W · Module 2', m1: 'Math · Module 1', m2e: 'Math · Module 2', m2h: 'Math · Module 2' };
  var DIFF = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  function api(path, opts) {
    return window.SaltApp.api('/api/sat-exam' + path, opts || {}, 'student');
  }
  function token() { return window.SaltApp.getToken('student'); }

  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString('en-US', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function rich(text, assets, noteId) {
    return window.SatRender.html(text, {
      figureUrl: function (r) {
        var id = (assets || {})[r];
        return id ? '/api/sat-exam/review/notes/' + encodeURIComponent(noteId) + '/assets/' + encodeURIComponent(id) + '?access_token=' + encodeURIComponent(token()) : '';
      }
    });
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3600);
  }

  function brand() { return '<div class="brand"><span class="logo">S</span>Salt Academy · SAT Practice Test</div>'; }

  // ---------------------------------------------------------------- list

  async function showList() {
    S.task = null;
    S.noteId = '';
    history.replaceState(null, '', '/sat-review.html');
    app.innerHTML = '<div class="screen"><div class="sheet center"><p>Loading…</p></div></div>';
    try {
      S.list = await api('/review');
    } catch (e) {
      app.innerHTML = '<div class="screen"><div class="sheet center">' + brand() + '<h1>Couldn’t load your review</h1><p class="sub">' + esc(e.message) + '</p><a class="btn" style="display:inline-block;text-decoration:none" href="/student.html">Back to home</a></div></div>';
      return;
    }
    renderList();
  }

  function renderList() {
    var sum = S.list.summary;
    var notes = S.list.notes;
    var shown = notes.filter(function (n) { return S.tab === 'all' ? true : S.tab === 'done' ? n.status === 'done' : n.status !== 'done'; });
    var pct = sum.total ? Math.round(sum.done / sum.total * 100) : 0;
    var groups = [];
    var byKey = {};
    shown.forEach(function (n) {
      var k = n.setName + '|' + n.takenAt;
      if (!byKey[k]) { byKey[k] = { title: n.setName, at: n.takenAt, notes: [] }; groups.push(byKey[k]); }
      byKey[k].notes.push(n);
    });
    var cards = groups.map(function (g) {
      return '<div class="rv-group">' + esc(g.title) + ' · ' + esc(fmtDate(g.at)) + '</div>' + g.notes.map(function (n) {
        var chip = n.status === 'done' ? '<span class="rv-chip done">✓ Mastered</span>' :
          n.status === 'verify' ? '<span class="rv-chip verify">New question next</span>' :
            n.status === 'blind_started' ? '<span class="rv-chip todo">Try again</span>' : '<span class="rv-chip todo">To review</span>';
        return '<button class="rv-card" data-note="' + esc(n.id) + '"><div class="loc">' + esc((MODULE[n.moduleKey] || '').split(' · ')[0]) + ' · Q' + n.position + '<small>' + esc((MODULE[n.moduleKey] || '').split(' · ')[1] || '') + '</small></div>' +
          '<div><div class="sk">' + esc(n.skill) + ' <span style="color:#64748b;font-weight:600">· ' + esc(DIFF[n.difficulty] || '') + '</span></div><div class="sn">' + esc(n.snippet) + '</div></div>' + chip + '</button>';
      }).join('');
    }).join('');
    var open = notes.filter(function (n) { return n.status !== 'done'; });
    app.innerHTML =
      '<div class="screen"><div class="sheet">' + brand() +
      '<h1>Review your mistakes</h1>' +
      '<div class="sub">' + (sum.total ? (sum.open ? sum.open + ' to go · ' + sum.done + ' mastered' : 'Everything reviewed — great work.') : 'No mistakes to review yet. Finish a practice test and they will show up here.') + '</div>' +
      (sum.total ? '<div class="rv-progress" aria-label="Progress"><span style="width:' + pct + '%"></span></div><div class="fine" style="margin-top:0">' + pct + '% mastered</div>' : '') +
      '<div class="rv-how"><div><b>1 · Try again</b>The question comes back without the answer. The choice you picked is crossed out. You get two tries, then the explanation opens.</div>' +
      '<div><b>2 · Prove it on a new question</b>You get a new question of the same kind. Answer it correctly to finish. If you miss it, read the explanation and try a different one.</div></div>' +
      (open.length ? '<div class="center" style="margin:18px 0 2px"><button class="btn big" id="startNext">' + (open.some(function (n) { return n.status !== 'new'; }) ? 'Continue reviewing' : 'Start reviewing') + '</button></div>' : '') +
      (sum.total ? '<div class="rv-tabs"><button data-tab="todo" class="' + (S.tab === 'todo' ? 'on' : '') + '">To do (' + sum.open + ')</button><button data-tab="done" class="' + (S.tab === 'done' ? 'on' : '') + '">Mastered (' + sum.done + ')</button><button data-tab="all" class="' + (S.tab === 'all' ? 'on' : '') + '">All (' + sum.total + ')</button></div>' : '') +
      (cards || (sum.total ? '<p class="fine">Nothing here.</p>' : '')) +
      '<p class="fine center" style="margin-top:26px"><a href="/student.html">Back to home</a></p></div></div>';
    app.querySelectorAll('[data-note]').forEach(function (b) { b.onclick = function () { openNote(b.getAttribute('data-note')); }; });
    app.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-tab'); renderList(); }; });
    var sn = document.getElementById('startNext');
    if (sn) sn.onclick = function () { openNote(open[0].id); };
  }

  // ---------------------------------------------------------------- task

  async function openNote(id) {
    S.noteId = id;
    S.sel = '';
    S.result = null;
    S.notice = '';
    history.replaceState(null, '', '/sat-review.html?note=' + encodeURIComponent(id));
    try {
      S.task = await api('/review/notes/' + encodeURIComponent(id));
    } catch (e) {
      toast(e.message || 'Could not open this question.');
      return showList();
    }
    renderTask();
  }

  function stepsHtml(t) {
    var s1 = t.note.stage === 'blind' ? 'on' : 'done';
    var s2 = t.note.stage === 'done' ? 'done' : t.note.stage === 'verify' ? 'on' : '';
    return '<div class="rv-steps"><div class="rv-step ' + s1 + '"><span class="n">' + (s1 === 'done' ? '✓' : '1') + '</span>Try again</div><span class="rv-bar"></span>' +
      '<div class="rv-step ' + s2 + '"><span class="n">' + (s2 === 'done' ? '✓' : '2') + '</span>New question</div></div>';
  }

  function locked() {
    var t = S.task;
    return t.view === 'verify_result' || t.view === 'done' || !!(S.result && S.result.final);
  }

  function revealInfo() {
    var t = S.task;
    if (S.result && S.result.reveal) return S.result.reveal;
    if (t.reveal) return t.reveal;
    return null;
  }

  function choicesHtml() {
    var t = S.task;
    var q = t.question;
    var rv = revealInfo();
    var isLocked = locked();
    return '<ul class="choices" role="radiogroup">' + q.choices.map(function (c) {
      var gone = t.view === 'blind' && (t.eliminated || []).indexOf(c.label) >= 0 && !isLocked;
      var cls = 'choice';
      if (isLocked && rv) {
        if (c.label === rv.correctAnswer) cls += ' right';
        else if (c.label === rv.yourAnswer) cls += ' wrong';
      } else if (gone) cls += ' gone';
      else if (S.sel === c.label) cls += ' sel';
      if (isLocked || gone) cls += ' locked';
      return '<li class="choice-row"><button class="' + cls + '" role="radio" aria-checked="' + (S.sel === c.label) + '" data-pick="' + c.label + '"' + (gone || isLocked ? ' disabled' : '') + '>' +
        '<span class="letter">' + c.label + '</span><span class="ctext sat-rich">' + rich(c.text, q.assets, t.note.id) + '</span></button></li>';
    }).join('') + '</ul>';
  }

  function sprHtml() {
    var rv = revealInfo();
    var isLocked = locked();
    var val = isLocked && rv ? rv.yourAnswer : S.sel;
    return '<div class="spr-box"><label for="sprInput">Enter your answer</label><input id="sprInput" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="' + esc(val) + '"' + (isLocked ? ' disabled' : '') + '>' +
      '<p class="spr-note">Up to 5 characters (6 if negative). Use <b>/</b> for fractions.</p></div>';
  }

  function feedbackHtml() {
    var t = S.task;
    var rv = revealInfo();
    var q = t.question;
    var why = function (r) {
      return '<div class="why"><div class="lab">Explanation</div><div class="sat-rich">' + (r.rationale ? rich(r.rationale, q.assets, t.note.id) : '<i>No explanation was saved for this question.</i>') + '</div></div>';
    };
    var ans = function (r) {
      return q.qtype === 'spr' ? 'Correct answer: <b>' + esc(r.correctAnswer) + '</b>' + (r.acceptedAnswers && r.acceptedAnswers.length ? ' (also accepted: ' + r.acceptedAnswers.map(esc).join(', ') + ')' : '') : 'Correct answer: <b>' + esc(r.correctAnswer) + '</b>';
    };
    if (t.view === 'blind') {
      if (S.result && S.result.final) {
        var okb = S.result.correct;
        return '<div class="rv-feedback ' + (okb ? 'good' : 'bad') + '"><h4>' + (okb ? 'Correct!' : 'Not quite — here’s the answer') + '</h4>' + ans(S.result.reveal) + why(S.result.reveal) +
          '<div class="rv-actions"><button class="btn" id="goVerify">Continue to a new question →</button></div></div>';
      }
      if (S.notice) return '<div class="rv-feedback bad"><h4>' + esc(S.notice) + '</h4></div>';
      return '<div class="rv-feedback info"><h4>Try it again</h4>' + (t.eliminated.length ? 'The choice you picked last time is crossed out. ' : '') + 'No hints this time — you have ' + (t.maxAttempts - t.attempts) + ' ' + ((t.maxAttempts - t.attempts) === 1 ? 'try' : 'tries') + ' left.</div>';
    }
    if (t.view === 'verify') {
      return '<div class="rv-feedback info"><h4>New question</h4>This is a fresh question on <b>' + esc(t.note.skill) + '</b>. Answer it correctly to finish this mistake.</div>';
    }
    if (t.view === 'verify_result') {
      var good = rv.correct;
      return '<div class="rv-feedback ' + (good ? 'good' : 'bad') + '"><h4>' + (good ? 'You got it!' : 'Not this time') + '</h4>' + ans(rv) + why(rv) +
        '<div class="rv-actions">' + (good ? nextButtons() : '<button class="btn" id="tryAnother">Try a different question</button>') + '</div></div>';
    }
    var done = '<div class="rv-feedback ' + (t.note.exhausted ? 'info' : 'good') + '"><h4>' + (t.note.exhausted ? 'Marked as reviewed' : 'Mastered ✓') + '</h4>' +
      (t.note.exhausted ? 'There are no more unseen questions of this kind in the bank, so this one is marked as reviewed.' : 'You answered a new question of this kind correctly.') +
      (rv ? why(rv) : '') + '<div class="rv-actions">' + nextButtons() + '</div></div>';
    return done;
  }

  function nextButtons() {
    return '<button class="btn" id="nextMistake">Next mistake →</button><button class="btn ghost" id="toList">All mistakes</button>';
  }

  function originalHtml() {
    var t = S.task;
    if (!t.original || t.view === 'blind') return '';
    var o = t.original;
    return '<details class="rv-orig"><summary>The question you missed — explanation</summary><p style="margin:4px 0 10px;font-family:var(--sans)">Correct answer: <b>' + esc(o.reveal.correctAnswer) + '</b></p>' +
      '<div class="sat-rich" style="font-size:15.5px;line-height:1.6;margin-bottom:12px">' + (o.reveal.rationale ? rich(o.reveal.rationale, o.question.assets, t.note.id) : '<i>No explanation was saved.</i>') + '</div></details>';
  }

  function renderTask() {
    var t = S.task;
    var q = t.question;
    var isRW = t.note.section === 'rw';
    var isLocked = locked();
    var left = '';
    var rightTop = '';
    if (isRW) {
      left = q.passage ? '<div class="passage sat-rich">' + rich(q.passage, q.assets, t.note.id) + '</div>' : '';
      rightTop = '<div class="stem sat-rich">' + rich(q.stem, q.assets, t.note.id) + '</div>';
    } else {
      left = '<div class="stem sat-rich" style="margin-top:0">' + (q.passage ? rich(q.passage, q.assets, t.note.id) + '<br>' : '') + rich(q.stem, q.assets, t.note.id) + '</div>';
    }
    var tag = t.view === 'blind' ? 'Try again · ' + (MODULE[t.note.moduleKey] || '') + ' · Q' + t.note.position :
      'New question · ' + esc(t.note.skill) + (t.attemptNo > 1 ? ' · attempt ' + t.attemptNo : '');
    var body = (q.qtype === 'spr' ? sprHtml() : choicesHtml()) + feedbackHtml() + originalHtml();
    var right = '<section class="pane right' + (left ? '' : ' solo') + '" id="rightPane"><span class="rv-tag">' + esc(tag) + '</span>' + rightTop + body + '</section>';
    var split = parseFloat(localStorage.getItem('satsplit') || '50');
    var work = left
      ? '<section class="pane left" style="--split:' + split + '%">' + left + '</section><div class="divider" aria-hidden="true"></div>' + right
      : right.replace('class="pane right solo"', 'class="pane right solo" style="margin:0 auto"');
    var canCheck = !isLocked && !!S.sel && !S.busy;
    app.innerHTML =
      '<div class="exam"><header class="hdr"><div class="left"><div class="title">Review · ' + esc(t.note.skill) + '</div><span style="font-size:13px;color:var(--muted)">' + esc(t.note.domain) + ' · ' + esc(DIFF[t.note.difficulty] || '') + '</span></div>' +
      stepsHtml(t) + '<div class="tools"><button class="tool" id="backBtn">' + '<svg class="i" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>' + 'All mistakes</button></div></header>' +
      '<div class="stripe"></div><main class="work" id="work">' + work + '</main><div class="stripe thin"></div>' +
      '<footer class="ftr"><div class="who"><span>Review mode — not timed</span></div><div></div><div class="btns">' +
      (isLocked ? '' : '<button class="btn" id="checkBtn"' + (canCheck ? '' : ' disabled') + '>Check answer</button>') + '</div></footer></div>';
    bindTask();
  }

  function bindTask() {
    var t = S.task;
    document.getElementById('backBtn').onclick = showList;
    app.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () {
        S.sel = b.getAttribute('data-pick');
        app.querySelectorAll('[data-pick]').forEach(function (x) {
          var on = x.getAttribute('data-pick') === S.sel;
          if (!x.classList.contains('gone')) x.classList.toggle('sel', on);
          x.setAttribute('aria-checked', on);
        });
        var cb = document.getElementById('checkBtn');
        if (cb) cb.disabled = false;
      };
    });
    var inp = document.getElementById('sprInput');
    if (inp) {
      inp.oninput = function () {
        var v = String(inp.value).replace(/[\u2212\u2013\u2014]/g, '-').replace(/[^0-9./-]/g, '');
        var neg = v.charAt(0) === '-';
        v = (neg ? '-' : '') + v.replace(/-/g, '').slice(0, 5);
        if (v !== inp.value) inp.value = v;
        S.sel = v;
        var cb = document.getElementById('checkBtn');
        if (cb) cb.disabled = !v;
      };
      inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
      if (!inp.disabled) inp.focus();
    }
    var cb2 = document.getElementById('checkBtn');
    if (cb2) cb2.onclick = check;
    var gv = document.getElementById('goVerify');
    if (gv) gv.onclick = function () { openNote(S.noteId); };
    var ta = document.getElementById('tryAnother');
    if (ta) ta.onclick = tryAnother;
    var nm = document.getElementById('nextMistake');
    if (nm) nm.onclick = nextMistake;
    var tl = document.getElementById('toList');
    if (tl) tl.onclick = showList;
    void t;
  }

  async function check() {
    if (!S.sel || S.busy) return;
    S.busy = true;
    var cb = document.getElementById('checkBtn');
    if (cb) { cb.disabled = true; cb.textContent = 'Checking…'; }
    try {
      var r = await api('/review/notes/' + encodeURIComponent(S.noteId) + '/answer', { method: 'POST', body: { answer: S.sel } });
      S.busy = false;
      if (!r.result.final) {
        S.task = r.state;
        S.notice = 'Not quite. That choice is now crossed out — one more try.';
        S.sel = '';
        S.result = null;
      } else if (S.task.view === 'blind') {
        S.result = r.result;
        S.task = Object.assign({}, S.task, { note: Object.assign({}, S.task.note, { stage: 'verify' }) });
      } else {
        S.result = null;
        S.task = r.state;
      }
      renderTask();
    } catch (e) {
      S.busy = false;
      toast(e.message || 'Could not check your answer.');
      renderTask();
    }
  }

  async function tryAnother() {
    try {
      S.task = await api('/review/notes/' + encodeURIComponent(S.noteId) + '/next', { method: 'POST' });
      S.sel = '';
      S.result = null;
      S.notice = '';
      renderTask();
    } catch (e) { toast(e.message || 'Could not load another question.'); }
  }

  async function nextMistake() {
    try {
      var l = await api('/review');
      S.list = l;
      var open = l.notes.filter(function (n) { return n.status !== 'done' && n.id !== S.noteId; });
      if (!open.length) { toast('All mistakes reviewed — nice work!'); return showList(); }
      openNote(open[0].id);
    } catch (e) { showList(); }
  }

  var note = params.get('note');
  if (note) openNote(note); else showList();
})();
