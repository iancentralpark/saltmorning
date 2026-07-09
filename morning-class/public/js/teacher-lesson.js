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
    document.addEventListener('click', (e) => {
      if (readOnly || (deps.role && deps.role === 'admin')) return;
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
    loadCalendar();
  }

  function goToday() {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
    loadCalendar();
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

  async function onClassOpen() {
    setMount('lpCalendarMount');
    readOnly = false;
    await loadSubjectGroups();
    await loadCalendar();
    if (deps.onClassOpenExtra) deps.onClassOpenExtra();
  }

  async function onAdminOpen() {
    setMount('lpAdminCalendar');
    readOnly = true;
    await loadAdminCalendar();
  }

  async function loadSubjectGroups() {
    if (deps.role === 'admin') return;
    try {
      subjectGroups = await api('/api/teacher/class-subjects');
      renderSubjectsPanels();
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
    return { bg: '#f3f4f6', border: '#6b7280' };
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

  function renderSubjectsPanels() {
    const cls = getClass();
    renderSubjectsPanel('lpSubjectsClass', cls ? cls.classId : null);
  }

  function renderSubjectsPanel(mountId, filterClassId) {
    const mount = $(mountId);
    if (!mount || !subjectGroups) return;

    const classes = (subjectGroups.classes || []).filter((c) =>
      !filterClassId || c.classId === filterClassId
    );
    const catalog = subjectGroups.catalog || [];

    let html = '<div class="lp-subjects-head"><strong>My subjects</strong>' +
      '<span class="muted small"> · 색 점을 눌러 과목별 색을 바꿀 수 있어요</span></div>';
    if (!classes.length) {
      html += '<p class="muted small">No classes assigned.</p>';
    } else {
      classes.forEach((c) => {
        html += '<div class="lp-subject-class"><div class="lp-subject-class-name">' + escapeHtml(c.className) + '</div><div class="lp-subject-chips">';
        (c.subjects || []).forEach((s) => {
          const custom = isCustomSubject(c.classId, s);
          html += '<span class="lp-subject-chip">' +
            renderColorPicker(c.classId, s) +
            '<span class="lp-subject-name">' + escapeHtml(s) + '</span>' +
            (custom ? '<button type="button" class="lp-subject-remove" data-class="' + escapeHtml(c.classId) + '" data-subject="' + escapeHtml(s) + '" title="Remove">×</button>' : '') +
            '</span>';
        });
        html += '</div></div>';
      });
    }

    html += '<form class="lp-add-subject-form" data-mount="' + escapeHtml(mountId) + '">' +
      '<select class="lp-add-class">' +
      classes.map((c) => '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.className) + '</option>').join('') +
      '</select>' +
      '<input class="lp-add-name" list="' + escapeHtml(mountId) + '-catalog" placeholder="Add subject (e.g. Math)" required>' +
      '<button type="submit" class="btn btn-ghost">+ Add</button>' +
      '</form>' +
      '<datalist id="' + escapeHtml(mountId) + '-catalog">' +
      catalog.map((s) => '<option value="' + escapeHtml(s) + '">').join('') +
      '</datalist>' +
      '<div class="error lp-subject-err"></div>';

    mount.innerHTML = html;
    bindColorPickers(mount);

    mount.querySelectorAll('.lp-subject-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/teacher/class-subjects', {
            method: 'DELETE',
            body: { classId: btn.dataset.class, subject: btn.dataset.subject }
          });
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

  async function loadCalendar() {
    updateMonthLabel();
    const mount = $(mountId);
    if (!mount) return;
    mount.innerHTML = '<p class="muted">Loading calendar…</p>';

    const cls = getClass();
    const q = '?year=' + year + '&month=' + month +
      (cls && mountId === 'lpCalendarMount' ? '&classId=' + encodeURIComponent(cls.classId) : '');

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
      calendar = await api('/api/admin/lesson-plans/calendar' + q, {}, 'admin');
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
            extendedProps: { slot: slot, isAdmin: !!isAdmin, holiday: cell.holiday || '' }
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
            if (cell.dateStr === dateStr && cell.holiday) {
              const top = arg.el.querySelector('.fc-daygrid-day-top');
              if (top) {
                const badge = document.createElement('div');
                badge.className = 'lp-cal-holiday lp-fc-holiday';
                badge.textContent = cell.holiday;
                top.appendChild(badge);
              }
            }
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
        dayEl.className = 'lp-cal-day' +
          (!cell.inMonth ? ' lp-cal-day-off' : '') +
          (cell.holiday ? ' lp-cal-day-holiday' : '');

        if (cell.inMonth) {
          const num = document.createElement('div');
          num.className = 'lp-cal-day-num';
          num.textContent = String(cell.dayNum);
          dayEl.appendChild(num);

          if (cell.holiday) {
            const hol = document.createElement('div');
            hol.className = 'lp-cal-holiday';
            hol.textContent = cell.holiday;
            dayEl.appendChild(hol);
          }

          const slotsEl = document.createElement('div');
          slotsEl.className = 'lp-cal-slots';
          (cell.slots || []).forEach((slot) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'lp-slot-card' + (slot.plan && slot.plan.hasContent ? ' lp-slot-filled' : '');
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
        ? '이 클래스의 과목 중 선택하세요.'
        : 'My subjects에서 과목을 추가하면 캘린더 카드가 늘어납니다.';
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
      const data = await api('/api/admin/lesson-plans/' + encodeURIComponent(slot.plan.planId), {}, 'admin');
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
    onAdminOpen,
    loadCalendar,
    loadAdminCalendar,
    loadSubjectGroups,
    closeDrawer,
    closeAdminDrawer,
    setMount,
    setReadOnly
  };
})();
