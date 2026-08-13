/* Salt Morning Class — Common Curriculum-style lesson calendar */
window.SaltLesson = (function() {
  let deps = {};
  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;
  let calendar = null;
  let activeSlot = null;
  let currentPlanId = null;
  let activeCardEl = null;
  let mountId = 'lpCalendarMount';
  let readOnly = false;
  let subjectGroups = null;
  let globalMode = false;

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function api(path, opts) { return deps.api(path, opts, deps.role || 'teacher'); }
  function getClass() { return deps.getClass ? deps.getClass() : null; }

  function init(options) {
    deps = options;
    document.querySelectorAll('.lp-prev-month').forEach((btn) => {
      btn.addEventListener('click', () => shiftMonth(-1));
    });
    document.querySelectorAll('.lp-next-month').forEach((btn) => {
      btn.addEventListener('click', () => shiftMonth(1));
    });
    document.querySelectorAll('.lp-today-btn').forEach((btn) => {
      btn.addEventListener('click', goToday);
    });
    const closeBtn = $('lpDrawerClose');
    const backdrop = $('lpDrawerBackdrop');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    const saveDraft = $('lpSaveDraftBtn');
    const submitBtn = $('lpSubmitBtn');
    const subjectSelect = $('lpSubjectSelect');
    if (saveDraft) saveDraft.addEventListener('click', () => savePlan(false));
    if (submitBtn) submitBtn.addEventListener('click', () => savePlan(true));
    if (subjectSelect) subjectSelect.addEventListener('change', onSubjectChange);
    if ($('lpAdminDrawerClose')) {
      $('lpAdminDrawerClose').addEventListener('click', closeAdminDrawer);
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSemesterSave();
    });
    window.addEventListener('beforeunload', () => {
      if (semesterSaveTimer) flushSemesterSave();
    });
    document.addEventListener('click', (e) => {
      if (readOnly || (deps.role && (deps.role === 'admin' || deps.role === 'principal' || deps.role === 'staff'))) return;
      const card = e.target.closest('.lp-slot-card');
      if (!card || !card.closest('#lpCalendarMount')) return;
      e.preventDefault();
      e.stopPropagation();
      const slot = slotFromCard(card);
      if (slot) handleSlotClick(slot, false, card);
    });
  }

  function slotFromCard(card) {
    if (!card.dataset.classId || !card.dataset.lessonDate) return null;
    return {
      classId: card.dataset.classId,
      className: card.dataset.className || card.dataset.classId,
      subject: card.dataset.subject,
      lessonDate: card.dataset.lessonDate,
      plan: card.dataset.planId ? { planId: card.dataset.planId } : null
    };
  }

  function shiftMonth(delta) {
    month += delta;
    if (month < 1) { month = 12; year--; }
    if (month > 12) { month = 1; year++; }
    if ((deps.role === 'admin' || deps.role === 'principal' || deps.role === 'staff') || readOnly) loadAdminCalendar();
    else loadCalendar();
  }

  function goToday() {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
    if ((deps.role === 'admin' || deps.role === 'principal' || deps.role === 'staff') || readOnly) loadAdminCalendar();
    else loadCalendar();
  }

  function setMount(id) {
    mountId = id;
  }

  function setReadOnly(flag) {
    readOnly = !!flag;
  }

  function updateMonthLabel() {
    const label = MONTHS[month - 1] + ' ' + year;
    document.querySelectorAll('.lp-month-label').forEach((el) => {
      el.textContent = label;
    });
  }

  function syncStylesFromCalendar() {
    if (!calendar || !subjectGroups) return;
    if (calendar.subjectStyles) subjectGroups.resolvedStyles = calendar.subjectStyles;
    if (calendar.customSubjectStyles) subjectGroups.styles = calendar.customSubjectStyles;
    if (calendar.subjectStylePalette) subjectGroups.stylePalette = calendar.subjectStylePalette;
  }

  function t(key, fallback) {
    if (window.SaltI18n && typeof window.SaltI18n.t === 'function') {
      return window.SaltI18n.t(key, fallback);
    }
    return fallback || key;
  }

  async function onClassOpen() {
    setMount('lpCalendarMount');
    globalMode = false;
    readOnly = false;
    await loadSubjectGroups();
    await loadCalendar();
    renderSemesterPanels();
    if (deps.onClassOpenExtra) deps.onClassOpenExtra();
  }

  async function onGlobalOpen() {
    setMount('lpCalendarGlobal');
    globalMode = true;
    readOnly = false;
    await loadSubjectGroups();
    await loadCalendar();
    renderSemesterPanels();
  }

  async function onAdminOpen() {
    setMount('lpAdminCalendar');
    globalMode = false;
    readOnly = true;
    await loadAdminCalendar();
    await loadAdminSemesterPlans();
  }

  async function loadSubjectGroups() {
    if ((deps.role === 'admin' || deps.role === 'principal' || deps.role === 'staff')) return;
    try {
      subjectGroups = await api('/api/teacher/class-subjects');
      renderSubjectsPanels();
      renderSemesterPanels();
    } catch (e) {
      const el = $('lpSubjectsClass');
      if (el) el.innerHTML = '<p class="err small">' + escapeHtml(e.message) + '</p>';
    }
  }

  function styleForSubject(classId, subject) {
    const key = classId + '|' + subject;
    if (subjectGroups && subjectGroups.resolvedStyles && subjectGroups.resolvedStyles[key]) {
      return subjectGroups.resolvedStyles[key];
    }
    if (calendar && calendar.subjectStyles && calendar.subjectStyles[key]) {
      return calendar.subjectStyles[key];
    }
    if (window.SaltSubjectColors && typeof window.SaltSubjectColors.forSubject === 'function') {
      return window.SaltSubjectColors.forSubject(subject, { classId: classId || '' });
    }
    return { bg: '#eef3ea', border: '#a3b18a' };
  }

  function renderColorPicker(classId, subject) {
    const style = styleForSubject(classId, subject);
    const palette = (subjectGroups && subjectGroups.stylePalette) ||
      (calendar && calendar.subjectStylePalette) || [];
    const swatches = palette.map((p) =>
      '<button type="button" class="lp-color-opt' +
      (p.bg === style.bg && p.border === style.border ? ' is-active' : '') +
      '" data-class="' + escapeHtml(classId) + '" data-subject="' + escapeHtml(subject) +
      '" data-bg="' + escapeHtml(p.bg) + '" data-border="' + escapeHtml(p.border) +
      '" title="' + escapeHtml(p.label || 'Color') + '" style="--swatch-bg:' + p.bg +
      ';--swatch-border:' + p.border + '"></button>'
    ).join('');
    return '<span class="lp-color-picker" data-class="' + escapeHtml(classId) + '" data-subject="' +
      escapeHtml(subject) + '">' +
      '<button type="button" class="lp-color-swatch" style="background:' + escapeHtml(style.bg) +
      ';border-color:' + escapeHtml(style.border) + '" title="Change color"></button>' +
      '<span class="lp-color-menu hidden">' + swatches + '</span></span>';
  }

  function bindColorPickers(root) {
    if (!root) return;
    root.querySelectorAll('.lp-color-swatch').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const picker = btn.closest('.lp-color-picker');
        if (!picker) return;
        root.querySelectorAll('.lp-color-menu').forEach((m) => {
          if (m.closest('.lp-color-picker') !== picker) m.classList.add('hidden');
        });
        const menu = picker.querySelector('.lp-color-menu');
        if (menu) menu.classList.toggle('hidden');
      });
    });
    root.querySelectorAll('.lp-color-opt').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const picker = btn.closest('.lp-color-picker');
        const errEl = root.querySelector('.lp-subject-err');
        if (errEl) errEl.textContent = '';
        try {
          await api('/api/teacher/subject-styles', {
            method: 'PUT',
            body: {
              classId: btn.dataset.class,
              subject: btn.dataset.subject,
              bg: btn.dataset.bg,
              border: btn.dataset.border
            }
          });
          if (picker) {
            const swatch = picker.querySelector('.lp-color-swatch');
            if (swatch) {
              swatch.style.background = btn.dataset.bg;
              swatch.style.borderColor = btn.dataset.border;
            }
            picker.querySelectorAll('.lp-color-opt').forEach((opt) => {
              opt.classList.toggle('is-active', opt === btn);
            });
            picker.querySelector('.lp-color-menu').classList.add('hidden');
          }
          const styleKey = btn.dataset.class + '|' + btn.dataset.subject;
          openSubjectMenuKey = subjectMenuKey(btn.dataset.class, btn.dataset.subject);
          if (subjectGroups) {
            if (!subjectGroups.styles) subjectGroups.styles = {};
            if (!subjectGroups.resolvedStyles) subjectGroups.resolvedStyles = {};
            const saved = { bg: btn.dataset.bg, border: btn.dataset.border, subject: btn.dataset.subject };
            subjectGroups.styles[styleKey] = saved;
            subjectGroups.resolvedStyles[styleKey] = saved;
          }
          await loadCalendar();
          renderSubjectsPanels();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        }
      });
    });
  }

  document.addEventListener('click', () => {
    document.querySelectorAll('.lp-color-menu').forEach((m) => m.classList.add('hidden'));
  });

  function isCustomSubject(classId, subject) {
    if (!subjectGroups || !subjectGroups.custom) return false;
    return subjectGroups.custom.some((c) => c.classId === classId && c.subject === subject);
  }

  function subjectMetaFor(classId, subject) {
    if (!subjectGroups || !subjectGroups.classes) return null;
    const group = subjectGroups.classes.find((c) => c.classId === classId);
    if (!group || !group.subjectMeta) return null;
    return group.subjectMeta[subject] || null;
  }

  let openSubjectMenuKey = '';
  let semesterSaveTimer = null;
  let semesterSaveSeq = 0;

  function subjectMenuKey(classId, subject) {
    return String(classId) + '|' + String(subject);
  }

  function dayToggleHtml(classId, subject, meta) {
    const days = (meta && meta.teachingDays) || [1, 2, 3, 4, 5];
    const sync = !(meta && meta.syncFromTimetable === false);
    const labels = [
      [1, t('lessons.mon', 'Mon')],
      [2, t('lessons.tue', 'Tue')],
      [3, t('lessons.wed', 'Wed')],
      [4, t('lessons.thu', 'Thu')],
      [5, t('lessons.fri', 'Fri')]
    ];
    let html = '<div class="lp-day-row" data-class="' + escapeHtml(classId) + '" data-subject="' + escapeHtml(subject) + '">';
    html += '<span class="muted small lp-day-label">' + escapeHtml(t('lessons.teachingDays', 'Days')) + '</span>';
    labels.forEach(([num, label]) => {
      const on = days.indexOf(num) >= 0;
      html += '<button type="button" class="lp-day-btn' + (on ? ' is-on' : '') + '" data-day="' + num + '">' +
        escapeHtml(label) + '</button>';
    });
    html += '<button type="button" class="btn btn-ghost lp-day-sync' + (sync ? ' is-sync' : '') + '" title="' +
      escapeHtml(t('lessons.syncTt', 'From timetable')) + '">' +
      escapeHtml(t('lessons.syncTt', 'From timetable')) + '</button>';
    html += '</div>';
    return html;
  }

  function renderSubjectsPanels() {
    if (globalMode) {
      renderSubjectsPanel('lpSubjectsGlobal', null);
      const classPanel = $('lpSubjectsClass');
      if (classPanel) classPanel.innerHTML = '';
      return;
    }
    const cls = getClass();
    renderSubjectsPanel('lpSubjectsClass', cls ? cls.classId : null);
  }

  function renderSubjectsPanel(panelMountId, filterClassId) {
    const mount = $(panelMountId);
    if (!mount || !subjectGroups) return;

    const classes = (subjectGroups.classes || []).filter((c) =>
      !filterClassId || c.classId === filterClassId
    );
    const catalog = subjectGroups.catalog || [];

    let html = '<div class="lp-subjects-head"><strong>' + escapeHtml(t('lessons.mySubjects', 'My subjects')) + '</strong>' +
      '<span class="muted small"> · ' + escapeHtml(t('lessons.clickSubject', 'Click a subject to set days, color, or remove')) +
      '</span></div>';
    if (!classes.length) {
      html += '<p class="muted small">No classes assigned.</p>';
    } else {
      classes.forEach((c) => {
        html += '<div class="lp-subject-class">' +
          '<div class="lp-subject-class-name">' + escapeHtml(c.className) + '</div>' +
          '<div class="lp-subject-chips">';
        (c.subjects || []).forEach((s) => {
          const key = subjectMenuKey(c.classId, s);
          const open = openSubjectMenuKey === key;
          const style = styleForSubject(c.classId, s);
          html += '<button type="button" class="lp-subject-chip lp-subject-chip-btn' + (open ? ' is-open' : '') +
            '" data-menu-key="' + escapeHtml(key) +
            '" data-class="' + escapeHtml(c.classId) +
            '" data-subject="' + escapeHtml(s) +
            '" style="--chip-bg:' + escapeHtml(style.bg) + ';--chip-border:' + escapeHtml(style.border) + '">' +
            '<span class="lp-subject-dot" aria-hidden="true"></span>' +
            '<span class="lp-subject-name">' + escapeHtml(s) + '</span>' +
            '<span class="lp-subject-caret" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' +
            '</button>';
        });
        html += '</div>';

        (c.subjects || []).forEach((s) => {
          const key = subjectMenuKey(c.classId, s);
          if (openSubjectMenuKey !== key) return;
          const meta = (c.subjectMeta && c.subjectMeta[s]) || subjectMetaFor(c.classId, s) || {};
          html += '<div class="lp-subject-submenu" data-menu-key="' + escapeHtml(key) + '">' +
            '<div class="lp-subject-submenu-row">' +
            '<span class="muted small">' + escapeHtml(t('lessons.color', 'Color')) + '</span>' +
            renderColorPicker(c.classId, s) +
            '</div>' +
            dayToggleHtml(c.classId, s, meta) +
            '<div class="lp-subject-submenu-actions">' +
            '<button type="button" class="btn btn-ghost lp-subject-remove" data-class="' + escapeHtml(c.classId) +
            '" data-subject="' + escapeHtml(s) + '">' + escapeHtml(t('lessons.remove', 'Remove subject')) + '</button>' +
            '</div></div>';
        });
        html += '</div>';
      });
    }

    html += '<form class="lp-add-subject-form" data-mount="' + escapeHtml(panelMountId) + '">' +
      '<select class="lp-add-class">' +
      classes.map((c) => '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.className) + '</option>').join('') +
      '</select>' +
      '<input class="lp-add-name" list="' + escapeHtml(panelMountId) + '-catalog" placeholder="Add subject (e.g. Math)" required>' +
      '<button type="submit" class="btn btn-ghost">+ Add</button>' +
      '</form>' +
      '<datalist id="' + escapeHtml(panelMountId) + '-catalog">' +
      catalog.map((s) => '<option value="' + escapeHtml(s) + '">').join('') +
      '</datalist>' +
      '<div class="error lp-subject-err"></div>';

    mount.innerHTML = html;
    bindColorPickers(mount);
    bindDayToggles(mount);

    mount.querySelectorAll('.lp-subject-chip-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.menuKey || '';
        openSubjectMenuKey = openSubjectMenuKey === key ? '' : key;
        renderSubjectsPanels();
      });
    });

    mount.querySelectorAll('.lp-subject-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!window.confirm(t('lessons.removeConfirm', 'Remove this subject from your lesson list?'))) return;
        try {
          await api('/api/teacher/class-subjects', {
            method: 'DELETE',
            body: { classId: btn.dataset.class, subject: btn.dataset.subject }
          });
          openSubjectMenuKey = '';
          await loadSubjectGroups();
          await loadCalendar();
        } catch (err) {
          const errEl = mount.querySelector('.lp-subject-err');
          if (errEl) errEl.textContent = err.message;
        }
      });
    });

    mount.querySelectorAll('.lp-add-subject-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = form.parentElement.querySelector('.lp-subject-err');
        if (errEl) errEl.textContent = '';
        const classId = form.querySelector('.lp-add-class').value;
        const subject = form.querySelector('.lp-add-name').value.trim();
        try {
          await api('/api/teacher/class-subjects', {
            method: 'POST',
            body: { classId, subject }
          });
          form.querySelector('.lp-add-name').value = '';
          await loadSubjectGroups();
          await loadCalendar();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        }
      });
    });
  }

  function bindDayToggles(root) {
    if (!root) return;
    root.querySelectorAll('.lp-day-row').forEach((row) => {
      const classId = row.dataset.class;
      const subject = row.dataset.subject;
      const errEl = root.querySelector('.lp-subject-err');

      async function persist(body) {
        try {
          await api('/api/teacher/subject-prefs', {
            method: 'POST',
            body: Object.assign({ classId, subject }, body)
          });
          openSubjectMenuKey = subjectMenuKey(classId, subject);
          await loadSubjectGroups();
          await loadCalendar();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        }
      }

      row.querySelectorAll('.lp-day-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const days = [];
          row.querySelectorAll('.lp-day-btn').forEach((b) => {
            const day = Number(b.dataset.day);
            const on = b === btn ? !b.classList.contains('is-on') : b.classList.contains('is-on');
            b.classList.toggle('is-on', on);
            if (on) days.push(day);
          });
          persist({ teachingDays: days, syncFromTimetable: false });
        });
      });

      const syncBtn = row.querySelector('.lp-day-sync');
      if (syncBtn) {
        syncBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          persist({ syncFromTimetable: true });
        });
      }
    });
  }

  let semesterState = { classId: '', subject: '', termLabel: '', plan: null };

  function renderSemesterPanels() {
    if ((deps.role === 'admin' || deps.role === 'principal' || deps.role === 'staff')) return;
    if (globalMode) {
      renderSemesterPanel('lpSemesterGlobal', null);
      const classPanel = $('lpSemesterClass');
      if (classPanel) classPanel.innerHTML = '';
      return;
    }
    const cls = getClass();
    renderSemesterPanel('lpSemesterClass', cls ? cls.classId : null);
  }

  function renderSemesterPanel(panelId, filterClassId) {
    const mount = $(panelId);
    if (!mount || !subjectGroups) return;

    const options = [];
    (subjectGroups.classes || []).forEach((c) => {
      if (filterClassId && c.classId !== filterClassId) return;
      (c.subjects || []).forEach((s) => {
        options.push({
          classId: c.classId,
          className: c.className,
          subject: s,
          value: c.classId + '::' + s
        });
      });
    });

    let html = '<div class="lp-semester-head"><strong>' + escapeHtml(t('lessons.semester', 'Semester plans')) + '</strong>' +
      '<span class="muted small"> · ' + escapeHtml(t('lessons.semesterHelp',
        'Pick a class + subject to fill the weekly semester lesson plan.')) + '</span></div>';
    html += '<div class="lp-semester-picker">' +
      '<select id="' + escapeHtml(panelId) + '-select">' +
      '<option value="">' + escapeHtml(t('lessons.selectSubject', 'Select a subject')) + '</option>' +
      options.map((o) =>
        '<option value="' + escapeHtml(o.value) + '"' +
        (semesterState.classId === o.classId && semesterState.subject === o.subject ? ' selected' : '') +
        '>' + escapeHtml(o.className + ' · ' + o.subject) + '</option>'
      ).join('') +
      '</select>' +
      '<select id="' + escapeHtml(panelId) + '-term" class="lp-semester-term-select" disabled>' +
      '<option value="">' + escapeHtml(t('lessons.selectSemester', 'Semester')) + '</option>' +
      '</select></div>';
    html += '<div class="lp-semester-body" id="' + escapeHtml(panelId) + '-body">';
    if (!semesterState.classId) {
      html += '<p class="muted small">' + escapeHtml(t('lessons.selectSubject', 'Select a subject')) + '</p>';
    }
    html += '</div>';
    mount.innerHTML = html;

    const select = $(panelId + '-select');
    const termSelect = $(panelId + '-term');
    async function reloadPlan() {
      if (!semesterState.classId || !semesterState.subject) return;
      await loadSemesterPlanInto(panelId + '-body', semesterState.classId, semesterState.subject, semesterState.termLabel);
    }
    if (select) {
      select.addEventListener('change', async () => {
        const val = select.value;
        if (!val) {
          semesterState = { classId: '', subject: '', termLabel: '', plan: null };
          if (termSelect) {
            termSelect.innerHTML = '<option value="">' + escapeHtml(t('lessons.selectSemester', 'Semester')) + '</option>';
            termSelect.disabled = true;
          }
          const body = $(panelId + '-body');
          if (body) body.innerHTML = '<p class="muted small">' + escapeHtml(t('lessons.selectSubject', 'Select a subject')) + '</p>';
          return;
        }
        const parts = val.split('::');
        semesterState.classId = parts[0];
        semesterState.subject = parts.slice(1).join('::');
        semesterState.termLabel = '';
        await reloadPlan();
      });
    }
    if (termSelect) {
      termSelect.addEventListener('change', async () => {
        semesterState.termLabel = termSelect.value || '';
        await reloadPlan();
      });
    }

    if (semesterState.classId && semesterState.subject) {
      const stillThere = options.some((o) =>
        o.classId === semesterState.classId && o.subject === semesterState.subject
      );
      if (stillThere) {
        reloadPlan();
      }
    }
  }

  function formatRange(start, end) {
    if (!start) return '—';
    function short(ds) {
      const p = String(ds).slice(0, 10).split('-');
      if (p.length !== 3) return ds;
      return Number(p[1]) + '/' + Number(p[2]);
    }
    if (!end || end === start) return short(start);
    return short(start) + '–' + short(end);
  }

  function collectSemesterRows(body) {
    const rows = [];
    body.querySelectorAll('.lp-semester-row').forEach((tr) => {
      const contentEl = tr.querySelector('.lp-sem-content');
      const objectiveEl = tr.querySelector('.lp-sem-objective');
      if (!contentEl || !contentEl.dataset.week) return;
      rows.push({
        weekIndex: Number(contentEl.dataset.week),
        content: contentEl.value,
        objective: objectiveEl ? objectiveEl.value : ''
      });
    });
    return rows;
  }

  async function persistSemesterPlan(body, plan, opts) {
    opts = opts || {};
    const msg = body.querySelector('.lp-sem-msg');
    const seq = ++semesterSaveSeq;
    if (msg) {
      msg.style.color = '';
      msg.textContent = t('lessons.saving', 'Saving…');
    }
    try {
      const result = await api('/api/teacher/semester-plans', {
        method: 'POST',
        body: {
          classId: plan.classId,
          subject: plan.subject,
          termLabel: plan.term && plan.term.label,
          rows: collectSemesterRows(body)
        }
      });
      if (seq !== semesterSaveSeq) return;
      if (semesterState.plan &&
          semesterState.plan.classId === plan.classId &&
          semesterState.plan.subject === plan.subject) {
        const byWeek = {};
        (result.rows || []).forEach((r) => { byWeek[r.weekIndex] = r; });
        semesterState.plan.rows = (semesterState.plan.rows || []).map((row) => {
          if (row.weekIndex == null) return row;
          const saved = byWeek[row.weekIndex];
          if (!saved) return row;
          return Object.assign({}, row, {
            content: saved.content,
            objective: saved.objective,
            planId: saved.planId
          });
        });
      }
      if (msg) {
        msg.style.color = '#16a34a';
        msg.textContent = t('lessons.autosaved', 'Saved');
      }
    } catch (err) {
      if (seq !== semesterSaveSeq) return;
      if (msg) {
        msg.style.color = '#dc2626';
        msg.textContent = err.message || t('lessons.saveFailed', 'Could not save');
      }
      if (opts.rethrow) throw err;
    }
  }

  function scheduleSemesterSave(body, plan) {
    if (semesterSaveTimer) clearTimeout(semesterSaveTimer);
    const msg = body.querySelector('.lp-sem-msg');
    if (msg) {
      msg.style.color = '';
      msg.textContent = t('lessons.unsaved', 'Saving soon…');
    }
    semesterSaveTimer = setTimeout(() => {
      semesterSaveTimer = null;
      persistSemesterPlan(body, plan);
    }, 700);
  }

  async function flushSemesterSave() {
    if (semesterSaveTimer) {
      clearTimeout(semesterSaveTimer);
      semesterSaveTimer = null;
    }
    const plan = semesterState.plan;
    if (!plan) return;
    const body = document.querySelector('.lp-semester-body .lp-semester-table')
      ? document.querySelector('.lp-semester-body .lp-semester-table').closest('.lp-semester-body')
      : null;
    // Prefer visible editor body under semester panels
    const bodies = [
      $('lpSemesterClass-body'),
      $('lpSemesterGlobal-body')
    ].filter(Boolean);
    const active = bodies.find((el) => el.querySelector('.lp-sem-content')) || body;
    if (active && plan) await persistSemesterPlan(active, plan);
  }

  async function loadSemesterPlanInto(bodyId, classId, subject, termLabel) {
    if (semesterSaveTimer) {
      clearTimeout(semesterSaveTimer);
      semesterSaveTimer = null;
      if (semesterState.plan) {
        const prevBody = $(bodyId);
        if (prevBody && prevBody.querySelector('.lp-sem-content')) {
          try { await persistSemesterPlan(prevBody, semesterState.plan); } catch (e) { /* keep going */ }
        }
      }
    }
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '<p class="muted small">Loading…</p>';
    try {
      let q = '/api/teacher/semester-plans?classId=' + encodeURIComponent(classId) +
        '&subject=' + encodeURIComponent(subject);
      if (termLabel) q += '&termLabel=' + encodeURIComponent(termLabel);
      const data = await api(q);
      const plan = data.plan;
      semesterState.plan = plan;
      if (plan && plan.term && plan.term.label) {
        semesterState.termLabel = plan.term.label;
      }

      const panelId = bodyId.replace(/-body$/, '');
      const termSelect = $(panelId + '-term');
      if (termSelect) {
        const semesters = data.semesters || [];
        if (!semesters.length) {
          termSelect.innerHTML = '<option value="">' + escapeHtml(t('lessons.noSemesters', 'Set semesters in Admin → Calendar')) + '</option>';
          termSelect.disabled = true;
          body.innerHTML = '<p class="err small">' + escapeHtml(t('lessons.noSemesters', 'Set semesters in Admin → Calendar')) + '</p>';
          return;
        }
        termSelect.disabled = false;
        termSelect.innerHTML = semesters.map((s) =>
          '<option value="' + escapeHtml(s.label) + '"' +
          (plan.term && plan.term.label === s.label ? ' selected' : '') +
          '>' + escapeHtml(s.label) + ' (' + escapeHtml(s.startDate) + '–' + escapeHtml(s.endDate) + ')</option>'
        ).join('');
        semesterState.termLabel = termSelect.value;
      }

      renderSemesterEditor(body, plan);
    } catch (err) {
      body.innerHTML = '<p class="err small">' + escapeHtml(err.message) + '</p>';
    }
  }

  function renderSemesterEditor(body, plan) {
    const days = (plan.teachingDays || []).map((d) => {
      const map = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
      return map[d] || d;
    }).join(', ');
    let html = '<div class="lp-semester-meta">' +
      '<span><strong>' + escapeHtml(String(plan.totalWeeks || 0)) + '</strong> ' +
      escapeHtml(t('lessons.weeks', 'weeks')) + '</span>' +
      '<span><strong>' + escapeHtml(String(plan.periodsPerWeek || 0)) + '</strong> ' +
      escapeHtml(t('lessons.periodsPerWeek', 'periods / week')) + '</span>' +
      (days ? '<span class="muted small">' + escapeHtml(days) + '</span>' : '') +
      (plan.term && plan.term.label ? '<span class="muted small">' + escapeHtml(plan.term.label) + '</span>' : '') +
      '<span class="muted small lp-sem-msg"></span>' +
      '</div>';
    html += '<div class="lp-semester-table-wrap"><table class="lp-semester-table"><thead><tr>' +
      '<th class="lp-sem-week">' + escapeHtml(t('lessons.week', 'Week')) + '</th>' +
      '<th class="lp-sem-date">' + escapeHtml(t('lessons.date', 'Date')) + '</th>' +
      '<th class="lp-sem-content-col">' + escapeHtml(t('lessons.content', 'Lesson content')) + '</th>' +
      '<th class="lp-sem-objective-col">' + escapeHtml(t('lessons.objective', 'Objective')) + '</th>' +
      '</tr></thead><tbody>';
    (plan.rows || []).forEach((row, idx) => {
      const isBreak = row.weekIndex == null || row.isBreakWeek;
      const examClass = row.examLabel === 'Midterm' ? ' is-midterm' :
        (row.examLabel === 'Final' ? ' is-final' : '');
      html += '<tr class="lp-semester-row' + (isBreak ? ' is-break' : '') + examClass + '" data-idx="' + idx + '">' +
        '<td class="lp-sem-week">' + escapeHtml(row.weekLabel || '') + '</td>' +
        '<td class="lp-sem-date">' + escapeHtml(formatRange(row.weekStart, row.weekEnd)) + '</td>';
      if (isBreak && !row.examLabel) {
        html += '<td colspan="2" class="muted small">' + escapeHtml(t('lessons.break', 'Break')) + '</td>';
      } else {
        html += '<td class="lp-sem-content-col"><textarea class="lp-sem-content" data-week="' +
          escapeHtml(String(row.weekIndex || '')) + '" rows="1">' +
          escapeHtml(row.content || '') + '</textarea></td>' +
          '<td class="lp-sem-objective-col"><textarea class="lp-sem-objective" data-week="' +
          escapeHtml(String(row.weekIndex || '')) + '" rows="1">' +
          escapeHtml(row.objective || '') + '</textarea></td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    body.innerHTML = html;

    body.querySelectorAll('.lp-sem-content, .lp-sem-objective').forEach((el) => {
      autosizeSemesterField(el);
      el.addEventListener('input', () => {
        autosizeSemesterField(el);
        scheduleSemesterSave(body, plan);
      });
      el.addEventListener('blur', () => {
        if (semesterSaveTimer) {
          clearTimeout(semesterSaveTimer);
          semesterSaveTimer = null;
          persistSemesterPlan(body, plan);
        }
      });
    });
  }

  function autosizeSemesterField(el) {
    if (!el) return;
    el.style.height = '0px';
    const next = Math.max(el.scrollHeight, 32);
    el.style.height = next + 'px';
  }

  async function loadAdminSemesterPlans() {
    const listEl = $('lpAdminSemesterList');
    const detailEl = $('lpAdminSemesterDetail');
    if (!listEl) return;
    listEl.innerHTML = '<p class="muted small">Loading…</p>';
    if (detailEl) {
      detailEl.classList.add('hidden');
      detailEl.innerHTML = '';
    }
    const teacherId = ($('lpAdminTeacher') && $('lpAdminTeacher').value) || '';
    const classId = ($('lpAdminClass') && $('lpAdminClass').value) || '';
    try {
      const q = '?teacherId=' + encodeURIComponent(teacherId) +
        '&classId=' + encodeURIComponent(classId);
      const data = await api('/api/admin/semester-plans' + q, {}, (deps.role || 'admin'));
      const plans = data.plans || [];
      if (!plans.length) {
        listEl.innerHTML = '<p class="muted small">' + escapeHtml(t('lessons.noPlans', 'No semester plans saved yet.')) + '</p>';
        return;
      }
      const teacherName = (id) => {
        const opt = $('lpAdminTeacher') && Array.from($('lpAdminTeacher').options || [])
          .find((o) => o.value === id);
        return opt && opt.value ? opt.textContent : id;
      };
      const className = (id) => {
        const opt = $('lpAdminClass') && Array.from($('lpAdminClass').options || [])
          .find((o) => o.value === id);
        return opt && opt.value ? opt.textContent : id;
      };
      listEl.innerHTML = '<div class="lp-admin-sem-list">' + plans.map((p, i) =>
        '<button type="button" class="lp-admin-sem-item" data-idx="' + i + '">' +
        '<strong>' + escapeHtml(teacherName(p.teacherId)) + '</strong>' +
        '<span>' + escapeHtml(className(p.classId) + ' · ' + p.subject) + '</span>' +
        '<span class="muted small">' + escapeHtml((p.termLabel || '') +
          (p.periodsPerWeek ? ' · ' + p.periodsPerWeek + ' ' + t('lessons.periodsPerWeek', 'periods / week') : '')) +
        '</span></button>'
      ).join('') + '</div>';

      listEl.querySelectorAll('.lp-admin-sem-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = plans[Number(btn.dataset.idx)];
          if (!p || !detailEl) return;
          detailEl.classList.remove('hidden');
          let html = '<div class="lp-semester-meta">' +
            '<strong>' + escapeHtml(teacherName(p.teacherId) + ' · ' + className(p.classId) + ' · ' + p.subject) +
            '</strong>' +
            '<span class="muted small">' + escapeHtml(p.termLabel || '') + '</span></div>';
          html += '<div class="lp-semester-table-wrap"><table class="lp-semester-table"><thead><tr>' +
            '<th>' + escapeHtml(t('lessons.week', 'Week')) + '</th>' +
            '<th>' + escapeHtml(t('lessons.date', 'Date')) + '</th>' +
            '<th>' + escapeHtml(t('lessons.content', 'Lesson content')) + '</th>' +
            '<th>' + escapeHtml(t('lessons.objective', 'Objective')) + '</th>' +
            '</tr></thead><tbody>';
          (p.weeks || []).forEach((w) => {
            const examClass = /midterm/i.test(w.weekLabel || '') ? ' is-midterm' :
              (/final/i.test(w.weekLabel || '') ? ' is-final' : '');
            html += '<tr class="' + examClass + '">' +
              '<td>' + escapeHtml(w.weekLabel || ('Week ' + w.weekIndex)) + '</td>' +
              '<td>' + escapeHtml(formatRange(w.weekStart, w.weekEnd)) + '</td>' +
              '<td>' + (w.content ? escapeHtml(w.content).replace(/\n/g, '<br>') : '<span class="muted">—</span>') + '</td>' +
              '<td>' + (w.objective ? escapeHtml(w.objective).replace(/\n/g, '<br>') : '<span class="muted">—</span>') + '</td>' +
              '</tr>';
          });
          html += '</tbody></table></div>';
          detailEl.innerHTML = html;
        });
      });
    } catch (err) {
      listEl.innerHTML = '<p class="err small">' + escapeHtml(err.message) + '</p>';
    }
  }

  async function loadCalendar() {
    updateMonthLabel();
    const mount = $(mountId);
    if (!mount) return;
    mount.innerHTML = '<p class="muted">Loading calendar…</p>';

    const cls = getClass();
    const q = '?year=' + year + '&month=' + month +
      (!globalMode && cls ? '&classId=' + encodeURIComponent(cls.classId) : '');

    try {
      calendar = await api('/api/teacher/lesson-plans/calendar' + q);
      syncStylesFromCalendar();
      renderCalendar(mount);
    } catch (e) {
      mount.innerHTML = '<p class="err">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function loadAdminCalendar() {
    updateMonthLabel();
    const mount = $(mountId);
    if (!mount) return;
    mount.innerHTML = '<p class="muted">Loading…</p>';

    const teacherId = $('lpAdminTeacher') ? $('lpAdminTeacher').value : '';
    const classId = $('lpAdminClass') ? $('lpAdminClass').value : '';
    const q = '?year=' + year + '&month=' + month +
      (teacherId ? '&teacherId=' + encodeURIComponent(teacherId) : '') +
      (classId ? '&classId=' + encodeURIComponent(classId) : '');

    try {
      calendar = await api('/api/admin/lesson-plans/calendar' + q, {}, (deps.role || 'admin'));
      renderCalendar(mount, true);
    } catch (e) {
      mount.innerHTML = '<p class="err">' + escapeHtml(e.message) + '</p>';
    }
  }

  function formatShortDate(dateStr) {
    const p = dateStr.split('-');
    if (p.length !== 3) return dateStr;
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + p[0];
  }

  function renderCalendar(mount, isAdmin) {
    if (!calendar || !calendar.weeks) {
      mount.innerHTML = '<p class="muted">No calendar data.</p>';
      return;
    }
    if (typeof FullCalendar !== 'undefined') {
      renderFullCalendar(mount, isAdmin);
      return;
    }
    renderCalendarGrid(mount, isAdmin);
  }

  let fcInstance = null;

  function cellSchoolCaption(cell) {
    return cell.schoolCaption || cell.holiday || '';
  }

  function cellDayTypeClass(cell) {
    const t = cell.dayType || '';
    if (t === 'holiday' || t === 'kr_holiday') return 'lp-cal-day-holiday';
    if (t === 'break') return 'lp-cal-day-break';
    if (t === 'event') return 'lp-cal-day-event';
    if (t === 'school_day') return 'lp-cal-day-force';
    if (cell.inMonth && cell.isClassDay === false) return 'lp-cal-day-off-school';
    return '';
  }

  function mountSchoolBadge(container, cell) {
    const caption = cellSchoolCaption(cell);
    if (!caption || !container) return;
    const badge = document.createElement('div');
    badge.className = 'lp-cal-holiday lp-fc-holiday' +
      (cell.dayType ? ' lp-cal-badge-' + String(cell.dayType).replace(/_/g, '-') : '');
    badge.textContent = caption;
    container.appendChild(badge);
  }

  function slotsToEvents(isAdmin) {
    const events = [];
    calendar.weeks.forEach((week) => {
      week.forEach((cell) => {
        if (!cell.inMonth) return;
        (cell.slots || []).forEach((slot) => {
          const style = slot.style || {};
          const title = (slot.plan && slot.plan.title) ? slot.plan.title : 'Title';
          events.push({
            id: slot.classId + '|' + slot.subject + '|' + slot.lessonDate,
            title: slot.subject + ' · ' + title,
            start: slot.lessonDate,
            allDay: true,
            backgroundColor: style.bg || '#e8f4ea',
            borderColor: style.border || '#6b9b7a',
            textColor: '#1e293b',
            extendedProps: {
              slot: slot,
              isAdmin: !!isAdmin,
              holiday: cell.holiday || '',
              schoolCaption: cellSchoolCaption(cell),
              dayType: cell.dayType || '',
              isClassDay: cell.isClassDay !== false
            }
          });
        });
      });
    });
    return events;
  }

  function renderFullCalendar(mount, isAdmin) {
    if (fcInstance) {
      try { fcInstance.destroy(); } catch (e) { /* ignore */ }
      fcInstance = null;
    }
    mount.innerHTML = '<div class="lp-fc-mount"></div>';
    const el = mount.querySelector('.lp-fc-mount');
    const initialDate = year + '-' + String(month).padStart(2, '0') + '-01';
    fcInstance = new FullCalendar.Calendar(el, {
      initialView: 'dayGridMonth',
      initialDate: initialDate,
      headerToolbar: false,
      fixedWeekCount: false,
      showNonCurrentDates: true,
      hiddenDays: [0, 6],
      height: 'auto',
      events: slotsToEvents(isAdmin),
      eventClick: (info) => {
        info.jsEvent.preventDefault();
        const slot = info.event.extendedProps.slot;
        if (slot) handleSlotClick(slot, isAdmin, null);
      },
      dayCellDidMount: (arg) => {
        const dateStr = arg.date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
        for (const week of calendar.weeks) {
          for (const cell of week) {
            if (cell.dateStr !== dateStr) continue;
            const typeCls = cellDayTypeClass(cell);
            if (typeCls) arg.el.classList.add(typeCls);
            if (cell.inMonth && cell.isClassDay === false) {
              arg.el.classList.add('lp-fc-day-off');
            }
            const top = arg.el.querySelector('.fc-daygrid-day-top');
            mountSchoolBadge(top, cell);
          }
        }
      }
    });
    fcInstance.render();
  }

  function renderCalendarGrid(mount, isAdmin) {
    const grid = document.createElement('div');
    grid.className = 'lp-cal-grid';

    const headRow = document.createElement('div');
    headRow.className = 'lp-cal-head-row';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach((d) => {
      const h = document.createElement('div');
      h.className = 'lp-cal-head';
      h.textContent = d;
      headRow.appendChild(h);
    });
    grid.appendChild(headRow);

    calendar.weeks.forEach((week) => {
      const weekEl = document.createElement('div');
      weekEl.className = 'lp-cal-week';
      week.forEach((cell) => {
        const dayEl = document.createElement('div');
        const typeCls = cellDayTypeClass(cell);
        dayEl.className = 'lp-cal-day' +
          (!cell.inMonth ? ' lp-cal-day-off' : '') +
          (typeCls ? ' ' + typeCls : '');

        if (cell.inMonth) {
          const num = document.createElement('div');
          num.className = 'lp-cal-day-num';
          num.textContent = String(cell.dayNum);
          dayEl.appendChild(num);

          mountSchoolBadge(dayEl, cell);

          const slotsEl = document.createElement('div');
          slotsEl.className = 'lp-cal-slots';
          (cell.slots || []).forEach((slot) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'lp-slot-card' +
              (slot.plan && slot.plan.hasContent ? ' lp-slot-filled' : '') +
              (slot.isClassDay === false ? ' lp-slot-off-day' : '');
            card.dataset.classId = slot.classId;
            card.dataset.className = slot.className;
            card.dataset.subject = slot.subject;
            card.dataset.lessonDate = slot.lessonDate;
            if (slot.plan && slot.plan.planId) card.dataset.planId = slot.plan.planId;
            const style = slot.style || {};
            card.style.setProperty('--slot-bg', style.bg || '#f3f4f6');
            card.style.setProperty('--slot-border', style.border || '#9ca3af');
            const title = (slot.plan && slot.plan.title) ? slot.plan.title : 'Title';
            const meta = isAdmin
              ? (slot.teacherName || '') + ' · ' + slot.className
              : slot.className + ' · ' + slot.subject;
            card.innerHTML =
              '<span class="lp-slot-subject" style="background:' + escapeHtml(style.bg || '#f3f4f6') +
              ';border-color:' + escapeHtml(style.border || '#9ca3af') + '">' + escapeHtml(slot.subject) + '</span>' +
              '<span class="lp-slot-title">' + escapeHtml(title) + '</span>' +
              '<span class="lp-slot-meta">' + escapeHtml(meta) + '</span>' +
              (slot.plan && slot.plan.status === 'Submitted' ? '<span class="lp-slot-badge">✓</span>' : '');
            card.addEventListener('click', (e) => {
              e.preventDefault();
              handleSlotClick(slot, isAdmin, card);
            });
            slotsEl.appendChild(card);
          });
          dayEl.appendChild(slotsEl);
        }

        weekEl.appendChild(dayEl);
      });
      grid.appendChild(weekEl);
    });

    mount.innerHTML = '';
    mount.appendChild(grid);
  }

  async function handleSlotClick(slot, isAdmin, cardEl) {
    if (isAdmin || readOnly) {
      openAdminDrawer(slot);
      return;
    }
    if (cardEl) {
      if (activeCardEl) activeCardEl.classList.remove('lp-slot-active');
      activeCardEl = cardEl;
      cardEl.classList.add('lp-slot-active');
    }
    openDrawer(slot);
  }

  function subjectsForClass(classId) {
    if (subjectGroups && subjectGroups.classes) {
      const group = subjectGroups.classes.find((c) => c.classId === classId);
      if (group && group.subjects && group.subjects.length) return group.subjects;
    }
    const map = (calendar && calendar.subjectsByClass) || {};
    return map[classId] && map[classId].length ? map[classId] : ['English'];
  }

  function populateSubjectSelect(slot) {
    const select = $('lpSubjectSelect');
    const hint = $('lpSubjectHint');
    if (!select) return;
    const subjects = subjectsForClass(slot.classId);
    select.innerHTML = subjects.map((s) =>
      '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'
    ).join('');
    select.value = slot.subject;
    if (hint) {
      hint.textContent = subjects.length > 1
        ? t('lessons.pickSubject', 'Choose from this class’s subjects.')
        : t('lessons.addToGrow', 'Add subjects under My subjects to grow calendar cards.');
    }
    select.disabled = subjects.length <= 1;
  }

  function planForSlot(slot) {
    if (!calendar || !calendar.weeks) return null;
    for (const week of calendar.weeks) {
      for (const cell of week) {
        for (const s of (cell.slots || [])) {
          if (s.classId === slot.classId && s.subject === slot.subject && s.lessonDate === slot.lessonDate) {
            return s.plan;
          }
        }
      }
    }
    return slot.plan || null;
  }

  async function loadPlanIntoDrawer(slot) {
    const planMeta = planForSlot(slot);
    currentPlanId = planMeta ? planMeta.planId : null;
    if (currentPlanId) {
      try {
        const data = await api('/api/teacher/lesson-plans/' + encodeURIComponent(currentPlanId));
        fillDrawerForm(data.plan);
      } catch (e) {
        $('lpDrawerError').textContent = e.message;
      }
    } else {
      fillDrawerForm({ title: '', objectives: '', procedure: '', homework: '', etc: '' });
    }
  }

  function onSubjectChange() {
    if (!activeSlot) return;
    activeSlot = Object.assign({}, activeSlot, { subject: $('lpSubjectSelect').value });
    $('lpDrawerMeta').textContent = activeSlot.className + ' · ' + activeSlot.subject;
    $('lpDrawerError').textContent = '';
    loadPlanIntoDrawer(activeSlot);
  }

  function openDrawer(slot) {
    activeSlot = Object.assign({}, slot);
    const drawer = $('lpLessonDrawer');
    const backdrop = $('lpDrawerBackdrop');
    if (!drawer) return;

    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    if (backdrop) {
      backdrop.classList.remove('hidden');
      backdrop.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('lp-lesson-drawer-open');

    const dateEl = $('lpDrawerDate');
    const metaEl = $('lpDrawerMeta');
    const errEl = $('lpDrawerError');
    if (dateEl) dateEl.textContent = formatShortDate(slot.lessonDate);
    if (metaEl) metaEl.textContent = slot.className + ' · ' + slot.subject;
    if (errEl) errEl.textContent = '';

    populateSubjectSelect(slot);
    loadPlanIntoDrawer(activeSlot);
  }

  function closeDrawer() {
    const drawer = $('lpLessonDrawer');
    const backdrop = $('lpDrawerBackdrop');
    if (drawer) {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (backdrop) {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('lp-lesson-drawer-open');
    if (activeCardEl) {
      activeCardEl.classList.remove('lp-slot-active');
      activeCardEl = null;
    }
    activeSlot = null;
    currentPlanId = null;
  }

  function fillDrawerForm(plan) {
    const title = $('lpTitle');
    if (!title) return;
    title.value = plan.title || '';
    const obj = $('lpObjectives');
    const proc = $('lpProcedure');
    const hw = $('lpHomework');
    const etc = $('lpEtc');
    if (obj) obj.value = plan.objectives || '';
    if (proc) proc.value = plan.procedure || '';
    if (hw) hw.value = plan.homework || '';
    if (etc) etc.value = plan.etc || '';
    if (plan.planId) currentPlanId = plan.planId;
  }

  async function savePlan(submit) {
    if (!activeSlot) return;
    activeSlot.subject = $('lpSubjectSelect').value;
    $('lpDrawerError').textContent = '';
    try {
      const data = await api('/api/teacher/lesson-plans', {
        method: 'POST',
        body: {
          planId: currentPlanId,
          classId: activeSlot.classId,
          subject: activeSlot.subject,
          lessonDate: activeSlot.lessonDate,
          weekStart: activeSlot.lessonDate,
          title: $('lpTitle').value,
          objectives: $('lpObjectives').value,
          procedure: $('lpProcedure').value,
          homework: $('lpHomework').value,
          etc: $('lpEtc').value,
          submit: !!submit
        }
      });
      currentPlanId = data.plan.planId;
      $('lpDrawerError').style.color = '#16a34a';
      $('lpDrawerError').textContent = submit ? 'Submitted to admin.' : 'Draft saved.';
      await loadCalendar();
    } catch (e) {
      $('lpDrawerError').style.color = '#dc2626';
      $('lpDrawerError').textContent = e.message;
    }
  }

  async function openAdminDrawer(slot) {
    const drawer = $('lpAdminDrawer');
    const layout = $('lpAdminLayout');
    if (!drawer || !slot.plan || !slot.plan.planId) return;

    $('lpAdminDrawerDate').textContent = formatShortDate(slot.lessonDate);
    $('lpAdminDrawerMeta').textContent =
      (slot.teacherName || '') + ' · ' + slot.className + ' · ' + slot.subject;
    $('lpAdminDrawerBody').innerHTML = '<p class="muted">Loading…</p>';
    show(drawer);
    if (layout) layout.classList.add('lp-drawer-open');

    try {
      const data = await api('/api/admin/lesson-plans/' + encodeURIComponent(slot.plan.planId), {}, (deps.role || 'admin'));
      const p = data.plan;
      $('lpAdminDrawerBody').innerHTML =
        renderReadSection('Title', p.title) +
        renderReadSection('Objectives', p.objectives) +
        renderReadSection('Procedure', p.procedure) +
        renderReadSection('Homework', p.homework) +
        renderReadSection('ETC', p.etc) +
        '<p class="muted small">Status: ' + escapeHtml(p.status || 'Draft') + '</p>';
    } catch (e) {
      $('lpAdminDrawerBody').innerHTML = '<p class="err">' + escapeHtml(e.message) + '</p>';
    }
  }

  function closeAdminDrawer() {
    hide($('lpAdminDrawer'));
    const layout = $('lpAdminLayout');
    if (layout) layout.classList.remove('lp-drawer-open');
  }

  function renderReadSection(label, text) {
    return '<div class="lp-field-read"><div class="lp-field-label">' + escapeHtml(label) + '</div>' +
      '<div class="lp-field-value">' + (text ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="muted">—</span>') + '</div></div>';
  }

  return {
    init,
    onClassOpen,
    onGlobalOpen,
    onAdminOpen,
    loadCalendar,
    loadAdminCalendar,
    loadSubjectGroups,
    loadAdminSemesterPlans,
    closeDrawer,
    closeAdminDrawer,
    setMount,
    setReadOnly
  };
})();
