(function (global) {
  const DAYS = [
    { value: 1, label: 'Mon', full: 'Monday' },
    { value: 2, label: 'Tue', full: 'Tuesday' },
    { value: 3, label: 'Wed', full: 'Wednesday' },
    { value: 4, label: 'Thu', full: 'Thursday' },
    { value: 5, label: 'Fri', full: 'Friday' }
  ];

  let api = null;
  let escapeHtml = null;
  let role = 'admin';
  let subjects = [];

  function apiPath(ownerType, ownerId) {
    if (role === 'admin') {
      const segment = ownerType === 'class'
        ? 'classes'
        : (ownerType === 'student'
          ? 'students'
          : (ownerType === 'teacher' ? 'teachers' : (String(ownerType || '') + 's')));
      return '/api/admin/timetable/' + segment + '/' + encodeURIComponent(ownerId);
    }
    if (ownerType === 'teacher') return '/api/teacher/timetable';
    return '/api/teacher/timetable/students/' + encodeURIComponent(ownerId);
  }

  function slotKey(dayOfWeek, periodId) {
    return String(dayOfWeek) + '|' + String(periodId);
  }

  function teacherDisplay(slot, teachers) {
    if (slot.teacherName) return slot.teacherName;
    if (!slot.teacherId || !teachers) return '';
    const t = teachers.find((x) => x.teacherId === slot.teacherId);
    return t ? t.name : slot.teacherId;
  }

  function slotCard(slot, canEdit) {
    if (slot.isBreak) {
      return (
        '<div class="tt-slot tt-slot-break">' +
        '<div class="tt-slot-time">' + escapeHtml(slot.startTime) + '–' + escapeHtml(slot.endTime) + '</div>' +
        '<div class="tt-slot-subject"><em>' + escapeHtml(slot.subject) + '</em></div>' +
        '</div>'
      );
    }
    const time = escapeHtml(slot.startTime) + '–' + escapeHtml(slot.endTime);
    const subj = escapeHtml(slot.subject || '—');
    const room = slot.room ? ' · ' + escapeHtml(slot.room) : '';
    const notes = slot.notes ? '<div class="tt-slot-notes">' + escapeHtml(slot.notes) + '</div>' : '';
    const lock = slot.locked ? ' <span class="tt-lock-badge" title="Locked">🔒</span>' : '';
    const actions = canEdit
      ? '<div class="tt-slot-actions">' +
        '<button type="button" class="btn btn-ghost tt-edit-slot" data-id="' + escapeHtml(slot.entryId) + '">Edit</button>' +
        '<button type="button" class="btn btn-ghost tt-del-slot" data-id="' + escapeHtml(slot.entryId) + '">Delete</button>' +
        '</div>'
      : '';
    return (
      '<div class="tt-slot' + (slot.locked ? ' tt-slot-locked' : '') + '" data-id="' + escapeHtml(slot.entryId) + '">' +
      '<div class="tt-slot-time">' + time + lock + '</div>' +
      '<div class="tt-slot-subject"><strong>' + subj + '</strong>' + room + '</div>' +
      notes + actions +
      '</div>'
    );
  }

  function renderWeekGrid(byDay) {
    let html = '<div class="tt-week-grid">';
    DAYS.forEach((d) => {
      const slots = (byDay && byDay[d.value]) || [];
      html += '<div class="tt-day-col"><div class="tt-day-head">' + d.label + '</div><div class="tt-day-body">';
      if (!slots.length) {
        html += '<div class="tt-day-empty muted small">—</div>';
      } else {
        slots.forEach((s) => { html += slotCard(s, false); });
      }
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  /* ─── Class LMS board (palette + period grid) ─── */

  function buildPalette(requirements, entries, teachers) {
    const scheduled = {};
    (entries || []).filter((e) => !e.isBreak).forEach((e) => {
      const key = String(e.subject || '').toLowerCase() + '|' + String(e.teacherId || '');
      scheduled[key] = (scheduled[key] || 0) + 1;
    });

    return (requirements || []).map((r) => {
      const key = String(r.subject || '').toLowerCase() + '|' + String(r.teacherId || '');
      const done = scheduled[key] || 0;
      const need = Number(r.periodsPerWeek) || 0;
      const remaining = Math.max(0, need - done);
      const t = (teachers || []).find((x) => x.teacherId === r.teacherId);
      const teacherName = r.teacherName || (t && t.name) || r.teacherId || '';
      return {
        subject: r.subject,
        teacherId: r.teacherId,
        teacherName,
        room: r.room || '',
        need,
        done,
        remaining,
        key
      };
    });
  }

  function renderClassBoard(mountEl, options) {
    if (!mountEl) return null;
    const opts = options || {};
    const classId = opts.classId;
    const className = opts.className || classId;
    const teachers = opts.teachers || [];
    const readonly = Boolean(opts.readonly);
    let requirements = opts.requirements || [];
    let lessonPeriods = (opts.timetable && opts.timetable.lessonPeriods) || [];
    let bellSchedule = (opts.timetable && opts.timetable.bellSchedule) || [];
    let entries = ((opts.timetable && opts.timetable.entries) || []).filter((e) => !e.isBreak);
    let busyMap = {};
    let dragPayload = null;
    let dirty = false;
    let statusMsg = '';
    let statusOk = true;

    function entryAt(day, periodId) {
      return entries.find((e) =>
        Number(e.dayOfWeek) === Number(day) && String(e.periodId || '') === String(periodId)
      ) || entries.find((e) =>
        Number(e.dayOfWeek) === Number(day) &&
        lessonPeriods.some((p, i) => p.periodId === periodId && Number(e.sortOrder) === i && !e.periodId)
      );
    }

    function setStatus(msg, ok) {
      statusMsg = msg || '';
      statusOk = ok !== false;
      const el = mountEl.querySelector('.tt-board-status');
      if (el) {
        el.style.color = statusOk ? '#16a34a' : '#dc2626';
        el.textContent = statusMsg;
      }
    }

    function paintHeatmap(on) {
      mountEl.querySelectorAll('.tt-grid-cell[data-droppable="1"]').forEach((cell) => {
        cell.classList.remove('tt-cell-valid', 'tt-cell-invalid');
        if (!on || !dragPayload) return;
        const day = Number(cell.dataset.day);
        const periodId = cell.dataset.periodId;
        const key = slotKey(day, periodId);
        const teacherBusy = busyMap[dragPayload.teacherId] && busyMap[dragPayload.teacherId][key];
        if (teacherBusy) cell.classList.add('tt-cell-invalid');
        else cell.classList.add('tt-cell-valid');
      });
    }

    async function loadBusy() {
      try {
        const data = await api(
          '/api/admin/timetable/teacher-busy?excludeClassId=' + encodeURIComponent(classId),
          {},
          'admin'
        );
        busyMap = data.busy || {};
      } catch (e) {
        busyMap = {};
      }
    }

    function render() {
      const palette = buildPalette(requirements, entries, teachers);
      const periods = lessonPeriods.length
        ? lessonPeriods
        : (bellSchedule || []).filter((p) => p.periodType === 'lesson');

      let paletteHtml = '<div class="tt-palette">';
      paletteHtml += '<div class="tt-palette-head">Unassigned</div>';
      paletteHtml += '<p class="muted small tt-palette-hint">Drag chips onto empty periods. Locked cells (🔒) are kept by Auto-Solve.</p>';
      if (!palette.length) {
        paletteHtml += '<p class="muted small">No requirements — add them above.</p>';
      } else {
        palette.forEach((chip) => {
          const doneClass = chip.remaining <= 0 ? ' tt-chip-done' : '';
          const draggable = !readonly && chip.remaining > 0;
          paletteHtml +=
            '<div class="tt-chip' + doneClass + '"' +
            (draggable ? ' draggable="true"' : '') +
            ' data-subject="' + escapeHtml(chip.subject) + '"' +
            ' data-teacher-id="' + escapeHtml(chip.teacherId) + '"' +
            ' data-teacher-name="' + escapeHtml(chip.teacherName) + '"' +
            ' data-room="' + escapeHtml(chip.room) + '">' +
            '<strong>' + escapeHtml(chip.subject) + '</strong>' +
            '<span class="tt-chip-meta">' + escapeHtml(chip.teacherName || '—') +
            ' · ' + chip.done + '/' + chip.need + ' hrs</span>' +
            (chip.remaining > 0
              ? '<span class="tt-chip-remain">' + chip.remaining + ' left</span>'
              : '<span class="tt-chip-remain tt-chip-complete">complete</span>') +
            '</div>';
        });
      }
      paletteHtml += '</div>';

      let gridHtml = '<div class="tt-period-grid-wrap"><table class="tt-period-grid"><thead><tr><th class="tt-period-label">Period</th>';
      DAYS.forEach((d) => { gridHtml += '<th>' + d.label + '</th>'; });
      gridHtml += '</tr></thead><tbody>';

      if (!periods.length) {
        gridHtml += '<tr><td colspan="6" class="muted">Set a bell schedule with lesson periods first.</td></tr>';
      } else {
        periods.forEach((period) => {
          gridHtml +=
            '<tr><th class="tt-period-label">' +
            '<div>' + escapeHtml(period.label || period.periodId) + '</div>' +
            '<div class="muted small">' + escapeHtml(period.startTime) + '–' + escapeHtml(period.endTime) + '</div>' +
            '</th>';
          DAYS.forEach((d) => {
            const slot = entryAt(d.value, period.periodId);
            const key = slotKey(d.value, period.periodId);
            if (slot) {
              gridHtml +=
                '<td class="tt-grid-cell tt-cell-filled' + (slot.locked ? ' tt-cell-locked' : '') + '"' +
                ' data-day="' + d.value + '" data-period-id="' + escapeHtml(period.periodId) + '"' +
                ' data-key="' + escapeHtml(key) + '">' +
                '<button type="button" class="tt-lock-btn" title="' +
                (slot.locked ? 'Unlock slot' : 'Lock slot (preserved by Auto-Solve)') +
                '" data-id="' + escapeHtml(slot.entryId) + '"' +
                (readonly ? ' disabled' : '') + '>' +
                (slot.locked ? '🔒' : '🔓') + '</button>' +
                '<div class="tt-cell-subject">' + escapeHtml(slot.subject) + '</div>' +
                '<div class="tt-cell-teacher">' + escapeHtml(teacherDisplay(slot, teachers)) + '</div>' +
                (!readonly && !slot.locked
                  ? '<button type="button" class="tt-cell-clear" data-id="' + escapeHtml(slot.entryId) + '" title="Clear">✕</button>'
                  : '') +
                '</td>';
            } else {
              gridHtml +=
                '<td class="tt-grid-cell tt-cell-empty" data-droppable="1"' +
                ' data-day="' + d.value + '" data-period-id="' + escapeHtml(period.periodId) + '"' +
                ' data-start="' + escapeHtml(period.startTime) + '"' +
                ' data-end="' + escapeHtml(period.endTime) + '"' +
                ' data-sort="' + periods.indexOf(period) + '"' +
                ' data-key="' + escapeHtml(key) + '">' +
                '<span class="tt-cell-placeholder">Drop</span></td>';
            }
          });
          gridHtml += '</tr>';
        });
      }
      gridHtml += '</tbody></table></div>';

      mountEl.innerHTML =
        '<div class="tt-lms-board">' +
        '<div class="tt-board-toolbar">' +
        '<div><strong>' + escapeHtml(className) + '</strong>' +
        '<span class="muted small"> — class timetable board</span></div>' +
        '<div class="tt-board-actions">' +
        (!readonly
          ? '<button type="button" class="btn btn-primary tt-board-save">Save & sync</button>' +
            '<button type="button" class="btn btn-ghost tt-board-generate">Auto-Solve</button>' +
            '<button type="button" class="btn btn-ghost tt-board-clear">Clear all</button>'
          : '') +
        '<button type="button" class="btn btn-ghost tt-board-reload">Reload</button>' +
        '</div></div>' +
        '<div class="tt-board-layout">' + paletteHtml + gridHtml + '</div>' +
        '<div class="tt-board-status' + (dirty ? ' tt-dirty' : '') + '" style="color:' +
        (statusOk ? '#16a34a' : '#dc2626') + '">' +
        escapeHtml(statusMsg || (dirty ? 'Unsaved changes' : '')) + '</div>' +
        '</div>';

      bind();
    }

    function bind() {
      mountEl.querySelectorAll('.tt-chip[draggable="true"]').forEach((chip) => {
        chip.addEventListener('dragstart', (ev) => {
          dragPayload = {
            subject: chip.dataset.subject,
            teacherId: chip.dataset.teacherId,
            teacherName: chip.dataset.teacherName,
            room: chip.dataset.room || ''
          };
          chip.classList.add('tt-chip-dragging');
          ev.dataTransfer.setData('text/plain', JSON.stringify(dragPayload));
          ev.dataTransfer.effectAllowed = 'copy';
          paintHeatmap(true);
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('tt-chip-dragging');
          dragPayload = null;
          paintHeatmap(false);
        });
      });

      mountEl.querySelectorAll('.tt-grid-cell[data-droppable="1"]').forEach((cell) => {
        cell.addEventListener('dragover', (ev) => {
          ev.preventDefault();
          const key = cell.dataset.key;
          const invalid = dragPayload && busyMap[dragPayload.teacherId] && busyMap[dragPayload.teacherId][key];
          ev.dataTransfer.dropEffect = invalid ? 'none' : 'copy';
        });
        cell.addEventListener('drop', (ev) => {
          ev.preventDefault();
          let payload = dragPayload;
          try {
            payload = JSON.parse(ev.dataTransfer.getData('text/plain') || 'null') || dragPayload;
          } catch (e) { /* keep */ }
          if (!payload || !payload.subject) return;
          const key = cell.dataset.key;
          if (busyMap[payload.teacherId] && busyMap[payload.teacherId][key]) {
            setStatus('Teacher is busy in another class at that period.', false);
            return;
          }
          if (entryAt(cell.dataset.day, cell.dataset.periodId)) {
            setStatus('That period is already filled.', false);
            return;
          }
          entries.push({
            entryId: 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            dayOfWeek: Number(cell.dataset.day),
            periodId: cell.dataset.periodId,
            startTime: cell.dataset.start,
            endTime: cell.dataset.end,
            sortOrder: Number(cell.dataset.sort) || 0,
            subject: payload.subject,
            teacherId: payload.teacherId,
            teacherName: payload.teacherName,
            room: payload.room || '',
            locked: false,
            notes: '',
            classId
          });
          dirty = true;
          dragPayload = null;
          setStatus('Slot added — save to sync students & teachers.', true);
          render();
        });
      });

      mountEl.querySelectorAll('.tt-lock-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          entries = entries.map((e) =>
            e.entryId === id ? Object.assign({}, e, { locked: !e.locked }) : e
          );
          dirty = true;
          setStatus('Lock updated — save to keep for Auto-Solve.', true);
          render();
        });
      });

      mountEl.querySelectorAll('.tt-cell-clear').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const hit = entries.find((e) => e.entryId === id);
          if (hit && hit.locked) {
            setStatus('Unlock the slot before clearing.', false);
            return;
          }
          entries = entries.filter((e) => e.entryId !== id);
          dirty = true;
          setStatus('Slot cleared.', true);
          render();
        });
      });

      const saveBtn = mountEl.querySelector('.tt-board-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          setStatus('Saving…', true);
          try {
            const data = await api(apiPath('class', classId), {
              method: 'POST',
              body: { entries }
            }, 'admin');
            entries = (data.timetable.entries || []).filter((e) => !e.isBreak);
            lessonPeriods = data.timetable.lessonPeriods || lessonPeriods;
            bellSchedule = data.timetable.bellSchedule || bellSchedule;
            dirty = false;
            await loadBusy();
            setStatus(
              'Saved. Synced ' + (data.studentsUpdated || 0) + ' students, ' +
              (data.teachersUpdated || 0) + ' teachers.',
              true
            );
            render();
            if (typeof opts.onSaved === 'function') opts.onSaved(data);
          } catch (e) {
            setStatus(e.message, false);
          }
        });
      }

      const clearBtn = mountEl.querySelector('.tt-board-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          const filled = entries.filter((e) => !e.isBreak);
          if (!filled.length) {
            setStatus('Board is already empty.', true);
            return;
          }
          if (!confirm('Clear all slots on this class board?')) return;

          const lockedCount = filled.filter((e) => e.locked).length;
          let next = [];
          if (lockedCount > 0) {
            const clearLocked = confirm(
              lockedCount + ' locked slot(s) found.\n\n' +
              'OK = clear everything (including locked)\n' +
              'Cancel = keep locked slots, clear the rest'
            );
            next = clearLocked ? [] : filled.filter((e) => e.locked);
          }

          const removed = filled.length - next.length;
          entries = next;
          dirty = true;
          setStatus(
            removed
              ? ('Cleared ' + removed + ' slot(s). Save & sync to apply.')
              : 'Nothing cleared.',
            true
          );
          render();
        });
      }

      const genBtn = mountEl.querySelector('.tt-board-generate');
      if (genBtn) {
        genBtn.addEventListener('click', async () => {
          if (dirty && !confirm('You have unsaved changes. Auto-Solve uses saved locked slots. Continue without saving?')) {
            return;
          }
          setStatus('Running Auto-Solve (OR-Tools)…', true);
          try {
            const data = await api('/api/admin/timetable/generate', {
              method: 'POST',
              body: { classId }
            }, 'admin');
            entries = (data.timetable.entries || []).filter((e) => !e.isBreak);
            lessonPeriods = data.timetable.lessonPeriods || lessonPeriods;
            dirty = false;
            await loadBusy();
            const r = data.result || {};
            setStatus(
              (r.message || 'Generated.') +
              ' Locked kept: ' + (r.lockedKept != null ? r.lockedKept : '—') +
              ', new: ' + (r.generated != null ? r.generated : r.assignmentCount) + '.',
              true
            );
            render();
            if (typeof opts.onGenerated === 'function') opts.onGenerated(data);
          } catch (e) {
            setStatus(e.message, false);
          }
        });
      }

      const reloadBtn = mountEl.querySelector('.tt-board-reload');
      if (reloadBtn) {
        reloadBtn.addEventListener('click', () => reload().catch((e) => setStatus(e.message, false)));
      }
    }

    async function reload() {
      const [tt, reqData] = await Promise.all([
        api(apiPath('class', classId), {}, 'admin'),
        api('/api/admin/timetable/requirements?classId=' + encodeURIComponent(classId), {}, 'admin')
      ]);
      entries = (tt.timetable.entries || []).filter((e) => !e.isBreak);
      lessonPeriods = tt.timetable.lessonPeriods || [];
      bellSchedule = tt.timetable.bellSchedule || [];
      requirements = reqData.requirements || requirements;
      dirty = false;
      await loadBusy();
      setStatus('Reloaded.', true);
      render();
    }

    loadBusy().then(render);

    return {
      reload,
      setRequirements: (reqs) => { requirements = reqs || []; render(); },
      getEntries: () => entries.slice()
    };
  }

  /* ─── All-classes matrix ─── */

  async function renderMatrix(mountEl, classes) {
    mountEl.innerHTML = '<p class="muted">Loading matrix…</p>';
    try {
      const data = await api('/api/admin/timetable/matrix', {}, 'admin');
      const periods = data.lessonPeriods || [];
      const byClass = data.byClass || {};
      const classList = (classes || []).filter((c) => byClass[c.classId]);
      const extraIds = Object.keys(byClass).filter((id) => !classList.some((c) => c.classId === id));
      extraIds.forEach((id) => classList.push({ classId: id, name: id }));

      if (!periods.length) {
        mountEl.innerHTML = '<p class="muted">No lesson periods in bell schedule.</p>';
        return;
      }

      function findSlot(classId, day, periodId, idx) {
        const list = byClass[classId] || [];
        return list.find((e) =>
          Number(e.dayOfWeek) === day &&
          (String(e.periodId) === String(periodId) || (!e.periodId && Number(e.sortOrder) === idx))
        );
      }

      let html = '<div class="tt-matrix-wrap"><table class="tt-matrix-table"><thead><tr><th>Class</th><th>Period</th>';
      DAYS.forEach((d) => { html += '<th>' + d.label + '</th>'; });
      html += '</tr></thead><tbody>';

      classList.forEach((cls) => {
        periods.forEach((period, idx) => {
          html += '<tr>';
          if (idx === 0) {
            html += '<th class="tt-matrix-class" rowspan="' + periods.length + '">' +
              escapeHtml(cls.name || cls.classId) + '</th>';
          }
          html += '<th class="tt-period-label">' + escapeHtml(period.label || period.periodId) + '</th>';
          DAYS.forEach((d) => {
            const slot = findSlot(cls.classId, d.value, period.periodId, idx);
            if (slot) {
              html += '<td class="tt-matrix-cell' + (slot.locked ? ' tt-cell-locked' : '') + '">' +
                '<div class="tt-cell-subject">' + escapeHtml(slot.subject) + (slot.locked ? ' 🔒' : '') + '</div>' +
                '<div class="tt-cell-teacher">' + escapeHtml(slot.teacherName || '') + '</div></td>';
            } else {
              html += '<td class="tt-matrix-cell tt-matrix-empty">·</td>';
            }
          });
          html += '</tr>';
        });
      });

      html += '</tbody></table></div>';
      if (!classList.length) {
        html = '<p class="muted">No class timetables yet. Generate or edit a class board first.</p>';
      }
      mountEl.innerHTML = html;
    } catch (e) {
      mountEl.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  /* ─── Legacy form editor (student / teacher fallback) ─── */

  function renderEditor(mountEl, options) {
    if (!mountEl) return;
    const opts = options || {};
    const ownerType = opts.ownerType;
    const ownerId = opts.ownerId;
    const ownerName = opts.ownerName || '';
    const readonly = Boolean(opts.readonly || role !== 'admin');
    const classId = opts.classId || '';
    const lessonPeriods = (opts.timetable && opts.timetable.lessonPeriods) || [];
    let entries = (opts.timetable && opts.timetable.entries) ? opts.timetable.entries.filter((e) => !e.isBreak) : [];
    let byDay = {};
    let editingId = null;

    function rebuildByDay() {
      byDay = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      entries.forEach((e) => {
        if (byDay[e.dayOfWeek]) byDay[e.dayOfWeek].push(e);
      });
      Object.keys(byDay).forEach((k) => {
        byDay[k].sort((a, b) => a.startTime.localeCompare(b.startTime));
      });
    }

    function render() {
      const subjectOpts = subjects.map((s) => '<option value="' + escapeHtml(s) + '">').join('');
      const periodOpts = lessonPeriods.map((p) =>
        '<option value="' + escapeHtml(p.periodId) + '">' +
        escapeHtml(p.label) + ' (' + escapeHtml(p.startTime) + '–' + escapeHtml(p.endTime) + ')</option>'
      ).join('');
      let formHtml = '';
      if (!readonly) {
        const editSlot = editingId ? entries.find((e) => e.entryId === editingId) : null;
        formHtml =
          '<form class="tt-slot-form">' +
          '<h4>' + (editSlot ? 'Edit slot' : 'Add slot') + '</h4>' +
          '<div class="tt-form-grid">' +
          '<label>Day <select class="tt-f-day" required>' +
          DAYS.map((d) => '<option value="' + d.value + '"' + ((editSlot && editSlot.dayOfWeek === d.value) ? ' selected' : '') + '>' + d.full + '</option>').join('') +
          '</select></label>' +
          (lessonPeriods.length
            ? '<label>Period <select class="tt-f-period" required>' +
              lessonPeriods.map((p) =>
                '<option value="' + escapeHtml(p.periodId) + '"' +
                ((editSlot && editSlot.periodId === p.periodId) ? ' selected' : '') + '>' +
                escapeHtml(p.label) + ' (' + escapeHtml(p.startTime) + '–' + escapeHtml(p.endTime) + ')</option>'
              ).join('') + '</select></label>'
            : '<label>Start <input type="time" class="tt-f-start" required value="' + escapeHtml((editSlot && editSlot.startTime) || '09:00') + '"></label>' +
              '<label>End <input type="time" class="tt-f-end" required value="' + escapeHtml((editSlot && editSlot.endTime) || '09:50') + '"></label>') +
          '<label>Subject <input class="tt-f-subject" list="ttSubjectList" required value="' + escapeHtml((editSlot && editSlot.subject) || '') + '"></label>' +
          '<label>Class <input class="tt-f-class" placeholder="Optional class ID" value="' + escapeHtml((editSlot && editSlot.classId) || classId) + '"></label>' +
          '<label>Room <input class="tt-f-room" value="' + escapeHtml((editSlot && editSlot.room) || '') + '"></label>' +
          '<label class="tt-span2">Notes <input class="tt-f-notes" value="' + escapeHtml((editSlot && editSlot.notes) || '') + '"></label>' +
          '<label><input type="checkbox" class="tt-f-locked"' + ((editSlot && editSlot.locked) ? ' checked' : '') + '> Lock slot</label>' +
          '</div>' +
          '<datalist id="ttSubjectList">' + subjectOpts + '</datalist>' +
          '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">' +
          '<button type="submit" class="btn btn-primary">' + (editSlot ? 'Update slot' : 'Add slot') + '</button>' +
          (editSlot ? '<button type="button" class="btn btn-ghost tt-cancel-edit">Cancel</button>' : '') +
          '<button type="button" class="btn btn-primary tt-save-all">Save timetable</button>' +
          '</div>' +
          '<div class="tt-form-error error"></div>' +
          '</form>';
      }

      let listHtml = '<div class="tt-day-lists">';
      DAYS.forEach((d) => {
        const slots = byDay[d.value] || [];
        listHtml += '<div class="tt-day-section"><h4>' + d.full + '</h4>';
        if (!slots.length) listHtml += '<p class="muted small">No slots</p>';
        else listHtml += slots.map((s) => slotCard(s, !readonly)).join('');
        listHtml += '</div>';
      });
      listHtml += '</div>';

      mountEl.innerHTML =
        '<div class="tt-editor">' +
        (ownerName ? '<p class="muted small">Timetable for <strong>' + escapeHtml(ownerName) + '</strong></p>' : '') +
        renderWeekGrid(byDay) +
        formHtml +
        listHtml +
        '<div class="tt-save-status error"></div>' +
        '</div>';

      bindEvents();
    }

    async function persist() {
      const status = mountEl.querySelector('.tt-save-status');
      if (status) status.textContent = '';
      const data = await api(apiPath(ownerType, ownerId), {
        method: 'POST',
        body: { entries }
      }, role);
      entries = (data.timetable.entries || []).filter((e) => !e.isBreak);
      rebuildByDay();
      if (status) {
        status.style.color = '#16a34a';
        status.textContent = 'Timetable saved.';
      }
      render();
    }

    function bindEvents() {
      const form = mountEl.querySelector('.tt-slot-form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const err = mountEl.querySelector('.tt-form-error');
          err.textContent = '';
          try {
            const periodSel = form.querySelector('.tt-f-period');
            let startTime = '';
            let endTime = '';
            let periodId = '';
            let sortOrder = 0;
            if (periodSel) {
              periodId = periodSel.value;
              const p = lessonPeriods.find((x) => x.periodId === periodId);
              if (!p) throw new Error('Select a bell schedule period.');
              startTime = p.startTime;
              endTime = p.endTime;
              sortOrder = lessonPeriods.indexOf(p);
            } else {
              startTime = form.querySelector('.tt-f-start').value;
              endTime = form.querySelector('.tt-f-end').value;
            }
            const slot = {
              entryId: editingId || '',
              dayOfWeek: Number(form.querySelector('.tt-f-day').value),
              startTime,
              endTime,
              periodId,
              sortOrder,
              subject: form.querySelector('.tt-f-subject').value.trim(),
              classId: form.querySelector('.tt-f-class').value.trim(),
              room: form.querySelector('.tt-f-room').value.trim(),
              notes: form.querySelector('.tt-f-notes').value.trim(),
              locked: !!(form.querySelector('.tt-f-locked') && form.querySelector('.tt-f-locked').checked)
            };
            if (!slot.subject) throw new Error('Subject is required.');
            if (editingId) {
              entries = entries.map((x) => x.entryId === editingId ? Object.assign({}, x, slot, { entryId: editingId }) : x);
            } else {
              entries.push(Object.assign({}, slot, { entryId: 'tmp_' + Date.now() }));
            }
            editingId = null;
            rebuildByDay();
            render();
          } catch (ex) {
            err.textContent = ex.message;
          }
        });

        const cancel = mountEl.querySelector('.tt-cancel-edit');
        if (cancel) cancel.addEventListener('click', () => { editingId = null; render(); });

        const saveAll = mountEl.querySelector('.tt-save-all');
        if (saveAll) {
          saveAll.addEventListener('click', () => persist().catch((ex) => {
            const status = mountEl.querySelector('.tt-save-status');
            if (status) { status.style.color = '#dc2626'; status.textContent = ex.message; }
          }));
        }
      }

      mountEl.querySelectorAll('.tt-edit-slot').forEach((btn) => {
        btn.addEventListener('click', () => { editingId = btn.dataset.id; render(); });
      });

      mountEl.querySelectorAll('.tt-del-slot').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!confirm('Remove this slot?')) return;
          entries = entries.filter((x) => x.entryId !== btn.dataset.id);
          if (editingId === btn.dataset.id) editingId = null;
          rebuildByDay();
          render();
        });
      });
    }

    rebuildByDay();
    render();

    return {
      reload: async () => {
        const data = await api(apiPath(ownerType, ownerId), {}, role);
        entries = (data.timetable.entries || []).filter((e) => !e.isBreak);
        rebuildByDay();
        render();
      }
    };
  }

  /* ─── Admin panel with view toggles ─── */

  function renderAdminPanel(mountEl, options) {
    const students = (options && options.students) || [];
    const teachers = (options && options.teachers) || [];
    const classes = (options && options.classes) || [];
    let view = 'class'; // class | teacher | matrix | student
    let selectedId = classes[0] ? classes[0].classId : '';
    let boardHandle = null;

    function entityOptions() {
      if (view === 'class') {
        return classes.map((c) =>
          '<option value="' + escapeHtml(c.classId) + '"' + (c.classId === selectedId ? ' selected' : '') + '>' +
          escapeHtml(c.name) + '</option>'
        ).join('');
      }
      if (view === 'teacher') {
        return teachers.map((t) =>
          '<option value="' + escapeHtml(t.teacherId) + '"' + (t.teacherId === selectedId ? ' selected' : '') + '>' +
          escapeHtml(t.name) + '</option>'
        ).join('');
      }
      if (view === 'student') {
        return students.map((s) =>
          '<option value="' + escapeHtml(s.studentId) + '"' + (s.studentId === selectedId ? ' selected' : '') + '>' +
          escapeHtml(s.name) +
          (s.className && s.className !== '—' ? ' · ' + escapeHtml(s.className) : '') +
          '</option>'
        ).join('');
      }
      return '';
    }

    async function loadSelected() {
      const editorMount = mountEl.querySelector('.tt-editor-mount');
      if (!editorMount) return;

      if (view === 'matrix') {
        await renderMatrix(editorMount, classes);
        return;
      }

      if (!selectedId) {
        editorMount.innerHTML = '<p class="muted">Select an item to view.</p>';
        return;
      }

      editorMount.innerHTML = '<p class="muted">Loading…</p>';

      if (view === 'class') {
        const cls = classes.find((c) => c.classId === selectedId);
        const [tt, reqData] = await Promise.all([
          api(apiPath('class', selectedId), {}, 'admin'),
          api('/api/admin/timetable/requirements?classId=' + encodeURIComponent(selectedId), {}, 'admin')
        ]);
        boardHandle = renderClassBoard(editorMount, {
          classId: selectedId,
          className: cls ? cls.name : selectedId,
          teachers,
          requirements: reqData.requirements || [],
          timetable: tt.timetable
        });
        return;
      }

      if (view === 'teacher') {
        const t = teachers.find((x) => x.teacherId === selectedId);
        const data = await api(apiPath('teacher', selectedId), {}, 'admin');
        boardHandle = renderEditor(editorMount, {
          ownerType: 'teacher',
          ownerId: selectedId,
          ownerName: t ? t.name : selectedId,
          timetable: data.timetable,
          readonly: false
        });
        return;
      }

      const s = students.find((x) => x.studentId === selectedId);
      const data = await api(apiPath('student', selectedId), {}, 'admin');
      boardHandle = renderEditor(editorMount, {
        ownerType: 'student',
        ownerId: selectedId,
        ownerName: s ? s.name : selectedId,
        classId: s ? s.classId : '',
        timetable: data.timetable,
        readonly: false
      });
    }

    function renderShell() {
      const showSelect = view !== 'matrix';
      mountEl.innerHTML =
        '<div class="tt-admin">' +
        '<div class="tt-admin-toolbar">' +
        '<div class="tt-mode-tabs">' +
        '<button type="button" class="tt-mode-btn' + (view === 'class' ? ' active' : '') + '" data-view="class">View by Class</button>' +
        '<button type="button" class="tt-mode-btn' + (view === 'teacher' ? ' active' : '') + '" data-view="teacher">View by Teacher</button>' +
        '<button type="button" class="tt-mode-btn' + (view === 'matrix' ? ' active' : '') + '" data-view="matrix">All-Classes Matrix</button>' +
        '<button type="button" class="tt-mode-btn' + (view === 'student' ? ' active' : '') + '" data-view="student">Student</button>' +
        '</div>' +
        (showSelect ? '<select class="tt-person-select">' + entityOptions() + '</select>' : '') +
        '</div>' +
        '<div class="tt-editor-mount"><p class="muted">Loading…</p></div>' +
        '</div>';

      mountEl.querySelectorAll('.tt-mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          view = btn.dataset.view;
          if (view === 'class') selectedId = classes[0] ? classes[0].classId : '';
          else if (view === 'teacher') selectedId = teachers[0] ? teachers[0].teacherId : '';
          else if (view === 'student') selectedId = students[0] ? students[0].studentId : '';
          else selectedId = '';
          renderShell();
        });
      });

      const sel = mountEl.querySelector('.tt-person-select');
      if (sel) {
        if (!selectedId && sel.options.length) selectedId = sel.value;
        sel.addEventListener('change', () => {
          selectedId = sel.value;
          loadSelected();
        });
      }
      loadSelected();
    }

    renderShell();
  }

  async function renderReadOnly(mountEl, ownerType, ownerId, ownerName) {
    if (!mountEl || !ownerId) return;
    mountEl.innerHTML = '<p class="muted">Loading timetable…</p>';
    try {
      const data = await api(apiPath(ownerType, ownerId), {}, role);
      mountEl.innerHTML =
        '<div class="tt-readonly">' +
        (ownerName ? '<p class="muted small"><strong>' + escapeHtml(ownerName) + '</strong> — weekly schedule</p>' : '') +
        renderWeekGrid(data.timetable.byDay) +
        '</div>';
    } catch (e) {
      mountEl.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function loadSubjects() {
    try {
      const data = await api('/api/admin/timetable/subjects', {}, role === 'admin' ? 'admin' : role);
      subjects = data.subjects || [];
    } catch (e) {
      subjects = ['English', 'Math', 'Science', 'Reading', 'Writing', 'Grammar'];
    }
  }

  function init(opts) {
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    role = opts.role || 'admin';
  }

  async function openAdmin(mountEl, options) {
    await loadSubjects();
    renderAdminPanel(mountEl, options);
  }

  global.SaltTimetable = {
    init,
    renderEditor,
    renderClassBoard,
    renderReadOnly,
    openAdmin,
    renderWeekGrid,
    buildPalette
  };
})(window);
