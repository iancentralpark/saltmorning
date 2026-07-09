(function (global) {
  const DAY_OPTIONS = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' }
  ];

  let api = null;
  let escapeHtml = null;
  let mountEl = null;
  let onClassesChanged = null;

  let classes = [];
  let activeClassId = null;
  let activeClass = null;
  let availableStudents = [];
  let importQuery = '';

  function renderList() {
    const list = mountEl.querySelector('.cr-class-list');
    if (!list) return;

    if (!classes.length) {
      list.innerHTML = '<p class="muted">No classes yet. Create one below.</p>';
      return;
    }

    list.innerHTML = classes.map((c) => {
      const active = c.classId === activeClassId ? ' active' : '';
      return (
        '<button type="button" class="cr-class-item' + active + '" data-id="' + escapeHtml(c.classId) + '">' +
        '<strong>' + escapeHtml(c.name) + '</strong>' +
        '<span class="muted small">' + escapeHtml(c.classId) + ' · ' + c.studentCount + ' students</span>' +
        '</button>'
      );
    }).join('');

    list.querySelectorAll('.cr-class-item').forEach((btn) => {
      btn.addEventListener('click', () => openClass(btn.dataset.id));
    });
  }

  function allowedDaysChecked(days) {
    const set = new Set((days || []).map(Number));
    return DAY_OPTIONS.map((d) =>
      '<label class="cr-day-chip"><input type="checkbox" value="' + d.value + '"' +
      (set.has(d.value) ? ' checked' : '') + '> ' + d.label + '</label>'
    ).join('');
  }

  function collectAllowedDays() {
    const boxes = mountEl.querySelectorAll('.cr-form-days input[type="checkbox"]:checked');
    const days = Array.from(boxes).map((b) => Number(b.value));
    return days.length ? days : [1, 2, 3, 4, 5];
  }

  function renderDetail() {
    const detail = mountEl.querySelector('.cr-detail');
    if (!detail) return;

    const formClass = activeClass || { classId: '', name: '', scheduleType: 'Mon-Fri', allowedDays: [1, 2, 3, 4, 5] };
    const roster = (activeClass && activeClass.students) || [];
    const isNew = !formClass.classId;

    let rosterHtml = '';
    if (!isNew) {
      if (!roster.length) {
        rosterHtml = '<p class="muted">No students in this class yet. Import from the registry below.</p>';
      } else {
        rosterHtml = '<div class="cr-roster">' + roster.map((s) =>
          '<div class="cr-roster-row">' +
          '<span>' + escapeHtml(s.name) + ' <span class="muted small">(' + escapeHtml(s.studentId) + ')</span></span>' +
          '<button type="button" class="btn btn-ghost cr-remove-btn" data-student="' + escapeHtml(s.studentId) + '">Remove</button>' +
          '</div>'
        ).join('') + '</div>';
      }
    }

    let importHtml = '';
    if (!isNew) {
      importHtml =
        '<div class="cr-import-panel">' +
        '<h4>Import from student registry</h4>' +
        '<p class="muted small">Only students not assigned to another class appear here.</p>' +
        '<input type="search" class="cr-import-search" placeholder="Search registry…" value="' + escapeHtml(importQuery) + '">' +
        '<div class="cr-import-list">' +
        (availableStudents.length
          ? availableStudents.map((s) =>
            '<div class="cr-import-row">' +
            '<div><strong>' + escapeHtml(s.name) + '</strong><div class="muted small">' + escapeHtml(s.studentId) + '</div></div>' +
            '<button type="button" class="btn btn-primary cr-import-btn" data-student="' + escapeHtml(s.studentId) + '">Add</button>' +
            '</div>'
          ).join('')
          : '<p class="muted">No available students in the registry.</p>') +
        '</div></div>';
    }

    detail.innerHTML =
      '<div class="cr-detail-grid">' +
      '<div class="cr-form-card">' +
      '<h4>' + (isNew ? 'New class' : 'Edit class') + '</h4>' +
      '<form class="cr-class-form">' +
      '<input type="hidden" class="cr-input-id" value="' + escapeHtml(formClass.classId || '') + '">' +
      '<label>Class name <input class="cr-input-name" value="' + escapeHtml(formClass.name || '') + '" required></label>' +
      '<label>Class ID <input class="cr-input-code" value="' + escapeHtml(formClass.classId || '') + '" readonly placeholder="Auto-generated on save"></label>' +
      '<label>Schedule type <input class="cr-input-schedule" value="' + escapeHtml(formClass.scheduleType || 'Mon-Fri') + '"></label>' +
      '<div class="cr-form-days"><span class="cr-field-label">Class days</span>' +
      allowedDaysChecked(formClass.allowedDays) + '</div>' +
      '<button type="submit" class="btn btn-primary">Save class</button>' +
      '<div class="cr-form-error error"></div>' +
      '</form>' +
      '</div>' +
      '<div class="cr-roster-card' + (isNew ? ' muted-box' : '') + '">' +
      '<h4>Class roster</h4>' +
      (isNew ? '<p class="muted">Save the class first, then import students from the registry.</p>' : rosterHtml + importHtml) +
      '</div>' +
      '</div>';

    const form = detail.querySelector('.cr-class-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = detail.querySelector('.cr-form-error');
        errEl.textContent = '';
        try {
          const data = await api('/api/admin/classes', {
            method: 'POST',
            body: {
              classId: detail.querySelector('.cr-input-id').value.trim() || undefined,
              name: detail.querySelector('.cr-input-name').value.trim(),
              scheduleType: detail.querySelector('.cr-input-schedule').value.trim(),
              allowedDays: collectAllowedDays()
            }
          }, 'admin');
          activeClass = data.class;
          activeClassId = activeClass.classId;
          errEl.style.color = '#16a34a';
          errEl.textContent = 'Class saved.';
          await refreshAll();
          renderDetail();
        } catch (err) {
          errEl.style.color = '#dc2626';
          errEl.textContent = err.message;
        }
      });
    }

    detail.querySelectorAll('.cr-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => removeStudent(btn.dataset.student));
    });

    detail.querySelectorAll('.cr-import-btn').forEach((btn) => {
      btn.addEventListener('click', () => importStudent(btn.dataset.student));
    });

    const search = detail.querySelector('.cr-import-search');
    if (search) {
      search.addEventListener('input', (e) => {
        importQuery = e.target.value.trim();
        loadAvailable().then(() => renderDetail());
      });
    }
  }

  async function loadClasses() {
    const data = await api('/api/admin/classes?detailed=1', {}, 'admin');
    classes = data.classes || [];
    renderList();
  }

  async function loadAvailable() {
    if (!activeClassId) {
      availableStudents = [];
      return;
    }
    const q = importQuery ? '?q=' + encodeURIComponent(importQuery) : '';
    const data = await api('/api/admin/classes/' + encodeURIComponent(activeClassId) + '/available-students' + q, {}, 'admin');
    availableStudents = data.students || [];
  }

  async function openClass(classId) {
    activeClassId = classId;
    importQuery = '';
    const data = await api('/api/admin/classes/' + encodeURIComponent(classId), {}, 'admin');
    activeClass = data.class;
    await loadAvailable();
    renderList();
    renderDetail();
  }

  function newClass() {
    activeClassId = null;
    activeClass = null;
    availableStudents = [];
    importQuery = '';
    renderList();
    renderDetail();
  }

  async function importStudent(studentId) {
    if (!activeClassId) return;
    try {
      const data = await api('/api/admin/classes/' + encodeURIComponent(activeClassId) + '/import-student', {
        method: 'POST',
        body: { studentId }
      }, 'admin');
      activeClass = data.class;
      await refreshAll();
      renderDetail();
    } catch (e) {
      alert(e.message);
    }
  }

  async function removeStudent(studentId) {
    if (!activeClassId) return;
    if (!confirm('Remove this student from the class? They will return to the registry (unassigned).')) return;
    try {
      const data = await api('/api/admin/classes/' + encodeURIComponent(activeClassId) + '/remove-student', {
        method: 'POST',
        body: { studentId }
      }, 'admin');
      activeClass = data.class;
      await refreshAll();
      renderDetail();
    } catch (e) {
      alert(e.message);
    }
  }

  async function refreshAll() {
    await loadClasses();
    if (onClassesChanged) onClassesChanged(classes);
    if (activeClassId) await loadAvailable();
  }

  function renderShell() {
    if (!mountEl) return;
    mountEl.innerHTML =
      '<div class="cr-layout">' +
      '<aside class="cr-sidebar">' +
      '<div class="cr-toolbar">' +
      '<button type="button" class="btn btn-primary cr-new-btn">+ New class</button>' +
      '</div>' +
      '<div class="cr-class-list"><p class="muted">Loading…</p></div>' +
      '</aside>' +
      '<section class="cr-detail"><p class="muted">Select a class or create a new one.</p></section>' +
      '</div>';

    mountEl.querySelector('.cr-new-btn').addEventListener('click', newClass);
  }

  function init(opts) {
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    mountEl = typeof opts.mount === 'string' ? document.getElementById(opts.mount) : opts.mount;
    onClassesChanged = opts.onClassesChanged || null;
    classes = [];
    activeClassId = null;
    activeClass = null;
    renderShell();
  }

  async function open() {
    await refreshAll();
    if (!activeClassId) renderDetail();
  }

  global.SaltClassRegistry = { init, open, refresh: refreshAll };
})(window);
