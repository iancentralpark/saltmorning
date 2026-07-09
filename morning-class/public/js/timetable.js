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
      return '/api/admin/timetable/' + ownerType + 's/' + encodeURIComponent(ownerId);
    }
    if (ownerType === 'teacher') return '/api/teacher/timetable';
    return '/api/teacher/timetable/students/' + encodeURIComponent(ownerId);
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
    const actions = canEdit
      ? '<div class="tt-slot-actions">' +
        '<button type="button" class="btn btn-ghost tt-edit-slot" data-id="' + escapeHtml(slot.entryId) + '">Edit</button>' +
        '<button type="button" class="btn btn-ghost tt-del-slot" data-id="' + escapeHtml(slot.entryId) + '">Delete</button>' +
        '</div>'
      : '';
    return (
      '<div class="tt-slot" data-id="' + escapeHtml(slot.entryId) + '">' +
      '<div class="tt-slot-time">' + time + '</div>' +
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

  function renderEditor(mountEl, options) {
    if (!mountEl) return;
    const opts = options || {};
    const ownerType = opts.ownerType;
    const ownerId = opts.ownerId;
    const ownerName = opts.ownerName || '';
    const readonly = Boolean(opts.readonly || role !== 'admin');
    const classId = opts.classId || '';
    let entries = (opts.timetable && opts.timetable.entries) ? opts.timetable.entries.slice() : [];
    let byDay = opts.timetable && opts.timetable.byDay ? opts.timetable.byDay : {};
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
          '<label>Start <input type="time" class="tt-f-start" required value="' + escapeHtml((editSlot && editSlot.startTime) || '09:00') + '"></label>' +
          '<label>End <input type="time" class="tt-f-end" required value="' + escapeHtml((editSlot && editSlot.endTime) || '09:50') + '"></label>' +
          '<label>Subject <input class="tt-f-subject" list="ttSubjectList" required value="' + escapeHtml((editSlot && editSlot.subject) || '') + '"></label>' +
          '<label>Class <input class="tt-f-class" placeholder="Optional class ID" value="' + escapeHtml((editSlot && editSlot.classId) || classId) + '"></label>' +
          '<label>Room <input class="tt-f-room" value="' + escapeHtml((editSlot && editSlot.room) || '') + '"></label>' +
          '<label class="tt-span2">Notes <input class="tt-f-notes" value="' + escapeHtml((editSlot && editSlot.notes) || '') + '"></label>' +
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
        if (!slots.length) {
          listHtml += '<p class="muted small">No slots</p>';
        } else {
          listHtml += slots.map((s) => slotCard(s, !readonly)).join('');
        }
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
      entries = data.timetable.entries.slice();
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
            const slot = {
              entryId: editingId || '',
              dayOfWeek: Number(form.querySelector('.tt-f-day').value),
              startTime: form.querySelector('.tt-f-start').value,
              endTime: form.querySelector('.tt-f-end').value,
              subject: form.querySelector('.tt-f-subject').value.trim(),
              classId: form.querySelector('.tt-f-class').value.trim(),
              room: form.querySelector('.tt-f-room').value.trim(),
              notes: form.querySelector('.tt-f-notes').value.trim()
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
        btn.addEventListener('click', () => {
          editingId = btn.dataset.id;
          render();
        });
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
        entries = data.timetable.entries.slice();
        byDay = data.timetable.byDay;
        render();
      }
    };
  }

  function renderAdminPanel(mountEl, options) {
    const students = (options && options.students) || [];
    const teachers = (options && options.teachers) || [];
    let mode = 'student';
    let selectedId = '';
    let editorHandle = null;

    function personOptions() {
      if (mode === 'student') {
        return students.map((s) =>
          '<option value="' + escapeHtml(s.studentId) + '"' + (s.studentId === selectedId ? ' selected' : '') + '>' +
          escapeHtml(s.name) + ' (' + escapeHtml(s.studentId) + ')' +
          (s.className && s.className !== '—' ? ' · ' + escapeHtml(s.className) : '') +
          '</option>'
        ).join('');
      }
      return teachers.map((t) =>
        '<option value="' + escapeHtml(t.teacherId) + '"' + (t.teacherId === selectedId ? ' selected' : '') + '>' +
        escapeHtml(t.name) + ' (' + escapeHtml(t.teacherId) + ')</option>'
      ).join('');
    }

    async function loadSelected() {
      const editorMount = mountEl.querySelector('.tt-editor-mount');
      if (!editorMount || !selectedId) {
        if (editorMount) editorMount.innerHTML = '<p class="muted">Select a person to edit their timetable.</p>';
        return;
      }
      editorMount.innerHTML = '<p class="muted">Loading…</p>';
      const ownerType = mode === 'student' ? 'student' : 'teacher';
      const data = await api(apiPath(ownerType, selectedId), {}, role);
      let ownerName = '';
      let classId = '';
      if (mode === 'student') {
        const s = students.find((x) => x.studentId === selectedId);
        ownerName = s ? s.name : selectedId;
        classId = s ? s.classId : '';
      } else {
        const t = teachers.find((x) => x.teacherId === selectedId);
        ownerName = t ? t.name : selectedId;
      }
      editorHandle = renderEditor(editorMount, {
        ownerType,
        ownerId: selectedId,
        ownerName,
        classId,
        timetable: data.timetable,
        readonly: false
      });
    }

    function renderShell() {
      mountEl.innerHTML =
        '<div class="tt-admin">' +
        '<div class="tt-admin-toolbar">' +
        '<div class="tt-mode-tabs">' +
        '<button type="button" class="tt-mode-btn' + (mode === 'student' ? ' active' : '') + '" data-mode="student">Student timetables</button>' +
        '<button type="button" class="tt-mode-btn' + (mode === 'teacher' ? ' active' : '') + '" data-mode="teacher">Teacher timetables</button>' +
        '</div>' +
        '<select class="tt-person-select">' + personOptions() + '</select>' +
        '</div>' +
        '<div class="tt-editor-mount"><p class="muted">Select a person to edit their timetable.</p></div>' +
        '</div>';

      mountEl.querySelectorAll('.tt-mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          mode = btn.dataset.mode;
          selectedId = '';
          renderShell();
          const sel = mountEl.querySelector('.tt-person-select');
          if (sel && sel.options.length) {
            selectedId = sel.value;
            loadSelected();
          }
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
      if (selectedId) loadSelected();
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
    renderReadOnly,
    openAdmin,
    renderWeekGrid
  };
})(window);
