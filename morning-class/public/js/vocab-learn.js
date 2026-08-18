/**
 * Student Vocab Learner — Placement Test + Step Cards + AI Deep-Dive (DB-free first).
 * Expects window.MrParkVocabData from vocab-mock-data.js and Student portal api()/TOKEN patterns via hooks.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY_PREFIX = 'mrpark_vocab_placement_v2:';
  var LEGACY_STORAGE_KEY = 'mrpark_vocab_placement_v1';
  var PLACEMENT_MIN = 15;
  var PLACEMENT_MAX = 24;
  var QUESTION_COUNT = PLACEMENT_MAX; // progress denominator / legacy label
  var QUESTION_SECONDS = 60;
  var PLACEMENT_SECONDS = QUESTION_SECONDS;
  var state = {
    view: 'home', // home | quiz | result | quest
    abilityGrade: 6,
    abilityTrail: [],
    avoidWordIds: [],
    questionIndex: 0,
    answers: [],
    currentQ: null,
    qStartedAt: 0,
    timerEndsAt: 0,
    locked: false,
    selectedChoice: null,
    placementTimerId: null,
    placementTickId: null,
    pauseUsed: false,
    paused: false,
    pauseRemainingMs: 0,
    schoolGrade: null,
    placementStartGrade: 4,
    startAbility: 4,
    placement: null,
    placementDone: false,
    deckIndex: 0,
    deck: [],
    mastery: null,
    promotionScore: 0,
    promotionScoreMax: 400,
    promotionPercent: 0,
    shieldCount: 0,
    decayWarning: false,
    summary: null,
    promotionTest: null,
    sessionStudentId: '',
    _bound: false,
    _summaryReq: 0
  };

  var promo = {
    active: false,
    roundId: null,
    roundNumber: 1,
    questions: [],
    index: 0,
    answers: [],
    selectedChoice: null,
    locked: false,
    timerId: null,
    tickId: null,
    timerEndsAt: 0,
    status: null
  };

  function currentStudentId() {
    try {
      if (typeof root.getLoggedInStudentId === 'function') {
        var fromFn = String(root.getLoggedInStudentId() || '').trim();
        if (fromFn) return fromFn;
      }
    } catch (e) { /* ignore */ }
    try {
      var raw = localStorage.getItem('salt_student_profile') ||
        localStorage.getItem('mrpark_student_profile') ||
        sessionStorage.getItem('mrpark_student_profile') || '';
      if (!raw) return '';
      var p = JSON.parse(raw);
      return String((p && (p.studentId || p.id)) || '').trim();
    } catch (err) {
      return '';
    }
  }

  function storageKeyForStudent() {
    var sid = currentStudentId();
    return sid ? (STORAGE_KEY_PREFIX + sid) : '';
  }

  function data() {
    return root.MrParkVocabData || null;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadSaved() {
    try {
      var key = storageKeyForStudent();
      if (!key) return null;
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.result) return null;
      // Ignore cache that belongs to a different login.
      if (parsed.studentId && parsed.studentId !== currentStudentId()) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearSavedPlacement() {
    try {
      var key = storageKeyForStudent();
      if (key) localStorage.removeItem(key);
      // Old shared key leaked one student's tier onto every login on the same device.
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  function savePlacement(result) {
    var sid = currentStudentId();
    try {
      var key = storageKeyForStudent();
      if (key) {
        localStorage.setItem(key, JSON.stringify({
          at: Date.now(),
          studentId: sid,
          result: result
        }));
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (e) { /* ignore */ }
    state.placement = result;
  }

  function apiFetch(path, opts) {
    opts = opts || {};
    if (typeof root.mrParkStudentApi === 'function') {
      // Student portal api() JSON.stringifies object bodies.
      return root.mrParkStudentApi(path, opts);
    }
    var token = '';
    try {
      token = localStorage.getItem('salt_student_token') ||
        localStorage.getItem('mrpark_student_token') || '';
    } catch (e) {}
    var base = (root.NODE_API || location.origin || '').replace(/\/$/, '');
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    var body = opts.body;
    if (body != null && typeof body !== 'string') body = JSON.stringify(body);
    return fetch(base + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: body
    }).then(function (res) {
      return res.json().then(function (payload) {
        if (!res.ok) throw new Error((payload && payload.error) || 'Request failed');
        return payload;
      });
    });
  }

  function blankQuest() {
    return {
      queue: [],
      masterQueue: [],
      targetCount: 10,
      passThreshold: 100,
      studyIndex: 0,
      studyMaxIndex: 0,
      phase: 'idle', // idle | study | test | done
      testIndex: 0,
      testWords: [],
      testTypes: [],
      testAnswers: [],
      currentTestQ: null,
      locked: false,
      selectedChoice: null,
      qStartedAt: 0,
      timerEndsAt: 0,
      timerId: null,
      tickId: null,
      pauseUsed: false,
      paused: false,
      pauseRemainingMs: 0,
      sessionsCompleted: 0,
      maxSessions: 3,
      forceAnotherSet: false,
      alreadyPassedToday: false,
      isRetryAttempt: false,
      retryWordIds: {}
    };
  }

  var quest = blankQuest();

  /**
   * Wipe in-memory vocab UI when the logged-in student changes (logout / switch account).
   */
  function resetVocabSession(opts) {
    opts = opts || {};
    clearPlacementTimer();
    clearQuestTestTimer();
    state.view = 'home';
    state.abilityGrade = 6;
    state.abilityTrail = [];
    state.avoidWordIds = [];
    state.questionIndex = 0;
    state.answers = [];
    state.currentQ = null;
    state.locked = false;
    state.selectedChoice = null;
    state.pauseUsed = false;
    state.paused = false;
    state.pauseRemainingMs = 0;
    state.schoolGrade = null;
    state.placementStartGrade = 4;
    state.startAbility = 4;
    state.placement = null;
    state.placementDone = false;
    state.deckIndex = 0;
    state.deck = [];
    state.mastery = null;
    state.promotionScore = 0;
    state.promotionScoreMax = 400;
    state.promotionPercent = 0;
    state.shieldCount = 0;
    state.decayWarning = false;
    state.summary = null;
    state.promotionTest = null;
    if (!opts.keepSessionId) state.sessionStudentId = '';

    clearPromoTimer();
    promo.active = false;
    promo.roundId = null;
    promo.questions = [];
    promo.answers = [];
    promo.index = 0;
    promo.status = null;
    hidePromoModal();

    var fresh = blankQuest();
    Object.keys(fresh).forEach(function (k) { quest[k] = fresh[k]; });

    var questBody = $('vocabQuestBody');
    if (questBody) questBody.innerHTML = '';
    var quizBody = $('vocabQuizBody');
    if (quizBody) quizBody.innerHTML = '';
    var resultBody = $('vocabResultBody');
    if (resultBody) resultBody.innerHTML = '';

    setView('home');
    renderHomeStats();
    syncPlacementVisibility();
  }

  function ensureStudentSession() {
    var sid = currentStudentId();
    if (!sid) {
      if (state.sessionStudentId || state.placement || state.placementDone) {
        resetVocabSession();
      }
      return false;
    }
    if (state.sessionStudentId && state.sessionStudentId !== sid) {
      resetVocabSession({ keepSessionId: true });
    }
    state.sessionStudentId = sid;
    return true;
  }

  var TIER_BADGES = {
    Rookie: { icon: 'fa-seedling', className: 'tier-rookie' },
    Iron: { icon: 'fa-shield-halved', className: 'tier-iron' },
    Bronze: { icon: 'fa-medal', className: 'tier-bronze' },
    Silver: { icon: 'fa-medal', className: 'tier-silver' },
    Gold: { icon: 'fa-medal', className: 'tier-gold' },
    Platinum: { icon: 'fa-gem', className: 'tier-platinum' },
    Emerald: { icon: 'fa-gem', className: 'tier-emerald' },
    Diamond: { icon: 'fa-gem', className: 'tier-diamond' },
    Ascendant: { icon: 'fa-star', className: 'tier-ascendant' },
    Master: { icon: 'fa-crown', className: 'tier-master' },
    Grandmaster: { icon: 'fa-crown', className: 'tier-grandmaster' },
    Legend: { icon: 'fa-trophy', className: 'tier-legend' }
  };
  var TIER_LADDER = Object.keys(TIER_BADGES);

  function setView(view) {
    state.view = view;
    ['vocabQuizPane', 'vocabResultPane'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.classList.toggle('is-active', (id === 'vocabQuizPane' && view === 'quiz') ||
        (id === 'vocabResultPane' && view === 'result'));
    });
    var needs = $('vocabNeedsPlacement');
    var placed = $('vocabPlacedFlow');
    var inPlacementUi = view === 'quiz' || view === 'result';
    // Student portal uses `.hidden` (not Bootstrap `.d-none`).
    if (needs) needs.classList.toggle('hidden', !!state.placementDone || inPlacementUi);
    if (placed) placed.classList.toggle('hidden', !state.placementDone || inPlacementUi);
    renderHomeStats();
    syncPlacementVisibility();
  }

  function syncPlacementVisibility() {
    var placed = !!state.placementDone;
    var needs = $('vocabNeedsPlacement');
    var flow = $('vocabPlacedFlow');
    var inPlacementUi = state.view === 'quiz' || state.view === 'result';
    if (needs) needs.classList.toggle('hidden', placed || inPlacementUi);
    if (flow) flow.classList.toggle('hidden', !placed || inPlacementUi);
  }

  function applyServerSummary(summary) {
    if (!summary) return;
    state.summary = summary;
    state.mastery = summary.mastery || null;
    state.promotionScore = Number(summary.promotionScore) || 0;
    state.promotionScoreMax = Number(summary.promotionScoreMax) || 400;
    state.promotionPercent = Number(summary.promotionPercent) || 0;
    state.shieldCount = Math.max(0, Math.round(Number(summary.shieldCount) || 0));
    state.decayWarning = !!(summary.decayWarning || summary.decay_warning);
    state.promotionTest = summary.promotionTest || null;
    // Server is authoritative. Never keep a cached tier when placement is unfinished.
    state.placementDone = !!summary.placementDone;
    if (summary.schoolGrade != null) state.schoolGrade = summary.schoolGrade;
    else state.schoolGrade = null;
    state.placementStartGrade = summary.placementStartGrade != null
      ? Number(summary.placementStartGrade)
      : (state.schoolGrade != null ? Number(state.schoolGrade) : 4);
    if (!Number.isFinite(state.placementStartGrade) || state.placementStartGrade < 1 || state.placementStartGrade > 12) {
      state.placementStartGrade = 4;
    }
    if (summary.placementDone) {
      state.placement = {
        gradeLevel: summary.gradeLevel,
        accuracy: summary.placementAccuracy,
        tier: { name: summary.tierName, gradeLevel: summary.gradeLevel }
      };
      savePlacement(state.placement);
    } else {
      clearSavedPlacement();
      state.placement = null;
    }
    if (summary.settings && summary.settings.passThreshold != null) {
      quest.passThreshold = summary.settings.passThreshold;
    }
    if (summary.today) {
      quest.sessionsCompleted = summary.today.sessionsCompleted || 0;
      quest.maxSessions = summary.today.maxSessions || 3;
      quest.alreadyPassedToday = !!summary.today.testPassed;
    }
    renderHomeStats();
    syncPlacementVisibility();
    maybeShowPromotionNotices(summary.promotionTest || null);
    // Don't wipe an in-progress study/test or the post-test reward screen.
    if (
      state.placementDone &&
      state.view !== 'quiz' &&
      state.view !== 'result' &&
      quest.phase === 'idle' &&
      !promo.active
    ) {
      loadQuestInline();
    }
  }

  function refreshServerSummary() {
    var reqId = ++state._summaryReq;
    return apiFetch('/api/student/vocab/summary?_=' + Date.now())
      .then(function (summary) {
        // Ignore stale responses from a premature auto-init (no auth bridge yet).
        if (reqId !== state._summaryReq) return summary;
        applyServerSummary(summary);
        return summary;
      })
      .catch(function () {
        if (reqId !== state._summaryReq) return null;
        // Offline/cache only for THIS student, and only if it looks like a real placement.
        var saved = loadSaved();
        var sid = currentStudentId();
        if (saved && saved.result && (!saved.studentId || saved.studentId === sid)) {
          state.placement = saved.result;
          state.placementDone = true;
        } else {
          clearSavedPlacement();
          state.placement = null;
          state.placementDone = false;
        }
        renderHomeStats();
        syncPlacementVisibility();
        if (state.placementDone && quest.phase === 'idle') loadQuestInline();
        return null;
      });
  }

  function renderHomeStats() {
    var tierEl = $('vocabStatTier');
    var startEl = $('vocabStatStart');
    var mark = $('vocabTierBadgeMark');
    var hero = $('vocabTierHero');
    if (!tierEl) return;
    var tierName = (state.placement && state.placement.tier && state.placement.tier.name) || '';
    var grade = state.placement && state.placement.gradeLevel;
    if (!tierName) {
      tierEl.textContent = '—';
      if (startEl) startEl.textContent = '';
      if (mark) mark.innerHTML = '';
      if (hero) {
        hero.className = 'vocab-tier-hero';
        hero.setAttribute('aria-disabled', 'true');
      }
      renderPromotionBar(null);
      renderTierLadder(null);
      return;
    }
    var division = (state.summary && state.summary.tierDivision) ||
      (state.promotionScore >= (state.promotionScoreMax || 400) / 2 ? 2 : 1);
    tierEl.textContent = tierName + ' ' + division;
    if (startEl) startEl.textContent = grade ? ('Grade ' + grade) : '';
    var badge = TIER_BADGES[tierName] || TIER_BADGES.Rookie;
    if (mark) mark.innerHTML = '<i class="fa-solid ' + badge.icon + '"></i>';
    if (hero) {
      hero.className = 'vocab-tier-hero is-clickable ' + badge.className;
      hero.setAttribute('aria-disabled', 'false');
      hero.setAttribute('title', 'See all tiers');
    }
    renderPromotionBar(state.summary || {
      promotionScore: state.promotionScore,
      promotionScoreMax: state.promotionScoreMax,
      promotionPercent: state.promotionPercent,
      shieldCount: state.shieldCount,
      decayWarning: state.decayWarning,
      mastery: state.mastery,
      promotionTest: state.promotionTest
    });
    renderTierLadder(tierName);
  }

  function ensureTierLadderEl() {
    var el = $('vocabTierLadder');
    if (el) return el;
    var hero = $('vocabTierHero');
    if (!hero || !hero.parentNode) return null;
    el = document.createElement('div');
    el.id = 'vocabTierLadder';
    el.className = 'vocab-tier-ladder hidden';
    el.setAttribute('hidden', '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Vocab Booster tier ladder');
    hero.insertAdjacentElement('afterend', el);
    return el;
  }

  function renderTierLadder(currentTierName) {
    var el = ensureTierLadderEl();
    if (!el) return;
    var current = String(currentTierName || '').trim();
    var currentIdx = TIER_LADDER.findIndex(function (name) {
      return name.toLowerCase() === current.toLowerCase();
    });
    el.innerHTML =
      '<div class="vocab-tier-ladder-head">' +
      '<strong>Tier ladder</strong>' +
      '<span>Rookie → Legend</span>' +
      '<button type="button" class="vocab-tier-ladder-close" id="vocabTierLadderClose" aria-label="Close">' +
      '<i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<ol class="vocab-tier-ladder-list">' +
      TIER_LADDER.map(function (name, i) {
        var badge = TIER_BADGES[name];
        var isYou = currentIdx >= 0 && i === currentIdx;
        var isBelow = currentIdx >= 0 && i < currentIdx;
        var isNext = currentIdx >= 0 && i === currentIdx + 1;
        var isAbove = currentIdx >= 0 && i > currentIdx + 1;
        var status = isYou ? 'you' : (isBelow ? 'cleared' : (isNext ? 'next' : (isAbove ? 'locked' : '')));
        var meta = isYou ? 'You are here' : (isBelow ? 'Cleared' : (isNext ? 'Next' : ''));
        return (
          '<li class="vocab-tier-ladder-row ' + badge.className +
          (status ? ' is-' + status : '') + '">' +
          '<span class="vocab-tier-ladder-mark" aria-hidden="true">' +
          '<i class="fa-solid ' + badge.icon + '"></i></span>' +
          '<span class="vocab-tier-ladder-name">' + name + '</span>' +
          '<span class="vocab-tier-ladder-meta">' + meta + '</span></li>'
        );
      }).join('') +
      '</ol>';
    var closeBtn = $('vocabTierLadderClose');
    if (closeBtn) {
      closeBtn.onclick = function (e) {
        e.stopPropagation();
        setTierLadderOpen(false);
      };
    }
  }

  function isTierLadderOpen() {
    var el = $('vocabTierLadder');
    return !!(el && !el.classList.contains('hidden'));
  }

  function setTierLadderOpen(open) {
    var el = ensureTierLadderEl();
    var hero = $('vocabTierHero');
    if (!el) return;
    if (open) {
      var tierName = (state.placement && state.placement.tier && state.placement.tier.name) || '';
      renderTierLadder(tierName);
      el.classList.remove('hidden');
      el.removeAttribute('hidden');
      if (hero) hero.setAttribute('aria-expanded', 'true');
      var you = el.querySelector('.vocab-tier-ladder-row.is-you');
      if (you && typeof you.scrollIntoView === 'function') {
        setTimeout(function () { you.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 40);
      }
    } else {
      el.classList.add('hidden');
      el.setAttribute('hidden', '');
      if (hero) hero.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleTierLadder() {
    var hero = $('vocabTierHero');
    if (!hero || hero.getAttribute('aria-disabled') === 'true') return;
    var tierName = (state.placement && state.placement.tier && state.placement.tier.name) || '';
    if (!tierName) return;
    setTierLadderOpen(!isTierLadderOpen());
  }

  function renderPromotionBar(summary) {
    var wrap = $('vocabMasteryWrap');
    if (!wrap) {
      var hero = $('vocabTierHero');
      if (!hero || !hero.parentNode) return;
      wrap = document.createElement('div');
      wrap.id = 'vocabMasteryWrap';
      wrap.className = 'vocab-mastery-wrap';
      hero.insertAdjacentElement('afterend', wrap);
    }
    if (!summary || !state.placementDone) {
      wrap.innerHTML = '';
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    var score = Math.max(0, Number(summary.promotionScore) || 0);
    var max = Math.max(1, Number(summary.promotionScoreMax) || 400);
    var pct = Math.min(100, Math.max(0, Number(summary.promotionPercent) || Math.round((score / max) * 1000) / 10));
    var left = Math.max(0, Math.round((max - score) * 10) / 10);
    var shield = Math.max(0, Math.round(Number(summary.shieldCount) || 0));
    var pt = summary.promotionTest || state.promotionTest || null;
    var canStart = !!(pt && pt.canStart);
    var wins = pt ? Number(pt.wins) || 0 : 0;
    var losses = pt ? Number(pt.losses) || 0 : 0;
    var readyText = canStart
      ? ' · Tier Up Challenge ready!'
      : (left > 0 ? ' · <strong>' + left + '</strong> to next tier' : ' · Ready to promote!');
    wrap.innerHTML =
      '<div class="vocab-mastery-label">' +
      'Promotion score · <strong>' + score + ' / ' + max + '</strong> (' + pct + '%)' +
      readyText +
      (shield > 0 ? ' · Shield: ' + shield + ' sets' : '') +
      (canStart ? ' · Series ' + wins + '-' + losses : '') +
      '</div>' +
      '<div class="vocab-progress vocab-mastery-bar"><span style="width:' + Math.min(100, Math.round((score / max) * 100)) + '%"></span></div>' +
      (canStart
        ? '<div class="vocab-actions" style="margin-top:0.65rem;">' +
          '<button type="button" class="vocab-btn" id="vocabStartPromoBtn">' +
          '<i class="fa-solid fa-flag-checkered"></i> Start Tier Up Challenge</button></div>' +
          '<p class="vocab-mastery-hint">Best of 3 · 10 questions · pass at 8/10. Win 2 to promote; lose 2 and drop to 360.</p>'
        : (summary.decayWarning || summary.decay_warning
          ? '<p class="vocab-mastery-hint" style="color:#b45309;">Rank decay active — study today to stop losing promotion points.</p>'
          : '<p class="vocab-mastery-hint">Reach ' + max + ' to unlock the Tier Up Challenge. Score ≤ 0 without a shield demotes one tier (re-entry at 390).</p>'));
    var startBtn = $('vocabStartPromoBtn');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        startPromotionChallenge();
      });
    }
  }

  function renderMasteryBar(mastery) {
    renderPromotionBar(mastery && mastery.promotionScore != null ? mastery : {
      promotionScore: state.promotionScore,
      promotionScoreMax: state.promotionScoreMax,
      promotionPercent: state.promotionPercent,
      shieldCount: state.shieldCount,
      decayWarning: state.decayWarning,
      mastery: mastery || state.mastery,
      promotionTest: state.promotionTest
    });
  }

  function clearPromoTimer() {
    if (promo.timerId) clearTimeout(promo.timerId);
    if (promo.tickId) clearInterval(promo.tickId);
    promo.timerId = null;
    promo.tickId = null;
  }

  function ensurePromoModal() {
    var el = $('vocabPromoModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'vocabPromoModal';
    el.className = 'vocab-promo-modal hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="vocab-promo-modal-backdrop" data-promo-dismiss="1"></div>' +
      '<div class="vocab-promo-modal-card" id="vocabPromoModalCard"></div>';
    (document.body || document.documentElement).appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-promo-dismiss') === '1') {
        hidePromoModal();
      }
    });
    return el;
  }

  function hidePromoModal() {
    var el = $('vocabPromoModal');
    if (el) el.classList.add('hidden');
  }

  function showPromoModal(html) {
    var el = ensurePromoModal();
    var card = $('vocabPromoModalCard');
    if (card) card.innerHTML = html;
    el.classList.remove('hidden');
  }

  function ackPromotionNotices(opts) {
    return apiFetch('/api/student/vocab/promotion-test/ack', {
      method: 'POST',
      body: opts || {}
    }).catch(function () { return null; });
  }

  function maybeShowPromotionNotices(pt) {
    if (!pt || promo.active) return;
    if (pt.notifyUnlock) {
      showPromoModal(
        '<div class="vocab-tier-badge"><i class="fa-solid fa-flag-checkered"></i> Tier Up unlocked</div>' +
        '<h3>You hit ' + (pt.promotionScoreMax || 400) + '!</h3>' +
        '<p>Promotion is no longer automatic. Win a Best-of-3 Tier Up Challenge (8/10 each round) to climb.</p>' +
        '<div class="vocab-actions">' +
        '<button type="button" class="vocab-btn" id="vocabPromoUnlockStart">Start Tier Up Challenge</button>' +
        '<button type="button" class="vocab-btn secondary" id="vocabPromoUnlockLater">Later</button>' +
        '</div>'
      );
      var start = $('vocabPromoUnlockStart');
      var later = $('vocabPromoUnlockLater');
      if (start) start.addEventListener('click', function () {
        hidePromoModal();
        ackPromotionNotices({ unlock: true, retry: false });
        startPromotionChallenge();
      });
      if (later) later.addEventListener('click', function () {
        hidePromoModal();
        ackPromotionNotices({ unlock: true, retry: false });
      });
      return;
    }
    if (pt.notifyRetry) {
      showPromoModal(
        '<div class="vocab-tier-badge"><i class="fa-solid fa-rotate-left"></i> Challenge failed</div>' +
        '<h3>Back to ' + (pt.failScore || 360) + '</h3>' +
        '<p>Climb back to ' + (pt.promotionScoreMax || 400) + ' to unlock the Tier Up Challenge again.</p>' +
        '<div class="vocab-actions">' +
        '<button type="button" class="vocab-btn" id="vocabPromoRetryAck">Got it</button>' +
        '</div>'
      );
      var ack = $('vocabPromoRetryAck');
      if (ack) ack.addEventListener('click', function () {
        hidePromoModal();
        ackPromotionNotices({ unlock: false, retry: true });
      });
    }
  }

  function startPromotionChallenge() {
    if (promo.active) return;
    var box = $('vocabQuestBody');
    if (box) box.innerHTML = '<p class="vocab-empty">Starting Tier Up Challenge…</p>';
    quest.phase = 'idle';
    apiFetch('/api/student/vocab/promotion-test/start', { method: 'POST', body: {} })
      .then(function (res) {
        promo.active = true;
        promo.roundId = res.roundId;
        promo.roundNumber = res.roundNumber || 1;
        promo.questions = Array.isArray(res.questions) ? res.questions : [];
        promo.index = 0;
        promo.answers = [];
        promo.selectedChoice = null;
        promo.locked = false;
        promo.status = res.status || null;
        state.promotionTest = res.status || state.promotionTest;
        hidePromoModal();
        renderPromoQuestion();
      })
      .catch(function (err) {
        promo.active = false;
        if (box) {
          box.innerHTML =
            '<p class="vocab-empty">Could not start Tier Up Challenge: ' +
            escapeHtml(err.message || 'error') + '</p>';
        }
      });
  }

  function updatePromoTimerUi(sec) {
    var el = $('vocabPromoTimer');
    if (!el) return;
    var n = Math.max(0, Math.ceil(sec));
    el.textContent = n + 's';
    el.classList.toggle('is-urgent', n <= 3);
  }

  function startPromoSpeedTimer(seconds) {
    clearPromoTimer();
    var ms = Math.max(0, Number(seconds) || 8) * 1000;
    promo.timerEndsAt = Date.now() + ms;
    updatePromoTimerUi(ms / 1000);
    promo.tickId = setInterval(function () {
      var left = (promo.timerEndsAt - Date.now()) / 1000;
      updatePromoTimerUi(left);
      if (left <= 0) clearInterval(promo.tickId);
    }, 150);
    promo.timerId = setTimeout(function () {
      submitPromoAnswer(true);
    }, ms);
  }

  function renderPromoQuestion() {
    var box = $('vocabQuestBody');
    if (!box) return;
    clearPromoTimer();
    if (promo.index >= promo.questions.length) {
      finishPromoRound();
      return;
    }
    promo.locked = false;
    promo.selectedChoice = null;
    var q = promo.questions[promo.index];
    var total = promo.questions.length;
    var pct = Math.round((promo.index / Math.max(1, total)) * 100);
    var typeLabel = q.type === 'speed' ? 'Speed'
      : (q.type === 'spelling' ? 'Spelling'
        : (q.type === 'antonym' ? 'Antonym' : 'Synonym'));
    var timed = q.type === 'speed' || (q.timeLimitSec != null && Number(q.timeLimitSec) > 0);
    var limit = Number(q.timeLimitSec) || 8;
    box.innerHTML =
      '<div class="d-flex justify-content-between align-items-center" style="gap:0.5rem;flex-wrap:wrap;">' +
      '<strong>Tier Up · Round ' + promo.roundNumber + ' · Q ' + (promo.index + 1) + ' / ' + total + '</strong></div>' +
      '<div class="vocab-progress"><span style="width:' + pct + '%"></span></div>' +
      '<div class="vocab-q-card' + (timed ? ' has-timer' : '') + '">' +
      (timed ? '<span class="vocab-quiz-timer" id="vocabPromoTimer" aria-live="polite">' + limit + 's</span>' : '') +
      '<span class="vocab-q-type">' + escapeHtml(typeLabel) + '</span>' +
      '<p class="vocab-q-prompt">' + escapeHtml(q.prompt || '').replace(/\n/g, '<br>') + '</p>' +
      '<div class="vocab-choices">' +
      (q.choices || []).map(function (c, i) {
        return '<button type="button" class="vocab-choice" data-choice-i="' + i + '">' + escapeHtml(c) + '</button>';
      }).join('') +
      '</div>' +
      '<div class="vocab-actions vocab-q-actions">' +
      '<button type="button" class="vocab-btn" id="vocabPromoNextBtn" disabled>Next</button>' +
      '</div></div>';
    box.querySelectorAll('.vocab-choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (promo.locked) return;
        promo.selectedChoice = Number(btn.getAttribute('data-choice-i'));
        box.querySelectorAll('.vocab-choice').forEach(function (b, i) {
          b.classList.toggle('is-selected', i === promo.selectedChoice);
        });
        var nextBtn = $('vocabPromoNextBtn');
        if (nextBtn) nextBtn.disabled = false;
      });
    });
    var nextBtn = $('vocabPromoNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', function () { submitPromoAnswer(false); });
    if (timed) startPromoSpeedTimer(limit);
  }

  function submitPromoAnswer(timedOut) {
    if (promo.locked || !promo.active) return;
    promo.locked = true;
    clearPromoTimer();
    var q = promo.questions[promo.index] || {};
    var choiceIndex = promo.selectedChoice;
    var hasPick = choiceIndex != null && choiceIndex >= 0;
    var picked = hasPick && q.choices ? q.choices[choiceIndex] : '';
    promo.answers.push({
      index: promo.index,
      answer: timedOut ? '' : String(picked || ''),
      timedOut: !!timedOut
    });
    promo.index += 1;
    renderPromoQuestion();
  }

  function finishPromoRound() {
    var box = $('vocabQuestBody');
    if (box) box.innerHTML = '<p class="vocab-empty">Submitting round…</p>';
    apiFetch('/api/student/vocab/promotion-test/submit', {
      method: 'POST',
      body: { roundId: promo.roundId, answers: promo.answers }
    }).then(function (res) {
      promo.active = false;
      clearPromoTimer();
      state.promotionTest = res.status || state.promotionTest;
      renderPromoRoundResult(res);
      refreshServerSummary();
    }).catch(function (err) {
      promo.active = false;
      if (box) {
        box.innerHTML =
          '<p class="vocab-empty">Could not submit challenge: ' +
          escapeHtml(err.message || 'error') + '</p>';
      }
    });
  }

  function renderPromoRoundResult(res) {
    var box = $('vocabQuestBody');
    if (!box) return;
    var series = res.seriesResult || 'continue';
    var title = res.passed ? 'Round won!' : 'Round lost';
    var detail = '';
    if (series === 'promoted') {
      title = 'Promoted!';
      detail = '<p>⬆️ Welcome to Grade ' + escapeHtml(String(res.gradeLevel)) +
        ' (' + escapeHtml(res.tierName || '') + '). Shield: ' +
        escapeHtml(String(res.shieldCount || 0)) + ' sets.</p>';
    } else if (series === 'failed') {
      title = 'Challenge failed';
      detail = '<p>Score reset to ' + escapeHtml(String(res.promotionScore || 360)) +
        '. Climb back to 400 to try again.</p>';
    } else {
      detail = '<p>Series score: <strong>' + (res.wins || 0) + '-' + (res.losses || 0) +
        '</strong>. Need 2 wins before 2 losses.</p>';
    }
    box.innerHTML =
      '<div class="vocab-result vocab-result-celebrate">' +
      '<div class="vocab-tier-badge"><i class="fa-solid ' +
      (series === 'promoted' ? 'fa-trophy' : (res.passed ? 'fa-check' : 'fa-xmark')) +
      '"></i> ' + escapeHtml(title) + '</div>' +
      '<h3>Score: ' + res.correctCount + ' / ' + res.total +
      (res.passed ? ' (pass)' : ' (need 8)') + '</h3>' +
      detail +
      '<div class="vocab-actions">' +
      (series === 'continue'
        ? '<button type="button" class="vocab-btn" id="vocabPromoContinueBtn">Play next round</button>'
        : '<button type="button" class="vocab-btn" id="vocabPromoDoneBtn">Back to study</button>') +
      '</div></div>';
    var cont = $('vocabPromoContinueBtn');
    if (cont) cont.addEventListener('click', function () { startPromotionChallenge(); });
    var done = $('vocabPromoDoneBtn');
    if (done) done.addEventListener('click', function () {
      quest.phase = 'idle';
      loadQuestInline();
    });
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pickDistractors(correctWord, pool, n) {
    var others = (pool || []).filter(function (w) {
      return String(w.word_id || w.word) !== String(correctWord.word_id || correctWord.word);
    });
    return shuffle(others).slice(0, n);
  }

  function wordDef(w) {
    if (!w) return '';
    var L = w.levels || {};
    var basic = L.basic || {};
    return String(w.simple_definition || basic.intuitive_definition || '').trim();
  }

  function wordKo(w) {
    return w ? String(w.korean_meaning || '').trim() : '';
  }

  function wordLabel(w) {
    return w ? String(w.word || '').trim() : '';
  }

  function clozePromptFor(word) {
    function escapeRegExp(s) {
      return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function wordFormRegex(w) {
      var lower = String(w || '').trim().toLowerCase();
      if (!lower) return null;
      var forms = {};
      function add(f) { if (f) forms[f] = true; }
      add(lower);
      add(lower + 's');
      add(lower + 'es');
      add(lower + 'ed');
      add(lower + 'd');
      add(lower + 'ing');
      add(lower + 'er');
      add(lower + 'est');
      add(lower + 'ly');
      if (lower.endsWith('y') && lower.length > 1 && !/[aeiou]y$/.test(lower)) {
        add(lower.slice(0, -1) + 'ies');
        add(lower.slice(0, -1) + 'ied');
        add(lower.slice(0, -1) + 'ier');
        add(lower.slice(0, -1) + 'iest');
        add(lower.slice(0, -1) + 'ily');
      }
      if (lower.endsWith('e') && lower.length > 1) {
        add(lower.slice(0, -1) + 'ing');
      }
      if (/[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(lower) && lower.length <= 6) {
        var last = lower.charAt(lower.length - 1);
        add(lower + last + 'ing');
        add(lower + last + 'ed');
      }
      var alts = Object.keys(forms).sort(function (a, b) { return b.length - a.length; }).map(escapeRegExp);
      return new RegExp('\\b(?:' + alts.join('|') + ')\\b', 'gi');
    }
    function blankText(text, w) {
      var raw = String(text || '').trim().replace(/^\s*Fill the blank:\s*/i, '').trim();
      if (!raw) return { prompt: 'Choose the word that fits: ______', leaked: false };
      var re = wordFormRegex(w);
      if (!re) return { prompt: raw, leaked: true };
      var prompt = raw.replace(re, '______').replace(/(?:______)(\s*______)+/g, '______');
      var leaked = wordFormRegex(w).test(prompt);
      return { prompt: prompt, leaked: leaked };
    }
    var w = wordLabel(word);
    var cloze = String(word.cloze_question || '').trim();
    if (cloze) {
      var fromCloze = blankText(cloze, w);
      if (!fromCloze.leaked && fromCloze.prompt.indexOf('______') >= 0) return fromCloze.prompt;
    }
    var example = String(word.example_sentence || '').trim();
    if (!example) {
      var L = word.levels || {};
      var mid = L.intermediate || {};
      example = (mid.examples && mid.examples[0]) || '';
    }
    if (example) {
      var fromEx = blankText(example, w);
      if (!fromEx.leaked && fromEx.prompt.indexOf('______') >= 0) return fromEx.prompt;
    }
    return null;
  }

  function uniqueChoices(correct, wrongs, need) {
    need = need || 4;
    var out = [];
    var seen = {};
    function add(v) {
      var s = String(v == null ? '' : v).trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    }
    add(correct);
    (wrongs || []).forEach(add);
    return out.slice(0, need);
  }

  function quizTypeLabel(type) {
    if (type === 'meaning') return 'Meaning';
    if (type === 'sentence' || type === 'cloze') return 'Sentence';
    if (type === 'whichWord') return 'Which word?';
    return 'Question';
  }

  function buildQuestion(targetGrade, qIndex) {
    var pack = data();
    if (!pack) return null;
    var band = pack.wordsInGrade(targetGrade, 1);
    if (band.length < 4) band = pack.sortedWords();
    var pool = band.length >= 4 ? band : pack.WORDS;
    var word = pack.findNearestGrade(targetGrade);
    if (band.length) {
      word = band[Math.floor(Math.random() * band.length)];
    }
    // Rotate: Meaning → Sentence → Which word?
    var types = ['meaning', 'sentence', 'whichWord'];
    var type = types[qIndex % types.length];

    var choices = [];
    var prompt = '';
    var correct = '';
    var distractors = pickDistractors(word, pool, 3);

    if (type === 'meaning') {
      prompt = 'What does “' + word.word + '” mean?';
      correct = wordDef(word) || word.word;
      choices = uniqueChoices(correct, distractors.map(wordDef));
    } else if (type === 'sentence') {
      var cloze = clozePromptFor(word);
      if (!cloze) {
        type = 'meaning';
        prompt = 'What does “' + word.word + '” mean?';
        correct = wordDef(word) || word.word;
        choices = uniqueChoices(correct, distractors.map(wordDef));
      } else {
        prompt = cloze;
        correct = wordLabel(word);
        choices = uniqueChoices(correct, distractors.map(wordLabel));
      }
    } else {
      var def = wordDef(word) || word.word;
      var ko = wordKo(word);
      prompt = ko
        ? ('Which word means this?\n' + ko + '\n(' + def + ')')
        : ('Which word means “' + def + '”?');
      correct = wordLabel(word);
      choices = uniqueChoices(correct, distractors.map(wordLabel));
    }

    while (choices.length < 4) {
      var filler = pack.WORDS[Math.floor(Math.random() * pack.WORDS.length)];
      var text = (type === 'meaning') ? wordDef(filler) : wordLabel(filler);
      if (text && choices.indexOf(text) < 0) choices.push(text);
      else break;
    }

    return {
      type: type,
      word: word,
      prompt: prompt,
      correct: correct,
      choices: shuffle(choices.slice(0, 4)),
      frequencyLevel: word.grade_level
    };
  }

  function localUpdateAbility(abilityGrade, item) {
    var ability = Math.max(0.5, Math.min(12.5, Number(abilityGrade) || 4));
    var correct = !!(item && item.correct);
    var type = String((item && item.questionType) || 'meaning');
    var itemGrade = Number(item && (item.frequencyLevel != null ? item.frequencyLevel : item.targetGrade));
    var step = 0.35;
    if (type === 'cloze' || type === 'sentence') step = 0.38;
    if (type === 'whichWord') step = 0.36;
    if (type === 'nuance') step = 0.4;
    if (correct) {
      if (Number.isFinite(itemGrade) && itemGrade < ability - 0.75) ability += step * 0.35;
      else ability += step;
    } else {
      if (Number.isFinite(itemGrade) && itemGrade > ability + 0.75) ability -= step * 0.5;
      else ability -= step;
    }
    return Math.round(Math.max(0.5, Math.min(12.5, ability)) * 100) / 100;
  }

  function clearPlacementTimer() {
    if (state.placementTimerId) {
      clearTimeout(state.placementTimerId);
      state.placementTimerId = null;
    }
    if (state.placementTickId) {
      clearInterval(state.placementTickId);
      state.placementTickId = null;
    }
  }

  function updatePlacementTimerUi(secondsLeft) {
    var el = $('vocabQuizTimer');
    if (!el) return;
    var sec = Math.max(0, Math.ceil(secondsLeft));
    el.textContent = sec + 's';
    el.classList.toggle('is-urgent', sec <= 10);
  }

  function placementSecondsUsed(timedOut) {
    if (timedOut) return PLACEMENT_SECONDS;
    var remainingMs = state.paused
      ? state.pauseRemainingMs
      : Math.max(0, (state.timerEndsAt || Date.now()) - Date.now());
    return Math.min(PLACEMENT_SECONDS, Math.max(0, (PLACEMENT_SECONDS * 1000 - remainingMs) / 1000));
  }

  function setPlacementPausedUi(paused) {
    var card = document.querySelector('#vocabQuizBody .vocab-q-card');
    var overlay = $('vocabPlacementPauseOverlay');
    var pauseBtn = $('vocabPlacementPauseBtn');
    if (card) card.classList.toggle('is-paused', !!paused);
    if (overlay) overlay.classList.toggle('hidden', !paused);
    if (pauseBtn) pauseBtn.classList.add('hidden');
    var buttons = $('vocabQuizBody') ? $('vocabQuizBody').querySelectorAll('.vocab-choice') : [];
    buttons.forEach(function (btn) {
      btn.disabled = !!paused || state.locked;
    });
    var nextBtn = $('vocabPlacementNextBtn');
    if (nextBtn) nextBtn.disabled = !!paused || state.locked || state.selectedChoice == null;
  }

  function pausePlacementTest() {
    if (state.pauseUsed || state.paused || state.locked || !state.currentQ) return;
    state.pauseUsed = true;
    state.paused = true;
    state.pauseRemainingMs = Math.max(0, (state.timerEndsAt || Date.now()) - Date.now());
    clearPlacementTimer();
    updatePlacementTimerUi(state.pauseRemainingMs / 1000);
    setPlacementPausedUi(true);
  }

  function resumePlacementTest() {
    if (!state.paused) return;
    state.paused = false;
    setPlacementPausedUi(false);
    startPlacementTimer(state.pauseRemainingMs);
  }

  /** @param {number=} remainingMs */
  function startPlacementTimer(remainingMs) {
    clearPlacementTimer();
    var ms = remainingMs != null ? Math.max(0, Number(remainingMs) || 0) : PLACEMENT_SECONDS * 1000;
    state.timerEndsAt = Date.now() + ms;
    updatePlacementTimerUi(ms / 1000);
    if (ms <= 0) {
      onPlacementTimeout();
      return;
    }
    state.placementTickId = setInterval(function () {
      var left = (state.timerEndsAt - Date.now()) / 1000;
      updatePlacementTimerUi(left);
      if (left <= 0) clearInterval(state.placementTickId);
    }, 200);
    state.placementTimerId = setTimeout(function () {
      onPlacementTimeout();
    }, ms);
  }

  function startPlacement() {
    if (state.placementDone) {
      if (typeof root.appAlert === 'function') {
        root.appAlert('Placement is already done. Ask your teacher to reset your tier if you need to retake it.');
      } else {
        window.alert('Placement is already done. Ask your teacher to reset your tier if you need to retake it.');
      }
      setView('home');
      return;
    }
    clearPlacementTimer();
    state.abilityGrade = state.placementStartGrade || 4;
    state.startAbility = state.abilityGrade;
    state.abilityTrail = [];
    state.avoidWordIds = [];
    state.questionIndex = 0;
    state.answers = [];
    state.locked = false;
    state.selectedChoice = null;
    state.pauseUsed = false;
    state.paused = false;
    state.pauseRemainingMs = 0;
    setView('quiz');
    showQuestion();
  }

  function showQuestion() {
    clearPlacementTimer();
    state.locked = false;
    state.selectedChoice = null;
    state.paused = false;
    state.qStartedAt = Date.now();
    var body = $('vocabQuizBody');
    if (body) body.innerHTML = '<p class="vocab-empty">Loading adaptive question…</p>';
    var progress = $('vocabQuizProgress');
    if (progress) {
      progress.style.width = Math.round((state.questionIndex / PLACEMENT_MAX) * 100) + '%';
    }
    var count = $('vocabQuizCount');
    if (count) {
      count.textContent = 'Question ' + (state.questionIndex + 1) + ' · adapting (min ' + PLACEMENT_MIN + ', max ' + PLACEMENT_MAX + ')';
    }

    apiFetch('/api/student/vocab/placement/item', {
      method: 'POST',
      body: {
        abilityGrade: state.abilityGrade,
        questionIndex: state.questionIndex,
        avoidWordIds: state.avoidWordIds,
        abilityTrail: state.abilityTrail
      }
    }).then(function (item) {
      if (item && item.done) {
        finishPlacement();
        return;
      }
      state.currentQ = {
        type: item.type,
        prompt: item.prompt,
        correct: item.correct,
        choices: item.choices || [],
        word: item.word || { word: '' },
        frequencyLevel: item.frequencyLevel || item.targetGrade
      };
      if (item.word && item.word.word_id) {
        state.avoidWordIds.push(String(item.word.word_id));
      }
      renderPlacementQuestionCard(state.currentQ);
    }).catch(function (err) {
      // Fallback to local mock pack if bank API fails
      var q = buildQuestion(Math.round(state.abilityGrade), state.questionIndex);
      state.currentQ = q;
      if (!q) {
        if (body) body.innerHTML = '<p class="vocab-empty">Could not load a question: ' + escapeHtml(err.message || 'error') + '</p>';
        return;
      }
      renderPlacementQuestionCard(q);
    });
  }

  function renderPlacementQuestionCard(q) {
    var typeLabel = quizTypeLabel(q.type);
    var html = '<div class="vocab-q-card has-timer">' +
      '<span class="vocab-quiz-timer" id="vocabQuizTimer" aria-live="polite">' + QUESTION_SECONDS + 's</span>' +
      '<span class="vocab-q-type">' + escapeHtml(typeLabel) + '</span>' +
      '<p class="vocab-q-prompt">' + escapeHtml(q.prompt).replace(/\n/g, '<br>') + '</p>' +
      '<div class="vocab-choices">' +
      q.choices.map(function (c, i) {
        return '<button type="button" class="vocab-choice" data-choice-i="' + i + '">' + escapeHtml(c) + '</button>';
      }).join('') +
      '</div>' +
      '<div class="vocab-actions vocab-q-actions">' +
      (!state.pauseUsed
        ? '<button type="button" class="vocab-btn ghost" id="vocabPlacementPauseBtn" title="One pause per test"><i class="fa-solid fa-pause"></i> Pause</button>'
        : '') +
      '<button type="button" class="vocab-btn" id="vocabPlacementNextBtn" disabled>Next</button>' +
      '</div>' +
      '<div class="vocab-pause-overlay hidden" id="vocabPlacementPauseOverlay">' +
      '<div class="vocab-pause-card">' +
      '<strong>Paused</strong>' +
      '<p>Timer is frozen. You get <strong>1 pause</strong> per test — bathroom breaks welcome.</p>' +
      '<button type="button" class="vocab-btn" id="vocabPlacementResumeBtn"><i class="fa-solid fa-play"></i> Resume</button>' +
      '</div></div>' +
      '</div>';
    $('vocabQuizBody').innerHTML = html;
    $('vocabQuizBody').querySelectorAll('.vocab-choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        onSelectPlacementChoice(Number(btn.getAttribute('data-choice-i')));
      });
    });
    var nextBtn = $('vocabPlacementNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', function () { submitPlacementAnswer(false); });
    var pauseBtn = $('vocabPlacementPauseBtn');
    if (pauseBtn) pauseBtn.addEventListener('click', pausePlacementTest);
    var resumeBtn = $('vocabPlacementResumeBtn');
    if (resumeBtn) resumeBtn.addEventListener('click', resumePlacementTest);
    startPlacementTimer();
  }

  function onSelectPlacementChoice(choiceIndex) {
    if (state.locked || state.paused || !state.currentQ) return;
    state.selectedChoice = choiceIndex;
    var buttons = $('vocabQuizBody').querySelectorAll('.vocab-choice');
    buttons.forEach(function (btn, i) {
      btn.classList.toggle('is-selected', i === choiceIndex);
    });
    var nextBtn = $('vocabPlacementNextBtn');
    if (nextBtn) nextBtn.disabled = false;
  }

  function onPlacementTimeout() {
    if (state.locked || state.paused) return;
    // Time’s up: submit current pick if any, otherwise count as incorrect.
    submitPlacementAnswer(true);
  }

  /** @param {boolean} timedOut */
  function submitPlacementAnswer(timedOut) {
    if (state.locked || state.paused || !state.currentQ) return;
    state.locked = true;
    clearPlacementTimer();

    var q = state.currentQ;
    var choiceIndex = state.selectedChoice;
    var hasPick = choiceIndex != null && choiceIndex >= 0;
    var picked = hasPick ? q.choices[choiceIndex] : null;
    var correct = !!(hasPick && picked === q.correct);
    var seconds = placementSecondsUsed(timedOut);
    var answer = {
      correct: correct,
      seconds: seconds,
      questionType: q.type,
      frequencyLevel: q.frequencyLevel,
      word: q.word.word,
      timedOut: !!timedOut
    };
    state.answers.push(answer);

    var buttons = $('vocabQuizBody').querySelectorAll('.vocab-choice');
    buttons.forEach(function (btn) { btn.disabled = true; });
    var nextBtn = $('vocabPlacementNextBtn');
    if (nextBtn) nextBtn.disabled = true;
    var pauseBtn = $('vocabPlacementPauseBtn');
    if (pauseBtn) pauseBtn.disabled = true;

    // Server is authoritative for ability (avoid double-stepping).
    apiFetch('/api/student/vocab/placement/next', {
      method: 'POST',
      body: {
        abilityGrade: state.abilityGrade,
        correct: correct,
        seconds: seconds,
        questionType: q.type,
        frequencyLevel: q.frequencyLevel,
        questionIndex: state.questionIndex,
        abilityTrail: state.abilityTrail
      }
    }).then(function (res) {
      if (res && res.abilityGrade != null) state.abilityGrade = res.abilityGrade;
      else state.abilityGrade = localUpdateAbility(state.abilityGrade, answer);
      if (res && Array.isArray(res.abilityTrail)) state.abilityTrail = res.abilityTrail;
      else state.abilityTrail.push(state.abilityGrade);
      state.questionIndex += 1;
      var stop = !!(res && res.stop) || state.questionIndex >= PLACEMENT_MAX;
      if (stop && state.questionIndex >= PLACEMENT_MIN) finishPlacement();
      else if (state.questionIndex >= PLACEMENT_MAX) finishPlacement();
      else showQuestion();
    }).catch(function () {
      state.abilityGrade = localUpdateAbility(state.abilityGrade, answer);
      state.abilityTrail.push(state.abilityGrade);
      state.questionIndex += 1;
      if (state.questionIndex >= PLACEMENT_MAX) finishPlacement();
      else showQuestion();
    });
  }

  function finishPlacement() {
    clearPlacementTimer();
    var body = {
      answers: state.answers,
      startAbility: state.startAbility != null ? state.startAbility : (state.placementStartGrade || 4)
    };
    apiFetch('/api/student/vocab/placement/score', {
      method: 'POST',
      body: body
    }).then(function (res) {
      savePlacement(res);
      state.placementDone = true;
      renderResult(res);
      setView('result');
      syncPlacementVisibility();
    }).catch(function () {
      // Local fallback score
      var ability = state.abilityGrade;
      var pack = data();
      var gradeLevel = Math.max(1, Math.min(12, Math.round(ability)));
      var tier = pack && typeof pack.tierForGrade === 'function'
        ? pack.tierForGrade(gradeLevel)
        : { name: 'Grade ' + gradeLevel, gradeLevel: gradeLevel };
      var correctCount = state.answers.filter(function (a) { return a.correct; }).length;
      var res = {
        ok: true,
        correctCount: correctCount,
        accuracy: Math.round((correctCount / Math.max(1, state.answers.length)) * 1000) / 10,
        abilityGrade: ability,
        startAbility: state.startAbility,
        gradeLevel: gradeLevel,
        tier: tier,
        message: 'Start at Grade ' + gradeLevel + ' (' + tier.name + ').'
      };
      savePlacement(res);
      // Local-only fallback: do not hide Placement until the server confirms placement_at.
      renderResult(res);
      setView('result');
    });
  }

  function renderResult(res) {
    var box = $('vocabResultBody');
    if (!box) return;
    var tier = res.tier || {};
    box.innerHTML =
      '<div class="vocab-result">' +
      '<div class="vocab-tier-badge"><i class="fa-solid fa-medal"></i> ' +
      escapeHtml(tier.name || 'Tier') + ' · Grade ' + escapeHtml(String(res.gradeLevel || tier.gradeLevel || '')) +
      '</div>' +
      '<h3>Your start point</h3>' +
      '<p>' + escapeHtml(res.message || '') + '</p>' +
      '<div class="vocab-stat-row">' +
      '<div class="vocab-stat"><span class="label">Accuracy</span><span class="value">' +
      escapeHtml(String(res.accuracy)) + '%</span></div>' +
      '<div class="vocab-stat"><span class="label">Grade</span><span class="value">' +
      escapeHtml(String(res.gradeLevel)) + '</span></div>' +
      '<div class="vocab-stat"><span class="label">Tier</span><span class="value">' +
      escapeHtml(tier.name || '—') + '</span></div>' +
      '</div>' +
      '<div class="vocab-actions">' +
      '<button type="button" class="vocab-btn" id="vocabGoQuestBtn">See today\u2019s words</button>' +
      '</div></div>';
    var go = $('vocabGoQuestBtn');
    if (go) go.addEventListener('click', function () {
      setView('home');
      loadQuestInline();
    });
  }

  function buildDeck() {
    var pack = data();
    if (!pack) return [];
    var start = (state.placement && state.placement.gradeLevel) || 6;
    var sorted = pack.sortedWords();
    // Start near placement grade, then walk upward
    var startIdx = 0;
    var best = Math.abs(sorted[0].grade_level - start);
    for (var i = 1; i < sorted.length; i++) {
      var d = Math.abs(sorted[i].grade_level - start);
      if (d < best) { best = d; startIdx = i; }
    }
    return sorted.slice(startIdx).concat(sorted.slice(0, startIdx));
  }

  function openLearnDeck() {
    state.deck = buildDeck();
    state.deckIndex = 0;
    setView('learn');
    renderWordCard();
  }

  function renderWordCard() {
    var box = $('vocabLearnBody');
    if (!box) return;
    if (!state.deck.length) {
      box.innerHTML = '<p class="vocab-empty">No mock words loaded.</p>';
      return;
    }
    var w = state.deck[state.deckIndex];
    var L = w.levels;
    box.innerHTML =
      '<div class="vocab-deck-nav">' +
      '<button type="button" class="vocab-btn secondary" id="vocabPrevWord">Previous</button>' +
      '<span class="vocab-empty">' + (state.deckIndex + 1) + ' / ' + state.deck.length + '</span>' +
      '<button type="button" class="vocab-btn secondary" id="vocabNextWord">Next</button>' +
      '</div>' +
      '<article class="vocab-word-card" data-word-id="' + escapeHtml(String(w.word_id)) + '">' +
      '<div class="vocab-word-head">' +
      '<span class="word">' + escapeHtml(w.word) + '</span>' +
      '<span class="pos">' + escapeHtml(w.part_of_speech) + '</span>' +
      '<span class="freq">Grade ' + escapeHtml(String(w.grade_level)) + ' · ' + escapeHtml(w.tier_name || '') + '</span>' +
      '</div>' +
      '<p class="vocab-basic-def">' + escapeHtml(L.basic.intuitive_definition) + '</p>' +
      '<p class="vocab-metaphor">' + escapeHtml(L.basic.metaphor || '') + '</p>' +
      '<div class="vocab-expand">' +
      '<button type="button" class="vocab-expand-btn" data-expand="mid">' +
      '<span>Level 2 · Mechanism &amp; nuance</span><i class="fa-solid fa-chevron-down"></i></button>' +
      '<div class="vocab-expand-panel" id="vocabPanelMid">' +
      '<h4>How it works</h4><p>' + escapeHtml(L.intermediate.mechanism_and_nuance) + '</p>' +
      '<h4>Examples</h4><ul>' +
      (L.intermediate.examples || []).map(function (ex) {
        return '<li>' + escapeHtml(ex) + '</li>';
      }).join('') +
      '</ul></div>' +
      '<button type="button" class="vocab-expand-btn" data-expand="adv">' +
      '<span>Level 3 · Exceptions &amp; deep use</span><i class="fa-solid fa-chevron-down"></i></button>' +
      '<div class="vocab-expand-panel" id="vocabPanelAdv">' +
      '<h4>Exceptions</h4><p>' + escapeHtml(L.advanced.exceptions) + '</p>' +
      '<h4>Deep dive</h4><p>' + escapeHtml(L.advanced.deep_dive) + '</p>' +
      '</div></div>' +
      '<div class="vocab-deep">' +
      '<button type="button" class="vocab-btn ghost" id="vocabDeepDiveBtn">' +
      '<i class="fa-solid fa-wand-magic-sparkles"></i> Ask AI for more examples</button>' +
      '<div class="vocab-deep-out" id="vocabDeepOut"></div>' +
      '</div></article>';

    box.querySelectorAll('.vocab-expand-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var which = btn.getAttribute('data-expand');
        var panel = which === 'mid' ? $('vocabPanelMid') : $('vocabPanelAdv');
        if (!panel) return;
        panel.classList.toggle('is-open');
        var icon = btn.querySelector('i');
        if (icon) {
          icon.classList.toggle('fa-chevron-down', !panel.classList.contains('is-open'));
          icon.classList.toggle('fa-chevron-up', panel.classList.contains('is-open'));
        }
      });
    });

    var prev = $('vocabPrevWord');
    var next = $('vocabNextWord');
    if (prev) prev.addEventListener('click', function () {
      state.deckIndex = (state.deckIndex - 1 + state.deck.length) % state.deck.length;
      renderWordCard();
    });
    if (next) next.addEventListener('click', function () {
      state.deckIndex = (state.deckIndex + 1) % state.deck.length;
      renderWordCard();
    });

    var deepBtn = $('vocabDeepDiveBtn');
    if (deepBtn) deepBtn.addEventListener('click', function () {
      requestDeepDive(w);
    });
  }

  function requestDeepDive(word) {
    var out = $('vocabDeepOut');
    var btn = $('vocabDeepDiveBtn');
    if (btn) btn.disabled = true;
    if (out) {
      out.classList.add('is-visible');
      out.textContent = 'Asking AI…';
    }
    var tierName = state.placement && state.placement.tier && state.placement.tier.name;
    apiFetch('/api/student/vocab/deep-dive', {
      method: 'POST',
      body: {
        word: word.word,
        partOfSpeech: word.part_of_speech,
        focus: 'nuance and examples',
        levelHint: word.levels.intermediate.mechanism_and_nuance,
        studentLevel: tierName || ''
      }
    }).then(function (res) {
      var text = (res.explanation || '') +
        ((res.examples && res.examples.length)
          ? '\n\nExamples:\n• ' + res.examples.join('\n• ')
          : '');
      if (res.warning) text += '\n\n(' + res.warning + ')';
      if (out) out.textContent = text || 'No explanation returned.';
    }).catch(function (err) {
      if (out) out.textContent = err.message || 'Deep-dive failed.';
    }).finally(function () {
      if (btn) btn.disabled = false;
    });
  }

  /* ----------------------------- Daily Quest (study N -> pass test -> reward) ----------------------------- */

  function openQuest() {
    setView('home');
    loadQuestInline();
  }

  function loadQuestInline() {
    var box = $('vocabQuestBody');
    if (!box) return;
    if (quest.phase === 'study' || quest.phase === 'test') return;
    box.innerHTML = '<p class="vocab-empty">Loading today\u2019s words…</p>';
    apiFetch('/api/student/vocab/daily-queue')
      .then(function (queue) {
        quest.targetCount = queue.targetCount || 10;
        quest.passThreshold = queue.passThreshold || 100;
        quest.sessionsCompleted = queue.sessionsCompleted || 0;
        quest.maxSessions = queue.maxSessions || 3;
        quest.alreadyPassedToday = !!queue.testPassed;
        quest.masterQueue = (queue.words || []).slice();
        quest.queue = quest.masterQueue.slice();

        if (!queue.canStartAnother) {
          quest.phase = 'done';
          box.innerHTML =
            '<div class="vocab-result">' +
            '<div class="vocab-tier-badge"><i class="fa-solid fa-trophy"></i> Today\u2019s sets complete!</div>' +
            '<p>You finished ' + quest.sessionsCompleted + ' / ' + quest.maxSessions + ' sets. Come back tomorrow to keep going.</p>' +
            '</div>';
          return;
        }

        // After at least one set today, wait for an explicit "another set" click
        // (unless the student just pressed that button).
        if (quest.sessionsCompleted > 0 && !quest.forceAnotherSet) {
          quest.phase = 'done';
          box.innerHTML =
            '<div class="vocab-result">' +
            '<div class="vocab-tier-badge"><i class="fa-solid fa-circle-check"></i> Set complete</div>' +
            '<p>Sets today: ' + quest.sessionsCompleted + ' / ' + quest.maxSessions +
            (quest.alreadyPassedToday ? ' · Reward already claimed' : '') + '</p>' +
            (quest.queue.length
              ? '<div class="vocab-actions" style="justify-content:center;margin-top:0.75rem;">' +
                '<button type="button" class="vocab-btn" id="vocabAnotherSetBtn">Study another set (' +
                (quest.sessionsCompleted + 1) + '/' + quest.maxSessions + ')</button></div>'
              : '<p class="vocab-empty">No more words available right now.</p>') +
            '</div>';
          var againBtn = $('vocabAnotherSetBtn');
          if (againBtn) againBtn.addEventListener('click', function () {
            quest.forceAnotherSet = true;
            quest.phase = 'idle';
            loadQuestInline();
          });
          return;
        }
        quest.forceAnotherSet = false;

        if (!quest.queue.length) {
          quest.phase = 'idle';
          box.innerHTML = '<p class="vocab-empty">No words available right now. Try again later.</p>';
          return;
        }
        startQuestStudy();
      })
      .catch(function (err) {
        box.innerHTML = '<p class="vocab-empty">Could not load today\u2019s words: ' + escapeHtml(err.message || 'error') + '</p>';
      });
  }

  function startQuestStudy(words) {
    var box = $('vocabQuestBody');
    var list = Array.isArray(words) && words.length ? words : quest.queue;
    if (!list.length) {
      if (box) box.innerHTML = '<p class="vocab-empty">No words available right now. Try again later.</p>';
      return;
    }
    quest.queue = list.slice();
    quest.studyIndex = 0;
    quest.studyMaxIndex = 0;
    quest.phase = 'study';
    renderQuestStudyCard();
  }

  function renderQuestStudyCard() {
    var box = $('vocabQuestBody');
    if (!box) return;
    if (quest.studyIndex >= quest.queue.length) {
      startQuestTest();
      return;
    }
    var w = quest.queue[quest.studyIndex];
    var L = w.levels || {};
    var basic = L.basic || {};
    var definition = w.simple_definition || basic.intuitive_definition || '';
    var koreanMeaning = w.korean_meaning || '';
    var example = w.example_sentence || (L.intermediate && L.intermediate.examples && L.intermediate.examples[0]) || '';
    var synonyms = Array.isArray(w.synonyms) ? w.synonyms : [];
    var canBack = quest.studyIndex > 0;
    box.innerHTML =
      '<div class="vocab-deck-nav">' +
      '<button type="button" class="vocab-btn secondary" id="vocabQuestBackWordBtn"' + (canBack ? '' : ' disabled') + '>Back</button>' +
      '<span class="vocab-empty">Studying ' + (quest.studyIndex + 1) + ' / ' + quest.queue.length + '</span>' +
      '<span></span></div>' +
      '<article class="vocab-word-card">' +
      '<div class="vocab-word-head">' +
      '<span class="word">' + escapeHtml(w.word) + '</span>' +
      '<span class="pos">' + escapeHtml(w.part_of_speech || '') + '</span>' +
      (w.pronunciation ? '<span class="pos">[' + escapeHtml(w.pronunciation) + ']</span>' : '') +
      '<span class="freq">Grade ' + escapeHtml(String(w.grade_level || '')) + '</span>' +
      '</div>' +
      '<p class="vocab-basic-def">' + escapeHtml(definition) + '</p>' +
      (koreanMeaning ? '<p class="vocab-metaphor">🇰🇷 ' + escapeHtml(koreanMeaning) + '</p>' : '') +
      (example ? '<h4>Example</h4><p>' + escapeHtml(example) + '</p>' : '') +
      (synonyms.length ? '<h4>Synonyms</h4><p>' + escapeHtml(synonyms.join(', ')) + '</p>' : '') +
      '</article>' +
      '<div class="vocab-actions">' +
      '<button type="button" class="vocab-btn ghost" id="vocabQuestForgotBtn">Still fuzzy</button>' +
      '<button type="button" class="vocab-btn" id="vocabQuestKnowBtn">Got it</button>' +
      '</div>';
    var back = $('vocabQuestBackWordBtn');
    var know = $('vocabQuestKnowBtn');
    var forgot = $('vocabQuestForgotBtn');
    if (back) back.addEventListener('click', function () {
      if (quest.studyIndex <= 0) return;
      quest.studyIndex -= 1;
      renderQuestStudyCard();
    });
    if (know) know.addEventListener('click', function () { answerQuestStudy(w, true); });
    if (forgot) forgot.addEventListener('click', function () { answerQuestStudy(w, false); });
  }

  function answerQuestStudy(word, gotIt) {
    apiFetch('/api/student/vocab/review', {
      method: 'POST',
      body: { wordId: word.word_id, correct: gotIt }
    }).catch(function () { /* SRS sync is best-effort */ });
    quest.studyIndex += 1;
    if (quest.studyIndex > quest.studyMaxIndex) quest.studyMaxIndex = quest.studyIndex;
    renderQuestStudyCard();
  }

  function buildTestTypeSchedule(n) {
    var base = ['sentence', 'meaning', 'whichWord'];
    var out = [];
    var i;
    for (i = 0; i < n; i++) out.push(base[i % base.length]);
    return shuffle(out);
  }

  function buildTestQuestion(word, pool, qIndex) {
    pool = pool || [];
    var types = quest.testTypes || [];
    var type = types[qIndex] || ['sentence', 'meaning', 'whichWord'][qIndex % 3];
    var distractors = pickDistractors(word, pool, 3);
    var prompt = '';
    var correct = '';
    var choices = [];
    var explanation = '';

    if (type === 'meaning') {
      prompt = 'What does “' + wordLabel(word) + '” mean?';
      correct = wordDef(word) || wordLabel(word);
      choices = uniqueChoices(correct, distractors.map(wordDef));
    } else if (type === 'whichWord') {
      var def = wordDef(word) || wordLabel(word);
      var ko = wordKo(word);
      prompt = ko
        ? ('Which word means this?\n' + ko + '\n(' + def + ')')
        : ('Which word means “' + def + '”?');
      correct = wordLabel(word);
      choices = uniqueChoices(correct, distractors.map(wordLabel));
    } else {
      // Sentence / cloze — always use today's words as choices (blocks "pick today's word" cheat)
      var clozeDaily = clozePromptFor(word);
      if (!clozeDaily) {
        type = 'meaning';
        prompt = 'What does “' + wordLabel(word) + '” mean?';
        correct = wordDef(word) || wordLabel(word);
        choices = uniqueChoices(correct, distractors.map(wordDef));
      } else {
        type = 'sentence';
        prompt = clozeDaily;
        correct = wordLabel(word);
        choices = uniqueChoices(correct, distractors.map(wordLabel));
        explanation = word.explanation_for_wrong || '';
      }
    }

    // If today's pool is short, pad with bank wrong_options (words only) as last resort
    if (choices.length < 4 && Array.isArray(word.wrong_options)) {
      word.wrong_options.forEach(function (opt) {
        if (choices.length >= 4) return;
        if (type === 'meaning') return;
        var s = String(opt || '').trim();
        if (s && choices.indexOf(s) < 0) choices.push(s);
      });
    }
    while (choices.length < 4) {
      var filler = pool[Math.floor(Math.random() * Math.max(1, pool.length))] || word;
      var text = type === 'meaning' ? wordDef(filler) : wordLabel(filler);
      if (text && choices.indexOf(text) < 0) choices.push(text);
      else break;
    }

    return {
      type: type,
      word: word,
      prompt: prompt,
      correct: correct,
      choices: shuffle(choices.slice(0, 4)),
      explanation: explanation
    };
  }

  function startQuestTest() {
    clearQuestTestTimer();
    quest.phase = 'test';
    quest.testWords = quest.queue.slice();
    quest.testTypes = buildTestTypeSchedule(quest.testWords.length);
    quest.testIndex = 0;
    quest.testAnswers = [];
    quest.locked = false;
    quest.selectedChoice = null;
    quest.pauseUsed = false;
    quest.paused = false;
    quest.pauseRemainingMs = 0;
    renderQuestTestQuestion();
  }

  function clearQuestTestTimer() {
    if (quest.timerId) {
      clearTimeout(quest.timerId);
      quest.timerId = null;
    }
    if (quest.tickId) {
      clearInterval(quest.tickId);
      quest.tickId = null;
    }
  }

  function updateQuestTestTimerUi(secondsLeft) {
    var el = $('vocabQuestTestTimer');
    if (!el) return;
    var sec = Math.max(0, Math.ceil(secondsLeft));
    el.textContent = sec + 's';
    el.classList.toggle('is-urgent', sec <= 10);
  }

  function setQuestTestPausedUi(paused) {
    var card = document.querySelector('#vocabQuestBody .vocab-q-card');
    var overlay = $('vocabQuestPauseOverlay');
    var pauseBtn = $('vocabQuestPauseBtn');
    if (card) card.classList.toggle('is-paused', !!paused);
    if (overlay) overlay.classList.toggle('hidden', !paused);
    if (pauseBtn) pauseBtn.classList.add('hidden');
    var box = $('vocabQuestBody');
    var buttons = box ? box.querySelectorAll('.vocab-choice') : [];
    buttons.forEach(function (btn) {
      btn.disabled = !!paused || quest.locked;
    });
    var nextBtn = $('vocabQuestTestNextBtn');
    if (nextBtn) nextBtn.disabled = !!paused || quest.locked || quest.selectedChoice == null;
  }

  function pauseQuestTest() {
    if (quest.pauseUsed || quest.paused || quest.locked || !quest.currentTestQ) return;
    quest.pauseUsed = true;
    quest.paused = true;
    quest.pauseRemainingMs = Math.max(0, (quest.timerEndsAt || Date.now()) - Date.now());
    clearQuestTestTimer();
    updateQuestTestTimerUi(quest.pauseRemainingMs / 1000);
    setQuestTestPausedUi(true);
  }

  function resumeQuestTest() {
    if (!quest.paused) return;
    quest.paused = false;
    setQuestTestPausedUi(false);
    startQuestTestTimer(quest.pauseRemainingMs);
  }

  /** @param {number=} remainingMs */
  function startQuestTestTimer(remainingMs) {
    clearQuestTestTimer();
    var ms = remainingMs != null ? Math.max(0, Number(remainingMs) || 0) : QUESTION_SECONDS * 1000;
    quest.timerEndsAt = Date.now() + ms;
    updateQuestTestTimerUi(ms / 1000);
    if (ms <= 0) {
      submitQuestTestAnswer(true);
      return;
    }
    quest.tickId = setInterval(function () {
      var left = (quest.timerEndsAt - Date.now()) / 1000;
      updateQuestTestTimerUi(left);
      if (left <= 0) clearInterval(quest.tickId);
    }, 200);
    quest.timerId = setTimeout(function () {
      submitQuestTestAnswer(true);
    }, ms);
  }

  function renderQuestTestQuestion() {
    var box = $('vocabQuestBody');
    if (!box) return;
    clearQuestTestTimer();
    if (quest.testIndex >= quest.testWords.length) {
      submitQuestTest();
      return;
    }
    quest.locked = false;
    quest.selectedChoice = null;
    quest.paused = false;
    quest.qStartedAt = Date.now();
    var w = quest.testWords[quest.testIndex];
    var q = buildTestQuestion(w, quest.testWords, quest.testIndex);
    quest.currentTestQ = q;
    var pct = Math.round((quest.testIndex / Math.max(1, quest.testWords.length)) * 100);
    box.innerHTML =
      '<div class="d-flex justify-content-between align-items-center" style="gap:0.5rem;flex-wrap:wrap;">' +
      '<strong>Daily test ' + (quest.testIndex + 1) + ' / ' + quest.testWords.length + '</strong></div>' +
      '<div class="vocab-progress"><span style="width:' + pct + '%"></span></div>' +
      '<div class="vocab-q-card has-timer">' +
      '<span class="vocab-quiz-timer" id="vocabQuestTestTimer" aria-live="polite">' + QUESTION_SECONDS + 's</span>' +
      '<span class="vocab-q-type">' + escapeHtml(quizTypeLabel(q.type)) + '</span>' +
      '<p class="vocab-q-prompt">' + escapeHtml(q.prompt).replace(/\n/g, '<br>') + '</p>' +
      '<div class="vocab-choices">' +
      q.choices.map(function (c, i) {
        return '<button type="button" class="vocab-choice" data-choice-i="' + i + '">' + escapeHtml(c) + '</button>';
      }).join('') +
      '</div>' +
      '<div class="vocab-actions vocab-q-actions">' +
      (!quest.pauseUsed
        ? '<button type="button" class="vocab-btn ghost" id="vocabQuestPauseBtn" title="One pause per test"><i class="fa-solid fa-pause"></i> Pause</button>'
        : '') +
      '<button type="button" class="vocab-btn" id="vocabQuestTestNextBtn" disabled>Next</button>' +
      '</div>' +
      '<div class="vocab-pause-overlay hidden" id="vocabQuestPauseOverlay">' +
      '<div class="vocab-pause-card">' +
      '<strong>Paused</strong>' +
      '<p>Timer is frozen. You get <strong>1 pause</strong> per test — bathroom breaks welcome.</p>' +
      '<button type="button" class="vocab-btn" id="vocabQuestResumeBtn"><i class="fa-solid fa-play"></i> Resume</button>' +
      '</div></div>' +
      '</div>';
    box.querySelectorAll('.vocab-choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        onSelectQuestTestChoice(Number(btn.getAttribute('data-choice-i')));
      });
    });
    var nextBtn = $('vocabQuestTestNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', function () { submitQuestTestAnswer(false); });
    var pauseBtn = $('vocabQuestPauseBtn');
    if (pauseBtn) pauseBtn.addEventListener('click', pauseQuestTest);
    var resumeBtn = $('vocabQuestResumeBtn');
    if (resumeBtn) resumeBtn.addEventListener('click', resumeQuestTest);
    startQuestTestTimer();
  }

  function onSelectQuestTestChoice(choiceIndex) {
    if (quest.locked || quest.paused || !quest.currentTestQ) return;
    quest.selectedChoice = choiceIndex;
    var box = $('vocabQuestBody');
    var buttons = box ? box.querySelectorAll('.vocab-choice') : [];
    buttons.forEach(function (btn, i) {
      btn.classList.toggle('is-selected', i === choiceIndex);
    });
    var nextBtn = $('vocabQuestTestNextBtn');
    if (nextBtn) nextBtn.disabled = false;
  }

  /** @param {boolean} timedOut */
  function submitQuestTestAnswer(timedOut) {
    if (quest.locked || quest.paused || !quest.currentTestQ) return;
    quest.locked = true;
    clearQuestTestTimer();

    var q = quest.currentTestQ;
    var choiceIndex = quest.selectedChoice;
    var hasPick = choiceIndex != null && choiceIndex >= 0;
    var picked = hasPick ? q.choices[choiceIndex] : null;
    var correct = !!(hasPick && picked === q.correct);
    quest.testAnswers.push({ correct: correct, word: q.word, timedOut: !!timedOut });

    var box = $('vocabQuestBody');
    var buttons = box ? box.querySelectorAll('.vocab-choice') : [];
    buttons.forEach(function (btn) { btn.disabled = true; });
    var nextBtn = $('vocabQuestTestNextBtn');
    if (nextBtn) nextBtn.disabled = true;
    var pauseBtn = $('vocabQuestPauseBtn');
    if (pauseBtn) pauseBtn.disabled = true;

    quest.testIndex += 1;
    renderQuestTestQuestion();
  }

  function submitQuestTest() {
    clearQuestTestTimer();
    var correctCount = quest.testAnswers.filter(function (a) { return a.correct; }).length;
    var total = quest.testAnswers.length;
    var missed = quest.testAnswers.filter(function (a) { return !a.correct; }).map(function (a) { return a.word; });
    var seen = {};
    missed = missed.filter(function (w) {
      if (!w || !w.word_id || seen[w.word_id]) return false;
      seen[w.word_id] = true;
      return true;
    });

    apiFetch('/api/student/vocab/daily-test/submit', {
      method: 'POST',
      body: {
        correctCount: correctCount,
        totalCount: total,
        answers: quest.testAnswers.map(function (a) {
          return {
            wordId: a.word && a.word.word_id,
            correct: !!a.correct
          };
        })
      }
    }).then(function (res) {
      if (!res.passed && missed.length) {
        renderMissedRestudyGate(res, correctCount, total, missed);
        return;
      }
      renderQuestDone(res, correctCount, total);
    }).catch(function (err) {
      var box = $('vocabQuestBody');
      if (box) box.innerHTML = '<p class="vocab-empty">Could not submit today\u2019s test: ' + escapeHtml(err.message || 'error') + '</p>';
    });
  }

  function renderMissedRestudyGate(res, correctCount, total, missed) {
    var box = $('vocabQuestBody');
    if (!box) return;
    clearQuestTestTimer();
    quest.phase = 'idle';
    box.innerHTML =
      '<div class="vocab-result">' +
      '<div class="vocab-tier-badge"><i class="fa-solid fa-rotate-left"></i> Review the ones you missed</div>' +
      '<h3>Score: ' + correctCount + ' / ' + total + ' (' + res.score + '%)</h3>' +
      '<p>You need 100% to finish. Restudy the ' + missed.length +
      ' missed word' + (missed.length === 1 ? '' : 's') + ', then take the test again from the start.</p>' +
      '<div class="vocab-actions">' +
      '<button type="button" class="vocab-btn" id="vocabQuestRestudyBtn">Restudy missed words</button>' +
      '</div></div>';
    var btn = $('vocabQuestRestudyBtn');
    if (btn) btn.addEventListener('click', function () {
      startQuestStudy(missed);
    });
  }

  function renderQuestDone(res, correctCount, total) {
    var box = $('vocabQuestBody');
    if (!box) return;
    clearQuestTestTimer();
    var passed = !!res.passed;
    var reward = res.reward;
    var dollarBonus = res.dollarBonus;
    quest.phase = passed ? 'done' : 'idle';
    if (passed) {
      quest.sessionsCompleted = res.sessionsCompleted != null ? res.sessionsCompleted : (quest.sessionsCompleted + 1);
      quest.maxSessions = res.maxSessions || quest.maxSessions || 3;
      quest.alreadyPassedToday = true;
    }
    var mastery = res.mastery || (res.rating && res.rating.mastery);
    var canMore = passed && res.canStartAnother;
    var hasSpinReward = !!(passed && reward && (reward.tier || reward.prizeText));
    var hasDollarReward = !!(passed && dollarBonus && Number(dollarBonus.amount) > 0);

    box.innerHTML =
      '<div class="vocab-result vocab-result-celebrate">' +
      '<div class="vocab-tier-badge"><i class="fa-solid ' + (passed ? 'fa-trophy' : 'fa-rotate-left') + '"></i> ' +
      (passed ? 'Set complete!' : 'Almost there') + '</div>' +
      '<h3>Score: ' + correctCount + ' / ' + total + ' (' + res.score + '%)</h3>' +
      '<p>Pass threshold: ' + res.threshold + '%' +
      (passed ? ' · Sets today: ' + quest.sessionsCompleted + ' / ' + quest.maxSessions : '') + '</p>' +
      (res.rating && res.rating.promoted === 'up'
        ? '<p>⬆️ Promoted to Grade ' + escapeHtml(String(res.rating.gradeLevel)) + ' (' + escapeHtml(res.rating.tierName) + ')!</p>'
        : '') +
      (mastery
        ? '<p>Tier mastery: <strong>' + mastery.mastered + ' / ' + mastery.tierWords + '</strong> (' + mastery.percent + '%)' +
          (mastery.remaining > 0 ? ' · ' + mastery.remaining + ' left to promote' : ' · promote-ready!') + '</p>'
        : '') +
      (res.streak ? '<p>🔥 Streak: ' + res.streak.streakDays + ' day' + (res.streak.streakDays === 1 ? '' : 's') + ' (best ' + res.streak.longestStreak + ')</p>' : '') +
      '<div id="vocabRewardStage" class="vocab-reward-stage">' +
      (hasSpinReward
        ? '<p class="vocab-reward-hint">Your Lucky Draw ticket is ready — open it!</p>' +
          '<div class="vocab-actions" style="justify-content:center;">' +
          '<button type="button" class="vocab-btn vocab-reward-spin-btn" id="vocabOpenLuckyBtn">' +
          '<i class="fa-solid fa-dice"></i> Open Lucky Draw</button></div>'
        : (passed && !reward
          ? '<p class="vocab-empty">Set saved. (Reward ticket could not be granted — try again next set.)</p>'
          : '')) +
      '</div>' +
      (canMore
        ? '<div class="vocab-actions" style="justify-content:center;margin-top:0.85rem;" id="vocabAnotherSetWrap">' +
          '<button type="button" class="vocab-btn secondary" id="vocabAnotherSetBtn">Study another set (' +
          (quest.sessionsCompleted + 1) + '/' + quest.maxSessions + ')</button></div>'
        : '') +
      '</div>';

    if (canMore) {
      var again = $('vocabAnotherSetBtn');
      if (again) again.addEventListener('click', function () {
        quest.forceAnotherSet = true;
        quest.phase = 'idle';
        loadQuestInline();
      });
    }

    if (hasSpinReward) {
      var openBtn = $('vocabOpenLuckyBtn');
      if (openBtn) {
        openBtn.addEventListener('click', function () {
          runVocabRewardCeremony(reward, hasDollarReward ? dollarBonus : null);
        });
      }
    } else if (hasDollarReward) {
      // Ticket already claimed earlier but dollar shown? Unlikely; still offer claim.
      showVocabDollarClaimButton(dollarBonus);
    }

    if (passed) refreshServerSummary();
  }

  function showVocabDollarClaimButton(dollarBonus) {
    var stage = $('vocabRewardStage');
    if (!stage || !dollarBonus) return;
    stage.innerHTML =
      '<p class="vocab-reward-hint">Tier dollar bonus unlocked!</p>' +
      '<div class="vocab-actions" style="justify-content:center;">' +
      '<button type="button" class="vocab-btn vocab-reward-dollar-btn" id="vocabClaimDollarBtn">' +
      '<i class="fa-solid fa-sack-dollar"></i> Claim $' +
      escapeHtml(String(dollarBonus.amount)) + '</button></div>';
    var btn = $('vocabClaimDollarBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        runVocabDollarCeremony(dollarBonus);
      });
    }
  }

  function runVocabRewardCeremony(reward, dollarBonus) {
    var openBtn = $('vocabOpenLuckyBtn');
    if (openBtn) openBtn.disabled = true;
    var tier = (reward && reward.tier) || 'Prize';
    var prize = (reward && reward.prizeText) || 'Mystery Prize';
    var done = function () {
      var stage = $('vocabRewardStage');
      if (stage) {
        stage.innerHTML =
          '<p class="vocab-reward-won"><strong>' + escapeHtml(tier) + '</strong> — “' +
          escapeHtml(prize) + '”</p>';
      }
      if (dollarBonus && Number(dollarBonus.amount) > 0) {
        showVocabDollarClaimButton(dollarBonus);
      }
      try {
        if (typeof root.refreshStudentLuckyDraw === 'function') root.refreshStudentLuckyDraw();
      } catch (e) { /* ignore */ }
    };
    function tryReveal(attempt) {
      var effects = root.MrParkLuckyEffects;
      if (effects && typeof effects.revealSpin === 'function') {
        Promise.resolve(effects.revealSpin(tier, prize, {
          title: 'Vocab Booster reward!',
          sub: 'Feeling lucky?',
          resultSub: 'Ticket added to your Lucky Draw.',
          doneLabel: 'Collect!'
        })).then(done).catch(function () {
          if (openBtn) openBtn.disabled = false;
          done();
        });
        return;
      }
      if (attempt < 8) {
        setTimeout(function () { tryReveal(attempt + 1); }, 150);
        return;
      }
      console.warn('[vocab] MrParkLuckyEffects.revealSpin missing — showing plain reward');
      done();
    }
    tryReveal(0);
  }

  function runVocabDollarCeremony(dollarBonus) {
    var btn = $('vocabClaimDollarBtn');
    if (btn) btn.disabled = true;
    var amount = Number(dollarBonus && dollarBonus.amount) || 0;
    var tierName = (dollarBonus && dollarBonus.tierName) || '';
    var finish = function () {
      var stage = $('vocabRewardStage');
      if (stage) {
        stage.innerHTML =
          '<p class="vocab-reward-won">💵 You collected <strong>+$' +
          escapeHtml(String(amount)) + '</strong>' +
          (tierName ? ' (' + escapeHtml(tierName) + ' tier)' : '') + '!</p>';
      }
    };
    function tryCelebrate(attempt) {
      var effects = root.MrParkLuckyEffects;
      if (effects && typeof effects.celebrateDollars === 'function') {
        Promise.resolve(effects.celebrateDollars(amount, {
          tierName: tierName,
          message: tierName
            ? ('Nice work — ' + tierName + ' tier bonus!')
            : 'Nice work — tier dollar bonus!'
        })).then(finish).catch(finish);
        return;
      }
      if (attempt < 8) {
        setTimeout(function () { tryCelebrate(attempt + 1); }, 150);
        return;
      }
      console.warn('[vocab] MrParkLuckyEffects.celebrateDollars missing — showing plain dollar text');
      finish();
    }
    tryCelebrate(0);
  }

  function bindShell() {
    var start = $('vocabStartTestBtn');
    if (start) start.addEventListener('click', startPlacement);
    var hero = $('vocabTierHero');
    if (hero && !hero.dataset.tierLadderBound) {
      hero.dataset.tierLadderBound = '1';
      hero.setAttribute('role', 'button');
      hero.setAttribute('tabindex', '0');
      hero.setAttribute('aria-expanded', 'false');
      hero.setAttribute('aria-controls', 'vocabTierLadder');
      hero.addEventListener('click', function (e) {
        e.preventDefault();
        toggleTierLadder();
      });
      hero.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleTierLadder();
        } else if (e.key === 'Escape') {
          setTierLadderOpen(false);
        }
      });
    }
    if (!state._tierLadderDocBound) {
      state._tierLadderDocBound = true;
      document.addEventListener('click', function (e) {
        if (!isTierLadderOpen()) return;
        var t = e.target;
        if (hero && hero.contains(t)) return;
        var ladder = $('vocabTierLadder');
        if (ladder && ladder.contains(t)) return;
        setTierLadderOpen(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setTierLadderOpen(false);
      });
    }
  }

  function init() {
    if (!data()) {
      console.warn('[vocab] MrParkVocabData missing');
    }
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (e) { /* ignore */ }
    ensureStudentSession();
    if (state._bound) {
      refreshServerSummary();
      return;
    }
    state._bound = true;
    bindShell();
    setView('home');
    refreshServerSummary();
  }

  function onLogout() {
    resetVocabSession();
  }

  function onLogin() {
    ensureStudentSession();
    setView('home');
    return refreshServerSummary();
  }

  root.MrParkVocabLearn = {
    init: init,
    onLogout: onLogout,
    onLogin: onLogin,
    resetSession: resetVocabSession,
    applyServerSummary: applyServerSummary,
    startPlacement: startPlacement,
    openQuest: openQuest,
    setView: setView,
    refreshServerSummary: refreshServerSummary
  };

  // Morning Class sets mrParkStudentApi after this script loads — wait for the host
  // portal to call init()/onLogin() so a no-auth summary failure cannot win a race.
  function canAutoInit() {
    return !!$('vocabShell') && typeof root.mrParkStudentApi === 'function';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (canAutoInit()) init();
    });
  } else if (canAutoInit()) {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
