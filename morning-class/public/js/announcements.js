/* Salt Morning Class — Announcements (compose + read) */
window.SaltAnnouncements = (function() {
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }

  /** Escape text, preserve newlines, autolink bare URLs. */
  function formatBody(text) {
    const escaped = escapeHtml(text || '');
    const linked = escaped.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return linked.replace(/\n/g, '<br>');
  }

  function cardHtml(a, opts) {
    opts = opts || {};
    const hideSourceBadge = !!opts.hideSourceBadge;
    const source = a.scope === 'class'
      ? ('From Class' + (a.className ? ' · ' + a.className : ''))
      : 'From School';
    const audience = a.audience === 'parent' ? 'Parents'
      : (a.audience === 'student' ? 'Students' : 'Parents & Students');
    let media = '';
    if (a.imagePath) {
      media += '<a class="ann-image-link" href="' + escapeHtml(a.imagePath) + '" target="_blank" rel="noopener">' +
        '<img class="ann-image" src="' + escapeHtml(a.imagePath) + '" alt=""></a>';
    }
    if (a.linkUrl) {
      media += '<p class="ann-link"><a href="' + escapeHtml(a.linkUrl) + '" target="_blank" rel="noopener">' +
        escapeHtml(a.linkLabel || a.linkUrl) + '</a></p>';
    }
    if (a.attachmentPath) {
      media += '<p class="ann-attach"><a href="' + escapeHtml(a.attachmentPath) + '" target="_blank" rel="noopener">' +
        '📎 ' + escapeHtml(a.attachmentName || 'Attachment') + '</a></p>';
    }
    const removeBtn = opts.canRemove
      ? '<button type="button" class="btn btn-ghost ann-remove" data-id="' +
        escapeHtml(a.announcementId) + '">Remove</button>'
      : '';
    return (
      '<article class="ann-card ann-scope-' + escapeHtml(a.scope || 'school') + '">' +
      '<div class="ann-card-top">' +
        (hideSourceBadge
          ? (a.scope === 'class' && a.className
            ? '<span class="ann-class muted small">' + escapeHtml(a.className) + '</span>'
            : '')
          : '<span class="ann-badge">' + escapeHtml(source) + '</span>') +
        (opts.showAudience !== false
          ? '<span class="ann-audience muted small">' + escapeHtml(audience) + '</span>'
          : '') +
      '</div>' +
      '<h3 class="ann-title">' + escapeHtml(a.title || '') + '</h3>' +
      '<div class="ann-body">' + formatBody(a.body) + '</div>' +
      media +
      '<div class="ann-meta muted small">' +
        escapeHtml(a.postedBy || '') +
        (a.postedAt ? ' · ' + escapeHtml(formatWhen(a.postedAt)) : '') +
        removeBtn +
      '</div>' +
      '</article>'
    );
  }

  function renderList(mountEl, items, opts) {
    if (!mountEl) return;
    opts = opts || {};
    const list = items || [];
    if (!list.length) {
      mountEl.innerHTML = '<p class="muted ann-empty">' +
        escapeHtml(opts.emptyText || 'No announcements yet.') + '</p>';
      return;
    }
    mountEl.innerHTML = list.map((a) => cardHtml(a, opts)).join('');
    if (opts.onRemove) {
      mountEl.querySelectorAll('.ann-remove').forEach((btn) => {
        btn.addEventListener('click', () => opts.onRemove(btn.dataset.id));
      });
    }
  }

  /** One list, grouped under From School / From Class headings. */
  function renderGroupedList(mountEl, items, opts) {
    if (!mountEl) return;
    opts = opts || {};
    const list = items || [];
    const school = list.filter((a) => (a.scope || 'school') !== 'class');
    const classItems = list.filter((a) => a.scope === 'class');

    if (!school.length && !classItems.length) {
      mountEl.innerHTML = '<p class="muted ann-empty">' +
        escapeHtml(opts.emptyText || 'No announcements yet.') + '</p>';
      return;
    }

    const sectionOpts = Object.assign({}, opts, { hideSourceBadge: true, showAudience: false });
    let html = '';
    html += '<section class="ann-group">' +
      '<h4 class="ann-group-title">From School</h4>' +
      (school.length
        ? school.map((a) => cardHtml(a, sectionOpts)).join('')
        : '<p class="muted small ann-empty">No school announcements yet.</p>') +
      '</section>';
    html += '<section class="ann-group">' +
      '<h4 class="ann-group-title">From Class</h4>' +
      (classItems.length
        ? classItems.map((a) => cardHtml(a, sectionOpts)).join('')
        : '<p class="muted small ann-empty">No class announcements yet.</p>') +
      '</section>';
    mountEl.innerHTML = html;

    if (opts.onRemove) {
      mountEl.querySelectorAll('.ann-remove').forEach((btn) => {
        btn.addEventListener('click', () => opts.onRemove(btn.dataset.id));
      });
    }
  }

  function composerHtml(opts) {
    opts = opts || {};
    const isTeacher = opts.mode === 'teacher';
    const fixedClassId = String(opts.fixedClassId || '').trim();
    const classOpts = (opts.classes || []).map((c) =>
      '<option value="' + escapeHtml(c.classId) + '"' +
      (fixedClassId && c.classId === fixedClassId ? ' selected' : '') + '>' +
      escapeHtml(c.className || c.classId) + '</option>'
    ).join('');
    return (
      '<form class="ann-compose" id="' + escapeHtml(opts.formId || 'annComposeForm') + '">' +
      '<div class="ann-compose-grid">' +
        (isTeacher
          ? (fixedClassId
            ? '<input type="hidden" name="classId" value="' + escapeHtml(fixedClassId) + '">' +
              '<input type="hidden" name="scope" value="class">' +
              '<p class="muted small ann-span-2" style="margin:0">Posting to this class only.</p>'
            : '<label>Class <select name="classId" required><option value="">Select class</option>' +
              classOpts + '</select></label>' +
              '<input type="hidden" name="scope" value="class">')
          : '<label>Scope <select name="scope" id="' + escapeHtml((opts.formId || 'ann') + 'Scope') + '">' +
            '<option value="school">School-wide</option>' +
            '<option value="class">Specific class</option></select></label>' +
            '<label class="ann-class-field hidden">Class <select name="classId">' +
            '<option value="">Select class</option>' + classOpts + '</select></label>') +
        '<label>Audience <select name="audience">' +
          '<option value="both">Parents &amp; Students</option>' +
          '<option value="parent">Parents only</option>' +
          '<option value="student">Students only</option>' +
        '</select></label>' +
        '<label class="ann-span-2">Title <input name="title" required maxlength="160" placeholder="Announcement title"></label>' +
        '<label class="ann-span-2">Message <textarea name="body" rows="5" maxlength="4000" placeholder="Write the announcement…"></textarea></label>' +
        '<label>Link URL <input name="linkUrl" type="url" placeholder="https://…"></label>' +
        '<label>Link label <input name="linkLabel" maxlength="80" placeholder="Optional label"></label>' +
        '<label>Photo <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>' +
        '<label>Attachment <input name="attachment" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,image/*"></label>' +
      '</div>' +
      '<div class="ann-compose-actions">' +
        '<button type="submit" class="btn btn-primary">Post announcement</button>' +
        '<span class="muted small">Supports photo, file attachment, and hyperlink.</span>' +
      '</div>' +
      '<div class="error ann-compose-error" hidden></div>' +
      '</form>'
    );
  }

  function bindComposer(mountEl, opts) {
    if (!mountEl) return;
    opts = opts || {};
    mountEl.innerHTML = composerHtml(opts);
    const form = mountEl.querySelector('form');
    const err = mountEl.querySelector('.ann-compose-error');
    const scopeSel = form.querySelector('select[name="scope"]');
    const classField = mountEl.querySelector('.ann-class-field');
    function syncScope() {
      if (!classField || !scopeSel) return;
      const isClass = scopeSel.value === 'class';
      classField.classList.toggle('hidden', !isClass);
      const sel = classField.querySelector('select');
      if (sel) sel.required = isClass;
    }
    if (scopeSel) {
      scopeSel.addEventListener('change', syncScope);
      syncScope();
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      err.textContent = '';
      const fd = new FormData(form);
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await opts.onSubmit(fd);
        form.reset();
        syncScope();
        if (opts.onPosted) opts.onPosted();
      } catch (ex) {
        err.textContent = ex.message || 'Could not post.';
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  }

  return { renderList, renderGroupedList, bindComposer, formatBody, formatWhen, escapeHtml, cardHtml };
})();
