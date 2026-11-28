(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var KEYS = ['rw1', 'rw2e', 'rw2h', 'm1', 'm2e', 'm2h'];
  var KEY_LABEL = {
    rw1: ['R&W 모듈 1', '모든 학생'],
    rw2e: ['R&W 모듈 2', '표준 난이도'],
    rw2h: ['R&W 모듈 2', '상위 난이도'],
    m1: ['Math 모듈 1', '모든 학생'],
    m2e: ['Math 모듈 2', '표준 난이도'],
    m2h: ['Math 모듈 2', '상위 난이도']
  };
  var DIFF = { easy: '쉬움', medium: '보통', hard: '어려움' };
  var STEP_OF = { rw1: 'rw1', rw2e: 'rw2', rw2h: 'rw2', m1: 'm1', m2e: 'm2', m2h: 'm2' };

  var S = { stats: null, statsFilter: { setId: '', classId: '' }, view: 'sets', sets: null, pool: null, detail: null, key: 'rw1', assignments: [], busy: false };

  // ------------------------------------------------------------- plumbing

  function token() {
    try {
      return localStorage.getItem('salt_teacher_token') || sessionStorage.getItem('salt_teacher_token') ||
        localStorage.getItem('salt_admin_token') || sessionStorage.getItem('salt_admin_token') ||
        localStorage.getItem('salt_principal_token') || sessionStorage.getItem('salt_principal_token') ||
        localStorage.getItem('salt_staff_token') || sessionStorage.getItem('salt_staff_token') || '';
    } catch (e) { return ''; }
  }

  function api(url, opts) {
    opts = opts || {};
    var headers = { Authorization: 'Bearer ' + token() };
    var body = opts.body;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch('/api/sat' + url, { method: opts.method || 'GET', headers: headers, body: body }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) throw new Error('로그인이 필요합니다. 선생님 포털에서 로그인한 뒤 이 창을 새로고침해 주세요.');
        if (!res.ok) throw new Error((data && data.error) || '요청에 실패했습니다.');
        return data;
      });
    });
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.id);
    toast.id = setTimeout(function () { t.classList.add('hidden'); }, 3200);
  }

  function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function toLocalInput(date) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) + 'T' + p(date.getHours()) + ':' + p(date.getMinutes());
  }

  function openModal(opts) {
    closeModal();
    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '" role="dialog" aria-modal="true"><header><h3>' + esc(opts.title) +
      '</h3><button class="btn quiet sm" data-close aria-label="닫기">✕</button></header><div class="body">' + opts.body + '</div>' +
      (opts.footer ? '<footer>' + opts.footer + '</footer>' : '') + '</div>';
    $('layer').appendChild(scrim);
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) closeModal(); });
    scrim.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeModal; });
    return scrim;
  }
  function closeModal() { $('layer').innerHTML = ''; }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function run(btn, fn) {
    if (btn) btn.disabled = true;
    return Promise.resolve().then(fn).catch(function (e) { toast(e.message || '실패했습니다.'); }).then(function (r) { if (btn) btn.disabled = false; return r; });
  }

  // ---------------------------------------------------------------- views

  function setNav(view) {
    document.querySelectorAll('#nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === view); });
  }
  document.querySelectorAll('#nav button').forEach(function (b) {
    b.onclick = function () { S.view = b.getAttribute('data-view'); render(); };
  });

  function render() {
    setNav(S.view === 'set' ? 'sets' : S.view);
    if (S.view === 'set') return renderSet();
    if (S.view === 'assigned') return renderAssigned();
    if (S.view === 'stats') return renderStats();
    return renderSets();
  }

  function statusPill(st) {
    if (st === 'published') return '<span class="pill ok">배포됨</span>';
    if (st === 'archived') return '<span class="pill">보관</span>';
    return '<span class="pill warn">초안</span>';
  }

  function loadSets() {
    return api('/sets').then(function (d) { S.sets = d.sets; S.pool = d.pool; });
  }

  function renderSets() {
    var main = $('main');
    if (!S.sets) {
      main.innerHTML = '<p class="muted">불러오는 중…</p>';
      loadSets().then(render).catch(function (e) { main.innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; });
      return;
    }
    var pool = S.pool || { bySection: {} };
    var cards = S.sets.map(function (s) {
      var pct = s.itemTarget ? Math.round((s.itemCount / s.itemTarget) * 100) : 0;
      return '<article class="set-card" data-open="' + esc(s.id) + '">' +
        '<div class="top"><h3>' + esc(s.name) + '</h3>' + statusPill(s.status) + '</div>' +
        '<div class="facts"><div><b>' + s.studentQuestions + '</b>학생이 푸는 문항</div><div><b>' + s.studentMinutes + '분</b>총 시간</div><div><b>' + s.assignmentCount + '</b>배정</div><div><b>' + s.sessionCount + '</b>응시</div></div>' +
        '<div><div class="meter ' + (pct >= 100 ? 'full' : '') + '"><span style="width:' + Math.min(100, pct) + '%"></span></div>' +
        '<div class="small muted" style="margin-top:.3rem">문항 채움 ' + s.itemCount + ' / ' + s.itemTarget + '</div></div>' +
        '<div class="foot"><span class="small muted">' + esc(fmt(s.updatedAt)) + ' 수정</span><span class="grow"></span><button class="btn sm" data-open="' + esc(s.id) + '">열기</button></div></article>';
    }).join('');
    main.innerHTML =
      '<div class="toolbar"><div><h2>시험 세트</h2><div class="small muted" style="margin-top:.2rem">한 세트는 실제 Digital SAT처럼 R&amp;W 2모듈 + Math 2모듈로 이루어지고, 모듈 1 성적에 따라 모듈 2 난이도가 정해집니다.</div></div>' +
      '<span class="grow"></span><button class="btn primary" id="newSet">+ 새 세트 만들기</button></div>' +
      '<div class="pool" style="margin-bottom:1.2rem"><span class="pill blue">승인된 R&amp;W ' + (pool.bySection.rw || 0) + '문항</span><span class="pill blue">승인된 Math ' + (pool.bySection.math || 0) + '문항</span>' +
      '<span class="small muted" style="align-self:center">문제은행에서 “승인”한 문항만 시험에 들어갑니다.</span></div>' +
      (cards ? '<div class="grid">' + cards + '</div>' :
        '<div class="card empty"><b>아직 만든 세트가 없습니다</b>“새 세트 만들기”를 누르면 승인된 문항에서 영역·난이도 비율에 맞춰 자동으로 채워 줍니다.</div>');
    $('newSet').onclick = openCreate;
    main.querySelectorAll('[data-open]').forEach(function (el) {
      el.onclick = function (e) { e.stopPropagation(); openSet(el.getAttribute('data-open')); };
    });
  }

  function openCreate() {
    var pool = S.pool && S.pool.bySection || {};
    var m = openModal({
      title: '새 시험 세트',
      body: '<label class="f" style="margin-top:.4rem">세트 이름</label><input id="cName" style="width:100%" placeholder="예: SAT Practice Test 1" maxlength="120">' +
        '<label class="f">구성</label>' +
        '<label class="opt"><input type="radio" name="preset" value="full" checked><b>정식 (실제 시험 구성)</b><div class="small muted">R&amp;W 27+27문항 · Math 22+22문항 · 총 134분 · 문제은행에 R&amp;W 약 81개, Math 약 66개 이상 필요</div></label>' +
        '<label class="opt"><input type="radio" name="preset" value="mini"><b>미니 (연습용)</b><div class="small muted">R&amp;W 9+9문항 · Math 8+8문항 · 총 48분</div></label>' +
        '<div class="banner info small">현재 승인된 문항: R&amp;W ' + (pool.rw || 0) + '개, Math ' + (pool.math || 0) + '개. 모자라면 가능한 만큼만 채우고 알려 드립니다.</div>',
      footer: '<button class="btn" data-close>취소</button><button class="btn primary" id="cGo">만들기</button>'
    });
    var name = $('cName');
    name.focus();
    m.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeModal; });
    $('cGo').onclick = function () {
      var preset = m.querySelector('input[name=preset]:checked').value;
      if (!name.value.trim()) { name.focus(); return; }
      run($('cGo'), function () {
        return api('/sets', { method: 'POST', body: { name: name.value.trim(), preset: preset } }).then(function (r) {
          closeModal();
          S.sets = null;
          var notes = r.composed || {};
          return openSet(r.id).then(function () {
            if (notes.short && Object.keys(notes.short).length) toast('문항이 모자란 모듈이 있습니다. 승인된 문항을 더 늘려 주세요.');
            else toast('세트를 만들었습니다.');
          });
        });
      });
    };
  }

  // ------------------------------------------------------------- set view

  function openSet(id) {
    return api('/sets/' + encodeURIComponent(id)).then(function (d) {
      S.detail = d;
      S.view = 'set';
      if (KEYS.indexOf(S.key) < 0) S.key = 'rw1';
      return api('/assignments?setId=' + encodeURIComponent(id)).then(function (a) { S.assignments = a.assignments; }, function () { S.assignments = []; });
    }).then(render, function (e) { toast(e.message); });
  }

  function keyTarget(set, key) {
    return set.structure.modules[STEP_OF[key]].count;
  }

  function renderSet() {
    var d = S.detail;
    var set = d.set;
    var editable = set.status === 'draft';
    var main = $('main');
    var tabs = KEYS.map(function (k) {
      var have = (d.items[k] || []).length;
      var want = keyTarget(set, k);
      return '<button class="tab ' + (k === S.key ? 'on' : '') + (have < want ? ' short' : '') + '" data-key="' + k + '"><b>' + KEY_LABEL[k][0] + '</b><small>' + KEY_LABEL[k][1] + ' · ' + have + ' / ' + want + '</small></button>';
    }).join('');
    var problems = d.problems.length
      ? '<div class="banner warn"><b>배포하기 전에 확인해 주세요</b><ul>' + d.problems.slice(0, 6).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + (d.problems.length > 6 ? '<li>…외 ' + (d.problems.length - 6) + '건</li>' : '') + '</ul></div>' : '';
    var publishBtn = set.status === 'published'
      ? '<button class="btn" id="unpub">초안으로 되돌리기</button>'
      : '<button class="btn primary" id="pub"' + (d.problems.length ? ' disabled title="먼저 위의 문제를 해결해 주세요"' : '') + '>학생에게 배포 가능하게 하기</button>';
    main.innerHTML =
      '<div class="crumb"><button id="back">← 세트 목록</button></div>' +
      '<div class="head"><div class="title"><h2><span class="name" id="rename" title="이름 바꾸기">' + esc(set.name) + '</span>' + statusPill(set.status) + '</h2>' +
      '<div class="small muted" style="margin-top:.3rem">' + set.studentQuestions + '문항 · ' + set.studentMinutes + '분 (+ 쉬는 시간 ' + set.structure.breakMinutes + '분) · 응시 ' + set.sessionCount + '명</div></div>' +
      '<div class="actions"><button class="btn" id="preview">미리보기</button>' + publishBtn +
      '<button class="btn primary" id="assign"' + (set.status === 'published' ? '' : ' disabled title="배포 가능 상태로 바꾼 뒤에 부여할 수 있습니다"') + '>시험 부여</button>' +
      '<button class="btn" id="dup">복제</button><button class="btn danger" id="del">삭제</button></div></div>' +
      problems +
      (editable ? '' : '<div class="banner info">배포된 세트는 문항을 고칠 수 없습니다. 고치려면 “초안으로 되돌리기” 또는 “복제”를 사용하세요.' + (set.sessionCount ? ' 이미 응시한 학생이 있어 되돌릴 수 없으면 복제해서 고치세요.' : '') + '</div>') +
      '<div class="tabs">' + tabs + '</div>' +
      '<div class="editor"><div class="card" style="padding:.3rem 0"><div id="items"></div></div><aside class="card side" id="side"></aside></div>' +
      '<div class="card" style="margin-top:1.2rem"><h3>이 세트의 배정</h3><div id="assigns"></div></div>';
    $('back').onclick = function () { S.view = 'sets'; S.sets = null; render(); };
    main.querySelectorAll('[data-key]').forEach(function (b) { b.onclick = function () { S.key = b.getAttribute('data-key'); renderSet(); }; });
    $('rename').onclick = renameSet;
    $('preview').onclick = function () { runPreview(this); };
    var pub = $('pub'); if (pub) pub.onclick = function () { setStatus(this, 'publish'); };
    var unpub = $('unpub'); if (unpub) unpub.onclick = function () { setStatus(this, 'unpublish'); };
    $('assign').onclick = openAssign;
    $('dup').onclick = function () {
      run(this, function () { return api('/sets/' + set.id + '/duplicate', { method: 'POST' }).then(function (r) { S.sets = null; toast('복제했습니다.'); return openSet(r.id); }); });
    };
    $('del').onclick = deleteSet;
    renderItems();
    renderAssignList();
  }

  function renderItems() {
    var d = S.detail;
    var set = d.set;
    var editable = set.status === 'draft';
    var key = S.key;
    var want = keyTarget(set, key);
    var byPos = {};
    (d.items[key] || []).forEach(function (q) { byPos[q.position] = q; });
    var rows = '';
    for (var p = 1; p <= want; p++) {
      var q = byPos[p];
      if (!q) {
        rows += '<div class="qrow blank"><div class="no">' + p + '</div><div class="sid">빈 칸</div><div class="mid"><div class="l2">이 자리에 들어갈 문항이 없습니다.</div></div><div>' +
          (editable ? '<button class="btn sm primary" data-pick="' + p + '">채우기</button>' : '') + '</div></div>';
      } else {
        rows += '<div class="qrow"><div class="no">' + p + '</div><div class="sid">' + esc(q.sourceId || q.id) + '</div><div class="mid"><div class="l1"><span class="pill ' + q.difficulty + '">' + (DIFF[q.difficulty] || q.difficulty) + '</span>' +
          '<span class="pill">' + esc(q.qtype === 'spr' ? '주관식' : '객관식') + '</span><span class="muted">' + esc(q.domain) + ' · ' + esc(q.skill) + '</span></div><div class="l2">' + esc(q.snippet) + '</div></div>' +
          '<div class="row" style="gap:.3rem">' + (editable ? '<button class="btn sm" data-pick="' + p + '">교체</button><button class="btn sm quiet" data-rm="' + p + '">제거</button>' : '') + '</div></div>';
      }
    }
    $('items').innerHTML = rows;
    $('items').querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { openPicker(parseInt(b.getAttribute('data-pick'), 10)); }; });
    $('items').querySelectorAll('[data-rm]').forEach(function (b) {
      b.onclick = function () {
        run(b, function () {
          return api('/sets/' + set.id + '/items?module=' + key + '&position=' + b.getAttribute('data-rm'), { method: 'DELETE' }).then(function (r) { S.detail = r; renderSet(); });
        });
      };
    });

    var dom = {};
    var diff = { easy: 0, medium: 0, hard: 0 };
    (d.items[key] || []).forEach(function (q) { dom[q.domain] = (dom[q.domain] || 0) + 1; diff[q.difficulty] = (diff[q.difficulty] || 0) + 1; });
    var have = (d.items[key] || []).length;
    var domHtml = Object.keys(dom).sort().map(function (k) {
      return '<div class="dom"><div class="l"><span>' + esc(k) + '</span><b>' + dom[k] + '</b></div><div class="meter"><span style="width:' + Math.round(dom[k] / Math.max(1, have) * 100) + '%"></span></div></div>';
    }).join('') || '<p class="small muted">아직 문항이 없습니다.</p>';
    var note = key.slice(-1) === 'e' ? '모듈 1에서 정답이 적었던 학생에게 나옵니다. 쉬운 문항 비중이 높습니다.'
      : key.slice(-1) === 'h' ? '모듈 1에서 정답이 많았던 학생에게 나옵니다. 어려운 문항 비중이 높습니다.' : '모든 학생이 먼저 푸는 모듈입니다. 난이도가 고르게 섞입니다.';
    $('side').innerHTML = '<h3>' + KEY_LABEL[key][0] + ' · ' + KEY_LABEL[key][1] + '</h3><p class="small muted" style="margin-top:0">' + note + '</p>' +
      '<div class="row" style="gap:.35rem;margin-bottom:.4rem"><span class="pill easy">쉬움 ' + diff.easy + '</span><span class="pill medium">보통 ' + diff.medium + '</span><span class="pill hard">어려움 ' + diff.hard + '</span></div>' +
      domHtml +
      (editable ? '<button class="btn" id="recompose" style="width:100%;margin-top:.8rem">이 모듈 다시 뽑기</button>' : '');
    var rc = $('recompose');
    if (rc) rc.onclick = function () {
      if (have && !confirm('이 모듈의 문항을 모두 새로 뽑을까요? 지금 문항은 사라집니다.')) return;
      run(rc, function () {
        return api('/sets/' + set.id + '/compose', { method: 'POST', body: { module: key } }).then(function (r) {
          S.detail = { set: r.set, items: r.items, problems: r.problems };
          renderSet();
          toast(r.notes && r.notes.short && r.notes.short[key] ? '문항이 모자라 일부만 채웠습니다.' : '다시 뽑았습니다.');
        });
      });
    };
  }

  function renameSet() {
    var set = S.detail.set;
    var m = openModal({
      title: '세트 이름 바꾸기',
      body: '<input id="rn" style="width:100%" maxlength="120" value="' + esc(set.name) + '">',
      footer: '<button class="btn" data-close>취소</button><button class="btn primary" id="rnGo">저장</button>'
    });
    m.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeModal; });
    $('rn').focus(); $('rn').select();
    var go = function () {
      run($('rnGo'), function () {
        return api('/sets/' + set.id, { method: 'PATCH', body: { name: $('rn').value } }).then(function (r) { S.detail = r; closeModal(); renderSet(); });
      });
    };
    $('rnGo').onclick = go;
    $('rn').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }

  function setStatus(btn, what) {
    var set = S.detail.set;
    run(btn, function () {
      return api('/sets/' + set.id + '/' + what, { method: 'POST' }).then(function (r) {
        S.detail = Object.assign({}, S.detail, r);
        renderSet();
        toast(what === 'publish' ? '배포 가능 상태로 바꿨습니다. 이제 반에 부여할 수 있습니다.' : '초안으로 되돌렸습니다.');
      });
    });
  }

  function deleteSet() {
    var set = S.detail.set;
    var msg = set.sessionCount ? '이미 응시한 학생이 있어 보관 처리됩니다(기록은 남고, 배정은 모두 취소됩니다). 계속할까요?' : '이 세트를 삭제할까요?';
    if (!confirm(msg)) return;
    run($('del'), function () {
      return api('/sets/' + set.id, { method: 'DELETE' }).then(function () { S.sets = null; S.view = 'sets'; render(); toast('삭제했습니다.'); });
    });
  }

  function runPreview(btn) {
    var set = S.detail.set;
    run(btn, function () {
      return api('/sets/' + set.id + '/preview', { method: 'POST', body: {} }).then(function (r) {
        window.open('/sat-exam.html?preview=1&session=' + encodeURIComponent(r.sessionId), '_blank');
      });
    });
  }

  // ----------------------------------------------------------- picker modal

  function openPicker(position) {
    var d = S.detail;
    var key = S.key;
    var domains = {};
    (d.items[key] || []).forEach(function (q) { domains[q.domain] = 1; });
    var m = openModal({
      title: KEY_LABEL[key][0] + ' · ' + KEY_LABEL[key][1] + ' — ' + position + '번 문항 고르기',
      wide: true,
      body: '<div class="row"><input id="pSearch" class="grow" placeholder="문항 ID나 본문으로 검색"><select id="pDiff"><option value="">모든 난이도</option><option value="easy">쉬움</option><option value="medium">보통</option><option value="hard">어려움</option></select>' +
        '<select id="pDom"><option value="">모든 영역</option>' + Object.keys(domainOptions(key)).map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></div>' +
        '<div class="small muted" style="margin-top:.5rem">승인된 문항만 보입니다. 이미 이 세트에 있는 문항을 고르면 두 문항의 자리가 서로 바뀝니다.</div><div class="cand" id="cand"><p class="muted" style="padding:1rem">불러오는 중…</p></div>'
    });
    var timer;
    var load = function () {
      var q = '?module=' + key + '&domain=' + encodeURIComponent($('pDom').value) + '&difficulty=' + $('pDiff').value + '&search=' + encodeURIComponent($('pSearch').value.trim());
      api('/sets/' + d.set.id + '/candidates' + q).then(function (r) {
        $('cand').innerHTML = r.questions.map(function (c) {
          var tag = c.inModule ? '<span class="pill blue">' + (KEY_LABEL[c.inModule] ? KEY_LABEL[c.inModule][0] + ' · ' + KEY_LABEL[c.inModule][1] : c.inModule) + '</span>' : '';
          var other = c.otherSets ? '<span class="pill warn">다른 세트 ' + c.otherSets + '곳</span>' : '';
          return '<div class="qrow"><div class="sid">' + esc(c.sourceId || c.id) + '</div><div class="mid"><div class="l1"><span class="pill ' + c.difficulty + '">' + (DIFF[c.difficulty] || '') + '</span><span class="muted">' + esc(c.domain) + ' · ' + esc(c.skill) + '</span>' + tag + other + '</div><div class="l2">' + esc(c.snippet) + '</div></div>' +
            '<button class="btn sm primary" data-q="' + esc(c.id) + '">선택</button></div>';
        }).join('') || '<p class="muted" style="padding:1rem">조건에 맞는 문항이 없습니다.</p>';
        $('cand').querySelectorAll('[data-q]').forEach(function (b) {
          b.onclick = function () {
            run(b, function () {
              return api('/sets/' + d.set.id + '/items', { method: 'PUT', body: { module: key, position: position, questionId: b.getAttribute('data-q') } }).then(function (r) {
                S.detail = r; closeModal(); renderSet();
              });
            });
          };
        });
      }).catch(function (e) { $('cand').innerHTML = '<p class="error" style="padding:1rem;color:#b42318">' + esc(e.message) + '</p>'; });
    };
    $('pSearch').oninput = function () { clearTimeout(timer); timer = setTimeout(load, 250); };
    $('pDiff').onchange = load;
    $('pDom').onchange = load;
    $('pSearch').focus();
    load();
    void m;
  }

  function domainOptions(key) {
    var rw = ['Craft and Structure', 'Information and Ideas', 'Standard English Conventions', 'Expression of Ideas'];
    var math = ['Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry'];
    var out = {};
    (key.indexOf('rw') === 0 ? rw : math).forEach(function (x) { out[x] = 1; });
    return out;
  }

  // ------------------------------------------------------------ assignments

  function assignTarget(a) {
    return a.targetType === 'student' ? esc(a.studentName) + ' <span class="muted small">(' + esc(a.className) + ')</span>' : esc(a.className) + ' <span class="muted small">전체</span>';
  }

  function renderAssignList() {
    var box = $('assigns');
    if (!box) return;
    if (!S.assignments.length) { box.innerHTML = '<p class="muted small" style="margin:0">아직 배정한 반이 없습니다. 세트를 배포 가능 상태로 바꾼 뒤 “시험 부여”를 눌러 주세요.</p>'; return; }
    box.innerHTML = assignTable(S.assignments, false);
    bindAssignRows(box);
  }

  function assignTable(list, withSet) {
    return '<table class="tbl"><thead><tr>' + (withSet ? '<th>세트</th>' : '') + '<th>대상</th><th>시작</th><th>마감</th><th class="num">응시</th><th class="num">완료</th></tr></thead><tbody>' +
      list.map(function (a) {
        return '<tr class="click" data-a="' + esc(a.id) + '">' + (withSet ? '<td><b>' + esc(a.setName) + '</b></td>' : '') + '<td>' + assignTarget(a) + '</td><td>' + fmt(a.availableFrom) + '</td><td>' + fmt(a.dueAt) + '</td><td class="num">' + (a.started || 0) + '</td><td class="num">' + (a.completed || 0) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function bindAssignRows(box) {
    box.querySelectorAll('[data-a]').forEach(function (tr) { tr.onclick = function () { openAssignment(tr.getAttribute('data-a')); }; });
  }

  function renderAssigned() {
    var main = $('main');
    main.innerHTML = '<div class="toolbar"><div><h2>배정 현황</h2><div class="small muted" style="margin-top:.2rem">반별 진행 상황과 점수를 확인합니다. 줄을 누르면 학생별 결과가 열립니다.</div></div></div><div class="card" id="allAssigns"><p class="muted">불러오는 중…</p></div>';
    api('/assignments').then(function (r) {
      var box = $('allAssigns');
      if (!r.assignments.length) { box.innerHTML = '<div class="empty"><b>배정한 시험이 없습니다</b>시험 세트에서 “시험 부여”를 눌러 반이나 학생에게 시험을 내 보세요.</div>'; return; }
      box.innerHTML = assignTable(r.assignments, true);
      bindAssignRows(box);
    }).catch(function (e) { $('allAssigns').innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; });
  }

  function openAssign() {
    var set = S.detail.set;
    var m = openModal({
      title: '시험 부여 — ' + set.name,
      body: '<label class="f" style="margin-top:.2rem">반</label><select id="aClass" style="width:100%"><option value="">불러오는 중…</option></select>' +
        '<label class="f">대상</label><label class="opt"><input type="radio" name="scope" value="class" checked><b>반 전체</b></label><label class="opt"><input type="radio" name="scope" value="students"><b>학생 선택</b></label>' +
        '<div id="rosterBox" class="hidden" style="margin-top:.6rem"></div>' +
        '<div class="row" style="margin-top:.2rem"><div class="grow"><label class="f">시작</label><input type="datetime-local" id="aFrom" style="width:100%"></div><div class="grow"><label class="f">마감</label><input type="datetime-local" id="aDue" style="width:100%"></div></div>' +
        '<div id="aWarn"></div>' +
        '<p class="small muted">학생은 마감 전까지 언제든 시작할 수 있고, 시작하면 모듈마다 정해진 시간이 서버에서 흘러갑니다. 마감 시각은 한국 시간(KST)으로 안내됩니다.</p>',
      footer: '<button class="btn" data-close>취소</button><button class="btn primary" id="aGo">부여하기</button>'
    });
    m.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeModal; });
    var now = new Date();
    $('aFrom').value = toLocalInput(now);
    var due = new Date(now.getTime() + 7 * 86400000); due.setHours(23, 59, 0, 0);
    $('aDue').value = toLocalInput(due);
    var roster = [];
    api('/classes').then(function (r) {
      $('aClass').innerHTML = '<option value="">반을 선택하세요</option>' + r.classes.map(function (c) { return '<option value="' + esc(c.classId) + '" data-name="' + esc(c.className) + '">' + esc(c.className) + '</option>'; }).join('');
    }).catch(function (e) { $('aClass').innerHTML = '<option value="">' + esc(e.message) + '</option>'; });

    var scope = function () { return m.querySelector('input[name=scope]:checked').value; };
    var loadRoster = function () {
      var cid = $('aClass').value;
      $('aWarn').innerHTML = '';
      roster = [];
      $('rosterBox').innerHTML = '';
      if (!cid) return;
      $('rosterBox').classList.toggle('hidden', scope() !== 'students');
      api('/classes/' + encodeURIComponent(cid) + '/roster').then(function (r) {
        roster = r.students;
        $('rosterBox').innerHTML = '<div class="roster">' + r.students.map(function (s) {
          return '<label><input type="checkbox" value="' + esc(s.studentId) + '"> ' + esc(s.name) + '</label>';
        }).join('') + '</div>';
        checkOverlap();
      }).catch(function (e) { $('rosterBox').innerHTML = '<div class="banner bad small">' + esc(e.message) + '</div>'; });
      checkOverlap();
    };
    var selected = function () {
      return Array.prototype.map.call($('rosterBox').querySelectorAll('input:checked'), function (i) { return i.value; });
    };
    var checkOverlap = function () {
      var cid = $('aClass').value;
      if (!cid) return;
      var ids = scope() === 'students' ? selected() : [];
      var body = ids.length ? { studentIds: ids } : { classId: cid };
      api('/sets/' + set.id + '/overlap', { method: 'POST', body: body }).then(function (r) {
        var hit = r.overlap.filter(function (x) { return x.seen > 0; });
        if (!hit.length) { $('aWarn').innerHTML = ''; return; }
        var names = {};
        roster.forEach(function (s) { names[s.studentId] = s.name; });
        $('aWarn').innerHTML = '<div class="banner warn small"><b>이미 풀어 본 문항이 있는 학생이 ' + hit.length + '명 있습니다.</b><br>' +
          hit.slice(0, 6).map(function (x) { return esc(names[x.studentId] || x.studentId) + ' ' + x.seen + '문항'; }).join(', ') + (hit.length > 6 ? ' 외' : '') + '</div>';
      }).catch(function () { /* the warning is optional */ });
    };
    $('aClass').onchange = loadRoster;
    m.querySelectorAll('input[name=scope]').forEach(function (r) {
      r.onchange = function () { $('rosterBox').classList.toggle('hidden', scope() !== 'students'); checkOverlap(); };
    });
    $('rosterBox').onchange = checkOverlap;
    $('aGo').onclick = function () {
      var cid = $('aClass').value;
      if (!cid) { toast('반을 선택해 주세요.'); return; }
      var ids = scope() === 'students' ? selected() : [];
      if (scope() === 'students' && !ids.length) { toast('학생을 한 명 이상 선택해 주세요.'); return; }
      if (!$('aFrom').value || !$('aDue').value) { toast('시작과 마감 시각을 입력해 주세요.'); return; }
      run($('aGo'), function () {
        return api('/sets/' + set.id + '/assign', {
          method: 'POST',
          body: { classId: cid, studentIds: ids, availableFrom: new Date($('aFrom').value).toISOString(), dueAt: new Date($('aDue').value).toISOString() }
        }).then(function () {
          closeModal();
          toast('시험을 부여했습니다. 학생 홈 화면에 “SAT 모의고사” 카드가 나타납니다.');
          return openSet(set.id);
        });
      });
    };
  }

  function openAssignment(id) {
    var m = openModal({ title: '학생별 진행 상황', wide: true, body: '<p class="muted">불러오는 중…</p>' });
    api('/assignments/' + encodeURIComponent(id)).then(function (d) {
      var a = d.assignment;
      var pill = function (st) { return st === 'completed' ? '<span class="pill ok">완료</span>' : st === 'in_progress' ? '<span class="pill blue">진행 중</span>' : '<span class="pill">시작 전</span>'; };
      var rows = d.students.map(function (s) {
        return '<tr><td><b>' + esc(s.name) + '</b></td><td>' + pill(s.status) + '</td><td class="num">' + (s.total != null ? '<b>' + s.total + '</b>' : '—') + '</td>' +
          '<td class="num">' + (s.rw != null ? s.rw : '—') + '</td><td class="num">' + (s.math != null ? s.math : '—') + '</td><td>' + fmt(s.completedAt || s.startedAt) + '</td>' +
          '<td>' + (s.status === 'completed' ? '<button class="btn sm" data-res="' + esc(s.sessionId) + '">결과 보기</button>' : '') + '</td></tr>';
      }).join('');
      var done = d.students.filter(function (s) { return s.status === 'completed'; });
      var avg = done.length ? Math.round(done.reduce(function (t, s) { return t + (s.total || 0); }, 0) / done.length) : null;
      m.querySelector('.body').innerHTML =
        '<div class="row" style="margin-bottom:.6rem"><div><b style="font-size:1.05rem">' + esc(a.setName) + '</b><div class="small muted">' + assignTarget(a) + ' · ' + fmt(a.availableFrom) + ' ~ ' + fmt(a.dueAt) + '</div></div><span class="grow"></span>' +
        '<span class="pill blue">완료 ' + done.length + ' / ' + d.students.length + '</span>' + (avg != null ? '<span class="pill ok">평균 ' + avg + '</span>' : '') +
        '<button class="btn danger sm" id="rmAssign">배정 취소</button></div>' +
        '<div class="small muted" style="margin-bottom:.4rem">점수는 College Board 환산표가 공개되지 않아 추정한 값입니다.</div>' +
        '<table class="tbl"><thead><tr><th>학생</th><th>상태</th><th class="num">총점</th><th class="num">R&amp;W</th><th class="num">Math</th><th>최근</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
      m.querySelectorAll('[data-res]').forEach(function (b) { b.onclick = function () { openResult(b.getAttribute('data-res'), id); }; });
      $('rmAssign').onclick = function () {
        if (!confirm('이 배정을 취소할까요? 학생 화면에서 사라집니다. 이미 응시한 기록은 남습니다.')) return;
        run(this, function () {
          return api('/assignments/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
            closeModal(); toast('배정을 취소했습니다.');
            if (S.view === 'set') return openSet(S.detail.set.id);
            render();
          });
        });
      };
    }).catch(function (e) { m.querySelector('.body').innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; });
  }

  function openResult(sessionId, backId) {
    var m = openModal({ title: '응시 결과', wide: true, body: '<p class="muted">불러오는 중…</p>', footer: backId ? '<button class="btn" id="resBack">← 학생 목록</button>' : '' });
    if (backId) $('resBack').onclick = function () { openAssignment(backId); };
    api('/sessions/' + encodeURIComponent(sessionId) + '/result').then(function (d) {
      var r = d.result;
      if (!r) { m.querySelector('.body').innerHTML = '<p class="muted">아직 끝내지 않은 응시입니다.</p>'; return; }
      var sum = r.summary || {};
      var route = function (x) { return x === 'hard' ? '상위 난이도' : '표준 난이도'; };
      var domains = (sum.domains || []).slice().sort(function (a, b) { return a.section === b.section ? a.domain.localeCompare(b.domain) : (a.section === 'rw' ? -1 : 1); });
      var bars = domains.map(function (x) {
        var p = x.total ? Math.round(x.correct / x.total * 100) : 0;
        return '<div class="brow"><div>' + esc(x.domain) + ' <span class="muted">(' + (x.section === 'rw' ? 'R&amp;W' : 'Math') + ')</span></div><div class="btrack"><span class="' + (p < 60 ? 'low' : '') + '" style="width:' + p + '%"></span></div><div style="text-align:right"><b>' + x.correct + '/' + x.total + '</b></div></div>';
      }).join('');
      var by = {};
      r.questions.forEach(function (q) { (by[q.step] = by[q.step] || []).push(q); });
      var maps = ['rw1', 'rw2', 'm1', 'm2'].filter(function (s) { return by[s]; }).map(function (s) {
        return '<div class="small" style="font-weight:700;margin-top:.5rem">' + esc(by[s][0].moduleTitle) + '</div><div class="chips">' + by[s].map(function (q) {
          return '<span class="chip ' + (!q.answered ? 'skip' : q.correct ? 'ok' : 'no') + '" title="' + esc(q.sourceId + ' · ' + q.domain + ' · ' + q.skill + ' · ' + Math.round(q.timeMs / 1000) + '초') + '">' + q.position + '</span>';
        }).join('') + '</div>';
      }).join('');
      m.querySelector('header h3').textContent = '응시 결과 — ' + d.session.studentName;
      m.querySelector('.body').innerHTML =
        '<div class="scores"><div class="sc main"><div class="l">총점 (추정)</div><div class="v">' + (sum.total != null ? sum.total : '—') + '</div><div class="s">400–1600</div></div>' +
        '<div class="sc"><div class="l">Reading &amp; Writing</div><div class="v">' + (sum.rw ? sum.rw.scaled : '—') + '</div><div class="s">' + (sum.rw ? sum.rw.correct + '/' + sum.rw.total + ' 정답 · 모듈 2 ' + route(sum.rw.route) : '') + '</div></div>' +
        '<div class="sc"><div class="l">Math</div><div class="v">' + (sum.math ? sum.math.scaled : '—') + '</div><div class="s">' + (sum.math ? sum.math.correct + '/' + sum.math.total + ' 정답 · 모듈 2 ' + route(sum.math.route) : '') + '</div></div></div>' +
        '<h3 style="margin-top:1rem">영역별 정답률</h3>' + bars +
        '<h3 style="margin-top:1.2rem">문항별 결과 <span class="small muted" style="font-weight:400">(초록 정답 · 빨강 오답 · 회색 무응답, 마우스를 올리면 문항 정보)</span></h3>' + maps +
        '<div class="small muted">풀이에 쓴 시간 약 ' + Math.max(1, Math.round((sum.timeMs || 0) / 60000)) + '분</div>';
    }).catch(function (e) { m.querySelector('.body').innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; });
  }

  // ---------------------------------------------------------------- statistics

  function renderStats() {
    var main = $('main');
    main.innerHTML = '<p class="muted">통계를 불러오는 중…</p>';
    var q = [];
    if (S.statsFilter.setId) q.push('setId=' + encodeURIComponent(S.statsFilter.setId));
    if (S.statsFilter.classId) q.push('classId=' + encodeURIComponent(S.statsFilter.classId));
    api('/stats/overview' + (q.length ? '?' + q.join('&') : '')).then(function (d) {
      if (S.view !== 'stats') return;
      S.stats = d;
      drawStats(d);
    }).catch(function (e) { main.innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; });
  }

  function rateClass(p) { return p < 50 ? 'bad' : p < 70 ? 'mid' : 'good'; }

  function skillBars(list, limit) {
    if (!list.length) return '<div class="empty">아직 채점된 응시가 없습니다.</div>';
    return list.slice(0, limit).map(function (k) {
      return '<div class="sk"><div class="n" title="' + esc(k.domain) + '">' + esc(k.skill) + ' <small>' + (k.section === 'rw' ? 'R&amp;W' : 'Math') + ' · ' + k.attempts + '문항</small></div>' +
        '<div class="btrack"><span class="' + rateClass(k.correctRate) + '" style="width:' + k.correctRate + '%"></span></div><div style="text-align:right"><b>' + k.correctRate + '%</b></div></div>';
    }).join('');
  }

  function drawStats(d) {
    var c = d.counts, sc = d.scores, f = d.filters || { classes: [], sets: [] };
    var sel = S.statsFilter;
    var opts = function (list, key, name, cur, all) {
      return '<option value="">' + all + '</option>' + list.map(function (x) {
        return '<option value="' + esc(x[key]) + '"' + (String(x[key]) === String(cur) ? ' selected' : '') + '>' + esc(x[name]) + '</option>';
      }).join('');
    };
    var head = '<div class="row"><h2 class="grow">응시 통계</h2><button class="btn" id="stRefresh">새로고침</button></div>' +
      '<div class="filters"><select id="stSet">' + opts(f.sets, 'id', 'name', sel.setId, '모든 시험 세트') + '</select>' +
      '<select id="stClass">' + opts(f.classes, 'classId', 'className', sel.classId, '모든 반') + '</select>' +
      '<span class="small muted">교사 미리보기 응시는 통계에 포함되지 않습니다. 점수는 추정치입니다.</span></div>';
    if (!c.sessions) {
      $('main').innerHTML = head + '<div class="panel empty" style="margin-top:1rem">아직 응시 기록이 없습니다. 학생이 시험을 시작하면 여기에 통계가 채워집니다.</div>';
      bindStatsFilters();
      return;
    }
    var has = sc.avg != null;
    var kpi = function (cls, l, v, s) { return '<div class="kpi ' + cls + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + (s || '&nbsp;') + '</div></div>'; };
    var partPct = c.sessions ? Math.round(c.completed / c.sessions * 100) : 0;
    var kpis = '<div class="kpis">' +
      kpi('navy', '평균 총점', has ? sc.avg : '—', has ? '중앙값 ' + sc.median : '완료된 응시 없음') +
      kpi('', '응시 완료', c.completed + '<span style="font-size:1rem;color:var(--muted)"> / ' + c.sessions + '</span>', partPct + '% · 응시 중 ' + c.inProgress + '명 · 학생 ' + c.students + '명') +
      kpi('', '최고 / 최저', has ? sc.max + ' / ' + sc.min : '—', '') +
      kpi('', 'R&amp;W 평균', has ? sc.avgRw : '—', has && d.routes.rwHardPct != null ? '상위 모듈 2 ' + d.routes.rwHardPct + '%' : '') +
      kpi('', 'Math 평균', has ? sc.avgMath : '—', has && d.routes.mathHardPct != null ? '상위 모듈 2 ' + d.routes.mathHardPct + '%' : '') +
      kpi('', '평균 풀이 시간', has ? (d.time.avgRwMin + d.time.avgMathMin) + '분' : '—', has ? 'R&amp;W ' + d.time.avgRwMin + '분 · Math ' + d.time.avgMathMin + '분' : '') +
      kpi('', '오답 복습 완료', d.review.total ? d.review.pct + '%' : '—', d.review.total ? d.review.done + ' / ' + d.review.total + '문항' : '복습할 오답 없음') +
      '</div>';
    var maxN = Math.max.apply(null, sc.distribution.map(function (b) { return b.n; }).concat([1]));
    var hist = '<div class="hist">' + sc.distribution.map(function (b) {
      return '<div class="col"><div class="bar' + (b.n ? '' : ' zero') + '" style="height:' + (b.n ? Math.max(4, Math.round(b.n / maxN * 100)) : 2) + '%">' + (b.n ? '<b>' + b.n + '</b>' : '') + '</div><div class="lab">' + b.from + '</div></div>';
    }).join('') + '</div>';
    var weak = d.skills.filter(function (k) { return k.attempts >= 1; });
    var grids = '<div class="grid2"><div class="panel"><h3>총점 분포 <span class="small muted" style="font-weight:400">(100점 구간)</span></h3>' + (has ? hist : '<div class="empty">완료된 응시가 없습니다.</div>') + '</div>' +
      '<div class="panel"><h3>취약 유형 <span class="small muted" style="font-weight:400">(정답률 낮은 순)</span></h3>' + skillBars(weak, 9) + '</div></div>';
    var hard = '<div class="panel"><h3>가장 많이 틀린 문항</h3>' + (d.hardest.length ? '<table class="tbl"><thead><tr><th>문항</th><th>유형</th><th>난이도</th><th class="num">응시</th><th class="num">오답률</th><th>가장 많은 오답</th><th class="num">평균 시간</th></tr></thead><tbody>' +
      d.hardest.slice(0, 15).map(function (h) {
        return '<tr><td><b style="font-family:ui-monospace,monospace">' + esc(h.sourceId) + '</b><div class="small muted" style="max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(h.snippet) + '</div></td>' +
          '<td>' + esc(h.skill) + '<div class="small muted">' + (h.section === 'rw' ? 'R&amp;W' : 'Math') + '</div></td><td><span class="pill ' + esc(h.difficulty) + '">' + esc(DIFF[h.difficulty] || h.difficulty) + '</span></td>' +
          '<td class="num">' + h.attempts + '</td><td class="num"><b style="color:' + (h.wrongRate >= 60 ? 'var(--bad)' : 'inherit') + '">' + h.wrongRate + '%</b></td>' +
          '<td>' + (h.topWrong ? esc(h.topWrong.answer) + ' <span class="small muted">(' + h.topWrong.n + '명)</span>' : '—') + (h.blank ? ' <span class="small muted">· 무응답 ' + h.blank + '</span>' : '') + '</td><td class="num">' + h.avgSec + '초</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">아직 데이터가 없습니다.</div>') + '</div>';
    var st = '<div class="panel" style="margin-top:1rem"><h3>학생별 현황 <span class="small muted" style="font-weight:400">(이름을 누르면 상세 추이)</span></h3><table class="tbl"><thead><tr><th>학생</th><th>반</th><th>시험</th><th>상태</th><th class="num">총점</th><th class="num">R&amp;W</th><th class="num">Math</th><th>일시</th><th class="num">오답 복습</th></tr></thead><tbody>' +
      d.students.map(function (s) {
        var pill = s.status === 'completed' ? '<span class="pill ok">완료</span>' : '<span class="pill warn">응시 중</span>';
        return '<tr class="click" data-st="' + esc(s.studentId) + '"><td><b>' + esc(s.name) + '</b></td><td>' + esc(s.className || '') + '</td><td>' + esc(s.setName) + '</td><td>' + pill + '</td>' +
          '<td class="num"><b>' + (s.total != null ? s.total : '—') + '</b></td><td class="num">' + (s.rw != null ? s.rw : '—') + '</td><td class="num">' + (s.math != null ? s.math : '—') + '</td>' +
          '<td>' + fmt(s.completedAt || s.startedAt) + '</td><td class="num">' + (s.reviewTotal ? s.reviewDone + ' / ' + s.reviewTotal : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('main').innerHTML = head + kpis + grids + hard + st;
    bindStatsFilters();
    document.querySelectorAll('tr[data-st]').forEach(function (r) { r.onclick = function () { openStudentStats(r.getAttribute('data-st')); }; });
  }

  function bindStatsFilters() {
    var go = function () { S.statsFilter = { setId: $('stSet').value, classId: $('stClass').value }; renderStats(); };
    $('stSet').onchange = go;
    $('stClass').onchange = go;
    $('stRefresh').onclick = renderStats;
  }

  function trendSvg(sessions) {
    var pts = sessions.filter(function (s) { return s.total != null; }).slice().reverse();
    if (pts.length < 1) return '<div class="empty">완료된 응시가 없습니다.</div>';
    var W = 760, H = 190, L = 44, R = 18, T = 26, B = 34;
    var x = function (i) { return pts.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (pts.length - 1); };
    var y = function (v) { return T + (1600 - v) / 1200 * (H - T - B); };
    var grid = [400, 800, 1200, 1600].map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#e4ebf5"/><text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="#5d6b82">' + v + '</text>';
    }).join('');
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.total).toFixed(1); }).join(' ');
    var dots = pts.map(function (p, i) {
      return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.total).toFixed(1) + '" r="5" fill="#0a58ca" stroke="#fff" stroke-width="2"><title>' + esc(p.setName) + ' · ' + p.total + '</title></circle>' +
        '<text x="' + x(i).toFixed(1) + '" y="' + (y(p.total) - 10).toFixed(1) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14213a">' + p.total + '</text>' +
        '<text x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="10.5" fill="#5d6b82">' + esc(new Date(p.completedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })) + '</text>';
    }).join('');
    return '<svg class="trend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="점수 추이">' + grid + (pts.length > 1 ? '<path d="' + line + '" fill="none" stroke="#0a58ca" stroke-width="2.5"/>' : '') + dots + '</svg>';
  }

  function openStudentStats(studentId) {
    var m = openModal({ title: '학생 통계', wide: true, body: '<p class="muted">불러오는 중…</p>', footer: '<button class="btn" data-close>닫기</button>' });
    m.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeModal; });
    var qs = S.statsFilter.classId ? '?classId=' + encodeURIComponent(S.statsFilter.classId) : '';
    api('/stats/students/' + encodeURIComponent(studentId) + qs).then(function (d) {
      m.querySelector('header h3').textContent = d.student.name + (d.student.className ? ' · ' + d.student.className : '');
      var rows = d.sessions.map(function (s) {
        return '<tr><td>' + esc(s.setName) + '</td><td>' + (s.status === 'completed' ? '<span class="pill ok">완료</span>' : '<span class="pill warn">응시 중</span>') + '</td>' +
          '<td class="num"><b>' + (s.total != null ? s.total : '—') + '</b></td><td class="num">' + (s.rw != null ? s.rw : '—') + '</td><td class="num">' + (s.math != null ? s.math : '—') + '</td><td>' + fmt(s.completedAt || s.startedAt) + '</td>' +
          '<td>' + (s.status === 'completed' ? '<button class="btn sm" data-res="' + esc(s.sessionId) + '">결과</button>' : '') + '</td></tr>';
      }).join('');
      var rv = d.review;
      var open = (rv.openBySkill || []).slice(0, 6).map(function (k) {
        return '<div class="sk"><div class="n">' + esc(k.skill) + ' <small>' + (k.section === 'rw' ? 'R&amp;W' : 'Math') + '</small></div><div></div><div style="text-align:right"><b>' + k.open + '</b></div></div>';
      }).join('');
      m.querySelector('.body').innerHTML =
        '<h3>점수 추이</h3>' + trendSvg(d.sessions) +
        '<div class="grid2" style="margin:.4rem 0"><div><h3>취약 유형</h3>' + skillBars(d.skills.filter(function (k) { return k.attempts >= 1; }), 7) + '</div>' +
        '<div><h3>오답 복습 <span class="small muted" style="font-weight:400">' + (rv.total ? rv.done + ' / ' + rv.total + ' 완료' : '') + '</span></h3>' +
        (rv.total ? '<div class="btrack" style="margin:.2rem 0 .8rem"><span style="width:' + Math.round(rv.done / rv.total * 100) + '%"></span></div>' + (open ? '<div class="small muted">남은 문항 (유형별)</div>' + open : '<div class="small" style="color:var(--ok);font-weight:700">모두 복습 완료</div>') : '<div class="empty">복습할 오답이 없습니다.</div>') + '</div></div>' +
        '<h3 style="margin-top:1rem">응시 기록</h3><table class="tbl"><thead><tr><th>시험</th><th>상태</th><th class="num">총점</th><th class="num">R&amp;W</th><th class="num">Math</th><th>일시</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
      m.querySelectorAll('[data-res]').forEach(function (b) { b.onclick = function () { openResult(b.getAttribute('data-res')); }; });
    }).catch(function (e) { m.querySelector('.body').innerHTML = '<div class="banner bad">' + esc(e.message) + '</div>'; });
  }

  render();
})();
