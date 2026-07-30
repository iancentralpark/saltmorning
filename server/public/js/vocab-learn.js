/**
 * Student Vocab Learner — Placement Test + Step Cards + AI Deep-Dive (DB-free first).
 * Expects window.MrParkVocabData from vocab-mock-data.js and Student portal api()/TOKEN patterns via hooks.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'mrpark_vocab_placement_v1';
  var QUESTION_COUNT = 12;
  var QUESTION_SECONDS = 60;
  var PLACEMENT_SECONDS = QUESTION_SECONDS;
  var state = {
    view: 'home', // home | quiz | result | quest
    abilityGrade: 6,
    questionIndex: 0,
    answers: [],
    currentQ: null,
    qStartedAt: 0,
    locked: false,
    selectedChoice: null,
    placementTimerId: null,
    placementTickId: null,
    placement: null,
    placementDone: false,
    deckIndex: 0,
    deck: []
  };

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
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function savePlacement(result) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        at: Date.now(),
        result: result
      }));
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
    try { token = localStorage.getItem('mrpark_student_token') || ''; } catch (e) {}
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

  var quest = {
    queue: [],
    masterQueue: [],
    targetCount: 10,
    passThreshold: 100,
    studyIndex: 0,
    studyMaxIndex: 0,
    phase: 'idle', // idle | study | test | done
    testIndex: 0,
    testWords: [],
    testAnswers: [],
    currentTestQ: null,
    locked: false,
    selectedChoice: null,
    qStartedAt: 0,
    timerId: null,
    tickId: null,
    alreadyPassedToday: false
  };

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
    state.placementDone = !!summary.placementDone;
    if (summary.placementDone) {
      state.placement = {
        gradeLevel: summary.gradeLevel,
        accuracy: summary.placementAccuracy,
        tier: { name: summary.tierName, gradeLevel: summary.gradeLevel }
      };
    } else {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      state.placement = null;
    }
    if (summary.settings && summary.settings.passThreshold != null) {
      quest.passThreshold = summary.settings.passThreshold;
    }
    renderHomeStats();
    syncPlacementVisibility();
    // Don't wipe an in-progress study/test or the post-test reward screen.
    if (
      state.placementDone &&
      state.view !== 'quiz' &&
      state.view !== 'result' &&
      quest.phase === 'idle'
    ) {
      loadQuestInline();
    }
  }

  function refreshServerSummary() {
    return apiFetch('/api/student/vocab/summary?_=' + Date.now())
      .then(function (summary) {
        applyServerSummary(summary);
        return summary;
      })
      .catch(function () {
        var saved = loadSaved();
        if (saved && saved.result) {
          state.placement = saved.result;
          state.placementDone = true;
        }
        renderHomeStats();
        syncPlacementVisibility();
        if (state.placementDone && quest.phase === 'idle') loadQuestInline();
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
      if (hero) hero.className = 'vocab-tier-hero';
      return;
    }
    tierEl.textContent = tierName;
    if (startEl) startEl.textContent = grade ? ('Grade ' + grade) : '';
    var badge = TIER_BADGES[tierName] || TIER_BADGES.Rookie;
    if (mark) mark.innerHTML = '<i class="fa-solid ' + badge.icon + '"></i>';
    if (hero) hero.className = 'vocab-tier-hero ' + badge.className;
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
    var others = pool.filter(function (w) { return w.word_id !== correctWord.word_id; });
    return shuffle(others).slice(0, n);
  }

  function buildQuestion(targetGrade, qIndex) {
    var pack = data();
    if (!pack) return null;
    var band = pack.wordsInGrade(targetGrade, 1);
    if (band.length < 4) band = pack.sortedWords();
    var word = pack.findNearestGrade(targetGrade);
    // Prefer a word actually in band
    if (band.length) {
      word = band[Math.floor(Math.random() * band.length)];
    }
    var types = ['meaning', 'cloze', 'nuance'];
    var type = types[qIndex % types.length];
    // Harder types only when ability is mid+
    if (targetGrade < 3 && type === 'nuance') type = 'meaning';
    if (targetGrade < 5 && type === 'nuance' && Math.random() < 0.5) type = 'cloze';

    var choices = [];
    var prompt = '';
    var correct = '';

    if (type === 'meaning') {
      prompt = 'What is the most intuitive meaning of “' + word.word + '”?';
      correct = word.levels.basic.intuitive_definition;
      choices = [correct].concat(pickDistractors(word, band.length >= 4 ? band : pack.WORDS, 3).map(function (w) {
        return w.levels.basic.intuitive_definition;
      }));
    } else if (type === 'cloze') {
      var ex = (word.levels.intermediate.examples && word.levels.intermediate.examples[0]) ||
        ('Please use the word “' + word.word + '” correctly.');
      var blanked = ex.replace(new RegExp('\\b' + word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '______');
      if (blanked === ex) blanked = 'Fill the blank: “______” fits this idea — ' + word.levels.basic.intuitive_definition;
      prompt = blanked;
      correct = word.word;
      choices = [correct].concat(pickDistractors(word, band.length >= 4 ? band : pack.WORDS, 3).map(function (w) {
        return w.word;
      }));
    } else {
      prompt = 'Which statement best captures a nuance of “' + word.word + '”?';
      correct = word.levels.intermediate.mechanism_and_nuance;
      choices = [correct].concat(pickDistractors(word, band.length >= 4 ? band : pack.WORDS, 3).map(function (w) {
        return w.levels.intermediate.mechanism_and_nuance;
      }));
    }

    choices = shuffle(choices);
    // de-dupe
    var seen = {};
    choices = choices.filter(function (c) {
      var k = String(c);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    while (choices.length < 4) {
      var filler = pack.WORDS[Math.floor(Math.random() * pack.WORDS.length)];
      var text = type === 'cloze' ? filler.word : filler.levels.basic.intuitive_definition;
      if (choices.indexOf(text) < 0) choices.push(text);
    }

    return {
      type: type,
      word: word,
      prompt: prompt,
      correct: correct,
      choices: choices.slice(0, 4),
      frequencyLevel: word.grade_level // wire field name kept for server compat; value is now Grade 1-12
    };
  }

  function localUpdateAbility(abilityGrade, item) {
    var ability = Math.max(0.5, Math.min(12.5, Number(abilityGrade) || 6));
    var correct = !!(item && item.correct);
    var seconds = Math.max(0.5, Number(item && item.seconds) || 8);
    var type = String((item && item.questionType) || 'meaning');
    var step = type === 'nuance' ? 0.7 : type === 'cloze' ? 0.6 : 0.55;
    var fast = seconds <= 6;
    var slow = seconds >= 18;
    if (correct) ability += step * (fast ? 1.25 : slow ? 0.75 : 1);
    else ability -= step * (fast ? 0.9 : slow ? 1.15 : 1);
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

  function startPlacementTimer() {
    clearPlacementTimer();
    var endsAt = state.qStartedAt + PLACEMENT_SECONDS * 1000;
    updatePlacementTimerUi(PLACEMENT_SECONDS);
    state.placementTickId = setInterval(function () {
      var left = (endsAt - Date.now()) / 1000;
      updatePlacementTimerUi(left);
      if (left <= 0) clearInterval(state.placementTickId);
    }, 200);
    state.placementTimerId = setTimeout(function () {
      onPlacementTimeout();
    }, PLACEMENT_SECONDS * 1000);
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
    state.abilityGrade = 6;
    state.questionIndex = 0;
    state.answers = [];
    state.locked = false;
    state.selectedChoice = null;
    setView('quiz');
    showQuestion();
  }

  function showQuestion() {
    clearPlacementTimer();
    state.locked = false;
    state.selectedChoice = null;
    state.qStartedAt = Date.now();
    var q = buildQuestion(Math.round(state.abilityGrade), state.questionIndex);
    state.currentQ = q;
    var progress = $('vocabQuizProgress');
    if (progress) progress.style.width = Math.round((state.questionIndex / QUESTION_COUNT) * 100) + '%';
    var count = $('vocabQuizCount');
    if (count) count.textContent = 'Question ' + (state.questionIndex + 1) + ' / ' + QUESTION_COUNT;
    if (!q) {
      $('vocabQuizBody').innerHTML = '<p class="vocab-empty">Mock data failed to load.</p>';
      return;
    }
    var typeLabel = q.type === 'meaning' ? 'Intuitive meaning' : q.type === 'cloze' ? 'Context cloze' : 'Nuance check';
    var html = '<div class="vocab-q-card">' +
      '<span class="vocab-q-type">' + escapeHtml(typeLabel) + '</span>' +
      '<p class="vocab-q-prompt">' + escapeHtml(q.prompt) + '</p>' +
      '<div class="vocab-choices">' +
      q.choices.map(function (c, i) {
        return '<button type="button" class="vocab-choice" data-choice-i="' + i + '">' + escapeHtml(c) + '</button>';
      }).join('') +
      '</div>' +
      '<div class="vocab-actions vocab-q-actions">' +
      '<button type="button" class="vocab-btn" id="vocabPlacementNextBtn" disabled>Next</button>' +
      '</div>' +
      '</div>';
    $('vocabQuizBody').innerHTML = html;
    $('vocabQuizBody').querySelectorAll('.vocab-choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        onSelectPlacementChoice(Number(btn.getAttribute('data-choice-i')));
      });
    });
    var nextBtn = $('vocabPlacementNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', function () { submitPlacementAnswer(false); });
    startPlacementTimer();
  }

  function onSelectPlacementChoice(choiceIndex) {
    if (state.locked || !state.currentQ) return;
    state.selectedChoice = choiceIndex;
    var buttons = $('vocabQuizBody').querySelectorAll('.vocab-choice');
    buttons.forEach(function (btn, i) {
      btn.classList.toggle('is-selected', i === choiceIndex);
    });
    var nextBtn = $('vocabPlacementNextBtn');
    if (nextBtn) nextBtn.disabled = false;
  }

  function onPlacementTimeout() {
    if (state.locked) return;
    // Time’s up: submit current pick if any, otherwise count as incorrect.
    submitPlacementAnswer(true);
  }

  /** @param {boolean} timedOut */
  function submitPlacementAnswer(timedOut) {
    if (state.locked || !state.currentQ) return;
    state.locked = true;
    clearPlacementTimer();

    var q = state.currentQ;
    var choiceIndex = state.selectedChoice;
    var hasPick = choiceIndex != null && choiceIndex >= 0;
    var picked = hasPick ? q.choices[choiceIndex] : null;
    var correct = !!(hasPick && picked === q.correct);
    var seconds = timedOut
      ? PLACEMENT_SECONDS
      : Math.min(PLACEMENT_SECONDS, (Date.now() - state.qStartedAt) / 1000);
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

    state.abilityGrade = localUpdateAbility(state.abilityGrade, answer);

    apiFetch('/api/student/vocab/placement/next', {
      method: 'POST',
      body: {
        abilityGrade: state.abilityGrade,
        correct: correct,
        seconds: seconds,
        questionType: q.type,
        questionIndex: state.questionIndex
      }
    }).then(function (res) {
      if (res && res.abilityGrade) state.abilityGrade = res.abilityGrade;
    }).catch(function () { /* keep local */ });

    state.questionIndex += 1;
    if (state.questionIndex >= QUESTION_COUNT) finishPlacement();
    else showQuestion();
  }

  function finishPlacement() {
    clearPlacementTimer();
    var body = { answers: state.answers };
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
      var tier = pack ? pack.tierForGrade(gradeLevel) : { name: 'Gold', gradeLevel: gradeLevel };
      var correctCount = state.answers.filter(function (a) { return a.correct; }).length;
      var res = {
        ok: true,
        correctCount: correctCount,
        accuracy: Math.round((correctCount / Math.max(1, state.answers.length)) * 1000) / 10,
        abilityGrade: ability,
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
    if (quest.phase === 'study' || quest.phase === 'test' || quest.phase === 'done') return;
    box.innerHTML = '<p class="vocab-empty">Loading today\u2019s words…</p>';
    apiFetch('/api/student/vocab/daily-queue')
      .then(function (queue) {
        quest.targetCount = queue.targetCount || 10;
        quest.passThreshold = queue.passThreshold || 100;
        quest.masterQueue = (queue.words || []).slice();
        quest.queue = quest.masterQueue.slice();
        quest.alreadyPassedToday = !!queue.testPassed;
        if (quest.alreadyPassedToday) {
          quest.phase = 'done';
          box.innerHTML =
            '<div class="vocab-result">' +
            '<div class="vocab-tier-badge"><i class="fa-solid fa-trophy"></i> Today\u2019s quest is complete!</div>' +
            '<p>Nice work — come back tomorrow to keep your streak going.</p>' +
            '</div>';
          return;
        }
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

  function buildTestQuestion(word, pool, qIndex) {
    if (word.cloze_question && Array.isArray(word.wrong_options) && word.wrong_options.length === 3) {
      var choices = shuffle([word.word].concat(word.wrong_options));
      return {
        type: 'cloze',
        word: word,
        prompt: word.cloze_question,
        correct: word.word,
        choices: choices,
        explanation: word.explanation_for_wrong || ''
      };
    }
    var L = word.levels || {};
    var basic = L.basic || {};
    var definition = word.simple_definition || basic.intuitive_definition || word.word;
    var distractors = (pool || []).filter(function (w2) { return w2.word_id !== word.word_id; });
    var wrongDefs = shuffle(distractors).slice(0, 3).map(function (w2) {
      var l2 = w2.levels || {};
      return w2.simple_definition || (l2.basic || {}).intuitive_definition || w2.word;
    });
    while (wrongDefs.length < 3) wrongDefs.push('—');
    return {
      type: 'meaning',
      word: word,
      prompt: 'What does “' + word.word + '” mean?',
      correct: definition,
      choices: shuffle([definition].concat(wrongDefs.slice(0, 3))),
      explanation: ''
    };
  }

  function startQuestTest() {
    clearQuestTestTimer();
    quest.phase = 'test';
    quest.testWords = quest.queue.slice();
    quest.testIndex = 0;
    quest.testAnswers = [];
    quest.locked = false;
    quest.selectedChoice = null;
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

  function startQuestTestTimer() {
    clearQuestTestTimer();
    var endsAt = quest.qStartedAt + QUESTION_SECONDS * 1000;
    updateQuestTestTimerUi(QUESTION_SECONDS);
    quest.tickId = setInterval(function () {
      var left = (endsAt - Date.now()) / 1000;
      updateQuestTestTimerUi(left);
      if (left <= 0) clearInterval(quest.tickId);
    }, 200);
    quest.timerId = setTimeout(function () {
      submitQuestTestAnswer(true);
    }, QUESTION_SECONDS * 1000);
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
    quest.qStartedAt = Date.now();
    var w = quest.testWords[quest.testIndex];
    var q = buildTestQuestion(w, quest.testWords, quest.testIndex);
    quest.currentTestQ = q;
    var pct = Math.round((quest.testIndex / Math.max(1, quest.testWords.length)) * 100);
    box.innerHTML =
      '<div class="d-flex justify-content-between align-items-center" style="gap:0.5rem;flex-wrap:wrap;">' +
      '<strong>Daily test ' + (quest.testIndex + 1) + ' / ' + quest.testWords.length + '</strong>' +
      '<span class="vocab-quiz-timer" id="vocabQuestTestTimer" aria-live="polite">' + QUESTION_SECONDS + 's</span></div>' +
      '<div class="vocab-progress"><span style="width:' + pct + '%"></span></div>' +
      '<div class="vocab-q-card">' +
      '<p class="vocab-q-prompt">' + escapeHtml(q.prompt) + '</p>' +
      '<div class="vocab-choices">' +
      q.choices.map(function (c, i) {
        return '<button type="button" class="vocab-choice" data-choice-i="' + i + '">' + escapeHtml(c) + '</button>';
      }).join('') +
      '</div>' +
      '<div class="vocab-actions vocab-q-actions">' +
      '<button type="button" class="vocab-btn" id="vocabQuestTestNextBtn" disabled>Next</button>' +
      '</div>' +
      '</div>';
    box.querySelectorAll('.vocab-choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        onSelectQuestTestChoice(Number(btn.getAttribute('data-choice-i')));
      });
    });
    var nextBtn = $('vocabQuestTestNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', function () { submitQuestTestAnswer(false); });
    startQuestTestTimer();
  }

  function onSelectQuestTestChoice(choiceIndex) {
    if (quest.locked || !quest.currentTestQ) return;
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
    if (quest.locked || !quest.currentTestQ) return;
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
      body: { correctCount: correctCount, totalCount: total }
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
    quest.phase = passed ? 'done' : 'idle';
    box.innerHTML =
      '<div class="vocab-result">' +
      '<div class="vocab-tier-badge"><i class="fa-solid ' + (passed ? 'fa-trophy' : 'fa-rotate-left') + '"></i> ' +
      (passed ? 'Quest complete!' : 'Almost there') + '</div>' +
      '<h3>Score: ' + correctCount + ' / ' + total + ' (' + res.score + '%)</h3>' +
      '<p>Pass threshold: ' + res.threshold + '%' + (res.alreadyPassedToday ? ' · Already rewarded today' : '') + '</p>' +
      (reward ? '<p>🎁 Reward earned: <strong>' + escapeHtml(reward.tier || '') + '</strong> — “' + escapeHtml(reward.prizeText || '') + '”</p>' : '') +
      (res.dollarBonus ? '<p>💵 Tier bonus: <strong>+$' + escapeHtml(String(res.dollarBonus.amount)) + '</strong> (' + escapeHtml(res.dollarBonus.tierName || '') + ')</p>' : '') +
      (res.rating && res.rating.promoted ? '<p>' + (res.rating.promoted === 'up'
        ? '⬆️ Promoted to Grade ' + escapeHtml(String(res.rating.gradeLevel)) + ' (' + escapeHtml(res.rating.tierName) + ')!'
        : '⬇️ Moved to Grade ' + escapeHtml(String(res.rating.gradeLevel)) + ' (' + escapeHtml(res.rating.tierName) + ') to rebuild your streak.') + '</p>' : '') +
      (res.streak ? '<p>🔥 Streak: ' + res.streak.streakDays + ' day' + (res.streak.streakDays === 1 ? '' : 's') + ' (best ' + res.streak.longestStreak + ')</p>' : '') +
      '</div>';
    if (passed) refreshServerSummary();
  }

  function bindShell() {
    var start = $('vocabStartTestBtn');
    if (start) start.addEventListener('click', startPlacement);
  }

  function init() {
    if (!data()) {
      console.warn('[vocab] MrParkVocabData missing');
    }
    if (state._bound) {
      refreshServerSummary();
      return;
    }
    state._bound = true;
    bindShell();
    setView('home');
    refreshServerSummary();
  }

  root.MrParkVocabLearn = {
    init: init,
    startPlacement: startPlacement,
    openQuest: openQuest,
    setView: setView,
    refreshServerSummary: refreshServerSummary
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if ($('vocabShell')) init();
    });
  } else if ($('vocabShell')) {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
