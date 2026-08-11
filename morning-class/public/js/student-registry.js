(function (global) {
  const SECTION_LABELS = {
    basic: 'Basic info',
    parents: 'Parents',
    gradebook: 'Gradebook',
    schedule: 'Schedule & attendance',
    medical: 'Medical'
  };

  let role = 'admin';
  let readonly = false;
  let api = null;
  let escapeHtml = null;
  let $ = null;
  let mountEl = null;
  let classes = [];

  let students = [];
  let activeId = null;
  let activeStudent = null;
  let activeSection = 'basic';
  let linkedParents = [];
  let listFilter = { q: '', classId: '', status: '' };

  function apiBase() {
    return role === 'admin' ? '/api/admin/students' : '/api/teacher/students';
  }

  function photoUrl(path) {
    if (!path) return '';
    return path + (path.includes('?') ? '&' : '?') + 'v=' + Date.now();
  }

  function avatarHtml(student, cls) {
    const name = student && student.name ? student.name : '?';
    const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    if (student && student.photoPath) {
      return '<img class="' + cls + '" src="' + escapeHtml(photoUrl(student.photoPath)) + '" alt="">';
    }
    return '<span class="' + cls + ' sr-avatar-fallback">' + escapeHtml(initials) + '</span>';
  }

  function fieldRowHtml(field, index, canEdit) {
    const label = escapeHtml(field.label || '');
    const value = escapeHtml(field.value || '');
    if (!canEdit) {
      return (
        '<div class="sr-field-read">' +
        '<div class="sr-field-label">' + label + '</div>' +
        '<div class="sr-field-value">' + (value || '<span class="muted">—</span>') + '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="sr-field-edit" data-field-index="' + index + '">' +
      '<input type="text" class="sr-field-label-input" value="' + label + '" placeholder="Label">' +
      '<textarea class="sr-field-value-input" rows="2" placeholder="Value">' + value + '</textarea>' +
      '<button type="button" class="btn btn-ghost sr-field-remove" title="Remove">✕</button>' +
      '</div>'
    );
  }

  function renderSectionFields(section) {
    const fields = (activeStudent && activeStudent.fields && activeStudent.fields[section]) || [];
    const canEdit = !readonly;
    let html = '<div class="sr-fields" data-section="' + section + '">';
    fields.forEach((f, i) => { html += fieldRowHtml(f, i, canEdit); });
    html += '</div>';
    if (canEdit) {
      html += '<button type="button" class="btn btn-ghost sr-add-field" data-section="' + section + '">+ Add field</button>';
    }
    return html;
  }

  function collectFields(section) {
    const wrap = mountEl.querySelector('.sr-fields[data-section="' + section + '"]');
    if (!wrap) return [];
    const out = [];
    wrap.querySelectorAll('.sr-field-edit').forEach((row, idx) => {
      out.push({
        label: row.querySelector('.sr-field-label-input').value.trim(),
        value: row.querySelector('.sr-field-value-input').value.trim(),
        sortOrder: idx
      });
    });
    return out;
  }

  function renderDetail() {
    const detail = mountEl.querySelector('.sr-detail');
    if (!detail) return;

    if (!activeStudent) {
      detail.innerHTML = '<p class="muted sr-detail-empty">Select a student or add a new one.</p>';
      return;
    }

    const s = activeStudent;
    const p = s.profile || {};
    const canEdit = !readonly;

    const sectionKeys = Object.keys(SECTION_LABELS).filter((key) => {
      if (key === 'parents' && role !== 'admin') return false;
      return true;
    });
    if (activeSection === 'parents' && role !== 'admin') activeSection = 'basic';

    let tabs = sectionKeys.map((key) =>
      '<button type="button" class="sr-section-tab' + (activeSection === key ? ' active' : '') +
      '" data-section="' + key + '">' + SECTION_LABELS[key] + '</button>'
    ).join('');

    let body = '';
    if (activeSection === 'basic') {
      body =
        '<div class="sr-photo-row">' +
        '<div class="sr-photo-box">' + avatarHtml(s, 'sr-photo-lg') + '</div>' +
        (canEdit ? (
          '<label class="btn btn-ghost sr-photo-upload">' +
          'Upload photo' +
          '<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-photo-input hidden">' +
          '</label>'
        ) : '') +
        '<div class="sr-photo-error error"></div>' +
        '</div>' +
        '<div class="sr-form-grid">' +
        (canEdit ? (
          '<input type="hidden" class="sr-input" data-key="studentId" value="' + escapeHtml(s.studentId || '') + '">' +
          '<label>Name <input class="sr-input" data-key="name" value="' + escapeHtml(s.name || '') + '" required></label>' +
          '<label>Student ID <input class="sr-input" data-key="studentIdDisplay" value="' + escapeHtml(s.studentId || '') + '" readonly></label>' +
          '<label>Class <select class="sr-input" data-key="classId">' +
          '<option value="">— Not assigned (registry) —</option>' +
          classes.map((c) =>
            '<option value="' + escapeHtml(c.classId) + '"' + (s.classId === c.classId ? ' selected' : '') + '>' +
            escapeHtml(c.name) + ' (' + escapeHtml(c.classId) + ')</option>'
          ).join('') +
          '</select></label>' +
          '<label>Status <select class="sr-input" data-key="status">' +
          ['Enrolled', 'Inactive', 'Withdrawn'].map((st) =>
            '<option value="' + st + '"' + (s.status === st ? ' selected' : '') + '>' + st + '</option>'
          ).join('') +
          '</select></label>' +
          '<label>Login ID <input class="sr-input" data-key="loginId" value="' + escapeHtml(s.loginId || '') + '"></label>' +
          '<label>Password <input class="sr-input" data-key="password" type="password" placeholder="' +
          (s.hasPassword ? 'Leave blank to keep' : 'Required for new') + '"></label>' +
          '<label>Date of birth <input class="sr-input" data-key="dateOfBirth" type="date" value="' + escapeHtml(p.dateOfBirth || '') + '"></label>' +
          '<label>Gender <input class="sr-input" data-key="gender" value="' + escapeHtml(p.gender || '') + '"></label>' +
          '<label>Nationality <input class="sr-input" data-key="nationality" value="' + escapeHtml(p.nationality || '') + '"></label>' +
          '<label>Grade level <input class="sr-input" data-key="gradeLevel" value="' + escapeHtml(p.gradeLevel || '') + '"></label>' +
          '<label>Enrolled date <input class="sr-input" data-key="enrolledDate" type="date" value="' + escapeHtml(p.enrolledDate || '') + '"></label>' +
          '<label>Previous school <input class="sr-input" data-key="previousSchool" value="' + escapeHtml(p.previousSchool || '') + '"></label>' +
          '<label>Phone <input class="sr-input" data-key="phone" value="' + escapeHtml(p.phone || '') + '"></label>' +
          '<label>Email <input class="sr-input" data-key="email" type="email" value="' + escapeHtml(p.email || '') + '"></label>' +
          '<label class="sr-span2">Address <input class="sr-input" data-key="address" value="' + escapeHtml(p.address || '') + '"></label>' +
          '<label>Parent name <input class="sr-input" data-key="parentName" value="' + escapeHtml(p.parentName || '') + '"></label>' +
          '<label>Parent phone <input class="sr-input" data-key="parentPhone" value="' + escapeHtml(p.parentPhone || '') + '"></label>' +
          '<label>Parent email <input class="sr-input" data-key="parentEmail" type="email" value="' + escapeHtml(p.parentEmail || '') + '"></label>' +
          '<label>Emergency contact <input class="sr-input" data-key="emergencyContact" value="' + escapeHtml(p.emergencyContact || '') + '"></label>' +
          '<label>Emergency phone <input class="sr-input" data-key="emergencyPhone" value="' + escapeHtml(p.emergencyPhone || '') + '"></label>' +
          '<label class="sr-span2">Notes <textarea class="sr-input" data-key="notes" rows="3">' + escapeHtml(p.notes || '') + '</textarea></label>'
        ) : (
          '<div class="sr-read-grid">' +
          readRow('Name', s.name) +
          readRow('Student ID', s.studentId) +
          readRow('Class', s.className || s.classId || '—') +
          readRow('Status', s.status) +
          readRow('Date of birth', p.dateOfBirth) +
          readRow('Gender', p.gender) +
          readRow('Nationality', p.nationality) +
          readRow('Grade level', p.gradeLevel) +
          readRow('Previous school', p.previousSchool) +
          readRow('Phone', p.phone) +
          readRow('Email', p.email) +
          readRow('Address', p.address) +
          readRow('Parent', p.parentName) +
          readRow('Parent phone', p.parentPhone) +
          readRow('Parent email', p.parentEmail) +
          readRow('Emergency', p.emergencyContact) +
          readRow('Emergency phone', p.emergencyPhone) +
          readRow('Notes', p.notes) +
          '</div>'
        )) +
        '</div>';
    } else if (activeSection === 'parents') {
      if (!s.studentId) {
        body = '<p class="muted">Save the student first, then link parent accounts.</p>';
      } else if (readonly) {
        body = linkedParents.length
          ? '<div class="sr-parent-list">' + linkedParents.map((p) =>
            '<div class="sr-parent-card">' +
            '<strong>' + escapeHtml(p.name || p.parentId) + '</strong>' +
            '<div class="muted small">' + escapeHtml(p.relationship || 'Guardian') +
            (p.loginId ? ' · ' + escapeHtml(p.loginId) : '') + '</div>' +
            '</div>'
          ).join('') + '</div>'
          : '<p class="muted">No parent accounts linked.</p>';
      } else {
        body =
          '<div class="sr-parent-list" id="srParentList">' +
          (linkedParents.length
            ? linkedParents.map((p) =>
              '<div class="sr-parent-card" data-parent-id="' + escapeHtml(p.parentId) + '">' +
              '<div><strong>' + escapeHtml(p.name || p.parentId) + '</strong>' +
              '<div class="muted small">' + escapeHtml(p.relationship || 'Guardian') +
              (p.loginId ? ' · login ' + escapeHtml(p.loginId) : '') +
              (p.phone ? ' · ' + escapeHtml(p.phone) : '') +
              '</div></div>' +
              '<button type="button" class="btn btn-ghost sr-unlink-parent" data-parent-id="' +
              escapeHtml(p.parentId) + '">Unlink</button>' +
              '</div>'
            ).join('')
            : '<p class="muted">No parent accounts linked yet.</p>') +
          '</div>' +
          '<h4 class="sr-subsection-title">Link or create parent</h4>' +
          '<p class="muted small">Already have a parent login (e.g. sibling)? Search and link below — do not create again. ' +
          'New family: fill Name + Login ID + Password, then Link parent.</p>' +
          '<div class="sr-form-grid sr-parent-link-form" autocomplete="off">' +
          '<label class="sr-span2">Find existing parent <input class="sr-parent-search" type="search" ' +
          'placeholder="Name / login / phone" list="srParentOptions" autocomplete="off" ' +
          'autocapitalize="off" spellcheck="false">' +
          '<datalist id="srParentOptions"></datalist></label>' +
          '<input type="hidden" class="sr-parent-id" value="" autocomplete="off">' +
          '<label>Name (new only) <input class="sr-parent-name" placeholder="Required if creating" ' +
          'autocomplete="off" name="salt_parent_name"></label>' +
          '<label>Login ID (new only) <input class="sr-parent-login" placeholder="e.g. onyumom" ' +
          'autocomplete="off" name="salt_parent_login" autocapitalize="off" spellcheck="false"></label>' +
          '<label>Password (new only) <input class="sr-parent-password" type="password" ' +
          'placeholder="Required for new" autocomplete="new-password" name="salt_parent_password"></label>' +
          '<label>Relationship <select class="sr-parent-rel" autocomplete="off">' +
          '<option value="Guardian">Guardian</option>' +
          '<option value="Mother">Mother</option>' +
          '<option value="Father">Father</option>' +
          '<option value="Other">Other</option>' +
          '</select></label>' +
          '<label>Phone <input class="sr-parent-phone" type="tel" autocomplete="off" name="salt_parent_phone"></label>' +
          '<label>Email <input class="sr-parent-email" type="email" autocomplete="off" name="salt_parent_email"></label>' +
          '</div>' +
          '<div style="margin-top:0.75rem">' +
          '<button type="button" class="btn btn-primary sr-link-parent-btn">Link parent</button>' +
          '</div>' +
          '<div class="error sr-parent-error" style="margin-top:0.5rem"></div>';
      }
    } else if (activeSection === 'schedule') {
      if (!activeStudent.studentId) {
        body = '<p class="muted">Save the student first to add a weekly timetable.</p>' + renderSectionFields('schedule');
      } else {
        body =
          '<div class="sr-tt-mount"></div>' +
          '<h4 class="sr-subsection-title">Attendance &amp; transport notes</h4>' +
          renderSectionFields('schedule');
      }
    } else {
      body = renderSectionFields(activeSection);
      if (!readonly && activeSection !== 'gradebook' && activeSection !== 'medical') {
        body += '<p class="muted small">Additional admin notes for this section.</p>';
      }
    }

    detail.innerHTML =
      '<div class="sr-detail-head">' +
      '<div class="sr-detail-title">' + avatarHtml(s, 'sr-photo-sm') +
      '<div><strong>' + escapeHtml(s.name || 'New student') + '</strong>' +
      '<div class="muted small">' + escapeHtml(s.studentId || 'Not saved yet') +
      (s.className ? ' · ' + escapeHtml(s.className) : '') +
      (s.status ? ' · <span class="sr-status-chip sr-status-' + escapeHtml(String(s.status).toLowerCase()) + '">' +
        escapeHtml(s.status) + '</span>' : '') +
      '</div></div></div>' +
      '<div class="sr-detail-actions">' +
      (canEdit ? '<button type="button" class="btn btn-primary sr-save-btn">Save</button>' : '') +
      (canEdit && s.studentId && s.status !== 'Withdrawn'
        ? '<button type="button" class="btn btn-danger sr-withdraw-btn">Delete</button>' : '') +
      (canEdit && s.studentId && s.status === 'Withdrawn'
        ? '<button type="button" class="btn btn-ok sr-restore-btn">Restore</button>' +
          '<button type="button" class="btn btn-danger sr-purge-btn">Permanently delete</button>' : '') +
      '</div>' +
      '</div>' +
      '<div class="sr-section-tabs">' + tabs + '</div>' +
      '<div class="sr-section-body">' + body + '</div>' +
      '<div class="sr-save-error error"></div>';

    bindDetailEvents();
    mountScheduleTimetable();
  }

  function mountScheduleTimetable() {
    if (activeSection !== 'schedule' || !activeStudent || !activeStudent.studentId) return;
    if (typeof global.SaltTimetable === 'undefined') return;
    const ttMount = mountEl.querySelector('.sr-tt-mount');
    if (!ttMount) return;
    if (!readonly) {
      api(
        (role === 'admin' ? '/api/admin/timetable/students/' : '/api/teacher/timetable/students/') +
        encodeURIComponent(activeStudent.studentId),
        {},
        role
      ).then((data) => {
        global.SaltTimetable.renderEditor(ttMount, {
          ownerType: 'student',
          ownerId: activeStudent.studentId,
          ownerName: activeStudent.name,
          classId: activeStudent.classId || '',
          timetable: data.timetable,
          readonly: false
        });
      }).catch((e) => {
        ttMount.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
      });
    } else {
      global.SaltTimetable.renderReadOnly(ttMount, 'student', activeStudent.studentId, activeStudent.name);
    }
  }

  function readRow(label, value) {
    return '<div class="sr-field-read"><div class="sr-field-label">' + escapeHtml(label) +
      '</div><div class="sr-field-value">' + (value ? escapeHtml(value) : '<span class="muted">—</span>') + '</div></div>';
  }

  function renderList() {
    const list = mountEl.querySelector('.sr-list');
    if (!list) return;

    if (!students.length) {
      list.innerHTML = '<p class="muted">No students found.</p>';
      return;
    }

    let html = '<div class="sr-list-items">';
    students.forEach((s) => {
      const active = s.studentId === activeId ? ' active' : '';
      const status = s.status || 'Enrolled';
      html +=
        '<button type="button" class="sr-list-item' + active + '" data-id="' + escapeHtml(s.studentId) + '">' +
        avatarHtml(s, 'sr-photo-xs') +
        '<div class="sr-list-meta">' +
        '<strong>' + escapeHtml(s.name) + '</strong>' +
        '<span class="muted small">' + escapeHtml(s.className || 'Unassigned') +
        (s.gradeLevel ? ' · ' + escapeHtml(s.gradeLevel) : '') + '</span>' +
        (role === 'admin'
          ? '<span class="sr-status-chip sr-status-' + escapeHtml(String(status).toLowerCase()) + '">' +
            escapeHtml(status) + '</span>'
          : '') +
        '</div></button>';
    });
    html += '</div>';
    list.innerHTML = html;

    list.querySelectorAll('.sr-list-item').forEach((btn) => {
      btn.addEventListener('click', () => openStudent(btn.dataset.id));
    });
  }

  function renderShell() {
    if (!mountEl) return;
    const canCreate = !readonly;
    mountEl.innerHTML =
      '<div class="sr-layout">' +
      '<aside class="sr-sidebar">' +
      '<div class="sr-toolbar">' +
      '<input type="search" class="sr-search" placeholder="Search students…">' +
      (role === 'admin' ? (
        '<select class="sr-filter-class"><option value="">All classes</option></select>' +
        '<select class="sr-filter-status"><option value="Enrolled">Enrolled</option>' +
        '<option value="">All statuses</option>' +
        '<option value="Inactive">Inactive</option><option value="Withdrawn">Withdrawn</option></select>'
      ) : (
        '<select class="sr-filter-class"><option value="">All my classes</option></select>'
      )) +
      (canCreate ? '<button type="button" class="btn btn-primary sr-new-btn">+ New student</button>' : '') +
      '</div>' +
      '<div class="sr-list"><p class="muted">Loading…</p></div>' +
      '</aside>' +
      '<section class="sr-detail"><p class="muted sr-detail-empty">Select a student.</p></section>' +
      '</div>';

    const classSelect = mountEl.querySelector('.sr-filter-class');
    if (classSelect) {
      classSelect.innerHTML = '<option value="">' + (role === 'admin' ? 'All classes' : 'All my classes') + '</option>' +
        classes.map((c) => '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.name) + '</option>').join('');
      classSelect.value = listFilter.classId;
    }
    const statusSelect = mountEl.querySelector('.sr-filter-status');
    if (statusSelect) statusSelect.value = listFilter.status;
    mountEl.querySelector('.sr-search').value = listFilter.q;

    mountEl.querySelector('.sr-search').addEventListener('input', (e) => {
      listFilter.q = e.target.value.trim();
      loadList();
    });
    if (classSelect) {
      classSelect.addEventListener('change', (e) => {
        listFilter.classId = e.target.value;
        loadList();
      });
    }
    if (statusSelect) {
      statusSelect.addEventListener('change', (e) => {
        listFilter.status = e.target.value;
        loadList();
      });
    }
    if (canCreate) {
      mountEl.querySelector('.sr-new-btn').addEventListener('click', () => newStudent());
    }
  }

  function bindDetailEvents() {
    mountEl.querySelectorAll('.sr-section-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeSection = btn.dataset.section;
        renderDetail();
        if (activeSection === 'parents' && activeStudent && activeStudent.studentId) {
          loadLinkedParents(activeStudent.studentId);
        }
      });
    });

    const saveBtn = mountEl.querySelector('.sr-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveStudent);

    const withdrawBtn = mountEl.querySelector('.sr-withdraw-btn');
    if (withdrawBtn) withdrawBtn.addEventListener('click', withdrawActiveStudent);

    const restoreBtn = mountEl.querySelector('.sr-restore-btn');
    if (restoreBtn) restoreBtn.addEventListener('click', restoreActiveStudent);

    const purgeBtn = mountEl.querySelector('.sr-purge-btn');
    if (purgeBtn) purgeBtn.addEventListener('click', purgeActiveStudent);

    const linkBtn = mountEl.querySelector('.sr-link-parent-btn');
    if (linkBtn) linkBtn.addEventListener('click', linkParentToActiveStudent);

    mountEl.querySelectorAll('.sr-unlink-parent').forEach((btn) => {
      btn.addEventListener('click', () => unlinkParent(btn.dataset.parentId));
    });

    const searchInput = mountEl.querySelector('.sr-parent-search');
    if (searchInput) {
      let timer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => searchParents(searchInput.value), 250);
      });
      searchInput.addEventListener('change', () => {
        const val = searchInput.value.trim();
        const opts = Array.from(mountEl.querySelectorAll('#srParentOptions option'));
        const hit = opts.find((o) => o.value === val);
        const pid = (hit && hit.dataset.parentId) || '';
        const idInput = mountEl.querySelector('.sr-parent-id');
        if (pid && idInput) {
          idInput.value = pid;
          // Linking existing — clear create fields so browser autofill cannot overwrite
          ['sr-parent-name', 'sr-parent-login', 'sr-parent-password', 'sr-parent-phone', 'sr-parent-email']
            .forEach((cls) => {
              const el = mountEl.querySelector('.' + cls);
              if (el) el.value = '';
            });
        }
      });
      // Browsers often autofill admin credentials into the first password field — wipe after paint
      setTimeout(() => {
        const login = mountEl.querySelector('.sr-parent-login');
        const pass = mountEl.querySelector('.sr-parent-password');
        if (login && !login.dataset.userTyped) login.value = '';
        if (pass && !pass.dataset.userTyped) pass.value = '';
      }, 100);
      mountEl.querySelector('.sr-parent-login')?.addEventListener('input', (e) => {
        e.target.dataset.userTyped = '1';
      });
      mountEl.querySelector('.sr-parent-password')?.addEventListener('input', (e) => {
        e.target.dataset.userTyped = '1';
      });
    }

    mountEl.querySelectorAll('.sr-add-field').forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        if (!activeStudent.fields) activeStudent.fields = {};
        if (!activeStudent.fields[section]) activeStudent.fields[section] = [];
        activeStudent.fields[section].push({ label: '', value: '', sortOrder: activeStudent.fields[section].length });
        renderDetail();
      });
    });

    mountEl.querySelectorAll('.sr-field-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.sr-field-edit');
        const wrap = row.parentElement;
        const idx = Array.from(wrap.querySelectorAll('.sr-field-edit')).indexOf(row);
        const section = wrap.dataset.section;
        if (activeStudent.fields && activeStudent.fields[section]) {
          activeStudent.fields[section].splice(idx, 1);
        }
        renderDetail();
      });
    });

    const photoInput = mountEl.querySelector('.sr-photo-input');
    if (photoInput) {
      photoInput.addEventListener('change', async () => {
        const file = photoInput.files && photoInput.files[0];
        if (!file || !activeStudent || !activeStudent.studentId) return;
        const errEl = mountEl.querySelector('.sr-photo-error');
        errEl.textContent = '';
        try {
          const fd = new FormData();
          fd.append('photo', file);
          const res = await api(apiBase() + '/' + encodeURIComponent(activeStudent.studentId) + '/photo', {
            method: 'POST',
            body: fd
          }, role);
          activeStudent.photoPath = res.photoPath;
          if (activeStudent.profile) activeStudent.profile.photoPath = res.photoPath;
          renderDetail();
          loadList();
        } catch (e) {
          errEl.textContent = e.message;
        }
        photoInput.value = '';
      });
    }
  }

  function inputVal(key) {
    const el = mountEl.querySelector('.sr-input[data-key="' + key + '"]');
    return el ? el.value.trim() : '';
  }

  function fieldsForSave() {
    const out = {};
    ['gradebook', 'schedule', 'medical'].forEach((section) => {
      const wrap = mountEl.querySelector('.sr-fields[data-section="' + section + '"]');
      if (wrap) {
        out[section] = collectFields(section);
      } else if (activeStudent && activeStudent.fields && activeStudent.fields[section]) {
        out[section] = activeStudent.fields[section].map((f) => ({
          fieldId: f.fieldId,
          label: f.label,
          value: f.value,
          sortOrder: f.sortOrder
        }));
      } else {
        out[section] = [];
      }
    });
    return out;
  }

  async function withdrawActiveStudent() {
    if (!activeStudent || !activeStudent.studentId) return;
    if (!confirm('Delete "' + activeStudent.name + '" from the active student list?\n\nThey will be marked Withdrawn and removed from their class. You can restore them later from the Withdrawn filter.')) {
      return;
    }
    const errEl = mountEl.querySelector('.sr-save-error');
    errEl.textContent = '';
    try {
      await api(apiBase() + '/' + encodeURIComponent(activeStudent.studentId) + '/withdraw', {
        method: 'POST',
        body: {}
      }, role);
      activeStudent = null;
      activeId = '';
      await loadList();
      renderDetail();
    } catch (e) {
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function restoreActiveStudent() {
    if (!activeStudent || !activeStudent.studentId) return;
    const errEl = mountEl.querySelector('.sr-save-error');
    errEl.textContent = '';
    try {
      const data = await api(apiBase() + '/' + encodeURIComponent(activeStudent.studentId) + '/restore', {
        method: 'POST',
        body: {}
      }, role);
      activeStudent = data.student;
      activeId = activeStudent.studentId;
      listFilter.status = 'Enrolled';
      const statusSelect = mountEl.querySelector('.sr-filter-status');
      if (statusSelect) statusSelect.value = 'Enrolled';
      await loadList();
      renderDetail();
    } catch (e) {
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function purgeActiveStudent() {
    if (!activeStudent || !activeStudent.studentId) return;
    if (!confirm('Permanently delete "' + activeStudent.name + '"?\n\nThis cannot be undone.')) return;
    if (!confirm('Final confirmation: permanently erase this student record?')) return;
    const errEl = mountEl.querySelector('.sr-save-error');
    errEl.textContent = '';
    try {
      await api(apiBase() + '/' + encodeURIComponent(activeStudent.studentId), {
        method: 'DELETE'
      }, role);
      activeStudent = null;
      activeId = '';
      await loadList();
      renderDetail();
    } catch (e) {
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function saveStudent() {
    const errEl = mountEl.querySelector('.sr-save-error');
    errEl.textContent = '';
    try {
      const payload = {
        studentId: inputVal('studentId') || undefined,
        name: inputVal('name'),
        classId: inputVal('classId'),
        status: inputVal('status') || 'Enrolled',
        loginId: inputVal('loginId'),
        password: inputVal('password'),
        profile: {
          dateOfBirth: inputVal('dateOfBirth'),
          gender: inputVal('gender'),
          nationality: inputVal('nationality'),
          address: inputVal('address'),
          phone: inputVal('phone'),
          email: inputVal('email'),
          parentName: inputVal('parentName'),
          parentPhone: inputVal('parentPhone'),
          parentEmail: inputVal('parentEmail'),
          emergencyContact: inputVal('emergencyContact'),
          emergencyPhone: inputVal('emergencyPhone'),
          previousSchool: inputVal('previousSchool'),
          gradeLevel: inputVal('gradeLevel'),
          enrolledDate: inputVal('enrolledDate'),
          notes: inputVal('notes')
        },
        fields: fieldsForSave()
      };
      const data = await api(apiBase(), { method: 'POST', body: payload }, role);
      activeStudent = data.student;
      activeId = activeStudent.studentId;
      errEl.style.color = '#16a34a';
      errEl.textContent = 'Saved.';
      await loadList();
      renderDetail();
    } catch (e) {
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  function newStudent() {
    activeId = null;
    activeSection = 'basic';
    activeStudent = {
      studentId: '',
      name: '',
      classId: '',
      status: 'Enrolled',
      loginId: '',
      profile: {},
      fields: {
        gradebook: [
          { label: 'Previous school grades', value: '' },
          { label: 'Placement level', value: '' },
          { label: 'ESL level', value: '' },
          { label: 'Reading level', value: '' },
          { label: 'Math level', value: '' },
          { label: 'Notes', value: '' }
        ],
        schedule: [
          { label: 'Preferred days', value: '' },
          { label: 'Transport method', value: '' },
          { label: 'Pickup person', value: '' },
          { label: 'Special schedule', value: '' },
          { label: 'Attendance notes', value: '' }
        ],
        medical: [
          { label: 'Allergies', value: '' },
          { label: 'Medications', value: '' },
          { label: 'Medical conditions', value: '' },
          { label: 'Dietary restrictions', value: '' },
          { label: 'Doctor name', value: '' },
          { label: 'Doctor phone', value: '' },
          { label: 'Notes', value: '' }
        ]
      }
    };
    renderDetail();
  }

  async function loadLinkedParents(studentId) {
    if (role !== 'admin' || !studentId) return;
    try {
      const data = await api('/api/admin/students/' + encodeURIComponent(studentId) + '/parents', {}, role);
      linkedParents = Array.isArray(data.parents) ? data.parents : [];
    } catch (_) {
      linkedParents = [];
    }
    if (activeSection === 'parents' && activeStudent && activeStudent.studentId === studentId) {
      renderDetail();
    }
  }

  async function searchParents(query) {
    const q = String(query || '').trim();
    const list = mountEl && mountEl.querySelector('#srParentOptions');
    if (!list) return;
    if (q.length < 1) {
      list.innerHTML = '';
      return;
    }
    try {
      const data = await api('/api/admin/parents?q=' + encodeURIComponent(q), {}, role);
      const parents = Array.isArray(data.parents) ? data.parents : [];
      list.innerHTML = parents.map((p) => {
        const label = (p.name || p.parentId) +
          (p.loginId ? ' (' + p.loginId + ')' : '') +
          ' · ' + p.parentId;
        return '<option value="' + escapeHtml(label) + '" data-parent-id="' +
          escapeHtml(p.parentId) + '"></option>';
      }).join('');
    } catch (_) {
      list.innerHTML = '';
    }
  }

  async function linkParentToActiveStudent() {
    if (!activeStudent || !activeStudent.studentId || role !== 'admin') return;
    const errEl = mountEl.querySelector('.sr-parent-error');
    if (errEl) errEl.textContent = '';
    const parentId = (mountEl.querySelector('.sr-parent-id') || {}).value || '';
    const name = (mountEl.querySelector('.sr-parent-name') || {}).value || '';
    const loginId = (mountEl.querySelector('.sr-parent-login') || {}).value || '';
    const password = (mountEl.querySelector('.sr-parent-password') || {}).value || '';
    const relationship = (mountEl.querySelector('.sr-parent-rel') || {}).value || 'Guardian';
    const phone = (mountEl.querySelector('.sr-parent-phone') || {}).value || '';
    const email = (mountEl.querySelector('.sr-parent-email') || {}).value || '';
    const payload = {
      parentId: String(parentId).trim() || undefined,
      name: String(name).trim() || undefined,
      loginId: String(loginId).trim() || undefined,
      password: String(password) || undefined,
      relationship: String(relationship).trim() || 'Guardian',
      phone: String(phone).trim() || undefined,
      email: String(email).trim() || undefined,
      isPrimary: linkedParents.length === 0
    };
    if (!payload.parentId && (!payload.name || !payload.loginId)) {
      if (errEl) errEl.textContent = 'Search an existing parent, or enter Name + Login ID to create one.';
      return;
    }
    try {
      await api('/api/admin/students/' + encodeURIComponent(activeStudent.studentId) + '/parents', {
        method: 'POST',
        body: payload
      }, role);
      await loadLinkedParents(activeStudent.studentId);
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Could not link parent.';
    }
  }

  async function unlinkParent(parentId) {
    if (!activeStudent || !activeStudent.studentId || !parentId) return;
    if (!confirm('Unlink this parent from the student?')) return;
    const errEl = mountEl.querySelector('.sr-parent-error');
    if (errEl) errEl.textContent = '';
    try {
      await api(
        '/api/admin/students/' + encodeURIComponent(activeStudent.studentId) +
        '/parents/' + encodeURIComponent(parentId),
        { method: 'DELETE' },
        role
      );
      await loadLinkedParents(activeStudent.studentId);
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Could not unlink parent.';
    }
  }

  async function openStudent(studentId) {
    activeId = studentId;
    activeSection = 'basic';
    linkedParents = [];
    try {
      const data = await api(apiBase() + '/' + encodeURIComponent(studentId), {}, role);
      activeStudent = data.student;
      renderList();
      renderDetail();
      if (role === 'admin' && activeStudent && activeStudent.studentId) {
        loadLinkedParents(activeStudent.studentId);
      }
    } catch (e) {
      activeStudent = null;
      renderDetail();
    }
  }

  async function loadList() {
    const q = listFilter.q ? '?q=' + encodeURIComponent(listFilter.q) : '';
    let query = q;
    const params = [];
    if (listFilter.classId) params.push('classId=' + encodeURIComponent(listFilter.classId));
    if (listFilter.status) params.push('status=' + encodeURIComponent(listFilter.status));
    if (listFilter.q) params.push('q=' + encodeURIComponent(listFilter.q));
    if (params.length) query = '?' + params.join('&');

    const data = await api(apiBase() + query, {}, role);
    students = data.students || [];
    renderList();
  }

  function init(opts) {
    role = opts.role || 'admin';
    readonly = role !== 'admin';
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    $ = opts.$;
    classes = opts.classes || [];
    mountEl = typeof opts.mount === 'string' ? document.getElementById(opts.mount) : opts.mount;
    listFilter = { q: '', classId: '', status: role === 'admin' ? 'Enrolled' : '' };
    students = [];
    activeId = null;
    activeStudent = null;
    activeSection = 'basic';
    renderShell();
  }

  async function open() {
    if (!mountEl) return;
    await loadList();
  }

  function setClasses(list) {
    classes = list || [];
    if (mountEl && mountEl.querySelector('.sr-filter-class')) {
      const sel = mountEl.querySelector('.sr-filter-class');
      const val = sel.value;
      sel.innerHTML = '<option value="">' + (role === 'admin' ? 'All classes' : 'All my classes') + '</option>' +
        classes.map((c) => '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.name) + '</option>').join('');
      sel.value = val;
    }
  }

  global.SaltStudentRegistry = { init, open, setClasses, loadList };
})(window);
